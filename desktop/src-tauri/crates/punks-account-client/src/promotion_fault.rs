use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

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
        {
            return Err(ClientFailure::contract("promotion.fault-observe@1"));
        }
        let response = self
            .inner
            .transport
            .request(
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
            )
            .await?;
        let observed: PromotionFaultObservation = serde_json::from_value(response)
            .map_err(|_| ClientFailure::contract("promotion.fault-observe@1"))?;
        if observed.contract != "promotion.fault-observe@1"
            || observed.execution_id != input.execution_id
            || observed.authority != input.authority
            || observed.status != "recovered"
        {
            return Err(ClientFailure::contract("promotion.fault-observe@1"));
        }
        Ok(observed)
    }
}
