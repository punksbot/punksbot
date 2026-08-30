use axum::{
    extract::{Extension, OriginalUri, Query},
    http::{HeaderMap, Response, StatusCode},
    response::{IntoResponse, Json},
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use chrono::{DateTime, Utc};
use nostr::{EventBuilder, JsonUtil, Kind, Tag};
use rusqlite::{params, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

use super::{error_response, tag_value, LocalAuthority, SubmitResponse};

#[derive(Debug, Deserialize)]
pub(super) struct ReportQuery {
    status: Option<String>,
    limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
pub(super) struct AuditQuery {
    limit: Option<usize>,
}

impl LocalAuthority {
    pub(super) fn ensure_community_member(&self, pubkey: &str, role: &str) -> Result<(), String> {
        if !matches!(role, "owner" | "admin" | "member" | "guest" | "bot") {
            return Err("invalid community role".to_string());
        }
        let now = unix_seconds();
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .execute(
                "INSERT INTO community_members(pubkey, role, removed_at, created_at, updated_at)
                 VALUES (?1, ?2, NULL, ?3, ?3)
                 ON CONFLICT(pubkey) DO UPDATE SET
                   role = CASE
                     WHEN community_members.role = 'owner' THEN community_members.role
                     ELSE excluded.role
                   END,
                   removed_at = NULL,
                   updated_at = excluded.updated_at",
                params![pubkey.to_ascii_lowercase(), role, now],
            )
            .map_err(|error| format!("ensure community member: {error}"))?;
        Ok(())
    }

    pub(super) fn assert_member_can_publish(&self, pubkey: &str) -> Result<(), String> {
        self.assert_member_can_authenticate(pubkey)?;
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let muted_until = database
            .query_row(
                "SELECT muted_until FROM restrictions WHERE pubkey = ?1",
                [pubkey.to_ascii_lowercase()],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(|error| format!("read community timeout: {error}"))?
            .flatten();
        if muted_until.is_some_and(|expiry| expiry > unix_seconds()) {
            return Err("restricted: identity is timed out from publishing".to_string());
        }
        Ok(())
    }

    pub(super) fn assert_member_can_authenticate(&self, pubkey: &str) -> Result<(), String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let member = database
            .query_row(
                "SELECT removed_at FROM community_members WHERE pubkey = ?1",
                [pubkey.to_ascii_lowercase()],
                |row| row.get::<_, Option<i64>>(0),
            )
            .optional()
            .map_err(|error| format!("read community member: {error}"))?;
        if !matches!(member, Some(None)) {
            return Err("restricted: identity is not an active Workspace member".to_string());
        }
        let restriction = database
            .query_row(
                "SELECT banned, ban_expires_at FROM restrictions WHERE pubkey = ?1",
                [pubkey.to_ascii_lowercase()],
                |row| Ok((row.get::<_, bool>(0)?, row.get::<_, Option<i64>>(1)?)),
            )
            .optional()
            .map_err(|error| format!("read community restriction: {error}"))?;
        if let Some((banned, ban_expires_at)) = restriction {
            let now = unix_seconds();
            if banned && ban_expires_at.is_none_or(|expiry| expiry > now) {
                return Err("restricted: identity is banned from this Workspace".to_string());
            }
        }
        Ok(())
    }

    pub(super) fn submit_governance_event(
        &self,
        event: &nostr::Event,
    ) -> Result<SubmitResponse, String> {
        self.assert_member_can_publish(&event.pubkey.to_hex())?;
        match event.kind.as_u16() as u32 {
            1984 => self.file_report(event)?,
            9040..=9044 => self.apply_moderation_command(event)?,
            _ => return Err("unsupported governance command".to_string()),
        }
        Ok(SubmitResponse {
            event_id: event.id.to_hex(),
            accepted: true,
            message: String::new(),
        })
    }

    pub(crate) fn moderation_reports(
        &self,
        actor_pubkey: &str,
        status: Option<&str>,
        limit: usize,
    ) -> Result<Vec<Value>, String> {
        self.require_moderator(actor_pubkey)?;
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let mut statement = database
            .prepare(
                "SELECT id, report_event_id, reporter_pubkey, target_kind, target, channel_id,
                        report_type, note, status, resolved_by, resolved_at, action_id, created_at
                 FROM moderation_reports
                 WHERE (?1 IS NULL OR status = ?1)
                 ORDER BY created_at DESC, id DESC LIMIT ?2",
            )
            .map_err(|error| format!("prepare moderation reports: {error}"))?;
        let rows = statement
            .query_map(params![status, limit.clamp(1, 500) as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "report_event_id": row.get::<_, String>(1)?,
                    "reporter_pubkey": row.get::<_, String>(2)?,
                    "target_kind": row.get::<_, String>(3)?,
                    "target": row.get::<_, String>(4)?,
                    "channel_id": row.get::<_, Option<String>>(5)?,
                    "report_type": row.get::<_, String>(6)?,
                    "note": row.get::<_, Option<String>>(7)?,
                    "status": row.get::<_, String>(8)?,
                    "resolved_by": row.get::<_, Option<String>>(9)?,
                    "resolved_at": iso_optional(row.get::<_, Option<i64>>(10)?),
                    "action_id": row.get::<_, Option<String>>(11)?,
                    "created_at": iso(row.get::<_, i64>(12)?)
                }))
            })
            .map_err(|error| format!("query moderation reports: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read moderation reports: {error}"))
    }

    pub(crate) fn moderation_restrictions(&self, actor_pubkey: &str) -> Result<Vec<Value>, String> {
        self.require_moderator(actor_pubkey)?;
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let now = unix_seconds();
        let mut statement = database
            .prepare(
                "SELECT pubkey, banned, ban_expires_at, ban_reason, muted_until, mute_reason,
                        actor_pubkey, updated_at
                 FROM restrictions
                 WHERE (banned = 1 AND (ban_expires_at IS NULL OR ban_expires_at > ?1))
                    OR muted_until > ?1
                 ORDER BY updated_at DESC, pubkey ASC",
            )
            .map_err(|error| format!("prepare moderation restrictions: {error}"))?;
        let rows = statement
            .query_map([now], |row| {
                Ok(json!({
                    "pubkey": row.get::<_, String>(0)?,
                    "banned": row.get::<_, bool>(1)?,
                    "ban_expires_at": iso_optional(row.get::<_, Option<i64>>(2)?),
                    "ban_reason": row.get::<_, Option<String>>(3)?,
                    "muted_until": iso_optional(row.get::<_, Option<i64>>(4)?),
                    "mute_reason": row.get::<_, Option<String>>(5)?,
                    "actor_pubkey": row.get::<_, String>(6)?,
                    "updated_at": iso(row.get::<_, i64>(7)?)
                }))
            })
            .map_err(|error| format!("query moderation restrictions: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read moderation restrictions: {error}"))
    }

    fn moderation_audit(&self, actor_pubkey: &str, limit: usize) -> Result<Vec<Value>, String> {
        self.require_moderator(actor_pubkey)?;
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let mut statement = database
            .prepare(
                "SELECT id, actor_pubkey, action, target_pubkey, target_event_id, channel_id,
                        reason_code, public_reason, private_reason, matched_principal, created_at
                 FROM moderation_actions ORDER BY created_at DESC, id DESC LIMIT ?1",
            )
            .map_err(|error| format!("prepare moderation audit: {error}"))?;
        let rows = statement
            .query_map([limit.clamp(1, 500) as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "actor_pubkey": row.get::<_, String>(1)?,
                    "action": row.get::<_, String>(2)?,
                    "target_pubkey": row.get::<_, Option<String>>(3)?,
                    "target_event_id": row.get::<_, Option<String>>(4)?,
                    "channel_id": row.get::<_, Option<String>>(5)?,
                    "reason_code": row.get::<_, Option<String>>(6)?,
                    "public_reason": row.get::<_, Option<String>>(7)?,
                    "private_reason": row.get::<_, Option<String>>(8)?,
                    "matched_principal": row.get::<_, Option<String>>(9)?,
                    "created_at": iso(row.get::<_, i64>(10)?)
                }))
            })
            .map_err(|error| format!("query moderation audit: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read moderation audit: {error}"))
    }

    fn file_report(&self, event: &nostr::Event) -> Result<(), String> {
        let target_event_id =
            tag_value(event, "e").ok_or_else(|| "report requires an event target".to_string())?;
        let report_type = event
            .tags
            .iter()
            .find_map(|tag| {
                let values = tag.as_slice();
                (values.first().map(String::as_str) == Some("e"))
                    .then(|| values.get(2).cloned())
                    .flatten()
            })
            .unwrap_or_else(|| "other".to_string());
        let target_author =
            tag_value(event, "p").ok_or_else(|| "report requires an author target".to_string())?;
        let channel_id = self
            .query(&[json!({"ids": [&target_event_id], "limit": 1})])?
            .into_iter()
            .next()
            .and_then(|target| tag_value(&target, "h"));
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .execute(
                "INSERT OR IGNORE INTO moderation_reports(
                   id, report_event_id, reporter_pubkey, target_kind, target, channel_id,
                   report_type, note, status, resolved_by, resolved_at, action_id, created_at
                 ) VALUES (?1, ?2, ?3, 'event', ?4, ?5, ?6, ?7, 'open', NULL, NULL, NULL, ?8)",
                params![
                    Uuid::new_v4().to_string(),
                    event.id.to_hex(),
                    event.pubkey.to_hex(),
                    target_event_id,
                    channel_id,
                    report_type,
                    (!event.content.trim().is_empty()).then(|| event.content.trim().to_string()),
                    event.created_at.as_secs() as i64
                ],
            )
            .map_err(|error| format!("file moderation report: {error}"))?;
        let _ = target_author;
        Ok(())
    }

    fn apply_moderation_command(&self, event: &nostr::Event) -> Result<(), String> {
        let actor = event.pubkey.to_hex();
        self.require_moderator(&actor)?;
        let kind = event.kind.as_u16() as u32;
        if kind == 9044 {
            return self.resolve_report(event, &actor);
        }
        let target =
            tag_value(event, "p").ok_or_else(|| "moderation command requires p tag".to_string())?;
        let target_role = self.member_role(&target)?;
        if matches!(target_role.as_deref(), Some("owner" | "admin")) {
            return Err("moderators cannot restrict an owner or admin".to_string());
        }
        let reason = tag_value(event, "reason");
        let expiration: Option<i64> =
            tag_value(event, "expiration").and_then(|value| value.parse().ok());
        let now = unix_seconds();
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        match kind {
            9040 => database.execute(
                "INSERT INTO restrictions(pubkey, banned, ban_expires_at, ban_reason,
                         muted_until, mute_reason, actor_pubkey, updated_at)
                     VALUES (?1, 1, ?2, ?3, NULL, NULL, ?4, ?5)
                     ON CONFLICT(pubkey) DO UPDATE SET banned = 1,
                         ban_expires_at = excluded.ban_expires_at,
                         ban_reason = excluded.ban_reason,
                         actor_pubkey = excluded.actor_pubkey,
                         updated_at = excluded.updated_at",
                params![target, expiration, reason, actor, now],
            ),
            9041 => database.execute(
                "UPDATE restrictions SET banned = 0, ban_expires_at = NULL, ban_reason = NULL,
                     actor_pubkey = ?2, updated_at = ?3 WHERE pubkey = ?1",
                params![target, actor, now],
            ),
            9042 => {
                let expiration =
                    expiration.ok_or_else(|| "timeout requires expiration".to_string())?;
                database.execute(
                    "INSERT INTO restrictions(pubkey, banned, ban_expires_at, ban_reason,
                         muted_until, mute_reason, actor_pubkey, updated_at)
                     VALUES (?1, 0, NULL, NULL, ?2, ?3, ?4, ?5)
                     ON CONFLICT(pubkey) DO UPDATE SET muted_until = excluded.muted_until,
                         mute_reason = excluded.mute_reason,
                         actor_pubkey = excluded.actor_pubkey,
                         updated_at = excluded.updated_at",
                    params![target, expiration, reason, actor, now],
                )
            }
            9043 => database.execute(
                "UPDATE restrictions SET muted_until = NULL, mute_reason = NULL,
                     actor_pubkey = ?2, updated_at = ?3 WHERE pubkey = ?1",
                params![target, actor, now],
            ),
            _ => return Err("unsupported moderation command".to_string()),
        }
        .map_err(|error| format!("apply moderation restriction: {error}"))?;
        let action = match kind {
            9040 => "ban",
            9041 => "unban",
            9042 => "timeout",
            9043 => "untimeout",
            _ => return Err("unsupported moderation restriction".to_string()),
        };
        database
            .execute(
                "INSERT INTO moderation_actions(id, actor_pubkey, action, target_pubkey,
                     target_event_id, channel_id, reason_code, public_reason, private_reason,
                     matched_principal, created_at)
                 VALUES (?1, ?2, ?3, ?4, NULL, NULL, NULL, ?5, NULL, NULL, ?6)",
                params![
                    Uuid::new_v4().to_string(),
                    actor,
                    action,
                    target,
                    reason,
                    now
                ],
            )
            .map_err(|error| format!("audit moderation action: {error}"))?;
        Ok(())
    }

    fn resolve_report(&self, event: &nostr::Event, actor: &str) -> Result<(), String> {
        let report_event_id = tag_value(event, "report")
            .ok_or_else(|| "report resolution requires report tag".to_string())?;
        let status = tag_value(event, "status")
            .ok_or_else(|| "report resolution requires status tag".to_string())?;
        let action = tag_value(event, "action")
            .ok_or_else(|| "report resolution requires action tag".to_string())?;
        if !matches!(status.as_str(), "resolved" | "dismissed") {
            return Err("invalid report resolution status".to_string());
        }
        if !matches!(
            action.as_str(),
            "delete" | "kick" | "ban" | "timeout" | "dismiss" | "escalate"
        ) {
            return Err("invalid report resolution action".to_string());
        }
        let action_id = Uuid::new_v4().to_string();
        let public_reason = tag_value(event, "reason");
        let now = unix_seconds();
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin report resolution: {error}"))?;
        let (target_event_id, channel_id, target_pubkey) = transaction
            .query_row(
                "SELECT reports.target, reports.channel_id, events.pubkey
                 FROM moderation_reports reports
                 JOIN events ON events.id = reports.target
                 WHERE reports.report_event_id = ?1 AND reports.status = 'open'",
                [&report_event_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("read report resolution target: {error}"))?
            .ok_or_else(|| "open moderation report not found".to_string())?;
        let changed = transaction
            .execute(
                "UPDATE moderation_reports SET status = ?1, resolved_by = ?2,
                     resolved_at = ?3, action_id = ?4
                 WHERE report_event_id = ?5 AND status = 'open'",
                params![status, actor, now, action_id, report_event_id],
            )
            .map_err(|error| format!("resolve moderation report: {error}"))?;
        if changed != 1 {
            return Err("open moderation report not found".to_string());
        }
        transaction
            .execute(
                "INSERT INTO moderation_actions(id, actor_pubkey, action, target_pubkey,
                     target_event_id, channel_id, reason_code, public_reason, private_reason,
                     matched_principal, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, NULL, ?9)",
                params![
                    action_id,
                    actor,
                    action,
                    target_pubkey,
                    target_event_id,
                    channel_id,
                    public_reason,
                    (!event.content.trim().is_empty()).then(|| event.content.trim()),
                    now
                ],
            )
            .map_err(|error| format!("audit report resolution: {error}"))?;
        if matches!(action.as_str(), "kick" | "ban" | "timeout") {
            let target_role = transaction
                .query_row(
                    "SELECT role FROM community_members
                     WHERE pubkey = ?1 AND removed_at IS NULL",
                    [&target_pubkey],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| format!("read moderation resolution role: {error}"))?;
            if matches!(target_role.as_deref(), Some("owner" | "admin")) {
                return Err("moderators cannot restrict an owner or admin".to_string());
            }
        }
        if action == "kick" {
            transaction
                .execute(
                    "UPDATE community_members SET removed_at = ?2, updated_at = ?2
                     WHERE pubkey = ?1 AND removed_at IS NULL",
                    params![target_pubkey, now],
                )
                .map_err(|error| format!("kick reported member: {error}"))?;
        } else if action == "ban" {
            transaction
                .execute(
                    "INSERT INTO restrictions(pubkey, banned, ban_expires_at, ban_reason,
                         muted_until, mute_reason, actor_pubkey, updated_at)
                     VALUES (?1, 1, NULL, ?2, NULL, NULL, ?3, ?4)
                     ON CONFLICT(pubkey) DO UPDATE SET banned = 1, ban_expires_at = NULL,
                       ban_reason = excluded.ban_reason, actor_pubkey = excluded.actor_pubkey,
                       updated_at = excluded.updated_at",
                    params![target_pubkey, public_reason, actor, now],
                )
                .map_err(|error| format!("ban reported member: {error}"))?;
        } else if action == "timeout" {
            let expiration = tag_value(event, "expiration")
                .and_then(|value| value.parse::<i64>().ok())
                .filter(|expiration| *expiration > now)
                .ok_or_else(|| "timeout resolution requires a future expiration".to_string())?;
            transaction
                .execute(
                    "INSERT INTO restrictions(pubkey, banned, ban_expires_at, ban_reason,
                         muted_until, mute_reason, actor_pubkey, updated_at)
                     VALUES (?1, 0, NULL, NULL, ?2, ?3, ?4, ?5)
                     ON CONFLICT(pubkey) DO UPDATE SET muted_until = excluded.muted_until,
                       mute_reason = excluded.mute_reason, actor_pubkey = excluded.actor_pubkey,
                       updated_at = excluded.updated_at",
                    params![target_pubkey, expiration, public_reason, actor, now],
                )
                .map_err(|error| format!("timeout reported member: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("commit report resolution: {error}"))?;
        drop(database);

        if action == "delete" {
            let channel_id =
                channel_id.ok_or_else(|| "reported message has no Conversation".to_string())?;
            let mut tags = vec![
                Tag::parse(["h", &channel_id])
                    .map_err(|error| format!("moderation deletion channel tag: {error}"))?,
                Tag::parse(["e", &target_event_id])
                    .map_err(|error| format!("moderation deletion target tag: {error}"))?,
                Tag::parse(["action-id", &action_id])
                    .map_err(|error| format!("moderation deletion action tag: {error}"))?,
                Tag::parse(["actor", actor])
                    .map_err(|error| format!("moderation deletion actor tag: {error}"))?,
            ];
            if let Some(reason) = public_reason.as_deref() {
                tags.push(
                    Tag::parse(["public-reason", reason])
                        .map_err(|error| format!("moderation deletion reason tag: {error}"))?,
                );
            }
            let deletion = EventBuilder::new(Kind::Custom(5), "")
                .tags(tags)
                .sign_with_keys(&self.signer)
                .map_err(|error| format!("sign moderation deletion: {error}"))?;
            self.persist_and_publish(deletion)?;
        }
        if action == "kick" {
            self.publish_membership_snapshot()?;
        }
        Ok(())
    }

    pub(super) fn require_moderator(&self, pubkey: &str) -> Result<(), String> {
        match self.member_role(pubkey)?.as_deref() {
            Some("owner" | "admin") => Ok(()),
            _ => Err("forbidden: moderator role required".to_string()),
        }
    }

    pub(super) fn member_role(&self, pubkey: &str) -> Result<Option<String>, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .query_row(
                "SELECT role FROM community_members WHERE pubkey = ?1 AND removed_at IS NULL",
                [pubkey.to_ascii_lowercase()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| format!("read community role: {error}"))
    }
}

pub(super) async fn reports(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(query): Query<ReportQuery>,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "GET", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    match authority.moderation_reports(&actor, query.status.as_deref(), query.limit.unwrap_or(100))
    {
        Ok(rows) => Json(rows).into_response(),
        Err(error) if error.starts_with("forbidden:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub(super) async fn audit(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(query): Query<AuditQuery>,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "GET", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    match authority.moderation_audit(&actor, query.limit.unwrap_or(100)) {
        Ok(rows) => Json(rows).into_response(),
        Err(error) if error.starts_with("forbidden:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub(super) async fn restricted(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "GET", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    match authority.moderation_restrictions(&actor) {
        Ok(rows) => Json(rows).into_response(),
        Err(error) if error.starts_with("forbidden:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

pub(super) fn nip98_actor(
    headers: &HeaderMap,
    method: &str,
    uri: &axum::http::Uri,
) -> Result<String, String> {
    nip98_actor_with_payload(headers, method, uri, None)
}

pub(super) fn nip98_actor_with_payload(
    headers: &HeaderMap,
    method: &str,
    uri: &axum::http::Uri,
    payload: Option<&[u8]>,
) -> Result<String, String> {
    let authorization = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Nostr "))
        .ok_or_else(|| "missing NIP-98 authorization".to_string())?;
    let raw = BASE64
        .decode(authorization)
        .map_err(|_| "invalid NIP-98 authorization encoding".to_string())?;
    let event = nostr::Event::from_json(raw)
        .map_err(|_| "invalid NIP-98 authorization event".to_string())?;
    if event.kind.as_u16() as u32 != 27_235 || !event.verify_id() || !event.verify_signature() {
        return Err("invalid NIP-98 authorization signature".to_string());
    }
    let created_at = event.created_at.as_secs() as i64;
    let now = unix_seconds();
    if (created_at - now).abs() > 120 {
        return Err("NIP-98 authorization is expired".to_string());
    }
    if tag_value(&event, "method").as_deref() != Some(method) {
        return Err("NIP-98 method does not match request".to_string());
    }
    let signed_url = tag_value(&event, "u")
        .and_then(|value| url::Url::parse(&value).ok())
        .ok_or_else(|| "NIP-98 request URL is invalid".to_string())?;
    let mut signed_path = signed_url.path().to_string();
    if let Some(query) = signed_url.query() {
        signed_path.push('?');
        signed_path.push_str(query);
    }
    if signed_path != uri.to_string() {
        return Err("NIP-98 request URL does not match request".to_string());
    }
    if let Some(payload) = payload {
        let digest = hex::encode(Sha256::digest(payload));
        if tag_value(&event, "payload").as_deref() != Some(digest.as_str()) {
            return Err("NIP-98 payload hash does not match request".to_string());
        }
    }
    Ok(event.pubkey.to_hex())
}

fn unix_seconds() -> i64 {
    Utc::now().timestamp()
}

fn iso(timestamp: i64) -> String {
    DateTime::<Utc>::from_timestamp(timestamp, 0)
        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
        .to_rfc3339()
}

fn iso_optional(timestamp: Option<i64>) -> Option<String> {
    timestamp.map(iso)
}
