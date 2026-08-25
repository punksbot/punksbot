use base64::Engine;
use sha2::{Digest, Sha256};
use std::fmt;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Compile-time Punks distribution identity shared by native boundaries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompiledPunksEnvironment {
    Local,
    Staging,
    Production,
}

/// Error returned when a build selects an unknown Punks distribution.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CompiledEnvironmentError;

impl fmt::Display for CompiledEnvironmentError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("unknown compiled Punks environment")
    }
}

impl std::error::Error for CompiledEnvironmentError {}

impl CompiledPunksEnvironment {
    /// Resolves the immutable distribution selected by the build environment.
    pub fn current() -> Result<Self, CompiledEnvironmentError> {
        Self::from_build_value(option_env!("PUNKS_DISTRIBUTION"))
    }

    /// Parses only the three supported compile-time distribution values.
    pub fn from_build_value(value: Option<&str>) -> Result<Self, CompiledEnvironmentError> {
        match value {
            Some("production") => Ok(Self::Production),
            Some("staging") => Ok(Self::Staging),
            None | Some("development") => Ok(Self::Local),
            Some(_) => Err(CompiledEnvironmentError),
        }
    }

    /// Returns the exact Worker environment header value.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Local => "local",
            Self::Staging => "staging",
            Self::Production => "production",
        }
    }

    /// Returns the distribution-specific native completion scheme.
    pub const fn deep_link_scheme(self) -> &'static str {
        match self {
            Self::Local => "punks-local",
            Self::Staging => "punks-staging",
            Self::Production => "punks",
        }
    }

    /// Returns the isolated operating-system credential namespace.
    pub const fn keyring_service(self) -> &'static str {
        match self {
            Self::Local => "punks-desktop-development",
            Self::Staging => "punks-desktop-staging",
            Self::Production => "punks-desktop",
        }
    }
}

/// Moyen de connexion présenté dans le navigateur système.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthenticationMethod {
    /// Authentification Google OAuth dans le navigateur système.
    Google,
    /// Authentification GitHub OAuth dans le navigateur système.
    Github,
    /// Authentification ou enregistrement WebAuthn dans le navigateur système.
    Passkey,
}

impl AuthenticationMethod {
    /// Returns the canonical wire spelling.
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
    /// Ouvre une première Session de Compte Punks.
    SignIn,
    /// Remplace explicitement la Session d'un Compte Punks connecté.
    SwitchAccount,
    /// Prouve à nouveau un Moyen déjà lié pour une opération sensible.
    Reauthenticate,
    /// Lie une identité Google après réauthentification ciblée.
    LinkGoogle,
    /// Lie une identité GitHub après réauthentification ciblée.
    LinkGithub,
    /// Enregistre une passkey après réauthentification ciblée.
    RegisterPasskey,
}

impl PendingAuthIntent {
    /// Returns the canonical wire spelling.
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
    /// Le flow existe et attend le parcours navigateur.
    Started,
    /// Le navigateur a produit un résultat qui exige encore une décision.
    BrowserComplete,
    /// Le résultat est prêt à être réclamé par le client natif.
    Ready,
    /// La livraison native est préparée et attend sa confirmation.
    Delivering,
    /// La livraison et ses effets sont confirmés côté serveur.
    Confirmed,
    /// Le Punk ou une nouvelle cérémonie a annulé le flow.
    Cancelled,
    /// Le flow a dépassé sa borne temporelle.
    Expired,
}

/// Cookie de Session détenu exclusivement par Rust.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct SessionSecret(String);

impl SessionSecret {
    /// Captures a complete native Cookie request header value.
    pub fn from_cookie_header(value: &str) -> Self {
        Self(value.to_string())
    }

    /// Borrows the secret only inside native HTTP or secure-storage code.
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
    /// Validates and captures a bounded base64url revoke-only token.
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

    /// Borrows the capability only for native revocation or secure storage.
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
    /// Generates exactly 256 bits from the operating-system CSPRNG.
    pub fn generate() -> Result<Self, String> {
        let mut bytes = [0_u8; 32];
        getrandom::getrandom(&mut bytes)
            .map_err(|_| "native authentication entropy is unavailable".to_string())?;
        Ok(Self(bytes))
    }

    /// Restores an exact unpadded 256-bit base64url verifier.
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

    /// Encodes the verifier for claim/confirm and secure storage.
    pub fn encoded(&self) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(self.0)
    }

    /// Returns the PKCE S256 commitment sent at flow start.
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
