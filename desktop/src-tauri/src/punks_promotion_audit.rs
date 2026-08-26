use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{read, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Assets, Runtime};

const EMBEDDED_ASSET_SCHEMA: &str = "punks.embedded-asset-manifest.v1";
const EMBEDDED_ASSET_MANIFEST_ENV: &str = "PUNKS_PROMOTION_ASSET_MANIFEST";
const IPC_LOG_ENV: &str = "PUNKS_PROMOTION_IPC_LOG";
const FORBIDDEN_MARKERS: &[&str] = &[
    "buzz-media",
    "native_websocket",
    "buzz",
    "nostr",
    "relay",
    "huddle",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedAsset {
    path: String,
    size: usize,
    sha256: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedAssetDigest<'a> {
    schema: &'static str,
    files: &'a [EmbeddedAsset],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmbeddedAssetManifest<'a> {
    schema: &'static str,
    product: &'static str,
    mode: &'static str,
    files: &'a [EmbeddedAsset],
    sha256: String,
    forbidden_markers: [String; 0],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct IpcObservation<'a> {
    schema: &'static str,
    sequence: u64,
    observed_at_ms: u128,
    command: &'a str,
    status: &'a str,
    contract: &'a str,
    coordinates: &'a serde_json::Value,
}

static IPC_LOG: OnceLock<Option<Mutex<File>>> = OnceLock::new();
static IPC_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static LIVE_FOLLOW_RECORDED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn sha256(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut encoded = String::with_capacity(digest.len() * 2);
    for byte in digest {
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn ipc_observation_line(
    sequence: u64,
    observed_at_ms: u128,
    command: &str,
    status: &str,
    contract: &str,
    coordinates: &serde_json::Value,
) -> Result<Vec<u8>, String> {
    let coordinate_bytes = serde_json::to_vec(coordinates)
        .map_err(|_| "native IPC coordinates could not be serialized".to_string())?;
    if sequence == 0
        || observed_at_ms == 0
        || !(status == "ok" || status == "error")
        || !command.starts_with("punks_")
        || command.len() > 100
        || !command
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_')
        || contract.is_empty()
        || contract.len() > 120
        || !contract.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'@' | b'[' | b']')
        })
        || !coordinates.is_object()
        || coordinate_bytes.len() > 2_048
        || String::from_utf8_lossy(&coordinate_bytes)
            .to_ascii_lowercase()
            .contains("cookie")
    {
        return Err("native IPC observation is not bounded".to_string());
    }
    let mut bytes = serde_json::to_vec(&IpcObservation {
        schema: "punks.native-ipc-observation.v1",
        sequence,
        observed_at_ms,
        command,
        status,
        contract,
        coordinates,
    })
    .map_err(|_| "native IPC observation could not be serialized".to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn open_ipc_log() -> Option<Mutex<File>> {
    let path = std::env::var_os(IPC_LOG_ENV).map(PathBuf::from)?;
    if !path.is_absolute()
        || path
            .parent()
            .is_none_or(|parent| !parent.is_dir() || parent.canonicalize().is_err())
    {
        return None;
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).ok().map(Mutex::new)
}

pub(crate) fn record_ipc_coordinates(
    command: &str,
    contract: &str,
    succeeded: bool,
    coordinates: &serde_json::Value,
) {
    let Some(log) = IPC_LOG.get_or_init(open_ipc_log) else {
        return;
    };
    let sequence = IPC_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let Ok(observed_at_ms) = SystemTime::now().duration_since(UNIX_EPOCH) else {
        return;
    };
    let Ok(line) = ipc_observation_line(
        sequence,
        observed_at_ms.as_millis(),
        command,
        if succeeded { "ok" } else { "error" },
        contract,
        coordinates,
    ) else {
        return;
    };
    let Ok(mut file) = log.lock() else {
        return;
    };
    let _ = file.write_all(&line).and_then(|()| file.flush());
}

pub(crate) fn record_ipc(command: &str, contract: &str, succeeded: bool) {
    record_ipc_coordinates(command, contract, succeeded, &serde_json::json!({}));
}

pub(crate) fn record_follow_conformance() -> Result<(), String> {
    let scenarios = punks_account_client::promotion_follow_conformance()?;
    let coordinates = serde_json::json!({ "scenarios": scenarios });
    let bytes = serde_json::to_vec(&coordinates)
        .map_err(|_| "installed FOLLOW conformance could not be serialized".to_string())?;
    if bytes.len() > 2_048 {
        return Err("installed FOLLOW conformance is not bounded".to_string());
    }
    record_ipc_coordinates(
        "punks_promotion_follow_conformance",
        "desktop-social-loop-follow@1",
        true,
        &coordinates,
    );
    Ok(())
}

pub(crate) fn record_live_follow_conformance_if_ready(operation_id: &str) {
    let recorded = LIVE_FOLLOW_RECORDED.get_or_init(|| Mutex::new(HashSet::new()));
    if recorded
        .lock()
        .is_ok_and(|recorded| recorded.contains(operation_id))
    {
        return;
    }
    let Ok(scenarios) = punks_account_client::promotion_live_follow_conformance(operation_id)
    else {
        return;
    };
    let coordinates = serde_json::json!({
        "operationId": operation_id,
        "scenarios": scenarios,
    });
    let Ok(bytes) = serde_json::to_vec(&coordinates) else {
        return;
    };
    if bytes.len() > 2_048 {
        return;
    }
    let Ok(mut recorded) = recorded.lock() else {
        return;
    };
    if !recorded.insert(operation_id.to_string()) {
        return;
    }
    record_ipc_coordinates(
        "punks_promotion_live_follow_conformance",
        "desktop-social-loop-live-follow@1",
        true,
        &coordinates,
    );
}

pub(crate) fn record_auth_conformance() -> Result<(), String> {
    let scenarios = punks_account_client::promotion_auth_conformance()?;
    let coordinates = serde_json::json!({ "scenarios": scenarios });
    let bytes = serde_json::to_vec(&coordinates)
        .map_err(|_| "installed authentication conformance could not be serialized".to_string())?;
    if bytes.len() > 2_048 {
        return Err("installed authentication conformance is not bounded".to_string());
    }
    record_ipc_coordinates(
        "punks_promotion_auth_conformance",
        "desktop-auth-ceremony@1",
        true,
        &coordinates,
    );
    Ok(())
}

pub(crate) fn observe_result<T, E>(
    command: &str,
    contract: &str,
    result: Result<T, E>,
) -> Result<T, E> {
    record_ipc(command, contract, result.is_ok());
    result
}

fn canonical_asset_path(value: &str) -> Result<String, String> {
    let path = value.strip_prefix('/').unwrap_or(value);
    if path.is_empty()
        || path.contains('\\')
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err("embedded asset path is not canonical".to_string());
    }
    Ok(path.to_string())
}

fn matching_forbidden_marker(path: &str, bytes: &[u8]) -> Option<&'static str> {
    let path = path.to_ascii_lowercase();
    let contents = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    FORBIDDEN_MARKERS
        .iter()
        .copied()
        .find(|marker| path.contains(marker) || contents.contains(marker))
}

fn build_embedded_asset_manifest(assets: Vec<(&str, &[u8])>) -> Result<Vec<u8>, String> {
    let mut files = Vec::with_capacity(assets.len());
    for (path, bytes) in assets {
        if bytes.is_empty() {
            return Err("embedded asset is empty".to_string());
        }
        let path = canonical_asset_path(path)?;
        if let Some(marker) = matching_forbidden_marker(&path, bytes) {
            return Err(format!("embedded asset contains forbidden marker {marker}"));
        }
        files.push(EmbeddedAsset {
            path,
            size: bytes.len(),
            sha256: sha256(bytes),
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    if files.is_empty()
        || files.windows(2).any(|pair| pair[0].path == pair[1].path)
        || !files.iter().any(|file| file.path == "index.html")
        || !files.iter().any(|file| file.path.starts_with("assets/"))
    {
        return Err("embedded asset closure is incomplete or duplicated".to_string());
    }
    let digest_input = serde_json::to_vec(&EmbeddedAssetDigest {
        schema: EMBEDDED_ASSET_SCHEMA,
        files: &files,
    })
    .map_err(|_| "embedded asset digest could not be serialized".to_string())?;
    let manifest = EmbeddedAssetManifest {
        schema: EMBEDDED_ASSET_SCHEMA,
        product: "punks-frontend",
        mode: "embedded-runtime",
        files: &files,
        sha256: sha256(&digest_input),
        forbidden_markers: [],
    };
    let mut bytes = serde_json::to_vec(&manifest)
        .map_err(|_| "embedded asset manifest could not be serialized".to_string())?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn write_manifest_at(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if !path.is_absolute()
        || path
            .parent()
            .is_none_or(|parent| !parent.is_dir() || parent.canonicalize().is_err())
    {
        return Err("promotion asset manifest path is not absolute and rooted".to_string());
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|error| format!("promotion asset manifest could not be created: {error}"))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| format!("promotion asset manifest could not be persisted: {error}"))?;
    let persisted = read(path)
        .map_err(|error| format!("promotion asset manifest could not be reread: {error}"))?;
    if persisted != bytes {
        return Err("promotion asset manifest changed after creation".to_string());
    }
    Ok(())
}

pub(crate) fn write_embedded_asset_manifest<R: Runtime>(
    assets: &dyn Assets<R>,
) -> Result<(), String> {
    let Some(path) = std::env::var_os(EMBEDDED_ASSET_MANIFEST_ENV) else {
        return Ok(());
    };
    let owned = assets
        .iter()
        .map(|(path, bytes)| (path.into_owned(), bytes.into_owned()))
        .collect::<Vec<_>>();
    let borrowed = owned
        .iter()
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect::<Vec<_>>();
    let manifest = build_embedded_asset_manifest(borrowed)?;
    write_manifest_at(Path::new(&path), &manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::read;

    #[test]
    fn manifests_the_exact_embedded_runtime_asset_closure() {
        let manifest = build_embedded_asset_manifest(vec![
            ("index.html", b"index\n"),
            ("assets/index.js", b"bundle\n"),
        ])
        .expect("embedded manifest");
        let value: serde_json::Value = serde_json::from_slice(&manifest).expect("manifest JSON");

        assert_eq!(value["schema"], EMBEDDED_ASSET_SCHEMA);
        assert_eq!(value["product"], "punks-frontend");
        assert_eq!(value["mode"], "embedded-runtime");
        assert_eq!(value["forbiddenMarkers"], serde_json::json!([]));
        assert_eq!(
            value["files"],
            serde_json::json!([
                {
                    "path": "assets/index.js",
                    "size": 7,
                    "sha256": "ef17b7d320f2acc023f2018dab381827ba22f9d01b6c4c97894e1bbfe4928313"
                },
                {
                    "path": "index.html",
                    "size": 6,
                    "sha256": "f816b480f87144ec4de5862adf028ff66cc6964250325d53fd22bf8922824b6f"
                }
            ])
        );
        assert_eq!(
            value["sha256"],
            "79055a41a5fcb4b64bdf59655694d7b86c4e01a9ab5e983c8de9f11e04a142c2"
        );
    }

    #[test]
    fn writes_the_runtime_manifest_create_only() {
        let path = std::env::temp_dir().join(format!("punks-assets-{}.json", uuid::Uuid::new_v4()));
        let manifest = b"{\"schema\":\"punks.embedded-asset-manifest.v1\"}\n";

        write_manifest_at(&path, manifest).expect("first write");
        assert_eq!(read(&path).expect("written manifest"), manifest);
        assert!(write_manifest_at(&path, b"replacement\n").is_err());
        assert_eq!(read(&path).expect("preserved manifest"), manifest);

        std::fs::remove_file(path).expect("remove test manifest");
    }

    #[test]
    fn serializes_one_bounded_native_ipc_observation() {
        assert_eq!(
            ipc_observation_line(
                7,
                1_787_733_000_123,
                "punks_post_message",
                "ok",
                "message.view@1",
                &serde_json::json!({ "messageId": "55555555-5555-4555-8555-555555555555" }),
            )
            .expect("IPC observation"),
            b"{\"schema\":\"punks.native-ipc-observation.v1\",\"sequence\":7,\"observedAtMs\":1787733000123,\"command\":\"punks_post_message\",\"status\":\"ok\",\"contract\":\"message.view@1\",\"coordinates\":{\"messageId\":\"55555555-5555-4555-8555-555555555555\"}}\n"
        );
    }
}
