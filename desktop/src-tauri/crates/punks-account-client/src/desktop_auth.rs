//! Client natif des contrats fermés de la Cérémonie de connexion desktop.
//!
//! Le navigateur système ne reçoit jamais la Session desktop. Rust génère et
//! conserve le vérificateur natif, réclame une livraison idempotente, valide
//! le cookie dans un jar de quarantaine puis confirme explicitement le flow.

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ORIGIN};
use reqwest::Method;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::ceremony::{
    AuthenticationMethod, CompiledPunksEnvironment, NativeVerifier, PendingAuthIntent,
    PendingAuthPhase, RevocationCapability, RevocationSecret, SessionMetadata, SessionSecret,
};
use crate::contracts_profile as contracts;
use crate::failure::{ClientFailure, FailureKind};

const SESSION_COOKIE_PREFIX: &str = "__Host-punks_session=";
const LOCAL_SESSION_COOKIE_PREFIX: &str = "punks_session_dev=";

/// Server-selected coordinates of a newly started native flow.
pub struct DesktopAuthStart {
    pub flow_id: String,
    pub intent: PendingAuthIntent,
    pub method: AuthenticationMethod,
    pub browser_url: String,
    pub created_at: SystemTime,
    pub expires_at: SystemTime,
}

/// Closed recovery decision returned with a flow status.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopAuthDecision {
    pub old_session_usable: bool,
    pub revoke_prepared_session: bool,
    pub destroy_workspace_context: bool,
    pub retry_same_request: bool,
    pub fresh_human_action_required: bool,
}

/// Closed result class shared by Worker, Rust and TypeScript.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DesktopAuthResult {
    Success,
    HumanActionRequired,
    SecurityFailure,
    TransientInterruption,
}

/// Non-secret native projection of `desktop-auth.status@1`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DesktopAuthStatus {
    pub flow_id: String,
    pub phase: PendingAuthPhase,
    pub terminal: bool,
    pub expires_at: SystemTime,
    pub result: DesktopAuthResult,
    pub outcome_code: Option<String>,
    pub decision: DesktopAuthDecision,
}

/// Idempotently claimed Session held in the native quarantine boundary.
pub struct ClaimedSession {
    pub flow_id: String,
    pub delivery_id: String,
    pub metadata: SessionMetadata,
    pub cookie: SessionSecret,
    pub revocation: RevocationCapability,
    pub delivery_expires_at: SystemTime,
}

/// Autorisation ponctuelle de réauthentification, sans cookie ni rotation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedReauthorization {
    pub flow_id: String,
    pub delivery_id: String,
    pub authorization_id: String,
    pub session_id: String,
    pub punk_id: String,
    pub target_method: String,
    pub workspace_ownership_transfer: Option<WorkspaceOwnershipTransferBinding>,
    pub handoff_id: String,
    pub expires_at: SystemTime,
    pub delivery_expires_at: SystemTime,
}

/// Exact domain coordinates sealed by an ownership-transfer reauthentication.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceOwnershipTransferBinding {
    pub workspace_id: String,
    pub target_punk_id: String,
    pub expected_revision: u64,
}

/// Non-secret coordinates used to start one native authentication flow.
#[derive(Debug, Clone, Copy)]
pub struct DesktopAuthStartIntent<'a> {
    pub intent: PendingAuthIntent,
    pub method: AuthenticationMethod,
    pub purpose: Option<&'a str>,
    pub authorization_id: Option<&'a str>,
    pub workspace_ownership_transfer: Option<&'a WorkspaceOwnershipTransferBinding>,
}

/// Les deux seules livraisons admises par `desktop-auth.claim@1`.
pub enum ClaimedDelivery {
    Session(ClaimedSession),
    Reauthorization(ClaimedReauthorization),
}

/// Terminal acknowledgement returned by `desktop-auth.confirm@1`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmedSession {
    pub flow_id: String,
    pub session_id: String,
    pub confirmed_at: SystemTime,
}

/// Prepared Session rotation awaiting secure-store reread and confirmation.
pub struct PreparedRenewal {
    pub command_id: String,
    pub rotation_id: String,
    pub metadata: SessionMetadata,
    pub cookie: SessionSecret,
    pub revocation: RevocationCapability,
    pub confirm_by: SystemTime,
}

/// Native-only HTTP client for the seven closed desktop auth contracts.
#[derive(Clone)]
pub struct DesktopAuthClient {
    http: reqwest::Client,
    origin: String,
    environment: CompiledPunksEnvironment,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionEnvelope {
    session: contracts::AuthSession,
}

fn transport_failure(message: &str) -> ClientFailure {
    ClientFailure::new(FailureKind::Transport, message)
}

fn contract_failure(contract: &str) -> ClientFailure {
    ClientFailure::new(
        FailureKind::ContractViolation,
        format!("Punks response violated {contract}"),
    )
}

fn status_failure(status: u16) -> ClientFailure {
    let kind = match status {
        401 => FailureKind::SessionExpired,
        408 | 425 | 429 | 500..=599 => FailureKind::Transport,
        _ => FailureKind::Problem,
    };
    ClientFailure::new(
        kind,
        format!("Punks desktop authentication failed ({status})"),
    )
}

pub(crate) fn parse_iso8601(value: &str) -> Result<SystemTime, ClientFailure> {
    let bytes = value.as_bytes();
    let fractional_millis = match bytes.len() {
        20 if bytes[19] == b'Z' => 0,
        24 if bytes[19] == b'.'
            && bytes[23] == b'Z'
            && bytes[20..23].iter().all(u8::is_ascii_digit) =>
        {
            value
                .get(20..23)
                .and_then(|part| part.parse::<u64>().ok())
                .ok_or_else(|| transport_failure("invalid Punks timestamp"))?
        }
        _ => return Err(transport_failure("invalid Punks timestamp")),
    };
    if bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
    {
        return Err(transport_failure("invalid Punks timestamp"));
    }
    let parse = |range: std::ops::Range<usize>| {
        value
            .get(range)
            .and_then(|part| part.parse::<u64>().ok())
            .ok_or_else(|| transport_failure("invalid Punks timestamp"))
    };
    let year = parse(0..4)? as i64;
    let month = parse(5..7)?;
    let day = parse(8..10)?;
    let hour = parse(11..13)?;
    let minute = parse(14..16)?;
    let second = parse(17..19)?;
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => 0,
    };
    if year < 1970 || day == 0 || day > max_day || hour > 23 || minute > 59 || second > 59 {
        return Err(transport_failure("invalid Punks timestamp"));
    }
    let adjusted_year = year - i64::from(month <= 2);
    let era = adjusted_year.div_euclid(400);
    let yoe = adjusted_year - era * 400;
    let mp = month as i64 + if month > 2 { -3 } else { 9 };
    let doy = (153 * mp + 2) / 5 + day as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let epoch_days = era * 146_097 + doe - 719_468;
    let seconds = epoch_days
        .checked_mul(86_400)
        .and_then(|total| total.checked_add((hour as i64) * 3_600))
        .and_then(|total| total.checked_add((minute as i64) * 60))
        .and_then(|total| total.checked_add(second as i64))
        .filter(|total| *total >= 0)
        .ok_or_else(|| transport_failure("Punks timestamp is outside supported range"))?;
    UNIX_EPOCH
        .checked_add(Duration::from_secs(seconds as u64))
        .and_then(|time| time.checked_add(Duration::from_millis(fractional_millis)))
        .ok_or_else(|| transport_failure("Punks timestamp is outside supported range"))
}

fn validate_uuid(value: &str, contract: &str) -> Result<(), ClientFailure> {
    let parsed = uuid::Uuid::parse_str(value).map_err(|_| contract_failure(contract))?;
    if parsed.to_string() != value {
        return Err(contract_failure(contract));
    }
    Ok(())
}

fn claim_metadata(
    session: &contracts::DesktopAuthClaimExchangeSession,
) -> Result<SessionMetadata, ClientFailure> {
    validate_uuid(&session.session_id, "desktop-auth.claim@1")?;
    validate_uuid(&session.punk_id, "desktop-auth.claim@1")?;
    let _ = parse_iso8601(&session.authenticated_at)?;
    if let Some(recent) = session.recent_reauth_until.as_deref() {
        let _ = parse_iso8601(recent)?;
    }
    Ok(SessionMetadata {
        session_id: session.session_id.clone(),
        punk_id: session.punk_id.clone(),
        expires_at: parse_iso8601(&session.expires_at)?,
        last_renewed_at: None,
    })
}

fn renewal_metadata(
    session: &contracts::DesktopSessionRenewExchangeSession,
    renewed_at: SystemTime,
) -> Result<SessionMetadata, ClientFailure> {
    validate_uuid(&session.session_id, "desktop-session.renew@1")?;
    validate_uuid(&session.punk_id, "desktop-session.renew@1")?;
    let _ = parse_iso8601(&session.authenticated_at)?;
    if let Some(recent) = session.recent_reauth_until.as_deref() {
        let _ = parse_iso8601(recent)?;
    }
    Ok(SessionMetadata {
        session_id: session.session_id.clone(),
        punk_id: session.punk_id.clone(),
        expires_at: parse_iso8601(&session.expires_at)?,
        last_renewed_at: Some(renewed_at),
    })
}

impl DesktopAuthClient {
    /// Builds a client pinned to the compiled Punks origin and environment.
    pub fn new(origin: &str) -> Result<Self, ClientFailure> {
        let environment = CompiledPunksEnvironment::current()
            .map_err(|_| transport_failure("unknown compiled Punks environment"))?;
        let parsed = reqwest::Url::parse(origin)
            .map_err(|_| transport_failure("invalid compiled Punks origin"))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || (environment != CompiledPunksEnvironment::Local && parsed.scheme() != "https")
        {
            return Err(transport_failure("invalid compiled Punks origin"));
        }
        Ok(Self {
            http: reqwest::Client::builder()
                .build()
                .map_err(|_| transport_failure("native authentication client unavailable"))?,
            origin: parsed.to_string().trim_end_matches('/').to_string(),
            environment,
        })
    }

    fn headers(&self, cookie: Option<&SessionSecret>) -> Result<HeaderMap, ClientFailure> {
        let mut headers = HeaderMap::new();
        headers.insert(
            ORIGIN,
            HeaderValue::from_str(&self.origin)
                .map_err(|_| transport_failure("invalid compiled Punks origin"))?,
        );
        headers.insert(
            HeaderName::from_static("sec-punks-desktop-environment"),
            HeaderValue::from_static(self.environment.as_str()),
        );
        if let Some(secret) = cookie {
            headers.insert(
                HeaderName::from_static("cookie"),
                HeaderValue::from_str(secret.raw())
                    .map_err(|_| contract_failure("desktop-session cookie"))?,
            );
        }
        Ok(headers)
    }

    async fn post<R: DeserializeOwned>(
        &self,
        path: &str,
        body: &impl Serialize,
        cookie: Option<&SessionSecret>,
    ) -> Result<(HeaderMap, R), ClientFailure> {
        let response = self
            .http
            .request(Method::POST, format!("{}{}", self.origin, path))
            .headers(self.headers(cookie)?)
            .json(body)
            .send()
            .await
            .map_err(|_| transport_failure("native authentication request failed"))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(status_failure(status));
        }
        let headers = response.headers().clone();
        let payload = response
            .json::<R>()
            .await
            .map_err(|_| contract_failure("desktop authentication response"))?;
        Ok((headers, payload))
    }

    /// Starts one explicit human intent using only the verifier commitment.
    pub async fn start(
        &self,
        input: DesktopAuthStartIntent<'_>,
        verifier: &NativeVerifier,
        current_cookie: Option<&SessionSecret>,
    ) -> Result<DesktopAuthStart, ClientFailure> {
        let DesktopAuthStartIntent {
            intent,
            method,
            purpose,
            authorization_id,
            workspace_ownership_transfer,
        } = input;
        if (purpose == Some("transfer_workspace_ownership"))
            != workspace_ownership_transfer.is_some()
        {
            return Err(contract_failure("desktop-auth.start@1"));
        }
        let workspace_ownership_transfer = workspace_ownership_transfer
            .map(|binding| {
                validate_uuid(&binding.workspace_id, "desktop-auth.start@1")?;
                validate_uuid(&binding.target_punk_id, "desktop-auth.start@1")?;
                if binding.expected_revision == 0 {
                    return Err(contract_failure("desktop-auth.start@1"));
                }
                Ok(
                    contracts::DesktopAuthStartExchangeWorkspaceOwnershipTransfer {
                        workspace_id: binding.workspace_id.clone(),
                        target_punk_id: binding.target_punk_id.clone(),
                        expected_revision: binding.expected_revision,
                    },
                )
            })
            .transpose()?;
        let request = contracts::DesktopAuthStartRequest {
            contract: "desktop-auth.start@1".to_string(),
            message: "request".to_string(),
            intent: start_intent(intent),
            method: start_method(method),
            verifier_commitment: verifier.commitment(),
            purpose: purpose.map(start_purpose).transpose()?,
            authorization_id: authorization_id.map(str::to_string),
            workspace_ownership_transfer,
        };
        let (_, response): (_, contracts::DesktopAuthStartResponse) = self
            .post("/api/auth/v1/desktop/start", &request, current_cookie)
            .await?;
        validate_uuid(&response.flow_id, "desktop-auth.start@1")?;
        let browser_url = reqwest::Url::parse(&response.browser_url)
            .map_err(|_| contract_failure("desktop-auth.start@1"))?;
        let expected_origin = reqwest::Url::parse(&self.origin)
            .map_err(|_| contract_failure("desktop-auth.start@1"))?;
        if browser_url.origin() != expected_origin.origin()
            || !browser_url.username().is_empty()
            || browser_url.password().is_some()
        {
            return Err(contract_failure("desktop-auth.start@1"));
        }
        let response_intent = response_intent(response.intent);
        let response_method = response_method(response.method);
        if response_intent != intent || response_method != method {
            return Err(contract_failure("desktop-auth.start@1"));
        }
        Ok(DesktopAuthStart {
            flow_id: response.flow_id,
            intent: response_intent,
            method: response_method,
            browser_url: browser_url.to_string(),
            created_at: parse_iso8601(&response.created_at)?,
            expires_at: parse_iso8601(&response.expires_at)?,
        })
    }

    /// Reads the recoverable public phase without claiming its result.
    pub async fn status(
        &self,
        flow_id: &str,
        verifier: &NativeVerifier,
    ) -> Result<DesktopAuthStatus, ClientFailure> {
        validate_uuid(flow_id, "desktop-auth.status@1")?;
        let request = contracts::DesktopAuthStatusRequest {
            contract: "desktop-auth.status@1".to_string(),
            message: "request".to_string(),
            flow_id: flow_id.to_string(),
            verifier_commitment: verifier.commitment(),
        };
        let (_, response): (_, contracts::DesktopAuthStatusResponse) = self
            .post("/api/auth/v1/desktop/status", &request, None)
            .await?;
        if response.flow_id != flow_id {
            return Err(contract_failure("desktop-auth.status@1"));
        }
        Ok(DesktopAuthStatus {
            flow_id: response.flow_id,
            phase: status_phase(response.phase),
            terminal: response.terminal,
            expires_at: parse_iso8601(&response.expires_at)?,
            result: status_result(response.result),
            outcome_code: response.outcome_code.map(status_outcome_code),
            decision: DesktopAuthDecision {
                old_session_usable: response.decision.old_session_usable,
                revoke_prepared_session: response.decision.revoke_prepared_session,
                destroy_workspace_context: response.decision.destroy_workspace_context,
                retry_same_request: response.decision.retry_same_request,
                fresh_human_action_required: response.decision.fresh_human_action_required,
            },
        })
    }

    /// Claims or replays the exact delivery bound to the native verifier.
    pub async fn claim(
        &self,
        flow_id: &str,
        verifier: &NativeVerifier,
    ) -> Result<ClaimedDelivery, ClientFailure> {
        validate_uuid(flow_id, "desktop-auth.claim@1")?;
        let request = contracts::DesktopAuthClaimRequest {
            contract: "desktop-auth.claim@1".to_string(),
            message: "request".to_string(),
            delivery_kind: "request".to_string(),
            flow_id: flow_id.to_string(),
            verifier: verifier.encoded(),
        };
        let (headers, exchange): (_, contracts::DesktopAuthClaimExchange) = self
            .post("/api/auth/v1/desktop/claim", &request, None)
            .await?;
        match exchange {
            contracts::DesktopAuthClaimExchange::SessionResponse(response) => {
                if response.flow_id != flow_id {
                    return Err(contract_failure("desktop-auth.claim@1"));
                }
                validate_uuid(&response.delivery_id, "desktop-auth.claim@1")?;
                Ok(ClaimedDelivery::Session(ClaimedSession {
                    flow_id: response.flow_id,
                    delivery_id: response.delivery_id,
                    metadata: claim_metadata(&response.session)?,
                    cookie: extract_session_cookie(&headers)?,
                    revocation: RevocationCapability {
                        secret: RevocationSecret::from_token(&response.revoke_capability.token)
                            .map_err(|_| contract_failure("desktop-auth.claim@1"))?,
                        expires_at: parse_iso8601(&response.revoke_capability.expires_at)?,
                    },
                    delivery_expires_at: parse_iso8601(&response.delivery_expires_at)?,
                }))
            }
            contracts::DesktopAuthClaimExchange::ReauthorizationResponse(response) => {
                if response.flow_id != flow_id || contains_session_cookie(&headers) {
                    return Err(contract_failure("desktop-auth.claim@1"));
                }
                validate_uuid(&response.delivery_id, "desktop-auth.claim@1")?;
                validate_uuid(
                    &response.authorization.authorization_id,
                    "desktop-auth.claim@1",
                )?;
                validate_uuid(&response.authorization.session_id, "desktop-auth.claim@1")?;
                validate_uuid(&response.authorization.punk_id, "desktop-auth.claim@1")?;
                validate_uuid(&response.authorization.handoff_id, "desktop-auth.claim@1")?;
                let target_method = match response.authorization.target_method {
                    contracts::DesktopAuthClaimExchangeAuthorizationTargetMethod::LinkGoogle => {
                        "link_google"
                    }
                    contracts::DesktopAuthClaimExchangeAuthorizationTargetMethod::LinkGithub => {
                        "link_github"
                    }
                    contracts::DesktopAuthClaimExchangeAuthorizationTargetMethod::TransferWorkspaceOwnership => {
                        "transfer_workspace_ownership"
                    }
                };
                let workspace_ownership_transfer = response
                    .authorization
                    .workspace_ownership_transfer
                    .map(|binding| {
                        validate_uuid(&binding.workspace_id, "desktop-auth.claim@1")?;
                        validate_uuid(&binding.target_punk_id, "desktop-auth.claim@1")?;
                        if binding.expected_revision == 0 {
                            return Err(contract_failure("desktop-auth.claim@1"));
                        }
                        Ok(WorkspaceOwnershipTransferBinding {
                            workspace_id: binding.workspace_id,
                            target_punk_id: binding.target_punk_id,
                            expected_revision: binding.expected_revision,
                        })
                    })
                    .transpose()?;
                if (target_method == "transfer_workspace_ownership")
                    != workspace_ownership_transfer.is_some()
                {
                    return Err(contract_failure("desktop-auth.claim@1"));
                }
                Ok(ClaimedDelivery::Reauthorization(ClaimedReauthorization {
                    flow_id: response.flow_id,
                    delivery_id: response.delivery_id,
                    authorization_id: response.authorization.authorization_id,
                    session_id: response.authorization.session_id,
                    punk_id: response.authorization.punk_id,
                    target_method: target_method.to_string(),
                    workspace_ownership_transfer,
                    handoff_id: response.authorization.handoff_id,
                    expires_at: parse_iso8601(&response.authorization.expires_at)?,
                    delivery_expires_at: parse_iso8601(&response.delivery_expires_at)?,
                }))
            }
            contracts::DesktopAuthClaimExchange::Request(_) => {
                Err(contract_failure("desktop-auth.claim@1"))
            }
        }
    }

    /// Confirms a delivery only after native validation and durable reread.
    pub async fn confirm(
        &self,
        flow_id: &str,
        verifier: &NativeVerifier,
        delivery_id: &str,
    ) -> Result<ConfirmedSession, ClientFailure> {
        validate_uuid(flow_id, "desktop-auth.confirm@1")?;
        validate_uuid(delivery_id, "desktop-auth.confirm@1")?;
        let request = contracts::DesktopAuthConfirmRequest {
            contract: "desktop-auth.confirm@1".to_string(),
            message: "request".to_string(),
            flow_id: flow_id.to_string(),
            verifier: verifier.encoded(),
            delivery_id: delivery_id.to_string(),
        };
        let (_, response): (_, contracts::DesktopAuthConfirmResponse) = self
            .post("/api/auth/v1/desktop/confirm", &request, None)
            .await?;
        if response.flow_id != flow_id {
            return Err(contract_failure("desktop-auth.confirm@1"));
        }
        validate_uuid(&response.session_id, "desktop-auth.confirm@1")?;
        Ok(ConfirmedSession {
            flow_id: response.flow_id,
            session_id: response.session_id,
            confirmed_at: parse_iso8601(&response.confirmed_at)?,
        })
    }

    /// Cancels a nonterminal flow idempotently.
    pub async fn cancel(
        &self,
        flow_id: &str,
        verifier: &NativeVerifier,
    ) -> Result<(), ClientFailure> {
        validate_uuid(flow_id, "desktop-auth.cancel@1")?;
        let request = contracts::DesktopAuthCancelRequest {
            contract: "desktop-auth.cancel@1".to_string(),
            message: "request".to_string(),
            flow_id: flow_id.to_string(),
            verifier: verifier.encoded(),
        };
        let (_, response): (_, contracts::DesktopAuthCancelResponse) = self
            .post("/api/auth/v1/desktop/cancel", &request, None)
            .await?;
        if response.flow_id != flow_id {
            return Err(contract_failure("desktop-auth.cancel@1"));
        }
        let _ = parse_iso8601(&response.cancelled_at)?;
        Ok(())
    }

    /// Reads a prepared Session through the validation-only server seam.
    pub async fn validate(&self, cookie: &SessionSecret) -> Result<SessionMetadata, ClientFailure> {
        let response = self
            .http
            .request(Method::GET, format!("{}/api/auth/v1/session", self.origin))
            .headers(self.headers(Some(cookie))?)
            .send()
            .await
            .map_err(|_| transport_failure("prepared Session validation failed"))?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(status_failure(status));
        }
        let session = response
            .json::<SessionEnvelope>()
            .await
            .map_err(|_| contract_failure("auth.session@1"))?
            .session;
        validate_uuid(&session.session_id, "auth.session@1")?;
        validate_uuid(&session.punk_id, "auth.session@1")?;
        let _ = parse_iso8601(&session.authenticated_at)?;
        if let Some(recent) = session.recent_reauth_until.as_deref() {
            let _ = parse_iso8601(recent)?;
        }
        Ok(SessionMetadata {
            session_id: session.session_id,
            punk_id: session.punk_id,
            expires_at: parse_iso8601(&session.expires_at)?,
            last_renewed_at: None,
        })
    }

    /// Prepares, but does not activate, a bounded Session rotation.
    pub async fn prepare_renewal(
        &self,
        cookie: &SessionSecret,
        command_id: &str,
        now: SystemTime,
    ) -> Result<PreparedRenewal, ClientFailure> {
        validate_uuid(command_id, "desktop-session.renew@1")?;
        let request = contracts::DesktopSessionRenewPrepareRequest {
            contract: "desktop-session.renew@1".to_string(),
            message: "request".to_string(),
            action: "prepare".to_string(),
            command_id: command_id.to_string(),
        };
        let (headers, response): (_, contracts::DesktopSessionRenewPreparedResponse) = self
            .post("/api/auth/v1/desktop/session/renew", &request, Some(cookie))
            .await?;
        if response.command_id != command_id {
            return Err(contract_failure("desktop-session.renew@1"));
        }
        validate_uuid(&response.rotation_id, "desktop-session.renew@1")?;
        Ok(PreparedRenewal {
            command_id: response.command_id,
            rotation_id: response.rotation_id,
            metadata: renewal_metadata(&response.session, now)?,
            cookie: extract_session_cookie(&headers)?,
            revocation: RevocationCapability {
                secret: RevocationSecret::from_token(&response.revoke_capability.token)
                    .map_err(|_| contract_failure("desktop-session.renew@1"))?,
                expires_at: parse_iso8601(&response.revoke_capability.expires_at)?,
            },
            confirm_by: parse_iso8601(&response.confirm_by)?,
        })
    }

    /// Confirms a rotation already persisted and reread by native storage.
    pub async fn confirm_renewal(
        &self,
        cookie: &SessionSecret,
        command_id: &str,
        rotation_id: &str,
    ) -> Result<String, ClientFailure> {
        validate_uuid(command_id, "desktop-session.renew@1")?;
        validate_uuid(rotation_id, "desktop-session.renew@1")?;
        let request = contracts::DesktopSessionRenewConfirmRequest {
            contract: "desktop-session.renew@1".to_string(),
            message: "request".to_string(),
            action: "confirm".to_string(),
            command_id: command_id.to_string(),
            rotation_id: rotation_id.to_string(),
        };
        let (_, response): (_, contracts::DesktopSessionRenewConfirmedResponse) = self
            .post("/api/auth/v1/desktop/session/renew", &request, Some(cookie))
            .await?;
        if response.command_id != command_id || response.rotation_id != rotation_id {
            return Err(contract_failure("desktop-session.renew@1"));
        }
        validate_uuid(&response.session_id, "desktop-session.renew@1")?;
        let _ = parse_iso8601(&response.confirmed_at)?;
        Ok(response.session_id)
    }

    /// Exercises only the minimal revoke-only capability, without a cookie.
    pub async fn revoke(&self, capability: &RevocationSecret) -> Result<(), ClientFailure> {
        let request = contracts::DesktopSessionRevokeRequest {
            contract: "desktop-session.revoke@1".to_string(),
            message: "request".to_string(),
            capability: capability.raw().to_string(),
        };
        let (_, _): (_, contracts::DesktopSessionRevokeResponse) = self
            .post("/api/auth/v1/desktop/session/revoke", &request, None)
            .await?;
        Ok(())
    }
}

fn start_intent(value: PendingAuthIntent) -> contracts::DesktopAuthStartRequestIntent {
    match value {
        PendingAuthIntent::SignIn => contracts::DesktopAuthStartRequestIntent::SignIn,
        PendingAuthIntent::SwitchAccount => contracts::DesktopAuthStartRequestIntent::SwitchAccount,
        PendingAuthIntent::Reauthenticate => {
            contracts::DesktopAuthStartRequestIntent::Reauthenticate
        }
        PendingAuthIntent::LinkGoogle => contracts::DesktopAuthStartRequestIntent::LinkGoogle,
        PendingAuthIntent::LinkGithub => contracts::DesktopAuthStartRequestIntent::LinkGithub,
    }
}

fn start_method(value: AuthenticationMethod) -> contracts::DesktopAuthStartRequestMethod {
    match value {
        AuthenticationMethod::Google => contracts::DesktopAuthStartRequestMethod::Google,
        AuthenticationMethod::Github => contracts::DesktopAuthStartRequestMethod::Github,
    }
}

fn start_purpose(value: &str) -> Result<contracts::DesktopAuthStartRequestPurpose, ClientFailure> {
    match value {
        "link_google" => Ok(contracts::DesktopAuthStartRequestPurpose::LinkGoogle),
        "link_github" => Ok(contracts::DesktopAuthStartRequestPurpose::LinkGithub),
        "transfer_workspace_ownership" => {
            Ok(contracts::DesktopAuthStartRequestPurpose::TransferWorkspaceOwnership)
        }
        _ => Err(contract_failure("desktop-auth.start@1")),
    }
}

fn response_intent(value: contracts::DesktopAuthStartResponseIntent) -> PendingAuthIntent {
    match value {
        contracts::DesktopAuthStartResponseIntent::SignIn => PendingAuthIntent::SignIn,
        contracts::DesktopAuthStartResponseIntent::SwitchAccount => {
            PendingAuthIntent::SwitchAccount
        }
        contracts::DesktopAuthStartResponseIntent::Reauthenticate => {
            PendingAuthIntent::Reauthenticate
        }
        contracts::DesktopAuthStartResponseIntent::LinkGoogle => PendingAuthIntent::LinkGoogle,
        contracts::DesktopAuthStartResponseIntent::LinkGithub => PendingAuthIntent::LinkGithub,
    }
}

fn response_method(value: contracts::DesktopAuthStartResponseMethod) -> AuthenticationMethod {
    match value {
        contracts::DesktopAuthStartResponseMethod::Google => AuthenticationMethod::Google,
        contracts::DesktopAuthStartResponseMethod::Github => AuthenticationMethod::Github,
    }
}

fn status_phase(value: contracts::DesktopAuthStatusResponsePhase) -> PendingAuthPhase {
    match value {
        contracts::DesktopAuthStatusResponsePhase::Started => PendingAuthPhase::Started,
        contracts::DesktopAuthStatusResponsePhase::BrowserComplete => {
            PendingAuthPhase::BrowserComplete
        }
        contracts::DesktopAuthStatusResponsePhase::Ready => PendingAuthPhase::Ready,
        contracts::DesktopAuthStatusResponsePhase::Delivering => PendingAuthPhase::Delivering,
        contracts::DesktopAuthStatusResponsePhase::Confirmed => PendingAuthPhase::Confirmed,
        contracts::DesktopAuthStatusResponsePhase::Cancelled => PendingAuthPhase::Cancelled,
        contracts::DesktopAuthStatusResponsePhase::Expired => PendingAuthPhase::Expired,
    }
}

fn status_result(value: contracts::DesktopAuthStatusResponseResult) -> DesktopAuthResult {
    match value {
        contracts::DesktopAuthStatusResponseResult::Success => DesktopAuthResult::Success,
        contracts::DesktopAuthStatusResponseResult::HumanActionRequired => {
            DesktopAuthResult::HumanActionRequired
        }
        contracts::DesktopAuthStatusResponseResult::SecurityFailure => {
            DesktopAuthResult::SecurityFailure
        }
        contracts::DesktopAuthStatusResponseResult::TransientInterruption => {
            DesktopAuthResult::TransientInterruption
        }
    }
}

fn status_outcome_code(value: contracts::DesktopAuthStatusResponseOutcomeCode) -> String {
    use contracts::DesktopAuthStatusResponseOutcomeCode as Code;
    match value {
        Code::AccountCreated => "account_created",
        Code::AccountCreationConfirmationRequired => "account_creation_confirmation_required",
        Code::Authenticated => "authenticated",
        Code::Cancelled => "cancelled",
        Code::Expired => "expired",
        Code::LinkRequired => "link_required",
        Code::LinkPending => "link_pending",
        Code::Linked => "linked",
        Code::MergeRequired => "merge_required",
        Code::ProviderError => "provider_error",
        Code::Reauthenticated => "reauthenticated",
        Code::ReauthenticationFailed => "reauthentication_failed",
        Code::SessionExpired => "session_expired",
        Code::TemporarilyUnavailable => "temporarily_unavailable",
    }
    .to_string()
}

pub(crate) fn extract_session_cookie(headers: &HeaderMap) -> Result<SessionSecret, ClientFailure> {
    for value in headers.get_all(reqwest::header::SET_COOKIE) {
        let raw = value
            .to_str()
            .map_err(|_| contract_failure("desktop Session cookie"))?;
        for prefix in [SESSION_COOKIE_PREFIX, LOCAL_SESSION_COOKIE_PREFIX] {
            if let Some(rest) = raw.strip_prefix(prefix) {
                let token = rest.split(';').next().unwrap_or("").trim();
                if (32..=4_096).contains(&token.len())
                    && token
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
                {
                    return Ok(SessionSecret::from_cookie_header(&format!(
                        "{prefix}{token}"
                    )));
                }
            }
        }
    }
    Err(contract_failure("desktop Session cookie"))
}

fn contains_session_cookie(headers: &HeaderMap) -> bool {
    headers
        .get_all(reqwest::header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .any(|value| {
            value.starts_with(SESSION_COOKIE_PREFIX)
                || value.starts_with(LOCAL_SESSION_COOKIE_PREFIX)
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rfc3339_utc_parser_handles_calendar_boundaries_strictly() {
        for (value, expected) in [
            ("1970-01-01T00:00:00Z", 0),
            ("2000-02-29T12:34:56Z", 951_827_696),
            ("2026-01-15T01:02:03Z", 1_768_438_923),
            ("2026-08-23T01:00:00Z", 1_787_446_800),
        ] {
            assert_eq!(
                crate::ceremony::unix_seconds(parse_iso8601(value).expect("valid timestamp")),
                expected,
            );
        }
        assert_eq!(
            parse_iso8601("2026-08-23T01:00:00.123Z")
                .expect("worker timestamp with milliseconds")
                .duration_since(UNIX_EPOCH)
                .expect("after epoch")
                .as_millis(),
            1_787_446_800_123,
        );
        for invalid in [
            "not-a-date",
            "2026-02-29T12:00:00Z",
            "2024-02-30T12:00:00Z",
            "2026-01-01T24:00:00Z",
            "2026-01-01T00:60:00Z",
            "2026-01-01T00:00:60Z",
            "2026-01-01T00:00:00+01:00",
            "2026-01-01T00:00:00Zjunk",
            "2026-01-01T00:00:00.12Z",
        ] {
            assert!(parse_iso8601(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn generated_desktop_response_rejects_unknown_fields() {
        let value = serde_json::json!({
            "contract": "desktop-auth.start@1",
            "message": "response",
            "flowId": "d9428888-122b-4d9b-8f03-1a1127e667b8",
            "phase": "started",
            "intent": "sign_in",
            "method": "google",
            "browserUrl": "https://auth.punks.test/api/auth/v1/desktop/browser/example",
            "createdAt": "2026-08-25T00:00:00Z",
            "expiresAt": "2026-08-25T00:10:00Z",
            "unexpected": true
        });
        assert!(serde_json::from_value::<contracts::DesktopAuthStartResponse>(value).is_err());
    }

    #[test]
    fn cookie_extraction_accepts_only_the_native_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::SET_COOKIE,
            HeaderValue::from_static(
                "punks_session_dev=abcdefghijklmnopqrstuvwxyz012345; Path=/; Max-Age=3600",
            ),
        );
        let secret = extract_session_cookie(&headers).expect("local cookie");
        assert!(secret.raw().starts_with("punks_session_dev="));
        assert!(!format!("{secret:?}").contains("abcdefghijklmnopqrstuvwxyz012345"));

        let mut short = HeaderMap::new();
        short.insert(
            reqwest::header::SET_COOKIE,
            HeaderValue::from_static("__Host-punks_session=short; Path=/"),
        );
        assert!(extract_session_cookie(&short).is_err());
    }

    #[test]
    fn native_requests_carry_the_compiled_unforgeable_environment_header() {
        let client = DesktopAuthClient::new("https://auth.punks.test").expect("client");
        let headers = client.headers(None).expect("headers");
        assert_eq!(
            headers
                .get("sec-punks-desktop-environment")
                .and_then(|value| value.to_str().ok()),
            Some(client.environment.as_str())
        );
        assert_eq!(
            headers.get(ORIGIN).and_then(|value| value.to_str().ok()),
            Some("https://auth.punks.test")
        );
    }
}
