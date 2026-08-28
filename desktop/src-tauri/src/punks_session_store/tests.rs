use super::*;
use std::sync::{Arc, Mutex};
use std::time::{Duration, UNIX_EPOCH};

use punks_account_client::ceremony::{
    AuthenticationMethod, NativeVerifier, PendingAuthIntent, PendingAuthPhase, RevocationSecret,
};

#[derive(Default)]
struct MemoryCredentialStore(Mutex<(Option<String>, bool)>);

impl CredentialStore for MemoryCredentialStore {
    fn load(&self, _service: &str, _key: &str) -> Result<Option<String>, String> {
        Ok(self.0.lock().expect("memory store lock").0.clone())
    }
    fn store(&self, _service: &str, _key: &str, value: &str) -> Result<(), String> {
        let mut state = self.0.lock().expect("memory store lock");
        state.0 = Some(if std::mem::take(&mut state.1) {
            format!("{value}corrupt")
        } else {
            value.to_string()
        });
        Ok(())
    }
    fn delete(&self, _service: &str, _key: &str) -> Result<(), String> {
        self.0.lock().expect("memory store lock").0 = None;
        Ok(())
    }
}

fn store() -> (KeyringSessionPersistence, Arc<MemoryCredentialStore>) {
    let memory = Arc::new(MemoryCredentialStore::default());
    let credentials: Arc<dyn CredentialStore> = memory.clone();
    (
        KeyringSessionPersistence::with_store("punks-desktop-test", credentials),
        memory,
    )
}

fn at(seconds: u64) -> std::time::SystemTime {
    UNIX_EPOCH + Duration::from_secs(seconds)
}

fn metadata(session_id: &str) -> SessionMetadata {
    SessionMetadata {
        session_id: session_id.into(),
        punk_id: "44444444-4444-4444-8444-444444444444".into(),
        expires_at: at(4_000_000_000),
        last_renewed_at: None,
    }
}

fn cookie(marker: char) -> SessionSecret {
    SessionSecret::from_cookie_header(&format!(
        "__Host-punks_session={}",
        marker.to_string().repeat(64)
    ))
}

fn revoke(marker: char) -> RevocationSecret {
    RevocationSecret::from_token(&marker.to_string().repeat(64)).expect("capability")
}

fn active(session_id: &str, marker: char) -> ActiveAccountSession {
    ActiveAccountSession {
        cookie: cookie(marker),
        metadata: metadata(session_id),
        revoke_capability: Some(revoke(marker)),
        revoke_expires_at: Some(at(4_000_000_000)),
    }
}

fn flow() -> PendingAuthFlow {
    PendingAuthFlow {
        flow_id: "11111111-1111-4111-8111-111111111111".into(),
        verifier: NativeVerifier::decode(&"A".repeat(43)).expect("verifier"),
        intent: PendingAuthIntent::SignIn,
        method: AuthenticationMethod::Google,
        purpose: None,
        workspace_ownership_transfer: None,
        phase: PendingAuthPhase::Ready,
        phase_expires_at: at(3_999_999_000),
        absolute_expires_at: at(4_000_000_000),
    }
}

fn staged(session_id: &str, marker: char) -> StagedActivation {
    StagedActivation {
        activation_unconfirmed: true,
        cookie: cookie(marker),
        metadata: metadata(session_id),
        revoke_capability: revoke(marker),
        revoke_expires_at: at(4_000_000_000),
        flow_id: "11111111-1111-4111-8111-111111111111".into(),
        delivery_id: "55555555-5555-4555-8555-555555555555".into(),
        delivery_expires_at: at(3_999_999_500),
    }
}

#[test]
fn authentication_stage_preserves_old_session_until_atomic_promotion() {
    let (persistence, memory) = store();
    let old_id = "22222222-2222-4222-8222-222222222222";
    let new_id = "33333333-3333-4333-8333-333333333333";
    persistence
        .save_active_session(&active(old_id, 'r'))
        .unwrap();
    let flow = flow();
    persistence.save_pending_auth_flow(&flow).unwrap();
    let staged = staged(new_id, 's');
    persistence.stage_activation(&staged).unwrap();
    assert_eq!(persistence.load().unwrap().unwrap().1.session_id, old_id);
    let reread = persistence.reread_staged_activation().unwrap().unwrap();
    assert_eq!(reread.cookie.raw(), staged.cookie.raw());
    assert!(!format!("{reread:?}").contains(staged.cookie.raw()));
    assert_eq!(
        persistence
            .promote_staged_activation()
            .unwrap()
            .unwrap()
            .session_id,
        old_id
    );
    assert_eq!(persistence.load().unwrap().unwrap().1.session_id, new_id);
    assert!(persistence.load_pending_auth_flow().unwrap().is_none());
    assert!(persistence.reread_staged_activation().unwrap().is_none());
    assert!(memory
        .0
        .lock()
        .unwrap()
        .0
        .as_ref()
        .unwrap()
        .contains("\"version\":\"account-state-v1\""));
}

#[test]
fn retired_passkey_flow_does_not_discard_the_active_oauth_session() {
    let (persistence, memory) = store();
    let active_id = "22222222-2222-4222-8222-222222222222";
    persistence
        .save_active_session(&active(active_id, 'r'))
        .unwrap();
    persistence.save_pending_auth_flow(&flow()).unwrap();
    {
        let mut saved = memory.0.lock().unwrap();
        let mut value: serde_json::Value = serde_json::from_str(saved.0.as_ref().unwrap()).unwrap();
        value["pendingAuthFlow"]["method"] = serde_json::json!("passkey");
        saved.0 = Some(serde_json::to_string(&value).unwrap());
    }
    assert_eq!(persistence.load().unwrap().unwrap().1.session_id, active_id);
    assert!(persistence.load_pending_auth_flow().unwrap().is_none());
    assert!(!memory
        .0
        .lock()
        .unwrap()
        .0
        .as_ref()
        .unwrap()
        .contains("passkey"));
}

#[test]
fn retired_passkey_delivery_is_queued_for_revocation_without_replacing_oauth() {
    let (persistence, memory) = store();
    let active_id = "22222222-2222-4222-8222-222222222222";
    let prepared_id = "33333333-3333-4333-8333-333333333333";
    persistence
        .save_active_session(&active(active_id, 'r'))
        .unwrap();
    persistence.save_pending_auth_flow(&flow()).unwrap();
    persistence
        .stage_activation(&staged(prepared_id, 's'))
        .unwrap();
    {
        let mut saved = memory.0.lock().unwrap();
        let mut value: serde_json::Value = serde_json::from_str(saved.0.as_ref().unwrap()).unwrap();
        value["pendingAuthFlow"]["method"] = serde_json::json!("passkey");
        saved.0 = Some(serde_json::to_string(&value).unwrap());
    }
    assert_eq!(persistence.load().unwrap().unwrap().1.session_id, active_id);
    assert!(persistence.load_pending_auth_flow().unwrap().is_none());
    assert!(persistence.reread_staged_activation().unwrap().is_none());
    let queued = persistence.list_revocations().unwrap();
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].session_id, prepared_id);
    assert_eq!(queued[0].capability.raw(), revoke('s').raw());
}

#[test]
fn retired_passkey_delivery_preserves_a_full_revocation_queue() {
    let (persistence, memory) = store();
    let active_id = "22222222-2222-4222-8222-222222222222";
    let prepared_id = "33333333-3333-4333-8333-333333333333";
    persistence
        .save_active_session(&active(active_id, 'r'))
        .unwrap();
    for index in 0..64 {
        persistence
            .enqueue_revocation(&QueuedRevocation {
                session_id: format!("44444444-4444-4444-8444-{index:012}"),
                capability: revoke('q'),
                expires_at: at(4_000_000_000),
                queued_at: at(1_000_000_000),
            })
            .unwrap();
    }
    persistence.save_pending_auth_flow(&flow()).unwrap();
    persistence
        .stage_activation(&staged(prepared_id, 's'))
        .unwrap();
    {
        let mut saved = memory.0.lock().unwrap();
        let mut value: serde_json::Value = serde_json::from_str(saved.0.as_ref().unwrap()).unwrap();
        value["pendingAuthFlow"]["method"] = serde_json::json!("passkey");
        saved.0 = Some(serde_json::to_string(&value).unwrap());
    }
    assert_eq!(persistence.load().unwrap().unwrap().1.session_id, active_id);
    let queued = persistence.list_revocations().unwrap();
    assert_eq!(queued.len(), 65);
    assert_eq!(queued[64].session_id, prepared_id);
    assert_eq!(queued[64].capability.raw(), revoke('s').raw());
    assert!(persistence
        .enqueue_revocation(&QueuedRevocation {
            session_id: "55555555-5555-4555-8555-555555555555".into(),
            capability: revoke('q'),
            expires_at: at(4_000_000_000),
            queued_at: at(1_000_000_000),
        })
        .is_err());
    assert!(persistence.remove_revocation(prepared_id).unwrap());
    assert_eq!(persistence.list_revocations().unwrap().len(), 64);
}

#[test]
fn retired_passkey_reauthorization_does_not_remove_the_active_session() {
    let (persistence, memory) = store();
    let active_id = "22222222-2222-4222-8222-222222222222";
    persistence
        .save_active_session(&active(active_id, 'r'))
        .unwrap();
    persistence
        .save_reauthorization(&PendingReauthorization {
            authorization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
            session_id: active_id.into(),
            punk_id: metadata(active_id).punk_id,
            target_method: AuthenticationMethod::Google,
            target_purpose: PendingAuthPurpose::LinkGoogle,
            workspace_ownership_transfer: None,
            handoff_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd".into(),
            expires_at: at(4_000_000_000),
        })
        .unwrap();
    {
        let mut saved = memory.0.lock().unwrap();
        let mut value: serde_json::Value = serde_json::from_str(saved.0.as_ref().unwrap()).unwrap();
        value["pendingReauthorization"]["targetMethod"] = serde_json::json!("passkey");
        value["pendingReauthorization"]["targetPurpose"] = serde_json::json!("register_passkey");
        saved.0 = Some(serde_json::to_string(&value).unwrap());
    }
    assert_eq!(persistence.load().unwrap().unwrap().1.session_id, active_id);
    assert!(persistence.load_reauthorization().unwrap().is_none());
}

#[test]
fn renewal_is_exclusive_and_sign_out_atomically_queues_every_capability() {
    let (persistence, _) = store();
    let old_id = "22222222-2222-4222-8222-222222222222";
    let renewed_id = "66666666-6666-4666-8666-666666666666";
    persistence
        .save_active_session(&active(old_id, 'r'))
        .unwrap();
    let mut renewal = PendingRenewal {
        activation_unconfirmed: true,
        command_id: "77777777-7777-4777-8777-777777777777".into(),
        rotation_id: "88888888-8888-4888-8888-888888888888".into(),
        cookie: cookie('t'),
        metadata: metadata(renewed_id),
        revoke_capability: revoke('t'),
        revoke_expires_at: at(4_000_000_000),
        confirm_by: at(4_000_000_001),
    };
    assert!(persistence.stage_renewal(&renewal).is_err());
    renewal.confirm_by = at(3_999_999_500);
    persistence.stage_renewal(&renewal).unwrap();
    assert!(persistence.save_pending_auth_flow(&flow()).is_err());
    assert_eq!(
        persistence.reread_renewal().unwrap().unwrap().rotation_id,
        renewal.rotation_id
    );
    assert_eq!(
        persistence.promote_renewal().unwrap().unwrap().session_id,
        old_id
    );

    persistence.save_pending_auth_flow(&flow()).unwrap();
    persistence
        .stage_activation(&staged("99999999-9999-4999-8999-999999999999", 'u'))
        .unwrap();
    let moved = persistence.sign_out_local().unwrap();
    assert_eq!(moved.len(), 2);
    assert!(persistence.load().unwrap().is_none());
    assert!(persistence.load_pending_auth_flow().unwrap().is_none());
    assert!(persistence.reread_staged_activation().unwrap().is_none());
    assert_eq!(persistence.list_revocations().unwrap().len(), 3);
}

#[test]
fn queue_is_deduplicated_bounded_and_empty_state_deletes_the_credential() {
    let (persistence, memory) = store();
    let queued = |index: u64| QueuedRevocation {
        session_id: format!("00000000-0000-4000-8000-{index:012x}"),
        capability: revoke('q'),
        expires_at: at(4_000_000_000),
        queued_at: at(2_000_000_000 + index),
    };
    persistence.enqueue_revocation(&queued(0)).unwrap();
    persistence.enqueue_revocation(&queued(0)).unwrap();
    for index in 1..64 {
        persistence.enqueue_revocation(&queued(index)).unwrap();
    }
    assert_eq!(persistence.list_revocations().unwrap().len(), 64);
    assert!(persistence.enqueue_revocation(&queued(64)).is_err());
    for index in 0..64 {
        assert!(persistence
            .remove_revocation(&queued(index).session_id)
            .unwrap());
    }
    assert!(memory.0.lock().unwrap().0.is_none());
}

#[test]
fn legacy_trait_and_strict_readback_fail_closed_without_secret_errors() {
    let (persistence, memory) = store();
    persistence.save_pending_auth_flow(&flow()).unwrap();
    let metadata = metadata("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    let secret = cookie('c');
    persistence.persist(&secret, &metadata).unwrap();
    assert_eq!(persistence.load().unwrap().unwrap().0.raw(), secret.raw());
    persistence.destroy().unwrap();
    assert!(persistence.load_pending_auth_flow().unwrap().is_some());
    persistence.clear_pending_auth_flow().unwrap();
    assert!(memory.0.lock().unwrap().0.is_none());

    let sensitive = "secret-must-not-appear";
    memory.0.lock().unwrap().0 = Some(format!(
        "{{\"version\":\"wrong\",\"activeSession\":null,\"pendingAuthFlow\":null,\"stagedActivation\":null,\"pendingRenewal\":null,\"revocationQueue\":[],\"unknown\":\"{sensitive}\"}}"
    ));
    assert!(!persistence.load().unwrap_err().contains(sensitive));
    memory.0.lock().unwrap().0 = None;
    memory.0.lock().unwrap().1 = true;
    let flow = flow();
    assert!(!persistence
        .save_pending_auth_flow(&flow)
        .unwrap_err()
        .contains(&flow.verifier.encoded()));
    assert_eq!(
        CompiledPunksEnvironment::from_build_value(Some("staging"))
            .map(CompiledPunksEnvironment::keyring_service),
        Ok("punks-desktop-staging")
    );
    assert!(CompiledPunksEnvironment::from_build_value(Some("qa")).is_err());
}

#[test]
fn reauthorization_survives_restart_and_is_consumed_only_by_its_exact_target() {
    let (persistence, memory) = store();
    let session_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    persistence
        .save_active_session(&active(session_id, 'v'))
        .unwrap();
    let handoff = PendingReauthorization {
        authorization_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc".into(),
        session_id: session_id.into(),
        punk_id: "44444444-4444-4444-8444-444444444444".into(),
        target_method: AuthenticationMethod::Google,
        target_purpose: PendingAuthPurpose::LinkGoogle,
        workspace_ownership_transfer: None,
        handoff_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd".into(),
        expires_at: at(4_000_000_000),
    };
    persistence.save_reauthorization(&handoff).unwrap();

    let credentials: Arc<dyn CredentialStore> = memory.clone();
    let restarted = KeyringSessionPersistence::with_store("punks-desktop-test", credentials);
    assert_eq!(
        restarted
            .load_reauthorization()
            .unwrap()
            .unwrap()
            .handoff_id,
        handoff.handoff_id
    );
    assert!(restarted
        .take_reauthorization(PendingAuthPurpose::LinkGithub)
        .unwrap()
        .is_none());
    assert!(restarted.load_reauthorization().unwrap().is_some());
    assert_eq!(
        restarted
            .take_reauthorization(PendingAuthPurpose::LinkGoogle)
            .unwrap()
            .unwrap()
            .authorization_id,
        handoff.authorization_id
    );
    assert!(restarted.load_reauthorization().unwrap().is_none());

    restarted.save_reauthorization(&handoff).unwrap();
    assert!(restarted
        .take_reauthorization_at(PendingAuthPurpose::LinkGoogle, at(4_000_000_001))
        .unwrap()
        .is_none());
    assert!(restarted.load_reauthorization().unwrap().is_none());
    restarted.save_reauthorization(&handoff).unwrap();
    restarted.sign_out_local().unwrap();
    assert!(restarted.load_reauthorization().unwrap().is_none());
}

#[test]
fn ownership_reauthorization_is_not_consumed_as_an_identity_link() {
    let (persistence, _) = store();
    persistence
        .save_active_session(&active("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 'w'))
        .unwrap();
    let handoff = PendingReauthorization {
        authorization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".into(),
        session_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb".into(),
        punk_id: "44444444-4444-4444-8444-444444444444".into(),
        target_method: AuthenticationMethod::Github,
        target_purpose: PendingAuthPurpose::TransferWorkspaceOwnership,
        workspace_ownership_transfer: Some(
            punks_account_client::desktop_auth::WorkspaceOwnershipTransferBinding {
                workspace_id: "11111111-1111-4111-8111-111111111111".into(),
                target_punk_id: "22222222-2222-4222-8222-222222222222".into(),
                expected_revision: 9,
            },
        ),
        handoff_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd".into(),
        expires_at: at(4_000_000_000),
    };
    persistence.save_reauthorization(&handoff).unwrap();

    assert!(persistence
        .take_reauthorization(PendingAuthPurpose::LinkGoogle)
        .unwrap()
        .is_none());
    let binding = handoff.workspace_ownership_transfer.as_ref().unwrap();
    assert!(persistence
        .take_workspace_ownership_reauthorization(
            &punks_account_client::desktop_auth::WorkspaceOwnershipTransferBinding {
                target_punk_id: "33333333-3333-4333-8333-333333333333".into(),
                ..binding.clone()
            },
        )
        .unwrap()
        .is_none());
    assert!(persistence
        .take_workspace_ownership_reauthorization(
            &punks_account_client::desktop_auth::WorkspaceOwnershipTransferBinding {
                workspace_id: "33333333-3333-4333-8333-333333333333".into(),
                ..binding.clone()
            },
        )
        .unwrap()
        .is_none());
    assert!(persistence
        .take_workspace_ownership_reauthorization(
            &punks_account_client::desktop_auth::WorkspaceOwnershipTransferBinding {
                expected_revision: 10,
                ..binding.clone()
            },
        )
        .unwrap()
        .is_none());
    assert_eq!(
        persistence
            .take_workspace_ownership_reauthorization(binding)
            .unwrap()
            .unwrap()
            .authorization_id,
        handoff.authorization_id,
    );
}
