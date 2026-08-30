use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
};

use tauri::{AppHandle, Manager};

use super::{http::authority_hub_router, workspace_hub::LocalAuthorityHub, DEFAULT_PORT};
use crate::app_state::AppState;

pub(crate) fn start(app: &AppHandle, app_state: &AppState) -> Result<(), String> {
    let port = std::env::var("PUNKS_LOCAL_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_PORT);
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let listener =
        std::net::TcpListener::bind(address).map_err(|error| format!("bind {address}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("configure {address}: {error}"))?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("resolve Punks data directory: {error}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|error| format!("create Punks data directory: {error}"))?;
    let owner = app_state.signing_keys()?;
    let hub = Arc::new(LocalAuthorityHub::open(&data_dir, owner)?);
    let authority = hub.primary();
    crate::local_accounts::bootstrap(app, app_state, &authority)?;
    let active_owner = app_state.signing_keys()?;
    let active_name = authority
        .list_accounts()?
        .into_iter()
        .find(|account| account.active)
        .map(|account| account.display_name)
        .unwrap_or_else(|| "Local Punk".to_string());
    hub.onboard_account(&active_owner, &active_name)?;
    if !app.manage(Arc::clone(&authority)) {
        return Err("local authority state was already initialized".to_string());
    }
    if !app.manage(Arc::clone(&hub)) {
        return Err("local Workspace hub was already initialized".to_string());
    }
    *app_state
        .relay_url_override
        .lock()
        .map_err(|error| format!("set Punks local authority URL: {error}"))? =
        Some(format!("ws://{address}"));

    spawn_scheduler(app.clone(), Arc::clone(&hub));
    let router = authority_hub_router(hub);
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::from_std(listener) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("punks-local: failed to adopt listener: {error}");
                return;
            }
        };
        eprintln!("punks-local: authoritative runtime listening on http://{address}");
        if let Err(error) = axum::serve(listener, router).await {
            eprintln!("punks-local: authority stopped: {error}");
        }
    });
    Ok(())
}

fn spawn_scheduler(app: AppHandle, hub: Arc<LocalAuthorityHub>) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = chrono::Utc::now().timestamp();
            let authorities = match hub.authorities() {
                Ok(authorities) => authorities,
                Err(error) => {
                    eprintln!("punks-workspaces: scheduler registry failed: {error}");
                    continue;
                }
            };
            for authority in authorities {
                if let Err(error) = authority.run_due_workflows(now) {
                    eprintln!("punks-workflows: durable scheduler tick failed: {error}");
                }
                if let Err(error) = authority.run_due_channel_ttl(now) {
                    eprintln!("punks-conversations: TTL scheduler tick failed: {error}");
                }
                let due = match authority.claim_due_reminders(now, 86_400, 60) {
                    Ok(due) => due,
                    Err(error) => {
                        eprintln!("punks-reminders: durable scheduler tick failed: {error}");
                        continue;
                    }
                };
                for reminder in due {
                    let posted = crate::commands::show_native_notification(
                        app.clone(),
                        "Reminder due".to_string(),
                        Some("A private Punks reminder is waiting.".to_string()),
                        None,
                    )
                    .await;
                    if let Err(error) = posted {
                        eprintln!("punks-reminders: native notification failed: {error}");
                        continue;
                    }
                    if let Err(error) = authority.ack_reminder_delivery(&reminder, now) {
                        eprintln!("punks-reminders: delivery acknowledgement failed: {error}");
                    }
                }
            }
        }
    });
}
