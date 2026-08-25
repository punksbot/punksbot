use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::{decode, validate_uuid, ClientFailure, FailureKind, RequestSafety, WorkspaceSession};

/// Stable author coordinates accepted by the bounded resolver.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum AuthorReference {
    Punk {
        #[serde(rename = "punkId")]
        punk_id: String,
    },
    Bot {
        #[serde(rename = "installationId")]
        installation_id: String,
    },
}

/// Bounded display sidecar; never an authority or roster entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum AuthorSummary {
    Punk {
        #[serde(rename = "punkId")]
        punk_id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "avatarUrl")]
        avatar_url: Option<String>,
    },
    Bot {
        #[serde(rename = "installationId")]
        installation_id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        #[serde(rename = "avatarUrl")]
        avatar_url: Option<String>,
    },
}

impl AuthorSummary {
    pub fn display_name(&self) -> &str {
        match self {
            Self::Punk { display_name, .. } | Self::Bot { display_name, .. } => display_name,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AuthorResponse {
    contract: String,
    workspace_id: String,
    authors: Vec<AuthorSummary>,
}

impl WorkspaceSession {
    /// Resolves at most 100 presentation sidecars after Workspace authorization.
    pub async fn resolve_authors(
        &self,
        authors: &[AuthorReference],
    ) -> Result<Vec<AuthorSummary>, ClientFailure> {
        if authors.is_empty() || authors.len() > 100 {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "Author resolver requires between 1 and 100 references",
            ));
        }
        for author in authors {
            match author {
                AuthorReference::Punk { punk_id } => validate_uuid(punk_id, "punkId")?,
                AuthorReference::Bot { installation_id } => {
                    validate_uuid(installation_id, "installationId")?
                }
            }
        }
        self.assert_current().await?;
        let response = self
            .request(
                Method::POST,
                format!(
                    "/api/v1/workspaces/{}/authors/resolve",
                    self.lease.workspace_id
                ),
                Some(json!({
                    "contract": "author.resolve@1",
                    "workspaceId": self.lease.workspace_id,
                    "authors": authors,
                })),
                RequestSafety::Read,
            )
            .await?;
        self.assert_current().await?;
        let response: AuthorResponse = decode("author.resolve-response@1", response)?;
        self.assert_current().await?;
        if response.contract != "author.resolve-response@1"
            || response.workspace_id != self.lease.workspace_id
        {
            return Err(ClientFailure::contract("author.resolve-response@1"));
        }
        Ok(response.authors)
    }
}
