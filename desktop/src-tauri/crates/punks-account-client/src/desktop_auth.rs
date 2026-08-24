//! Endpoints HTTP de la Cérémonie de connexion desktop (issue #54).
//!
//! Client HTTP dédié, distinct du transport des opérations de Workspace :
//! le cookie de Session livré par le Worker vit ici sous forme de
//! [`SessionSecret`] et n'est jamais sérialisé, loggé ni exposé dans une
//! erreur. L'en-tête `Origin` est posé explicitement (le Worker exige la
//! même origine que le navigateur).

use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ORIGIN};
use reqwest::Method;
use serde::Deserialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::ceremony::SessionSecret;
use crate::failure::{ClientFailure, FailureKind};

const SESSION_COOKIE_PREFIX: &str = "__Host-punks_session=";
const LOCAL_SESSION_COOKIE_PREFIX: &str = "punks_session_dev=";

/// Résultat du démarrage de la cérémonie côté Worker.
#[derive(Debug, Clone)]
pub struct DesktopAuthStart {
    pub authorization_url: String,
    pub expires_at: SystemTime,
}

/// Session livrée : la vue publique ET le cookie détenu par Rust.
pub struct DeliveredSession {
    pub session_id: String,
    pub punk_id: String,
    pub expires_at: SystemTime,
    pub cookie: SessionSecret,
}

/// Client des endpoints desktop du Worker auth.
#[derive(Clone)]
pub struct DesktopAuthClient {
    http: reqwest::Client,
    origin: String,
    environment: String,
    installation_id: String,
}

#[derive(Deserialize)]
struct SessionShape {
    #[serde(rename = "sessionId")]
    session_id: String,
    #[serde(rename = "punkId")]
    punk_id: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
}

#[derive(Deserialize)]
struct StartShape {
    #[serde(rename = "authorizationUrl")]
    authorization_url: String,
    #[serde(rename = "expiresAt")]
    expires_at: String,
}

fn transport_failure(message: &str) -> ClientFailure {
    ClientFailure::new(FailureKind::Transport, message)
}

fn parse_iso8601(value: &str) -> Result<SystemTime, ClientFailure> {
    chrono_independent_parse(value)
}

/// Analyse une date ISO 8601 UTC sans dépendance externe.
fn chrono_independent_parse(value: &str) -> Result<SystemTime, ClientFailure> {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[10] != b'T' {
        return Err(transport_failure("horodatage de session invalide"));
    }
    let year: i64 = value
        .get(0..4)
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| transport_failure("année invalide"))?;
    let month: u64 = value
        .get(5..7)
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| transport_failure("mois invalide"))?;
    let day: u64 = value
        .get(8..10)
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| transport_failure("jour invalide"))?;
    let hour: u64 = value
        .get(11..13)
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| transport_failure("heure invalide"))?;
    let minute: u64 = value
        .get(14..16)
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| transport_failure("minute invalide"))?;
    let second: u64 = value
        .get(17..19)
        .and_then(|part| part.parse().ok())
        .ok_or_else(|| transport_failure("seconde invalide"))?;
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return Err(transport_failure("date de session invalide"));
    }
    // Jours écoulés depuis l'epoch par algorithme de Howard Hinnant.
    let years = year as i64;
    let months = month as i64;
    let days = day as i64;
    let era = if years >= 0 { years } else { years - 399 } / 400;
    let yoe = years - era * 400;
    let mp = (months + 9) % 12;
    let doy = (153 * mp + 2) / 5 + days - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let epoch_days = era * 146_097 + doe - 719_468;
    let seconds =
        epoch_days * 86_400 + (hour as i64) * 3_600 + (minute as i64) * 60 + second as i64;
    if seconds < 0 {
        return Err(transport_failure("date de session antérieure à l'epoch"));
    }
    Ok(UNIX_EPOCH + Duration::from_secs(seconds as u64))
}

impl DesktopAuthClient {
    pub fn new(
        origin: &str,
        environment: &str,
        installation_id: String,
    ) -> Result<Self, ClientFailure> {
        let parsed =
            reqwest::Url::parse(origin).map_err(|_| transport_failure("origine Punks invalide"))?;
        Ok(Self {
            http: reqwest::Client::builder()
                .build()
                .map_err(|_| transport_failure("client HTTP de cérémonie indisponible"))?,
            origin: parsed.to_string().trim_end_matches('/').to_string(),
            environment: environment.to_string(),
            installation_id,
        })
    }

    fn headers(&self) -> Result<HeaderMap, ClientFailure> {
        let mut headers = HeaderMap::new();
        let origin = HeaderValue::from_str(&self.origin)
            .map_err(|_| transport_failure("origine Punks invalide"))?;
        headers.insert(ORIGIN, origin);
        Ok(headers)
    }

    async fn post_json(
        &self,
        path: &str,
        body: &serde_json::Value,
        cookie: Option<&SessionSecret>,
    ) -> Result<(u16, HeaderMap, serde_json::Value), ClientFailure> {
        let mut headers = self.headers()?;
        if let Some(secret) = cookie {
            let value = HeaderValue::from_str(secret.raw())
                .map_err(|_| transport_failure("cookie de session invalide"))?;
            headers.insert(HeaderName::from_static("cookie"), value);
        }
        let response = self
            .http
            .request(Method::POST, format!("{}{}", self.origin, path))
            .headers(headers)
            .json(body)
            .send()
            .await
            .map_err(|_| transport_failure("requête de cérémonie impossible"))?;
        let status = response.status().as_u16();
        let response_headers = response.headers().clone();
        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|_| transport_failure("réponse de cérémonie illisible"))?;
        Ok((status, response_headers, payload))
    }

    /// Démarre la cérémonie : le Worker répond l'URL d'autorisation
    /// (PKCE/state/verifier détenus par le Worker, ADR 0042).
    pub async fn start(&self, provider: &str) -> Result<DesktopAuthStart, ClientFailure> {
        let body = serde_json::json!({
            "contract": "auth.desktop-start@1",
            "provider": provider,
            "intent": "sign_in",
            "installationId": self.installation_id,
            "environment": self.environment,
        });
        let (status, _, payload) = self
            .post_json("/api/auth/v1/desktop/start", &body, None)
            .await?;
        if status != 201 {
            return Err(transport_failure("démarrage de cérémonie refusé"));
        }
        let parsed: StartShape = serde_json::from_value(payload).map_err(|_| {
            ClientFailure::new(
                FailureKind::ContractViolation,
                "contrat auth.desktop-start-response@1 violé",
            )
        })?;
        Ok(DesktopAuthStart {
            authorization_url: parsed.authorization_url,
            expires_at: parse_iso8601(&parsed.expires_at)?,
        })
    }

    /// Consomme la livraison à usage unique et capture le cookie livré —
    /// jamais loggé, jamais IPC, jamais erreur.
    pub async fn deliver(&self, delivery_token: &str) -> Result<DeliveredSession, ClientFailure> {
        let body = serde_json::json!({
            "contract": "auth.desktop-delivery@1",
            "deliveryToken": delivery_token,
            "installationId": self.installation_id,
        });
        let (status, headers, payload) = self
            .post_json("/api/auth/v1/desktop/deliver", &body, None)
            .await?;
        if status != 200 {
            return Err(transport_failure("livraison de session refusée"));
        }
        let session: SessionShape =
            serde_json::from_value(payload.get("session").cloned().ok_or_else(|| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "contrat auth.desktop-session-response@1 violé",
                )
            })?)
            .map_err(|_| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "contrat auth.desktop-session-response@1 violé",
                )
            })?;
        let cookie = extract_session_cookie(&headers)?;
        Ok(DeliveredSession {
            session_id: session.session_id,
            punk_id: session.punk_id,
            expires_at: parse_iso8601(&session.expires_at)?,
            cookie,
        })
    }

    /// Valide le cookie quarantiné : la lecture de session doit réussir.
    pub async fn validate(
        &self,
        cookie: &SessionSecret,
    ) -> Result<DeliveredSession, ClientFailure> {
        let response = self
            .http
            .request(Method::GET, format!("{}/api/auth/v1/session", self.origin))
            .headers(self.headers_with_cookie(cookie)?)
            .send()
            .await
            .map_err(|_| transport_failure("validation de session impossible"))?;
        if response.status().as_u16() != 200 {
            return Err(ClientFailure::new(
                FailureKind::ContractViolation,
                "session livrée invalide",
            ));
        }
        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|_| transport_failure("session livrée illisible"))?;
        let session: SessionShape =
            serde_json::from_value(payload.get("session").cloned().ok_or_else(|| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "contrat auth.session@1 violé",
                )
            })?)
            .map_err(|_| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "contrat auth.session@1 violé",
                )
            })?;
        Ok(DeliveredSession {
            session_id: session.session_id,
            punk_id: session.punk_id,
            expires_at: parse_iso8601(&session.expires_at)?,
            cookie: clone_secret(cookie),
        })
    }

    /// Renouvellement glissant : renvoie la session étendue et le cookie
    /// rafraîchi à re-persister.
    pub async fn renew(&self, cookie: &SessionSecret) -> Result<DeliveredSession, ClientFailure> {
        let body = serde_json::json!({});
        let (status, headers, payload) = self
            .post_json("/api/auth/v1/desktop/session/renew", &body, Some(cookie))
            .await?;
        if status != 200 {
            return Err(transport_failure("renouvellement de session refusé"));
        }
        let session: SessionShape =
            serde_json::from_value(payload.get("session").cloned().ok_or_else(|| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "contrat auth.desktop-session-response@1 violé",
                )
            })?)
            .map_err(|_| {
                ClientFailure::new(
                    FailureKind::ContractViolation,
                    "contrat auth.desktop-session-response@1 violé",
                )
            })?;
        Ok(DeliveredSession {
            session_id: session.session_id,
            punk_id: session.punk_id,
            expires_at: parse_iso8601(&session.expires_at)?,
            cookie: extract_session_cookie(&headers)?,
        })
    }

    /// Révocation distante (best effort ; la file locale reprend sur échec).
    pub async fn revoke(&self, cookie: &SessionSecret) -> Result<(), ClientFailure> {
        let body = serde_json::json!({});
        let (status, _, _) = self
            .post_json("/api/auth/v1/logout", &body, Some(cookie))
            .await?;
        if status != 200 {
            return Err(transport_failure("révocation distante refusée"));
        }
        Ok(())
    }

    fn headers_with_cookie(&self, cookie: &SessionSecret) -> Result<HeaderMap, ClientFailure> {
        let mut headers = self.headers()?;
        let value = HeaderValue::from_str(cookie.raw())
            .map_err(|_| transport_failure("cookie de session invalide"))?;
        headers.insert(HeaderName::from_static("cookie"), value);
        Ok(headers)
    }
}

fn clone_secret(secret: &SessionSecret) -> SessionSecret {
    SessionSecret::from_cookie_header(secret.raw())
}

fn extract_session_cookie(headers: &HeaderMap) -> Result<SessionSecret, ClientFailure> {
    for value in headers.get_all(reqwest::header::SET_COOKIE) {
        let raw = value
            .to_str()
            .map_err(|_| transport_failure("cookie de session illisible"))?;
        for prefix in [SESSION_COOKIE_PREFIX, LOCAL_SESSION_COOKIE_PREFIX] {
            if let Some(rest) = raw.strip_prefix(prefix) {
                let token = rest.split(';').next().unwrap_or("").trim();
                if token.len() >= 32 {
                    return Ok(SessionSecret::from_cookie_header(&format!(
                        "{}{}",
                        prefix, token
                    )));
                }
            }
        }
    }
    Err(transport_failure(
        "cookie de session absent de la livraison",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_dates_iso_sont_analysees() {
        let parsed = parse_iso8601("2026-08-23T01:00:00Z").expect("date valide");
        assert_eq!(crate::ceremony::unix_seconds(parsed), 1_787_446_800);
        assert!(parse_iso8601("pas-une-date").is_err());
        assert!(parse_iso8601("2026-13-40T99:00:00Z").is_err());
    }

    #[test]
    fn le_prefixe_local_est_reconnu() {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::SET_COOKIE,
            HeaderValue::from_static(
                "punks_session_dev=abcdefghijklmnopqrstuvwxyz012345; Path=/; Max-Age=3600",
            ),
        );
        let secret = extract_session_cookie(&headers).expect("cookie local");
        assert!(secret.raw().starts_with("punks_session_dev="));
        assert!(!format!("{secret:?}").contains("abcdefghijklmnopqrstuvwxyz012345"));
    }

    #[test]
    fn un_cookie_trop_court_est_refuse() {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::SET_COOKIE,
            HeaderValue::from_static("__Host-punks_session=court; Path=/"),
        );
        assert!(extract_session_cookie(&headers).is_err());
    }
}
