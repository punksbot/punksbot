use punks_account_client::{ClientFailure, MessageMutationResponse, WorkspaceLease};
use serde::Deserialize;

use super::PunksDesktopClient;

/// Payload for editing an author-owned Message.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditMessageInput {
    conversation_id: String,
    message_id: String,
    content: String,
    topic: Option<String>,
}

#[tauri::command]
/// Edits one Message and returns its authoritative mutation acknowledgement.
pub async fn punks_edit_message(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: EditMessageInput,
) -> Result<MessageMutationResponse, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .edit_message(
            &input.conversation_id,
            &input.message_id,
            &input.content,
            input.topic.as_deref(),
        )
        .await
}

/// Payload for retracting an author-owned or moderated Message.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RetractMessageInput {
    conversation_id: String,
    message_id: String,
    reason_code: Option<String>,
    public_reason: Option<String>,
}

#[tauri::command]
/// Retracts one Message and returns its authoritative tombstone view.
pub async fn punks_retract_message(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: RetractMessageInput,
) -> Result<MessageMutationResponse, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .retract_message(
            &input.conversation_id,
            &input.message_id,
            input.reason_code.as_deref(),
            input.public_reason.as_deref(),
        )
        .await
}

/// Payload for restoring a Message inside its authoritative grace window.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RestoreMessageInput {
    conversation_id: String,
    message_id: String,
}

#[tauri::command]
/// Restores one Message and returns its authoritative active view.
pub async fn punks_restore_message(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: RestoreMessageInput,
) -> Result<MessageMutationResponse, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .restore_message(&input.conversation_id, &input.message_id)
        .await
}
