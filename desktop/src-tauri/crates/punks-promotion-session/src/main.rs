use std::io::{self, Read};
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "punks-desktop-staging";
const SESSION_KEY: &str = "account-state-v1";
const ACCOUNT_STATE_VERSION: &str = "account-state-v1";
const MAX_BUNDLE_BYTES: u64 = 16 * 1024;

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct StoredSessionMetadata {
    session_id: String,
    punk_id: String,
    expires_at_seconds: u64,
    last_renewed_at_seconds: Option<u64>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
struct StoredSession {
    cookie: String,
    metadata: StoredSessionMetadata,
    revoke_capability: String,
    revoke_expires_at_seconds: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountState<'a> {
    version: &'static str,
    active_session: ActiveSession<'a>,
    pending_auth_flow: Option<()>,
    staged_activation: Option<()>,
    pending_renewal: Option<()>,
    revocation_queue: [(); 0],
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ActiveSession<'a> {
    cookie: &'a str,
    metadata: SessionMetadata<'a>,
    revoke_capability: &'a str,
    revoke_expires_at_seconds: u64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionMetadata<'a> {
    session_id: &'a str,
    punk_id: &'a str,
    expires_at_seconds: u64,
    last_renewed_at_seconds: Option<u64>,
}

fn validate_opaque(value: &str, name: &str) -> Result<(), String> {
    let parsed =
        uuid::Uuid::parse_str(value).map_err(|_| format!("{name} is not a canonical UUID"))?;
    if parsed.to_string() != value {
        return Err(format!("{name} is not a bounded opaque identifier"));
    }
    Ok(())
}

fn parse_bundle(input: &[u8], now_seconds: u64) -> Result<StoredSession, String> {
    if input.is_empty() || input.len() as u64 > MAX_BUNDLE_BYTES {
        return Err("promotion session bundle has an invalid size".to_string());
    }
    let stored: StoredSession = serde_json::from_slice(input)
        .map_err(|_| "promotion session bundle is not the exact JSON shape".to_string())?;
    let token = stored
        .cookie
        .strip_prefix("__Host-punks_session=")
        .ok_or_else(|| "only a staging __Host-punks_session cookie is accepted".to_string())?;
    if token.len() < 32
        || token.len() > 4096
        || token.chars().any(|character| {
            character.is_control() || character == ';' || character.is_whitespace()
        })
    {
        return Err("promotion session cookie is malformed".to_string());
    }
    validate_opaque(&stored.metadata.session_id, "session_id")?;
    validate_opaque(&stored.metadata.punk_id, "punk_id")?;
    if stored.metadata.expires_at_seconds <= now_seconds.saturating_add(300) {
        return Err("promotion session expires too soon".to_string());
    }
    if stored
        .metadata
        .last_renewed_at_seconds
        .is_some_and(|renewed| renewed > stored.metadata.expires_at_seconds)
    {
        return Err("promotion session renewal is after expiry".to_string());
    }
    if !(43..=128).contains(&stored.revoke_capability.len())
        || !stored
            .revoke_capability
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        || stored.revoke_expires_at_seconds < stored.metadata.expires_at_seconds
    {
        return Err("promotion revoke-only capability is invalid".to_string());
    }
    Ok(stored)
}

fn account_state(stored: &StoredSession) -> AccountState<'_> {
    AccountState {
        version: ACCOUNT_STATE_VERSION,
        active_session: ActiveSession {
            cookie: &stored.cookie,
            metadata: SessionMetadata {
                session_id: &stored.metadata.session_id,
                punk_id: &stored.metadata.punk_id,
                expires_at_seconds: stored.metadata.expires_at_seconds,
                last_renewed_at_seconds: stored.metadata.last_renewed_at_seconds,
            },
            revoke_capability: &stored.revoke_capability,
            revoke_expires_at_seconds: stored.revoke_expires_at_seconds,
        },
        pending_auth_flow: None,
        staged_activation: None,
        pending_renewal: None,
        revocation_queue: [],
    }
}

fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, SESSION_KEY).map_err(|error| error.to_string())
}

fn install() -> Result<(), String> {
    let mut input = Vec::new();
    io::stdin()
        .take(MAX_BUNDLE_BYTES + 1)
        .read_to_end(&mut input)
        .map_err(|_| "promotion session bundle could not be read".to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "system clock is before the Unix epoch".to_string())?
        .as_secs();
    let stored = parse_bundle(&input, now)?;
    let canonical = serde_json::to_string(&account_state(&stored))
        .map_err(|_| "promotion session bundle could not be normalized".to_string())?;
    entry()?
        .set_password(&canonical)
        .map_err(|error| error.to_string())?;
    let persisted = entry()?.get_password().map_err(|error| error.to_string())?;
    if persisted != canonical {
        return Err("promotion session disappeared after secure storage write".to_string());
    }
    println!("staging promotion session installed in the operating-system credential store");
    Ok(())
}

fn destroy() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            println!(
                "staging promotion session removed from the operating-system credential store"
            );
            Ok(())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn main() {
    let result = match std::env::args().skip(1).collect::<Vec<_>>().as_slice() {
        [] => install(),
        [mode] if mode == "--destroy" => destroy(),
        _ => Err("usage: punks-promotion-session [--destroy]".to_string()),
    };
    if let Err(error) = result {
        eprintln!("promotion session rejected: {error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_bundle() -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "cookie": format!("__Host-punks_session={}", "a".repeat(48)),
            "metadata": {
                "session_id": "d9428888-122b-4d9b-8f03-1a1127e667b8",
                "punk_id": "8f1d6a52-9c3e-4b7d-a5f1-2e8b0c4d6a9b",
                "expires_at_seconds": 10_000,
                "last_renewed_at_seconds": 5_000
            },
            "revoke_capability": "r".repeat(64),
            "revoke_expires_at_seconds": 10_000
        }))
        .expect("test bundle")
    }

    #[test]
    fn accepts_only_one_fresh_staging_session_shape() {
        let parsed = parse_bundle(&valid_bundle(), 1_000).expect("fresh bundle");
        assert_eq!(
            parsed.metadata.session_id,
            "d9428888-122b-4d9b-8f03-1a1127e667b8"
        );
        let credential = serde_json::to_value(account_state(&parsed)).expect("account state");
        assert_eq!(credential["version"], "account-state-v1");
        assert_eq!(
            credential["activeSession"]["metadata"]["sessionId"],
            "d9428888-122b-4d9b-8f03-1a1127e667b8"
        );
        assert_eq!(credential["pendingAuthFlow"], serde_json::Value::Null);

        let mut with_unknown: serde_json::Value =
            serde_json::from_slice(&valid_bundle()).expect("test JSON");
        with_unknown["exportedBy"] = serde_json::json!("renderer");
        assert!(parse_bundle(
            &serde_json::to_vec(&with_unknown).expect("test JSON"),
            1_000
        )
        .is_err());
    }

    #[test]
    fn rejects_wrong_cookie_scope_and_expiring_credentials() {
        let mut wrong_scope: serde_json::Value =
            serde_json::from_slice(&valid_bundle()).expect("test JSON");
        wrong_scope["cookie"] = serde_json::json!(format!("punks_session_dev={}", "b".repeat(48)));
        assert!(
            parse_bundle(&serde_json::to_vec(&wrong_scope).expect("test JSON"), 1_000).is_err()
        );

        assert!(parse_bundle(&valid_bundle(), 9_900).is_err());
    }
}
