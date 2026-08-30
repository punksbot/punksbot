use std::sync::Arc;

use axum::{
    extract::{Extension, OriginalUri, Path, Query},
    http::{HeaderMap, Response, StatusCode},
    response::{IntoResponse, Json},
};
use hmac::{Hmac, KeyInit, Mac};
use nostr::{EventBuilder, Kind, Tag};
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use sha2::Sha256;
use uuid::Uuid;

use super::{derive_webhook_secret, unix_seconds, RunsQuery};
use crate::local_authority::{error_response, governance::nip98_actor, LocalAuthority};

pub(crate) async fn runs(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path(workflow_id): Path<String>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(query): Query<RunsQuery>,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "GET", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    match authority.workflow_runs(&actor, &workflow_id, query.limit.unwrap_or(20)) {
        Ok(runs) => Json(json!({"runs": runs, "next": null})).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error),
    }
}

pub(crate) async fn approvals(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path((workflow_id, run_id)): Path<(String, String)>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
) -> Response<axum::body::Body> {
    let actor = match nip98_actor(&headers, "GET", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    match authority.workflow_approvals(&actor, &workflow_id, &run_id) {
        Ok(approvals) => Json(json!({"approvals": approvals})).into_response(),
        Err(error) if error.starts_with("forbidden:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error),
    }
}

pub(crate) async fn webhook(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path(workflow_id): Path<String>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response<axum::body::Body> {
    match process_webhook(&authority, &workflow_id, &headers, &body) {
        Ok(result) => Json(result).into_response(),
        Err(error) if error.starts_with("unauthorized:") => {
            error_response(StatusCode::UNAUTHORIZED, &error)
        }
        Err(error) if error.starts_with("ambiguous:") => {
            error_response(StatusCode::CONFLICT, &error)
        }
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error),
    }
}

fn process_webhook(
    authority: &LocalAuthority,
    workflow_id: &str,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<Value, String> {
    Uuid::parse_str(workflow_id).map_err(|_| "invalid workflow id".to_string())?;
    if body.len() > 1024 * 1024 {
        return Err("workflow webhook body exceeds 1 MiB".to_string());
    }
    let body_text =
        std::str::from_utf8(body).map_err(|_| "workflow webhook body must be UTF-8".to_string())?;
    serde_json::from_str::<Value>(body_text)
        .map_err(|error| format!("workflow webhook body must be JSON: {error}"))?;
    let timestamp = headers
        .get("x-punks-timestamp")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(|| "unauthorized: missing webhook timestamp".to_string())?;
    if (unix_seconds() - timestamp).abs() > 300 {
        return Err("unauthorized: workflow webhook timestamp expired".to_string());
    }
    let signature = headers
        .get("x-punks-signature")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("sha256="))
        .and_then(|value| hex::decode(value).ok())
        .ok_or_else(|| "unauthorized: missing workflow webhook signature".to_string())?;
    let secret = derive_webhook_secret(authority, workflow_id)?;
    let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes())
        .map_err(|error| format!("initialize workflow webhook verifier: {error}"))?;
    mac.update(timestamp.to_string().as_bytes());
    mac.update(b".");
    mac.update(body);
    mac.verify_slice(&signature)
        .map_err(|_| "unauthorized: workflow webhook signature mismatch".to_string())?;
    let delivery_id = headers
        .get("x-punks-delivery-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| Uuid::parse_str(value).is_ok())
        .ok_or_else(|| "workflow webhook delivery id is invalid".to_string())?;

    if let Some(existing) = existing_webhook_delivery(authority, workflow_id, delivery_id)? {
        return existing
            .map(|run_id| {
                json!({
                    "workflow_id": workflow_id,
                    "run_id": run_id,
                    "duplicate": true
                })
            })
            .ok_or_else(|| "ambiguous: workflow webhook delivery is still processing".to_string());
    }
    reserve_webhook_delivery(authority, workflow_id, delivery_id)?;
    let trigger = EventBuilder::new(Kind::Custom(46_020), body_text)
        .tags([
            Tag::parse(["d", workflow_id])
                .map_err(|error| format!("workflow webhook id tag: {error}"))?,
            Tag::parse(["webhook-delivery", delivery_id])
                .map_err(|error| format!("workflow webhook delivery tag: {error}"))?,
        ])
        .sign_with_keys(&authority.workflow_signer)
        .map_err(|error| format!("sign local workflow webhook trigger: {error}"))?;
    match authority.submit(trigger) {
        Ok(response) => {
            let acknowledgement = response
                .message
                .strip_prefix("response:")
                .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
                .and_then(|value| {
                    value
                        .get("run_id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                })
                .ok_or_else(|| "ambiguous: workflow webhook run id is missing".to_string())?;
            complete_webhook_delivery(authority, delivery_id, &acknowledgement, None)?;
            Ok(json!({
                "workflow_id": workflow_id,
                "run_id": acknowledgement,
                "duplicate": false
            }))
        }
        Err(error) => {
            complete_webhook_delivery(authority, delivery_id, "", Some(&error))?;
            Err(error)
        }
    }
}

fn existing_webhook_delivery(
    authority: &LocalAuthority,
    workflow_id: &str,
    delivery_id: &str,
) -> Result<Option<Option<String>>, String> {
    let database = authority
        .database
        .lock()
        .map_err(|error| format!("lock local authority database: {error}"))?;
    let existing = database
        .query_row(
            "SELECT workflow_id, status, run_id, error_message
             FROM workflow_webhook_deliveries WHERE delivery_id = ?1",
            [delivery_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("read workflow webhook delivery: {error}"))?;
    match existing {
        None => Ok(None),
        Some((stored_workflow, _, _, _)) if stored_workflow != workflow_id => {
            Err("workflow webhook delivery id belongs to another workflow".to_string())
        }
        Some((_, status, run_id, _)) if status == "completed" => Ok(Some(run_id)),
        Some((_, status, _, error)) if status == "failed" => Err(format!(
            "workflow webhook delivery previously failed: {}",
            error.unwrap_or_else(|| "unknown failure".to_string())
        )),
        Some(_) => Ok(Some(None)),
    }
}

fn reserve_webhook_delivery(
    authority: &LocalAuthority,
    workflow_id: &str,
    delivery_id: &str,
) -> Result<(), String> {
    let database = authority
        .database
        .lock()
        .map_err(|error| format!("lock local authority database: {error}"))?;
    database
        .execute(
            "INSERT INTO workflow_webhook_deliveries(delivery_id, workflow_id, status,
                 run_id, error_message, received_at, completed_at)
             VALUES (?1, ?2, 'processing', NULL, NULL, ?3, NULL)",
            params![delivery_id, workflow_id, unix_seconds()],
        )
        .map_err(|error| format!("reserve workflow webhook delivery: {error}"))?;
    Ok(())
}

fn complete_webhook_delivery(
    authority: &LocalAuthority,
    delivery_id: &str,
    run_id: &str,
    error: Option<&str>,
) -> Result<(), String> {
    let database = authority
        .database
        .lock()
        .map_err(|lock_error| format!("lock local authority database: {lock_error}"))?;
    database
        .execute(
            "UPDATE workflow_webhook_deliveries SET status = ?2, run_id = ?3,
                 error_message = ?4, completed_at = ?5 WHERE delivery_id = ?1",
            params![
                delivery_id,
                if error.is_some() {
                    "failed"
                } else {
                    "completed"
                },
                (!run_id.is_empty()).then_some(run_id),
                error,
                unix_seconds()
            ],
        )
        .map_err(|update_error| format!("complete workflow webhook delivery: {update_error}"))?;
    Ok(())
}
