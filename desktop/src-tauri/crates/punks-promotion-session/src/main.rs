use std::io::{self, Read};
use std::time::{SystemTime, UNIX_EPOCH};

const SERVICE: &str = "punks-desktop-staging";
const SESSION_KEY: &str = "session-v1";
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
}

fn validate_opaque(value: &str, name: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || value.chars().any(|character| character.is_control())
    {
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
        || token
            .chars()
            .any(|character| character.is_control() || character == ';' || character.is_whitespace())
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
    Ok(stored)
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
    let canonical = serde_json::to_string(&stored)
        .map_err(|_| "promotion session bundle could not be normalized".to_string())?;
    entry()?
        .set_password(&canonical)
        .map_err(|error| error.to_string())?;
    let persisted = entry()?
        .get_password()
        .map_err(|error| error.to_string())?;
    if persisted != canonical {
        return Err("promotion session disappeared after secure storage write".to_string());
    }
    println!("staging promotion session installed in the operating-system credential store");
    Ok(())
}

fn destroy() -> Result<(), String> {
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {
            println!("staging promotion session removed from the operating-system credential store");
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
                "session_id": "session-promotion",
                "punk_id": "punk-promotion",
                "expires_at_seconds": 10_000,
                "last_renewed_at_seconds": 5_000
            }
        }))
        .expect("test bundle")
    }

    #[test]
    fn accepts_only_one_fresh_staging_session_shape() {
        let parsed = parse_bundle(&valid_bundle(), 1_000).expect("fresh bundle");
        assert_eq!(parsed.metadata.session_id, "session-promotion");

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
        wrong_scope["cookie"] = serde_json::json!(format!(
            "punks_session_dev={}",
            "b".repeat(48)
        ));
        assert!(parse_bundle(
            &serde_json::to_vec(&wrong_scope).expect("test JSON"),
            1_000
        )
        .is_err());

        assert!(parse_bundle(&valid_bundle(), 9_900).is_err());
    }
}
