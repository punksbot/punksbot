use nostr::{Event, EventBuilder, JsonUtil, Kind, Tag};
use rusqlite::{params, OptionalExtension, Transaction};
use serde_json::json;
use sha2::{Digest, Sha256};

use super::{migrations, required_tag, tag_value, LocalAuthority};

impl LocalAuthority {
    pub(super) fn validate_message_lifecycle(&self, event: &Event) -> Result<(), String> {
        let kind = event.kind.as_u16() as u32;
        let Some(target_id) = tag_value(event, "e") else {
            return if kind == 5 {
                Ok(())
            } else {
                Err("message lifecycle event requires e tag".to_string())
            };
        };
        let target = self
            .query(&[json!({"ids": [&target_id], "limit": 1})])?
            .into_iter()
            .next()
            .ok_or_else(|| "message lifecycle target was not found".to_string())?;
        if !is_message_content(&target) {
            if kind == 5 && target.pubkey == event.pubkey {
                return Ok(());
            }
            return Err("message lifecycle target is not editable content".to_string());
        }
        let channel_id = required_tag(event, "h")?;
        if tag_value(&target, "h").as_deref() != Some(channel_id.as_str()) {
            return Err("message lifecycle target belongs to another Conversation".to_string());
        }
        let actor = event.pubkey.to_hex();
        let role = self
            .channel_members(&channel_id)?
            .into_iter()
            .find(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&actor))
            .map(|(_, role)| role);
        let owns_target = target.pubkey == event.pubkey;
        let may_moderate = matches!(role.as_deref(), Some("owner" | "admin"));
        if kind == 40_003 && !owns_target {
            return Err("forbidden: only the message author can edit it".to_string());
        }
        if kind != 40_003 && !owns_target && !may_moderate {
            return Err("forbidden: message lifecycle authority required".to_string());
        }
        let state = self.message_lifecycle_state(&target_id)?;
        match kind {
            5 | 9_005 if state.as_deref() == Some("retracted") => {
                Err("message is already retracted".to_string())
            }
            40_003 if state.as_deref() == Some("retracted") => {
                Err("message is retracted and must be restored before editing".to_string())
            }
            40_009 if state.as_deref() != Some("retracted") => {
                Err("message is not retracted".to_string())
            }
            40_010 if state.as_deref() == Some("erased") => {
                Err("message is already erased".to_string())
            }
            _ => Ok(()),
        }
    }

    pub(super) fn project_message_lifecycle(
        &self,
        transaction: &Transaction<'_>,
        event: &Event,
    ) -> Result<Vec<Event>, String> {
        let kind = event.kind.as_u16() as u32;
        if !matches!(kind, 5 | 9_005 | 40_009 | 40_010) {
            return Ok(Vec::new());
        }
        let Some(target_id) = tag_value(event, "e") else {
            return Ok(Vec::new());
        };
        let target = transaction
            .query_row(
                "SELECT raw_json FROM events WHERE id = ?1",
                [&target_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("read lifecycle target projection: {error}"))?
            .and_then(|raw| Event::from_json(raw).ok());
        let Some(target) = target.filter(is_message_content) else {
            return Ok(Vec::new());
        };
        let channel_id = tag_value(&target, "h")
            .ok_or_else(|| "message lifecycle target has no Conversation".to_string())?;
        let state = match kind {
            5 | 9_005 => "retracted",
            40_009 => "active",
            40_010 => "erased",
            _ => return Ok(Vec::new()),
        };
        transaction
            .execute(
                "INSERT INTO message_lifecycle(target_event_id, channel_id, author_pubkey,
                     state, latest_event_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(target_event_id) DO UPDATE SET state = excluded.state,
                   latest_event_id = excluded.latest_event_id, updated_at = excluded.updated_at",
                params![
                    target_id,
                    channel_id,
                    target.pubkey.to_hex(),
                    state,
                    event.id.to_hex(),
                    event.created_at.as_secs() as i64
                ],
            )
            .map_err(|error| format!("project message lifecycle: {error}"))?;
        let action = if matches!(kind, 5 | 9_005) {
            "message.retracted"
        } else if kind == 40_009 {
            "message.restored"
        } else {
            "message.erased"
        };
        transaction
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    action,
                    event.pubkey.to_hex(),
                    target_id,
                    json!({"lifecycle_event_id": event.id.to_hex()}).to_string(),
                    event.created_at.as_secs() as i64
                ],
            )
            .map_err(|error| format!("audit message lifecycle: {error}"))?;
        if kind == 40_010 {
            self.erase_message_content(transaction, event, &target)?;
        }
        let system = lifecycle_system_event(self, event, &target, &channel_id, state)?;
        insert_projected_event(transaction, &system)?;
        Ok(vec![system])
    }

    fn message_lifecycle_state(&self, target_id: &str) -> Result<Option<String>, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .query_row(
                "SELECT state FROM message_lifecycle WHERE target_event_id = ?1",
                [target_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("read message lifecycle state: {error}"))
    }

    fn erase_message_content(
        &self,
        transaction: &Transaction<'_>,
        erase: &Event,
        target: &Event,
    ) -> Result<(), String> {
        let target_id = target.id.to_hex();
        let channel_id = tag_value(target, "h").unwrap_or_default();
        transaction
            .execute(
                "INSERT INTO erased_messages(target_event_id, channel_id, author_pubkey,
                     content_sha256, erased_by, erase_event_id, erased_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    target_id,
                    channel_id,
                    target.pubkey.to_hex(),
                    hex::encode(Sha256::digest(target.content.as_bytes())),
                    erase.pubkey.to_hex(),
                    erase.id.to_hex(),
                    erase.created_at.as_secs() as i64
                ],
            )
            .map_err(|error| format!("record erased message: {error}"))?;
        let mut statement = transaction
            .prepare(
                "SELECT DISTINCT events.id FROM events
                 JOIN event_tags ON event_tags.event_id = events.id
                 WHERE events.kind = 40003 AND event_tags.name = 'e'
                   AND event_tags.value = ?1",
            )
            .map_err(|error| format!("prepare erased message edits: {error}"))?;
        let rows = statement
            .query_map([&target_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("query erased message edits: {error}"))?;
        let mut ids = vec![target_id];
        for row in rows {
            ids.push(row.map_err(|error| format!("read erased message edit: {error}"))?);
        }
        drop(statement);
        for id in ids {
            transaction
                .execute("DELETE FROM events_fts WHERE event_id = ?1", [&id])
                .map_err(|error| format!("erase message search content: {error}"))?;
            transaction
                .execute("DELETE FROM events WHERE id = ?1", [&id])
                .map_err(|error| format!("erase message event content: {error}"))?;
        }
        Ok(())
    }
}

fn lifecycle_system_event(
    authority: &LocalAuthority,
    lifecycle: &Event,
    target: &Event,
    channel_id: &str,
    state: &str,
) -> Result<Event, String> {
    let event_type = if state == "active" {
        "message_restored"
    } else {
        "message_deleted"
    };
    EventBuilder::new(
        Kind::Custom(40_099),
        json!({
            "type": event_type,
            "actor": tag_value(lifecycle, "actor")
                .unwrap_or_else(|| lifecycle.pubkey.to_hex()),
            "target_event_id": target.id.to_hex(),
            "permanent": state == "erased",
            "public_reason": tag_value(lifecycle, "public-reason"),
            "action_id": tag_value(lifecycle, "action-id")
        })
        .to_string(),
    )
    .tags([
        Tag::parse(["h", channel_id])
            .map_err(|error| format!("message lifecycle system channel tag: {error}"))?,
        Tag::parse(["e", &target.id.to_hex()])
            .map_err(|error| format!("message lifecycle system target tag: {error}"))?,
    ])
    .custom_created_at(lifecycle.created_at)
    .sign_with_keys(&authority.signer)
    .map_err(|error| format!("sign message lifecycle system event: {error}"))
}

fn insert_projected_event(transaction: &Transaction<'_>, event: &Event) -> Result<(), String> {
    transaction
        .execute(
            "INSERT OR IGNORE INTO events(id, pubkey, kind, created_at, raw_json)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                event.id.to_hex(),
                event.pubkey.to_hex(),
                event.kind.as_u16() as i64,
                event.created_at.as_secs() as i64,
                event.as_json()
            ],
        )
        .map_err(|error| format!("persist message lifecycle system event: {error}"))?;
    migrations::index_event(transaction, event)
}

fn is_message_content(event: &Event) -> bool {
    matches!(
        event.kind.as_u16() as u32,
        9 | 40_002 | 40_008 | 45_001 | 45_003
    )
}
