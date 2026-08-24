//! Minimal native runtime for the Punks desktop distribution.
//!
//! Keep this graph intentionally small: Account/Workspace social commands,
//! native login deep links, updater/restart support, and no Buzz relay,
//! Nostr identity, agents, huddles, terminals, media proxy, or custom protocol.

use std::sync::Arc;

use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;

use crate::{punks_client, punks_session_store::KeyringSessionPersistence};

fn dispatch_session_deep_link(app: tauri::AppHandle, url: String) {
    if !url.starts_with("punks://session") {
        return;
    }
    tauri::async_runtime::spawn(async move {
        if let Err(error) = punks_client::handle_session_deeplink(app, &url).await {
            eprintln!("punks-desktop: session deep link rejected: {error}");
        }
    });
}

fn install_deep_link_handlers(app: &mut tauri::App) {
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            dispatch_session_deep_link(handle.clone(), url.to_string());
        }
    });

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                dispatch_session_deep_link(app.handle().clone(), url.to_string());
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
                dispatch_session_deep_link(app.clone(), argument);
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
            punks_client::punks_ceremony_start,
            punks_client::punks_ceremony_status,
            punks_client::punks_ceremony_cancel,
            punks_client::punks_session_renew,
            punks_client::punks_logout,
            punks_client::punks_check_compatibility,
            punks_client::punks_get_session,
            punks_client::punks_validate_navigation,
            punks_client::punks_list_workspaces,
            punks_client::punks_resolve_workspace,
            punks_client::punks_open_workspace,
            punks_client::punks_close_workspace,
            punks_client::punks_list_streams,
            punks_client::punks_get_stream,
            punks_client::punks_get_timeline,
            punks_client::punks_get_thread,
            punks_client::punks_resolve_authors,
            punks_client::punks_follow_conversation,
            punks_client::punks_follow_next,
            punks_client::punks_confirm_follow_batch,
            punks_client::punks_close_follow,
            punks_client::punks_post_message,
            punks_client::punks_message_lifecycle::punks_edit_message,
            punks_client::punks_message_lifecycle::punks_retract_message,
            punks_client::punks_message_lifecycle::punks_restore_message,
            punks_client::punks_add_reaction,
            punks_client::punks_remove_reaction,
        ])
        .build(tauri::generate_context!())
        .map_err(|error| format!("error while building Punks desktop: {error}"))?;

    app.run(|_, _| {});
    Ok(())
}
