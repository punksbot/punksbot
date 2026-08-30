use nostr::EventId;
use tauri::State;

use crate::{
    app_state::AppState,
    events,
    relay::{submit_event, SubmitEventResponse},
};

fn lifecycle_target(channel_id: &str, event_id: &str) -> Result<(uuid::Uuid, EventId), String> {
    let channel_id = uuid::Uuid::parse_str(channel_id)
        .map_err(|_| "invalid message lifecycle channel UUID".to_string())?;
    let event_id = EventId::from_hex(event_id)
        .map_err(|_| "invalid message lifecycle event id".to_string())?;
    Ok((channel_id, event_id))
}

#[tauri::command]
pub async fn restore_message(
    channel_id: String,
    event_id: String,
    state: State<'_, AppState>,
) -> Result<SubmitEventResponse, String> {
    let (channel_id, event_id) = lifecycle_target(&channel_id, &event_id)?;
    submit_event(events::build_message_restore(channel_id, event_id)?, &state).await
}

#[tauri::command]
pub async fn erase_message(
    channel_id: String,
    event_id: String,
    state: State<'_, AppState>,
) -> Result<SubmitEventResponse, String> {
    let (channel_id, event_id) = lifecycle_target(&channel_id, &event_id)?;
    submit_event(events::build_message_erase(channel_id, event_id)?, &state).await
}
