use std::sync::{Arc, Mutex as StdMutex};

use serde_json::{json, Value};

use crate::{WorkspaceInvitationRole, WorkspaceRole};

use super::{
    client_with, compatibility, prepare_account, session, workspaces, ClientFailure, FailureKind,
    PUNK_ID, WORKSPACE_ID,
};

fn governance_compatibility() -> Value {
    let mut value = compatibility();
    value["capabilities"]
        .as_array_mut()
        .unwrap()
        .push(Value::String("identity-governance".to_owned()));
    value
}

fn invitation(code: &str) -> Value {
    json!({
        "contract": "workspace.invitation@1",
        "invitationId": "77777777-7777-4777-8777-777777777777",
        "workspace": {
            "id": WORKSPACE_ID,
            "slug": "alpha",
            "name": "Alpha"
        },
        "workspaceRevision": 1,
        "role": "member",
        "status": "issued",
        "issuedAt": "2026-08-26T00:00:00.000Z",
        "expiresAt": "2026-09-02T00:00:00.000Z",
        "revokedAt": null,
        "maxUses": 1,
        "uses": 0,
        "usesRemaining": 1,
        "_testCode": code
    })
}

#[tokio::test]
async fn native_invitation_roundtrip_keeps_commands_explicit_and_closed() {
    let code = format!("{WORKSPACE_ID}.{}", "A".repeat(43));
    let handler_code = code.clone();
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |method, path, body, idempotency_key| {
        captured.lock().unwrap().push((
            method.clone(),
            path.clone(),
            body.clone(),
            idempotency_key,
        ));
        let code = handler_code.clone();
        Box::pin(async move {
            Ok(match (method.as_str(), path.as_str()) {
                ("POST", "/api/v1/desktop/compatibility") => governance_compatibility(),
                ("GET", "/api/auth/v1/session") => session(),
                ("GET", path) if path.starts_with("/api/v1/workspaces?") => workspaces(),
                ("POST", path) if path.ends_with("/invitations") => {
                    let mut view = invitation(&code);
                    view.as_object_mut().unwrap().remove("_testCode");
                    json!({
                        "contract": "workspace.invite-response@1",
                        "invitation": view,
                        "code": code,
                        "replayed": false
                    })
                }
                ("GET", path) if path.contains("/workspace-invitations/") => {
                    let mut view = invitation(&code);
                    view.as_object_mut().unwrap().remove("_testCode");
                    view
                }
                ("POST", path) if path.ends_with("/claim") => json!({
                    "contract": "workspace.invite-claim-response@1",
                    "result": "joined",
                    "workspace": {
                        "id": WORKSPACE_ID,
                        "slug": "alpha",
                        "name": "Alpha",
                        "visibility": "private",
                        "role": "member",
                        "revision": 2
                    },
                    "replayed": false
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let created = workspace
        .create_invitation(WorkspaceInvitationRole::Member, 1, None, None)
        .await
        .unwrap();
    assert_eq!(created.code, code);
    assert_eq!(created.invitation.uses_remaining, 1);

    let consulted = client.get_workspace_invitation(&code).await.unwrap();
    assert_eq!(consulted.invitation_id, created.invitation.invitation_id);
    let claimed = client.claim_workspace_invitation(&code, 1).await.unwrap();
    assert_eq!(claimed.result, "joined");
    assert_eq!(claimed.workspace.revision, 2);

    let calls = observed.lock().unwrap();
    for (_, _, body, idempotency_key) in calls
        .iter()
        .filter(|(method, _, _, _)| method == "POST")
        .filter(|(_, path, _, _)| path.ends_with("/invitations") || path.ends_with("/claim"))
    {
        let body = body.as_ref().unwrap();
        assert_eq!(idempotency_key.as_deref(), body["commandId"].as_str());
    }
    let create_body = calls
        .iter()
        .find(|(_, path, _, _)| path.ends_with("/invitations"))
        .and_then(|(_, _, body, _)| body.as_ref())
        .unwrap();
    assert_eq!(create_body["payload"]["role"], "member");
    assert_eq!(create_body["payload"]["expectedRevision"], 1);
    assert_eq!(create_body["actor"]["punkId"], PUNK_ID);
}

#[tokio::test]
async fn native_governance_reads_and_mutations_preserve_revision_intent() {
    let invitation_id = "77777777-7777-4777-8777-777777777777";
    let observed = Arc::new(StdMutex::new(Vec::new()));
    let captured = Arc::clone(&observed);
    let client = client_with(move |method, path, body, idempotency_key| {
        captured.lock().unwrap().push((
            method.clone(),
            path.clone(),
            body.clone(),
            idempotency_key,
        ));
        Box::pin(async move {
            let workspace = json!({
                "id": WORKSPACE_ID,
                "slug": "alpha",
                "name": "Alpha",
                "visibility": "private",
                "status": "active",
                "ownerPunkId": PUNK_ID,
                "members": [
                    { "punkId": PUNK_ID, "role": "owner" },
                    {
                        "punkId": "33333333-3333-4333-8333-333333333333",
                        "role": if method == "PUT" { "moderator" } else { "member" }
                    }
                ],
                "revision": if method == "PUT" { 2 } else { 1 },
                "cursor": if method == "PUT" { 2 } else { 1 },
                "createdAt": "2026-08-26T00:00:00.000Z",
                "updatedAt": "2026-08-26T00:00:00.000Z"
            });
            Ok(match (method.as_str(), path.as_str()) {
                ("POST", "/api/v1/desktop/compatibility") => governance_compatibility(),
                ("GET", "/api/auth/v1/session") => session(),
                ("GET", path) if path.starts_with("/api/v1/workspaces?") => workspaces(),
                ("GET", path) if path.ends_with("/governance") => workspace,
                ("PUT", path) if path.contains("/members/") => json!({
                    "contract": "workspace.membership-mutation-response@1",
                    "workspace": workspace,
                    "replayed": false
                }),
                ("DELETE", path) if path.contains("/members/") => json!({
                    "contract": "workspace.membership-mutation-response@1",
                    "workspace": {
                        "id": WORKSPACE_ID,
                        "slug": "alpha",
                        "name": "Alpha",
                        "visibility": "private",
                        "status": "active",
                        "ownerPunkId": PUNK_ID,
                        "members": [{ "punkId": PUNK_ID, "role": "owner" }],
                        "revision": 3,
                        "cursor": 3,
                        "createdAt": "2026-08-26T00:00:00.000Z",
                        "updatedAt": "2026-08-26T00:02:00.000Z"
                    },
                    "replayed": false
                }),
                ("DELETE", path) if path.contains("/invitations/") => json!({
                    "contract": "workspace.invite-revoke-response@1",
                    "invitation": {
                        "contract": "workspace.invitation@1",
                        "invitationId": invitation_id,
                        "workspace": { "id": WORKSPACE_ID, "slug": "alpha", "name": "Alpha" },
                        "workspaceRevision": 2,
                        "role": "member",
                        "status": "revoked",
                        "issuedAt": "2026-08-26T00:00:00.000Z",
                        "expiresAt": "2026-09-02T00:00:00.000Z",
                        "revokedAt": "2026-08-26T00:01:00.000Z",
                        "maxUses": 1,
                        "uses": 0,
                        "usesRemaining": 1
                    },
                    "replayed": false
                }),
                _ => return Err(ClientFailure::new(FailureKind::Problem, "unexpected")),
            })
        })
    });
    prepare_account(&client).await;
    let workspace = client.open_workspace(WORKSPACE_ID).await.unwrap();

    let governance = workspace.get_governance().await.unwrap();
    assert_eq!(governance.members.len(), 2);
    assert_eq!(governance.revision, 1);
    let changed = workspace
        .set_member_role(
            "33333333-3333-4333-8333-333333333333",
            WorkspaceRole::Moderator,
            1,
        )
        .await
        .unwrap();
    assert_eq!(changed.workspace.revision, 2);
    let removed = workspace
        .remove_member("33333333-3333-4333-8333-333333333333", 2)
        .await
        .unwrap();
    assert_eq!(removed.workspace.revision, 3);
    assert_eq!(removed.workspace.members.len(), 1);
    let revoked = workspace.revoke_invitation(invitation_id, 3).await.unwrap();
    assert_eq!(revoked.invitation.status, "revoked");

    let calls = observed.lock().unwrap();
    let role_body = calls
        .iter()
        .find(|(method, path, _, _)| method == "PUT" && path.contains("/members/"))
        .and_then(|(_, _, body, _)| body.as_ref())
        .unwrap();
    assert_eq!(role_body["payload"]["expectedRevision"], 1);
    assert_eq!(role_body["payload"]["role"], "moderator");
    let revoke_body = calls
        .iter()
        .find(|(method, path, _, _)| method == "DELETE" && path.contains("/invitations/"))
        .and_then(|(_, _, body, _)| body.as_ref())
        .unwrap();
    assert_eq!(revoke_body["payload"]["expectedRevision"], 3);
}
