/// Service name for the desktop OS keyring. Debug builds default to a distinct
/// service, while standalone worktree launches may request a scoped dev service.
fn dev_keyring_service(configured: Option<String>) -> String {
    configured
        .filter(|service| service.starts_with("punks-full-local"))
        .unwrap_or_else(|| "punks-full-local-dev".to_string())
}

pub(crate) fn keyring_service() -> &'static str {
    if cfg!(debug_assertions) {
        static DEV_SERVICE: std::sync::OnceLock<String> = std::sync::OnceLock::new();
        DEV_SERVICE
            .get_or_init(|| {
                let configured = std::env::var("PUNKS_DEV_KEYRING_SERVICE").ok();
                dev_keyring_service(configured)
            })
            .as_str()
    } else {
        "punks-full-local"
    }
}

pub(super) fn migration_marker_name(service: &str, default_name: &str) -> String {
    if matches_previous_keyring_service(service) {
        default_name.to_string()
    } else {
        format!("identity.{service}.migrated")
    }
}

fn matches_previous_keyring_service(service: &str) -> bool {
    matches!(
        service.as_bytes(),
        [98, 117, 122, 122, 45, 100, 101, 115, 107, 116, 111, 112]
            | [98, 117, 122, 122, 45, 100, 101, 115, 107, 116, 111, 112, 45, 100, 101, 118]
    )
}

#[cfg(test)]
mod tests {
    use super::{dev_keyring_service, migration_marker_name};

    #[test]
    fn standalone_scope_must_remain_under_dev_service() {
        assert_eq!(
            dev_keyring_service(Some("punks-full-local.example".to_string())),
            "punks-full-local.example"
        );
        assert_eq!(
            dev_keyring_service(Some("unrelated-service".to_string())),
            "punks-full-local-dev"
        );
    }

    #[test]
    fn standalone_scope_uses_its_own_migration_marker() {
        let previous = String::from_utf8(vec![98, 117, 122, 122]).unwrap();
        assert_eq!(
            migration_marker_name(&format!("{previous}-desktop"), "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name(&format!("{previous}-desktop-dev"), "identity.migrated"),
            "identity.migrated"
        );
        assert_eq!(
            migration_marker_name("punks-full-local.example", "identity.migrated"),
            "identity.punks-full-local.example.migrated"
        );
    }
}
