use url::Url;

use crate::{ClientFailure, FailureKind};

/// The only navigation coordinates accepted by the native Punks envelope.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PunksNavigationTarget {
    pub kind: String,
    pub path: String,
}

pub(crate) fn parse_origin(origin: &str) -> Result<Url, ClientFailure> {
    let url = Url::parse(origin).map_err(|_| {
        ClientFailure::new(
            FailureKind::ContractViolation,
            "Punks distribution origin is invalid",
        )
    })?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(ClientFailure::new(
            FailureKind::ContractViolation,
            "Punks distribution origin is invalid",
        ));
    }
    Ok(url)
}

pub(crate) fn directory_path(base: &str, cursor: Option<&str>) -> Result<String, ClientFailure> {
    match cursor {
        Some(cursor) => {
            validate_directory_cursor(cursor)?;
            Ok(format!("{base}?limit=100&cursor={cursor}"))
        }
        None => Ok(format!("{base}?limit=100")),
    }
}

pub(crate) fn validate_directory_cursor(value: &str) -> Result<(), ClientFailure> {
    if value.is_empty()
        || value.len() > 1_024
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'~' | b'-'))
    {
        return Err(ClientFailure::contract("directory continuation"));
    }
    Ok(())
}

pub(crate) fn validate_history_cursor(value: &str) -> Result<(), ClientFailure> {
    let mut segments = value.split('.');
    let prefix = segments.next();
    let payload = segments.next();
    let signature = segments.next();
    let base64_url = |segment: &str| {
        !segment.is_empty()
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    };
    if value.len() < 10
        || value.len() > 512
        || prefix != Some("mhc1")
        || !payload.is_some_and(base64_url)
        || !signature.is_some_and(|segment| segment.len() == 43 && base64_url(segment))
        || segments.next().is_some()
    {
        return Err(ClientFailure::contract("message history cursor"));
    }
    Ok(())
}

pub(crate) fn validate_uuid(value: &str, field: &str) -> Result<(), ClientFailure> {
    uuid::Uuid::parse_str(value).map(|_| ()).map_err(|_| {
        ClientFailure::new(
            FailureKind::ContractViolation,
            format!("{field} must be an opaque UUID"),
        )
    })
}

/// Validates the absolute URL accepted by the native navigation envelope.
///
/// The renderer may only navigate within the origin returned by the
/// compatibility handshake, and only on the four canonical path forms.  The
/// parser deliberately compares the raw path rather than decoding segments so
/// that percent-encoded, legacy, query-string, and trailing-slash spellings do
/// not become aliases for a valid resource.
pub fn validate_navigation_url(
    raw_url: &str,
    expected_origin: &str,
) -> Result<PunksNavigationTarget, ClientFailure> {
    let expected = parse_origin(expected_origin)?;
    let actual = Url::parse(raw_url).map_err(|_| ClientFailure::contract("punks.navigation@1"))?;
    if actual.origin().ascii_serialization() != expected.origin().ascii_serialization()
        || !actual.username().is_empty()
        || actual.password().is_some()
        || actual.query().is_some()
        || actual.fragment().is_some()
    {
        return Err(ClientFailure::contract("punks.navigation@1"));
    }

    // Url parsing normalizes dot segments and host casing.  Comparing the
    // original spelling with the canonical origin + path rejects those
    // aliases as well as an omitted root slash or an explicit legacy port.
    let canonical_url = format!(
        "{}{}",
        expected.origin().ascii_serialization(),
        actual.path()
    );
    if raw_url != canonical_url {
        return Err(ClientFailure::contract("punks.navigation@1"));
    }

    let segments = if actual.path() == "/" {
        Vec::new()
    } else if !actual.path().starts_with('/') || actual.path().ends_with('/') {
        return Err(ClientFailure::contract("punks.navigation@1"));
    } else {
        actual.path()[1..].split('/').collect()
    };

    let (kind, valid) = match segments.as_slice() {
        [] => ("home", true),
        [prefix, slug] if *prefix == "w" => ("workspace", valid_workspace_slug(slug)),
        [prefix, slug, conversations, conversation_id]
            if *prefix == "w" && *conversations == "conversations" =>
        {
            (
                "conversation",
                valid_workspace_slug(slug) && valid_uuid_segment(conversation_id),
            )
        }
        [prefix, slug, conversations, conversation_id, messages, message_id]
            if *prefix == "w" && *conversations == "conversations" && *messages == "messages" =>
        {
            (
                "message",
                valid_workspace_slug(slug)
                    && valid_uuid_segment(conversation_id)
                    && valid_uuid_segment(message_id),
            )
        }
        _ => ("", false),
    };
    if !valid {
        return Err(ClientFailure::contract("punks.navigation@1"));
    }

    Ok(PunksNavigationTarget {
        kind: kind.to_owned(),
        path: actual.path().to_owned(),
    })
}

fn valid_workspace_slug(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 48 {
        return false;
    }
    let is_alphanumeric = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    is_alphanumeric(bytes[0])
        && is_alphanumeric(bytes[bytes.len() - 1])
        && bytes
            .iter()
            .all(|byte| is_alphanumeric(*byte) || *byte == b'-')
}

fn valid_uuid_segment(value: &str) -> bool {
    let bytes = value.as_bytes();
    uuid::Uuid::parse_str(value).is_ok()
        && bytes.len() == 36
        && [8, 13, 18, 23]
            .into_iter()
            .all(|index| bytes[index] == b'-')
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            [8, 13, 18, 23].contains(&index)
                || byte.is_ascii_digit()
                || (b'a'..=b'f').contains(byte)
        })
}

#[cfg(test)]
mod navigation_tests {
    use super::*;

    const ORIGIN: &str = "https://staging.punks.bot";

    #[test]
    fn accepte_les_quatre_routes_canoniques() {
        let cases = [
            ("https://staging.punks.bot/", "home", "/"),
            ("https://staging.punks.bot/w/alpha", "workspace", "/w/alpha"),
            (
                "https://staging.punks.bot/w/alpha/conversations/33333333-3333-4333-8333-333333333333",
                "conversation",
                "/w/alpha/conversations/33333333-3333-4333-8333-333333333333",
            ),
            (
                "https://staging.punks.bot/w/alpha/conversations/33333333-3333-4333-8333-333333333333/messages/44444444-4444-4444-8444-444444444444",
                "message",
                "/w/alpha/conversations/33333333-3333-4333-8333-333333333333/messages/44444444-4444-4444-8444-444444444444",
            ),
        ];

        for (url, kind, path) in cases {
            let target = validate_navigation_url(url, ORIGIN).expect("route canonique");
            assert_eq!(target.kind, kind);
            assert_eq!(target.path, path);
        }
    }

    #[test]
    fn refuse_origine_etrangere_et_formes_legacy() {
        let invalid = [
            "https://evil.example/w/alpha",
            "http://staging.punks.bot/w/alpha",
            "https://staging.punks.bot/#/w/alpha",
            "https://staging.punks.bot/w/alpha/",
            "https://staging.punks.bot/w/alpha?legacy=1",
            "https://staging.punks.bot/w/alpha%2Fbeta",
            "https://staging.punks.bot/w/alpha/../beta",
            "https://staging.punks.bot/W/alpha",
            "https://staging.punks.bot/w/alpha/conversations/33333333-3333-4333-8333-333333333333/messages/44444444-4444-4444-8444-444444444444/",
            "https://staging.punks.bot/workspaces/alpha",
        ];
        for url in invalid {
            assert!(validate_navigation_url(url, ORIGIN).is_err(), "{url}");
        }
    }
}
