use std::time::SystemTime;

use super::models::{
    encode_time, enqueue_retired_revocation, invalid_state, StagedActivation, StoredAccountState,
    StoredStagedActivation,
};

/// Retires obsolete pending credentials without losing the active OAuth Session
/// or a prepared Session's revoke-only capability. All other state stays strict.
pub(super) fn decode_account_state(
    raw: &str,
    now: SystemTime,
) -> Result<(StoredAccountState, bool), String> {
    let mut value: serde_json::Value = serde_json::from_str(raw).map_err(|_| invalid_state())?;
    let root = value.as_object_mut().ok_or_else(invalid_state)?;
    let retired_flow = root.get("pendingAuthFlow").is_some_and(|flow| {
        flow["method"] == "passkey"
            || flow["intent"] == "register_passkey"
            || flow["purpose"] == "register_passkey"
    });
    let retired_grant = root.get("pendingReauthorization").is_some_and(|grant| {
        grant["targetMethod"] == "passkey" || grant["targetPurpose"] == "register_passkey"
    });
    let mut staged_revocation = None;
    if retired_flow {
        if let Some(staged) = root
            .get("stagedActivation")
            .filter(|value| !value.is_null())
        {
            let staged: StoredStagedActivation =
                serde_json::from_value(staged.clone()).map_err(|_| invalid_state())?;
            let decoded = StagedActivation::try_from(staged.clone())?;
            let flow = root.get("pendingAuthFlow").ok_or_else(invalid_state)?;
            if flow["flowId"] != decoded.flow_id || flow["phase"] != "delivering" {
                return Err(invalid_state());
            }
            staged_revocation = staged.queued_revocation(encode_time(now)?);
        }
        root.insert("pendingAuthFlow".into(), serde_json::Value::Null);
        root.insert("stagedActivation".into(), serde_json::Value::Null);
    }
    if retired_grant {
        root.insert("pendingReauthorization".into(), serde_json::Value::Null);
    }
    let mut state: StoredAccountState =
        serde_json::from_value(value).map_err(|_| invalid_state())?;
    state.validate()?;
    if let Some(revocation) = staged_revocation {
        enqueue_retired_revocation(&mut state, revocation, encode_time(now)?)?;
    }
    state.validate()?;
    Ok((state, retired_flow || retired_grant))
}
