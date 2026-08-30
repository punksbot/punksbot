use nostr::{Event, EventBuilder, Kind, PublicKey};
use rusqlite::params;

use super::{parse_tag, LocalAuthority, SubmitResponse};

const ARCHIVE_REQUEST: u32 = 9_035;
const UNARCHIVE_REQUEST: u32 = 9_036;
const ARCHIVED_DELTA: u16 = 8_002;
const UNARCHIVED_DELTA: u16 = 8_003;
const ARCHIVE_SNAPSHOT: u16 = 13_535;

impl LocalAuthority {
    pub(super) fn submit_identity_archive_command(
        &self,
        event: &Event,
    ) -> Result<SubmitResponse, String> {
        self.assert_member_can_publish(&event.pubkey.to_hex())?;
        validate_request_shape(event)?;
        let actor = event.pubkey.to_hex();
        let target = single_tag_value(event, "p")
            .filter(|value| valid_pubkey(value))
            .ok_or_else(|| {
                "identity archive request requires exactly one valid p tag".to_string()
            })?;
        let consent = self.identity_archive_consent(event, &actor, &target)?;
        let reason = single_optional_tag_value(event, "reason")?;
        let replaced_by = single_optional_tag_value(event, "replaced-by")?;
        if event.kind.as_u16() as u32 == UNARCHIVE_REQUEST && replaced_by.is_some() {
            return Err("replaced-by is not valid on an identity restore".to_string());
        }
        if replaced_by.as_deref() == Some(target.as_str())
            || replaced_by
                .as_ref()
                .is_some_and(|value| !valid_pubkey(value))
        {
            return Err("identity archive replaced-by target is invalid".to_string());
        }
        let changed = self.persist_identity_archive_state(
            event,
            &actor,
            &target,
            consent,
            reason.as_deref(),
            replaced_by.as_deref(),
        )?;
        self.persist_and_publish(event.clone())?;
        if changed {
            self.publish_identity_archive_delta(
                event,
                &actor,
                &target,
                consent,
                reason.as_deref(),
                replaced_by.as_deref(),
            )?;
            self.publish_identity_archive_snapshot()?;
        }
        Ok(SubmitResponse {
            event_id: event.id.to_hex(),
            accepted: true,
            message: String::new(),
        })
    }

    fn identity_archive_consent(
        &self,
        event: &Event,
        actor: &str,
        target: &str,
    ) -> Result<&'static str, String> {
        if actor.eq_ignore_ascii_case(target) {
            return Ok("self");
        }
        if matches!(self.member_role(actor)?.as_deref(), Some("owner" | "admin")) {
            return Ok("admin");
        }
        let request_owner = verified_auth_owner(event, target)?;
        let profile = self
            .query(&[serde_json::json!({
                "kinds": [0],
                "authors": [target],
                "limit": 1
            })])?
            .into_iter()
            .next()
            .ok_or_else(|| "identity archive target has no live profile".to_string())?;
        let live_owner = crate::extract_oa_owner(&profile)
            .map(|(owner, _)| owner)
            .ok_or_else(|| "identity archive target has no valid owner attestation".to_string())?;
        if !request_owner.eq_ignore_ascii_case(actor) || !live_owner.eq_ignore_ascii_case(actor) {
            return Err("forbidden: identity owner attestation does not match signer".to_string());
        }
        Ok("owner")
    }

    #[allow(clippy::too_many_arguments)]
    fn persist_identity_archive_state(
        &self,
        event: &Event,
        actor: &str,
        target: &str,
        consent: &str,
        reason: Option<&str>,
        replaced_by: Option<&str>,
    ) -> Result<bool, String> {
        let database = self
            .database
            .lock()
            .map_err(|error| format!("lock local identity archive: {error}"))?;
        let kind = event.kind.as_u16() as u32;
        let changed = if kind == ARCHIVE_REQUEST {
            database
                .execute(
                    "INSERT INTO archived_identities(
                       pubkey, consent_path, actor_pubkey, reason, replaced_by,
                       request_event_id, archived_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(pubkey) DO NOTHING",
                    params![
                        target,
                        consent,
                        actor,
                        reason,
                        replaced_by,
                        event.id.to_hex(),
                        event.created_at.as_secs() as i64,
                    ],
                )
                .map_err(|error| format!("archive local identity: {error}"))?
                == 1
        } else {
            database
                .execute(
                    "DELETE FROM archived_identities WHERE pubkey = ?1",
                    [target],
                )
                .map_err(|error| format!("restore local identity: {error}"))?
                == 1
        };
        database
            .execute(
                "INSERT INTO audit_log(action, actor_pubkey, target_id, details_json, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    if kind == ARCHIVE_REQUEST {
                        "identity.archived"
                    } else {
                        "identity.restored"
                    },
                    actor,
                    target,
                    serde_json::json!({
                        "changed": changed,
                        "consent": consent,
                        "request_event_id": event.id.to_hex()
                    })
                    .to_string(),
                    event.created_at.as_secs() as i64,
                ],
            )
            .map_err(|error| format!("audit local identity archive: {error}"))?;
        Ok(changed)
    }

    #[allow(clippy::too_many_arguments)]
    fn publish_identity_archive_delta(
        &self,
        request: &Event,
        actor: &str,
        target: &str,
        consent: &str,
        reason: Option<&str>,
        replaced_by: Option<&str>,
    ) -> Result<(), String> {
        let mut tags = vec![
            parse_tag(["-"])?,
            parse_tag(["p", target])?,
            parse_tag(["consent", consent])?,
            parse_tag(["actor", actor])?,
            parse_tag(["e", &request.id.to_hex()])?,
        ];
        if let Some(reason) = reason {
            tags.push(parse_tag(["reason", reason])?);
        }
        if let Some(replaced_by) = replaced_by {
            tags.push(parse_tag(["replaced-by", replaced_by])?);
        }
        let kind = if request.kind.as_u16() as u32 == ARCHIVE_REQUEST {
            ARCHIVED_DELTA
        } else {
            UNARCHIVED_DELTA
        };
        let delta = EventBuilder::new(Kind::Custom(kind), request.content.clone())
            .tags(tags)
            .custom_created_at(request.created_at)
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local identity archive delta: {error}"))?;
        self.persist_and_publish(delta).map(|_| ())
    }

    fn publish_identity_archive_snapshot(&self) -> Result<(), String> {
        let archived = {
            let database = self
                .database
                .lock()
                .map_err(|error| format!("lock local identity archive: {error}"))?;
            let mut statement = database
                .prepare("SELECT pubkey FROM archived_identities ORDER BY pubkey ASC")
                .map_err(|error| format!("prepare identity archive snapshot: {error}"))?;
            let rows = statement
                .query_map([], |row| row.get::<_, String>(0))
                .map_err(|error| format!("query identity archive snapshot: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("read identity archive snapshot: {error}"))?
        };
        let mut tags = vec![parse_tag(["-"])?];
        for pubkey in archived {
            tags.push(parse_tag(["p", &pubkey])?);
        }
        let previous = self
            .query(&[serde_json::json!({
                "kinds": [ARCHIVE_SNAPSHOT],
                "authors": [self.signer.public_key().to_hex()],
                "limit": 1
            })])?
            .into_iter()
            .next()
            .map(|event| event.created_at.as_secs())
            .unwrap_or_default();
        let created_at = nostr::Timestamp::now()
            .as_secs()
            .max(previous.saturating_add(1));
        let snapshot = EventBuilder::new(Kind::Custom(ARCHIVE_SNAPSHOT), "")
            .tags(tags)
            .custom_created_at(nostr::Timestamp::from(created_at))
            .sign_with_keys(&self.signer)
            .map_err(|error| format!("sign local identity archive snapshot: {error}"))?;
        self.persist_and_publish(snapshot).map(|_| ())
    }
}

fn validate_request_shape(event: &Event) -> Result<(), String> {
    let kind = event.kind.as_u16() as u32;
    if !matches!(kind, ARCHIVE_REQUEST | UNARCHIVE_REQUEST) {
        return Err("contract: unsupported identity archive command".to_string());
    }
    let now = chrono::Utc::now().timestamp();
    if (event.created_at.as_secs() as i64 - now).abs() > 120 {
        return Err("identity archive command timestamp is outside the allowed window".to_string());
    }
    let protected = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice() == ["-"])
        .count();
    if protected != 1 {
        return Err("identity archive command requires one protected tag".to_string());
    }
    Ok(())
}

fn single_tag_value(event: &Event, name: &str) -> Option<String> {
    let values = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
        .collect::<Vec<_>>();
    (values.len() == 1)
        .then(|| values[0].as_slice().get(1).cloned())
        .flatten()
}

fn single_optional_tag_value(event: &Event, name: &str) -> Result<Option<String>, String> {
    let values = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
        .collect::<Vec<_>>();
    if values.len() > 1 {
        return Err(format!("identity archive command has multiple {name} tags"));
    }
    Ok(values
        .first()
        .and_then(|tag| tag.as_slice().get(1).cloned()))
}

fn verified_auth_owner(event: &Event, target: &str) -> Result<String, String> {
    let tags = event
        .tags
        .iter()
        .filter(|tag| tag.as_slice().first().map(String::as_str) == Some("auth"))
        .collect::<Vec<_>>();
    if tags.len() != 1 || tags[0].as_slice().len() != 4 {
        return Err("forbidden: identity owner request requires one valid auth tag".to_string());
    }
    let target = PublicKey::from_hex(target)
        .map_err(|error| format!("invalid identity archive target: {error}"))?;
    let json = serde_json::to_string(tags[0].as_slice())
        .map_err(|error| format!("encode identity owner attestation: {error}"))?;
    punks_sdk_pkg::nip_oa::verify_auth_tag(&json, &target)
        .map(|owner| owner.to_hex())
        .map_err(|error| format!("forbidden: invalid identity owner attestation: {error}"))
}

fn valid_pubkey(value: &str) -> bool {
    value.len() == 64
        && value == value.to_ascii_lowercase()
        && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}
