use nostr::{EventBuilder, Kind, Tag};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use uuid::Uuid;

use super::{
    load_run_context, next_cron_fire, run_steps, unix_seconds, update_run, WorkflowRunContext,
};
use crate::local_authority::LocalAuthority;

impl LocalAuthority {
    pub(crate) fn run_due_workflows(&self, now: i64) -> Result<usize, String> {
        let scheduled = self.fire_due_schedules(now)?;
        let due = {
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local authority database: {error}"))?;
            let mut statement = database
                .prepare(
                    "SELECT run_id, workflow_id, step_index FROM workflow_timers
                     WHERE status = 'pending' AND due_at <= ?1
                     ORDER BY due_at ASC, run_id ASC LIMIT 100",
                )
                .map_err(|error| format!("prepare due local workflows: {error}"))?;
            let rows = statement
                .query_map([now], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, usize>(2)?,
                    ))
                })
                .map_err(|error| format!("query due local workflows: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("read due local workflows: {error}"))?
        };
        let mut resumed = 0;
        for (run_id, workflow_id, step_index) in due {
            let claimed = {
                let database = self
                    .database
                    .lock()
                    .map_err(|error| format!("lock local authority database: {error}"))?;
                database
                    .execute(
                        "UPDATE workflow_timers SET status = 'running'
                         WHERE run_id = ?1 AND step_index = ?2 AND status = 'pending'",
                        params![run_id, step_index as i64],
                    )
                    .map_err(|error| format!("claim due local workflow: {error}"))?
                    == 1
            };
            if !claimed {
                continue;
            }
            let outcome = self.resume_after_delay(&workflow_id, &run_id, step_index);
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local authority database: {error}"))?;
            match outcome {
                Ok(()) => {
                    database
                        .execute(
                            "UPDATE workflow_timers SET status = 'completed', completed_at = ?3
                             WHERE run_id = ?1 AND step_index = ?2",
                            params![run_id, step_index as i64, now],
                        )
                        .map_err(|error| format!("complete local workflow timer: {error}"))?;
                    resumed += 1;
                }
                Err(error) => {
                    database
                        .execute(
                            "UPDATE workflow_timers SET status = 'failed', completed_at = ?3
                             WHERE run_id = ?1 AND step_index = ?2",
                            params![run_id, step_index as i64, now],
                        )
                        .map_err(|update_error| {
                            format!("fail local workflow timer after {error}: {update_error}")
                        })?;
                    drop(database);
                    let (_, _, trace) = load_run_context(self, &run_id)?;
                    let failure = ("workflow_resume_failed".to_string(), error);
                    update_run(self, &run_id, "failed", step_index, &trace, Some(&failure))?;
                }
            }
        }
        Ok(scheduled + resumed)
    }

    fn fire_due_schedules(&self, now: i64) -> Result<usize, String> {
        let due = {
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local authority database: {error}"))?;
            let mut statement = database
                .prepare(
                    "SELECT workflow_id, interval_seconds, cron_expression
                     FROM workflow_schedules
                     WHERE next_fire_at <= ?1 ORDER BY next_fire_at ASC, workflow_id ASC
                     LIMIT 100",
                )
                .map_err(|error| format!("prepare scheduled local workflows: {error}"))?;
            let rows = statement
                .query_map([now], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                    ))
                })
                .map_err(|error| format!("query scheduled local workflows: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("read scheduled local workflows: {error}"))?
        };
        let mut fired = 0;
        for (workflow_id, interval_seconds, cron_expression) in due {
            let next_fire_at = match cron_expression.as_deref() {
                Some(expression) => next_cron_fire(expression, now)?,
                None => now.saturating_add(interval_seconds),
            };
            let claimed = {
                let database = self
                    .database
                    .lock()
                    .map_err(|error| format!("lock local authority database: {error}"))?;
                database
                    .execute(
                        "UPDATE workflow_schedules SET last_fire_at = ?2,
                             next_fire_at = ?3, updated_at = ?2
                         WHERE workflow_id = ?1 AND next_fire_at <= ?2",
                        params![workflow_id, now, next_fire_at],
                    )
                    .map_err(|error| format!("claim scheduled local workflow: {error}"))?
                    == 1
            };
            if !claimed {
                continue;
            }
            let trigger = EventBuilder::new(Kind::Custom(46_020), "")
                .tags([
                    Tag::parse(["d", &workflow_id])
                        .map_err(|error| format!("scheduled workflow id tag: {error}"))?,
                    Tag::parse(["schedule-fire", &now.to_string()])
                        .map_err(|error| format!("scheduled workflow fire tag: {error}"))?,
                ])
                .custom_created_at(nostr::Timestamp::from(now.max(0) as u64))
                .sign_with_keys(&self.workflow_signer)
                .map_err(|error| format!("sign scheduled local workflow: {error}"))?;
            if let Err(error) = self.submit(trigger) {
                let database = self.database.lock().map_err(|lock_error| {
                    format!("lock schedule failure after {error}: {lock_error}")
                })?;
                database
                    .execute(
                        "INSERT INTO audit_log(action, actor_pubkey, target_id,
                             details_json, created_at)
                         VALUES ('workflow.schedule_failed', ?1, ?2, ?3, ?4)",
                        params![
                            self.workflow_signer.public_key().to_hex(),
                            workflow_id,
                            json!({"error": error}).to_string(),
                            now
                        ],
                    )
                    .map_err(|audit_error| {
                        format!("audit scheduled workflow failure after {error}: {audit_error}")
                    })?;
                continue;
            }
            fired += 1;
        }
        Ok(fired)
    }

    fn resume_after_delay(
        &self,
        workflow_id: &str,
        run_id: &str,
        step_index: usize,
    ) -> Result<(), String> {
        let definition_event = self
            .query(&[json!({"kinds": [30620], "#d": [workflow_id], "limit": 1})])?
            .into_iter()
            .next()
            .ok_or_else(|| "workflow definition disappeared during delay".to_string())?;
        let definition: Value = serde_yaml::from_str(&definition_event.content)
            .map_err(|error| format!("invalid workflow YAML after delay: {error}"))?;
        let (actor_pubkey, trigger_event, mut trace) = load_run_context(self, run_id)?;
        if let Some(step) = trace.get_mut(step_index) {
            step["status"] = json!("completed");
            step["completed_at"] = json!(unix_seconds());
            step["output"]["delay_status"] = json!("elapsed");
        }
        let context = WorkflowRunContext {
            authority: self,
            workflow_id,
            run_id,
            definition_event: &definition_event,
            definition: &definition,
            trigger_event: &trigger_event,
            actor_pubkey: &actor_pubkey,
        };
        run_steps(&context, step_index + 1, trace)
    }

    pub(crate) fn workflow_runs(
        &self,
        actor_pubkey: &str,
        workflow_id: &str,
        limit: usize,
    ) -> Result<Vec<Value>, String> {
        self.assert_member_can_authenticate(actor_pubkey)?;
        Uuid::parse_str(workflow_id).map_err(|_| "invalid workflow id".to_string())?;
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let mut statement = database
            .prepare(
                "SELECT id, workflow_id, status, current_step, execution_trace_json,
                        started_at, completed_at, error_code, error_message, created_at
                 FROM workflow_runs WHERE workflow_id = ?1
                 ORDER BY created_at DESC, id DESC LIMIT ?2",
            )
            .map_err(|error| format!("prepare local workflow runs: {error}"))?;
        let rows = statement
            .query_map(params![workflow_id, limit.clamp(1, 100) as i64], |row| {
                let trace = serde_json::from_str::<Value>(&row.get::<_, String>(4)?)
                    .unwrap_or_else(|_| json!([]));
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "workflow_id": row.get::<_, String>(1)?,
                    "status": row.get::<_, String>(2)?,
                    "current_step": row.get::<_, Option<i64>>(3)?,
                    "execution_trace": trace,
                    "started_at": row.get::<_, Option<i64>>(5)?,
                    "completed_at": row.get::<_, Option<i64>>(6)?,
                    "error_code": row.get::<_, Option<String>>(7)?,
                    "error_message": row.get::<_, Option<String>>(8)?,
                    "created_at": row.get::<_, i64>(9)?
                }))
            })
            .map_err(|error| format!("query local workflow runs: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read local workflow runs: {error}"))
    }

    pub(crate) fn workflow_approvals(
        &self,
        actor_pubkey: &str,
        workflow_id: &str,
        run_id: &str,
    ) -> Result<Vec<Value>, String> {
        self.assert_member_can_authenticate(actor_pubkey)?;
        Uuid::parse_str(workflow_id).map_err(|_| "invalid workflow id".to_string())?;
        Uuid::parse_str(run_id).map_err(|_| "invalid workflow run id".to_string())?;
        let actor_role = self.member_role(actor_pubkey)?;
        let now = unix_seconds();
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .execute(
                "UPDATE workflow_approvals SET status = 'expired'
                 WHERE run_id = ?1 AND status = 'pending' AND expires_at <= ?2",
                params![run_id, now],
            )
            .map_err(|error| format!("expire local workflow approvals: {error}"))?;
        let owner = database
            .query_row(
                "SELECT actor_pubkey FROM workflow_runs
                 WHERE id = ?1 AND workflow_id = ?2",
                params![run_id, workflow_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("read local workflow approval run: {error}"))?
            .ok_or_else(|| "workflow run not found".to_string())?;
        if actor_pubkey != owner && !matches!(actor_role.as_deref(), Some("owner" | "admin")) {
            let designated = database
                .query_row(
                    "SELECT 1 FROM workflow_approvals
                     WHERE run_id = ?1 AND (approver_spec IN ('any', '@member', 'member')
                       OR lower(approver_spec) = lower(?2)) LIMIT 1",
                    params![run_id, actor_pubkey],
                    |_| Ok(true),
                )
                .optional()
                .map_err(|error| format!("authorize workflow approval read: {error}"))?
                .unwrap_or(false);
            if !designated {
                return Err("forbidden: workflow approvals are private".to_string());
            }
        }
        let mut statement = database
            .prepare(
                "SELECT token, workflow_id, run_id, step_id, step_index, approver_spec,
                        status, approver_pubkey, note, expires_at, created_at
                 FROM workflow_approvals WHERE workflow_id = ?1 AND run_id = ?2
                 ORDER BY step_index ASC, created_at ASC",
            )
            .map_err(|error| format!("prepare local workflow approvals: {error}"))?;
        let rows = statement
            .query_map(params![workflow_id, run_id], |row| {
                let expires_at = row.get::<_, i64>(9)?;
                Ok(json!({
                    "approval_ref": row.get::<_, String>(0)?,
                    "workflow_id": row.get::<_, String>(1)?,
                    "run_id": row.get::<_, String>(2)?,
                    "step_id": row.get::<_, String>(3)?,
                    "step_index": row.get::<_, i64>(4)?,
                    "approver_spec": row.get::<_, String>(5)?,
                    "status": row.get::<_, String>(6)?,
                    "approver_pubkey": row.get::<_, Option<String>>(7)?,
                    "note": row.get::<_, Option<String>>(8)?,
                    "expires_at": chrono::DateTime::<chrono::Utc>::from_timestamp(expires_at, 0)
                        .unwrap_or(chrono::DateTime::<chrono::Utc>::UNIX_EPOCH)
                        .to_rfc3339(),
                    "created_at": row.get::<_, i64>(10)?
                }))
            })
            .map_err(|error| format!("query local workflow approvals: {error}"))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("read local workflow approvals: {error}"))
    }
}
