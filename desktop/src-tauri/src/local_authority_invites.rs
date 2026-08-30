use axum::{
    extract::{Extension, OriginalUri},
    http::{HeaderMap, Response, StatusCode},
    response::{IntoResponse, Json},
};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

use super::{error_response, governance::nip98_actor, tag_value, upsert_member, LocalAuthority};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(super) struct InviteRecord {
    pub code: String,
    pub expires_at: i64,
    pub max_uses: Option<u32>,
    pub uses_remaining: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(super) struct InviteClaim {
    pub status: String,
    pub community_id: String,
    pub host: String,
    pub role: String,
}

impl LocalAuthority {
    pub(super) fn create_invite(
        &self,
        actor_pubkey: &str,
        ttl_secs: u64,
        max_uses: Option<u32>,
        channel_id: Option<&str>,
    ) -> Result<InviteRecord, String> {
        self.require_moderator(actor_pubkey)?;
        self.insert_invite(actor_pubkey, ttl_secs, max_uses, channel_id)
    }

    fn insert_invite(
        &self,
        actor_pubkey: &str,
        ttl_secs: u64,
        max_uses: Option<u32>,
        channel_id: Option<&str>,
    ) -> Result<InviteRecord, String> {
        let ttl_secs = ttl_secs.clamp(60, 30 * 24 * 60 * 60);
        let max_uses = max_uses.map(|value| value.clamp(1, 1_000));
        let now = unix_seconds();
        let expires_at = now.saturating_add(ttl_secs as i64);
        let code = Uuid::new_v4().simple().to_string();
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .execute(
                "INSERT INTO invitations(code, created_by, channel_id, expires_at,
                     max_uses, uses, revoked_at, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 0, NULL, ?6)",
                params![
                    code,
                    actor_pubkey.to_ascii_lowercase(),
                    channel_id,
                    expires_at,
                    max_uses,
                    now
                ],
            )
            .map_err(|error| format!("create local invitation: {error}"))?;
        Ok(InviteRecord {
            code,
            expires_at,
            max_uses,
            uses_remaining: max_uses,
        })
    }

    pub(super) fn claim_invite(
        &self,
        actor_pubkey: &str,
        code: &str,
    ) -> Result<InviteClaim, String> {
        validate_pubkey(actor_pubkey)?;
        let now = unix_seconds();
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin invitation claim: {error}"))?;
        let invite = transaction
            .query_row(
                "SELECT expires_at, max_uses, uses, revoked_at, channel_id
                 FROM invitations WHERE code = ?1",
                [code],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, Option<u32>>(1)?,
                        row.get::<_, u32>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("read local invitation: {error}"))?
            .ok_or_else(|| "invitation not found".to_string())?;
        if invite.3.is_some() || invite.0 <= now {
            return Err("invitation is no longer valid".to_string());
        }
        if invite.1.is_some_and(|maximum| invite.2 >= maximum) {
            return Err("invitation has no uses remaining".to_string());
        }
        let already_member = transaction
            .query_row(
                "SELECT removed_at IS NULL FROM community_members WHERE pubkey = ?1",
                [actor_pubkey.to_ascii_lowercase()],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map_err(|error| format!("read invitation member: {error}"))?
            .unwrap_or(false);
        if !already_member {
            transaction
                .execute(
                    "UPDATE invitations SET uses = uses + 1 WHERE code = ?1",
                    [code],
                )
                .map_err(|error| format!("consume invitation: {error}"))?;
            transaction
                .execute(
                    "INSERT INTO community_members(pubkey, role, removed_at, created_at, updated_at)
                     VALUES (?1, 'member', NULL, ?2, ?2)
                     ON CONFLICT(pubkey) DO UPDATE SET role = 'member', removed_at = NULL,
                         updated_at = excluded.updated_at",
                    params![actor_pubkey.to_ascii_lowercase(), now],
                )
                .map_err(|error| format!("join invited member: {error}"))?;
        }
        transaction
            .commit()
            .map_err(|error| format!("commit invitation claim: {error}"))?;
        drop(database);

        let mut members = self.channel_members(super::GENERAL_CHANNEL_ID)?;
        upsert_member(
            &mut members,
            actor_pubkey.to_ascii_lowercase(),
            "member".to_string(),
        );
        let metadata = self
            .channel_metadata(super::GENERAL_CHANNEL_ID)?
            .ok_or_else(|| "general channel authority is missing".to_string())?;
        self.publish_channel_snapshot(
            super::GENERAL_CHANNEL_ID,
            &super::tag_value(&metadata, "name").unwrap_or_else(|| "general".to_string()),
            &super::tag_value(&metadata, "about").unwrap_or_default(),
            &super::tag_value(&metadata, "t").unwrap_or_else(|| "stream".to_string()),
            if super::has_tag(&metadata, "private") {
                "private"
            } else {
                "open"
            },
            super::tag_value(&metadata, "archived").as_deref() == Some("true"),
            &members,
        )?;
        self.publish_membership_snapshot()?;

        if let Some(channel_id) = invite
            .4
            .filter(|channel_id| channel_id != super::GENERAL_CHANNEL_ID)
        {
            let metadata = self
                .channel_metadata(&channel_id)?
                .ok_or_else(|| "invitation Conversation no longer exists".to_string())?;
            let mut members = self.channel_members(&channel_id)?;
            upsert_member(
                &mut members,
                actor_pubkey.to_ascii_lowercase(),
                "member".to_string(),
            );
            self.publish_channel_snapshot(
                &channel_id,
                &super::tag_value(&metadata, "name").unwrap_or_else(|| "stream".to_string()),
                &super::tag_value(&metadata, "about").unwrap_or_default(),
                &super::tag_value(&metadata, "t").unwrap_or_else(|| "stream".to_string()),
                if super::has_tag(&metadata, "private") {
                    "private"
                } else {
                    "open"
                },
                super::tag_value(&metadata, "archived").as_deref() == Some("true"),
                &members,
            )?;
        }

        Ok(InviteClaim {
            status: if already_member {
                "already_member".to_string()
            } else {
                "joined".to_string()
            },
            community_id: self.workspace_id().to_string(),
            host: self.loopback_host(),
            role: "member".to_string(),
        })
    }
}

pub(super) fn create_from_command(
    authority: &LocalAuthority,
    event: &nostr::Event,
) -> Result<String, String> {
    let channel_id = tag_value(event, "h")
        .ok_or_else(|| "NIP-29 invitation requires a Conversation h tag".to_string())?;
    if authority.channel_metadata(&channel_id)?.is_none() {
        return Err("invitation Conversation was not found".to_string());
    }
    let actor = event.pubkey.to_hex();
    let role = authority
        .channel_members(&channel_id)?
        .into_iter()
        .find(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&actor))
        .map(|(_, role)| role);
    if !matches!(role.as_deref(), Some("owner" | "admin")) {
        return Err("forbidden: Conversation owner or admin role required".to_string());
    }
    let ttl_secs = tag_value(event, "ttl_secs")
        .map(|value| {
            value
                .parse::<u64>()
                .map_err(|_| "invitation ttl_secs is invalid".to_string())
        })
        .transpose()?
        .unwrap_or(86_400);
    let max_uses = tag_value(event, "max_uses")
        .map(|value| {
            value
                .parse::<u32>()
                .map_err(|_| "invitation max_uses is invalid".to_string())
        })
        .transpose()?;
    let invite = authority.insert_invite(&actor, ttl_secs, max_uses, Some(&channel_id))?;
    Ok(format!(
        "response:{}",
        json!({
            "code": invite.code,
            "expires_at": invite.expires_at,
            "max_uses": invite.max_uses,
            "uses_remaining": invite.uses_remaining,
            "url": format!("punks-local://invite?code={}", invite.code)
        })
    ))
}

pub(super) async fn join_policy() -> impl IntoResponse {
    Json(json!({"policy": null}))
}

pub(super) async fn mint(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "POST", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    let ttl = body
        .get("ttl_secs")
        .and_then(Value::as_u64)
        .unwrap_or(86_400);
    let max_uses = body
        .get("max_uses")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok());
    match authority.create_invite(&actor, ttl, max_uses, None) {
        Ok(invite) => Json(json!({
            "code": invite.code,
            "expires_at": invite.expires_at,
            "url": format!("punks-local://invite?code={}", invite.code),
            "max_uses": invite.max_uses,
            "uses_remaining": invite.uses_remaining
        }))
        .into_response(),
        Err(error) if error.starts_with("forbidden:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error),
    }
}

pub(super) async fn claim(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "POST", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    let Some(code) = body.get("code").and_then(Value::as_str) else {
        return error_response(StatusCode::BAD_REQUEST, "invitation code is required");
    };
    match authority.claim_invite(&actor, code) {
        Ok(claim) => Json(claim).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error),
    }
}

pub(super) async fn accept_policy() -> impl IntoResponse {
    Json(json!({"receipt": Uuid::new_v4().to_string()}))
}

fn validate_pubkey(pubkey: &str) -> Result<(), String> {
    if pubkey.len() == 64 && pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("invalid invited identity".to_string())
    }
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
