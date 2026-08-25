use std::collections::HashSet;

use crate::{validate_uuid, ClientFailure, MessageAuthor, MessagePage, MessageView, StreamSummary};

pub(crate) fn validate_stream_summary(
    stream: &StreamSummary,
    workspace_id: &str,
) -> Result<(), ClientFailure> {
    validate_uuid(&stream.id, "conversationId")?;
    validate_uuid(&stream.workspace_id, "workspaceId")?;
    let valid = stream.workspace_id == workspace_id
        && stream.stream_type == "stream"
        && matches!(stream.visibility.as_str(), "open" | "private")
        && !stream.name.is_empty()
        && stream.name.chars().count() <= 120
        && stream
            .description
            .as_ref()
            .is_none_or(|value| value.chars().count() <= 2_000)
        && stream
            .topic
            .as_ref()
            .is_none_or(|value| value.chars().count() <= 160)
        && stream
            .purpose
            .as_ref()
            .is_none_or(|value| value.chars().count() <= 2_000)
        && stream.ttl_seconds.is_none_or(|value| value >= 60)
        && stream.revision >= 1
        && stream.cursor >= 1
        && !stream.updated_at.is_empty();
    if !valid {
        return Err(ClientFailure::contract("conversation.list-response@1"));
    }
    Ok(())
}

pub(crate) fn validate_message_page_runtime(
    page: &MessagePage,
    workspace_id: &str,
    conversation_id: &str,
    thread_root_message_id: Option<&str>,
) -> Result<(), ClientFailure> {
    if page.high_water_cursor < 1 || page.items.len() > 100 {
        return Err(ClientFailure::contract("message.history-response@1"));
    }
    let mut previous_created_cursor = 0;
    let mut message_ids = HashSet::with_capacity(page.items.len());
    for message in &page.items {
        validate_message_view_runtime(message, workspace_id, conversation_id)?;
        let valid = thread_root_message_id
            .is_none_or(|expected| message.thread_root_message_id == expected)
            && message.created_cursor > previous_created_cursor
            && message.created_cursor <= page.high_water_cursor
            && message_ids.insert(message.id.as_str());
        if !valid {
            return Err(ClientFailure::contract("message.history-response@1"));
        }
        previous_created_cursor = message.created_cursor;
    }
    Ok(())
}

pub(crate) fn validate_message_view_runtime(
    message: &MessageView,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<(), ClientFailure> {
    validate_uuid(&message.id, "messageId")?;
    validate_uuid(&message.workspace_id, "workspaceId")?;
    validate_uuid(&message.conversation_id, "conversationId")?;
    validate_uuid(&message.thread_root_message_id, "threadRootMessageId")?;
    if let Some(parent_message_id) = &message.parent_message_id {
        validate_uuid(parent_message_id, "parentMessageId")?;
    }
    match &message.author {
        MessageAuthor::Punk { punk_id } => validate_uuid(punk_id, "punkId")?,
        MessageAuthor::Bot { installation_id } => validate_uuid(installation_id, "installationId")?,
    }
    if message.mentioned_punk_ids.len() > 50 || message.media_ids.len() > 50 {
        return Err(ClientFailure::contract("message.view@1"));
    }
    let mut mentioned = HashSet::with_capacity(message.mentioned_punk_ids.len());
    for punk_id in &message.mentioned_punk_ids {
        validate_uuid(punk_id, "mentionedPunkId")?;
        if !mentioned.insert(punk_id) {
            return Err(ClientFailure::contract("message.view@1"));
        }
    }
    let mut media = HashSet::with_capacity(message.media_ids.len());
    for media_id in &message.media_ids {
        validate_uuid(media_id, "mediaId")?;
        if !media.insert(media_id) {
            return Err(ClientFailure::contract("message.view@1"));
        }
    }
    let topic_valid = message
        .topic
        .as_ref()
        .is_none_or(|topic| !topic.is_empty() && topic.chars().count() <= 255);
    let public_reason_valid = message
        .public_reason
        .as_ref()
        .is_none_or(|reason| !reason.is_empty() && reason.chars().count() <= 280);
    let status_valid = match message.status.as_str() {
        "active" => {
            message
                .content
                .as_ref()
                .is_some_and(|content| content.chars().count() <= 65_536)
                && message.current_version.is_some_and(|version| version >= 1)
                && message.retraction_kind.is_none()
                && message.retracted_at.is_none()
                && message.erase_after.is_none()
                && message.public_reason.is_none()
                && message.erased_at.is_none()
        }
        "retracted" => {
            message.content.is_none()
                && message.topic.is_none()
                && message.current_version.is_none()
                && message.media_ids.is_empty()
                && message
                    .retraction_kind
                    .as_deref()
                    .is_some_and(|kind| matches!(kind, "author" | "moderation"))
                && message.retracted_at.is_some()
                && message.erase_after.is_some()
                && message.erased_at.is_none()
        }
        "erased" => {
            message.content.is_none()
                && message.topic.is_none()
                && message.current_version.is_none()
                && message.media_ids.is_empty()
                && message
                    .retraction_kind
                    .as_deref()
                    .is_some_and(|kind| matches!(kind, "author" | "moderation"))
                && message.retracted_at.is_some()
                && message.erase_after.is_none()
                && message.public_reason.is_none()
                && message.erased_at.is_some()
        }
        _ => false,
    };
    let valid = message.workspace_id == workspace_id
        && message.conversation_id == conversation_id
        && message.message_type == "stream-message"
        && message.thread_depth <= 100
        && message.revision >= 1
        && message.created_cursor >= 1
        && message.cursor >= message.created_cursor
        && topic_valid
        && public_reason_valid
        && status_valid
        && !message.created_at.is_empty()
        && !message.updated_at.is_empty();
    if !valid {
        return Err(ClientFailure::contract("message.view@1"));
    }
    Ok(())
}
