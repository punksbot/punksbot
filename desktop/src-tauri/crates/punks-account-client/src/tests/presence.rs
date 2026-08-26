use std::{sync::Arc, time::Duration};

use futures_util::SinkExt;
use serde_json::json;
use tokio::{net::TcpListener, sync::RwLock, time::timeout};
use tokio_tungstenite::{
    accept_hdr_async,
    tungstenite::{
        handshake::server::{Request, Response},
        http::HeaderValue,
        Message,
    },
};
use tokio_util::sync::CancellationToken;

use super::super::{
    reduce_follow_frame, reduce_presence_frame, ClientDistribution, ClientPlatform,
    DesktopCompatibility, FollowEffect, FollowPhase, FollowServerFrame, FollowState,
    PresenceDelivery, PresenceEffect, PresenceServerFrame, PresenceState, PunksAccountClient,
    WorkspaceLease, WorkspaceSession,
};

const WORKSPACE_ID: &str = "00000000-0000-8000-8000-000000000001";
const PUNK_ID: &str = "00000000-0000-8000-8000-000000000002";
const LEASE_TOKEN: &str = "pls1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

fn frame(value: serde_json::Value) -> PresenceServerFrame {
    serde_json::from_value(value).expect("valid Presence fixture")
}

#[test]
fn presence_reducer_fences_generations_sequences_and_tokens_before_ipc() {
    let state = PresenceState::new(WORKSPACE_ID, 7);
    let accepted = frame(json!({
        "schemaVersion": 1,
        "type": "accepted",
        "leaseToken": LEASE_TOKEN,
        "leaseGeneration": 3,
        "clientGeneration": 7,
        "heartbeatIntervalMs": 15000,
        "awayAfterMs": 30000,
        "expiresAfterMs": 60000,
        "presences": [{
            "punkId": PUNK_ID,
            "state": "online",
            "status": null,
            "leaseGeneration": 3,
            "sequence": 1,
            "expiresAt": "2032-01-01T00:01:00.000Z"
        }]
    }));
    let reduced = reduce_presence_frame(&state, accepted).expect("accepted");
    let delivery = match reduced.effect {
        PresenceEffect::Delivery(delivery) => delivery,
        PresenceEffect::None => panic!("accepted frame must be delivered"),
    };
    let ipc = serde_json::to_string(&delivery).expect("serializable delivery");
    assert!(!ipc.contains("leaseToken"));
    assert!(!ipc.contains("pls1."));
    assert!(!ipc.contains("session"));
    assert!(!ipc.contains("device"));
    assert!(!format!("{:?}", reduced.state).contains("pls1."));

    let newer = frame(json!({
        "schemaVersion": 1,
        "type": "presence",
        "presence": {
            "punkId": PUNK_ID,
            "state": "away",
            "status": "Reviewing",
            "leaseGeneration": 4,
            "sequence": 2,
            "expiresAt": "2032-01-01T00:02:00.000Z"
        }
    }));
    let reduced = reduce_presence_frame(&reduced.state, newer).expect("new lease");
    assert!(matches!(reduced.effect, PresenceEffect::Delivery(_)));

    let stale_generation = frame(json!({
        "schemaVersion": 1,
        "type": "presence",
        "presence": {
            "punkId": PUNK_ID,
            "state": "online",
            "status": "stale",
            "leaseGeneration": 3,
            "sequence": 99,
            "expiresAt": "2032-01-01T00:03:00.000Z"
        }
    }));
    let ignored = reduce_presence_frame(&reduced.state, stale_generation)
        .expect("stale generation is safely omitted");
    assert!(matches!(ignored.effect, PresenceEffect::None));

    let reordered = frame(json!({
        "schemaVersion": 1,
        "type": "presence",
        "presence": {
            "punkId": PUNK_ID,
            "state": "online",
            "status": "reordered",
            "leaseGeneration": 4,
            "sequence": 1,
            "expiresAt": "2032-01-01T00:03:00.000Z"
        }
    }));
    let ignored = reduce_presence_frame(&reduced.state, reordered)
        .expect("reordered patch is safely omitted");
    assert!(matches!(ignored.effect, PresenceEffect::None));
}

#[test]
fn presence_reducer_rejects_a_wrong_workspace_generation() {
    let state = PresenceState::new(WORKSPACE_ID, 8);
    let accepted = frame(json!({
        "schemaVersion": 1,
        "type": "accepted",
        "leaseToken": LEASE_TOKEN,
        "leaseGeneration": 1,
        "clientGeneration": 7,
        "heartbeatIntervalMs": 15000,
        "awayAfterMs": 30000,
        "expiresAfterMs": 60000,
        "presences": []
    }));
    let error = reduce_presence_frame(&state, accepted).expect_err("stale generation");
    assert_eq!(error.kind, super::super::FailureKind::StaleWorkspace);
}

#[test]
fn conversation_follow_delivers_typing_without_advancing_its_authority_cursor() {
    let accepted: FollowServerFrame = serde_json::from_value(json!({
        "schemaVersion": 1,
        "type": "accepted",
        "resumeAfterCursor": 0,
        "targetHighWaterCursor": 0
    }))
    .expect("accepted FOLLOW frame");
    let caught_up = reduce_follow_frame(&FollowState::new(0), accepted).state;
    let ready: FollowServerFrame = serde_json::from_value(json!({
        "schemaVersion": 1,
        "type": "ready",
        "highWaterCursor": 0
    }))
    .expect("ready FOLLOW frame");
    let live = reduce_follow_frame(&caught_up, ready).state;
    assert_eq!(live.phase, FollowPhase::Live);

    let typing: FollowServerFrame = serde_json::from_value(json!({
        "schemaVersion": 1,
        "type": "typing",
        "patch": {
            "workspaceId": WORKSPACE_ID,
            "conversationId": "00000000-0000-8000-8000-000000000003",
            "punkId": PUNK_ID,
            "active": true,
            "leaseGeneration": 3,
            "sequence": 4,
            "expiresAt": "2032-01-01T00:00:05.000Z"
        }
    }))
    .expect("typing FOLLOW frame");
    super::super::follow::validate_follow_frame(
        &typing,
        WORKSPACE_ID,
        "00000000-0000-8000-8000-000000000003",
    )
    .expect("scoped typing patch");
    let reduced = reduce_follow_frame(&live, typing);
    assert_eq!(reduced.state, live);
    assert!(matches!(reduced.effect, FollowEffect::Typing(_)));
}

#[tokio::test]
#[allow(clippy::result_large_err)] // The WebSocket handshake callback fixes this third-party Result type.
async fn one_native_presence_connection_reconnects_after_transport_loss() {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind Presence fixture");
    let origin = format!(
        "http://{}",
        listener.local_addr().expect("Presence fixture address")
    );
    let server = tokio::spawn(async move {
        for lease_generation in 1_u64..=2 {
            let (stream, _) = listener.accept().await.expect("Presence connection");
            let mut socket =
                accept_hdr_async(stream, |_request: &Request, mut response: Response| {
                    response.headers_mut().insert(
                        "sec-websocket-protocol",
                        HeaderValue::from_static("punks.presence.v1"),
                    );
                    Ok(response)
                })
                .await
                .expect("Presence WebSocket handshake");
            let token_character = if lease_generation == 1 { 'A' } else { 'B' };
            let accepted = json!({
                "schemaVersion": 1,
                "type": "accepted",
                "leaseToken": format!("pls1.{}", token_character.to_string().repeat(43)),
                "leaseGeneration": lease_generation,
                "clientGeneration": 7,
                "heartbeatIntervalMs": 5000,
                "awayAfterMs": 10000,
                "expiresAfterMs": 15000,
                "presences": []
            });
            socket
                .send(Message::Text(accepted.to_string().into()))
                .await
                .expect("send Presence acceptance");
            if lease_generation == 1 {
                socket.close(None).await.expect("close first connection");
            } else {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
    });

    let client = PunksAccountClient::new(
        &origin,
        "0.6.0",
        ClientDistribution::Development,
        ClientPlatform::MacosArm64,
    )
    .expect("native Account client");
    let lease = WorkspaceLease {
        origin: origin.clone(),
        punk_id: PUNK_ID.to_owned(),
        workspace_id: WORKSPACE_ID.to_owned(),
        generation: 7,
    };
    let cancellation = CancellationToken::new();
    let operations = Arc::new(RwLock::new(()));
    {
        let mut state = client.inner.state.lock().await;
        state.compatibility = Some(DesktopCompatibility {
            contract: "desktop.compatibility-response@1".to_owned(),
            compatible: true,
            profile: "desktop-social-loop@1".to_owned(),
            registry_version: 1,
            minimum_client_version: "0.6.0".to_owned(),
            environment: "local".to_owned(),
            origin: origin.clone(),
            capabilities: vec!["presence".to_owned()],
        });
        state.active_lease = Some(lease.clone());
        state.active_cancellation = Some(cancellation.clone());
        state.active_operations = Some(Arc::clone(&operations));
    }
    let session = WorkspaceSession {
        inner: Arc::clone(&client.inner),
        lease,
        device_id: "00000000-0000-4000-8000-000000000004".to_owned(),
        cancellation,
        operations,
    };
    let connection = session.hold_presence().await.expect("Presence operation");

    let first = timeout(Duration::from_secs(2), connection.next_delivery())
        .await
        .expect("first Presence delivery")
        .expect("first Presence acceptance");
    assert!(matches!(
        first,
        PresenceDelivery::Accepted {
            lease_generation: 1,
            ..
        }
    ));
    let degraded = timeout(Duration::from_secs(2), connection.next_delivery())
        .await
        .expect("degraded Presence delivery")
        .expect("transport loss remains recoverable");
    assert!(matches!(
        degraded,
        PresenceDelivery::RealtimeDegraded { .. }
    ));
    let reconnected = timeout(Duration::from_secs(2), connection.next_delivery())
        .await
        .expect("reconnected Presence delivery")
        .expect("native Presence reconnection");
    assert!(matches!(
        reconnected,
        PresenceDelivery::Accepted {
            lease_generation: 2,
            ..
        }
    ));

    connection.close().await.expect("close Presence operation");
    server.await.expect("Presence fixture task");
}
