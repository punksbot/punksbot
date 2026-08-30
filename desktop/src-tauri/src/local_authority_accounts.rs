use rusqlite::{params, OptionalExtension};
use serde::Serialize;

use super::LocalAuthority;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct LocalAccountRecord {
    pub id: String,
    pub pubkey: String,
    pub display_name: String,
    pub merged_into: Option<String>,
    pub active: bool,
    pub generation: u64,
}

impl LocalAuthority {
    pub(crate) fn register_account(
        &self,
        account_id: &str,
        pubkey: &str,
        display_name: &str,
    ) -> Result<(), String> {
        validate_account_id(account_id)?;
        validate_pubkey(pubkey)?;
        let display_name = validate_display_name(display_name)?;
        let now = unix_seconds();
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let existing = database
            .query_row(
                "SELECT pubkey, display_name FROM accounts WHERE id = ?1",
                [account_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(|error| format!("read local account: {error}"))?;
        if let Some((existing_pubkey, existing_name)) = existing {
            return if existing_pubkey == pubkey && existing_name == display_name {
                Ok(())
            } else {
                Err("account id is already bound to different identity data".to_string())
            };
        }
        database
            .execute(
                "INSERT INTO accounts(id, pubkey, display_name, merged_into, created_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?4)",
                params![account_id, pubkey.to_ascii_lowercase(), display_name, now],
            )
            .map_err(|error| format!("register local account: {error}"))?;
        Ok(())
    }

    pub(crate) fn activate_account(
        &self,
        account_id: &str,
        expected_generation: Option<u64>,
    ) -> Result<u64, String> {
        validate_account_id(account_id)?;
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local account activation: {error}"))?;
        let (pubkey, merged_into) = transaction
            .query_row(
                "SELECT pubkey, merged_into FROM accounts WHERE id = ?1",
                [account_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(|error| format!("read activation account: {error}"))?
            .ok_or_else(|| "account not found".to_string())?;
        if merged_into.is_some() {
            return Err("merged account cannot become active".to_string());
        }
        let current_generation = transaction
            .query_row(
                "SELECT generation FROM account_session WHERE singleton = 1",
                [],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("read account generation: {error}"))?
            .max(0) as u64;
        if expected_generation.is_some_and(|expected| expected != current_generation) {
            return Err("account generation conflict".to_string());
        }
        let generation = current_generation
            .checked_add(1)
            .ok_or_else(|| "account generation exhausted".to_string())?;
        transaction
            .execute(
                "UPDATE account_session
                 SET active_account_id = ?1, generation = ?2
                 WHERE singleton = 1",
                params![account_id, generation as i64],
            )
            .map_err(|error| format!("activate local account: {error}"))?;
        transaction
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES ('account.activated', ?1, ?2, ?3, ?4)",
                params![
                    pubkey,
                    account_id,
                    serde_json::json!({"generation": generation}).to_string(),
                    unix_seconds()
                ],
            )
            .map_err(|error| format!("audit account activation: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit account activation: {error}"))?;
        Ok(generation)
    }

    pub(crate) fn merge_accounts(&self, source_id: &str, target_id: &str) -> Result<(), String> {
        validate_account_id(source_id)?;
        validate_account_id(target_id)?;
        if source_id == target_id {
            return Err("account cannot merge into itself".to_string());
        }
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local account merge: {error}"))?;
        let source = account_head(&transaction, source_id)?;
        let target = account_head(&transaction, target_id)?;
        if source.1.is_some() || target.1.is_some() {
            return Err("only canonical accounts can be merged".to_string());
        }
        transaction
            .execute(
                "UPDATE accounts SET merged_into = ?1, updated_at = ?2 WHERE id = ?3",
                params![target_id, unix_seconds(), source_id],
            )
            .map_err(|error| format!("merge local account: {error}"))?;
        let active_source = transaction
            .query_row(
                "SELECT active_account_id = ?1 FROM account_session WHERE singleton = 1",
                [source_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("read active merge account: {error}"))?;
        if active_source {
            transaction
                .execute(
                    "UPDATE account_session
                     SET active_account_id = ?1, generation = generation + 1
                     WHERE singleton = 1",
                    [target_id],
                )
                .map_err(|error| format!("retarget merged account session: {error}"))?;
        }
        transaction
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES ('account.merged', ?1, ?2, ?3, ?4)",
                params![
                    target.0,
                    source_id,
                    serde_json::json!({"mergedInto": target_id}).to_string(),
                    unix_seconds()
                ],
            )
            .map_err(|error| format!("audit account merge: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit account merge: {error}"))
    }

    pub(crate) fn rename_account(
        &self,
        account_id: &str,
        display_name: &str,
        expected_generation: u64,
    ) -> Result<(), String> {
        validate_account_id(account_id)?;
        let display_name = validate_display_name(display_name)?;
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local account rename: {error}"))?;
        assert_generation(&transaction, expected_generation)?;
        let (pubkey, merged_into) = account_head(&transaction, account_id)?;
        if merged_into.is_some() {
            return Err("merged account aliases cannot be renamed".to_string());
        }
        transaction
            .execute(
                "UPDATE accounts SET display_name = ?2, updated_at = ?3 WHERE id = ?1",
                params![account_id, display_name, unix_seconds()],
            )
            .map_err(|error| format!("rename local account: {error}"))?;
        transaction
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES ('account.renamed', ?1, ?2, ?3, ?4)",
                params![
                    pubkey,
                    account_id,
                    serde_json::json!({"displayName": display_name}).to_string(),
                    unix_seconds()
                ],
            )
            .map_err(|error| format!("audit local account rename: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit local account rename: {error}"))
    }

    pub(crate) fn delete_account(
        &self,
        account_id: &str,
        expected_generation: u64,
    ) -> Result<(), String> {
        validate_account_id(account_id)?;
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local account deletion: {error}"))?;
        assert_generation(&transaction, expected_generation)?;
        let (pubkey, merged_into) = account_head(&transaction, account_id)?;
        if merged_into.is_some() {
            return Err("merged account aliases are durable and cannot be deleted".to_string());
        }
        let active = transaction
            .query_row(
                "SELECT active_account_id = ?1 FROM account_session WHERE singleton = 1",
                [account_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|error| format!("read active account deletion target: {error}"))?;
        if active {
            return Err("active account cannot be deleted; switch accounts first".to_string());
        }
        let alias_count = transaction
            .query_row(
                "SELECT COUNT(*) FROM accounts WHERE merged_into = ?1",
                [account_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("read account merge aliases: {error}"))?;
        if alias_count > 0 {
            return Err("account is a durable merge target and cannot be deleted".to_string());
        }
        transaction
            .execute(
                "DELETE FROM notification_preferences WHERE account_pubkey = ?1",
                [&pubkey],
            )
            .map_err(|error| format!("delete account notification preferences: {error}"))?;
        transaction
            .execute("DELETE FROM accounts WHERE id = ?1", [account_id])
            .map_err(|error| format!("delete local account: {error}"))?;
        transaction
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES ('account.deleted', ?1, ?2, '{}', ?3)",
                params![pubkey, account_id, unix_seconds()],
            )
            .map_err(|error| format!("audit local account deletion: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit local account deletion: {error}"))
    }

    pub(crate) fn resolve_account_alias(&self, account_id: &str) -> Result<String, String> {
        validate_account_id(account_id)?;
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let mut current = account_id.to_string();
        for _ in 0..16 {
            let (_, merged_into) = account_head(&database, &current)?;
            match merged_into {
                Some(next) => current = next,
                None => return Ok(current),
            }
        }
        Err("account merge alias cycle detected".to_string())
    }

    pub(crate) fn list_accounts(&self) -> Result<Vec<LocalAccountRecord>, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let (active_id, generation) = database
            .query_row(
                "SELECT active_account_id, generation FROM account_session WHERE singleton = 1",
                [],
                |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
            )
            .map_err(|error| format!("read local account session: {error}"))?;
        let mut statement = database
            .prepare(
                "SELECT id, pubkey, display_name, merged_into
                 FROM accounts ORDER BY created_at ASC, id ASC",
            )
            .map_err(|error| format!("prepare local account list: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                let id = row.get::<_, String>(0)?;
                Ok(LocalAccountRecord {
                    active: active_id.as_deref() == Some(id.as_str()),
                    id,
                    pubkey: row.get(1)?,
                    display_name: row.get(2)?,
                    merged_into: row.get(3)?,
                    generation: generation.max(0) as u64,
                })
            })
            .map_err(|error| format!("query local accounts: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read local accounts: {error}"))
    }
}

fn account_head(
    database: &rusqlite::Connection,
    account_id: &str,
) -> Result<(String, Option<String>), String> {
    database
        .query_row(
            "SELECT pubkey, merged_into FROM accounts WHERE id = ?1",
            [account_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("read local account alias: {error}"))?
        .ok_or_else(|| "account not found".to_string())
}

fn assert_generation(
    database: &rusqlite::Connection,
    expected_generation: u64,
) -> Result<(), String> {
    let generation = database
        .query_row(
            "SELECT generation FROM account_session WHERE singleton = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("read account generation: {error}"))?
        .max(0) as u64;
    if generation != expected_generation {
        Err("account generation conflict".to_string())
    } else {
        Ok(())
    }
}

fn validate_account_id(account_id: &str) -> Result<(), String> {
    let parsed = uuid::Uuid::parse_str(account_id).map_err(|_| "invalid account id".to_string())?;
    if parsed.to_string() == account_id {
        Ok(())
    } else {
        Err("account id must be canonical".to_string())
    }
}

fn validate_pubkey(pubkey: &str) -> Result<(), String> {
    if pubkey.len() == 64 && pubkey.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err("invalid account pubkey".to_string())
    }
}

fn validate_display_name(display_name: &str) -> Result<&str, String> {
    let display_name = display_name.trim();
    if display_name.is_empty() || display_name.chars().count() > 80 {
        Err("account display name must contain 1 to 80 characters".to_string())
    } else {
        Ok(display_name)
    }
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
