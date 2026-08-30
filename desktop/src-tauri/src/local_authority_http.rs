use std::sync::Arc;

use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::{
    body::{Body, Bytes},
    extract::{ws::WebSocketUpgrade, Extension, OriginalUri, Query, State},
    http::{header, HeaderMap, Request, Response, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json},
    routing::{get, post, put},
    Router,
};
use nostr::{Event, JsonUtil};
use serde::Deserialize;
use serde_json::{json, Value};

use super::{
    git, governance, huddles, invites, media, websocket, workflows,
    workspace_hub::LocalAuthorityHub, LocalAuthority,
};

#[derive(Debug, Deserialize)]
struct AuditQuery {
    limit: Option<usize>,
}

fn authority_routes() -> Router {
    Router::new()
        .route("/", get(root))
        .route("/info", get(info))
        .route("/health", get(health))
        .route("/query", post(query_events))
        .route("/count", post(count_events))
        .route("/events", post(submit_event))
        .route("/audit", get(read_audit))
        .route("/moderation/reports", get(governance::reports))
        .route("/moderation/audit", get(governance::audit))
        .route("/moderation/restricted", get(governance::restricted))
        .route("/api/join-policy", get(invites::join_policy))
        .route("/api/invites", post(invites::mint))
        .route("/api/invites/claim", post(invites::claim))
        .route("/api/invites/accept-policy", post(invites::accept_policy))
        .route("/workflows/{workflow_id}/runs", get(workflows::runs))
        .route("/hooks/{workflow_id}", post(workflows::webhook))
        .route(
            "/workflows/{workflow_id}/runs/{run_id}/approvals",
            get(workflows::approvals),
        )
        .route("/huddle/{channel_id}/audio", get(huddles::audio_socket))
        .route(
            "/git/{owner}/{repository}/{*tail}",
            get(git::serve).post(git::serve),
        )
        .route("/upload", put(media::upload))
        .route("/media/upload", put(media::upload))
        .route("/media/{sha256}", get(media::download).head(media::head))
        .route(
            "/media/{sha256}/variants/{variant}",
            get(media::download_variant).head(media::head_variant),
        )
}

#[cfg(test)]
pub(super) fn authority_router(authority: Arc<LocalAuthority>) -> Router {
    authority_routes().layer(Extension(authority))
}

pub(super) fn authority_hub_router(hub: Arc<LocalAuthorityHub>) -> Router {
    authority_routes().layer(middleware::from_fn_with_state(hub, select_workspace))
}

async fn select_workspace(
    State(hub): State<Arc<LocalAuthorityHub>>,
    mut request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let host = request
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let workspace_id = match workspace_id_from_host(host) {
        Ok(workspace_id) => workspace_id,
        Err(error) => return error_response(StatusCode::MISDIRECTED_REQUEST, &error),
    };
    match hub.authority(&workspace_id) {
        Ok(authority) => {
            request.extensions_mut().insert(authority);
            next.run(request).await
        }
        Err(error) => error_response(StatusCode::NOT_FOUND, &error),
    }
}

fn workspace_id_from_host(host: &str) -> Result<String, String> {
    let hostname = host
        .split(':')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if matches!(hostname.as_str(), "127.0.0.1" | "localhost") {
        return Ok(LocalAuthorityHub::PRIMARY_ID.to_string());
    }
    let workspace_id = hostname
        .strip_suffix(".localhost")
        .ok_or_else(|| "local authority accepts loopback Workspace hosts only".to_string())?;
    uuid::Uuid::parse_str(workspace_id).map_err(|_| "invalid local Workspace host".to_string())?;
    Ok(workspace_id.to_string())
}

async fn root(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    websocket: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
) -> Response<Body> {
    match websocket {
        Ok(websocket) => websocket
            .on_upgrade(move |socket| websocket::session(socket, authority))
            .into_response(),
        Err(_) => match relay_info(&authority) {
            Ok(info) => info.into_response(),
            Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
        },
    }
}

async fn info(Extension(authority): Extension<Arc<LocalAuthority>>) -> Response<Body> {
    match relay_info(&authority) {
        Ok(info) => info.into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

fn relay_info(authority: &LocalAuthority) -> Result<Json<Value>, String> {
    Ok(Json(json!({
        "name": "Punks Full Local",
        "description": "Persistent local authority embedded in Punks Full",
        "software": "punks-full-local",
        "version": env!("CARGO_PKG_VERSION"),
        "self": authority.signer.public_key().to_hex(),
        "workspace_id": authority.workspace_id(),
        "icon": authority.workspace_icon()?,
        "supported_nips": [1, 9, 11, 22, 25, 29, 42, 43, 45, 50],
        "limitation": {
            "auth_required": true,
            "payment_required": false,
            "restricted_writes": false
        }
    })))
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "ok")
}

async fn query_events(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    let actor = match governance::nip98_actor_with_payload(&headers, "POST", &uri, Some(&body)) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    let filters = match serde_json::from_slice::<Vec<Value>>(&body) {
        Ok(filters) => filters,
        Err(error) => {
            return error_response(StatusCode::BAD_REQUEST, &format!("invalid query: {error}"))
        }
    };
    match authority.query_for_actor(&actor, &filters) {
        Ok(events) => Json(events).into_response(),
        Err(error) if error.starts_with("restricted:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn count_events(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    let actor = match governance::nip98_actor_with_payload(&headers, "POST", &uri, Some(&body)) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    let filters = match serde_json::from_slice::<Vec<Value>>(&body) {
        Ok(filters) => filters,
        Err(error) => {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("invalid count query: {error}"),
            )
        }
    };
    match authority.query_for_actor(&actor, &filters) {
        Ok(events) => Json(json!({"count": events.len()})).into_response(),
        Err(error) if error.starts_with("restricted:") => {
            error_response(StatusCode::FORBIDDEN, &error)
        }
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn read_audit(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    Query(query): Query<AuditQuery>,
) -> Response<Body> {
    let actor = match governance::nip98_actor(&headers, "GET", &uri) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    if let Err(error) = authority.require_moderator(&actor) {
        return error_response(StatusCode::FORBIDDEN, &error);
    }
    match authority.audit_entries(query.limit.unwrap_or(100)) {
        Ok(entries) => Json(entries).into_response(),
        Err(error) => error_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    }
}

async fn submit_event(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    OriginalUri(uri): OriginalUri,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    let actor = match governance::nip98_actor_with_payload(&headers, "POST", &uri, Some(&body)) {
        Ok(actor) => actor,
        Err(error) => return error_response(StatusCode::UNAUTHORIZED, &error),
    };
    let event = match Event::from_json(body.as_ref()) {
        Ok(event) => event,
        Err(error) => {
            return error_response(StatusCode::BAD_REQUEST, &format!("invalid event: {error}"));
        }
    };
    if event.pubkey.to_hex() != actor {
        return error_response(
            StatusCode::FORBIDDEN,
            "NIP-98 signer does not match submitted event",
        );
    }
    match authority.submit(event) {
        Ok(response) => Json(response).into_response(),
        Err(error) => error_response(StatusCode::BAD_REQUEST, &error),
    }
}

pub(crate) fn error_response(status: StatusCode, error: &str) -> Response<Body> {
    let mut response = Json(json!({"error": error})).into_response();
    *response.status_mut() = status;
    response
}
