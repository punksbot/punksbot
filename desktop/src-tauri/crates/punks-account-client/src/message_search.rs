use std::collections::HashSet;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::social_validation::validate_message_view_runtime;
use crate::{
    decode, validate_uuid, ClientFailure, FailureKind, MessageView, PunksAccountClient,
    RequestSafety, WorkspaceSession,
};

/// Whether the current authorized page represents the complete known index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageSearchCompleteness {
    Complete,
    Partial,
}

/// Closed reason for an honest partial Message search result.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageSearchPartialReason {
    IndexLagging,
    IndexUnavailable,
}

/// One authorized Message search page with no score, snippet or index token.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MessageSearchPage {
    pub workspace_id: String,
    pub conversation_id: String,
    pub thread_root_message_id: Option<String>,
    pub order: String,
    pub completeness: MessageSearchCompleteness,
    pub partial_reason: Option<MessageSearchPartialReason>,
    pub items: Vec<MessageView>,
    pub next_cursor: Option<String>,
}

fn validate_search_cursor(value: &str) -> Result<(), ClientFailure> {
    let mut segments = value.split('.');
    let prefix = segments.next();
    let nonce = segments.next();
    let ciphertext = segments.next();
    let url_safe = |segment: &str| {
        segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    if value.len() < 50
        || value.len() > 1_024
        || prefix != Some("msc1")
        || nonce.is_none_or(|segment| segment.len() != 16 || !url_safe(segment))
        || ciphertext.is_none_or(|segment| segment.is_empty() || !url_safe(segment))
        || segments.next().is_some()
    {
        return Err(ClientFailure::contract("message.search cursor"));
    }
    Ok(())
}

fn lexical_terms(value: &str, maximum: usize) -> Vec<String> {
    let normalized = value.nfkc().collect::<String>().to_lowercase();
    let mut terms = Vec::new();
    let mut seen = HashSet::new();
    for term in normalized.split(|character: char| !character.is_alphanumeric()) {
        if term.is_empty() || !seen.insert(term) {
            continue;
        }
        terms.push(term.to_owned());
        if terms.len() == maximum {
            break;
        }
    }
    terms
}

fn validate_response_keys(value: &Value) -> Result<(), ClientFailure> {
    let Some(object) = value.as_object() else {
        return Err(ClientFailure::contract("message.search-response@1"));
    };
    let mut keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    if keys
        != [
            "completeness",
            "conversationId",
            "items",
            "nextCursor",
            "order",
            "partialReason",
            "threadRootMessageId",
            "workspaceId",
        ]
    {
        return Err(ClientFailure::contract("message.search-response@1"));
    }
    Ok(())
}

async fn require_search_capability(client: &PunksAccountClient) -> Result<(), ClientFailure> {
    let state = client.inner.state.lock().await;
    if state.compatibility.as_ref().is_some_and(|compatibility| {
        compatibility.compatible
            && compatibility
                .capabilities
                .iter()
                .any(|capability| capability == "search")
    }) {
        return Ok(());
    }
    Err(ClientFailure::new(
        FailureKind::ContractViolation,
        "search is unavailable for this client profile",
    ))
}

impl WorkspaceSession {
    /// Searches one authorized Conversation or Fil without exposing index data.
    pub async fn search_messages(
        &self,
        conversation_id: &str,
        thread_root_message_id: Option<&str>,
        query: &str,
        limit: u8,
        cursor: Option<&str>,
    ) -> Result<MessageSearchPage, ClientFailure> {
        require_search_capability(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        validate_uuid(conversation_id, "conversationId")?;
        if let Some(thread_root_message_id) = thread_root_message_id {
            validate_uuid(thread_root_message_id, "threadRootMessageId")?;
        }
        let query_terms = lexical_terms(query, 33);
        if query.chars().count() > 512
            || query_terms.is_empty()
            || query_terms.len() > 32
            || limit == 0
            || limit > 100
        {
            return Err(ClientFailure::contract("message.search@1"));
        }
        if let Some(cursor) = cursor {
            validate_search_cursor(cursor)?;
        }
        self.assert_current().await?;
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/conversations/{conversation_id}/messages/search",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "message.search@1",
                    "workspaceId": self.lease.workspace_id,
                    "conversationId": conversation_id,
                    "threadRootMessageId": thread_root_message_id,
                    "query": query,
                    "cursor": cursor,
                    "limit": limit,
                })),
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        validate_response_keys(&response)?;
        let page: MessageSearchPage = decode("message.search-response@1", response)?;
        self.assert_current().await?;
        validate_message_search_page(
            &page,
            &self.lease.workspace_id,
            conversation_id,
            thread_root_message_id,
            &query_terms,
            usize::from(limit),
        )?;
        Ok(page)
    }
}

fn validate_message_search_page(
    page: &MessageSearchPage,
    workspace_id: &str,
    conversation_id: &str,
    thread_root_message_id: Option<&str>,
    query_terms: &[String],
    limit: usize,
) -> Result<(), ClientFailure> {
    if page.workspace_id != workspace_id
        || page.conversation_id != conversation_id
        || page.thread_root_message_id.as_deref() != thread_root_message_id
        || page.order != "createdCursor-descending"
        || page.items.len() > limit
        || !matches!(
            (page.completeness, page.partial_reason),
            (MessageSearchCompleteness::Complete, None)
                | (
                    MessageSearchCompleteness::Partial,
                    Some(
                        MessageSearchPartialReason::IndexLagging
                            | MessageSearchPartialReason::IndexUnavailable
                    )
                )
        )
    {
        return Err(ClientFailure::contract("message.search-response@1"));
    }
    if let Some(next_cursor) = &page.next_cursor {
        validate_search_cursor(next_cursor)?;
    }
    let mut ids = HashSet::with_capacity(page.items.len());
    let mut previous: Option<(u64, &str)> = None;
    for message in &page.items {
        validate_message_view_runtime(message, workspace_id, conversation_id)?;
        let ordered = previous.is_none_or(|(created_cursor, message_id)| {
            message.created_cursor < created_cursor
                || (message.created_cursor == created_cursor && message.id.as_str() > message_id)
        });
        if message.status != "active"
            || thread_root_message_id
                .is_some_and(|expected| message.thread_root_message_id != expected)
            || !message.content.as_ref().is_some_and(|content| {
                let document = message
                    .topic
                    .as_ref()
                    .map_or_else(|| content.clone(), |topic| format!("{content}\0{topic}"));
                let document_terms = lexical_terms(&document, 1_024)
                    .into_iter()
                    .collect::<HashSet<_>>();
                query_terms.iter().all(|term| document_terms.contains(term))
            })
            || !ids.insert(message.id.as_str())
            || !ordered
        {
            return Err(ClientFailure::contract("message.search-response@1"));
        }
        previous = Some((message.created_cursor, message.id.as_str()));
    }
    Ok(())
}
