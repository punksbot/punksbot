use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use punks_account_client::ceremony::{
    AuthenticationMethod, NativeVerifier, PendingAuthIntent, PendingAuthPhase,
};
use punks_account_client::FailureKind;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use super::*;
use crate::punks_session_store::{CredentialStore, PendingAuthFlow};

const FLOW_ID: &str = "11111111-1111-4111-8111-111111111111";
const DELIVERY_ID: &str = "22222222-2222-4222-8222-222222222222";
const SESSION_ID: &str = "33333333-3333-4333-8333-333333333333";
const PUNK_ID: &str = "44444444-4444-4444-8444-444444444444";
const EXPIRES_AT: &str = "2099-01-01T00:00:00.000Z";

struct MemoryCredentialStore(Arc<Mutex<Option<String>>>);

impl CredentialStore for MemoryCredentialStore {
    fn load(&self, _service: &str, _key: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().map_err(|_| "memory store lock")?.clone())
    }

    fn store(&self, _service: &str, _key: &str, value: &str) -> Result<(), String> {
        *self.0.lock().map_err(|_| "memory store lock")? = Some(value.to_string());
        Ok(())
    }

    fn delete(&self, _service: &str, _key: &str) -> Result<(), String> {
        *self.0.lock().map_err(|_| "memory store lock")? = None;
        Ok(())
    }
}

fn persistence(backing: Arc<Mutex<Option<String>>>) -> KeyringSessionPersistence {
    let credentials: Arc<dyn CredentialStore> = Arc::new(MemoryCredentialStore(backing));
    KeyringSessionPersistence::with_store("punks-desktop-crash-test", credentials)
}

fn session() -> Value {
    json!({
        "sessionId": SESSION_ID,
        "punkId": PUNK_ID,
        "authenticatedAt": "2026-08-25T10:00:00.000Z",
        "expiresAt": EXPIRES_AT,
        "recentReauthUntil": null,
        "punk": { "id": PUNK_ID, "displayName": "Crash Test", "avatarUrl": null }
    })
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut request = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = stream.read(&mut chunk).await.expect("read request");
        assert_ne!(read, 0, "request closed before its headers");
        request.extend_from_slice(&chunk[..read]);
        let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
            continue;
        };
        let headers = String::from_utf8_lossy(&request[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .unwrap_or(0);
        if request.len() >= header_end + 4 + content_length {
            return String::from_utf8(request).expect("utf8 request");
        }
    }
}

async fn respond(stream: &mut TcpStream, body: Value, headers: &[(&str, String)]) {
    let body = body.to_string();
    let extra = headers
        .iter()
        .map(|(name, value)| format!("{name}: {value}\r\n"))
        .collect::<String>();
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n{extra}\r\n{body}",
        body.len(),
    );
    stream
        .write_all(response.as_bytes())
        .await
        .expect("write response");
}

async fn run_auth_boundary(listener: TcpListener, origin: String) -> Vec<String> {
    let mut paths = Vec::new();
    let mut status_count = 0;
    let mut confirm_count = 0;
    for _ in 0..8 {
        let (mut stream, _) = listener.accept().await.expect("accept request");
        let request = read_request(&mut stream).await;
        let request_line = request.lines().next().expect("request line").to_string();
        paths.push(request_line.clone());
        let mut parts = request_line.split_whitespace();
        let method = parts.next().expect("method");
        let path = parts.next().expect("path");
        match (method, path) {
            ("POST", "/api/v1/desktop/compatibility") => {
                respond(
                    &mut stream,
                    json!({
                        "contract": "desktop.compatibility-response@1",
                        "compatible": true,
                        "profile": "desktop-social-loop@1",
                        "registryVersion": 1,
                        "minimumClientVersion": "0.1.0",
                        "environment": "local",
                        "origin": origin,
                        "capabilities": []
                    }),
                    &[],
                )
                .await;
            }
            ("POST", "/api/auth/v1/desktop/status") => {
                status_count += 1;
                respond(
                    &mut stream,
                    json!({
                        "contract": "desktop-auth.status@1",
                        "message": "response",
                        "flowId": FLOW_ID,
                        "phase": if status_count == 1 { "ready" } else { "delivering" },
                        "terminal": false,
                        "expiresAt": EXPIRES_AT,
                        "result": "success",
                        "outcomeCode": "authenticated",
                        "decision": {
                            "oldSessionUsable": false,
                            "revokePreparedSession": false,
                            "destroyWorkspaceContext": false,
                            "retrySameRequest": true,
                            "freshHumanActionRequired": false
                        }
                    }),
                    &[],
                )
                .await;
            }
            ("POST", "/api/auth/v1/desktop/claim") => {
                respond(
                    &mut stream,
                    json!({
                        "contract": "desktop-auth.claim@1",
                        "message": "response",
                        "flowId": FLOW_ID,
                        "phase": "delivering",
                        "deliveryKind": "session",
                        "deliveryId": DELIVERY_ID,
                        "session": session(),
                        "revokeCapability": {
                            "token": "R".repeat(64),
                            "expiresAt": EXPIRES_AT
                        },
                        "deliveryExpiresAt": EXPIRES_AT
                    }),
                    &[(
                        "set-cookie",
                        format!("punks_session_dev={}; Path=/; HttpOnly", "S".repeat(64)),
                    )],
                )
                .await;
            }
            ("GET", "/api/auth/v1/session") => {
                assert!(request.contains("punks_session_dev="));
                respond(&mut stream, json!({ "session": session() }), &[]).await;
            }
            ("POST", "/api/auth/v1/desktop/confirm") => {
                confirm_count += 1;
                if confirm_count == 1 {
                    continue;
                }
                respond(
                    &mut stream,
                    json!({
                        "contract": "desktop-auth.confirm@1",
                        "message": "response",
                        "flowId": FLOW_ID,
                        "phase": "confirmed",
                        "sessionId": SESSION_ID,
                        "confirmedAt": "2026-08-25T10:01:00.000Z"
                    }),
                    &[],
                )
                .await;
            }
            _ => panic!("unexpected native request: {request_line}"),
        }
    }
    paths
}

#[tokio::test]
async fn staged_delivery_resumes_after_process_restart_before_confirmation() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind server");
    let origin = format!("http://{}", listener.local_addr().expect("server address"));
    let server = tokio::spawn(run_auth_boundary(listener, origin.clone()));
    let backing = Arc::new(Mutex::new(None));
    let store = persistence(Arc::clone(&backing));
    store
        .save_pending_auth_flow(&PendingAuthFlow {
            flow_id: FLOW_ID.to_string(),
            verifier: NativeVerifier::decode(&"A".repeat(43)).expect("verifier"),
            intent: PendingAuthIntent::SignIn,
            method: AuthenticationMethod::Google,
            purpose: None,
            workspace_ownership_transfer: None,
            phase: PendingAuthPhase::Ready,
            phase_expires_at: UNIX_EPOCH + Duration::from_secs(4_100_000_000),
            absolute_expires_at: UNIX_EPOCH + Duration::from_secs(4_200_000_000),
        })
        .expect("save ready flow");

    let first_client = PunksDesktopClient::for_test(&origin);
    first_client
        .account()
        .expect("account client")
        .check_compatibility()
        .await
        .expect("compatibility");
    let interrupted = complete_pending_authentication(&first_client, &store)
        .await
        .expect_err("the first confirmation response is lost");
    assert_eq!(interrupted.kind, FailureKind::Transport);
    assert_eq!(
        store
            .reread_staged_activation()
            .expect("read staged activation")
            .expect("staged activation")
            .metadata
            .session_id,
        SESSION_ID,
    );
    drop(first_client);
    drop(store);

    let restarted_store = persistence(backing);
    let restarted_client = PunksDesktopClient::for_test(&origin);
    restarted_client
        .account()
        .expect("restarted account client")
        .check_compatibility()
        .await
        .expect("restarted compatibility");
    assert_eq!(
        complete_pending_authentication(&restarted_client, &restarted_store)
            .await
            .expect("resume staged activation"),
        CeremonyPhaseView::Confirmed {
            session_id: SESSION_ID.to_string(),
        },
    );
    assert_eq!(
        restarted_store
            .load_active_session()
            .expect("read active Session")
            .expect("active Session")
            .metadata
            .session_id,
        SESSION_ID,
    );
    assert!(restarted_store
        .load_pending_auth_flow()
        .expect("read pending flow")
        .is_none());
    assert!(restarted_store
        .reread_staged_activation()
        .expect("read staged activation")
        .is_none());
    assert_eq!(
        server.await.expect("auth boundary"),
        [
            "POST /api/v1/desktop/compatibility HTTP/1.1",
            "POST /api/auth/v1/desktop/status HTTP/1.1",
            "POST /api/auth/v1/desktop/claim HTTP/1.1",
            "GET /api/auth/v1/session HTTP/1.1",
            "POST /api/auth/v1/desktop/confirm HTTP/1.1",
            "POST /api/v1/desktop/compatibility HTTP/1.1",
            "POST /api/auth/v1/desktop/status HTTP/1.1",
            "POST /api/auth/v1/desktop/confirm HTTP/1.1",
        ],
    );
    assert!(SystemTime::now() < UNIX_EPOCH + Duration::from_secs(4_100_000_000));
}
