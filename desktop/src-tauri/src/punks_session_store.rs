//! Punks-only session persistence.
//!
//! This adapter deliberately does not share Buzz's secret store, service name,
//! cache, migration paths, or fallback files. A Punks distribution therefore
//! cannot read or mutate a historical Nostr identity by construction.

use punks_account_client::ceremony::{SessionMetadata, SessionPersistence, SessionSecret};

const SESSION_KEY: &str = "session-v1";
const INSTALLATION_ID_KEY: &str = "installation-id";

/// Persists the native session directly in the operating-system credential
/// store. The cookie is never exposed to the WebView or an environment variable.
pub struct KeyringSessionPersistence;

impl KeyringSessionPersistence {
    pub fn new() -> Self {
        Self
    }

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(service_name(), key).map_err(|error| error.to_string())
    }

    fn load_value(key: &str) -> Result<Option<String>, String> {
        match Self::entry(key)?.get_password() {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn delete_value(key: &str) -> Result<(), String> {
        match Self::entry(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn service_name() -> &'static str {
    match option_env!("PUNKS_DISTRIBUTION") {
        Some("production") => "punks-desktop",
        Some("staging") => "punks-desktop-staging",
        _ => "punks-desktop-development",
    }
}

/// Loads the stable per-installation identity, creating it in the Punks-only
/// keychain service on first launch. The Punks runtime calls this only from
/// Tauri setup after the single-instance plugin has acquired process ownership.
pub fn load_or_create_installation_identity() -> Result<String, String> {
    if let Some(identity) = KeyringSessionPersistence::load_value(INSTALLATION_ID_KEY)? {
        validate_installation_identity(&identity)?;
        return Ok(identity);
    }

    let generated = uuid::Uuid::new_v4().to_string();
    KeyringSessionPersistence::entry(INSTALLATION_ID_KEY)?
        .set_password(&generated)
        .map_err(|error| error.to_string())?;
    let persisted = KeyringSessionPersistence::load_value(INSTALLATION_ID_KEY)?
        .ok_or_else(|| "installation identity disappeared after creation".to_string())?;
    validate_installation_identity(&persisted)?;
    Ok(persisted)
}

fn validate_installation_identity(value: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(value)
        .map_err(|_| "installation identity is not a UUID".to_string())?;
    if parsed.get_version_num() != 4 || parsed.to_string() != value {
        return Err("installation identity must be a canonical UUIDv4".to_string());
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredSessionMetadata {
    session_id: String,
    punk_id: String,
    expires_at_seconds: u64,
    last_renewed_at_seconds: Option<u64>,
}

impl From<&SessionMetadata> for StoredSessionMetadata {
    fn from(metadata: &SessionMetadata) -> Self {
        Self {
            session_id: metadata.session_id.clone(),
            punk_id: metadata.punk_id.clone(),
            expires_at_seconds: punks_account_client::ceremony::unix_seconds(metadata.expires_at),
            last_renewed_at_seconds: metadata
                .last_renewed_at
                .map(punks_account_client::ceremony::unix_seconds),
        }
    }
}

impl StoredSessionMetadata {
    fn into_metadata(self) -> Result<SessionMetadata, String> {
        let epoch = std::time::UNIX_EPOCH;
        Ok(SessionMetadata {
            session_id: self.session_id,
            punk_id: self.punk_id,
            expires_at: epoch
                .checked_add(std::time::Duration::from_secs(self.expires_at_seconds))
                .ok_or_else(|| {
                    "persisted session expiry is outside SystemTime range".to_string()
                })?,
            last_renewed_at: self
                .last_renewed_at_seconds
                .map(|seconds| {
                    epoch
                        .checked_add(std::time::Duration::from_secs(seconds))
                        .ok_or_else(|| {
                            "persisted session renewal is outside SystemTime range".to_string()
                        })
                })
                .transpose()?,
        })
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
struct StoredSession {
    cookie: String,
    metadata: StoredSessionMetadata,
}

impl SessionPersistence for KeyringSessionPersistence {
    fn persist(&self, secret: &SessionSecret, metadata: &SessionMetadata) -> Result<(), String> {
        // One credential prevents a partial write from pairing a new cookie
        // with stale metadata (or the inverse).
        let stored = serde_json::to_string(&StoredSession {
            cookie: secret.raw().to_string(),
            metadata: StoredSessionMetadata::from(metadata),
        })
        .map_err(|error| error.to_string())?;
        Self::entry(SESSION_KEY)?
            .set_password(&stored)
            .map_err(|error| error.to_string())
    }

    fn load(&self) -> Result<Option<(SessionSecret, SessionMetadata)>, String> {
        let Some(stored) = Self::load_value(SESSION_KEY)? else {
            return Ok(None);
        };
        let stored: StoredSession =
            serde_json::from_str(&stored).map_err(|error| error.to_string())?;
        Ok(Some((
            SessionSecret::from_cookie_header(&stored.cookie),
            stored.metadata.into_metadata()?,
        )))
    }

    fn destroy(&self) -> Result<(), String> {
        Self::delete_value(SESSION_KEY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_round_trip_preserves_session_fields() {
        let metadata = SessionMetadata {
            session_id: "session-1".to_string(),
            punk_id: "punk-1".to_string(),
            expires_at: std::time::UNIX_EPOCH + std::time::Duration::from_secs(1234),
            last_renewed_at: Some(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1000)),
        };

        let restored = StoredSessionMetadata::from(&metadata)
            .into_metadata()
            .expect("test metadata must fit SystemTime");

        assert_eq!(restored, metadata);
    }

    #[test]
    fn metadata_rejects_timestamps_outside_system_time_range() {
        let stored = StoredSessionMetadata {
            session_id: "session-1".to_string(),
            punk_id: "punk-1".to_string(),
            expires_at_seconds: u64::MAX,
            last_renewed_at_seconds: None,
        };

        assert!(stored.into_metadata().is_err());
    }

    #[test]
    fn installation_identity_accepts_only_canonical_uuid_v4() {
        assert!(validate_installation_identity("d9428888-122b-4d9b-8f03-1a1127e667b8").is_ok());
        assert!(validate_installation_identity("d9428888-122b-5d9b-8f03-1a1127e667b8").is_err());
        assert!(validate_installation_identity("D9428888-122B-4D9B-8F03-1A1127E667B8").is_err());
    }
}
