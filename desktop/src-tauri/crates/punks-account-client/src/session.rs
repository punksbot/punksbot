use reqwest::{cookie::CookieStore, header::HeaderValue};

use super::{
    validate_navigation_url, AccountSession, ClientFailure, FailureKind, PunksAccountClient,
    PunksNavigationTarget, Transport,
};

impl PunksAccountClient {
    /// Installs a native-only Session cookie into this account's private jar.
    ///
    /// The cookie is accepted only by the HTTP transport owned by this client;
    /// test transports and the renderer have no path to this operation.
    pub fn install_session_secret(
        &self,
        secret: &super::ceremony::SessionSecret,
    ) -> Result<(), ClientFailure> {
        #[cfg(not(test))]
        let Transport::Http(transport) = &self.inner.transport;
        #[cfg(test)]
        let transport = match &self.inner.transport {
            Transport::Http(transport) => transport,
            Transport::Test(_) => {
                return Err(ClientFailure::contract("auth.session-native@1"));
            }
        };
        let header = HeaderValue::from_str(secret.raw()).map_err(|_| {
            ClientFailure::new(FailureKind::ContractViolation, "Session cookie is invalid")
        })?;
        let mut headers = std::iter::once(&header);
        transport.jar.set_cookies(&mut headers, &transport.origin);
        Ok(())
    }

    /// Bascule atomiquement la génération locale vers une Session préparée.
    ///
    /// Le caller doit avoir validé puis persisté/relu la Session dans le
    /// coffre OS. Cette couture détruit toutes les vues et leases Account /
    /// Workspace avant d'installer le nouveau cookie ; le Worker maintient la
    /// frontière collaborative fermée jusqu'à `desktop-auth.confirm@1`.
    pub async fn activate_prepared_session(
        &self,
        secret: &super::ceremony::SessionSecret,
    ) -> Result<(), ClientFailure> {
        self.require_compatible().await?;
        {
            let mut state = self.inner.state.lock().await;
            state.session = None;
            state.workspaces.clear();
            state.active_lease = None;
            state.generation = state.generation.saturating_add(1);
        }
        self.clear_session_cookie();
        self.install_session_secret(secret)
    }

    /// Destroys the Account/Workspace generation and native cookie while
    /// retaining the already-proven distribution compatibility. This lets a
    /// signed-out Punk start a fresh ceremony without remounting a Workspace.
    pub async fn clear_account_session(&self) {
        {
            let mut state = self.inner.state.lock().await;
            state.session = None;
            state.workspaces.clear();
            state.active_lease = None;
            state.generation = state.generation.saturating_add(1);
        }
        self.clear_session_cookie();
    }

    /// Validates a renderer navigation against this client's configured
    /// distribution origin.  The compatibility response is already required
    /// to match this origin before the social surface mounts.
    pub fn validate_navigation(
        &self,
        raw_url: &str,
    ) -> Result<PunksNavigationTarget, ClientFailure> {
        validate_navigation_url(raw_url, &self.inner.origin)
    }

    /// Restores a persisted Session, reauthorizes it against the server, and
    /// rejects a cookie whose authoritative identity differs from its native
    /// metadata.  The metadata is an anti-mix-up check, never an authority.
    pub async fn restore_session(
        &self,
        secret: &super::ceremony::SessionSecret,
        metadata: &super::ceremony::SessionMetadata,
    ) -> Result<AccountSession, ClientFailure> {
        self.require_compatible().await?;
        if metadata.expires_at <= std::time::SystemTime::now() {
            self.clear_account_session().await;
            return Err(ClientFailure::new(
                FailureKind::SessionExpired,
                "Punks Account Session has expired",
            ));
        }
        self.install_session_secret(secret)?;
        let session = match self.get_session().await {
            Ok(session) => session,
            Err(error) => {
                if matches!(error.kind, FailureKind::SessionExpired) {
                    self.clear_account_session().await;
                }
                return Err(error);
            }
        };
        if session.session_id != metadata.session_id || session.punk_id != metadata.punk_id {
            self.clear_account_session().await;
            return Err(ClientFailure::new(
                FailureKind::SessionExpired,
                "Persisted Punks Session belongs to another Account",
            ));
        }
        Ok(session)
    }

    /// Invalidates the current Account and every generation-bound Workspace.
    /// This is synchronous with respect to the state mutex: a later I/O call
    /// cannot pass `assert_current` after this method returns.
    pub async fn invalidate(&self) {
        let mut state = self.inner.state.lock().await;
        state.compatibility = None;
        state.session = None;
        state.workspaces.clear();
        state.active_lease = None;
        state.generation = state.generation.saturating_add(1);
        drop(state);
        self.clear_session_cookie();
    }

    fn clear_session_cookie(&self) {
        #[cfg(not(test))]
        let Transport::Http(transport) = &self.inner.transport;
        #[cfg(test)]
        let transport = match &self.inner.transport {
            Transport::Http(transport) => transport,
            Transport::Test(_) => return,
        };
        for name in ["__Host-punks_session", "punks_session_dev"] {
            let Ok(header) = HeaderValue::from_str(&format!("{name}=; Max-Age=0; Path=/")) else {
                continue;
            };
            let mut headers = std::iter::once(&header);
            transport.jar.set_cookies(&mut headers, &transport.origin);
        }
    }
}
