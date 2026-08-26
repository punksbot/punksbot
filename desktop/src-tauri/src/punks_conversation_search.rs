use punks_account_client::{ClientFailure, MessageSearchPage, WorkspaceLease};
use serde::Deserialize;

use super::PunksDesktopClient;

/// Exact body carried by the typed Conversation search IPC command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchMessagesInput {
    conversation_id: String,
    thread_root_message_id: Option<String>,
    query: String,
    limit: u8,
    cursor: Option<String>,
}

#[tauri::command]
/// Searches one authorized Conversation or Fil through the Rust semantic client.
pub async fn punks_search_messages(
    client: tauri::State<'_, PunksDesktopClient>,
    lease: WorkspaceLease,
    input: SearchMessagesInput,
) -> Result<MessageSearchPage, ClientFailure> {
    let _operation = client.transitions.read().await;
    client
        .session(&lease)
        .await?
        .search_messages(
            &input.conversation_id,
            input.thread_root_message_id.as_deref(),
            &input.query,
            input.limit,
            input.cursor.as_deref(),
        )
        .await
}
