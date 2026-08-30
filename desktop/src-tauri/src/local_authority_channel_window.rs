//! Server-assembled Conversation windows for the embedded authority.
//!
//! The rich desktop consumes the same flat event contract as the historical
//! `/query` bridge: retained top-level rows followed by signed synthetic
//! overlays. This module owns that contract so transports do not need to know
//! pagination or overlay details.

use std::collections::{BTreeSet, HashSet};

use nostr::{Event, EventBuilder, Kind, Tag};
use serde_json::{json, Value};

use super::LocalAuthority;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 200;
const KIND_WINDOW_BOUNDS: u16 = 39_006;
const KIND_THREAD_SUMMARY: u16 = 39_005;
const AUX_KINDS: [u32; 4] = [5, 7, 9_005, 40_003];
const AUX_DELETE_KINDS: [u32; 2] = [5, 9_005];

pub(super) fn query(
    authority: &LocalAuthority,
    actor_pubkey: &str,
    raw_filter: &Value,
) -> Result<Vec<Event>, String> {
    let channel_id = exact_channel(raw_filter)?;
    let cursor = composite_cursor(raw_filter)?;
    let limit = raw_filter
        .get("limit")
        .and_then(Value::as_u64)
        .map(|limit| limit as usize)
        .unwrap_or(DEFAULT_LIMIT)
        .clamp(1, MAX_LIMIT);

    let mut row_filter = raw_filter.clone();
    let object = row_filter
        .as_object_mut()
        .ok_or_else(|| "top_level filter must be an object".to_string())?;
    object.remove("top_level");
    object.remove("include_summaries");
    object.remove("include_aux");
    object.remove("limit");

    let mut rows = authority
        .query(&[row_filter])?
        .into_iter()
        .filter(|event| {
            authority
                .event_visible_to(event, actor_pubkey)
                .unwrap_or(false)
        })
        .filter(|event| {
            punks_core_pkg::nip10::parse_thread_markers(&event.tags)
                .resolve()
                .is_none()
        })
        .collect::<Vec<_>>();
    let has_more = rows.len() > limit;
    rows.truncate(limit);
    let next_cursor = has_more.then(|| {
        rows.last().map(|event| {
            json!({
                "created_at": event.created_at.as_secs(),
                "id": event.id.to_hex(),
            })
        })
    });
    let next_cursor = next_cursor.flatten();

    let row_ids = rows
        .iter()
        .map(|event| event.id.to_hex())
        .collect::<Vec<_>>();
    let mut response = rows;
    if extension_flag(raw_filter, "include_aux") && !row_ids.is_empty() {
        response.extend(aux_closure(authority, actor_pubkey, &row_ids)?);
    }
    if extension_flag(raw_filter, "include_summaries") {
        response.extend(thread_summaries(
            authority,
            actor_pubkey,
            &channel_id,
            &row_ids,
        )?);
    }

    let cursor_suffix = cursor
        .map(|(until, before_id)| format!("{until}:{before_id}"))
        .unwrap_or_else(|| "head".to_string());
    let bounds_id = format!("{channel_id}:{cursor_suffix}");
    let bounds = EventBuilder::new(
        Kind::Custom(KIND_WINDOW_BOUNDS),
        json!({
            "has_more": has_more,
            "next_cursor": next_cursor,
        })
        .to_string(),
    )
    .tags([
        Tag::parse(["d", &bounds_id])
            .map_err(|error| format!("build channel window bounds id: {error}"))?,
        Tag::parse(["h", &channel_id])
            .map_err(|error| format!("build channel window bounds scope: {error}"))?,
    ])
    .sign_with_keys(&authority.signer)
    .map_err(|error| format!("sign channel window bounds: {error}"))?;
    response.push(bounds);
    Ok(response)
}

fn aux_closure(
    authority: &LocalAuthority,
    actor_pubkey: &str,
    row_ids: &[String],
) -> Result<Vec<Event>, String> {
    let mut result = Vec::new();
    let mut seen = HashSet::new();
    let mut targets = row_ids.to_vec();
    for kinds in [AUX_KINDS.as_slice(), AUX_DELETE_KINDS.as_slice()] {
        if targets.is_empty() {
            break;
        }
        let events = authority.query(&[json!({"kinds": kinds, "#e": targets})])?;
        targets = Vec::new();
        for event in events {
            if !authority.event_visible_to(&event, actor_pubkey)? || !seen.insert(event.id) {
                continue;
            }
            targets.push(event.id.to_hex());
            result.push(event);
        }
    }
    Ok(result)
}

fn thread_summaries(
    authority: &LocalAuthority,
    actor_pubkey: &str,
    channel_id: &str,
    row_ids: &[String],
) -> Result<Vec<Event>, String> {
    if row_ids.is_empty() {
        return Ok(Vec::new());
    }
    let replies = authority
        .query(&[json!({"#h": [channel_id]})])?
        .into_iter()
        .filter(|event| {
            authority
                .event_visible_to(event, actor_pubkey)
                .unwrap_or(false)
        })
        .filter_map(|event| {
            let (root_id, parent_id) =
                punks_core_pkg::nip10::parse_thread_markers(&event.tags).resolve()?;
            Some((event, root_id, parent_id))
        })
        .collect::<Vec<_>>();
    let mut summaries = Vec::new();
    for root_id in row_ids {
        let mut reply_count = 0_u64;
        let mut descendant_count = 0_u64;
        let mut last_reply_at = None;
        let mut participants = BTreeSet::new();
        for (event, reply_root_id, parent_id) in &replies {
            if reply_root_id != root_id {
                continue;
            }
            descendant_count = descendant_count.saturating_add(1);
            if parent_id == root_id {
                reply_count = reply_count.saturating_add(1);
            }
            last_reply_at = Some(
                last_reply_at
                    .unwrap_or(0_u64)
                    .max(event.created_at.as_secs()),
            );
            participants.insert(event.pubkey.to_hex());
        }
        if descendant_count == 0 {
            continue;
        }
        let summary = EventBuilder::new(
            Kind::Custom(KIND_THREAD_SUMMARY),
            json!({
                "reply_count": reply_count,
                "descendant_count": descendant_count,
                "last_reply_at": last_reply_at,
                "participants": participants.into_iter().collect::<Vec<_>>(),
            })
            .to_string(),
        )
        .tags([
            Tag::parse(["e", root_id])
                .map_err(|error| format!("build thread summary target: {error}"))?,
            Tag::parse(["d", root_id])
                .map_err(|error| format!("build thread summary id: {error}"))?,
            Tag::parse(["h", channel_id])
                .map_err(|error| format!("build thread summary scope: {error}"))?,
        ])
        .sign_with_keys(&authority.signer)
        .map_err(|error| format!("sign thread summary: {error}"))?;
        summaries.push(summary);
    }
    Ok(summaries)
}

fn extension_flag(filter: &Value, name: &str) -> bool {
    filter.get(name).and_then(Value::as_bool) == Some(true)
}

fn exact_channel(filter: &Value) -> Result<String, String> {
    let channels = filter
        .get("#h")
        .and_then(Value::as_array)
        .ok_or_else(|| "top_level requires exactly one #h channel".to_string())?;
    if channels.len() != 1 {
        return Err("top_level requires exactly one #h channel".to_string());
    }
    channels[0]
        .as_str()
        .map(str::to_string)
        .ok_or_else(|| "top_level requires exactly one #h channel".to_string())
}

fn composite_cursor(filter: &Value) -> Result<Option<(u64, String)>, String> {
    let until = filter.get("until").and_then(Value::as_u64);
    let before_id = filter.get("before_id").and_then(Value::as_str);
    match (until, before_id) {
        (None, None) => Ok(None),
        (Some(until), Some(before_id))
            if before_id.len() == 64
                && before_id
                    .chars()
                    .all(|character| character.is_ascii_hexdigit()) =>
        {
            Ok(Some((until, before_id.to_ascii_lowercase())))
        }
        (Some(_), Some(_)) => Err("top_level: before_id must be a 64-hex event id".to_string()),
        _ => Err("top_level cursor requires both until and before_id, or neither".to_string()),
    }
}
