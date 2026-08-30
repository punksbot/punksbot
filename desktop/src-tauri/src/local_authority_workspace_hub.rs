//! Multi-Workspace boundary for the embedded authority.
//!
//! One loopback process owns the registry and lazily opens a fully isolated
//! [`LocalAuthority`] store per Workspace. Separating the SQLite file, media
//! root, Git root, signer and live-event bus makes cross-Workspace leakage
//! structurally impossible instead of relying on callers to remember a filter.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use nostr::Keys;
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use uuid::Uuid;

use super::LocalAuthority;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalWorkspaceRecord {
    pub id: String,
    pub name: String,
    pub owner_pubkey: String,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub(crate) struct LocalAuthorityHub {
    primary: Arc<LocalAuthority>,
    data_dir: PathBuf,
    authorities: Mutex<HashMap<String, Arc<LocalAuthority>>>,
}

impl LocalAuthorityHub {
    pub(crate) const PRIMARY_ID: &'static str = "punks-full-local";

    pub(crate) fn open(data_dir: &Path, owner: Keys) -> Result<Self, String> {
        std::fs::create_dir_all(data_dir)
            .map_err(|error| format!("create local Workspace directory: {error}"))?;
        let primary = Arc::new(LocalAuthority::open(
            &data_dir.join("punks-local-authority.sqlite3"),
            owner.clone(),
        )?);
        primary.seed_minimum_authorities(&owner)?;
        let owner_pubkey = owner.public_key().to_hex();
        let now = unix_seconds();
        {
            let database = primary
                .database
                .lock()
                .map_err(|error| format!("lock Workspace registry: {error}"))?;
            database
                .execute(
                    "INSERT OR IGNORE INTO local_workspaces(
                       id, name, owner_pubkey, archived, created_at, updated_at
                     ) VALUES (?1, 'Punks Full Local', ?2, 0, ?3, ?3)",
                    params![Self::PRIMARY_ID, owner_pubkey, now],
                )
                .map_err(|error| format!("register primary Workspace: {error}"))?;
        }
        let mut authorities = HashMap::new();
        authorities.insert(Self::PRIMARY_ID.to_string(), Arc::clone(&primary));
        Ok(Self {
            primary,
            data_dir: data_dir.to_path_buf(),
            authorities: Mutex::new(authorities),
        })
    }

    pub(crate) fn primary(&self) -> Arc<LocalAuthority> {
        Arc::clone(&self.primary)
    }

    pub(crate) fn list_workspaces(&self) -> Result<Vec<LocalWorkspaceRecord>, String> {
        let database = self
            .primary
            .database
            .lock()
            .map_err(|error| format!("lock Workspace registry: {error}"))?;
        let mut statement = database
            .prepare(
                "SELECT id, name, owner_pubkey, archived, created_at, updated_at
                 FROM local_workspaces ORDER BY created_at ASC, id ASC",
            )
            .map_err(|error| format!("prepare Workspace list: {error}"))?;
        let rows = statement
            .query_map([], read_workspace)
            .map_err(|error| format!("query Workspaces: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read Workspaces: {error}"))
    }

    pub(crate) fn authority(&self, workspace_id: &str) -> Result<Arc<LocalAuthority>, String> {
        validate_workspace_id(workspace_id)?;
        if let Some(authority) = self
            .authorities
            .lock()
            .map_err(|error| format!("lock Workspace authorities: {error}"))?
            .get(workspace_id)
            .cloned()
        {
            return Ok(authority);
        }
        let _record = self
            .find_workspace(workspace_id)?
            .ok_or_else(|| "Workspace not found".to_string())?;
        let database_path = self.workspace_database_path(workspace_id);
        if !database_path.is_file() {
            return Err(
                "Workspace store is missing; refusing to fabricate replacement data".to_string(),
            );
        }
        let authority = Arc::new(LocalAuthority::open_for_workspace(
            &database_path,
            workspace_id,
        )?);
        let mut authorities = self
            .authorities
            .lock()
            .map_err(|error| format!("lock Workspace authorities: {error}"))?;
        Ok(Arc::clone(
            authorities
                .entry(workspace_id.to_string())
                .or_insert(authority),
        ))
    }

    pub(crate) fn create_workspace(
        &self,
        name: &str,
        owner: &Keys,
    ) -> Result<LocalWorkspaceRecord, String> {
        let name = validate_workspace_name(name)?;
        let id = Uuid::new_v4().to_string();
        let workspace_dir = self.workspace_dir(&id);
        std::fs::create_dir_all(&workspace_dir)
            .map_err(|error| format!("create Workspace storage: {error}"))?;
        let authority = Arc::new(LocalAuthority::open_for_workspace(
            &workspace_dir.join("authority.sqlite3"),
            &id,
        )?);
        authority.seed_minimum_authorities(owner)?;
        let owner_pubkey = owner.public_key().to_hex();
        let now = unix_seconds();
        {
            let database = self
                .primary
                .database
                .lock()
                .map_err(|error| format!("lock Workspace registry: {error}"))?;
            database
                .execute(
                    "INSERT INTO local_workspaces(
                       id, name, owner_pubkey, archived, created_at, updated_at
                     ) VALUES (?1, ?2, ?3, 0, ?4, ?4)",
                    params![id, name, owner_pubkey, now],
                )
                .map_err(|error| format!("register Workspace: {error}"))?;
            database
                .execute(
                    "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                     VALUES ('workspace.created', ?1, ?2, ?3, ?4)",
                    params![owner_pubkey, id, serde_json::json!({"name": name}).to_string(), now],
                )
                .map_err(|error| format!("audit Workspace creation: {error}"))?;
        }
        self.authorities
            .lock()
            .map_err(|error| format!("lock Workspace authorities: {error}"))?
            .insert(id.clone(), authority);
        self.find_workspace(&id)?
            .ok_or_else(|| "created Workspace is missing".to_string())
    }

    pub(crate) fn rename_workspace(
        &self,
        workspace_id: &str,
        name: &str,
    ) -> Result<LocalWorkspaceRecord, String> {
        validate_workspace_id(workspace_id)?;
        let name = validate_workspace_name(name)?;
        let now = unix_seconds();
        let database = self
            .primary
            .database
            .lock()
            .map_err(|error| format!("lock Workspace registry: {error}"))?;
        let changed = database
            .execute(
                "UPDATE local_workspaces SET name = ?2, updated_at = ?3 WHERE id = ?1",
                params![workspace_id, name, now],
            )
            .map_err(|error| format!("rename Workspace: {error}"))?;
        drop(database);
        if changed == 0 {
            return Err("Workspace not found".to_string());
        }
        self.find_workspace(workspace_id)?
            .ok_or_else(|| "renamed Workspace is missing".to_string())
    }

    pub(crate) fn set_workspace_archived(
        &self,
        workspace_id: &str,
        archived: bool,
    ) -> Result<LocalWorkspaceRecord, String> {
        validate_workspace_id(workspace_id)?;
        if workspace_id == Self::PRIMARY_ID && archived {
            return Err("primary Workspace cannot be archived".to_string());
        }
        let now = unix_seconds();
        let database = self
            .primary
            .database
            .lock()
            .map_err(|error| format!("lock Workspace registry: {error}"))?;
        let changed = database
            .execute(
                "UPDATE local_workspaces SET archived = ?2, updated_at = ?3 WHERE id = ?1",
                params![workspace_id, i64::from(archived), now],
            )
            .map_err(|error| format!("update Workspace lifecycle: {error}"))?;
        drop(database);
        if changed == 0 {
            return Err("Workspace not found".to_string());
        }
        self.find_workspace(workspace_id)?
            .ok_or_else(|| "updated Workspace is missing".to_string())
    }

    pub(crate) fn onboard_account(&self, keys: &Keys, display_name: &str) -> Result<(), String> {
        for record in self.list_workspaces()? {
            self.authority(&record.id)?
                .onboard_account(keys, display_name)?;
        }
        Ok(())
    }

    pub(crate) fn ensure_agent_member_for_relay(
        &self,
        relay_url: &str,
        pubkey: &str,
    ) -> Result<(), String> {
        if pubkey.len() != 64 || !pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("managed agent membership requires a valid pubkey".to_string());
        }
        let url = reqwest::Url::parse(relay_url)
            .map_err(|error| format!("parse managed agent Workspace relay: {error}"))?;
        if !matches!(url.scheme(), "ws" | "wss") {
            return Err("managed agent Workspace relay must use ws or wss".to_string());
        }
        let host = url
            .host_str()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        let workspace_id = if matches!(host.as_str(), "127.0.0.1" | "localhost") {
            Self::PRIMARY_ID.to_string()
        } else {
            let workspace_id = host.strip_suffix(".localhost").ok_or_else(|| {
                "managed agent membership accepts local Workspace relays only".to_string()
            })?;
            Uuid::parse_str(workspace_id)
                .map_err(|_| "managed agent Workspace relay has an invalid host".to_string())?;
            workspace_id.to_string()
        };
        let authority = self.authority(&workspace_id)?;
        authority.ensure_community_member(pubkey, "bot")?;
        authority.publish_membership_snapshot()
    }

    pub(crate) fn authorities(&self) -> Result<Vec<Arc<LocalAuthority>>, String> {
        self.list_workspaces()?
            .into_iter()
            .filter(|record| !record.archived)
            .map(|record| self.authority(&record.id))
            .collect()
    }

    fn find_workspace(&self, workspace_id: &str) -> Result<Option<LocalWorkspaceRecord>, String> {
        let database = self
            .primary
            .database
            .lock()
            .map_err(|error| format!("lock Workspace registry: {error}"))?;
        database
            .query_row(
                "SELECT id, name, owner_pubkey, archived, created_at, updated_at
                 FROM local_workspaces WHERE id = ?1",
                [workspace_id],
                read_workspace,
            )
            .optional()
            .map_err(|error| format!("read Workspace: {error}"))
    }

    fn workspace_dir(&self, workspace_id: &str) -> PathBuf {
        self.data_dir.join("workspaces").join(workspace_id)
    }

    fn workspace_database_path(&self, workspace_id: &str) -> PathBuf {
        self.workspace_dir(workspace_id).join("authority.sqlite3")
    }
}

fn read_workspace(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalWorkspaceRecord> {
    Ok(LocalWorkspaceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        owner_pubkey: row.get(2)?,
        archived: row.get::<_, i64>(3)? != 0,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn validate_workspace_id(workspace_id: &str) -> Result<(), String> {
    if workspace_id == LocalAuthorityHub::PRIMARY_ID || Uuid::parse_str(workspace_id).is_ok() {
        Ok(())
    } else {
        Err("invalid Workspace id".to_string())
    }
}

fn validate_workspace_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err("Workspace name must contain 1 to 80 characters".to_string());
    }
    if name.chars().any(char::is_control) {
        return Err("Workspace name contains unsupported control characters".to_string());
    }
    Ok(name.to_string())
}

fn unix_seconds() -> i64 {
    chrono::Utc::now().timestamp()
}
