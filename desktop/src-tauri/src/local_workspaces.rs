use serde::Serialize;
use tauri::Manager;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalWorkspaceInfo {
    id: String,
    name: String,
    owner_pubkey: String,
    archived: bool,
    relay_url: String,
    created_at: i64,
    updated_at: i64,
}

#[cfg(feature = "punks-local")]
fn to_info(
    record: crate::local_authority::workspace_hub::LocalWorkspaceRecord,
) -> LocalWorkspaceInfo {
    let port = std::env::var("PUNKS_LOCAL_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(18_787);
    let relay_url =
        if record.id == crate::local_authority::workspace_hub::LocalAuthorityHub::PRIMARY_ID {
            format!("ws://127.0.0.1:{port}")
        } else {
            format!("ws://{}.localhost:{port}", record.id)
        };
    LocalWorkspaceInfo {
        id: record.id,
        name: record.name,
        owner_pubkey: record.owner_pubkey,
        archived: record.archived,
        relay_url,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

#[tauri::command]
pub fn punks_local_list_workspaces(
    app: tauri::AppHandle,
) -> Result<Vec<LocalWorkspaceInfo>, String> {
    #[cfg(feature = "punks-local")]
    {
        app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>()
            .list_workspaces()
            .map(|records| records.into_iter().map(to_info).collect())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local Workspaces are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_create_workspace(
    name: String,
    app: tauri::AppHandle,
) -> Result<LocalWorkspaceInfo, String> {
    #[cfg(feature = "punks-local")]
    {
        let state = app.state::<crate::app_state::AppState>();
        let owner = state.signing_keys()?;
        app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>()
            .create_workspace(&name, &owner)
            .map(to_info)
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local Workspaces are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_rename_workspace(
    workspace_id: String,
    name: String,
    app: tauri::AppHandle,
) -> Result<LocalWorkspaceInfo, String> {
    #[cfg(feature = "punks-local")]
    {
        app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>()
            .rename_workspace(&workspace_id, &name)
            .map(to_info)
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local Workspaces are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_set_workspace_archived(
    workspace_id: String,
    archived: bool,
    app: tauri::AppHandle,
) -> Result<LocalWorkspaceInfo, String> {
    #[cfg(feature = "punks-local")]
    {
        app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>()
            .set_workspace_archived(&workspace_id, archived)
            .map(to_info)
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local Workspaces are unavailable in this distribution".to_string())
}
