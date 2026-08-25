//! Minimal native runtime for the Punks desktop distribution.
//!
//! Keep this graph intentionally small: Account/Workspace social commands,
//! native login deep links, updater/restart support, and no Buzz relay,
//! Nostr identity, agents, huddles, terminals, media proxy, or custom protocol.

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{punks_auth, punks_client, punks_session_store::KeyringSessionPersistence};
use punks_account_client::ceremony::CompiledPunksEnvironment;

fn expected_auth_scheme() -> Option<&'static str> {
    CompiledPunksEnvironment::current()
        .ok()
        .map(CompiledPunksEnvironment::deep_link_scheme)
}

fn parse_auth_completion_url(raw: &str, expected_scheme: &str) -> Result<String, String> {
    let parsed =
        tauri::Url::parse(raw).map_err(|_| "invalid authentication completion".to_string())?;
    if parsed.scheme() != expected_scheme
        || parsed.host_str() != Some("auth")
        || parsed.path() != "/complete"
        || parsed.fragment().is_some()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
    {
        return Err("authentication completion does not match this distribution".to_string());
    }
    let pairs = parsed.query_pairs().collect::<Vec<_>>();
    if pairs.len() != 1 || pairs[0].0 != "flow" {
        return Err("authentication completion must carry only its flow".to_string());
    }
    let flow_id = pairs[0].1.as_ref();
    let parsed_flow = uuid::Uuid::parse_str(flow_id)
        .map_err(|_| "authentication flow id is invalid".to_string())?;
    if parsed_flow.to_string() != flow_id {
        return Err("authentication flow id is not canonical".to_string());
    }
    Ok(flow_id.to_string())
}

fn dispatch_auth_completion_deep_link(app: tauri::AppHandle, url: String) {
    let Some(expected_scheme) = expected_auth_scheme() else {
        return;
    };
    let Ok(flow_id) = parse_auth_completion_url(&url, expected_scheme) else {
        return;
    };
    tauri::async_runtime::spawn(async move {
        if let Err(error) = punks_auth::handle_auth_completion(app, &flow_id).await {
            eprintln!("punks-desktop: authentication completion rejected: {error}");
        }
    });
}

fn install_deep_link_handlers(app: &mut tauri::App) {
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            dispatch_auth_completion_deep_link(handle.clone(), url.to_string());
        }
    });

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                dispatch_auth_completion_deep_link(app.handle().clone(), url.to_string());
            }
        }
        Ok(None) => {}
        Err(error) => eprintln!("punks-desktop: failed to read launch deep link: {error}"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() -> Result<(), String> {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            for argument in argv {
                dispatch_auth_completion_deep_link(app.clone(), argument);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(KeyringSessionPersistence::new()))
        .setup(|app| {
            // The single-instance plugin has acquired process ownership before
            // setup runs, so first-launch installation identity creation cannot
            // race another Punks desktop process.
            if !app.manage(punks_client::PunksDesktopClient::from_distribution()) {
                return Err(std::io::Error::other(
                    "Punks desktop client state was already initialized",
                )
                .into());
            }
            install_deep_link_handlers(app);
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
                window.set_focus()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            punks_auth::punks_get_account_session_state,
            punks_auth::punks_start_sign_in,
            punks_auth::punks_start_account_switch,
            punks_auth::punks_start_reauthentication,
            punks_auth::punks_start_identity_link,
            punks_auth::punks_start_passkey_registration,
            punks_auth::punks_resume_interrupted_authentication,
            punks_auth::punks_cancel_authentication,
            punks_auth::punks_renew_account_session,
            punks_auth::punks_sign_out,
            punks_client::punks_check_compatibility,
            punks_client::punks_validate_navigation,
            punks_client::punks_list_workspaces,
            punks_client::punks_get_punk_profile,
            punks_client::punks_update_punk_profile,
            punks_client::punks_resolve_workspace,
            punks_client::punks_open_workspace,
            punks_client::punks_close_workspace,
            punks_client::punks_list_streams,
            punks_client::punks_get_stream,
            punks_client::punks_get_timeline,
            punks_client::punks_get_thread,
            punks_client::punks_resolve_authors,
            punks_client::punks_get_punk_summaries,
            punks_client::punks_search_punks,
            punks_client::punks_follow_conversation,
            punks_client::punks_follow_next,
            punks_client::punks_confirm_follow_batch,
            punks_client::punks_close_follow,
            punks_client::punks_post_message,
            punks_client::punks_message_lifecycle::punks_edit_message,
            punks_client::punks_message_lifecycle::punks_retract_message,
            punks_client::punks_message_lifecycle::punks_restore_message,
            punks_client::punks_identity_governance::punks_create_workspace_invitation,
            punks_client::punks_identity_governance::punks_get_workspace_invitation,
            punks_client::punks_identity_governance::punks_claim_workspace_invitation,
            punks_client::punks_identity_governance::punks_revoke_workspace_invitation,
            punks_client::punks_identity_governance::punks_get_workspace_governance,
            punks_client::punks_identity_governance::punks_set_workspace_member_role,
            punks_client::punks_identity_governance::punks_remove_workspace_member,
            punks_client::punks_add_reaction,
            punks_client::punks_remove_reaction,
        ])
        .build(tauri::generate_context!())
        .map_err(|error| format!("error while building Punks desktop: {error}"))?;

    app.run(|_, _| {});
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FLOW_ID: &str = "d9428888-122b-4d9b-8f03-1a1127e667b8";

    #[test]
    fn completion_deep_link_is_bound_to_the_compiled_environment() {
        assert_eq!(
            parse_auth_completion_url(
                &format!("punks-staging://auth/complete?flow={FLOW_ID}"),
                "punks-staging",
            )
            .expect("staging completion"),
            FLOW_ID
        );
        assert!(parse_auth_completion_url(
            &format!("punks://auth/complete?flow={FLOW_ID}"),
            "punks-staging",
        )
        .is_err());
        assert!(parse_auth_completion_url(
            &format!("punks-staging://session?flow={FLOW_ID}"),
            "punks-staging",
        )
        .is_err());
    }

    #[test]
    fn completion_deep_link_carries_only_one_canonical_flow_id() {
        assert!(parse_auth_completion_url(
            &format!("punks-local://auth/complete?flow={FLOW_ID}&cookie=secret"),
            "punks-local",
        )
        .is_err());
        assert!(parse_auth_completion_url(
            "punks-local://auth/complete?flow=not-a-uuid",
            "punks-local",
        )
        .is_err());
        assert!(parse_auth_completion_url(
            &format!("punks-local://auth/complete?flow={FLOW_ID}#fragment"),
            "punks-local",
        )
        .is_err());
    }
}
