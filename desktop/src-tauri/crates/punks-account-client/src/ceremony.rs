//! Cérémonie de connexion desktop (issue #54).
//!
//! Machine à états `started → browser_complete → ready → delivering →
//! confirmed` avec annulation et expiration explicites ; jar de quarantaine
//! pour la livraison du cookie de Session ; renouvellement glissant
//! (30 jours, seuil de 7 jours, une fois par 24 heures) ; déconnexion
//! local-first avec révocation distante en file sécurisée.
//!
//! Le cookie de Session ne traverse jamais la frontière de cette crate sous
//! une forme observable : [`SessionSecret`] masque son contenu dans `Debug`,
//! `Display`, les erreurs et les sérialisations, et vit exclusivement dans le
//! jar natif.

use std::fmt;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub use crate::native_auth::{
    AuthenticationMethod, CompiledEnvironmentError, CompiledPunksEnvironment, NativeVerifier,
    PendingAuthIntent, PendingAuthPhase, RevocationSecret, SessionSecret,
};

/// TTL d'une transaction OAuth Google/GitHub côté Worker (10 minutes).
pub const CEREMONY_START_TTL: Duration = Duration::from_secs(10 * 60);
/// Délai de réclamation après la fin du navigateur (5 minutes).
pub const DELIVERY_READY_TTL: Duration = Duration::from_secs(5 * 60);
/// Délai de confirmation après la première réclamation (10 minutes).
pub const DELIVERY_IN_PROGRESS_TTL: Duration = Duration::from_secs(10 * 60);
/// Plafond absolu après la fin du navigateur (20 minutes).
pub const POST_BROWSER_MAX_TTL: Duration = Duration::from_secs(20 * 60);
/// Fenêtre de renouvellement glissant : 30 jours.
pub const RENEWAL_TTL: Duration = Duration::from_secs(30 * 24 * 3_600);
/// Seuil de renouvellement : il reste moins de 7 jours.
pub const RENEWAL_THRESHOLD: Duration = Duration::from_secs(7 * 24 * 3_600);
/// Limite de renouvellement : une fois par 24 heures.
pub const RENEWAL_MIN_INTERVAL: Duration = Duration::from_secs(24 * 3_600);

/// Horloge injectable pour des tests déterministes.
pub trait CeremonyClock {
    fn now(&self) -> SystemTime;
}

/// Horloge système réelle.
#[derive(Default, Debug, Clone, Copy)]
pub struct SystemClock;

impl CeremonyClock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}

/// Persistance du jar de Session en stockage sécurisé OS. L'application
/// implémente ce trait au-dessus de son SecretStore ; la crate n'expose
/// jamais la valeur hors de ces frontières contrôlées.
pub trait SessionPersistence: Send + Sync {
    fn persist(&self, secret: &SessionSecret, metadata: &SessionMetadata) -> Result<(), String>;
    /// Restitue le jar persisté au démarrage — natif uniquement, jamais IPC.
    fn load(&self) -> Result<Option<(SessionSecret, SessionMetadata)>, String>;
    fn destroy(&self) -> Result<(), String>;
}

/// File de révocation distante durable : la déconnexion détruit d'abord
/// l'état local, puis met la révocation en file — même hors ligne.
pub trait RevocationQueue: Send + Sync {
    fn enqueue(&self, pending: PendingRevocation) -> Result<(), String>;
}

#[derive(Debug)]
pub struct PendingRevocation {
    pub session_id: String,
    pub capability: RevocationCapability,
    pub queued_at: SystemTime,
}

/// Capacité de révocation et sa borne d'utilisation, stockées ensemble dans
/// le coffre sécurisé mais jamais dans l'état de Session actif.
#[derive(Debug)]
pub struct RevocationCapability {
    pub secret: RevocationSecret,
    pub expires_at: SystemTime,
}

/// Métadonnées de session persistées à côté du secret (jamais le cookie).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMetadata {
    pub session_id: String,
    pub punk_id: String,
    pub expires_at: SystemTime,
    pub last_renewed_at: Option<SystemTime>,
}

/// Phase publique de la cérémonie — la seule forme qui traverse l'IPC.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CeremonyPhase {
    /// Aucune cérémonie en cours.
    Idle,
    /// La transaction est démarrée ; le navigateur système est ouvert.
    Started {
        provider: String,
        expires_at: SystemTime,
    },
    /// Le deeplink d'environnement a signalé la fin du navigateur.
    BrowserComplete {
        expires_at: SystemTime,
        post_browser_deadline: SystemTime,
    },
    /// Le résultat navigateur est prêt à être réclamé.
    Ready {
        expires_at: SystemTime,
        post_browser_deadline: SystemTime,
    },
    /// La livraison est en cours de validation et de persistance natives.
    Delivering { expires_at: SystemTime },
    /// Session confirmée, persistée et promue dans le jar actif.
    Confirmed { session_id: String },
    /// Annulation explicite du Punk.
    Cancelled,
    /// Expiration explicite de la transaction ou de la livraison.
    Expired,
    /// Échec terminal (PKCE/state invalides, mauvaise origine, rejeu…).
    Failed { reason: CeremonyFailure },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CeremonyFailure {
    InvalidOrigin,
    InvalidDeliveryToken,
    DeliveryConsumed,
    DeliveryExpired,
    InstallationMismatch,
    ProviderError,
    ValidationFailed,
    TransportError,
}

impl CeremonyFailure {
    pub fn code(&self) -> &'static str {
        match self {
            CeremonyFailure::InvalidOrigin => "invalid_origin",
            CeremonyFailure::InvalidDeliveryToken => "invalid_delivery_token",
            CeremonyFailure::DeliveryConsumed => "delivery_consumed",
            CeremonyFailure::DeliveryExpired => "delivery_expired",
            CeremonyFailure::InstallationMismatch => "installation_mismatch",
            CeremonyFailure::ProviderError => "provider_error",
            CeremonyFailure::ValidationFailed => "validation_failed",
            CeremonyFailure::TransportError => "transport_error",
        }
    }
}

/// La cérémonie unique, pilotée par le client natif.
pub struct Ceremony {
    phase: CeremonyPhase,
    clock: std::sync::Arc<dyn CeremonyClock + Send + Sync>,
}

impl Ceremony {
    pub fn new(clock: std::sync::Arc<dyn CeremonyClock + Send + Sync>) -> Self {
        Self {
            phase: CeremonyPhase::Idle,
            clock,
        }
    }

    pub fn phase(&self) -> &CeremonyPhase {
        &self.phase
    }

    /// `Idle → Started` : enregistre la transaction démarrée côté Worker.
    pub fn start(&mut self, provider: &str) -> Result<(), &'static str> {
        if provider != "google" && provider != "github" {
            return Err("moyen de connexion non pris en charge");
        }
        match &self.phase {
            CeremonyPhase::Idle
            | CeremonyPhase::Confirmed { .. }
            | CeremonyPhase::Cancelled
            | CeremonyPhase::Expired
            | CeremonyPhase::Failed { .. } => {
                self.phase = CeremonyPhase::Started {
                    provider: provider.to_string(),
                    expires_at: self.clock.now() + CEREMONY_START_TTL,
                };
                Ok(())
            }
            _ => Err("une cérémonie est déjà en cours"),
        }
    }

    /// `Started → BrowserComplete` : le deeplink d'environnement est arrivé.
    pub fn browser_complete(
        &mut self,
        environment: &str,
        expected_environment: &str,
    ) -> Result<(), CeremonyFailure> {
        let expires_at = match &self.phase {
            CeremonyPhase::Started { expires_at, .. } => *expires_at,
            CeremonyPhase::Idle | CeremonyPhase::Cancelled | CeremonyPhase::Expired => {
                return Err(CeremonyFailure::InvalidDeliveryToken);
            }
            _ => return Err(CeremonyFailure::InvalidDeliveryToken),
        };
        if environment != expected_environment {
            return Err(CeremonyFailure::InvalidOrigin);
        }
        if self.clock.now() >= expires_at {
            self.phase = CeremonyPhase::Expired;
            return Err(CeremonyFailure::DeliveryExpired);
        }
        let now = self.clock.now();
        self.phase = CeremonyPhase::BrowserComplete {
            expires_at: now + DELIVERY_READY_TTL,
            post_browser_deadline: now + POST_BROWSER_MAX_TTL,
        };
        Ok(())
    }

    /// `BrowserComplete → Ready` : le résultat navigateur peut être réclamé.
    pub fn ready(&mut self) -> Result<(), CeremonyFailure> {
        match &self.phase {
            CeremonyPhase::BrowserComplete {
                expires_at,
                post_browser_deadline,
            } => {
                let expires_at = *expires_at;
                if self.clock.now() >= expires_at {
                    self.phase = CeremonyPhase::Expired;
                    return Err(CeremonyFailure::DeliveryExpired);
                }
                self.phase = CeremonyPhase::Ready {
                    expires_at,
                    post_browser_deadline: *post_browser_deadline,
                };
                Ok(())
            }
            _ => Err(CeremonyFailure::InvalidDeliveryToken),
        }
    }

    /// `Ready → Delivering` : la réclamation idempotente commence.
    pub fn begin_delivery(&mut self) -> Result<(), CeremonyFailure> {
        match &self.phase {
            CeremonyPhase::Ready {
                expires_at,
                post_browser_deadline,
            } => {
                let now = self.clock.now();
                if now >= *expires_at || now >= *post_browser_deadline {
                    self.phase = CeremonyPhase::Expired;
                    return Err(CeremonyFailure::DeliveryExpired);
                }
                self.phase = CeremonyPhase::Delivering {
                    expires_at: std::cmp::min(
                        now + DELIVERY_IN_PROGRESS_TTL,
                        *post_browser_deadline,
                    ),
                };
                Ok(())
            }
            _ => Err(CeremonyFailure::InvalidDeliveryToken),
        }
    }

    /// `Delivering → Confirmed` : persistance OS relue, génération basculée
    /// et confirmation serveur acquittée.
    pub fn confirm(&mut self, session_id: &str) -> Result<(), CeremonyFailure> {
        match &self.phase {
            CeremonyPhase::Delivering { expires_at } if self.clock.now() < *expires_at => {
                self.phase = CeremonyPhase::Confirmed {
                    session_id: session_id.to_string(),
                };
                Ok(())
            }
            CeremonyPhase::Delivering { .. } => {
                self.phase = CeremonyPhase::Expired;
                Err(CeremonyFailure::DeliveryExpired)
            }
            _ => Err(CeremonyFailure::ValidationFailed),
        }
    }

    /// Échec terminal explicite.
    pub fn fail(&mut self, reason: CeremonyFailure) {
        self.phase = CeremonyPhase::Failed { reason };
    }

    /// Annulation explicite : la cérémonie se ferme sans créer de session.
    pub fn cancel(&mut self) -> Result<(), &'static str> {
        match &self.phase {
            CeremonyPhase::Started { .. }
            | CeremonyPhase::BrowserComplete { .. }
            | CeremonyPhase::Ready { .. }
            | CeremonyPhase::Delivering { .. } => {
                self.phase = CeremonyPhase::Cancelled;
                Ok(())
            }
            _ => Err("aucune cérémonie à annuler"),
        }
    }

    /// Expiration explicite de la transaction en cours, si elle est dépassée.
    pub fn expire_if_due(&mut self) -> bool {
        let expired = match &self.phase {
            CeremonyPhase::Started { expires_at, .. } => self.clock.now() >= *expires_at,
            CeremonyPhase::BrowserComplete { expires_at, .. }
            | CeremonyPhase::Ready { expires_at, .. }
            | CeremonyPhase::Delivering { expires_at } => self.clock.now() >= *expires_at,
            _ => false,
        };
        if expired {
            self.phase = CeremonyPhase::Expired;
        }
        expired
    }
}

/// Jar de quarantaine : le cookie livré y vit isolé jusqu'à validation,
/// persistance et promotion. Aucun accès au contenu n'est sérialisable.
pub struct QuarantineJar {
    secret: Option<SessionSecret>,
}

impl QuarantineJar {
    pub fn new() -> Self {
        Self { secret: None }
    }

    /// Dépose le cookie livré en quarantaine. Jamais loggé, jamais IPC.
    pub fn deposit(&mut self, secret: SessionSecret) {
        self.secret = Some(secret);
    }

    pub fn is_empty(&self) -> bool {
        self.secret.is_none()
    }

    /// Valide puis persiste le cookie quarantiné ; la promotion ne peut
    /// avoir lieu que si la validation (lecture de session) a réussi.
    pub fn validate_and_persist(
        &mut self,
        persistence: &dyn SessionPersistence,
        metadata: &SessionMetadata,
    ) -> Result<(), CeremonyFailure> {
        let secret = match self.secret.take() {
            Some(secret) => secret,
            None => return Err(CeremonyFailure::ValidationFailed),
        };
        match persistence.persist(&secret, metadata) {
            Ok(()) => Ok(()),
            Err(_) => Err(CeremonyFailure::ValidationFailed),
        }
    }

    /// Accès scopé en lecture au secret quaranténé : la fermeture reçoit
    /// le cookie sans qu'il quitte la frontière natif.
    pub fn with_secret<R>(&self, f: impl FnOnce(&SessionSecret) -> R) -> Option<R> {
        self.secret.as_ref().map(f)
    }

    /// Retire le secret quaranténé par transfert de propriété : la
    /// validation puis la persistance s'exécutent sur la valeur détenue,
    /// sans jamais la copier hors du natif.
    pub fn take_secret(&mut self) -> Option<SessionSecret> {
        self.secret.take()
    }

    /// Détruit le contenu quarantainé sans jamais le promouvoir.
    pub fn discard(&mut self) {
        self.secret = None;
    }
}

impl Default for QuarantineJar {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Debug for QuarantineJar {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("QuarantineJar(<redacted>)")
    }
}

/// Politique de renouvellement glissant côté client.
#[derive(Debug, Default, Clone, Copy)]
pub struct RenewalPolicy;

impl RenewalPolicy {
    /// Renouveler seulement si l'expiration restante est sous le seuil de
    /// 7 jours et si le dernier renouvellement respecte 24 heures.
    pub fn should_renew(
        &self,
        now: SystemTime,
        expires_at: SystemTime,
        last_renewed_at: Option<SystemTime>,
    ) -> bool {
        if expires_at <= now {
            // Une session expirée ne se renouvelle pas : nouvelle cérémonie.
            return false;
        }
        let remaining = expires_at.duration_since(now).unwrap_or(Duration::ZERO);
        if remaining >= RENEWAL_THRESHOLD {
            return false;
        }
        match last_renewed_at {
            None => true,
            Some(last) => now
                .duration_since(last)
                .map(|elapsed| elapsed >= RENEWAL_MIN_INTERVAL)
                .unwrap_or(false),
        }
    }
}

/// Résultat local-first de la déconnexion.
#[derive(Debug, PartialEq, Eq)]
pub enum LogoutOutcome {
    /// État local détruit et révocation distante envoyée immédiatement.
    Revoked,
    /// État local détruit ; révocation mise en file (hors ligne ou échec).
    Queued,
}

/// Déconnexion local-first : détruit d'abord l'état local (jar + stockage
/// OS), puis tente la révocation distante ; en cas d'échec, la révocation
/// part en file durable. L'ordre ne peut jamais laisser l'état local vivant
/// avec une révocation perdue.
pub async fn logout_local_first<F>(
    persistence: &dyn SessionPersistence,
    queue: &dyn RevocationQueue,
    metadata: &SessionMetadata,
    capability: RevocationCapability,
    remote_revoke: F,
) -> Result<LogoutOutcome, String>
where
    F: for<'a> FnOnce(&'a RevocationSecret) -> futures_util::future::BoxFuture<'a, Result<(), ()>>,
{
    // 1. L'état local meurt d'abord, quoi qu'il arrive ensuite.
    persistence.destroy()?;
    // 2. La révocation distante est tentée, puis mise en file sur échec.
    match remote_revoke(&capability.secret).await {
        Ok(()) => Ok(LogoutOutcome::Revoked),
        Err(()) => queue
            .enqueue(PendingRevocation {
                session_id: metadata.session_id.clone(),
                capability,
                queued_at: SystemTime::now(),
            })
            .map(|_| LogoutOutcome::Queued),
    }
}

/// Convertit un `SystemTime` en secondes UNIX (utilitaire de test).
pub fn unix_seconds(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct FixedClock(SystemTime);

    impl CeremonyClock for FixedClock {
        fn now(&self) -> SystemTime {
            self.0
        }
    }

    struct AdvancingClock(std::sync::Mutex<SystemTime>);

    impl AdvancingClock {
        fn at(time: SystemTime) -> std::sync::Arc<Self> {
            std::sync::Arc::new(Self(std::sync::Mutex::new(time)))
        }

        fn advance(&self, delta: Duration) {
            *self.0.lock().unwrap() += delta;
        }
    }

    impl CeremonyClock for AdvancingClock {
        fn now(&self) -> SystemTime {
            *self.0.lock().unwrap()
        }
    }

    fn ceremony_at(time: SystemTime) -> Ceremony {
        Ceremony::new(std::sync::Arc::new(FixedClock(time)))
    }

    fn now() -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000)
    }

    #[test]
    fn la_ceremonie_suit_ses_cinq_etats_sans_saut() {
        let mut ceremony = ceremony_at(now());
        assert_eq!(ceremony.phase(), &CeremonyPhase::Idle);

        ceremony.start("google").expect("start");
        assert!(matches!(ceremony.phase(), CeremonyPhase::Started { .. }));

        ceremony
            .browser_complete("staging", "staging")
            .expect("browser_complete");
        assert!(matches!(
            ceremony.phase(),
            CeremonyPhase::BrowserComplete { .. }
        ));

        ceremony.ready().expect("ready");
        assert!(matches!(ceremony.phase(), CeremonyPhase::Ready { .. }));

        ceremony.begin_delivery().expect("delivering");
        assert!(matches!(ceremony.phase(), CeremonyPhase::Delivering { .. }));

        ceremony.confirm("session-1").expect("confirmed");
        assert_eq!(
            ceremony.phase(),
            &CeremonyPhase::Confirmed {
                session_id: "session-1".to_string()
            }
        );
    }

    #[test]
    fn une_seule_ceremonie_non_terminale_peut_exister() {
        let mut ceremony = ceremony_at(now());
        ceremony.start("google").expect("first start");
        let original = ceremony.phase().clone();

        assert_eq!(
            ceremony
                .start("github")
                .expect_err("second start must fail"),
            "une cérémonie est déjà en cours"
        );
        assert_eq!(ceremony.phase(), &original);
    }

    #[test]
    fn un_mauvais_environnement_refuse_le_browser_complete() {
        let mut ceremony = ceremony_at(now());
        ceremony.start("github").expect("start");
        let err = ceremony
            .browser_complete("local", "staging")
            .expect_err("environnement divergent");
        assert_eq!(err, CeremonyFailure::InvalidOrigin);
    }

    #[test]
    fn la_transaction_expire_explicitement() {
        let clock = AdvancingClock::at(now());
        let mut ceremony = Ceremony::new(clock.clone());
        ceremony.start("google").expect("start");

        // avant le TTL : rien n'expire
        clock.advance(CEREMONY_START_TTL - Duration::from_secs(1));
        assert!(!ceremony.expire_if_due());

        // au-delà du TTL de démarrage : expiration explicite, puis refus
        clock.advance(Duration::from_secs(2));
        assert!(ceremony.expire_if_due());
        assert_eq!(ceremony.phase(), &CeremonyPhase::Expired);
        let err = ceremony
            .browser_complete("staging", "staging")
            .expect_err("expirée");
        assert_eq!(err, CeremonyFailure::InvalidDeliveryToken);

        // L'état ready expire après cinq minutes sans réclamation.
        let clock2 = AdvancingClock::at(now());
        let mut ceremony2 = Ceremony::new(clock2.clone());
        ceremony2.start("google").expect("start");
        ceremony2
            .browser_complete("staging", "staging")
            .expect("browser");
        ceremony2.ready().expect("ready");
        clock2.advance(DELIVERY_READY_TTL + Duration::from_secs(1));
        let err = ceremony2.begin_delivery().expect_err("ready expiré");
        assert_eq!(err, CeremonyFailure::DeliveryExpired);
        assert_eq!(ceremony2.phase(), &CeremonyPhase::Expired);

        // Une livraison réclamée dispose de dix minutes, sans dépasser le
        // plafond de vingt minutes à partir de browser_complete.
        let clock3 = AdvancingClock::at(now());
        let mut ceremony3 = Ceremony::new(clock3.clone());
        ceremony3.start("github").expect("start");
        ceremony3
            .browser_complete("staging", "staging")
            .expect("browser");
        ceremony3.ready().expect("ready");
        ceremony3.begin_delivery().expect("delivering");
        clock3.advance(DELIVERY_IN_PROGRESS_TTL + Duration::from_secs(1));
        assert!(ceremony3.expire_if_due());
        assert_eq!(ceremony3.phase(), &CeremonyPhase::Expired);
    }

    #[test]
    fn l_annulation_referme_la_ceremonie_sans_session() {
        let mut ceremony = ceremony_at(now());
        ceremony.start("google").expect("start");
        ceremony.cancel().expect("cancel");
        assert_eq!(ceremony.phase(), &CeremonyPhase::Cancelled);
        // annuler une cérémonie close est refusé
        assert!(ceremony.cancel().is_err());
    }

    #[test]
    fn la_quarantaine_ne_persiste_qu_apres_validation() {
        struct RecordingPersistence {
            persisted: Mutex<Vec<SessionMetadata>>,
            fail: bool,
        }

        impl SessionPersistence for RecordingPersistence {
            fn persist(
                &self,
                _secret: &SessionSecret,
                metadata: &SessionMetadata,
            ) -> Result<(), String> {
                if self.fail {
                    return Err("keyring indisponible".to_string());
                }
                self.persisted.lock().unwrap().push(metadata.clone());
                Ok(())
            }

            fn load(&self) -> Result<Option<(SessionSecret, SessionMetadata)>, String> {
                Ok(None)
            }

            fn destroy(&self) -> Result<(), String> {
                Ok(())
            }
        }

        let metadata = SessionMetadata {
            session_id: "s".into(),
            punk_id: "p".into(),
            expires_at: now() + RENEWAL_TTL,
            last_renewed_at: None,
        };

        let ok = RecordingPersistence {
            persisted: Mutex::new(Vec::new()),
            fail: false,
        };
        let mut jar = QuarantineJar::new();
        jar.deposit(SessionSecret::from_cookie_header(
            "__Host-punks_session=secret",
        ));
        jar.validate_and_persist(&ok, &metadata).expect("persist");
        assert_eq!(ok.persisted.lock().unwrap().len(), 1);
        assert!(jar.is_empty());

        let broken = RecordingPersistence {
            persisted: Mutex::new(Vec::new()),
            fail: true,
        };
        let mut jar2 = QuarantineJar::new();
        jar2.deposit(SessionSecret::from_cookie_header(
            "__Host-punks_session=secret",
        ));
        let err = jar2
            .validate_and_persist(&broken, &metadata)
            .expect_err("échec attendu");
        assert_eq!(err, CeremonyFailure::ValidationFailed);
        assert!(jar2.is_empty());
    }

    #[test]
    fn le_cookie_est_masque_dans_debug_et_display() {
        let secret = SessionSecret::from_cookie_header("__Host-punks_session=valeur-sensitive");
        assert!(!format!("{secret:?}").contains("valeur-sensitive"));
        assert!(!format!("{secret}").contains("valeur-sensitive"));
        let jar = QuarantineJar::new();
        assert!(!format!("{jar:?}").contains("punks_session"));

        let capability = RevocationSecret::from_token(&"r".repeat(64)).expect("capability");
        assert!(!format!("{capability:?}").contains(&"r".repeat(64)));
        assert!(!format!("{capability}").contains(&"r".repeat(64)));
        assert!(RevocationSecret::from_token("short").is_err());
        assert!(RevocationSecret::from_token(&format!("{}=", "r".repeat(64))).is_err());
    }

    #[test]
    fn le_verificateur_natif_est_opaque_et_son_engagement_est_stable() {
        let verifier = NativeVerifier::from_bytes([0; 32]);

        assert_eq!(verifier.encoded(), "A".repeat(43));
        assert_eq!(
            verifier.commitment(),
            "DwBzhbb51LfusnSGBa_hqYSgo7-j8BTQnip4TOnlzRo"
        );
        assert!(!format!("{verifier:?}").contains(&verifier.encoded()));
        assert!(!format!("{verifier}").contains(&verifier.encoded()));
    }

    #[test]
    fn un_verificateur_natif_decode_exige_exactement_256_bits() {
        assert!(NativeVerifier::decode(&"A".repeat(42)).is_err());
        assert!(NativeVerifier::decode(&"A".repeat(43)).is_ok());
        assert!(NativeVerifier::decode(&format!("{}=", "A".repeat(43))).is_err());
    }

    #[test]
    fn le_renouvellement_respecte_seuil_et_intervalle() {
        let policy = RenewalPolicy;
        let now = SystemTime::UNIX_EPOCH + Duration::from_secs(1_800_000_000);

        // 30 jours restants : pas dû.
        assert!(!policy.should_renew(now, now + RENEWAL_TTL, None));
        // Exactement 7 jours : le seuil strict « moins de 7 jours » n'est pas franchi.
        assert!(!policy.should_renew(now, now + RENEWAL_THRESHOLD, None));
        // 6 jours restants : dû, jamais renouvelé.
        assert!(policy.should_renew(now, now + Duration::from_secs(6 * 24 * 3_600), None));
        // 6 jours restants mais renouvelé il y a 1 heure : trop tôt.
        assert!(!policy.should_renew(
            now,
            now + Duration::from_secs(6 * 24 * 3_600),
            Some(now - Duration::from_secs(3_600))
        ));
        // renouvelé il y a plus de 24 heures : dû.
        assert!(policy.should_renew(
            now,
            now + Duration::from_secs(6 * 24 * 3_600),
            Some(now - RENEWAL_MIN_INTERVAL - Duration::from_secs(1))
        ));
        // expirée : aucun renouvellement.
        assert!(!policy.should_renew(now, now, None));
    }

    struct NullPersistence {
        destroyed: Mutex<bool>,
        fail_destroy: bool,
    }

    impl SessionPersistence for NullPersistence {
        fn persist(&self, _: &SessionSecret, _: &SessionMetadata) -> Result<(), String> {
            Ok(())
        }

        fn load(&self) -> Result<Option<(SessionSecret, SessionMetadata)>, String> {
            Ok(None)
        }

        fn destroy(&self) -> Result<(), String> {
            if self.fail_destroy {
                return Err("impossible de détruire".into());
            }
            *self.destroyed.lock().unwrap() = true;
            Ok(())
        }
    }

    struct MemoryQueue {
        pending: Mutex<Vec<PendingRevocation>>,
    }

    impl RevocationQueue for MemoryQueue {
        fn enqueue(&self, pending: PendingRevocation) -> Result<(), String> {
            self.pending.lock().unwrap().push(pending);
            Ok(())
        }
    }

    #[tokio::test]
    async fn la_deconnexion_detruit_le_local_avant_toute_revocation() {
        let metadata = SessionMetadata {
            session_id: "session-42".into(),
            punk_id: "punk-1".into(),
            expires_at: now() + RENEWAL_TTL,
            last_renewed_at: None,
        };

        // Révocation distante immédiate réussie.
        let persistence = NullPersistence {
            destroyed: Mutex::new(false),
            fail_destroy: false,
        };
        let queue = MemoryQueue {
            pending: Mutex::new(Vec::new()),
        };
        let outcome = logout_local_first(
            &persistence,
            &queue,
            &metadata,
            revocation_capability(),
            |_| Box::pin(async { Ok(()) }),
        )
        .await
        .unwrap();
        assert_eq!(outcome, LogoutOutcome::Revoked);
        assert!(*persistence.destroyed.lock().unwrap());
        assert!(queue.pending.lock().unwrap().is_empty());

        // Hors ligne : l'état local est détruit, la révocation part en file.
        let persistence = NullPersistence {
            destroyed: Mutex::new(false),
            fail_destroy: false,
        };
        let queue = MemoryQueue {
            pending: Mutex::new(Vec::new()),
        };
        let outcome = logout_local_first(
            &persistence,
            &queue,
            &metadata,
            revocation_capability(),
            |_| Box::pin(async { Err(()) }),
        )
        .await
        .unwrap();
        assert_eq!(outcome, LogoutOutcome::Queued);
        assert!(*persistence.destroyed.lock().unwrap());
        assert_eq!(queue.pending.lock().unwrap().len(), 1);
        assert_eq!(
            queue.pending.lock().unwrap()[0].capability.secret.raw(),
            "r".repeat(64)
        );

        // La destruction locale ne peut pas être contournée par la suite.
        let persistence = NullPersistence {
            destroyed: Mutex::new(false),
            fail_destroy: true,
        };
        let queue = MemoryQueue {
            pending: Mutex::new(Vec::new()),
        };
        let error = logout_local_first(
            &persistence,
            &queue,
            &metadata,
            revocation_capability(),
            |_| Box::pin(async { Ok(()) }),
        )
        .await
        .unwrap_err();
        assert!(!error.is_empty());
        assert!(queue.pending.lock().unwrap().is_empty());
    }

    fn revocation_capability() -> RevocationCapability {
        RevocationCapability {
            secret: RevocationSecret::from_token(&"r".repeat(64)).expect("capability"),
            expires_at: now() + RENEWAL_TTL,
        }
    }
}
