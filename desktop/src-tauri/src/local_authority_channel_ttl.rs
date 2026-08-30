use nostr::Event;
use rusqlite::{params, OptionalExtension, Transaction};

use super::{has_tag, tag_value, LocalAuthority};

const CHANNEL_METADATA_KIND: u32 = 39_000;
const MAX_TTL_SECONDS: i64 = 31 * 24 * 60 * 60;

pub(super) fn new_deadline(ttl: &str, base: i64) -> Result<String, String> {
    let ttl = parse_ttl(ttl)?;
    deadline_iso(base.saturating_add(ttl))
}

pub(super) fn project(
    transaction: &Transaction<'_>,
    event: &Event,
) -> Result<Option<String>, String> {
    let kind = event.kind.as_u16() as u32;
    if kind == CHANNEL_METADATA_KIND {
        project_metadata(transaction, event)?;
        return Ok(None);
    }
    if (9_000..10_000).contains(&kind) || (39_000..40_000).contains(&kind) {
        return Ok(None);
    }
    let Some(channel_id) = tag_value(event, "h") else {
        return Ok(None);
    };
    let activity_deadline = event.created_at.as_secs() as i64;
    let updated = transaction
        .execute(
            "UPDATE channel_ttl
             SET deadline = MAX(deadline, ?2 + ttl_seconds), updated_at = ?2
             WHERE channel_id = ?1 AND expired_at IS NULL",
            params![channel_id, activity_deadline],
        )
        .map_err(|error| format!("renew local Conversation TTL: {error}"))?;
    Ok((updated == 1).then_some(channel_id))
}

impl LocalAuthority {
    pub(super) fn sync_channel_ttl_metadata(&self, channel_id: &str) -> Result<(), String> {
        let lease = {
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local Conversation TTL: {error}"))?;
            database
                .query_row(
                    "SELECT ttl_seconds, deadline FROM channel_ttl
                     WHERE channel_id = ?1 AND expired_at IS NULL",
                    [channel_id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()
                .map_err(|error| format!("read local Conversation TTL: {error}"))?
        };
        let Some((ttl, deadline)) = lease else {
            return Ok(());
        };
        let ttl = ttl.to_string();
        let deadline = deadline_iso(deadline)?;
        self.publish_channel_metadata_fields(
            channel_id,
            &[
                ("ttl", Some(ttl.as_str())),
                ("ttl_deadline", Some(deadline.as_str())),
            ],
        )
    }

    pub(crate) fn run_due_channel_ttl(&self, now: i64) -> Result<usize, String> {
        let due = {
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local Conversation TTL: {error}"))?;
            let mut statement = database
                .prepare(
                    "SELECT channel_id FROM channel_ttl
                     WHERE expired_at IS NULL AND deadline <= ?1
                     ORDER BY deadline ASC, channel_id ASC LIMIT 64",
                )
                .map_err(|error| format!("prepare due Conversation TTL: {error}"))?;
            let rows = statement
                .query_map([now], |row| row.get::<_, String>(0))
                .map_err(|error| format!("query due Conversation TTL: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("read due Conversation TTL: {error}"))?
        };
        let mut archived = 0usize;
        for channel_id in due {
            let Some(metadata) = self.channel_metadata(&channel_id)? else {
                continue;
            };
            if has_tag(&metadata, "archived") {
                continue;
            }
            let members = self.channel_members(&channel_id)?;
            self.publish_channel_snapshot(
                &channel_id,
                &tag_value(&metadata, "name").unwrap_or_else(|| "stream".to_string()),
                &tag_value(&metadata, "about").unwrap_or_default(),
                &tag_value(&metadata, "t").unwrap_or_else(|| "stream".to_string()),
                if has_tag(&metadata, "private") {
                    "private"
                } else {
                    "open"
                },
                true,
                &members,
            )?;
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local Conversation TTL audit: {error}"))?;
            database
                .execute(
                    "INSERT INTO audit_log(
                       action, actor_pubkey, target_id, details_json, created_at
                     ) VALUES ('conversation.ttl_archived', ?1, ?2, ?3, ?4)",
                    params![
                        self.signer.public_key().to_hex(),
                        channel_id,
                        serde_json::json!({"deadline": tag_value(&metadata, "ttl_deadline")})
                            .to_string(),
                        now,
                    ],
                )
                .map_err(|error| format!("audit due Conversation TTL: {error}"))?;
            archived += 1;
        }
        Ok(archived)
    }
}

fn project_metadata(transaction: &Transaction<'_>, event: &Event) -> Result<(), String> {
    let Some(channel_id) = tag_value(event, "d") else {
        return Ok(());
    };
    let Some(ttl) = tag_value(event, "ttl").filter(|value| !value.is_empty()) else {
        transaction
            .execute(
                "DELETE FROM channel_ttl WHERE channel_id = ?1",
                [&channel_id],
            )
            .map_err(|error| format!("clear local Conversation TTL: {error}"))?;
        return Ok(());
    };
    let ttl = parse_ttl(&ttl)?;
    let deadline = tag_value(event, "ttl_deadline")
        .map(|value| parse_deadline(&value))
        .transpose()?
        .unwrap_or_else(|| event.created_at.as_secs() as i64 + ttl);
    let archived = has_tag(event, "archived");
    transaction
        .execute(
            "INSERT INTO channel_ttl(
               channel_id, ttl_seconds, deadline, expired_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(channel_id) DO UPDATE SET
               ttl_seconds = excluded.ttl_seconds,
               deadline = excluded.deadline,
               expired_at = excluded.expired_at,
               updated_at = excluded.updated_at",
            params![
                channel_id,
                ttl,
                deadline,
                archived.then_some(event.created_at.as_secs() as i64),
                event.created_at.as_secs() as i64,
            ],
        )
        .map_err(|error| format!("project local Conversation TTL: {error}"))?;
    Ok(())
}

pub(super) fn deadline_iso(timestamp: i64) -> Result<String, String> {
    chrono::DateTime::<chrono::Utc>::from_timestamp(timestamp, 0)
        .map(|value| value.to_rfc3339())
        .ok_or_else(|| "Conversation TTL deadline is out of range".to_string())
}

fn parse_deadline(value: &str) -> Result<i64, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp())
        .map_err(|_| "contract: Conversation TTL deadline is invalid".to_string())
}

fn parse_ttl(value: &str) -> Result<i64, String> {
    value
        .parse::<i64>()
        .ok()
        .filter(|ttl| (1..=MAX_TTL_SECONDS).contains(ttl))
        .ok_or_else(|| "contract: Conversation TTL is outside the allowed range".to_string())
}
