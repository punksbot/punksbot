use evalexpr::{ContextWithMutableVariables, HashMapContext, Value as EvalValue};
use hmac::{Hmac, KeyInit, Mac};
use nostr::{Event, EventBuilder, JsonUtil, Kind, Tag};
use rusqlite::{params, OptionalExtension, Transaction};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use std::str::FromStr;
use uuid::Uuid;

use super::{tag_value, LocalAuthority};

#[path = "local_authority_workflow_scheduler.rs"]
mod scheduler;
#[path = "local_authority_workflow_webhooks.rs"]
mod webhooks;
#[path = "local_authority_workflow_http.rs"]
mod workflow_http;

pub(super) use webhooks::{approvals, runs, webhook};
use workflow_http::call_webhook;

#[derive(Debug, Deserialize)]
pub(super) struct RunsQuery {
    limit: Option<usize>,
}

pub(super) fn trigger(authority: &LocalAuthority, event: &nostr::Event) -> Result<String, String> {
    let workflow_id =
        tag_value(event, "d").ok_or_else(|| "workflow trigger requires d tag".to_string())?;
    let definition_event = authority
        .query(&[json!({"kinds": [30620], "#d": [&workflow_id], "limit": 1})])?
        .into_iter()
        .next()
        .ok_or_else(|| "workflow not found".to_string())?;
    let definition: Value = serde_yaml::from_str(&definition_event.content)
        .map_err(|error| format!("invalid workflow YAML: {error}"))?;
    if definition.get("enabled").and_then(Value::as_bool) == Some(false) {
        return Err("workflow is disabled".to_string());
    }
    let run_id = Uuid::new_v4().to_string();
    let now = unix_seconds();
    {
        let mut database = authority
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin local workflow run: {error}"))?;
        transaction
            .execute(
                "INSERT INTO workflow_runs(id, workflow_id, actor_pubkey, status, current_step,
                     execution_trace_json, started_at, completed_at, error_code, error_message,
                     created_at)
                 VALUES (?1, ?2, ?3, 'running', 0, '[]', ?4, NULL, NULL, NULL, ?4)",
                params![run_id, workflow_id, event.pubkey.to_hex(), now],
            )
            .map_err(|error| format!("create local workflow run: {error}"))?;
        transaction
            .execute(
                "INSERT INTO workflow_run_context(run_id, trigger_event_json) VALUES (?1, ?2)",
                params![run_id, event.as_json()],
            )
            .map_err(|error| format!("persist local workflow trigger context: {error}"))?;
        transaction
            .commit()
            .map_err(|error| format!("commit local workflow run: {error}"))?;
    }

    let actor_pubkey = event.pubkey.to_hex();
    let context = WorkflowRunContext {
        authority,
        workflow_id: &workflow_id,
        run_id: &run_id,
        definition_event: &definition_event,
        definition: &definition,
        trigger_event: event,
        actor_pubkey: &actor_pubkey,
    };
    run_steps(&context, 0, Vec::new())?;
    Ok(format!("response:{}", json!({"run_id": run_id})))
}

pub(super) fn save_definition(authority: &LocalAuthority, event: &Event) -> Result<String, String> {
    let workflow_id =
        tag_value(event, "d").ok_or_else(|| "workflow definition requires d tag".to_string())?;
    Uuid::parse_str(&workflow_id).map_err(|_| "workflow id is invalid".to_string())?;
    let channel_id =
        tag_value(event, "h").ok_or_else(|| "workflow definition requires h tag".to_string())?;
    Uuid::parse_str(&channel_id).map_err(|_| "workflow channel is invalid".to_string())?;
    let definition: Value = serde_yaml::from_str(&event.content)
        .map_err(|error| format!("invalid workflow YAML: {error}"))?;
    let name = definition
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| "workflow name is missing".to_string())?;
    if name.chars().count() > 120 {
        return Err("workflow name exceeds 120 characters".to_string());
    }
    let steps = definition
        .get("steps")
        .and_then(Value::as_array)
        .filter(|steps| !steps.is_empty())
        .ok_or_else(|| "workflow steps are missing".to_string())?;
    if steps.len() > 100 {
        return Err("workflow exceeds 100 steps".to_string());
    }
    for step in steps {
        let action = step
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| "workflow step action is missing".to_string())?;
        if !matches!(
            action,
            "send_message"
                | "send_dm"
                | "set_channel_topic"
                | "add_reaction"
                | "call_webhook"
                | "request_approval"
                | "delay"
        ) {
            return Err(format!("unsupported workflow action: {action}"));
        }
    }
    if definition
        .get("trigger")
        .and_then(Value::as_object)
        .and_then(|trigger| trigger.get("on"))
        .and_then(Value::as_str)
        == Some("schedule")
    {
        let trigger = definition
            .get("trigger")
            .and_then(Value::as_object)
            .ok_or_else(|| "schedule trigger is invalid".to_string())?;
        let interval = trigger.get("interval").and_then(Value::as_str);
        let cron = trigger.get("cron").and_then(Value::as_str);
        match (interval, cron) {
            (Some(interval), None) => {
                parse_duration_seconds(interval)?;
            }
            (None, Some(cron)) => {
                next_cron_fire(cron, unix_seconds())?;
            }
            _ => {
                return Err("schedule trigger requires exactly one of interval or cron".to_string())
            }
        }
    }
    if let Some(expected_revision) = tag_value(event, "expected-revision") {
        let current = authority
            .query(&[json!({"kinds": [30620], "#d": [&workflow_id], "limit": 1})])?
            .into_iter()
            .next()
            .ok_or_else(|| "workflow revision conflict: workflow not found".to_string())?;
        if current.id.to_hex() != expected_revision {
            return Err("workflow revision conflict: refresh and retry".to_string());
        }
    }
    let webhook = definition
        .get("trigger")
        .and_then(Value::as_object)
        .and_then(|trigger| trigger.get("on"))
        .and_then(Value::as_str)
        == Some("webhook");
    let webhook_secret = webhook
        .then(|| derive_webhook_secret(authority, &workflow_id))
        .transpose()?;
    Ok(format!(
        "response:{}",
        json!({
            "workflow_id": workflow_id,
            "webhook_secret": webhook_secret
        })
    ))
}

pub(super) fn project_definition(
    transaction: &Transaction<'_>,
    event: &Event,
) -> Result<(), String> {
    if event.kind.as_u16() as u32 != 30_620 {
        return Ok(());
    }
    let workflow_id =
        tag_value(event, "d").ok_or_else(|| "workflow projection requires d tag".to_string())?;
    let definition: Value = serde_yaml::from_str(&event.content)
        .map_err(|error| format!("project workflow YAML: {error}"))?;
    let trigger = definition.get("trigger").and_then(Value::as_object);
    let enabled = definition.get("enabled").and_then(Value::as_bool) != Some(false);
    let schedule_trigger = trigger
        .filter(|trigger| trigger.get("on").and_then(Value::as_str) == Some("schedule"))
        .filter(|_| enabled);
    let Some(schedule_trigger) = schedule_trigger else {
        transaction
            .execute(
                "DELETE FROM workflow_schedules WHERE workflow_id = ?1",
                [&workflow_id],
            )
            .map_err(|error| format!("clear local workflow schedule: {error}"))?;
        return Ok(());
    };
    let now = unix_seconds();
    let interval = schedule_trigger.get("interval").and_then(Value::as_str);
    let cron = schedule_trigger.get("cron").and_then(Value::as_str);
    let (interval_seconds, cron_expression, next_fire_at) = match (interval, cron) {
        (Some(interval), None) => {
            let seconds = parse_duration_seconds(interval)?;
            (seconds, None, now.saturating_add(seconds))
        }
        (None, Some(cron)) => (0, Some(cron), next_cron_fire(cron, now)?),
        _ => return Err("schedule projection requires exactly one interval or cron".to_string()),
    };
    transaction
        .execute(
            "INSERT INTO workflow_schedules(workflow_id, interval_seconds, cron_expression,
                 next_fire_at, last_fire_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, NULL, ?5)
             ON CONFLICT(workflow_id) DO UPDATE SET
               interval_seconds = excluded.interval_seconds,
               cron_expression = excluded.cron_expression,
               next_fire_at = CASE
                 WHEN workflow_schedules.interval_seconds = excluded.interval_seconds
                   AND workflow_schedules.cron_expression IS excluded.cron_expression
                 THEN workflow_schedules.next_fire_at
                 ELSE excluded.next_fire_at
               END,
               updated_at = excluded.updated_at",
            params![
                workflow_id,
                interval_seconds,
                cron_expression,
                next_fire_at,
                now
            ],
        )
        .map_err(|error| format!("project local workflow schedule: {error}"))?;
    Ok(())
}

fn next_cron_fire(expression: &str, after: i64) -> Result<i64, String> {
    let schedule = cron::Schedule::from_str(expression)
        .map_err(|error| format!("invalid UTC cron expression: {error}"))?;
    let after = chrono::DateTime::<chrono::Utc>::from_timestamp(after, 0)
        .ok_or_else(|| "cron reference timestamp is invalid".to_string())?;
    schedule
        .after(&after)
        .next()
        .map(|next| next.timestamp())
        .ok_or_else(|| "cron expression has no future occurrence".to_string())
}

fn derive_webhook_secret(authority: &LocalAuthority, workflow_id: &str) -> Result<String, String> {
    let key = authority.workflow_signer.secret_key().to_secret_hex();
    let mut mac = Hmac::<Sha256>::new_from_slice(key.as_bytes())
        .map_err(|error| format!("initialize workflow webhook HMAC: {error}"))?;
    mac.update(b"punks-workflow-webhook-v1:");
    mac.update(workflow_id.as_bytes());
    Ok(hex::encode(mac.finalize().into_bytes()))
}

struct WorkflowRunContext<'a> {
    authority: &'a LocalAuthority,
    workflow_id: &'a str,
    run_id: &'a str,
    definition_event: &'a Event,
    definition: &'a Value,
    trigger_event: &'a Event,
    actor_pubkey: &'a str,
}

fn run_steps(
    context: &WorkflowRunContext<'_>,
    start_index: usize,
    mut trace: Vec<Value>,
) -> Result<(), String> {
    let channel_id = tag_value(context.definition_event, "h")
        .ok_or_else(|| "workflow channel is missing".to_string())?;
    let steps = context
        .definition
        .get("steps")
        .and_then(Value::as_array)
        .ok_or_else(|| "workflow steps are missing".to_string())?;
    for (index, step) in steps.iter().enumerate().skip(start_index) {
        let step_id = step
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("step")
            .to_string();
        let started_at = unix_seconds();
        if !evaluate_step_condition(step, context.trigger_event, &trace)? {
            trace.push(json!({
                "step_id": step_id,
                "status": "skipped",
                "output": {},
                "started_at": started_at,
                "completed_at": unix_seconds(),
                "error": null
            }));
            update_run(
                context.authority,
                context.run_id,
                "running",
                index + 1,
                &trace,
                None,
            )?;
            continue;
        }
        match execute_step(context, step, &channel_id, index) {
            Ok(StepOutcome::Completed(output)) => trace.push(json!({
                "step_id": step_id,
                "status": "completed",
                "output": output,
                "started_at": started_at,
                "completed_at": unix_seconds(),
                "error": null
            })),
            Ok(StepOutcome::WaitingApproval {
                approval_ref,
                approver_spec,
                message,
            }) => {
                trace.push(json!({
                    "step_id": step_id,
                    "status": "waiting_approval",
                    "output": {
                        "approval_ref": approval_ref,
                        "approver_spec": approver_spec,
                        "message": message
                    },
                    "started_at": started_at,
                    "completed_at": null,
                    "error": null
                }));
                update_run(
                    context.authority,
                    context.run_id,
                    "waiting_approval",
                    index,
                    &trace,
                    None,
                )?;
                return Ok(());
            }
            Ok(StepOutcome::WaitingDelay { due_at }) => {
                trace.push(json!({
                    "step_id": step_id,
                    "status": "waiting_delay",
                    "output": {"due_at": due_at},
                    "started_at": started_at,
                    "completed_at": null,
                    "error": null
                }));
                update_run(
                    context.authority,
                    context.run_id,
                    "waiting_delay",
                    index,
                    &trace,
                    None,
                )?;
                return Ok(());
            }
            Err(error) => {
                trace.push(json!({
                    "step_id": step_id,
                    "status": "failed",
                    "output": {},
                    "started_at": started_at,
                    "completed_at": unix_seconds(),
                    "error": error
                }));
                let failure = ("workflow_step_failed".to_string(), error);
                update_run(
                    context.authority,
                    context.run_id,
                    "failed",
                    index,
                    &trace,
                    Some(&failure),
                )?;
                return Ok(());
            }
        }
        update_run(
            context.authority,
            context.run_id,
            "running",
            index + 1,
            &trace,
            None,
        )?;
    }
    update_run(
        context.authority,
        context.run_id,
        "completed",
        steps.len(),
        &trace,
        None,
    )
}

enum StepOutcome {
    Completed(Value),
    WaitingApproval {
        approval_ref: String,
        approver_spec: String,
        message: String,
    },
    WaitingDelay {
        due_at: i64,
    },
}

fn execute_step(
    context: &WorkflowRunContext<'_>,
    step: &Value,
    workflow_channel_id: &str,
    step_index: usize,
) -> Result<StepOutcome, String> {
    let authority = context.authority;
    let trigger_event = context.trigger_event;
    let actor_pubkey = context.actor_pubkey;
    let action = step
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "workflow step action is missing".to_string())?;
    match action {
        "send_message" => {
            let text = render_template(
                step.get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "send_message text is missing".to_string())?,
                trigger_event,
            );
            let channel = step
                .get("channel")
                .and_then(Value::as_str)
                .unwrap_or(workflow_channel_id);
            Uuid::parse_str(channel).map_err(|_| "send_message channel is invalid".to_string())?;
            authority.ensure_workflow_bot_channel_member(channel, actor_pubkey)?;
            let event = EventBuilder::new(Kind::Custom(9), text)
                .tags([Tag::parse(["h", channel])
                    .map_err(|error| format!("workflow message tag: {error}"))?])
                .sign_with_keys(&authority.workflow_signer)
                .map_err(|error| format!("sign workflow message: {error}"))?;
            let event_id = event.id.to_hex();
            authority.persist_and_publish(event)?;
            Ok(StepOutcome::Completed(
                json!({"event_id": event_id, "channel_id": channel}),
            ))
        }
        "send_dm" => {
            let recipient = render_template(
                step.get("to")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "send_dm recipient is missing".to_string())?,
                trigger_event,
            )
            .to_ascii_lowercase();
            if recipient.len() != 64 || !recipient.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err("send_dm recipient is not a valid Punk pubkey".to_string());
            }
            let text = render_template(
                step.get("text")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "send_dm text is missing".to_string())?,
                trigger_event,
            );
            let channel_id = authority.open_workflow_dm(actor_pubkey, &recipient)?;
            let event = EventBuilder::new(Kind::Custom(9), text)
                .tags([Tag::parse(["h", &channel_id])
                    .map_err(|error| format!("workflow DM tag: {error}"))?])
                .sign_with_keys(&authority.workflow_signer)
                .map_err(|error| format!("sign workflow DM: {error}"))?;
            let event_id = event.id.to_hex();
            authority.persist_and_publish(event)?;
            Ok(StepOutcome::Completed(json!({
                "event_id": event_id,
                "channel_id": channel_id,
                "recipient": recipient
            })))
        }
        "add_reaction" => {
            let target = tag_value(trigger_event, "e")
                .ok_or_else(|| "add_reaction requires a triggering message".to_string())?;
            let emoji = render_template(
                step.get("emoji")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "add_reaction emoji is missing".to_string())?,
                trigger_event,
            );
            if emoji.is_empty() || emoji.chars().count() > 128 {
                return Err("add_reaction emoji is invalid".to_string());
            }
            authority.ensure_workflow_bot_channel_member(workflow_channel_id, actor_pubkey)?;
            let event = EventBuilder::new(Kind::Custom(7), emoji)
                .tags([
                    Tag::parse(["e", &target])
                        .map_err(|error| format!("workflow reaction target: {error}"))?,
                    Tag::parse(["h", workflow_channel_id])
                        .map_err(|error| format!("workflow reaction channel: {error}"))?,
                ])
                .sign_with_keys(&authority.workflow_signer)
                .map_err(|error| format!("sign workflow reaction: {error}"))?;
            let event_id = event.id.to_hex();
            authority.persist_and_publish(event)?;
            Ok(StepOutcome::Completed(json!({
                "event_id": event_id,
                "target_event_id": target,
                "emoji": step.get("emoji").and_then(Value::as_str).unwrap_or_default()
            })))
        }
        "call_webhook" => call_webhook(step, trigger_event).map(StepOutcome::Completed),
        "request_approval" => {
            let approver_spec = step
                .get("from")
                .and_then(Value::as_str)
                .unwrap_or("any")
                .trim()
                .to_string();
            let message = step
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Approval required")
                .trim()
                .to_string();
            let timeout = step
                .get("timeout")
                .and_then(Value::as_str)
                .map(parse_duration_seconds)
                .transpose()?
                .unwrap_or(86_400);
            let approval_ref = Uuid::new_v4().simple().to_string();
            let step_id = step.get("id").and_then(Value::as_str).unwrap_or("approval");
            let now = unix_seconds();
            let database = authority
                .database
                .lock()
                .map_err(|error| format!("lock local authority database: {error}"))?;
            database
                .execute(
                    "INSERT INTO workflow_approvals(token, workflow_id, run_id, step_id,
                         step_index, approver_spec, status, approver_pubkey, note,
                         expires_at, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, NULL, ?7, ?8)",
                    params![
                        approval_ref,
                        context.workflow_id,
                        context.run_id,
                        step_id,
                        step_index as i64,
                        approver_spec,
                        now.saturating_add(timeout),
                        now
                    ],
                )
                .map_err(|error| format!("create local workflow approval: {error}"))?;
            Ok(StepOutcome::WaitingApproval {
                approval_ref,
                approver_spec,
                message,
            })
        }
        "set_channel_topic" => {
            let topic = step
                .get("topic")
                .and_then(Value::as_str)
                .ok_or_else(|| "set_channel_topic topic is missing".to_string())?;
            if topic.chars().count() > 500 {
                return Err("set_channel_topic exceeds 500 characters".to_string());
            }
            authority.set_channel_topic_snapshot(workflow_channel_id, topic)?;
            Ok(StepOutcome::Completed(json!({
                "channel_id": workflow_channel_id,
                "topic": topic
            })))
        }
        "delay" => {
            let duration = step
                .get("duration")
                .and_then(Value::as_str)
                .ok_or_else(|| "delay duration is missing".to_string())?;
            let delay = parse_duration_seconds(duration)?;
            let now = unix_seconds();
            let due_at = now.saturating_add(delay);
            let database = authority
                .database
                .lock()
                .map_err(|error| format!("lock local authority database: {error}"))?;
            database
                .execute(
                    "INSERT INTO workflow_timers(run_id, workflow_id, step_index, due_at,
                         status, created_at, completed_at)
                     VALUES (?1, ?2, ?3, ?4, 'pending', ?5, NULL)
                     ON CONFLICT(run_id, step_index) DO NOTHING",
                    params![
                        context.run_id,
                        context.workflow_id,
                        step_index as i64,
                        due_at,
                        now
                    ],
                )
                .map_err(|error| format!("persist local workflow delay: {error}"))?;
            Ok(StepOutcome::WaitingDelay { due_at })
        }
        other => Err(format!("action not implemented locally: {other}")),
    }
}

fn update_run(
    authority: &LocalAuthority,
    run_id: &str,
    status: &str,
    current_step: usize,
    trace: &[Value],
    failure: Option<&(String, String)>,
) -> Result<(), String> {
    let completed_at = matches!(status, "completed" | "failed" | "cancelled").then(unix_seconds);
    let database = authority
        .database
        .lock()
        .map_err(|error| format!("lock local authority database: {error}"))?;
    database
        .execute(
            "UPDATE workflow_runs SET status = ?1, current_step = ?2,
                 execution_trace_json = ?3, completed_at = ?4,
                 error_code = ?5, error_message = ?6 WHERE id = ?7",
            params![
                status,
                current_step as i64,
                Value::Array(trace.to_vec()).to_string(),
                completed_at,
                failure.map(|value| value.0.as_str()),
                failure.map(|value| value.1.as_str()),
                run_id
            ],
        )
        .map_err(|error| format!("update local workflow run: {error}"))?;
    Ok(())
}

pub(super) fn approval_command(
    authority: &LocalAuthority,
    event: &Event,
) -> Result<super::SubmitResponse, String> {
    authority.assert_member_can_publish(&event.pubkey.to_hex())?;
    let token = tag_value(event, "t")
        .or_else(|| tag_value(event, "d"))
        .or_else(|| tag_value(event, "e"))
        .ok_or_else(|| "approval command requires an approval reference".to_string())?;
    let actor = event.pubkey.to_hex();
    let actor_role = authority.member_role(&actor)?;
    let granted = event.kind.as_u16() as u32 == 46_030;
    let status = if granted { "granted" } else { "denied" };
    let now = unix_seconds();

    let (workflow_id, run_id, step_index, approver_spec) = {
        let mut database = authority
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        let transaction = database
            .transaction()
            .map_err(|error| format!("begin workflow approval: {error}"))?;
        let approval = transaction
            .query_row(
                "SELECT workflow_id, run_id, step_index, approver_spec, status, expires_at
                 FROM workflow_approvals WHERE token = ?1",
                [&token],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, usize>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| format!("read local workflow approval: {error}"))?
            .ok_or_else(|| "workflow approval was not found".to_string())?;
        if approval.4 != "pending" {
            return Err(format!("workflow approval is already {}", approval.4));
        }
        if approval.5 <= now {
            transaction
                .execute(
                    "UPDATE workflow_approvals SET status = 'expired' WHERE token = ?1",
                    [&token],
                )
                .map_err(|error| format!("expire local workflow approval: {error}"))?;
            transaction
                .commit()
                .map_err(|error| format!("commit workflow approval expiry: {error}"))?;
            return Err("workflow approval has expired".to_string());
        }
        check_approver_spec(&approval.3, &actor, actor_role.as_deref())?;
        let changed = transaction
            .execute(
                "UPDATE workflow_approvals SET status = ?1, approver_pubkey = ?2, note = ?3
                 WHERE token = ?4 AND status = 'pending'",
                params![
                    status,
                    actor,
                    (!event.content.trim().is_empty()).then(|| event.content.trim()),
                    token
                ],
            )
            .map_err(|error| format!("resolve local workflow approval: {error}"))?;
        if changed != 1 {
            return Err("workflow approval result is ambiguous".to_string());
        }
        transaction
            .commit()
            .map_err(|error| format!("commit local workflow approval: {error}"))?;
        (approval.0, approval.1, approval.2, approval.3)
    };

    authority.persist_and_publish(event.clone())?;
    if granted {
        resume_after_approval(authority, &workflow_id, &run_id, step_index, &approver_spec)?;
    } else {
        deny_run_after_approval(authority, &run_id, step_index)?;
    }
    Ok(super::SubmitResponse {
        event_id: event.id.to_hex(),
        accepted: true,
        message: format!(
            "response:{}",
            json!({
                "token": token,
                "status": status,
                "run_id": run_id,
                "workflow_id": workflow_id
            })
        ),
    })
}

fn resume_after_approval(
    authority: &LocalAuthority,
    workflow_id: &str,
    run_id: &str,
    step_index: usize,
    approver_spec: &str,
) -> Result<(), String> {
    let definition_event = authority
        .query(&[json!({"kinds": [30620], "#d": [workflow_id], "limit": 1})])?
        .into_iter()
        .next()
        .ok_or_else(|| "workflow definition disappeared before approval".to_string())?;
    let definition: Value = serde_yaml::from_str(&definition_event.content)
        .map_err(|error| format!("invalid workflow YAML after approval: {error}"))?;
    let (actor_pubkey, trigger_event, mut trace) = load_run_context(authority, run_id)?;
    if let Some(step) = trace.get_mut(step_index) {
        step["status"] = json!("completed");
        step["completed_at"] = json!(unix_seconds());
        step["output"]["approval_status"] = json!("granted");
        step["output"]["approver_spec"] = json!(approver_spec);
    }
    let context = WorkflowRunContext {
        authority,
        workflow_id,
        run_id,
        definition_event: &definition_event,
        definition: &definition,
        trigger_event: &trigger_event,
        actor_pubkey: &actor_pubkey,
    };
    run_steps(&context, step_index + 1, trace)
}

fn load_run_context(
    authority: &LocalAuthority,
    run_id: &str,
) -> Result<(String, Event, Vec<Value>), String> {
    let (actor_pubkey, trigger_json, trace_json) = {
        let database = authority
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .query_row(
                "SELECT runs.actor_pubkey, context.trigger_event_json,
                        runs.execution_trace_json
                 FROM workflow_runs runs
                 JOIN workflow_run_context context ON context.run_id = runs.id
                 WHERE runs.id = ?1",
                [run_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                },
            )
            .map_err(|error| format!("read local workflow run context: {error}"))?
    };
    let trigger_event = Event::from_json(trigger_json)
        .map_err(|error| format!("decode local workflow trigger: {error}"))?;
    let trace = serde_json::from_str::<Vec<Value>>(&trace_json)
        .map_err(|error| format!("decode local workflow trace: {error}"))?;
    Ok((actor_pubkey, trigger_event, trace))
}

fn deny_run_after_approval(
    authority: &LocalAuthority,
    run_id: &str,
    step_index: usize,
) -> Result<(), String> {
    let trace_json = {
        let database = authority
            .database
            .lock()
            .map_err(|error| format!("lock local authority database: {error}"))?;
        database
            .query_row(
                "SELECT execution_trace_json FROM workflow_runs WHERE id = ?1",
                [run_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| format!("read denied workflow trace: {error}"))?
    };
    let mut trace = serde_json::from_str::<Vec<Value>>(&trace_json)
        .map_err(|error| format!("decode denied workflow trace: {error}"))?;
    if let Some(step) = trace.get_mut(step_index) {
        step["status"] = json!("failed");
        step["completed_at"] = json!(unix_seconds());
        step["error"] = json!("approval denied");
    }
    let failure = (
        "workflow_approval_denied".to_string(),
        "approval denied".to_string(),
    );
    update_run(
        authority,
        run_id,
        "failed",
        step_index,
        &trace,
        Some(&failure),
    )
}

fn evaluate_step_condition(
    step: &Value,
    trigger_event: &Event,
    trace: &[Value],
) -> Result<bool, String> {
    let Some(condition) = step.get("if") else {
        return Ok(true);
    };
    if let Some(value) = condition.as_bool() {
        return Ok(value);
    }
    let expression = condition
        .as_str()
        .ok_or_else(|| "workflow condition must be a boolean or expression string".to_string())?;
    if expression.len() > 4_096 {
        return Err("workflow condition exceeds 4096 bytes".to_string());
    }
    let mut context = HashMapContext::new();
    for (name, value) in [
        ("trigger_text", trigger_event.content.clone()),
        ("trigger_author", trigger_author(trigger_event)),
        (
            "trigger_channel_id",
            tag_value(trigger_event, "h").unwrap_or_default(),
        ),
        (
            "trigger_message_id",
            tag_value(trigger_event, "e").unwrap_or_default(),
        ),
    ] {
        context
            .set_value(name.to_string(), EvalValue::String(value))
            .map_err(|error| format!("build workflow condition context: {error}"))?;
    }
    for entry in trace {
        let Some(step_id) = entry.get("step_id").and_then(Value::as_str) else {
            continue;
        };
        let Some(output) = entry.get("output").and_then(Value::as_object) else {
            continue;
        };
        for (field, value) in output {
            context
                .set_value(
                    format!("steps_{step_id}_output_{field}"),
                    json_to_eval_value(value),
                )
                .map_err(|error| format!("build workflow step condition context: {error}"))?;
        }
    }
    evalexpr::eval_boolean_with_context(expression, &context)
        .map_err(|error| format!("evaluate workflow condition '{expression}': {error}"))
}

fn json_to_eval_value(value: &Value) -> EvalValue {
    match value {
        Value::String(value) => EvalValue::String(value.clone()),
        Value::Bool(value) => EvalValue::Boolean(*value),
        Value::Number(value) if value.is_i64() => {
            EvalValue::Int(value.as_i64().unwrap_or_default())
        }
        Value::Number(value) => EvalValue::Float(value.as_f64().unwrap_or_default()),
        Value::Null => EvalValue::Empty,
        other => EvalValue::String(other.to_string()),
    }
}

fn render_template(template: &str, trigger_event: &Event) -> String {
    template
        .replace("{{trigger.author}}", &trigger_author(trigger_event))
        .replace(
            "{{trigger.message_id}}",
            &tag_value(trigger_event, "e").unwrap_or_default(),
        )
        .replace(
            "{{trigger.channel_id}}",
            &tag_value(trigger_event, "h").unwrap_or_default(),
        )
        .replace("{{trigger.text}}", &trigger_event.content)
}

fn trigger_author(trigger_event: &Event) -> String {
    tag_value(trigger_event, "p").unwrap_or_else(|| trigger_event.pubkey.to_hex())
}

fn check_approver_spec(
    spec: &str,
    actor_pubkey: &str,
    actor_role: Option<&str>,
) -> Result<(), String> {
    let spec = spec.trim();
    let allowed = match spec {
        "" | "any" => true,
        "@owner" | "owner" => actor_role == Some("owner"),
        "@admin" | "admin" => matches!(actor_role, Some("owner" | "admin")),
        "@member" | "member" => actor_role.is_some(),
        exact if exact.len() == 64 && exact.bytes().all(|byte| byte.is_ascii_hexdigit()) => {
            exact.eq_ignore_ascii_case(actor_pubkey)
        }
        _ => false,
    };
    allowed
        .then_some(())
        .ok_or_else(|| "forbidden: identity is not the designated workflow approver".to_string())
}

fn parse_duration_seconds(raw: &str) -> Result<i64, String> {
    let raw = raw.trim();
    let (digits, unit) = raw.split_at(raw.len().saturating_sub(1));
    let amount = digits
        .parse::<i64>()
        .map_err(|_| "workflow duration is invalid".to_string())?;
    let multiplier = match unit {
        "s" => 1,
        "m" => 60,
        "h" => 3_600,
        "d" => 86_400,
        _ => return Err("workflow duration unit is invalid".to_string()),
    };
    let seconds = amount.saturating_mul(multiplier);
    if !(1..=2_592_000).contains(&seconds) {
        return Err("workflow duration must be between 1 second and 30 days".to_string());
    }
    Ok(seconds)
}

fn unix_seconds() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}
