use std::collections::HashSet;

use crate::{
    validate_uuid, AuthoritativeStreamView, ClientFailure, MessageAuthor, MessagePage, MessageView,
    StreamSummary,
};

pub(crate) fn valid_rfc3339(value: &str) -> bool {
    chrono::DateTime::parse_from_rfc3339(value).is_ok()
}

fn valid_optional_rfc3339(value: Option<&String>) -> bool {
    value.is_none_or(|value| valid_rfc3339(value))
}

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
        && valid_optional_rfc3339(stream.ttl_deadline.as_ref())
        && stream.revision >= 1
        && stream.cursor >= 1
        && valid_rfc3339(&stream.updated_at);
    if !valid {
        return Err(ClientFailure::contract("conversation.list-response@1"));
    }
    Ok(())
}

pub(crate) fn validate_stream_view(
    stream: &AuthoritativeStreamView,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<(), ClientFailure> {
    validate_uuid(&stream.id, "conversationId")?;
    validate_uuid(&stream.workspace_id, "workspaceId")?;
    validate_uuid(&stream.owner_punk_id, "ownerPunkId")?;
    let mut member_ids = HashSet::with_capacity(stream.members.len());
    let mut owner_present = false;
    for member in &stream.members {
        validate_uuid(&member.punk_id, "member.punkId")?;
        if let Some(inviter) = member.invited_by_punk_id.as_deref() {
            validate_uuid(inviter, "member.invitedByPunkId")?;
        }
        if !member_ids.insert(member.punk_id.as_str())
            || !matches!(
                member.access.as_str(),
                "owner" | "manager" | "member" | "guest"
            )
            || !valid_rfc3339(&member.joined_at)
        {
            return Err(ClientFailure::contract("conversation.view@1"));
        }
        owner_present |= member.punk_id == stream.owner_punk_id && member.access == "owner";
    }
    let valid = stream.id == conversation_id
        && stream.workspace_id == workspace_id
        && stream.stream_type == "stream"
        && matches!(stream.visibility.as_str(), "open" | "private")
        && !stream.name.is_empty()
        && stream.name.chars().count() <= 255
        && stream
            .description
            .as_ref()
            .is_none_or(|value| value.chars().count() <= 4_000)
        && stream
            .topic
            .as_ref()
            .is_none_or(|value| value.chars().count() <= 255)
        && stream
            .purpose
            .as_ref()
            .is_none_or(|value| value.chars().count() <= 4_000)
        && stream
            .max_members
            .is_none_or(|value| (1..=100_000).contains(&value))
        && stream
            .ttl_seconds
            .is_none_or(|value| (1..=2_147_483_647).contains(&value))
        && valid_optional_rfc3339(stream.ttl_deadline.as_ref())
        && (1..=100_000).contains(&stream.members.len())
        && owner_present
        && matches!(
            stream.status.as_str(),
            "active" | "archived" | "deleting" | "deleted"
        )
        && stream.revision >= 1
        && stream.cursor >= 1
        && valid_rfc3339(&stream.created_at)
        && valid_rfc3339(&stream.updated_at)
        && valid_optional_rfc3339(stream.archived_at.as_ref());
    if !valid {
        return Err(ClientFailure::contract("conversation.view@1"));
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
        && valid_rfc3339(&message.created_at)
        && valid_rfc3339(&message.updated_at)
        && valid_optional_rfc3339(message.last_reply_at.as_ref())
        && valid_optional_rfc3339(message.edited_at.as_ref())
        && valid_optional_rfc3339(message.retracted_at.as_ref())
        && valid_optional_rfc3339(message.erase_after.as_ref())
        && valid_optional_rfc3339(message.erased_at.as_ref());
    if !valid {
        return Err(ClientFailure::contract("message.view@1"));
    }
    Ok(())
}
