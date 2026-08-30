use nostr::Event;
use rusqlite::{params, Transaction, TransactionBehavior};
use serde::Serialize;

use super::{tag_value, LocalAuthority};

const REMINDER_KIND: u32 = 30_300;
const MAX_DUE_PER_TICK: i64 = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DueReminder {
    pub(crate) account_pubkey: String,
    pub(crate) reminder_id: String,
    pub(crate) event_id: String,
    pub(crate) not_before: i64,
}

pub(super) fn project(transaction: &Transaction<'_>, event: &Event) -> Result<(), String> {
    if event.kind.as_u16() as u32 != REMINDER_KIND {
        return Ok(());
    }
    let account_pubkey = event.pubkey.to_hex();
    let reminder_id = tag_value(event, "d")
        .filter(|value| valid_reminder_id(value))
        .ok_or_else(|| "contract: reminder requires a safe d tag".to_string())?;
    let Some(not_before) = tag_value(event, "not_before") else {
        transaction
            .execute(
                "DELETE FROM reminder_deliveries
                 WHERE account_pubkey = ?1 AND reminder_id = ?2",
                params![account_pubkey, reminder_id],
            )
            .map_err(|error| format!("cancel local reminder delivery: {error}"))?;
        return Ok(());
    };
    let not_before = parse_timestamp(&not_before)?;
    transaction
        .execute(
            "INSERT INTO reminder_deliveries(
               account_pubkey, reminder_id, event_id, not_before,
               claimed_at, delivered_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, NULL, NULL, ?5)
             ON CONFLICT(account_pubkey, reminder_id) DO UPDATE SET
               event_id = excluded.event_id,
               not_before = excluded.not_before,
               claimed_at = CASE
                 WHEN reminder_deliveries.event_id = excluded.event_id
                   THEN reminder_deliveries.claimed_at
                 ELSE NULL
               END,
               delivered_at = CASE
                 WHEN reminder_deliveries.event_id = excluded.event_id
                   THEN reminder_deliveries.delivered_at
                 ELSE NULL
               END,
               updated_at = excluded.updated_at",
            params![
                account_pubkey,
                reminder_id,
                event.id.to_hex(),
                not_before,
                event.created_at.as_secs() as i64,
            ],
        )
        .map_err(|error| format!("schedule local reminder delivery: {error}"))?;
    Ok(())
}

impl LocalAuthority {
    pub(crate) fn set_notification_preferences(
        &self,
        account_pubkey: &str,
        desktop_enabled: bool,
        reminders_enabled: bool,
        updated_at: i64,
    ) -> Result<(), String> {
        if account_pubkey.len() != 64
            || !account_pubkey.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("contract: notification account pubkey is invalid".to_string());
        }
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local notification preferences: {error}"))?;
        database
            .execute(
                "INSERT INTO notification_preferences(
                   account_pubkey, desktop_enabled, reminders_enabled, updated_at
                 ) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(account_pubkey) DO UPDATE SET
                   desktop_enabled = excluded.desktop_enabled,
                   reminders_enabled = excluded.reminders_enabled,
                   updated_at = excluded.updated_at",
                params![
                    account_pubkey.to_ascii_lowercase(),
                    i64::from(desktop_enabled),
                    i64::from(reminders_enabled),
                    updated_at,
                ],
            )
            .map_err(|error| format!("persist local notification preferences: {error}"))?;
        Ok(())
    }

    pub(crate) fn claim_due_reminders(
        &self,
        now: i64,
        catchup_seconds: i64,
        lease_seconds: i64,
    ) -> Result<Vec<DueReminder>, String> {
        let mut database = self
            .database
            .lock()
            .map_err(|error| format!("lock local reminder database: {error}"))?;
        let transaction = database
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("begin local reminder claim: {error}"))?;
        let oldest_due = now.saturating_sub(catchup_seconds.max(0));
        let stale_claim = now.saturating_sub(lease_seconds.max(1));
        let mut statement = transaction
            .prepare(
                "SELECT delivery.account_pubkey, delivery.reminder_id,
                        delivery.event_id, delivery.not_before
                 FROM reminder_deliveries AS delivery
                 JOIN notification_preferences AS preference
                   ON preference.account_pubkey = delivery.account_pubkey
                 WHERE delivery.delivered_at IS NULL
                   AND preference.desktop_enabled = 1
                   AND preference.reminders_enabled = 1
                   AND delivery.not_before BETWEEN ?1 AND ?2
                   AND (delivery.claimed_at IS NULL OR delivery.claimed_at <= ?3)
                 ORDER BY delivery.not_before ASC, delivery.account_pubkey ASC,
                          delivery.reminder_id ASC
                 LIMIT ?4",
            )
            .map_err(|error| format!("prepare local reminder claim: {error}"))?;
        let rows = statement
            .query_map(
                params![oldest_due, now, stale_claim, MAX_DUE_PER_TICK],
                |row| {
                    Ok(DueReminder {
                        account_pubkey: row.get(0)?,
                        reminder_id: row.get(1)?,
                        event_id: row.get(2)?,
                        not_before: row.get(3)?,
                    })
                },
            )
            .map_err(|error| format!("query local reminder claim: {error}"))?;
        let reminders = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read local reminder claim: {error}"))?;
        drop(statement);
        for reminder in &reminders {
            let claimed = transaction
                .execute(
                    "UPDATE reminder_deliveries SET claimed_at = ?1, updated_at = ?1
                     WHERE account_pubkey = ?2 AND reminder_id = ?3 AND event_id = ?4
                       AND delivered_at IS NULL
                       AND (claimed_at IS NULL OR claimed_at <= ?5)",
                    params![
                        now,
                        reminder.account_pubkey,
                        reminder.reminder_id,
                        reminder.event_id,
                        stale_claim,
                    ],
                )
                .map_err(|error| format!("lease local reminder delivery: {error}"))?;
            if claimed != 1 {
                return Err("ambiguous: local reminder lease changed during claim".to_string());
            }
        }
        transaction
            .commit()
            .map_err(|error| format!("commit local reminder claim: {error}"))?;
        Ok(reminders)
    }

    pub(crate) fn ack_reminder_delivery(
        &self,
        reminder: &DueReminder,
        delivered_at: i64,
    ) -> Result<(), String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local reminder database: {error}"))?;
        let updated = database
            .execute(
                "UPDATE reminder_deliveries
                 SET delivered_at = ?1, claimed_at = NULL, updated_at = ?1
                 WHERE account_pubkey = ?2 AND reminder_id = ?3 AND event_id = ?4
                   AND delivered_at IS NULL",
                params![
                    delivered_at,
                    reminder.account_pubkey,
                    reminder.reminder_id,
                    reminder.event_id,
                ],
            )
            .map_err(|error| format!("acknowledge local reminder delivery: {error}"))?;
        if updated != 1 {
            return Err("stale-generation: reminder changed before delivery ack".to_string());
        }
        database
            .execute(
                "INSERT INTO audit_log(
                   action, actor_pubkey, target_id, details_json, created_at
                 ) VALUES ('reminder.delivered', ?1, ?2, ?3, ?4)",
                params![
                    reminder.account_pubkey,
                    reminder.event_id,
                    serde_json::json!({
                        "reminder_id": reminder.reminder_id,
                        "not_before": reminder.not_before,
                    })
                    .to_string(),
                    delivered_at,
                ],
            )
            .map_err(|error| format!("audit local reminder delivery: {error}"))?;
        Ok(())
    }
}

#[tauri::command]
pub(crate) fn punks_local_set_notification_preferences(
    account_pubkey: String,
    desktop_enabled: bool,
    reminders_enabled: bool,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Manager;
    let authority = app.state::<std::sync::Arc<LocalAuthority>>();
    authority.set_notification_preferences(
        &account_pubkey,
        desktop_enabled,
        reminders_enabled,
        chrono::Utc::now().timestamp(),
    )
}

fn parse_timestamp(value: &str) -> Result<i64, String> {
    if value.is_empty()
        || (value.len() > 1 && value.starts_with('0'))
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err("contract: reminder not_before must be canonical digits".to_string());
    }
    value
        .parse::<i64>()
        .map_err(|_| "contract: reminder not_before is out of range".to_string())
}

fn valid_reminder_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}
