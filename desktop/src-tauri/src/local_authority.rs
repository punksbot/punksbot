//! Persistent, in-process Nostr authority for Punks Full Local.
//!
//! The rich desktop command surface converges here on local Nostr/HTTP contracts
//! backed by one embedded authority process and an isolated SQLite store per
//! Workspace.

use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use nostr::{Event, EventBuilder, JsonUtil, Keys, Kind, Tag};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;
#[cfg(test)]
use uuid::Uuid;

#[path = "local_authority_accounts.rs"]
pub(crate) mod accounts;
#[path = "local_authority_canvas.rs"]
mod canvas;
#[path = "local_authority_channel_ttl.rs"]
mod channel_ttl;
#[path = "local_authority_channel_window.rs"]
mod channel_window;
#[path = "local_authority_channels.rs"]
mod channels;
#[path = "local_authority_content.rs"]
mod content;
#[path = "local_authority_dms.rs"]
mod dms;
#[path = "local_authority_git.rs"]
mod git;
#[path = "local_authority_governance.rs"]
mod governance;
#[path = "local_authority_http.rs"]
mod http;
#[path = "local_authority_huddles.rs"]
pub(crate) mod huddles;
#[path = "local_authority_identity_archive.rs"]
mod identity_archive;
#[path = "local_authority_invites.rs"]
mod invites;
#[path = "local_authority_lifecycle.rs"]
mod lifecycle;
#[path = "local_authority_media.rs"]
mod media;
#[path = "local_authority_membership.rs"]
mod membership;
#[path = "local_authority_migrations.rs"]
mod migrations;
#[path = "local_authority_query.rs"]
mod query_index;
#[path = "local_authority_reminders.rs"]
pub(crate) mod reminders;
#[path = "local_authority_runtime.rs"]
mod runtime;
#[path = "local_authority_visibility.rs"]
mod visibility;
#[path = "local_authority_websocket.rs"]
mod websocket;
#[path = "local_authority_workflows.rs"]
mod workflows;
#[path = "local_authority_workspace.rs"]
mod workspace;
#[path = "local_authority_workspace_hub.rs"]
pub(crate) mod workspace_hub;
#[cfg(test)]
#[path = "local_authority_workspace_hub_tests.rs"]
mod workspace_hub_tests;

#[cfg(test)]
use http::authority_router;
pub(super) use http::error_response;
pub(crate) use runtime::start;
use workspace_hub::LocalAuthorityHub;

const DEFAULT_PORT: u16 = 18_787;
const GENERAL_CHANNEL_ID: &str = "00000000-0000-4000-8000-000000000001";

#[cfg(feature = "punks-local")]
pub(crate) fn ensure_managed_agent_workspace_member(
    app: &tauri::AppHandle,
    relay_url: &str,
    pubkey: &str,
) -> Result<(), String> {
    use tauri::Manager;

    let hub = app
        .try_state::<Arc<LocalAuthorityHub>>()
        .ok_or_else(|| "local Workspace authority is unavailable".to_string())?;
    hub.ensure_agent_member_for_relay(relay_url, pubkey)
}

#[derive(Clone)]
pub(crate) struct LocalAuthority {
    database: Arc<Mutex<Connection>>,
    media_dir: Arc<PathBuf>,
    git_dir: Arc<PathBuf>,
    signer: Keys,
    workflow_signer: Keys,
    live_events: broadcast::Sender<Event>,
    huddles: Arc<huddles::LocalHuddleHub>,
    workspace_id: Arc<str>,
}

#[derive(Debug, Serialize)]
struct SubmitResponse {
    event_id: String,
    accepted: bool,
    message: String,
}

struct PersistOutcome {
    inserted: bool,
    projected_events: Vec<Event>,
    ttl_channel: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct AuditEntry {
    action: String,
    actor_pubkey: String,
    target_id: String,
    created_at: i64,
}

impl LocalAuthority {
    fn open(path: &Path, _active_punk: Keys) -> Result<Self, String> {
        Self::open_for_workspace(path, LocalAuthorityHub::PRIMARY_ID)
    }

    fn open_for_workspace(path: &Path, workspace_id: &str) -> Result<Self, String> {
        let media_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("media");
        std::fs::create_dir_all(&media_dir)
            .map_err(|error| format!("create local media directory: {error}"))?;
        let git_dir = path.parent().unwrap_or_else(|| Path::new(".")).join("git");
        std::fs::create_dir_all(&git_dir)
            .map_err(|error| format!("create local Git directory: {error}"))?;
        let mut connection = Connection::open(path)
            .map_err(|error| format!("open local authority database: {error}"))?;
        migrations::migrate(&mut connection)?;
        let (live_events, _) = broadcast::channel(1_024);
        let authority_signer = load_or_create_authority_keys(path)?;
        let workflow_signer = load_or_create_service_keys(path, "workflow.key", "workflow Bot")?;
        Ok(Self {
            database: Arc::new(Mutex::new(connection)),
            media_dir: Arc::new(media_dir),
            git_dir: Arc::new(git_dir),
            signer: authority_signer,
            workflow_signer,
            live_events,
            huddles: Arc::new(huddles::LocalHuddleHub::default()),
            workspace_id: Arc::from(workspace_id),
        })
    }

    fn workspace_id(&self) -> &str {
        &self.workspace_id
    }

    fn loopback_host(&self) -> String {
        let port = std::env::var("PUNKS_LOCAL_PORT")
            .ok()
            .and_then(|value| value.parse::<u16>().ok())
            .unwrap_or(DEFAULT_PORT);
        if self.workspace_id() == LocalAuthorityHub::PRIMARY_ID {
            format!("127.0.0.1:{port}")
        } else {
            format!("{}.localhost:{port}", self.workspace_id())
        }
    }

    fn seed_minimum_authorities(&self, owner: &Keys) -> Result<(), String> {
        let owner_pubkey = owner.public_key().to_hex();
        let workflow_pubkey = self.workflow_signer.public_key().to_hex();
        self.ensure_community_member(&owner_pubkey, "owner")?;
        self.ensure_community_member(&workflow_pubkey, "bot")?;
        if self
            .query(&[json!({"kinds": [0], "authors": [&owner_pubkey], "limit": 1})])?
            .is_empty()
        {
            let profile = EventBuilder::new(
                Kind::Metadata,
                json!({
                    "name": "Local Punk",
                    "display_name": "Local Punk",
                    "about": "Punks Full Local"
                })
                .to_string(),
            )
            .sign_with_keys(owner)
            .map_err(|error| format!("sign initial local profile: {error}"))?;
            self.persist_and_publish(profile)?;
        }
        if self
            .query(&[json!({"kinds": [0], "authors": [&workflow_pubkey], "limit": 1})])?
            .is_empty()
        {
            let profile = EventBuilder::new(
                Kind::Metadata,
                json!({
                    "name": "Punks Workflow",
                    "display_name": "Punks Workflow",
                    "about": "Local workflow runtime for Punks Full Local",
                    "bot": true
                })
                .to_string(),
            )
            .sign_with_keys(&self.workflow_signer)
            .map_err(|error| format!("sign local workflow Bot profile: {error}"))?;
            self.persist_and_publish(profile)?;
        }

        if self
            .query(&[json!({"kinds": [39000], "#d": [GENERAL_CHANNEL_ID], "limit": 1})])?
            .is_empty()
        {
            self.publish_channel_snapshot(
                GENERAL_CHANNEL_ID,
                "general",
                "The local Punks workspace",
                "stream",
                "open",
                false,
                &[
                    (owner_pubkey.clone(), "owner".to_string()),
                    (workflow_pubkey.clone(), "bot".to_string()),
                ],
            )?;
        } else {
            let mut members = self.channel_members(GENERAL_CHANNEL_ID)?;
            if !members.iter().any(|(pubkey, _)| pubkey == &workflow_pubkey) {
                upsert_member(&mut members, workflow_pubkey, "bot".to_string());
                let metadata = self
                    .channel_metadata(GENERAL_CHANNEL_ID)?
                    .ok_or_else(|| "general Conversation metadata is missing".to_string())?;
                self.publish_channel_snapshot(
                    GENERAL_CHANNEL_ID,
                    &tag_value(&metadata, "name").unwrap_or_else(|| "general".to_string()),
                    &tag_value(&metadata, "about").unwrap_or_default(),
                    &tag_value(&metadata, "t").unwrap_or_else(|| "stream".to_string()),
                    if has_tag(&metadata, "private") {
                        "private"
                    } else {
                        "open"
                    },
                    tag_value(&metadata, "archived").as_deref() == Some("true"),
                    &members,
                )?;
            }
        }
        self.publish_membership_snapshot()?;
        Ok(())
    }

    pub(crate) fn onboard_account(&self, keys: &Keys, display_name: &str) -> Result<(), String> {
        let display_name = display_name.trim();
        if display_name.is_empty() || display_name.chars().count() > 80 {
            return Err("account display name must contain 1 to 80 characters".to_string());
        }
        let pubkey = keys.public_key().to_hex();
        self.ensure_community_member(&pubkey, "member")?;
        let workspace_role = self
            .member_role(&pubkey)?
            .unwrap_or_else(|| "member".to_string());
        if self
            .query(&[json!({"kinds": [0], "authors": [&pubkey], "limit": 1})])?
            .is_empty()
        {
            let profile = EventBuilder::new(
                Kind::Metadata,
                json!({
                    "name": display_name,
                    "display_name": display_name,
                    "about": "Punks Full Local"
                })
                .to_string(),
            )
            .sign_with_keys(keys)
            .map_err(|error| format!("sign local account profile: {error}"))?;
            self.persist_and_publish(profile)?;
        }

        let mut members = self.channel_members(GENERAL_CHANNEL_ID)?;
        upsert_member(&mut members, pubkey, workspace_role);
        let metadata = self
            .channel_metadata(GENERAL_CHANNEL_ID)?
            .ok_or_else(|| "general channel authority is missing".to_string())?;
        let name = tag_value(&metadata, "name").unwrap_or_else(|| "general".to_string());
        let about = tag_value(&metadata, "about").unwrap_or_default();
        let channel_type = tag_value(&metadata, "t").unwrap_or_else(|| "stream".to_string());
        let visibility = if has_tag(&metadata, "private") {
            "private"
        } else {
            "open"
        };
        let archived = tag_value(&metadata, "archived").as_deref() == Some("true");
        self.publish_channel_snapshot(
            GENERAL_CHANNEL_ID,
            &name,
            &about,
            &channel_type,
            visibility,
            archived,
            &members,
        )?;
        self.publish_membership_snapshot()
    }

    fn persist_and_publish(&self, event: Event) -> Result<bool, String> {
        let outcome = self.persist(&event)?;
        if outcome.inserted || is_ephemeral(event.kind.as_u16() as u32) {
            let _ = self.live_events.send(event);
        }
        for projected in outcome.projected_events {
            let _ = self.live_events.send(projected);
        }
        if let Some(channel_id) = outcome.ttl_channel {
            self.sync_channel_ttl_metadata(&channel_id)?;
        }
        Ok(outcome.inserted)
    }

    fn persist(&self, event: &Event) -> Result<PersistOutcome, String> {
        if !event.verify_id() || !event.verify_signature() {
            return Err("event signature or id is invalid".to_string());
        }
        let kind = event.kind.as_u16() as u32;
        if is_ephemeral(kind) {
            return Ok(PersistOutcome {
                inserted: false,
                projected_events: Vec::new(),
                ttl_channel: None,
            });
        }

        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local authority transaction: {error}"))?;
        if is_replaceable(kind) {
            let d_tag = if is_addressable(kind) {
                tag_value(event, "d").unwrap_or_default()
            } else {
                String::new()
            };
            let existing = latest_replaceable(&transaction, event, &d_tag)?;
            if let Some((existing_id, existing_created_at)) = existing {
                let incoming_created_at = event.created_at.as_secs() as i64;
                if existing_created_at > incoming_created_at
                    || (existing_created_at == incoming_created_at
                        && existing_id.as_str() >= event.id.to_hex().as_str())
                {
                    return Ok(PersistOutcome {
                        inserted: false,
                        projected_events: Vec::new(),
                        ttl_channel: None,
                    });
                }
                transaction
                    .execute("DELETE FROM events WHERE id = ?1", [&existing_id])
                    .map_err(|error| format!("replace local authority event: {error}"))?;
                transaction
                    .execute("DELETE FROM events_fts WHERE event_id = ?1", [&existing_id])
                    .map_err(|error| format!("replace local authority search row: {error}"))?;
            }
        }
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO events(id, pubkey, kind, created_at, raw_json)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    event.id.to_hex(),
                    event.pubkey.to_hex(),
                    kind as i64,
                    event.created_at.as_secs() as i64,
                    event.as_json(),
                ],
            )
            .map_err(|error| format!("persist local authority event: {error}"))?
            == 1;
        let (projected_events, ttl_channel) = if inserted {
            migrations::index_event(&transaction, event)?;
            workflows::project_definition(&transaction, event)?;
            reminders::project(&transaction, event)?;
            let ttl_channel = channel_ttl::project(&transaction, event)?;
            let projected = self.project_message_lifecycle(&transaction, event)?;
            transaction
                .execute(
                    "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                     VALUES ('event.accepted', ?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        event.pubkey.to_hex(),
                        event.id.to_hex(),
                        json!({"kind": kind}).to_string(),
                        event.created_at.as_secs() as i64
                    ],
                )
                .map_err(|error| format!("audit local authority event: {error}"))?;
            (projected, ttl_channel)
        } else {
            (Vec::new(), None)
        };
        transaction
            .commit()
            .map_err(|error| format!("commit local authority event: {error}"))?;
        Ok(PersistOutcome {
            inserted,
            projected_events,
            ttl_channel,
        })
    }

    fn audit_entries(&self, limit: usize) -> Result<Vec<AuditEntry>, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let mut statement = database
            .prepare(
                "SELECT action, actor_pubkey, target_id, created_at
                 FROM audit_log ORDER BY id DESC LIMIT ?1",
            )
            .map_err(|error| format!("prepare local authority audit: {error}"))?;
        let rows = statement
            .query_map([limit.clamp(1, 1_000) as i64], |row| {
                Ok(AuditEntry {
                    action: row.get(0)?,
                    actor_pubkey: row.get(1)?,
                    target_id: row.get(2)?,
                    created_at: row.get(3)?,
                })
            })
            .map_err(|error| format!("query local authority audit: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read local authority audit: {error}"))
    }

    fn query(&self, filters: &[Value]) -> Result<Vec<Event>, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let mut seen = HashSet::new();
        let mut result = Vec::new();
        for filter in filters {
            let search = filter
                .get("search")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let candidates = query_index::load_query_candidates(&database, search)?;
            let mut indexed_filter = filter.clone();
            if let Some(object) = indexed_filter.as_object_mut() {
                object.remove("search");
            }
            for event in query_index::apply_filters(&candidates, &[indexed_filter]) {
                if seen.insert(event.id.to_hex()) {
                    result.push(event);
                }
            }
        }
        query_index::sort_events(&mut result);
        Ok(result)
    }

    fn submit(&self, event: Event) -> Result<SubmitResponse, String> {
        if !event.verify_id() || !event.verify_signature() {
            return Err("event signature or id is invalid".to_string());
        }
        let kind = event.kind.as_u16() as u32;
        if matches!(kind, 1984 | 9040..=9044) {
            return self.submit_governance_event(&event);
        }
        if matches!(kind, 9030..=9032) {
            return self.submit_membership_command(&event);
        }
        if kind == 9_033 {
            return self.submit_workspace_profile_command(&event);
        }
        if matches!(kind, 9_035 | 9_036) {
            return self.submit_identity_archive_command(&event);
        }
        if matches!(kind, 46_030..=46_031) {
            return workflows::approval_command(self, &event);
        }
        self.assert_member_can_publish(&event.pubkey.to_hex())?;
        if !matches!(kind, 9_000..=9_033 | 41_010 | 46_020) {
            self.assert_event_channel_access(&event)?;
        }
        if kind == 40_100 {
            self.validate_canvas_revision(&event)?;
        }
        if matches!(kind, 40_004..=40_005) {
            self.validate_content_marker(&event)?;
        }
        if matches!(kind, 5 | 9_005 | 40_003 | 40_009 | 40_010) {
            self.validate_message_lifecycle(&event)?;
        }
        let message = self.apply_command(&event)?;
        if kind == 30_617 {
            self.ensure_git_repository_from_event(&event)?;
        }
        self.persist_and_publish(event.clone())?;
        Ok(SubmitResponse {
            event_id: event.id.to_hex(),
            accepted: true,
            message,
        })
    }

    fn apply_command(&self, event: &Event) -> Result<String, String> {
        match event.kind.as_u16() as u32 {
            9007 => self.create_channel(event),
            9002 => {
                self.update_channel(event)?;
                Ok(String::new())
            }
            9008 => {
                self.delete_channel(event)?;
                Ok(String::new())
            }
            9005 => Ok(String::new()),
            9009 => invites::create_from_command(self, event),
            9000 | 9001 | 9021 | 9022 => {
                self.update_members(event)?;
                Ok(String::new())
            }
            41010 => self.open_dm(event),
            41011 => {
                self.add_dm_member(event)?;
                Ok(String::new())
            }
            41012 => {
                self.hide_dm(event)?;
                Ok(String::new())
            }
            30620 => workflows::save_definition(self, event),
            46020 => workflows::trigger(self, event),
            9_000..=9_044 | 46_030..=46_031 => Err(format!(
                "contract: command kind {} is not implemented locally",
                event.kind.as_u16()
            )),
            _ => Ok(String::new()),
        }
    }

    fn update_members(&self, event: &Event) -> Result<(), String> {
        let channel_id = required_tag(event, "h")?;
        let mut members = self.channel_members(&channel_id)?;
        let actor = event.pubkey.to_hex();
        match event.kind.as_u16() as u32 {
            9021 => upsert_member(&mut members, actor, "member".to_string()),
            9022 => members.retain(|(pubkey, _)| pubkey != &actor),
            9000 => {
                let target = required_tag(event, "p")?;
                let role = tag_value(event, "role").unwrap_or_else(|| "member".to_string());
                upsert_member(&mut members, target.clone(), role.clone());
                if role == "bot" {
                    self.ensure_community_member(&target, "bot")?;
                    self.publish_membership_snapshot()?;
                }
            }
            9001 => {
                let target = required_tag(event, "p")?;
                members.retain(|(pubkey, _)| pubkey != &target);
            }
            _ => {}
        }
        let metadata = self.channel_metadata(&channel_id)?;
        let name = metadata
            .as_ref()
            .and_then(|item| tag_value(item, "name"))
            .unwrap_or_else(|| "stream".to_string());
        let about = metadata
            .as_ref()
            .and_then(|item| tag_value(item, "about"))
            .unwrap_or_default();
        let channel_type = metadata
            .as_ref()
            .and_then(|item| tag_value(item, "t"))
            .unwrap_or_else(|| "stream".to_string());
        let visibility = if metadata
            .as_ref()
            .is_some_and(|item| has_tag(item, "private"))
        {
            "private"
        } else {
            "open"
        };
        let archived = metadata
            .as_ref()
            .is_some_and(|item| tag_value(item, "archived").as_deref() == Some("true"));
        self.publish_channel_snapshot(
            &channel_id,
            &name,
            &about,
            &channel_type,
            visibility,
            archived,
            &members,
        )
    }

    fn delete_channel(&self, event: &Event) -> Result<(), String> {
        let channel_id = required_tag(event, "h")?;
        let candidates = self.query(&[json!({})])?;
        let ids = candidates
            .iter()
            .filter(|candidate| {
                tag_value(candidate, "h").as_deref() == Some(channel_id.as_str())
                    || tag_value(candidate, "d").as_deref() == Some(channel_id.as_str())
            })
            .map(|candidate| candidate.id.to_hex())
            .collect::<Vec<_>>();
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        for id in ids {
            database
                .execute("DELETE FROM events WHERE id = ?1", [&id])
                .map_err(|error| format!("delete local channel event: {error}"))?;
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn publish_channel_snapshot(
        &self,
        channel_id: &str,
        name: &str,
        about: &str,
        channel_type: &str,
        visibility: &str,
        archived: bool,
        members: &[(String, String)],
    ) -> Result<(), String> {
        let retained_metadata = self.channel_metadata(channel_id)?;
        let mut metadata_tags = vec![
            parse_tag(["d", channel_id])?,
            parse_tag(["name", name])?,
            parse_tag(["closed"])?,
            parse_tag(["t", channel_type])?,
        ];
        if !about.is_empty() {
            metadata_tags.push(parse_tag(["about", about])?);
        }
        metadata_tags.push(if visibility == "private" {
            parse_tag(["private"])?
        } else {
            parse_tag(["public"])?
        });
        if channel_type == "dm" {
            metadata_tags.push(parse_tag(["hidden"])?);
            for (pubkey, _) in members {
                metadata_tags.push(parse_tag(["p", pubkey])?);
            }
        }
        if archived {
            metadata_tags.push(parse_tag(["archived", "true"])?);
        }
        if let Some(metadata) = retained_metadata {
            for field in ["topic", "purpose", "ttl", "ttl_deadline"] {
                if let Some(value) = tag_value(&metadata, field) {
                    metadata_tags.push(parse_tag([field, &value])?);
                }
            }
        }
        let metadata = EventBuilder::new(Kind::Custom(39000), "")
            .tags(metadata_tags)
            .allow_self_tagging()
            .custom_created_at(self.next_snapshot_timestamp(39000, channel_id)?)
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local channel metadata: {error}"))?;
        self.persist_and_publish(metadata)?;

        let mut admin_tags = vec![parse_tag(["d", channel_id])?];
        for (pubkey, role) in members
            .iter()
            .filter(|(_, role)| role == "owner" || role == "admin")
        {
            admin_tags.push(parse_tag(["p", pubkey, "", role])?);
        }
        let admins = EventBuilder::new(Kind::Custom(39001), "")
            .tags(admin_tags)
            .allow_self_tagging()
            .custom_created_at(self.next_snapshot_timestamp(39001, channel_id)?)
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local channel admins: {error}"))?;
        self.persist_and_publish(admins)?;

        let mut member_tags = vec![parse_tag(["d", channel_id])?];
        for (pubkey, role) in members {
            member_tags.push(parse_tag(["p", pubkey, "", role])?);
        }
        let membership = EventBuilder::new(Kind::Custom(39002), "")
            .tags(member_tags)
            .allow_self_tagging()
            .custom_created_at(self.next_snapshot_timestamp(39002, channel_id)?)
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local channel membership: {error}"))?;
        self.persist_and_publish(membership)?;
        Ok(())
    }

    fn channel_metadata(&self, channel_id: &str) -> Result<Option<Event>, String> {
        Ok(self
            .query(&[json!({"kinds": [39000], "#d": [channel_id], "limit": 1})])?
            .into_iter()
            .next())
    }

    fn channel_members(&self, channel_id: &str) -> Result<Vec<(String, String)>, String> {
        let Some(event) = self
            .query(&[json!({"kinds": [39002], "#d": [channel_id], "limit": 1})])?
            .into_iter()
            .next()
        else {
            return Ok(Vec::new());
        };
        Ok(event
            .tags
            .iter()
            .filter_map(|tag| {
                let values = tag.as_slice();
                if values.first().map(String::as_str) != Some("p") {
                    return None;
                }
                Some((
                    values.get(1)?.clone(),
                    values
                        .get(3)
                        .filter(|value| !value.is_empty())
                        .cloned()
                        .unwrap_or_else(|| "member".to_string()),
                ))
            })
            .collect())
    }

    fn next_snapshot_timestamp(
        &self,
        kind: u16,
        channel_id: &str,
    ) -> Result<nostr::Timestamp, String> {
        let previous = self
            .query(&[json!({"kinds": [kind], "#d": [channel_id], "limit": 1})])?
            .into_iter()
            .next()
            .map(|event| event.created_at.as_secs())
            .unwrap_or_default();
        let now = nostr::Timestamp::now().as_secs();
        Ok(nostr::Timestamp::from(now.max(previous.saturating_add(1))))
    }
}

fn latest_replaceable(
    database: &Connection,
    event: &Event,
    d_tag: &str,
) -> Result<Option<(String, i64)>, String> {
    let mut statement = database
        .prepare(
            "SELECT id, created_at, raw_json FROM events
             WHERE pubkey = ?1 AND kind = ?2
             ORDER BY created_at DESC, id DESC",
        )
        .map_err(|error| format!("prepare replaceable lookup: {error}"))?;
    let rows = statement
        .query_map(
            params![event.pubkey.to_hex(), event.kind.as_u16() as i64],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .map_err(|error| format!("query replaceable lookup: {error}"))?;
    for row in rows {
        let (id, created_at, raw) =
            row.map_err(|error| format!("read replaceable lookup: {error}"))?;
        if !is_addressable(event.kind.as_u16() as u32)
            || Event::from_json(raw)
                .ok()
                .and_then(|candidate| tag_value(&candidate, "d"))
                .as_deref()
                == Some(d_tag)
        {
            return Ok(Some((id, created_at)));
        }
    }
    Ok(None)
}

fn is_ephemeral(kind: u32) -> bool {
    (20_000..30_000).contains(&kind)
}

fn is_addressable(kind: u32) -> bool {
    (30_000..40_000).contains(&kind)
}

fn is_replaceable(kind: u32) -> bool {
    matches!(kind, 0 | 3 | 10_000..=19_999) || is_addressable(kind)
}

fn tag_value(event: &Event, name: &str) -> Option<String> {
    event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        (values.first().map(String::as_str) == Some(name))
            .then(|| values.get(1).cloned())
            .flatten()
    })
}

fn required_tag(event: &Event, name: &str) -> Result<String, String> {
    tag_value(event, name).ok_or_else(|| format!("kind {} requires {name} tag", event.kind))
}

fn has_tag(event: &Event, name: &str) -> bool {
    event
        .tags
        .iter()
        .any(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
}

fn parse_tag<const N: usize>(values: [&str; N]) -> Result<Tag, String> {
    Tag::parse(values).map_err(|error| format!("build local authority tag: {error}"))
}

fn upsert_member(members: &mut Vec<(String, String)>, pubkey: String, role: String) {
    if let Some(existing) = members
        .iter_mut()
        .find(|(existing_pubkey, _)| existing_pubkey == &pubkey)
    {
        existing.1 = role;
    } else {
        members.push((pubkey, role));
    }
}

fn load_or_create_authority_keys(database_path: &Path) -> Result<Keys, String> {
    load_or_create_service_keys(database_path, "authority.key", "authority")
}

fn load_or_create_service_keys(
    database_path: &Path,
    filename: &str,
    label: &str,
) -> Result<Keys, String> {
    let key_path = database_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(filename);
    match std::fs::read_to_string(&key_path) {
        Ok(secret) => {
            return Keys::parse(secret.trim())
                .map_err(|error| format!("parse local {label} identity: {error}"));
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!("read local {label} identity: {error}"));
        }
        Err(_) => {}
    }

    let keys = Keys::generate();
    let secret = keys.secret_key().to_secret_hex();
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(&key_path) {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(secret.as_bytes())
                .and_then(|_| file.sync_all())
                .map_err(|error| format!("persist local {label} identity: {error}"))?;
            Ok(keys)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let secret = std::fs::read_to_string(&key_path)
                .map_err(|read_error| format!("read raced local {label} identity: {read_error}"))?;
            Keys::parse(secret.trim())
                .map_err(|parse_error| format!("parse raced local {label} identity: {parse_error}"))
        }
        Err(error) => Err(format!("create local {label} identity: {error}")),
    }
}

#[cfg(test)]
#[path = "local_authority_tests.rs"]
mod tests;
