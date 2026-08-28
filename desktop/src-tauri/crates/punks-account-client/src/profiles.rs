use std::collections::HashSet;

use chrono::DateTime;
use reqwest::Method;
use serde::Serialize;
use serde_json::{json, Value};
use unicode_normalization::UnicodeNormalization;

use crate::workspace_governance::require_identity_governance;
use crate::{
    contracts_profile, decode, validate_uuid, ClientFailure, FailureKind, PunksAccountClient,
    RequestSafety, WorkspaceSession,
};

/// Full self-only Compte Punks profile returned by `punk.get@1`.
pub type PunkProfile = contracts_profile::Punk;

/// Generated allowlisted presentation sidecar visible to an authorized Punk.
pub type PunkPublicSummary = contracts_profile::PunkSummaryBatchResponseSummary;
/// Generated bounded page of allowlisted Punk summaries.
pub type PunkSummaryPage = contracts_profile::PunkSummaryBatchResponse;

/// Closed private-search intent supported by the Workspace session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PunkSearchInput {
    Prefix(String),
    PunkId(String),
}

/// Generated bounded response without totals or candidate metadata.
pub type PunkSearchPage = contracts_profile::PunkSearchResponse;

fn canonical_display_name(value: &str) -> Result<String, ClientFailure> {
    let canonical = value.trim().nfc().collect::<String>();
    let length = canonical.chars().count();
    if length == 0 || length > 80 || canonical.chars().any(|character| character.is_control()) {
        return Err(ClientFailure::contract("punk displayName"));
    }
    Ok(canonical)
}

fn canonical_avatar_url(value: Option<&str>) -> Result<Option<String>, ClientFailure> {
    let Some(value) = value else {
        return Ok(None);
    };
    if value.is_empty() || value.len() > 2_048 {
        return Err(ClientFailure::contract("punk avatarUrl"));
    }
    let parsed = url::Url::parse(value).map_err(|_| ClientFailure::contract("punk avatarUrl"))?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
    {
        return Err(ClientFailure::contract("punk avatarUrl"));
    }
    let canonical = parsed.to_string();
    if canonical.len() > 2_048 {
        return Err(ClientFailure::contract("punk avatarUrl"));
    }
    Ok(Some(canonical))
}

fn canonical_timestamp(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value).is_ok()
}

fn lowercase_hex_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_identity(value: &impl Serialize) -> bool {
    let Ok(value) = serde_json::to_value(value) else {
        return false;
    };
    let Some(identity) = value.as_object() else {
        return false;
    };
    let expected = [
        "credentialId",
        "emailHash",
        "linkedAt",
        "provider",
        "subjectHash",
        "username",
        "verifiedEmail",
    ];
    let mut keys = identity.keys().map(String::as_str).collect::<Vec<_>>();
    keys.sort_unstable();
    if keys != expected {
        return false;
    }
    let provider = identity.get("provider").and_then(Value::as_str);
    let optional_string = |field: &str, maximum: usize| {
        identity.get(field).is_some_and(|candidate| {
            candidate.is_null()
                || candidate
                    .as_str()
                    .is_some_and(|text| !text.is_empty() && text.len() <= maximum)
        })
    };
    matches!(provider, Some("google" | "github"))
        && identity
            .get("subjectHash")
            .and_then(Value::as_str)
            .is_some_and(lowercase_hex_digest)
        && identity
            .get("emailHash")
            .and_then(Value::as_str)
            .is_some_and(lowercase_hex_digest)
        && optional_string("verifiedEmail", 320)
        && optional_string("username", 255)
        && optional_string("credentialId", 2_048)
        && identity
            .get("linkedAt")
            .and_then(Value::as_str)
            .is_some_and(canonical_timestamp)
}

fn validate_profile(profile: &PunkProfile) -> Result<(), ClientFailure> {
    validate_uuid(&profile.id, "punkId")?;
    if profile.status != contracts_profile::PunkStatus::Active
        || canonical_display_name(&profile.display_name)? != profile.display_name
        || canonical_avatar_url(profile.avatar_url.as_deref())? != profile.avatar_url
        || profile.identities.is_empty()
        || !profile.identities.iter().all(valid_identity)
        || profile.merged_into.is_some()
        || profile.revision == 0
        || !canonical_timestamp(&profile.created_at)
        || !canonical_timestamp(&profile.updated_at)
    {
        return Err(ClientFailure::contract("punk@1"));
    }
    Ok(())
}

fn validate_summary(
    punk_id: &str,
    display_name: &str,
    avatar_url: Option<&str>,
) -> Result<(), ClientFailure> {
    validate_uuid(punk_id, "punkId")?;
    if canonical_display_name(display_name)? != display_name
        || canonical_avatar_url(avatar_url)? != avatar_url.map(str::to_owned)
    {
        return Err(ClientFailure::contract("punk.summary@1"));
    }
    Ok(())
}

fn canonical_prefix(value: &str) -> Result<String, ClientFailure> {
    let canonical = value.trim().nfkc().collect::<String>().to_lowercase();
    let significant = canonical
        .chars()
        .filter(|character| character.is_alphanumeric())
        .count();
    if canonical.chars().count() > 80
        || significant < 3
        || canonical.chars().any(|character| character.is_control())
    {
        return Err(ClientFailure::new(
            FailureKind::ContractViolation,
            "Punk search prefix must contain at least three letters or digits",
        ));
    }
    Ok(canonical)
}

fn canonical_search_key(value: &str) -> Result<String, ClientFailure> {
    Ok(canonical_display_name(value)?
        .nfkc()
        .collect::<String>()
        .to_lowercase())
}

fn validate_search_cursor(value: &str) -> Result<(), ClientFailure> {
    let mut segments = value.split('.');
    let prefix = segments.next();
    let iv = segments.next();
    let ciphertext = segments.next();
    let url_safe = |segment: &str| {
        segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    };
    if value.len() < 50
        || value.len() > 1_024
        || prefix != Some("psc1")
        || iv.is_none_or(|segment| segment.len() != 16 || !url_safe(segment))
        || ciphertext.is_none_or(|segment| segment.is_empty() || !url_safe(segment))
        || segments.next().is_some()
    {
        return Err(ClientFailure::contract("punk.search cursor"));
    }
    Ok(())
}

impl PunksAccountClient {
    /// Reads the full profile only for the currently authenticated Punk.
    pub async fn get_punk_profile(&self) -> Result<PunkProfile, ClientFailure> {
        require_identity_governance(self).await?;
        self.require_compatible().await?;
        let response = self
            .inner
            .transport
            .request(
                Method::GET,
                "/api/v1/punk".to_owned(),
                None,
                RequestSafety::Read,
            )
            .await?;
        let profile: PunkProfile = decode("punk@1", response)?;
        validate_profile(&profile)?;
        Ok(profile)
    }

    /// Applies one explicit profile intent. Transport interruption stays ambiguous.
    pub async fn update_punk_profile(
        &self,
        expected_revision: u64,
        display_name: &str,
        avatar_url: Option<&str>,
    ) -> Result<PunkProfile, ClientFailure> {
        require_identity_governance(self).await?;
        self.require_compatible().await?;
        if expected_revision == 0 {
            return Err(ClientFailure::contract("punk.update@1"));
        }
        let display_name = canonical_display_name(display_name)?;
        let avatar_url = canonical_avatar_url(avatar_url)?;
        let command_id = uuid::Uuid::new_v4().to_string();
        let response = self
            .inner
            .transport
            .request(
                Method::PATCH,
                "/api/v1/punk".to_owned(),
                Some(json!({
                    "contract": "punk.update@1",
                    "commandId": command_id,
                    "expectedRevision": expected_revision,
                    "displayName": display_name,
                    "avatarUrl": avatar_url,
                })),
                RequestSafety::Mutation,
            )
            .await?;
        let profile: PunkProfile = decode("punk@1", response)?;
        validate_profile(&profile)?;
        if profile.revision != expected_revision + 1 {
            return Err(ClientFailure::contract("punk.update@1 revision"));
        }
        let mut state = self.inner.state.lock().await;
        if let Some(session) = state
            .session
            .as_mut()
            .filter(|session| session.punk_id == profile.id)
        {
            session.punk.display_name.clone_from(&profile.display_name);
            session.punk.avatar_url.clone_from(&profile.avatar_url);
        }
        Ok(profile)
    }
}

impl WorkspaceSession {
    /// Resolves at most 100 summaries, all reauthorized by the Worker.
    pub async fn get_punk_summaries(
        &self,
        punk_ids: &[String],
    ) -> Result<PunkSummaryPage, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        if punk_ids.is_empty() || punk_ids.len() > 100 {
            return Err(ClientFailure::contract("punk.summary-batch@1"));
        }
        let mut requested = HashSet::with_capacity(punk_ids.len());
        for punk_id in punk_ids {
            validate_uuid(punk_id, "punkId")?;
            if !requested.insert(punk_id.as_str()) {
                return Err(ClientFailure::contract("punk.summary-batch@1"));
            }
        }
        self.assert_current().await?;
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/punks/summaries",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "punk.summary-batch@1",
                    "workspaceId": self.lease.workspace_id,
                    "punkIds": punk_ids,
                })),
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        let page: PunkSummaryPage = decode("punk.summary-batch-response@1", response)?;
        if page.workspace_id != self.lease.workspace_id || page.items.len() > punk_ids.len() {
            return Err(ClientFailure::contract("punk.summary-batch-response@1"));
        }
        let mut returned = HashSet::with_capacity(page.items.len());
        for summary in &page.items {
            validate_summary(
                &summary.punk_id,
                &summary.display_name,
                summary.avatar_url.as_deref(),
            )?;
            // A requested historical alias intentionally resolves to its
            // surviving Punk. The public response does not expose the alias
            // mapping, so cardinality and uniqueness are the enforceable
            // bounds rather than literal equality with the request IDs.
            if !returned.insert(summary.punk_id.clone()) {
                return Err(ClientFailure::contract("punk.summary-batch-response@1"));
            }
        }
        Ok(page)
    }

    /// Performs one bounded private search without exposing candidate metadata.
    pub async fn search_punks(
        &self,
        input: PunkSearchInput,
        limit: u8,
        cursor: Option<&str>,
    ) -> Result<PunkSearchPage, ClientFailure> {
        require_identity_governance(&PunksAccountClient {
            inner: self.inner.clone(),
        })
        .await?;
        if limit == 0 || limit > 20 {
            return Err(ClientFailure::contract("punk.search@1 limit"));
        }
        let (query, prefix) = match input {
            PunkSearchInput::Prefix(value) => {
                let prefix = canonical_prefix(&value)?;
                (json!({ "kind": "prefix", "value": prefix }), Some(prefix))
            }
            PunkSearchInput::PunkId(punk_id) => {
                validate_uuid(&punk_id, "punkId")?;
                if limit != 1 || cursor.is_some() {
                    return Err(ClientFailure::contract("punk.search@1 exact lookup"));
                }
                (json!({ "kind": "punk_id", "punkId": punk_id }), None)
            }
        };
        if let Some(cursor) = cursor {
            validate_search_cursor(cursor)?;
        }
        self.assert_current().await?;
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/punks/search",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "punk.search@1",
                    "workspaceId": self.lease.workspace_id,
                    "query": query,
                    "limit": limit,
                    "cursor": cursor,
                })),
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        let page: PunkSearchPage = decode("punk.search-response@1", response)?;
        if page.workspace_id != self.lease.workspace_id || page.items.len() > usize::from(limit) {
            return Err(ClientFailure::contract("punk.search-response@1"));
        }
        if let Some(next_cursor) = &page.next_cursor {
            validate_search_cursor(next_cursor)?;
            if prefix.is_none() {
                return Err(ClientFailure::contract(
                    "punk.search-response@1 exact cursor",
                ));
            }
        }
        let mut returned = HashSet::with_capacity(page.items.len());
        for summary in &page.items {
            validate_summary(
                &summary.punk_id,
                &summary.display_name,
                summary.avatar_url.as_deref(),
            )?;
            if !returned.insert(summary.punk_id.clone())
                || prefix.as_ref().is_some_and(|prefix| {
                    canonical_search_key(&summary.display_name)
                        .is_ok_and(|key| !key.starts_with(prefix))
                })
            {
                return Err(ClientFailure::contract("punk.search-response@1"));
            }
        }
        self.assert_current().await?;
        Ok(page)
    }
}
