use std::collections::{BTreeSet, HashSet};

use nostr::EventId;
use tauri::State;

use crate::{
    app_state::AppState,
    events,
    relay::{query_relay, submit_event},
};

#[tauri::command]
pub async fn get_message_markers(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let channel_id = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| "invalid marker channel UUID".to_string())?
        .to_string();
    let pubkey = state.signing_keys()?.public_key().to_hex();
    let events = query_relay(
        &state,
        &[
            serde_json::json!({"kinds": [40004], "#h": [&channel_id]}),
            serde_json::json!({
                "kinds": [40005],
                "#h": [&channel_id],
                "authors": [pubkey]
            }),
        ],
    )
    .await?;
    let mut resolved = HashSet::new();
    let mut pinned = BTreeSet::new();
    let mut bookmarked = BTreeSet::new();
    for event in events {
        let kind = event.kind.as_u16() as u32;
        let target = event.tags.iter().find_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("e"))
                .then(|| values.get(1).cloned())
                .flatten()
        });
        let Some(target) = target else {
            continue;
        };
        if !resolved.insert((kind, target.clone())) {
            continue;
        }
        match (kind, event.content.as_str()) {
            (40_004, "pinned") => {
                pinned.insert(target);
            }
            (40_005, "bookmarked") => {
                bookmarked.insert(target);
            }
            _ => {}
        }
    }
    Ok(serde_json::json!({
        "pinned": pinned,
        "bookmarked": bookmarked
    }))
}

#[tauri::command]
pub async fn set_message_pin(
    channel_id: String,
    event_id: String,
    pinned: bool,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let channel_id =
        uuid::Uuid::parse_str(&channel_id).map_err(|_| "invalid pin channel UUID".to_string())?;
    let event_id = EventId::from_hex(&event_id).map_err(|_| "invalid pin event id".to_string())?;
    let result = submit_event(
        events::build_message_pin(channel_id, event_id, pinned)?,
        &state,
    )
    .await?;
    Ok(serde_json::json!({"event_id": result.event_id, "pinned": pinned}))
}

#[tauri::command]
pub async fn set_message_bookmark(
    channel_id: String,
    event_id: String,
    bookmarked: bool,
    state: State<'_, AppState>,
) -> Result<serde_json::Value, String> {
    let channel_id = uuid::Uuid::parse_str(&channel_id)
        .map_err(|_| "invalid bookmark channel UUID".to_string())?;
    let event_id =
        EventId::from_hex(&event_id).map_err(|_| "invalid bookmark event id".to_string())?;
    let result = submit_event(
        events::build_message_bookmark(channel_id, event_id, bookmarked)?,
        &state,
    )
    .await?;
    Ok(serde_json::json!({
        "event_id": result.event_id,
        "bookmarked": bookmarked
    }))
}
