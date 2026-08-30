use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

use crate::{ClientDistribution, ClientPlatform, FailureKind, PunksAccountClient};

const SESSION_ID: &str = "99999999-9999-4999-8999-999999999999";
const PUNK_ID: &str = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID: &str = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID: &str = "33333333-3333-4333-8333-333333333333";

async fn read_request(stream: &mut TcpStream) -> String {
    let mut request = Vec::new();
    let mut chunk = [0_u8; 4096];
    loop {
        let read = stream.read(&mut chunk).await.expect("read request");
        assert_ne!(read, 0, "request closed before its headers");
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|part| part == b"\r\n\r\n") {
            return String::from_utf8(request).expect("utf8 request");
        }
    }
}

async fn respond(stream: &mut TcpStream, body: serde_json::Value, cookie: bool) {
    let body = body.to_string();
    let set_cookie = if cookie {
        format!(
            "set-cookie: punks_session_dev={}; Path=/; HttpOnly; SameSite=Strict\r\n",
            "S".repeat(64),
        )
    } else {
        String::new()
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n{set_cookie}\r\n{body}",
        body.len(),
    );
    stream
        .write_all(response.as_bytes())
        .await
        .expect("write response");
}

fn session() -> serde_json::Value {
    serde_json::json!({
        "sessionId": SESSION_ID,
        "punkId": PUNK_ID,
        "authenticatedAt": "2026-08-29T12:00:00.000Z",
        "expiresAt": "2099-08-29T12:00:00.000Z",
        "recentReauthUntil": null,
        "punk": {
            "id": PUNK_ID,
            "displayName": "Punk local",
            "avatarUrl": null
        }
    })
}

async fn run_local_boundary(listener: TcpListener, origin: String) -> Vec<String> {
    let mut requests = Vec::new();
    for _ in 0..3 {
        let (mut stream, _) = listener.accept().await.expect("accept request");
        let request = read_request(&mut stream).await;
        let request_line = request.lines().next().expect("request line").to_string();
        requests.push(request_line.clone());
        match request_line.as_str() {
            "POST /api/v1/desktop/compatibility HTTP/1.1" => {
                respond(
                    &mut stream,
                    serde_json::json!({
                        "contract": "desktop.compatibility-response@1",
                        "compatible": true,
                        "profile": "desktop-social-loop@1",
                        "registryVersion": 1,
                        "minimumClientVersion": "0.6.0",
                        "environment": "local",
                        "origin": origin,
                        "capabilities": []
                    }),
                    false,
                )
                .await;
            }
            "POST /__dev/bootstrap HTTP/1.1" => {
                assert!(request.contains("origin: http://localhost:1420"));
                respond(
                    &mut stream,
                    serde_json::json!({
                        "session": session(),
                        "coordinates": {
                            "workspaceSlug": "punks-bot-local",
                            "workspaceId": WORKSPACE_ID,
                            "conversationId": CONVERSATION_ID
                        }
                    }),
                    true,
                )
                .await;
            }
            "GET /api/auth/v1/session HTTP/1.1" => {
                assert!(request.contains("punks_session_dev="));
                respond(
                    &mut stream,
                    serde_json::json!({ "session": session() }),
                    false,
                )
                .await;
            }
            _ => panic!("unexpected local request: {request_line}"),
        }
    }
    requests
}

#[tokio::test]
async fn local_bootstrap_installs_only_the_loopback_session() {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind server");
    let origin = format!("http://{}", listener.local_addr().expect("server address"));
    let server = tokio::spawn(run_local_boundary(listener, origin.clone()));
    let client = PunksAccountClient::new(
        &origin,
        "0.6.0",
        ClientDistribution::Development,
        ClientPlatform::MacosArm64,
    )
    .expect("local client");

    client
        .check_compatibility()
        .await
        .expect("local compatibility");
    let prepared = client
        .prepare_local_bootstrap()
        .await
        .expect("prepare local bootstrap");
    assert_eq!(prepared.session.session_id, SESSION_ID);
    assert_eq!(prepared.metadata.punk_id, PUNK_ID);
    client
        .activate_prepared_session(&prepared.cookie)
        .await
        .expect("activate local Session");
    assert_eq!(
        client.get_session().await.expect("read local Session"),
        prepared.session,
    );
    assert_eq!(
        server.await.expect("local boundary"),
        [
            "POST /api/v1/desktop/compatibility HTTP/1.1",
            "POST /__dev/bootstrap HTTP/1.1",
            "GET /api/auth/v1/session HTTP/1.1",
        ],
    );
}

#[tokio::test]
async fn non_local_distribution_cannot_use_the_bootstrap_seam() {
    let client = PunksAccountClient::new(
        "https://staging.punks.bot",
        "0.6.0",
        ClientDistribution::Staging,
        ClientPlatform::MacosArm64,
    )
    .expect("staging client");
    assert_eq!(
        client
            .prepare_local_bootstrap()
            .await
            .expect_err("staging must reject local bootstrap")
            .kind,
        FailureKind::ContractViolation,
    );
}
