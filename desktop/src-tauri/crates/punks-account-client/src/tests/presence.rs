use serde_json::json;

use super::super::{
    reduce_follow_frame, reduce_presence_frame, FollowEffect, FollowPhase, FollowServerFrame,
    FollowState, PresenceEffect, PresenceServerFrame, PresenceState,
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
