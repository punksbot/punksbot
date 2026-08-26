use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{failure::classify_observed_interruption, FailureKind};

/// Trace sémantique canonique partagée par les SDK et le backend Workers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SemanticTrace {
    pub operation: String,
    #[serde(rename = "case")]
    pub case_name: String,
    pub phase: String,
    pub outcome: String,
    pub failure_kind: Option<String>,
    pub recovery_decision: String,
    pub generation: Option<String>,
    pub deliveries: Vec<String>,
    pub renderer_confirmation: String,
    pub ack: String,
}

/// Observation brute ; `diagnostic` peut contenir des secrets de transport.
pub struct SemanticObservation {
    pub trace: SemanticTrace,
    pub diagnostic: Value,
}

/// Observation déterministe injectée par le corpus commun. Les événements
/// représentent des frontières réellement observables, jamais un verdict.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SemanticEvent {
    Validate {
        boundary: String,
        contract: Option<String>,
        payload: Value,
    },
    Complete,
    ServerResult {
        outcome: String,
    },
    Emit,
    Commit,
    Cancel {
        phase: String,
    },
    Interrupt {
        phase: String,
    },
    Problem {
        payload: Value,
    },
    SameCommand,
    SessionExpired,
    GenerationChanged {
        phase: String,
    },
    ResumeRead,
    Delivery {
        contract: String,
        payload: Value,
        #[serde(rename = "deliveryId")]
        delivery_id: String,
    },
    Renderer {
        state: String,
    },
    Ack {
        cursor: u64,
    },
}

/// Normalise par allowlist : le diagnostic brut ne peut pas franchir la trace.
pub fn normalize_semantic_trace(observation: SemanticObservation) -> SemanticTrace {
    let SemanticObservation {
        trace,
        diagnostic: _,
    } = observation;
    trace
}

fn failure_name(kind: FailureKind) -> &'static str {
    match kind {
        FailureKind::Problem => "problem",
        FailureKind::Transport => "transport",
        FailureKind::ContractViolation => "contract_violation",
        FailureKind::Cancelled => "cancelled",
        FailureKind::StaleWorkspace => "stale_workspace",
        FailureKind::SessionExpired => "session_expired",
        FailureKind::AccountMerged => "account_merged",
        FailureKind::Ambiguous => "ambiguous",
    }
}

fn base_trace(operation: &str, case_name: &str, owner: &str) -> SemanticTrace {
    SemanticTrace {
        operation: operation.to_owned(),
        case_name: case_name.to_owned(),
        phase: "completed".to_owned(),
        outcome: "ok".to_owned(),
        failure_kind: None,
        recovery_decision: "none".to_owned(),
        generation: (owner == "workspace").then(|| "generation:1".to_owned()),
        deliveries: Vec::new(),
        renderer_confirmation: "not_applicable".to_owned(),
        ack: "not_applicable".to_owned(),
    }
}

/// Rejoue des événements de frontière avec la taxonomie du client Rust.
/// Le libellé du cas est uniquement reporté dans la trace et ne choisit jamais
/// une transition.
pub fn run_semantic_scenario(
    operation: &str,
    case_name: &str,
    owner: &str,
    kind: &str,
    events: &[SemanticEvent],
) -> SemanticTrace {
    let mut trace = base_trace(operation, case_name, owner);
    let mut emitted = false;
    let mut committed = false;
    let mut follow_state: Option<crate::FollowState> = None;
    let mut renderer_confirmed = false;
    for event in events {
        match event {
            SemanticEvent::Validate {
                boundary,
                contract,
                payload,
            } => {
                let valid = contract.as_deref().is_some_and(|contract| {
                    crate::contracts_profile::decode_profile_contract(contract, payload.clone())
                        .is_ok()
                });
                if boundary == "frame" {
                    trace.phase = "delivery".to_owned();
                    trace.outcome = if valid { "ok" } else { "reject" }.to_owned();
                    trace.failure_kind = (!valid).then(|| "contract_violation".to_owned());
                    trace.recovery_decision = if valid { "none" } else { "resync" }.to_owned();
                    trace.renderer_confirmation =
                        if valid { "pending" } else { "not_confirmed" }.to_owned();
                    trace.ack = "suppressed".to_owned();
                } else {
                    trace.phase = format!("{boundary}_validation");
                    trace.outcome = if valid { "ok" } else { "reject" }.to_owned();
                    trace.failure_kind = (!valid).then(|| "contract_violation".to_owned());
                    trace.recovery_decision = "none".to_owned();
                }
            }
            SemanticEvent::Complete => {
                trace.phase = "completed".to_owned();
                trace.outcome = "ok".to_owned();
                trace.failure_kind = None;
                trace.recovery_decision = "none".to_owned();
            }
            SemanticEvent::ServerResult { outcome } => {
                trace.phase = "completed".to_owned();
                trace.outcome.clone_from(outcome);
                trace.failure_kind = None;
                trace.recovery_decision = "none".to_owned();
            }
            SemanticEvent::Emit => emitted = true,
            SemanticEvent::Commit => committed = true,
            SemanticEvent::Cancel { phase } if phase == "before_emit" => {
                trace.phase = "before_emit".to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some("cancelled".to_owned());
                trace.recovery_decision = "effect_excluded".to_owned();
            }
            SemanticEvent::Cancel { phase } if phase == "in_flight" => {
                let interruption = classify_observed_interruption(kind, true, false, true);
                trace.phase = interruption.phase.to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some(failure_name(interruption.kind).to_owned());
                trace.recovery_decision = interruption.recovery_decision.to_owned();
                if kind == "follow" {
                    trace.ack = "suppressed".to_owned();
                }
            }
            SemanticEvent::Cancel { phase } if phase == "delivery" => {
                trace.phase = "delivery".to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some("cancelled".to_owned());
                trace.recovery_decision = "stop_follow".to_owned();
                trace.renderer_confirmation = "not_confirmed".to_owned();
                trace.ack = "suppressed".to_owned();
            }
            SemanticEvent::Cancel { .. } => {
                trace.phase = "renderer_confirmation".to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some("cancelled".to_owned());
                trace.recovery_decision = "discard_delivery".to_owned();
                trace.renderer_confirmation = "cancelled".to_owned();
                trace.ack = "suppressed".to_owned();
            }
            SemanticEvent::Interrupt { phase: _ } => {
                let interruption = classify_observed_interruption(kind, emitted, committed, false);
                trace.phase = interruption.phase.to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some(failure_name(interruption.kind).to_owned());
                trace.recovery_decision = interruption.recovery_decision.to_owned();
            }
            SemanticEvent::Problem { payload } => {
                let valid = crate::contracts_profile::decode_profile_contract(
                    "punks://contracts/problem@1",
                    payload.clone(),
                )
                .is_ok();
                let failure = if valid {
                    let status = payload
                        .get("status")
                        .and_then(Value::as_u64)
                        .and_then(|value| u16::try_from(value).ok())
                        .unwrap_or(500);
                    let code = payload.get("code").and_then(Value::as_str).unwrap_or("");
                    let retry = payload
                        .get("retry")
                        .and_then(Value::as_str)
                        .unwrap_or("never");
                    failure_name(crate::transport::problem_failure_kind(status, code, retry))
                } else {
                    "contract_violation"
                };
                trace.phase = "remote_boundary".to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some(failure.to_owned());
                trace.recovery_decision = if failure == "session_expired" {
                    "close_session"
                } else {
                    "fail_closed"
                }
                .to_owned();
            }
            SemanticEvent::SameCommand => {
                trace.phase = "after_emit".to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some("ambiguous".to_owned());
                trace.recovery_decision = "new_intent_required".to_owned();
            }
            SemanticEvent::SessionExpired => {
                trace.phase = "remote_boundary".to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some("session_expired".to_owned());
                trace.recovery_decision = "close_session".to_owned();
            }
            SemanticEvent::GenerationChanged { phase } => {
                trace.phase = match phase.as_str() {
                    "before_emit" => "before_emit",
                    "delivery" => "delivery",
                    _ => "after_response",
                }
                .to_owned();
                trace.outcome = "reject".to_owned();
                trace.failure_kind = Some("stale_workspace".to_owned());
                trace.recovery_decision = match phase.as_str() {
                    "before_emit" => "close_generation",
                    "delivery" => "discard_delivery",
                    _ => "discard_result",
                }
                .to_owned();
                trace.generation = Some("generation:stale".to_owned());
                if phase == "delivery" {
                    trace.renderer_confirmation = "rejected".to_owned();
                    trace.ack = "suppressed".to_owned();
                }
            }
            SemanticEvent::ResumeRead => {
                trace.phase = "completed".to_owned();
                trace.outcome = "resumed".to_owned();
                trace.failure_kind = None;
                trace.recovery_decision = "retry_active_lease".to_owned();
            }
            SemanticEvent::Delivery {
                contract,
                payload,
                delivery_id,
            } => {
                let mut valid =
                    crate::contracts_profile::decode_profile_contract(contract, payload.clone())
                        .is_ok();
                if valid {
                    if let Ok(frame) =
                        serde_json::from_value::<crate::FollowServerFrame>(payload.clone())
                    {
                        if let crate::FollowServerFrame::Changes {
                            from_exclusive_cursor,
                            through_cursor,
                            ..
                        } = &frame
                        {
                            let initial = crate::FollowState::new(*from_exclusive_cursor);
                            let accepted = crate::reduce_follow_frame(
                                &initial,
                                crate::FollowServerFrame::Accepted {
                                    schema_version: 1,
                                    resume_after_cursor: *from_exclusive_cursor,
                                    target_high_water_cursor: *through_cursor,
                                },
                            );
                            let reduction = crate::reduce_follow_frame(&accepted.state, frame);
                            valid = matches!(reduction.effect, crate::FollowEffect::ApplyBatch(_));
                            follow_state = valid.then_some(reduction.state);
                        }
                    }
                }
                trace.phase = "delivery".to_owned();
                trace.outcome = if valid { "ok" } else { "reject" }.to_owned();
                trace.failure_kind = (!valid).then(|| "contract_violation".to_owned());
                trace.recovery_decision = if valid { "none" } else { "resync" }.to_owned();
                if valid {
                    trace.deliveries.push(delivery_id.clone());
                }
                trace.renderer_confirmation =
                    if valid { "pending" } else { "not_confirmed" }.to_owned();
                trace.ack = "suppressed".to_owned();
            }
            SemanticEvent::Renderer { state } => {
                renderer_confirmed = state == "confirmed";
                trace.phase = "renderer_confirmation".to_owned();
                trace.outcome = if state == "suspended" {
                    "pending"
                } else {
                    "ok"
                }
                .to_owned();
                trace.failure_kind = None;
                trace.recovery_decision = if state == "suspended" {
                    "wait_renderer"
                } else {
                    "none"
                }
                .to_owned();
                trace.renderer_confirmation.clone_from(state);
                trace.ack = "suppressed".to_owned();
            }
            SemanticEvent::Ack { cursor } => {
                let confirmation = renderer_confirmed
                    .then(|| {
                        follow_state
                            .as_ref()
                            .map(|state| crate::confirm_follow_batch(state, *cursor))
                    })
                    .flatten();
                trace.ack = if confirmation.is_some_and(|value| value.ack.is_some()) {
                    format!("sent:cursor:{cursor}")
                } else {
                    "suppressed".to_owned()
                };
            }
        }
    }
    trace
}
