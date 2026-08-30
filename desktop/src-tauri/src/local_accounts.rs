use serde::Serialize;
use tauri::Manager;

const ACCOUNT_KEYRING_SERVICE: &str = "punks-full-local";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAccountInfo {
    id: String,
    pubkey: String,
    display_name: String,
    merged_into: Option<String>,
    active: bool,
    generation: u64,
}

#[cfg(feature = "punks-local")]
fn to_info(record: crate::local_authority::accounts::LocalAccountRecord) -> LocalAccountInfo {
    LocalAccountInfo {
        id: record.id,
        pubkey: record.pubkey,
        display_name: record.display_name,
        merged_into: record.merged_into,
        active: record.active,
        generation: record.generation,
    }
}

#[cfg(feature = "punks-local")]
fn account_secret_name(account_id: &str) -> String {
    format!("account:{account_id}")
}

#[cfg(feature = "punks-local")]
fn account_store() -> crate::secret_store::SecretStore {
    crate::secret_store::SecretStore::keyring(ACCOUNT_KEYRING_SERVICE)
}

#[cfg(feature = "punks-local")]
pub(crate) fn load_account_keys(
    account_id: &str,
    expected_pubkey: &str,
) -> Result<nostr::Keys, String> {
    let secret = account_store()
        .load(&account_secret_name(account_id))?
        .ok_or_else(|| "account identity is unavailable".to_string())?;
    let keys = nostr::Keys::parse(secret.trim())
        .map_err(|error| format!("parse account identity: {error}"))?;
    if keys.public_key().to_hex() != expected_pubkey {
        return Err("account identity does not match its registry record".to_string());
    }
    Ok(keys)
}

#[cfg(feature = "punks-local")]
pub(crate) fn bootstrap(
    _app: &tauri::AppHandle,
    app_state: &crate::app_state::AppState,
    authority: &crate::local_authority::LocalAuthority,
) -> Result<(), String> {
    use nostr::ToBech32;
    let keys = app_state.signing_keys()?;
    let pubkey = keys.public_key().to_hex();
    let account_id = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, pubkey.as_bytes()).to_string();
    authority.register_account(&account_id, &pubkey, "Local Punk")?;
    let accounts = authority.list_accounts()?;
    if !accounts.iter().any(|account| account.active) {
        let generation = accounts.first().map_or(0, |account| account.generation);
        authority.activate_account(&account_id, Some(generation))?;
    }
    let active = authority
        .list_accounts()?
        .into_iter()
        .find(|account| account.active)
        .ok_or_else(|| "active local account is missing during bootstrap".to_string())?;
    if active.pubkey != pubkey {
        let active_keys = load_account_keys(&active.id, &active.pubkey)?;
        *app_state.keys.lock().map_err(|error| error.to_string())? = active_keys;
    }
    let secret_name = account_secret_name(&account_id);
    let secret = keys
        .secret_key()
        .to_bech32()
        .map_err(|error| format!("encode account identity: {error}"))?;
    std::thread::Builder::new()
        .name("punks-keyring-bootstrap".to_string())
        .spawn(move || {
            let store = account_store();
            let result = store.load(&secret_name).and_then(|existing| {
                if existing.is_none() {
                    store.store(&secret_name, &secret)?;
                }
                Ok(())
            });
            if let Err(error) = result {
                eprintln!("punks-accounts: keyring bootstrap deferred: {error}");
            }
        })
        .map_err(|error| format!("start account keyring bootstrap: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn punks_local_list_accounts(app: tauri::AppHandle) -> Result<Vec<LocalAccountInfo>, String> {
    #[cfg(feature = "punks-local")]
    {
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        authority
            .list_accounts()
            .map(|accounts| accounts.into_iter().map(to_info).collect())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_create_account(
    display_name: String,
    app: tauri::AppHandle,
) -> Result<LocalAccountInfo, String> {
    #[cfg(feature = "punks-local")]
    {
        use nostr::ToBech32;
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        let account_id = uuid::Uuid::new_v4().to_string();
        let keys = nostr::Keys::generate();
        let pubkey = keys.public_key().to_hex();
        let secret_name = account_secret_name(&account_id);
        let store = account_store();
        store.store(
            &secret_name,
            &keys
                .secret_key()
                .to_bech32()
                .map_err(|error| format!("encode account identity: {error}"))?,
        )?;
        if let Err(error) = authority.register_account(&account_id, &pubkey, &display_name) {
            let _ = store.delete(&secret_name);
            return Err(error);
        }
        let hub =
            app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>();
        if let Err(error) = hub.onboard_account(&keys, &display_name) {
            if let Some(generation) = authority
                .list_accounts()
                .ok()
                .and_then(|accounts| accounts.first().map(|account| account.generation))
            {
                let _ = authority.delete_account(&account_id, generation);
            }
            let _ = store.delete(&secret_name);
            return Err(error);
        }
        authority
            .list_accounts()?
            .into_iter()
            .find(|account| account.id == account_id)
            .map(to_info)
            .ok_or_else(|| "created account is missing from registry".to_string())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_switch_account(
    account_id: String,
    expected_generation: u64,
    app: tauri::AppHandle,
) -> Result<LocalAccountInfo, String> {
    #[cfg(feature = "punks-local")]
    {
        use std::sync::atomic::Ordering;
        use tauri::Emitter;
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        let record = authority
            .list_accounts()?
            .into_iter()
            .find(|account| account.id == account_id)
            .ok_or_else(|| "account not found".to_string())?;
        if record.merged_into.is_some() {
            return Err("merged account cannot become active".to_string());
        }
        let keys = load_account_keys(&record.id, &record.pubkey)?;
        app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>()
            .onboard_account(&keys, &record.display_name)?;
        let generation = authority.activate_account(&record.id, Some(expected_generation))?;
        let state = app.state::<crate::app_state::AppState>();
        *state.keys.lock().map_err(|error| error.to_string())? = keys;
        state
            .workspace_apply_generation
            .fetch_add(1, Ordering::AcqRel);
        app.emit(
            "punks-local-account-changed",
            serde_json::json!({"accountId": record.id, "generation": generation}),
        )
        .map_err(|error| format!("emit local account change: {error}"))?;
        authority
            .list_accounts()?
            .into_iter()
            .find(|account| account.active)
            .map(to_info)
            .ok_or_else(|| "active account is missing after switch".to_string())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_merge_accounts(
    source_account_id: String,
    target_account_id: String,
    app: tauri::AppHandle,
) -> Result<Vec<LocalAccountInfo>, String> {
    #[cfg(feature = "punks-local")]
    {
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        let accounts = authority.list_accounts()?;
        let source = accounts
            .iter()
            .find(|account| account.id == source_account_id)
            .ok_or_else(|| "source account not found".to_string())?;
        let target = accounts
            .iter()
            .find(|account| account.id == target_account_id)
            .ok_or_else(|| "target account not found".to_string())?;
        if !target.active {
            return Err("target account must be active before merge".to_string());
        }
        if authority.resolve_account_alias(&source.id)? != source.id
            || authority.resolve_account_alias(&target.id)? != target.id
        {
            return Err("only canonical accounts can be merged".to_string());
        }
        let _source_proof = load_account_keys(&source.id, &source.pubkey)?;
        let _target_proof = load_account_keys(&target.id, &target.pubkey)?;
        authority.merge_accounts(&source.id, &target.id)?;
        authority
            .list_accounts()
            .map(|records| records.into_iter().map(to_info).collect())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_rename_account(
    account_id: String,
    display_name: String,
    expected_generation: u64,
    app: tauri::AppHandle,
) -> Result<Vec<LocalAccountInfo>, String> {
    #[cfg(feature = "punks-local")]
    {
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        authority.rename_account(&account_id, &display_name, expected_generation)?;
        authority
            .list_accounts()
            .map(|records| records.into_iter().map(to_info).collect())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub fn punks_local_delete_account(
    account_id: String,
    expected_generation: u64,
    app: tauri::AppHandle,
) -> Result<Vec<LocalAccountInfo>, String> {
    #[cfg(feature = "punks-local")]
    {
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        let account = authority
            .list_accounts()?
            .into_iter()
            .find(|record| record.id == account_id)
            .ok_or_else(|| "account not found".to_string())?;
        if account.active || account.merged_into.is_some() {
            return Err("only an inactive canonical account can be deleted".to_string());
        }
        let secret_name = account_secret_name(&account.id);
        let store = account_store();
        let secret = store
            .load(&secret_name)?
            .ok_or_else(|| "account identity is unavailable".to_string())?;
        store.delete(&secret_name)?;
        if let Err(error) = authority.delete_account(&account.id, expected_generation) {
            store
                .store(&secret_name, &secret)
                .map_err(|restore_error| {
                    format!("{error}; account secret restoration also failed: {restore_error}")
                })?;
            return Err(error);
        }
        authority
            .list_accounts()
            .map(|records| records.into_iter().map(to_info).collect())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub async fn punks_local_import_account(
    password: String,
    display_name: String,
    app: tauri::AppHandle,
) -> Result<Option<LocalAccountInfo>, String> {
    #[cfg(feature = "punks-local")]
    {
        use nostr::ToBech32;
        let path = match crate::commands::export_util::pick_open_path(
            &app,
            "Password-protected Punks account",
            &["ncryptsec"],
        )
        .await?
        {
            Some(path) => path,
            None => return Ok(None),
        };
        let encrypted_backup = tokio::task::spawn_blocking(move || {
            let metadata = std::fs::metadata(&path)
                .map_err(|error| format!("read account backup metadata: {error}"))?;
            if metadata.len() > 64 * 1024 {
                return Err("account backup exceeds 64 KiB".to_string());
            }
            std::fs::read_to_string(path)
                .map(|value| value.trim().to_string())
                .map_err(|error| format!("read account backup: {error}"))
        })
        .await
        .map_err(|error| format!("join local account backup read: {error}"))??;
        crate::key_backup::parse_ncryptsec(&encrypted_backup)?;
        let keys = tokio::task::spawn_blocking(move || {
            let password = zeroize::Zeroizing::new(password);
            crate::key_backup::decrypt_ncryptsec(&encrypted_backup, &password)
        })
        .await
        .map_err(|error| format!("join local account import: {error}"))??;
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        let pubkey = keys.public_key().to_hex();
        if authority
            .list_accounts()?
            .iter()
            .any(|account| account.pubkey == pubkey)
        {
            return Err("this Punk identity is already imported".to_string());
        }
        let account_id = uuid::Uuid::new_v4().to_string();
        let secret_name = account_secret_name(&account_id);
        let store = account_store();
        store.store(
            &secret_name,
            &keys
                .secret_key()
                .to_bech32()
                .map_err(|error| format!("encode imported account identity: {error}"))?,
        )?;
        if let Err(error) = authority.register_account(&account_id, &pubkey, &display_name) {
            let _ = store.delete(&secret_name);
            return Err(error);
        }
        let hub =
            app.state::<std::sync::Arc<crate::local_authority::workspace_hub::LocalAuthorityHub>>();
        if let Err(error) = hub.onboard_account(&keys, &display_name) {
            if let Some(generation) = authority
                .list_accounts()
                .ok()
                .and_then(|accounts| accounts.first().map(|account| account.generation))
            {
                let _ = authority.delete_account(&account_id, generation);
            }
            let _ = store.delete(&secret_name);
            return Err(error);
        }
        authority
            .list_accounts()?
            .into_iter()
            .find(|account| account.id == account_id)
            .map(to_info)
            .map(Some)
            .ok_or_else(|| "imported account is missing from registry".to_string())
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}

#[tauri::command]
pub async fn punks_local_export_account(
    account_id: String,
    password: String,
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    #[cfg(feature = "punks-local")]
    {
        if password.chars().count() < crate::key_backup::MIN_PASSPHRASE_LEN {
            return Err(format!(
                "passphrase must be at least {} characters",
                crate::key_backup::MIN_PASSPHRASE_LEN
            ));
        }
        let authority = app.state::<std::sync::Arc<crate::local_authority::LocalAuthority>>();
        let account = authority
            .list_accounts()?
            .into_iter()
            .find(|record| record.id == account_id)
            .ok_or_else(|| "account not found".to_string())?;
        if account.merged_into.is_some() {
            return Err("export the canonical merge target instead".to_string());
        }
        let keys = load_account_keys(&account.id, &account.pubkey)?;
        let backup = tokio::task::spawn_blocking(move || {
            let password = zeroize::Zeroizing::new(password);
            crate::key_backup::create_backup_blob(&keys, &password, crate::key_backup::BACKUP_LOG_N)
        })
        .await
        .map_err(|error| format!("join local account export: {error}"))??;
        let safe_name = account
            .display_name
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() {
                    character.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .split('-')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        let filename = format!(
            "punks-account-{}.ncryptsec",
            if safe_name.is_empty() {
                "identity"
            } else {
                &safe_name
            }
        );
        let destination = match crate::commands::export_util::pick_save_path(
            &app,
            &filename,
            "Password-protected Punks account",
            &["ncryptsec"],
        )
        .await?
        {
            Some(path) => path,
            None => return Ok(None),
        };
        let saved_path = destination.clone();
        tokio::task::spawn_blocking(move || {
            crate::key_backup::write_portable_backup_file(&destination, &backup)
        })
        .await
        .map_err(|error| format!("join local account backup write: {error}"))??;
        Ok(Some(saved_path.display().to_string()))
    }
    #[cfg(not(feature = "punks-local"))]
    Err("local accounts are unavailable in this distribution".to_string())
}
