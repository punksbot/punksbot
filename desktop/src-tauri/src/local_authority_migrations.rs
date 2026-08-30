use nostr::{Event, JsonUtil};
use rusqlite::{params, Connection, Transaction};

const CURRENT_SCHEMA_VERSION: i64 = 19;

pub(super) fn migrate(connection: &mut Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS authority_migrations (
               version INTEGER PRIMARY KEY NOT NULL,
               applied_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS events (
               id TEXT PRIMARY KEY NOT NULL,
               pubkey TEXT NOT NULL,
               kind INTEGER NOT NULL,
               created_at INTEGER NOT NULL,
               raw_json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS events_created_at_idx
               ON events(created_at DESC, id DESC);
             CREATE INDEX IF NOT EXISTS events_kind_idx
               ON events(kind, created_at DESC);
             CREATE TABLE IF NOT EXISTS event_tags (
               event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
               name TEXT NOT NULL,
               value TEXT NOT NULL,
               position INTEGER NOT NULL,
               PRIMARY KEY(event_id, name, position)
             );
             CREATE INDEX IF NOT EXISTS event_tags_lookup_idx
               ON event_tags(name, value, event_id);
             CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
               event_id UNINDEXED,
               content,
               kind UNINDEXED,
               pubkey UNINDEXED,
               tokenize = 'unicode61 remove_diacritics 2'
             );
             CREATE TABLE IF NOT EXISTS audit_log (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               action TEXT NOT NULL,
               actor_pubkey TEXT NOT NULL,
               target_id TEXT NOT NULL,
               details_json TEXT NOT NULL,
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS audit_log_created_idx
               ON audit_log(created_at DESC, id DESC);
             CREATE TABLE IF NOT EXISTS accounts (
               id TEXT PRIMARY KEY NOT NULL,
               pubkey TEXT NOT NULL UNIQUE,
               display_name TEXT NOT NULL,
               merged_into TEXT REFERENCES accounts(id),
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS account_session (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               active_account_id TEXT REFERENCES accounts(id),
               generation INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO account_session(singleton, active_account_id, generation)
               VALUES (1, NULL, 0);
             CREATE TABLE IF NOT EXISTS community_members (
               pubkey TEXT PRIMARY KEY NOT NULL,
               role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'member', 'guest', 'bot')),
               removed_at INTEGER,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS moderation_reports (
               id TEXT PRIMARY KEY NOT NULL,
               report_event_id TEXT NOT NULL UNIQUE,
               reporter_pubkey TEXT NOT NULL,
               target_kind TEXT NOT NULL,
               target TEXT NOT NULL,
               channel_id TEXT,
               report_type TEXT NOT NULL,
               note TEXT,
               status TEXT NOT NULL,
               resolved_by TEXT,
               resolved_at INTEGER,
               action_id TEXT,
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS moderation_reports_status_idx
               ON moderation_reports(status, created_at DESC);
             CREATE TABLE IF NOT EXISTS moderation_actions (
               id TEXT PRIMARY KEY NOT NULL,
               actor_pubkey TEXT NOT NULL,
               action TEXT NOT NULL,
               target_pubkey TEXT,
               target_event_id TEXT,
               channel_id TEXT,
               reason_code TEXT,
               public_reason TEXT,
               private_reason TEXT,
               matched_principal TEXT,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS restrictions (
               pubkey TEXT PRIMARY KEY NOT NULL,
               banned INTEGER NOT NULL DEFAULT 0,
               ban_expires_at INTEGER,
               ban_reason TEXT,
               muted_until INTEGER,
               mute_reason TEXT,
               actor_pubkey TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS invitations (
               code TEXT PRIMARY KEY NOT NULL,
               created_by TEXT NOT NULL,
               channel_id TEXT,
               expires_at INTEGER NOT NULL,
               max_uses INTEGER,
               uses INTEGER NOT NULL DEFAULT 0,
               revoked_at INTEGER,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS workflow_runs (
               id TEXT PRIMARY KEY NOT NULL,
               workflow_id TEXT NOT NULL,
               actor_pubkey TEXT NOT NULL,
               status TEXT NOT NULL,
               current_step INTEGER,
               execution_trace_json TEXT NOT NULL,
               started_at INTEGER,
               completed_at INTEGER,
               error_code TEXT,
               error_message TEXT,
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS workflow_runs_lookup_idx
               ON workflow_runs(workflow_id, created_at DESC, id DESC);
             CREATE TABLE IF NOT EXISTS workflow_run_context (
               run_id TEXT PRIMARY KEY NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
               trigger_event_json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS workflow_timers (
               run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
               workflow_id TEXT NOT NULL,
               step_index INTEGER NOT NULL,
               due_at INTEGER NOT NULL,
               status TEXT NOT NULL,
               created_at INTEGER NOT NULL,
               completed_at INTEGER,
               PRIMARY KEY(run_id, step_index)
             );
             CREATE INDEX IF NOT EXISTS workflow_timers_due_idx
               ON workflow_timers(status, due_at, run_id);
             CREATE TABLE IF NOT EXISTS workflow_webhook_deliveries (
               delivery_id TEXT PRIMARY KEY NOT NULL,
               workflow_id TEXT NOT NULL,
               status TEXT NOT NULL,
               run_id TEXT,
               error_message TEXT,
               received_at INTEGER NOT NULL,
               completed_at INTEGER
             );
             CREATE TABLE IF NOT EXISTS workflow_schedules (
               workflow_id TEXT PRIMARY KEY NOT NULL,
               interval_seconds INTEGER NOT NULL,
               cron_expression TEXT,
               next_fire_at INTEGER NOT NULL,
               last_fire_at INTEGER,
               updated_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS workflow_schedules_due_idx
               ON workflow_schedules(next_fire_at, workflow_id);
             CREATE TABLE IF NOT EXISTS workflow_approvals (
               token TEXT PRIMARY KEY NOT NULL,
               workflow_id TEXT NOT NULL,
               run_id TEXT NOT NULL,
               step_id TEXT NOT NULL,
               step_index INTEGER NOT NULL,
               approver_spec TEXT NOT NULL,
               status TEXT NOT NULL,
               approver_pubkey TEXT,
               note TEXT,
               expires_at INTEGER NOT NULL,
               created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS dm_visibility (
               pubkey TEXT NOT NULL,
               channel_id TEXT NOT NULL,
               hidden INTEGER NOT NULL,
               updated_at INTEGER NOT NULL,
               PRIMARY KEY(pubkey, channel_id)
             );
             CREATE TABLE IF NOT EXISTS message_lifecycle (
               target_event_id TEXT PRIMARY KEY NOT NULL,
               channel_id TEXT NOT NULL,
               author_pubkey TEXT NOT NULL,
               state TEXT NOT NULL,
               latest_event_id TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS erased_messages (
               target_event_id TEXT PRIMARY KEY NOT NULL,
               channel_id TEXT NOT NULL,
               author_pubkey TEXT NOT NULL,
               content_sha256 TEXT NOT NULL,
               erased_by TEXT NOT NULL,
               erase_event_id TEXT NOT NULL,
               erased_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS media (
               sha256 TEXT PRIMARY KEY NOT NULL,
               mime_type TEXT NOT NULL,
               size INTEGER NOT NULL,
               uploaded INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS media_variants (
               original_sha256 TEXT NOT NULL REFERENCES media(sha256) ON DELETE CASCADE,
               name TEXT NOT NULL,
               sha256 TEXT NOT NULL,
               mime_type TEXT NOT NULL,
               size INTEGER NOT NULL,
               width INTEGER,
               height INTEGER,
               created_at INTEGER NOT NULL,
               PRIMARY KEY(original_sha256, name)
             );
             CREATE TABLE IF NOT EXISTS channel_ttl (
               channel_id TEXT PRIMARY KEY NOT NULL,
               ttl_seconds INTEGER NOT NULL,
               deadline INTEGER NOT NULL,
               expired_at INTEGER,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS reminder_deliveries (
               account_pubkey TEXT NOT NULL,
               reminder_id TEXT NOT NULL,
               event_id TEXT NOT NULL,
               not_before INTEGER NOT NULL,
               claimed_at INTEGER,
               delivered_at INTEGER,
               updated_at INTEGER NOT NULL,
               PRIMARY KEY(account_pubkey, reminder_id)
             );
             CREATE INDEX IF NOT EXISTS reminder_deliveries_due_idx
               ON reminder_deliveries(delivered_at, not_before, claimed_at);
             CREATE TABLE IF NOT EXISTS notification_preferences (
               account_pubkey TEXT PRIMARY KEY NOT NULL,
               desktop_enabled INTEGER NOT NULL DEFAULT 0,
               reminders_enabled INTEGER NOT NULL DEFAULT 0,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS workspace_profile (
               singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
               icon TEXT,
               updated_by TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS archived_identities (
               pubkey TEXT PRIMARY KEY NOT NULL,
               consent_path TEXT NOT NULL,
               actor_pubkey TEXT NOT NULL,
               reason TEXT,
               replaced_by TEXT,
               request_event_id TEXT NOT NULL,
               archived_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS local_workspaces (
               id TEXT PRIMARY KEY NOT NULL,
               name TEXT NOT NULL,
               owner_pubkey TEXT NOT NULL,
               archived INTEGER NOT NULL DEFAULT 0,
               created_at INTEGER NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )
        .map_err(|error| format!("migrate local authority database: {error}"))?;

    ensure_column(
        connection,
        "workflow_schedules",
        "cron_expression",
        "ALTER TABLE workflow_schedules ADD COLUMN cron_expression TEXT",
    )?;
    ensure_column(
        connection,
        "invitations",
        "channel_id",
        "ALTER TABLE invitations ADD COLUMN channel_id TEXT",
    )?;

    let transaction = connection
        .transaction()
        .map_err(|error| format!("begin local authority migration: {error}"))?;
    backfill_event_indexes(&transaction)?;
    transaction
        .execute(
            "INSERT OR IGNORE INTO authority_migrations(version, applied_at)
             VALUES (?1, unixepoch())",
            [CURRENT_SCHEMA_VERSION],
        )
        .map_err(|error| format!("record local authority migration: {error}"))?;
    transaction
        .pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
        .map_err(|error| format!("set local authority schema version: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("commit local authority migration: {error}"))
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    migration: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("inspect local authority column {table}.{column}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("query local authority columns for {table}: {error}"))?;
    for row in rows {
        if row.map_err(|error| format!("read local authority column for {table}: {error}"))?
            == column
        {
            return Ok(());
        }
    }
    drop(statement);
    connection
        .execute_batch(migration)
        .map_err(|error| format!("add local authority column {table}.{column}: {error}"))
}

fn backfill_event_indexes(transaction: &Transaction<'_>) -> Result<(), String> {
    let mut statement = transaction
        .prepare("SELECT raw_json FROM events ORDER BY created_at ASC, id ASC")
        .map_err(|error| format!("prepare authority index backfill: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("query authority index backfill: {error}"))?;
    let mut events = Vec::new();
    for row in rows {
        let raw = row.map_err(|error| format!("read authority index backfill: {error}"))?;
        if let Ok(event) = Event::from_json(raw) {
            events.push(event);
        }
    }
    drop(statement);
    for event in events {
        index_event(transaction, &event)?;
        super::reminders::project(transaction, &event)?;
    }
    super::lifecycle::rebuild_message_search_projection(transaction)?;
    Ok(())
}

pub(super) fn index_event(transaction: &Transaction<'_>, event: &Event) -> Result<(), String> {
    let event_id = event.id.to_hex();
    transaction
        .execute("DELETE FROM event_tags WHERE event_id = ?1", [&event_id])
        .map_err(|error| format!("clear local event tags: {error}"))?;
    for (position, tag) in event.tags.iter().enumerate() {
        let values = tag.as_slice();
        let (Some(name), Some(value)) = (values.first(), values.get(1)) else {
            continue;
        };
        transaction
            .execute(
                "INSERT INTO event_tags(event_id, name, value, position)
                 VALUES (?1, ?2, ?3, ?4)",
                params![event_id, name, value, position as i64],
            )
            .map_err(|error| format!("index local event tag: {error}"))?;
    }
    transaction
        .execute("DELETE FROM events_fts WHERE event_id = ?1", [&event_id])
        .map_err(|error| format!("clear local event search row: {error}"))?;
    transaction
        .execute(
            "INSERT INTO events_fts(event_id, content, kind, pubkey)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                event_id,
                event.content,
                event.kind.as_u16() as i64,
                event.pubkey.to_hex()
            ],
        )
        .map_err(|error| format!("index local event search row: {error}"))?;
    Ok(())
}
