use nostr::{Event, EventBuilder, Kind};
use rusqlite::{params, OptionalExtension};

use super::{parse_tag, tag_value, LocalAuthority, SubmitResponse};

const MEMBERSHIP_SNAPSHOT_KIND: u16 = 13_534;

impl LocalAuthority {
    pub(super) fn publish_membership_snapshot(&self) -> Result<(), String> {
        let members = {
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local authority database: {error}"))?;
            let mut statement = database
                .prepare(
                    "SELECT pubkey, role FROM community_members
                     WHERE removed_at IS NULL ORDER BY pubkey ASC",
                )
                .map_err(|error| format!("prepare local membership snapshot: {error}"))?;
            let rows = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|error| format!("query local membership snapshot: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("read local membership snapshot: {error}"))?
        };

        let mut tags = vec![parse_tag(["-"])?];
        for (pubkey, role) in members {
            tags.push(parse_tag(["member", &pubkey, &role])?);
        }
        let current = self
            .query(&[serde_json::json!({
                "kinds": [MEMBERSHIP_SNAPSHOT_KIND],
                "authors": [self.signer.public_key().to_hex()],
                "limit": 1
            })])?
            .into_iter()
            .next();
        if current
            .as_ref()
            .is_some_and(|event| event.tags.iter().eq(tags.iter()))
        {
            return Ok(());
        }
        let previous = current
            .map(|event| event.created_at.as_secs())
            .unwrap_or_default();
        let now = nostr::Timestamp::now().as_secs();
        let snapshot = EventBuilder::new(Kind::Custom(MEMBERSHIP_SNAPSHOT_KIND), "")
            .tags(tags)
            .custom_created_at(nostr::Timestamp::from(now.max(previous.saturating_add(1))))
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local membership snapshot: {error}"))?;
        self.persist_and_publish(snapshot)?;
        Ok(())
    }

    pub(super) fn submit_membership_command(
        &self,
        event: &Event,
    ) -> Result<SubmitResponse, String> {
        self.assert_member_can_publish(&event.pubkey.to_hex())?;
        let now = chrono::Utc::now().timestamp();
        let created_at = event.created_at.as_secs() as i64;
        if (created_at - now).abs() > 120 {
            return Err("membership command timestamp is outside the allowed window".to_string());
        }

        let actor = event.pubkey.to_hex();
        let actor_role = self
            .member_role(&actor)?
            .ok_or_else(|| "forbidden: active Workspace membership required".to_string())?;
        if !matches!(actor_role.as_str(), "owner" | "admin") {
            return Err("forbidden: owner or admin role required".to_string());
        }
        let target = tag_value(event, "p")
            .map(|value| value.to_ascii_lowercase())
            .filter(|value| is_hex_pubkey(value))
            .ok_or_else(|| "membership command requires a valid p tag".to_string())?;
        let kind = event.kind.as_u16() as u32;
        let requested_role = tag_value(event, "role");
        let timestamp = chrono::Utc::now().timestamp();

        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin membership command: {error}"))?;
        let current_role = transaction
            .query_row(
                "SELECT role FROM community_members WHERE pubkey = ?1 AND removed_at IS NULL",
                [&target],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("read membership command target: {error}"))?;

        let (action, changed) = match kind {
            9030 => {
                let role = requested_role.unwrap_or_else(|| "member".to_string());
                if !matches!(role.as_str(), "member" | "admin") {
                    return Err("invalid role: expected member or admin".to_string());
                }
                if role == "admin" && actor_role != "owner" {
                    return Err("forbidden: only an owner can grant admin".to_string());
                }
                if current_role.is_some() {
                    ("membership.added", false)
                } else {
                    let changed = transaction
                        .execute(
                            "INSERT INTO community_members(pubkey, role, removed_at, created_at, updated_at)
                             VALUES (?1, ?2, NULL, ?3, ?3)
                             ON CONFLICT(pubkey) DO UPDATE SET role = excluded.role,
                               removed_at = NULL, updated_at = excluded.updated_at",
                            params![target, role, timestamp],
                        )
                        .map_err(|error| format!("add local member: {error}"))?
                        == 1;
                    ("membership.added", changed)
                }
            }
            9031 => {
                if target == actor {
                    return Err("cannot remove the active owner or admin itself".to_string());
                }
                let Some(target_role) = current_role else {
                    return Err("membership target was not found".to_string());
                };
                if target_role == "owner" || (target_role == "admin" && actor_role != "owner") {
                    return Err("forbidden: actor cannot remove this role".to_string());
                }
                let changed = transaction
                    .execute(
                        "UPDATE community_members SET removed_at = ?2, updated_at = ?2
                         WHERE pubkey = ?1 AND removed_at IS NULL",
                        params![target, timestamp],
                    )
                    .map_err(|error| format!("remove local member: {error}"))?
                    == 1;
                ("membership.removed", changed)
            }
            9032 => {
                if actor_role != "owner" {
                    return Err("forbidden: only an owner can change roles".to_string());
                }
                let role = requested_role
                    .filter(|value| matches!(value.as_str(), "member" | "admin"))
                    .ok_or_else(|| "invalid role: expected member or admin".to_string())?;
                let Some(target_role) = current_role else {
                    return Err("membership target was not found".to_string());
                };
                if target_role == "owner" {
                    return Err(
                        "owner transfer requires the Workspace transfer command".to_string()
                    );
                }
                let changed = target_role != role
                    && transaction
                        .execute(
                            "UPDATE community_members SET role = ?2, updated_at = ?3
                             WHERE pubkey = ?1 AND removed_at IS NULL",
                            params![target, role, timestamp],
                        )
                        .map_err(|error| format!("change local member role: {error}"))?
                        == 1;
                ("membership.role_changed", changed)
            }
            _ => return Err("unsupported membership command".to_string()),
        };

        if changed {
            transaction
                .execute(
                    "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        action,
                        actor,
                        target,
                        serde_json::json!({"command_event_id": event.id.to_hex()}).to_string(),
                        timestamp
                    ],
                )
                .map_err(|error| format!("audit membership command: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("commit membership command: {error}"))?;
        drop(database);

        self.persist_and_publish(event.clone())?;
        if changed {
            self.publish_membership_snapshot()?;
        }
        Ok(SubmitResponse {
            event_id: event.id.to_hex(),
            accepted: true,
            message: String::new(),
        })
    }
}

fn is_hex_pubkey(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
