use std::sync::Arc;

#[cfg(test)]
use std::{future::Future, pin::Pin};

use reqwest::{cookie::Jar, Client, Method, StatusCode};
use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;
use url::Url;

use crate::{
    failure::classify_observed_interruption, promotion_audit::record_network_request,
    validation::validate_uuid, ClientFailure, FailureKind,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Problem {
    #[serde(rename = "type")]
    _problem_type: String,
    title: String,
    #[serde(rename = "status")]
    _status: u16,
    code: String,
    detail: Option<String>,
    #[serde(rename = "correlationId")]
    _correlation_id: String,
    retry: String,
    #[serde(rename = "retryAfterMs")]
    _retry_after_ms: Option<u64>,
}

#[derive(Clone, Copy)]
pub(crate) enum RequestSafety {
    Read,
    Mutation,
}

pub(crate) struct HttpTransport {
    pub(crate) client: Client,
    pub(crate) jar: Arc<Jar>,
    pub(crate) origin: Url,
}

#[cfg(test)]
type TestResponse = Pin<Box<dyn Future<Output = Result<Value, ClientFailure>> + Send>>;
#[cfg(test)]
pub(crate) type TestHandler = Arc<
    dyn Fn(String, String, Option<Value>, Option<String>) -> TestResponse + Send + Sync + 'static,
>;

pub(crate) enum Transport {
    Http(HttpTransport),
    #[cfg(test)]
    Test(TestHandler),
}

impl Transport {
    pub(crate) async fn request(
        &self,
        method: Method,
        path: String,
        body: Option<Value>,
        safety: RequestSafety,
    ) -> Result<Value, ClientFailure> {
        let idempotency_key = match safety {
            RequestSafety::Read => None,
            RequestSafety::Mutation => {
                let command_id = body
                    .as_ref()
                    .and_then(|value| value.get("commandId"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        ClientFailure::new(
                            FailureKind::ContractViolation,
                            "Punks mutation is missing commandId",
                        )
                    })?;
                validate_uuid(command_id, "commandId")?;
                Some(command_id.to_owned())
            }
        };
        match self {
            Self::Http(transport) => {
                let url = transport
                    .origin
                    .join(path.trim_start_matches('/'))
                    .map_err(|_| {
                        ClientFailure::new(
                            FailureKind::ContractViolation,
                            "Punks operation path is invalid",
                        )
                    })?;
                let audit_method = method.as_str().to_owned();
                let audit_url = url.clone();
                let mut request = transport.client.request(method, url);
                if let Some(body) = &body {
                    request = request.json(body);
                }
                if let Some(idempotency_key) = &idempotency_key {
                    request = request.header("idempotency-key", idempotency_key);
                }
                let response = request.send().await.map_err(|error| {
                    let kind =
                        classify_request_failure(safety, error.is_builder(), error.is_connect());
                    ClientFailure::new(kind, "Punks request did not produce a response")
                })?;
                let status = response.status();
                record_network_request(&audit_method, &audit_url, status.as_u16());
                let value = response.json::<Value>().await.map_err(|_| {
                    ClientFailure::new(
                        FailureKind::ContractViolation,
                        "Punks response was not valid JSON",
                    )
                })?;
                if status.is_success() {
                    return Ok(value);
                }
                problem_failure(status, value)
            }
            #[cfg(test)]
            Self::Test(handler) => {
                handler(method.as_str().to_owned(), path, body, idempotency_key).await
            }
        }
    }
}

fn classify_request_failure(
    safety: RequestSafety,
    builder_failure: bool,
    connection_failure: bool,
) -> FailureKind {
    if builder_failure {
        return FailureKind::ContractViolation;
    }
    classify_observed_interruption(
        if matches!(safety, RequestSafety::Mutation) {
            "mutation"
        } else {
            "read"
        },
        !connection_failure,
        false,
        false,
    )
    .kind
}

/// Taxonomie fermée partagée : l'échec d'authentification prime toujours sur
/// l'indice de rejeu `same_command` (mêmes sémantiques que le client TS).
pub(crate) fn problem_failure_kind(status: u16, code: &str, retry: &str) -> FailureKind {
    if status == 401 || code == "unauthenticated" {
        FailureKind::SessionExpired
    } else if retry == "same_command" {
        FailureKind::Ambiguous
    } else {
        FailureKind::Problem
    }
}

fn problem_failure(status: StatusCode, value: Value) -> Result<Value, ClientFailure> {
    let problem = serde_json::from_value::<Problem>(value.clone()).map_err(|_| {
        ClientFailure::new(
            FailureKind::ContractViolation,
            "Punks error response violated problem@1",
        )
    })?;
    let kind = problem_failure_kind(status.as_u16(), &problem.code, &problem.retry);
    Err(ClientFailure {
        kind,
        message: problem.detail.clone().unwrap_or(problem.title.clone()),
        problem: Some(value),
    })
}

pub(crate) fn decode<T: DeserializeOwned>(
    contract: &str,
    value: Value,
) -> Result<T, ClientFailure> {
    serde_json::from_value(value).map_err(|_| ClientFailure::contract(contract))
}

#[cfg(test)]
mod tests {
    use super::{classify_request_failure, RequestSafety};
    use crate::FailureKind;

    #[test]
    fn mutation_connection_failure_is_transport_before_emission() {
        assert_eq!(
            classify_request_failure(RequestSafety::Mutation, false, true),
            FailureKind::Transport,
        );
    }

    #[test]
    fn mutation_failure_after_connection_is_ambiguous() {
        assert_eq!(
            classify_request_failure(RequestSafety::Mutation, false, false),
            FailureKind::Ambiguous,
        );
    }
}
