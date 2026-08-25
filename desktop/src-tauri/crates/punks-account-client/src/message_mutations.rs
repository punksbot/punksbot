use reqwest::Method;
use serde_json::json;
use unicode_normalization::UnicodeNormalization;

use super::{
    transport::{decode, RequestSafety},
    validation::validate_uuid,
    ClientFailure, FailureKind, MessageMutationResponse, MessageView, ReactionMutationResult,
    WorkspaceSession,
};

#[derive(Clone, Copy)]
enum MessageLifecycleOperation {
    Retract,
    Restore,
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
        reply_to_message_id: Option<&str>,
    ) -> Result<MessageView, ClientFailure> {
        validate_uuid(conversation_id, "conversationId")?;
        if let Some(reply_to_message_id) = reply_to_message_id {
            validate_uuid(reply_to_message_id, "replyToMessageId")?;
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
        if acknowledgement.message.workspace_id != self.lease.workspace_id
            || acknowledgement.message.conversation_id != conversation_id
        {
            return Err(ClientFailure::contract("message.post-response@1"));
        }
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
        self.mutate_reaction("add", conversation_id, message_id, reaction)
            .await
    }

    /// Removes one canonical Unicode Reaction exactly once.
    pub async fn remove_reaction(
        &self,
        conversation_id: &str,
        message_id: &str,
        reaction: &str,
    ) -> Result<ReactionMutationResult, ClientFailure> {
        self.mutate_reaction("remove", conversation_id, message_id, reaction)
            .await
    }

    async fn mutate_reaction(
        &self,
        action: &str,
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
        let contract = if action == "add" {
            "message.reaction-add@1"
        } else {
            "message.reaction-remove@1"
        };
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages/{message_id}/reactions/{action}",
                    self.lease.workspace_id
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
        Ok(acknowledgement)
    }

    async fn require_capability(&self, capability: &str) -> Result<(), ClientFailure> {
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

fn canonical_reaction(reaction: &str) -> Result<String, ClientFailure> {
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
