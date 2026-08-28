use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    sync::{Arc, Mutex},
    task::{Context, Poll, Wake, Waker},
    time::{Duration, SystemTime},
};

use serde::{Deserialize, Serialize};

use crate::{
    ceremony::{
        logout_local_first, Ceremony, CeremonyClock, CeremonyFailure, CeremonyPhase, LogoutOutcome,
        PendingRevocation, QuarantineJar, RenewalPolicy, RevocationCapability, RevocationQueue,
        RevocationSecret, SessionMetadata, SessionPersistence, SessionSecret, CEREMONY_START_TTL,
        RENEWAL_MIN_INTERVAL, RENEWAL_THRESHOLD,
    },
    confirm_follow_batch, reduce_follow_frame, FollowPhase, FollowServerFrame, FollowState,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowCorpus {
    profile: String,
    operation: String,
    traces: Vec<FollowTrace>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FollowTrace {
    name: String,
    initial_pagination_high_water: u64,
    steps: Vec<FollowStep>,
}

#[derive(Deserialize)]
#[serde(tag = "operation", rename_all = "lowercase")]
enum FollowStep {
    Frame {
        frame: FollowServerFrame,
        expected: ExpectedFollowTrace,
    },
    Confirm {
        #[serde(rename = "throughCursor")]
        through_cursor: u64,
        expected: ExpectedFollowTrace,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpectedFollowTrace {
    phase: String,
    effect: String,
    applied_cursor: u64,
    follow_checkpoint: u64,
    pending_confirmation_cursor: Option<u64>,
}

/// One installed-artifact verdict derived from the embedded common FOLLOW corpus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionFollowScenario {
    /// Closed expected outcome used by the promotion transcript.
    pub outcome: String,
    /// Named corpus traces that materially established the outcome.
    pub observations: Vec<String>,
}

/// One installed-artifact verdict derived from the compiled auth ceremony.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromotionAuthScenario {
    /// Closed expected outcome used by the promotion driver.
    pub outcome: String,
    /// Concrete compiled transitions that established the outcome.
    pub observations: Vec<String>,
}

fn phase_name(phase: FollowPhase) -> &'static str {
    match phase {
        FollowPhase::AwaitingAcceptance => "awaiting_acceptance",
        FollowPhase::CatchingUp => "catching_up",
        FollowPhase::Live => "live",
        FollowPhase::ResyncRequired => "resync_required",
        FollowPhase::Terminal => "terminal",
    }
}

fn verify_expected(
    trace_name: &str,
    state: &FollowState,
    effect: &str,
    expected: &ExpectedFollowTrace,
) -> Result<(), String> {
    if phase_name(state.phase) != expected.phase
        || effect != expected.effect
        || state.applied_cursor != expected.applied_cursor
        || state.follow_checkpoint != expected.follow_checkpoint
        || state.pending_confirmation_cursor != expected.pending_confirmation_cursor
    {
        return Err(format!(
            "embedded FOLLOW conformance diverged at {trace_name}"
        ));
    }
    Ok(())
}

fn scenario(
    passed: &BTreeSet<String>,
    outcome: &str,
    traces: &[&str],
) -> Result<PromotionFollowScenario, String> {
    if traces.iter().any(|trace| !passed.contains(*trace)) {
        return Err("embedded FOLLOW conformance corpus is incomplete".to_string());
    }
    Ok(PromotionFollowScenario {
        outcome: outcome.to_string(),
        observations: traces
            .iter()
            .map(|trace| format!("embedded Rust corpus trace {trace} passed"))
            .collect(),
    })
}

/// Replays the canonical FOLLOW corpus inside the compiled client and emits the
/// exact adversarial scenario vocabulary required by an installed promotion.
pub fn promotion_follow_conformance() -> Result<BTreeMap<String, PromotionFollowScenario>, String> {
    let source = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../cloudflare/packages/contracts/conformance/desktop-social-loop-follow.json"
    ));
    let corpus: FollowCorpus = serde_json::from_str(source)
        .map_err(|_| "embedded FOLLOW conformance corpus is invalid".to_string())?;
    if corpus.profile != "desktop-social-loop@1" || corpus.operation != "followConversation" {
        return Err("embedded FOLLOW conformance identity is invalid".to_string());
    }
    let mut passed = BTreeSet::new();
    for trace in corpus.traces {
        let trace_name = trace.name;
        let mut state = FollowState::new(trace.initial_pagination_high_water);
        for step in trace.steps {
            match step {
                FollowStep::Frame { frame, expected } => {
                    let reduction = reduce_follow_frame(&state, frame);
                    state = reduction.state;
                    verify_expected(
                        &trace_name,
                        &state,
                        reduction.effect.trace_name(),
                        &expected,
                    )?;
                }
                FollowStep::Confirm {
                    through_cursor,
                    expected,
                } => {
                    let confirmation = confirm_follow_batch(&state, through_cursor);
                    state = confirmation.state;
                    verify_expected(
                        &trace_name,
                        &state,
                        if confirmation.ack.is_some() {
                            "ack"
                        } else {
                            "none"
                        },
                        &expected,
                    )?;
                }
            }
        }
        if !passed.insert(trace_name) {
            return Err("embedded FOLLOW conformance trace is duplicated".to_string());
        }
    }

    let specifications = [
        ("snapshot", "vert", &["catch-up-confirm-ready"][..]),
        (
            "pagination-concurrente",
            "vert",
            &["duplicate-and-live-batches-converge"][..],
        ),
        (
            "changements-avant-ready",
            "vert",
            &[
                "catch-up-confirm-ready",
                "ready-before-confirmation-is-protocol-violation",
            ][..],
        ),
        (
            "doublon-exact",
            "ignore",
            &["exact-duplicate-is-not-reapplied"][..],
        ),
        ("trou", "resync", &["cursor-gap-requires-resync"][..]),
        (
            "divergence",
            "resync",
            &["cursor-divergence-requires-resync"][..],
        ),
        (
            "crash-avant-ack",
            "rejoue",
            &[
                "batch-while-pending-requires-resync",
                "exact-duplicate-is-not-reapplied",
            ][..],
        ),
        (
            "crash-apres-ack",
            "ne-rejoue-pas",
            &[
                "exact-duplicate-is-not-reapplied",
                "confirm-mismatch-requires-resync",
            ][..],
        ),
        (
            "resync",
            "vert",
            &[
                "resync-frame-in-live-requires-resync",
                "resync-history-required-in-catching-up",
            ][..],
        ),
        ("terminal", "vert", &["terminal-archive-purges-follow"][..]),
    ];
    specifications
        .into_iter()
        .map(|(name, outcome, traces)| {
            scenario(&passed, outcome, traces).map(|result| (name.to_string(), result))
        })
        .collect()
}

struct FixedClock(SystemTime);

impl CeremonyClock for FixedClock {
    fn now(&self) -> SystemTime {
        self.0
    }
}

struct AdjustableClock(Mutex<SystemTime>);

impl CeremonyClock for AdjustableClock {
    fn now(&self) -> SystemTime {
        self.0
            .lock()
            .map(|time| *time)
            .unwrap_or(SystemTime::UNIX_EPOCH)
    }
}

impl AdjustableClock {
    fn advance(&self, duration: Duration) -> Result<(), String> {
        let mut time = self
            .0
            .lock()
            .map_err(|_| "promotion authentication clock is unavailable".to_string())?;
        *time += duration;
        Ok(())
    }
}

struct PromotionPersistence {
    destroyed: Mutex<bool>,
    reject_persist: bool,
}

impl SessionPersistence for PromotionPersistence {
    fn persist(&self, _: &SessionSecret, _: &SessionMetadata) -> Result<(), String> {
        if self.reject_persist {
            Err("simulated crash before confirmation".to_string())
        } else {
            Ok(())
        }
    }

    fn load(&self) -> Result<Option<(SessionSecret, SessionMetadata)>, String> {
        Ok(None)
    }

    fn destroy(&self) -> Result<(), String> {
        let mut destroyed = self
            .destroyed
            .lock()
            .map_err(|_| "promotion persistence lock is unavailable".to_string())?;
        *destroyed = true;
        Ok(())
    }
}

struct PromotionQueue(Mutex<Vec<PendingRevocation>>);

impl RevocationQueue for PromotionQueue {
    fn enqueue(&self, pending: PendingRevocation) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|_| "promotion revocation queue is unavailable".to_string())?
            .push(pending);
        Ok(())
    }
}

struct ImmediateWake;

impl Wake for ImmediateWake {
    fn wake(self: Arc<Self>) {}
}

fn run_immediate<F: Future>(future: F) -> Result<F::Output, String> {
    let waker = Waker::from(Arc::new(ImmediateWake));
    let mut context = Context::from_waker(&waker);
    let mut future = Box::pin(future);
    match future.as_mut().poll(&mut context) {
        Poll::Ready(value) => Ok(value),
        Poll::Pending => Err("promotion authentication self-check suspended".to_string()),
    }
}

fn auth_result(outcome: &str, observation: impl Into<String>) -> PromotionAuthScenario {
    PromotionAuthScenario {
        outcome: outcome.to_string(),
        observations: vec![observation.into()],
    }
}

fn insert_auth(
    scenarios: &mut BTreeMap<String, PromotionAuthScenario>,
    name: impl Into<String>,
    result: PromotionAuthScenario,
) -> Result<(), String> {
    if scenarios.insert(name.into(), result).is_some() {
        return Err("promotion authentication scenario is duplicated".to_string());
    }
    Ok(())
}

/// Exercises the closed authentication, renewal and offline-sign-out invariants
/// inside the compiled native client without exposing any credential.
pub fn promotion_auth_conformance() -> Result<BTreeMap<String, PromotionAuthScenario>, String> {
    let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);
    let mut scenarios = BTreeMap::new();
    for provider in ["google", "github"] {
        let mut ceremony = Ceremony::new(Arc::new(FixedClock(now)));
        ceremony.start(provider)?;
        ceremony
            .browser_complete("staging", "staging")
            .map_err(|failure| failure.code().to_string())?;
        ceremony
            .ready()
            .map_err(|failure| failure.code().to_string())?;
        ceremony
            .begin_delivery()
            .map_err(|failure| failure.code().to_string())?;
        ceremony
            .confirm("70000000-0000-8000-8000-000000000058")
            .map_err(|failure| failure.code().to_string())?;
        if !matches!(ceremony.phase(), CeremonyPhase::Confirmed { .. }) {
            return Err("promotion authentication did not confirm".to_string());
        }
        insert_auth(
            &mut scenarios,
            format!("{provider}-succes"),
            auth_result("vert", format!("compiled {provider} ceremony confirmed")),
        )?;

        let mut cancelled = Ceremony::new(Arc::new(FixedClock(now)));
        cancelled.start(provider)?;
        cancelled.cancel()?;
        if cancelled.phase() != &CeremonyPhase::Cancelled {
            return Err("promotion authentication cancellation diverged".to_string());
        }
        insert_auth(
            &mut scenarios,
            format!("{provider}-annulation"),
            auth_result("vert", format!("compiled {provider} ceremony cancelled")),
        )?;
    }

    let mut retired = Ceremony::new(Arc::new(FixedClock(now)));
    if retired.start("passkey").is_ok() || retired.phase() != &CeremonyPhase::Idle {
        return Err("promotion authentication accepted the retired method".to_string());
    }
    insert_auth(
        &mut scenarios,
        "passkey-retiree",
        auth_result(
            "refuse",
            "compiled ceremony rejects retired passkey before starting",
        ),
    )?;

    let mut wrong_origin = Ceremony::new(Arc::new(FixedClock(now)));
    wrong_origin.start("github")?;
    if wrong_origin.browser_complete("local", "staging") != Err(CeremonyFailure::InvalidOrigin) {
        return Err("promotion authentication accepted another origin".to_string());
    }
    insert_auth(
        &mut scenarios,
        "mauvaise-origine",
        auth_result("refuse", "compiled ceremony rejected a foreign environment"),
    )?;

    let mut replay = Ceremony::new(Arc::new(FixedClock(now)));
    replay.start("google")?;
    replay
        .browser_complete("staging", "staging")
        .map_err(|failure| failure.code().to_string())?;
    replay
        .ready()
        .map_err(|failure| failure.code().to_string())?;
    replay
        .begin_delivery()
        .map_err(|failure| failure.code().to_string())?;
    replay
        .confirm("70000000-0000-8000-8000-000000000058")
        .map_err(|failure| failure.code().to_string())?;
    if replay.browser_complete("staging", "staging") != Err(CeremonyFailure::InvalidDeliveryToken) {
        return Err("promotion authentication accepted a replayed deeplink".to_string());
    }
    insert_auth(
        &mut scenarios,
        "deeplink-rejoue",
        auth_result(
            "refuse",
            "compiled ceremony rejected terminal deeplink replay",
        ),
    )?;

    let clock = Arc::new(AdjustableClock(Mutex::new(now)));
    let mut expiring = Ceremony::new(clock.clone());
    expiring.start("google")?;
    clock.advance(CEREMONY_START_TTL + Duration::from_secs(1))?;
    if !expiring.expire_if_due() || expiring.phase() != &CeremonyPhase::Expired {
        return Err("promotion authentication did not expire".to_string());
    }
    insert_auth(
        &mut scenarios,
        "expiration",
        auth_result("expire", "compiled ceremony expired after its closed TTL"),
    )?;

    let persistence = PromotionPersistence {
        destroyed: Mutex::new(false),
        reject_persist: true,
    };
    let mut quarantine = QuarantineJar::new();
    quarantine.deposit(SessionSecret::from_cookie_header(
        "__Host-punks_session=promotion-secret-never-serialized",
    ));
    let metadata = SessionMetadata {
        session_id: "70000000-0000-8000-8000-000000000058".to_string(),
        punk_id: "80000000-0000-8000-8000-000000000058".to_string(),
        expires_at: now + Duration::from_secs(30 * 24 * 3_600),
        last_renewed_at: None,
    };
    if quarantine
        .validate_and_persist(&persistence, &metadata)
        .is_ok()
        || !quarantine.is_empty()
    {
        return Err("promotion quarantine survived a failed persistence".to_string());
    }
    insert_auth(
        &mut scenarios,
        "crash-livraison-avant-confirmation",
        auth_result(
            "reprenable",
            "compiled quarantine discarded an unconfirmed Session",
        ),
    )?;

    let policy = RenewalPolicy;
    if !policy.should_renew(
        now,
        now + Duration::from_secs(6 * 24 * 3_600),
        Some(now - RENEWAL_MIN_INTERVAL - Duration::from_secs(1)),
    ) || policy.should_renew(now, now + RENEWAL_THRESHOLD, None)
    {
        return Err("promotion renewal policy diverged".to_string());
    }
    insert_auth(
        &mut scenarios,
        "renouvellement",
        auth_result("borne", "compiled renewal respected threshold and interval"),
    )?;

    let offline_persistence = PromotionPersistence {
        destroyed: Mutex::new(false),
        reject_persist: false,
    };
    let queue = PromotionQueue(Mutex::new(Vec::new()));
    let capability = RevocationCapability {
        secret: RevocationSecret::from_token(&"r".repeat(64))
            .map_err(|_| "promotion revocation capability is invalid".to_string())?,
        expires_at: metadata.expires_at,
    };
    let outcome = run_immediate(logout_local_first(
        &offline_persistence,
        &queue,
        &metadata,
        capability,
        |_| Box::pin(async { Err(()) }),
    ))??;
    let destroyed = *offline_persistence
        .destroyed
        .lock()
        .map_err(|_| "promotion persistence lock is unavailable".to_string())?;
    let queued = queue
        .0
        .lock()
        .map_err(|_| "promotion revocation queue is unavailable".to_string())?
        .len();
    if !destroyed || queued != 1 || outcome != LogoutOutcome::Queued {
        return Err("promotion offline sign-out did not fail closed".to_string());
    }
    insert_auth(
        &mut scenarios,
        "deconnexion-hors-ligne",
        auth_result(
            "mise-en-file",
            "compiled sign-out destroyed local state before queued revocation",
        ),
    )?;
    Ok(scenarios)
}
