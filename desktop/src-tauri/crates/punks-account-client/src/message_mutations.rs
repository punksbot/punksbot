use reqwest::Method;
use serde_json::json;
use unicode_normalization::UnicodeNormalization;

use super::{
    social_validation::{valid_rfc3339, validate_message_view_runtime},
    transport::{decode, RequestSafety},
    validation::validate_uuid,
    ClientFailure, FailureKind, MessageAuthor, MessageMutationResponse, MessageView,
    ReactionMutationResult, ReactionView, WorkspaceSession,
};

#[derive(Clone, Copy)]
enum MessageLifecycleOperation {
    Retract,
    Restore,
}

#[derive(Clone, Copy)]
enum ReactionOperation {
    Add,
    Remove,
}

#[derive(Clone, Copy)]
struct ExpectedReactionCoordinate<'a> {
    workspace_id: &'a str,
    punk_id: &'a str,
    conversation_id: &'a str,
    message_id: &'a str,
    reaction: &'a str,
}

/// Authorized parent coordinates captured by the renderer before a reply.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageReplyTarget {
    /// Exact Message that will become the new reply's parent.
    pub message_id: String,
    /// Authoritative root of the parent's Fil de discussion.
    pub thread_root_message_id: String,
    /// Authoritative depth of the parent Message.
    pub thread_depth: u64,
}

impl ReactionOperation {
    fn contract(self) -> &'static str {
        match self {
            Self::Add => "message.reaction-add@1",
            Self::Remove => "message.reaction-remove@1",
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::Add => "add",
            Self::Remove => "remove",
        }
    }
}

impl MessageLifecycleOperation {
    fn contract(self) -> &'static str {
        match self {
            Self::Retract => "message.retract@1",
            Self::Restore => "message.restore@1",
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::Retract => "retract",
            Self::Restore => "restore",
        }
    }
}

impl WorkspaceSession {
    /// Publishes one explicit text intent exactly once.
    pub async fn post_text(
        &self,
        conversation_id: &str,
        content: &str,
        topic: Option<&str>,
        reply_target: Option<&MessageReplyTarget>,
    ) -> Result<MessageView, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        if let Some(reply_target) = reply_target {
            validate_uuid(&reply_target.message_id, "replyTarget.messageId")?;
            validate_uuid(
                &reply_target.thread_root_message_id,
                "replyTarget.threadRootMessageId",
            )?;
            if reply_target.thread_depth >= 100 {
                return Err(ClientFailure::new(
                    FailureKind::ContractViolation,
                    "Reply target exceeds the Message thread depth limit",
                ));
            }
        }
        if content.is_empty() {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "Message content must not be empty",
            ));
        }
        self.require_capability("message-post").await?;
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let reply_to_message_id = reply_target.map(|target| target.message_id.as_str());
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "message.post@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "conversationId": conversation_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {
                        "content": content,
                        "replyToMessageId": reply_to_message_id,
                        "broadcast": false,
                        "topic": topic,
                        "mentionedPunkIds": [],
                        "mediaIds": []
                    }
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let acknowledgement: MessageMutationResponse = decode("message.post-response@1", response)?;
        self.assert_current().await?;
        validate_post_acknowledgement(
            &acknowledgement.message,
            &self.lease.workspace_id,
            &self.lease.punk_id,
            conversation_id,
            reply_target,
        )?;
        Ok(acknowledgement.message)
    }

    /// Edits one author-owned Message with a fresh command identity.
    pub async fn edit_message(
        &self,
        conversation_id: &str,
        message_id: &str,
        content: &str,
        topic: Option<&str>,
    ) -> Result<MessageMutationResponse, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        validate_uuid(message_id, "messageId")?;
        if content.is_empty() {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "Message content must not be empty",
            ));
        }
        self.require_capability("message-lifecycle").await?;
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::PATCH,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages/{message_id}",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "message.edit@1",
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "conversationId": conversation_id,
                    "messageId": message_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": {
                        "content": content,
                        "topic": topic,
                        "mentionedPunkIds": [],
                        "mediaIds": []
                    }
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let acknowledgement: MessageMutationResponse =
            decode("message.mutation-response@1", response)?;
        self.assert_current().await?;
        validate_mutation_scope(
            &acknowledgement.message,
            &self.lease.workspace_id,
            conversation_id,
            message_id,
        )?;
        Ok(acknowledgement)
    }

    /// Retracts one Message under the author/moderator policy.
    pub async fn retract_message(
        &self,
        conversation_id: &str,
        message_id: &str,
        reason_code: Option<&str>,
        public_reason: Option<&str>,
    ) -> Result<MessageMutationResponse, ClientFailure> {
        self.mutate_message_state(
            MessageLifecycleOperation::Retract,
            conversation_id,
            message_id,
            json!({
                "reasonCode": reason_code,
                "publicReason": public_reason
            }),
        )
        .await
    }

    /// Restores one Message only while its authoritative grace window allows it.
    pub async fn restore_message(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<MessageMutationResponse, ClientFailure> {
        self.mutate_message_state(
            MessageLifecycleOperation::Restore,
            conversation_id,
            message_id,
            json!({}),
        )
        .await
    }

    async fn mutate_message_state(
        &self,
        operation: MessageLifecycleOperation,
        conversation_id: &str,
        message_id: &str,
        payload: serde_json::Value,
    ) -> Result<MessageMutationResponse, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        validate_uuid(message_id, "messageId")?;
        let contract = operation.contract();
        self.require_capability("message-lifecycle").await?;
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages/{message_id}/{}",
                    self.lease.workspace_id,
                    operation.path()
                ),
                Some(json!({
                    "contract": contract,
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "conversationId": conversation_id,
                    "messageId": message_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": payload
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let acknowledgement: MessageMutationResponse =
            decode("message.mutation-response@1", response)?;
        self.assert_current().await?;
        validate_mutation_scope(
            &acknowledgement.message,
            &self.lease.workspace_id,
            conversation_id,
            message_id,
        )?;
        Ok(acknowledgement)
    }

    /// Adds one canonical Unicode Reaction exactly once.
    pub async fn add_reaction(
        &self,
        conversation_id: &str,
        message_id: &str,
        reaction: &str,
    ) -> Result<ReactionMutationResult, ClientFailure> {
        self.mutate_reaction(
            ReactionOperation::Add,
            conversation_id,
            message_id,
            reaction,
        )
        .await
    }

    /// Removes one canonical Unicode Reaction exactly once.
    pub async fn remove_reaction(
        &self,
        conversation_id: &str,
        message_id: &str,
        reaction: &str,
    ) -> Result<ReactionMutationResult, ClientFailure> {
        self.mutate_reaction(
            ReactionOperation::Remove,
            conversation_id,
            message_id,
            reaction,
        )
        .await
    }

    async fn mutate_reaction(
        &self,
        operation: ReactionOperation,
        conversation_id: &str,
        message_id: &str,
        reaction: &str,
    ) -> Result<ReactionMutationResult, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        validate_uuid(message_id, "messageId")?;
        let canonical = canonical_reaction(reaction)?;
        self.require_capability("unicode-reactions").await?;
        self.assert_current().await?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let contract = operation.contract();
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages/{message_id}/reactions/{}",
                    self.lease.workspace_id,
                    operation.path(),
                ),
                Some(json!({
                    "contract": contract,
                    "commandId": command_id,
                    "workspaceId": self.lease.workspace_id,
                    "conversationId": conversation_id,
                    "messageId": message_id,
                    "actor": { "kind": "punk", "punkId": self.lease.punk_id },
                    "payload": { "reaction": canonical }
                })),
                RequestSafety::Mutation,
            )
            .await?;
        self.assert_current().await?;
        let acknowledgement: ReactionMutationResult =
            decode("message.reaction-mutation-response@1", response)?;
        self.assert_current().await?;
        validate_reaction_acknowledgement(
            operation,
            &acknowledgement,
            ExpectedReactionCoordinate {
                workspace_id: &self.lease.workspace_id,
                punk_id: &self.lease.punk_id,
                conversation_id,
                message_id,
                reaction: &canonical,
            },
        )?;
        Ok(acknowledgement)
    }

    pub(crate) async fn require_capability(&self, capability: &str) -> Result<(), ClientFailure> {
        let state = self.inner.state.lock().await;
        let available = state.compatibility.as_ref().is_some_and(|value| {
            value.compatible
                && value
                    .capabilities
                    .iter()
                    .any(|candidate| candidate == capability)
        });
        if available {
            Ok(())
        } else {
            Err(ClientFailure::new(
                FailureKind::ContractViolation,
                format!("Punks capability {capability} is not available"),
            ))
        }
    }

    pub(crate) async fn assert_current(&self) -> Result<(), ClientFailure> {
        if self.inner.state.lock().await.active_lease.as_ref() == Some(&self.lease) {
            Ok(())
        } else {
            Err(ClientFailure::stale_workspace())
        }
    }
}

pub(crate) fn canonical_reaction(reaction: &str) -> Result<String, ClientFailure> {
    if reaction
        .chars()
        .any(|character| matches!(character, '\r' | '\n' | '\u{2028}' | '\u{2029}'))
    {
        return Err(ClientFailure::new(
            FailureKind::ContractViolation,
            "Reaction cannot contain line separators",
        ));
    }

    let normalized: String = reaction.trim().nfc().collect();
    if normalized.is_empty() {
        return Ok("+".to_owned());
    }

    if normalized.starts_with(':') || normalized.ends_with(':') {
        let shortcode = normalized
            .strip_prefix(':')
            .and_then(|value| value.strip_suffix(':'))
            .unwrap_or_default();
        if shortcode.is_empty()
            || shortcode.len() > 64
            || !shortcode.chars().all(|character| {
                character.is_ascii_alphanumeric() || character == '_' || character == '-'
            })
        {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "A custom Reaction shortcode must contain 1-64 ASCII letters, digits, hyphens, or underscores",
            ));
        }
        return Ok(format!(":{}:", shortcode.to_ascii_lowercase()));
    }

    if normalized.chars().count() > 64 {
        return Err(ClientFailure::new(
            FailureKind::ContractViolation,
            "Reaction exceeds 64 Unicode scalar values",
        ));
    }
    Ok(normalized)
}

fn validate_mutation_scope(
    message: &MessageView,
    workspace_id: &str,
    conversation_id: &str,
    message_id: &str,
) -> Result<(), ClientFailure> {
    if message.workspace_id != workspace_id
        || message.conversation_id != conversation_id
        || message.id != message_id
    {
        return Err(ClientFailure::contract("message.mutation-response@1"));
    }
    Ok(())
}

fn validate_post_acknowledgement(
    message: &MessageView,
    workspace_id: &str,
    punk_id: &str,
    conversation_id: &str,
    reply_target: Option<&MessageReplyTarget>,
) -> Result<(), ClientFailure> {
    validate_message_view_runtime(message, workspace_id, conversation_id)?;
    let authored_by_current_punk = matches!(
        &message.author,
        MessageAuthor::Punk {
            punk_id: acknowledged_punk_id,
        } if acknowledged_punk_id == punk_id
    );
    let ancestry_matches = match reply_target {
        None => {
            message.parent_message_id.is_none()
                && message.thread_root_message_id == message.id
                && message.thread_depth == 0
        }
        Some(reply_target) => {
            message.id != reply_target.message_id
                && message.parent_message_id.as_deref() == Some(reply_target.message_id.as_str())
                && message.thread_root_message_id == reply_target.thread_root_message_id
                && message.thread_depth == reply_target.thread_depth + 1
        }
    };
    if !authored_by_current_punk || !ancestry_matches {
        return Err(ClientFailure::contract("message.post-response@1"));
    }
    Ok(())
}

fn validate_reaction_acknowledgement(
    operation: ReactionOperation,
    acknowledgement: &ReactionMutationResult,
    expected: ExpectedReactionCoordinate<'_>,
) -> Result<(), ClientFailure> {
    let effect_matches = match operation {
        ReactionOperation::Add => {
            matches!(acknowledgement.effect.as_str(), "added" | "unchanged")
        }
        ReactionOperation::Remove => {
            matches!(acknowledgement.effect.as_str(), "removed" | "unchanged")
        }
    };
    let current_view_matches = acknowledgement.replayed
        || match operation {
            ReactionOperation::Add => acknowledgement.reaction.is_some(),
            ReactionOperation::Remove => acknowledgement.reaction.is_none(),
        };
    if !effect_matches || !current_view_matches {
        return Err(ClientFailure::contract(
            "message.reaction-mutation-response@1",
        ));
    }
    if let Some(view) = &acknowledgement.reaction {
        validate_reaction_view(view, expected)?;
    }
    Ok(())
}

fn validate_reaction_view(
    view: &ReactionView,
    expected: ExpectedReactionCoordinate<'_>,
) -> Result<(), ClientFailure> {
    validate_uuid(&view.id, "reactionId")?;
    validate_uuid(&view.workspace_id, "workspaceId")?;
    validate_uuid(&view.conversation_id, "conversationId")?;
    validate_uuid(&view.message_id, "messageId")?;
    let authored_by_current_punk = matches!(
        &view.actor,
        MessageAuthor::Punk {
            punk_id: acknowledged_punk_id,
        } if acknowledged_punk_id == expected.punk_id
    );
    if view.workspace_id != expected.workspace_id
        || view.conversation_id != expected.conversation_id
        || view.message_id != expected.message_id
        || view.reaction != expected.reaction
        || !authored_by_current_punk
        || !valid_rfc3339(&view.reacted_at)
    {
        return Err(ClientFailure::contract(
            "message.reaction-mutation-response@1",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::canonical_reaction;

    #[test]
    fn canonical_reaction_matches_authority_coordinates() {
        assert_eq!(canonical_reaction("").expect("legacy coordinate"), "+");
        assert_eq!(
            canonical_reaction("  e\u{301}  ").expect("NFC coordinate"),
            "é"
        );
        assert_eq!(
            canonical_reaction(":Party_Parrot:").expect("shortcode coordinate"),
            ":party_parrot:"
        );
        assert!(canonical_reaction("a\nb").is_err());
        assert!(canonical_reaction("x".repeat(65).as_str()).is_err());
        assert!(canonical_reaction(":party parrot:").is_err());
    }
}
