use std::{
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use url::Url;

const NETWORK_LOG_ENV: &str = "PUNKS_PROMOTION_NETWORK_LOG";

#[derive(Debug, PartialEq, Eq, Serialize)]
struct NetworkRecord {
    transport: String,
    method: String,
    origin: String,
    path: String,
    status: u16,
}

impl NetworkRecord {
    fn from_url(method: &str, url: &Url, status: u16) -> Option<Self> {
        if !matches!(url.scheme(), "https" | "wss") || url.host_str().is_none() {
            return None;
        }
        Some(Self {
            transport: url.scheme().to_owned(),
            method: method.to_owned(),
            origin: url.origin().ascii_serialization(),
            path: url.path().to_owned(),
            status,
        })
    }
}

static NETWORK_LOG: OnceLock<Option<Mutex<File>>> = OnceLock::new();

fn open_network_log() -> Option<Mutex<File>> {
    let path = std::env::var_os(NETWORK_LOG_ENV).map(PathBuf::from)?;
    if !path.is_absolute() || path.parent().is_none_or(|parent| !parent.is_dir()) {
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

pub(crate) fn record_network_request(method: &str, url: &Url, status: u16) {
    let Some(record) = NetworkRecord::from_url(method, url, status) else {
        return;
    };
    let Some(log) = NETWORK_LOG.get_or_init(open_network_log) else {
        return;
    };
    let Ok(mut file) = log.lock() else {
        return;
    };
    if let Ok(mut serialized) = serde_json::to_vec(&record) {
        serialized.push(b'\n');
        let _ = file.write_all(&serialized);
        let _ = file.flush();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_record_excludes_query_credentials_and_rejects_plaintext() {
        let url =
            Url::parse("https://staging.punks.bot/api/v1/workspaces/one/messages?cursor=secret")
                .ok()
                .and_then(|url| NetworkRecord::from_url("GET", &url, 200));
        assert_eq!(
            url,
            Some(NetworkRecord {
                transport: "https".to_owned(),
                method: "GET".to_owned(),
                origin: "https://staging.punks.bot".to_owned(),
                path: "/api/v1/workspaces/one/messages".to_owned(),
                status: 200,
            })
        );
        let plaintext = Url::parse("http://staging.punks.bot/api/health")
            .ok()
            .and_then(|url| NetworkRecord::from_url("GET", &url, 200));
        assert!(plaintext.is_none());
    }
}
