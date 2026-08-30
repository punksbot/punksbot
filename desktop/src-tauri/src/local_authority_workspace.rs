use base64::{engine::general_purpose::STANDARD, Engine as _};
use nostr::Event;
use rusqlite::{params, OptionalExtension};

use super::{tag_value, LocalAuthority, SubmitResponse};

const MAX_WORKSPACE_ICON_BYTES: usize = 512 * 1024;

impl LocalAuthority {
    pub(super) fn submit_workspace_profile_command(
        &self,
        event: &Event,
    ) -> Result<SubmitResponse, String> {
        self.assert_member_can_publish(&event.pubkey.to_hex())?;
        let actor = event.pubkey.to_hex();
        let role = self
            .member_role(&actor)?
            .ok_or_else(|| "forbidden: active Workspace membership required".to_string())?;
        if !matches!(role.as_str(), "owner" | "admin") {
            return Err("forbidden: owner or admin role required".to_string());
        }
        let now = chrono::Utc::now().timestamp();
        let created_at = event.created_at.as_secs() as i64;
        if (created_at - now).abs() > 120 {
            return Err("Workspace profile command timestamp is outside the allowed window".into());
        }
        let icon = tag_value(event, "icon").unwrap_or_default();
        validate_icon(&icon)?;
        let stored_icon = (!icon.is_empty()).then_some(icon.as_str());
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local Workspace profile: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local Workspace profile update: {error}"))?;
        transaction
            .execute(
                "INSERT INTO workspace_profile(singleton, icon, updated_by, updated_at)
                 VALUES (1, ?1, ?2, ?3)
                 ON CONFLICT(singleton) DO UPDATE SET
                   icon = excluded.icon,
                   updated_by = excluded.updated_by,
                   updated_at = excluded.updated_at",
                params![stored_icon, actor, created_at],
            )
            .map_err(|error| format!("persist local Workspace profile: {error}"))?;
        transaction
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES ('workspace.profile_updated', ?1, 'workspace', ?2, ?3)",
                params![
                    actor,
                    serde_json::json!({
                        "command_event_id": event.id.to_hex(),
                        "icon_set": !icon.is_empty()
                    })
                    .to_string(),
                    created_at,
                ],
            )
            .map_err(|error| format!("audit local Workspace profile: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit local Workspace profile: {error}"))?;
        drop(database);
        self.persist_and_publish(event.clone())?;
        Ok(SubmitResponse {
            event_id: event.id.to_hex(),
            accepted: true,
            message: String::new(),
        })
    }

    pub(super) fn workspace_icon(&self) -> Result<Option<String>, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local Workspace profile: {error}"))?;
        database
            .query_row(
                "SELECT icon FROM workspace_profile WHERE singleton = 1",
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()
            .map(Option::flatten)
            .map_err(|error| format!("read local Workspace icon: {error}"))
    }
}

fn validate_icon(icon: &str) -> Result<(), String> {
    if icon.is_empty() {
        return Ok(());
    }
    let (header, encoded) = icon
        .split_once(',')
        .filter(|(header, _)| {
            matches!(
                *header,
                "data:image/png;base64"
                    | "data:image/jpeg;base64"
                    | "data:image/webp;base64"
                    | "data:image/gif;base64"
            )
        })
        .ok_or_else(|| "contract: Workspace icon must be a supported image data URL".to_string())?;
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "contract: Workspace icon contains invalid base64".to_string())?;
    if bytes.is_empty() || bytes.len() > MAX_WORKSPACE_ICON_BYTES {
        return Err("contract: Workspace icon size is outside the allowed range".to_string());
    }
    let expected = header
        .strip_prefix("data:")
        .and_then(|value| value.strip_suffix(";base64"))
        .unwrap_or_default();
    if infer::get(&bytes).map(|kind| kind.mime_type()) != Some(expected) {
        return Err("contract: Workspace icon MIME does not match its bytes".to_string());
    }
    Ok(())
}
