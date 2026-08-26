use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::{transport::RequestSafety, ClientFailure, PunksAccountClient};

/// Exact source-bound coordinate used only by the installed promotion fault observer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionFaultObservationInput {
    /// Unique injected execution selected by the promotion controller.
    pub execution_id: String,
    /// Immutable source commit executed by the installed candidate.
    pub candidate_sha: String,
    /// Content-addressed seven-Worker deployment proof identifier.
    pub staging_deployment_id: String,
    /// Closed injected failure category.
    #[serde(rename = "type")]
    pub fault_type: String,
    /// Exact Durable Object or service authority coordinate.
    pub authority: String,
    /// Exact aggregate or service coordinate exercised by the installed story.
    pub target: PromotionFaultTarget,
}

/// Closed target coordinate for one real staging authority instance.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionFaultTarget {
    /// Whether the authority is one aggregate or a Worker-level service.
    pub kind: String,
    /// Stable aggregate ID/slug or canonical service ID.
    pub id: String,
    /// Exact installed fixture coordinates used by normal business reads.
    pub probe: PromotionBusinessProbe,
}

/// Closed installed fixture scope used to avoid synthetic or malformed probes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionBusinessProbe {
    /// Authenticated Punk owning the fixture.
    pub punk_id: String,
    /// Exact mounted Workspace.
    pub workspace_id: String,
    /// Exact remotely resolved Workspace slug.
    pub workspace_slug: String,
    /// Exact Stream exercised by the installed candidate.
    pub conversation_id: String,
    /// Exact committed Message exercised by reads and Erasure probes.
    pub message_id: String,
}

/// Successful native observation after a controlled promotion recovery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromotionFaultObservation {
    /// Closed observer contract identifier.
    pub contract: String,
    /// Exact injected execution that was observed.
    pub execution_id: String,
    /// Authority reached through the authenticated installed boundary.
    pub authority: String,
    /// Terminal recovered state.
    pub status: String,
}

impl PunksAccountClient {
    /// Observes a controlled staging fault through the active native Session.
    pub async fn observe_promotion_fault(
        &self,
        input: PromotionFaultObservationInput,
    ) -> Result<PromotionFaultObservation, ClientFailure> {
        self.require_compatible().await?;
        let execution = input.execution_id.split(':').collect::<Vec<_>>();
        let candidate_prefix = input.candidate_sha.get(..12).unwrap_or("");
        let execution_source = execution.first().and_then(|value| value.split_once('.'));
        if self.inner.state.lock().await.session.is_none()
            || input.candidate_sha.len() != 40
            || !input
                .candidate_sha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || input.staging_deployment_id.len() != 71
            || !input.staging_deployment_id.starts_with("sha256:")
            || !input.staging_deployment_id[7..]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || execution.len() != 4
            || execution_source.map(|(candidate, _)| candidate) != Some(candidate_prefix)
            || !execution_source
                .map(|(_, artifact)| {
                    artifact.len() == 12
                        && artifact
                            .bytes()
                            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                })
                .unwrap_or(false)
            || !matches!(execution[1], "linux-x64" | "windows-x64")
            || execution[2] != input.fault_type
            || execution[3] != input.authority
            || !matches!(
                input.fault_type.as_str(),
                "coupure" | "revocation" | "perte-autorite"
            )
            || input.authority.is_empty()
            || input.authority.len() > 128
            || !input
                .authority
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || !matches!(input.target.kind.as_str(), "aggregate" | "service")
            || input.target.id.is_empty()
            || input.target.id.len() > 300
            || !input
                .target
                .id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'-'))
            || [
                input.target.probe.punk_id.as_str(),
                input.target.probe.workspace_id.as_str(),
                input.target.probe.conversation_id.as_str(),
                input.target.probe.message_id.as_str(),
            ]
            .iter()
            .any(|coordinate| {
                coordinate.len() != 36
                    || !coordinate
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
            })
            || input.target.probe.workspace_slug.is_empty()
            || input.target.probe.workspace_slug.len() > 64
            || !input
                .target
                .probe
                .workspace_slug
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(ClientFailure::contract("promotion.fault-observe@1"));
        }
        let probe = &input.target.probe;
        let (method, path, body, safety) = match input.authority.as_str() {
            "auth-punk" | "auth-session" => (
                Method::GET,
                "/api/auth/v1/session".to_string(),
                None,
                RequestSafety::Read,
            ),
            "auth-session-revocation" => (
                Method::POST,
                "/api/v1/promotion/faults/observe".to_string(),
                Some(json!({
                    "contract": "promotion.fault-observe@1",
                    "executionId": &input.execution_id,
                    "candidateSha": &input.candidate_sha,
                    "stagingDeploymentId": &input.staging_deployment_id,
                    "type": &input.fault_type,
                    "authority": &input.authority,
                    "target": &input.target,
                })),
                RequestSafety::Read,
            ),
            "api-workspace" | "api-workspace-slug" => (
                Method::GET,
                format!("/api/v1/workspaces/{}", probe.workspace_slug),
                None,
                RequestSafety::Read,
            ),
            "api-conversation" | "api-message-content" | "erasure-registry" => (
                Method::GET,
                format!(
                    "/api/v1/workspaces/{}/conversations/{}/messages?limit=1&direction=older",
                    probe.workspace_id, probe.conversation_id,
                ),
                None,
                RequestSafety::Read,
            ),
            "internal-event-signature" => {
                let command_id = promotion_probe_uuid(&input.execution_id);
                (
                    Method::POST,
                    format!(
                        "/api/v1/workspaces/{}/conversations/{}/messages",
                        probe.workspace_id, probe.conversation_id,
                    ),
                    Some(json!({
                        "contract": "message.post@1",
                        "commandId": command_id,
                        "workspaceId": &probe.workspace_id,
                        "conversationId": &probe.conversation_id,
                        "actor": { "kind": "punk", "punkId": &probe.punk_id },
                        "payload": {
                            "content": format!("Promotion recovery probe {}", input.execution_id),
                            "topic": "Promotion recovery",
                            "replyToMessageId": null,
                            "broadcast": false,
                            "mentionedPunkIds": [],
                            "mediaIds": []
                        }
                    })),
                    RequestSafety::Mutation,
                )
            }
            _ => return Err(ClientFailure::contract("promotion.fault-observe@1")),
        };
        self.inner
            .transport
            .request(method, path, body, safety)
            .await?;
        Ok(PromotionFaultObservation {
            contract: "promotion.business-operation@1".to_string(),
            execution_id: input.execution_id,
            authority: input.authority,
            status: "recovered".to_string(),
        })
    }
}

fn promotion_probe_uuid(execution_id: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"punks.promotion.business-probe.v1\0");
    digest.update(execution_id.as_bytes());
    let hash = digest.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&hash[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let value = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "{}-{}-{}-{}-{}",
        &value[0..8],
        &value[8..12],
        &value[12..16],
        &value[16..20],
        &value[20..32]
    )
}
