use std::{
    collections::HashSet,
    io::Write,
    path::{Path as FsPath, PathBuf},
    process::Stdio,
    sync::Arc,
};

use axum::{
    body::{Body, Bytes},
    extract::{Extension, OriginalUri, Path},
    http::{header, HeaderMap, HeaderValue, Method, Response, StatusCode},
};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine as _,
};
use nostr::{Event, JsonUtil};
use punks_core_pkg::{
    channel::MemberRole,
    git_perms::{
        default_min_role, parse_protection_tag_with_warnings, EffectiveRules, ProtectionRule,
        UpdateKind, MAX_PROTECTION_RULES,
    },
};

use super::{error_response, tag_value, LocalAuthority};

impl LocalAuthority {
    pub(super) fn ensure_git_repository_from_event(&self, event: &Event) -> Result<(), String> {
        let owner = event.pubkey.to_hex();
        let repository = tag_value(event, "d")
            .filter(|value| valid_repository_name(value))
            .ok_or_else(|| "repository announcement requires a safe d tag".to_string())?;
        let channel_id = tag_value(event, "h")
            .ok_or_else(|| "repository announcement requires h tag".to_string())?;
        if !self
            .channel_members(&channel_id)?
            .iter()
            .any(|(pubkey, _)| pubkey.eq_ignore_ascii_case(&owner))
        {
            return Err("forbidden: repository owner is not a Conversation member".to_string());
        }
        let repository_path = self.git_repository_path(&owner, &repository)?;
        if repository_path.join("HEAD").is_file() && repository_path.join("objects").is_dir() {
            install_pre_receive_hook(&repository_path)?;
            return Ok(());
        }
        let parent = repository_path
            .parent()
            .ok_or_else(|| "resolve local Git owner directory".to_string())?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("create local Git owner directory: {error}"))?;
        let output = std::process::Command::new("git")
            .args(["init", "--bare", "--initial-branch=main", "--"])
            .arg(&repository_path)
            .output()
            .map_err(|error| format!("start local Git repository initialization: {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "initialize local Git repository: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let receive_pack = std::process::Command::new("git")
            .args(["config", "--file"])
            .arg(repository_path.join("config"))
            .args(["http.receivepack", "true"])
            .output()
            .map_err(|error| format!("configure local Git repository: {error}"))?;
        if !receive_pack.status.success() {
            return Err(format!(
                "configure local Git receive-pack: {}",
                String::from_utf8_lossy(&receive_pack.stderr).trim()
            ));
        }
        install_pre_receive_hook(&repository_path)?;
        Ok(())
    }

    fn git_repository_path(&self, owner: &str, repository: &str) -> Result<PathBuf, String> {
        if owner.len() != 64 || !owner.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err("invalid local Git owner".to_string());
        }
        if !valid_repository_name(repository) {
            return Err("invalid local Git repository name".to_string());
        }
        Ok(self
            .git_dir
            .join(owner.to_ascii_lowercase())
            .join(format!("{repository}.git")))
    }

    fn authorize_git(
        &self,
        actor_pubkey: &str,
        owner: &str,
        repository: &str,
    ) -> Result<GitAuthorization, String> {
        self.assert_member_can_authenticate(actor_pubkey)?;
        let announcement = self
            .query(&[serde_json::json!({
                "kinds": [30617],
                "authors": [owner],
                "#d": [repository],
                "limit": 1
            })])?
            .into_iter()
            .next()
            .ok_or_else(|| "repository not found".to_string())?;
        let channel_id = tag_value(&announcement, "h").ok_or_else(|| {
            "repository announcement is missing Conversation authority".to_string()
        })?;
        let role = self
            .channel_members(&channel_id)?
            .into_iter()
            .find(|(pubkey, _)| pubkey.eq_ignore_ascii_case(actor_pubkey))
            .map(|(_, role)| role)
            .ok_or_else(|| "forbidden: repository Conversation membership required".to_string())?;
        let role = role
            .parse::<MemberRole>()
            .map_err(|error| format!("invalid repository member role: {error}"))?;
        let rules = punks_protection_rules(&announcement)?;
        let repository_path = self.git_repository_path(owner, repository)?;
        install_pre_receive_hook(&repository_path)?;
        Ok(GitAuthorization {
            repository_path,
            role,
            rules,
        })
    }
}

struct GitAuthorization {
    repository_path: PathBuf,
    role: MemberRole,
    rules: Vec<ProtectionRule>,
}

fn punks_protection_rules(announcement: &Event) -> Result<Vec<ProtectionRule>, String> {
    let mut rules = Vec::new();
    for tag in announcement.tags.iter() {
        let values = tag.as_slice();
        if values.first().map(String::as_str) != Some("punks-protect") {
            continue;
        }
        if rules.len() >= MAX_PROTECTION_RULES {
            return Err(format!(
                "invalid Punks Git protection: exceeds {MAX_PROTECTION_RULES} rules"
            ));
        }
        let fields = values[1..].iter().map(String::as_str).collect::<Vec<_>>();
        let (rule, unknown) = parse_protection_tag_with_warnings(&fields)
            .map_err(|error| format!("invalid Punks Git protection: {error}"))?;
        if !unknown.is_empty() {
            return Err(format!(
                "invalid Punks Git protection rules: {}",
                unknown.join(", ")
            ));
        }
        rules.push(rule);
    }
    Ok(rules)
}

pub(super) async fn serve(
    Extension(authority): Extension<Arc<LocalAuthority>>,
    Path((owner, repository, tail)): Path<(String, String, String)>,
    OriginalUri(uri): OriginalUri,
    method: Method,
    headers: HeaderMap,
    body: Bytes,
) -> Response<Body> {
    let actor = match authenticate_git_request(&authority, &headers, &uri, &owner, &repository) {
        Ok(actor) => actor,
        Err(error) => return git_auth_error(&method, &error),
    };
    let receive_pack = tail.ends_with("git-receive-pack");
    let authorization =
        match authority.authorize_git(&actor, &owner.to_ascii_lowercase(), &repository) {
            Ok(authorization) => authorization,
            Err(error) if error.starts_with("forbidden:") || error.starts_with("restricted:") => {
                return error_response(StatusCode::FORBIDDEN, &error)
            }
            Err(error) => return error_response(StatusCode::NOT_FOUND, &error),
        };
    if !authorization.repository_path.is_dir() {
        return error_response(StatusCode::NOT_FOUND, "repository not found");
    }

    let policy = if receive_pack {
        match build_hook_policy(&body, authorization.role, &authorization.rules) {
            Ok(policy) => policy,
            Err(error) => return error_response(StatusCode::BAD_REQUEST, &error),
        }
    } else {
        String::new()
    };

    let input = GitCgiInput {
        project_root: authority.git_dir.as_ref().clone(),
        path_info: format!(
            "/{}/{}.git/{}",
            owner.to_ascii_lowercase(),
            repository,
            tail
        ),
        query: uri.query().unwrap_or_default().to_string(),
        method: method.to_string(),
        content_type: headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string(),
        actor,
        actor_role: authorization.role.as_str().to_string(),
        actor_role_level: authorization.role.permission_level(),
        policy,
        body: body.to_vec(),
    };
    match tokio::task::spawn_blocking(move || run_git_http_backend(input)).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => error_response(StatusCode::BAD_GATEWAY, &error),
        Err(error) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("join local Git backend: {error}"),
        ),
    }
}

struct GitCgiInput {
    project_root: PathBuf,
    path_info: String,
    query: String,
    method: String,
    content_type: String,
    actor: String,
    actor_role: String,
    actor_role_level: u8,
    policy: String,
    body: Vec<u8>,
}

fn run_git_http_backend(input: GitCgiInput) -> Result<Response<Body>, String> {
    let mut child = std::process::Command::new("git")
        .arg("http-backend")
        .env("GIT_PROJECT_ROOT", input.project_root)
        .env("GIT_HTTP_EXPORT_ALL", "1")
        .env("PATH_INFO", input.path_info)
        .env("QUERY_STRING", input.query)
        .env("REQUEST_METHOD", input.method)
        .env("CONTENT_TYPE", input.content_type)
        .env("CONTENT_LENGTH", input.body.len().to_string())
        .env("REMOTE_USER", input.actor)
        .env("REMOTE_ADDR", "127.0.0.1")
        .env("PUNKS_GIT_ACTOR_ROLE", input.actor_role)
        .env(
            "PUNKS_GIT_ACTOR_ROLE_LEVEL",
            input.actor_role_level.to_string(),
        )
        .env("PUNKS_GIT_POLICY", input.policy)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("start local Git HTTP backend: {error}"))?;
    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(&input.body)
            .map_err(|error| format!("write local Git request: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("wait for local Git HTTP backend: {error}"))?;
    if !output.status.success() && output.stdout.is_empty() {
        return Err(format!(
            "local Git HTTP backend failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    parse_cgi_response(&output.stdout)
}

fn parse_cgi_response(output: &[u8]) -> Result<Response<Body>, String> {
    let split = output
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|position| (position, 4))
        .or_else(|| {
            output
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|position| (position, 2))
        })
        .ok_or_else(|| "local Git backend returned malformed CGI headers".to_string())?;
    let raw_headers = std::str::from_utf8(&output[..split.0])
        .map_err(|_| "local Git backend returned non-UTF8 headers".to_string())?;
    let mut status = StatusCode::OK;
    let mut response = Response::new(Body::from(output[split.0 + split.1..].to_vec()));
    for line in raw_headers.lines() {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        if name.eq_ignore_ascii_case("status") {
            if let Some(code) = value
                .split_whitespace()
                .next()
                .and_then(|code| code.parse().ok())
            {
                status = StatusCode::from_u16(code)
                    .map_err(|_| "local Git backend returned invalid status".to_string())?;
            }
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            header::HeaderName::from_bytes(name.trim().as_bytes()),
            HeaderValue::from_str(value),
        ) {
            response.headers_mut().append(name, value);
        }
    }
    *response.status_mut() = status;
    Ok(response)
}

fn build_hook_policy(
    body: &[u8],
    role: MemberRole,
    rules: &[ProtectionRule],
) -> Result<String, String> {
    let refs = receive_pack_refs(body)?;
    if refs.is_empty() {
        return Err("Git receive-pack contained no ref updates".to_string());
    }
    let mut policy = Vec::with_capacity(refs.len());
    for ref_name in refs {
        let effective = EffectiveRules::for_ref(&ref_name, rules);
        let required = |kind| {
            let default = default_min_role(&ref_name, kind);
            effective
                .push_role
                .filter(|explicit| explicit.permission_level() >= default.permission_level())
                .unwrap_or(default)
                .permission_level()
        };
        policy.push(format!(
            "{}|{}|{}|{}|{}|{}|{}|{}",
            ref_name,
            required(UpdateKind::Create),
            required(UpdateKind::FastForward),
            required(UpdateKind::NonFastForward),
            required(UpdateKind::Delete),
            u8::from(effective.no_force_push),
            u8::from(effective.no_delete),
            u8::from(effective.require_patch),
        ));
    }
    if role == MemberRole::Bot {
        return Err("forbidden: Bots require an explicit Forge grant".to_string());
    }
    Ok(policy.join("\n"))
}

fn receive_pack_refs(body: &[u8]) -> Result<Vec<String>, String> {
    let mut offset = 0usize;
    let mut refs = Vec::new();
    let mut seen = HashSet::new();
    while offset + 4 <= body.len() {
        let length = std::str::from_utf8(&body[offset..offset + 4])
            .ok()
            .and_then(|header| usize::from_str_radix(header, 16).ok())
            .ok_or_else(|| "Git receive-pack has an invalid pkt-line header".to_string())?;
        offset += 4;
        if length == 0 {
            break;
        }
        if length < 4 || offset + length - 4 > body.len() {
            return Err("Git receive-pack has a truncated pkt-line".to_string());
        }
        let payload = &body[offset..offset + length - 4];
        offset += length - 4;
        let line = std::str::from_utf8(payload)
            .map_err(|_| "Git receive-pack command is not UTF-8".to_string())?;
        let mut fields = line.split_ascii_whitespace();
        let _old_oid = fields.next();
        let _new_oid = fields.next();
        let Some(ref_name) = fields.next().and_then(|value| value.split('\0').next()) else {
            continue;
        };
        if !valid_git_ref(ref_name) {
            return Err(format!(
                "Git receive-pack contains an unsafe ref: {ref_name}"
            ));
        }
        if seen.insert(ref_name.to_string()) {
            refs.push(ref_name.to_string());
        }
    }
    Ok(refs)
}

fn valid_git_ref(value: &str) -> bool {
    value.starts_with("refs/")
        && value.len() <= 1_024
        && !value.contains("..")
        && !value.contains("@{")
        && !value.ends_with('.')
        && !value.ends_with('/')
        && !value.ends_with(".lock")
        && !value.bytes().any(|byte| {
            byte <= 0x20
                || byte == 0x7f
                || matches!(byte, b'~' | b'^' | b':' | b'?' | b'*' | b'[' | b'\\')
        })
}

fn install_pre_receive_hook(repository_path: &FsPath) -> Result<(), String> {
    let hooks = repository_path.join("hooks");
    std::fs::create_dir_all(&hooks)
        .map_err(|error| format!("create local Git hooks directory: {error}"))?;
    let hook = hooks.join("pre-receive");
    if std::fs::read_to_string(&hook).ok().as_deref() != Some(PRE_RECEIVE_HOOK) {
        std::fs::write(&hook, PRE_RECEIVE_HOOK)
            .map_err(|error| format!("install local Git pre-receive policy: {error}"))?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&hook)
            .map_err(|error| format!("inspect local Git pre-receive policy: {error}"))?
            .permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&hook, permissions)
            .map_err(|error| format!("activate local Git pre-receive policy: {error}"))?;
    }
    Ok(())
}

const PRE_RECEIVE_HOOK: &str = r#"#!/bin/sh
set -eu

deny() {
  echo "punks-policy: $1" >&2
  exit 1
}

role_name() {
  case "$1" in
    4) echo owner ;;
    3) echo admin ;;
    2) echo member ;;
    1) echo guest ;;
    *) echo member ;;
  esac
}

policy_for_ref() {
  POLICY_FOUND=0
  saved_ifs=$IFS
  IFS='
'
  for policy_entry in ${PUNKS_GIT_POLICY:-}; do
    IFS='|'
    set -- $policy_entry
    IFS=$saved_ifs
    if [ "${1:-}" = "$CURRENT_REF" ]; then
      POLICY_FOUND=1
      REQUIRED_CREATE=${2:-4}
      REQUIRED_FF=${3:-4}
      REQUIRED_NFF=${4:-4}
      REQUIRED_DELETE=${5:-4}
      DENY_FORCE=${6:-1}
      DENY_DELETE=${7:-1}
      REQUIRE_PATCH=${8:-1}
      break
    fi
  done
  IFS=$saved_ifs
}

zero=0000000000000000000000000000000000000000
while read -r old_oid new_oid CURRENT_REF; do
  policy_for_ref
  [ "$POLICY_FOUND" -eq 1 ] || deny "$CURRENT_REF has no authenticated policy"
  [ "$REQUIRE_PATCH" -eq 0 ] || deny "$CURRENT_REF requires a reviewed Forge pull request"

  if [ "$old_oid" = "$zero" ]; then
    required=$REQUIRED_CREATE
  elif [ "$new_oid" = "$zero" ]; then
    [ "$DENY_DELETE" -eq 0 ] || deny "$CURRENT_REF deletion is protected"
    required=$REQUIRED_DELETE
  elif git merge-base --is-ancestor "$old_oid" "$new_oid" >/dev/null 2>&1; then
    required=$REQUIRED_FF
  else
    [ "$DENY_FORCE" -eq 0 ] || deny "$CURRENT_REF rejects non-fast-forward updates"
    required=$REQUIRED_NFF
  fi

  actor_level=${PUNKS_GIT_ACTOR_ROLE_LEVEL:-0}
  if [ "$actor_level" -lt "$required" ]; then
    deny "$CURRENT_REF requires $(role_name "$required") role (you have ${PUNKS_GIT_ACTOR_ROLE:-unknown})"
  fi
done
"#;

fn authenticate_git_request(
    authority: &LocalAuthority,
    headers: &HeaderMap,
    uri: &axum::http::Uri,
    owner: &str,
    repository: &str,
) -> Result<String, String> {
    let encoded = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Nostr "))
        .ok_or_else(|| "missing Git NIP-98 authorization".to_string())?;
    let raw = STANDARD
        .decode(encoded)
        .or_else(|_| URL_SAFE_NO_PAD.decode(encoded))
        .map_err(|_| "invalid Git NIP-98 encoding".to_string())?;
    let event = Event::from_json(raw).map_err(|_| "invalid Git NIP-98 event".to_string())?;
    if event.kind.as_u16() as u32 != 27_235 || !event.verify_id() || !event.verify_signature() {
        return Err("invalid Git NIP-98 signature".to_string());
    }
    let now = chrono::Utc::now().timestamp();
    if (event.created_at.as_secs() as i64 - now).abs() > 120 {
        return Err("Git NIP-98 authorization expired".to_string());
    }
    let signed_url = tag_value(&event, "u")
        .and_then(|value| url::Url::parse(&value).ok())
        .ok_or_else(|| "Git NIP-98 URL is invalid".to_string())?;
    let signed_authority = match (signed_url.host_str(), signed_url.port()) {
        (Some(host), Some(port)) => format!("{host}:{port}"),
        (Some(host), None) => host.to_string(),
        _ => return Err("Git NIP-98 URL has no authority".to_string()),
    };
    let request_authority = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Git request has no Host".to_string())?;
    if !signed_authority.eq_ignore_ascii_case(request_authority) {
        return Err("Git NIP-98 authority does not match request".to_string());
    }
    let expected_path = format!("/git/{}/{}", owner.to_ascii_lowercase(), repository);
    if signed_url.path().trim_end_matches('/') != expected_path
        || !uri.path().starts_with(&format!("{expected_path}/"))
    {
        return Err("Git NIP-98 URL does not match repository".to_string());
    }
    authority.assert_member_can_authenticate(&event.pubkey.to_hex())?;
    Ok(event.pubkey.to_hex())
}

fn git_auth_error(method: &Method, error: &str) -> Response<Body> {
    let mut response = error_response(StatusCode::UNAUTHORIZED, error);
    if let Ok(value) = HeaderValue::from_str(&format!(
        "Nostr realm=\"punks\", method=\"{}\"",
        method.as_str()
    )) {
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, value);
    }
    response
}

fn valid_repository_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value != "."
        && value != ".."
        && !value.contains("..")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}
