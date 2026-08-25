use base64::Engine;
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Moyen de connexion présenté dans le navigateur système.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationMethod {
    Google,
    Github,
    Passkey,
}

impl AuthenticationMethod {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Google => "google",
            Self::Github => "github",
            Self::Passkey => "passkey",
        }
    }
}

impl TryFrom<&str> for AuthenticationMethod {
    type Error = String;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "google" => Ok(Self::Google),
            "github" => Ok(Self::Github),
            "passkey" => Ok(Self::Passkey),
            _ => Err("authentication method is not supported".to_string()),
        }
    }
}

/// Intentions sémantiques fermées de `desktop-auth.start@1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingAuthIntent {
    SignIn,
    SwitchAccount,
    Reauthenticate,
    LinkGoogle,
    LinkGithub,
    RegisterPasskey,
}

impl PendingAuthIntent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::SignIn => "sign_in",
            Self::SwitchAccount => "switch_account",
            Self::Reauthenticate => "reauthenticate",
            Self::LinkGoogle => "link_google",
            Self::LinkGithub => "link_github",
            Self::RegisterPasskey => "register_passkey",
        }
    }
}

/// Phase durable assainie d'un flow, indépendante de la machine en mémoire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PendingAuthPhase {
    Started,
    BrowserComplete,
    Ready,
    Delivering,
    Confirmed,
    Cancelled,
    Expired,
}

/// Cookie de Session détenu exclusivement par Rust.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SessionSecret(String);

impl SessionSecret {
    pub fn from_cookie_header(value: &str) -> Self {
        Self(value.to_string())
    }

    pub fn raw(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SessionSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionSecret(<redacted>)")
    }
}

impl fmt::Display for SessionSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionSecret(<redacted>)")
    }
}

/// Capacité minimale qui peut uniquement révoquer une Session précise.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct RevocationSecret(String);

impl RevocationSecret {
    pub fn from_token(value: &str) -> Result<Self, String> {
        if !(43..=128).contains(&value.len())
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        {
            return Err("revocation capability is invalid".to_string());
        }
        Ok(Self(value.to_string()))
    }

    pub fn raw(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for RevocationSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RevocationSecret(<redacted>)")
    }
}

impl fmt::Display for RevocationSecret {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RevocationSecret(<redacted>)")
    }
}

/// Preuve native éphémère de 256 bits qui lie un flow à Rust.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct NativeVerifier([u8; 32]);

impl NativeVerifier {
    pub fn generate() -> Result<Self, String> {
        let mut bytes = [0_u8; 32];
        getrandom::getrandom(&mut bytes)
            .map_err(|_| "native authentication entropy is unavailable".to_string())?;
        Ok(Self(bytes))
    }

    pub fn decode(encoded: &str) -> Result<Self, String> {
        if encoded.len() != 43 || encoded.contains('=') {
            return Err("native verifier must be 256-bit base64url".to_string());
        }
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| "native verifier is invalid base64url".to_string())?;
        let bytes: [u8; 32] = decoded
            .try_into()
            .map_err(|_| "native verifier must be 256 bits".to_string())?;
        Ok(Self(bytes))
    }

    pub fn encoded(&self) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(self.0)
    }

    pub fn commitment(&self) -> String {
        let encoded = self.encoded();
        let mut digest = Sha256::new();
        // PKCE S256 over the exact base64url verifier transported by claim /
        // confirm. The Worker stores only this commitment.
        digest.update(encoded.as_bytes());
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(digest.finalize())
    }

    #[cfg(test)]
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}

impl fmt::Debug for NativeVerifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NativeVerifier(<redacted>)")
    }
}

impl fmt::Display for NativeVerifier {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("NativeVerifier(<redacted>)")
    }
}
