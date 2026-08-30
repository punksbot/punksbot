use std::collections::HashSet;

use nostr::{Event, JsonUtil};
use rusqlite::Connection;
use serde_json::Value;

pub(super) fn apply_filters(events: &[Event], filters: &[Value]) -> Vec<Event> {
    if filters.is_empty() {
        return Vec::new();
    }
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for filter in filters {
        let limit = filter
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(u64::MAX) as usize;
        let mut matched = 0usize;
        for event in events {
            if matched >= limit {
                break;
            }
            if event_matches_filter(event, filter, true) {
                matched += 1;
                if seen.insert(event.id.to_hex()) {
                    result.push(event.clone());
                }
            }
        }
    }
    sort_events(&mut result);
    result
}

pub(super) fn load_query_candidates(
    database: &Connection,
    search: Option<&str>,
) -> Result<Vec<Event>, String> {
    let (sql, parameter) = match search {
        Some(search) => (
            "SELECT e.raw_json
             FROM events_fts f JOIN events e ON e.id = f.event_id
             WHERE events_fts MATCH ?1
             ORDER BY e.created_at DESC, e.id DESC",
            Some(fts_query(search)),
        ),
        None => (
            "SELECT raw_json FROM events ORDER BY created_at DESC, id DESC",
            None,
        ),
    };
    let mut statement = database
        .prepare(sql)
        .map_err(|error| format!("prepare local authority query: {error}"))?;
    let mut events = Vec::new();
    if let Some(parameter) = parameter {
        let rows = statement
            .query_map([parameter], |row| row.get::<_, String>(0))
            .map_err(|error| format!("query local authority FTS: {error}"))?;
        for row in rows {
            append_query_event(&mut events, row)?;
        }
    } else {
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("query local authority events: {error}"))?;
        for row in rows {
            append_query_event(&mut events, row)?;
        }
    }
    Ok(events)
}

pub(super) fn event_matches_filter(event: &Event, filter: &Value, honor_time: bool) -> bool {
    let Some(filter) = filter.as_object() else {
        return false;
    };
    if let Some(ids) = filter.get("ids").and_then(Value::as_array) {
        let id = event.id.to_hex();
        if !ids
            .iter()
            .filter_map(Value::as_str)
            .any(|prefix| id.starts_with(prefix))
        {
            return false;
        }
    }
    if let Some(authors) = filter.get("authors").and_then(Value::as_array) {
        let pubkey = event.pubkey.to_hex();
        if !authors
            .iter()
            .filter_map(Value::as_str)
            .any(|prefix| pubkey.starts_with(prefix))
        {
            return false;
        }
    }
    if let Some(kinds) = filter.get("kinds").and_then(Value::as_array) {
        let kind = event.kind.as_u16() as u64;
        if !kinds
            .iter()
            .filter_map(Value::as_u64)
            .any(|value| value == kind)
        {
            return false;
        }
    }
    if honor_time {
        if filter
            .get("since")
            .and_then(Value::as_u64)
            .is_some_and(|since| event.created_at.as_secs() < since)
        {
            return false;
        }
        if filter
            .get("until")
            .and_then(Value::as_u64)
            .is_some_and(|until| event.created_at.as_secs() > until)
        {
            return false;
        }
        if let (Some(until), Some(before_id)) = (
            filter.get("until").and_then(Value::as_u64),
            filter.get("before_id").and_then(Value::as_str),
        ) {
            let event_id = event.id.to_hex();
            if event.created_at.as_secs() == until && event_id.as_str() >= before_id {
                return false;
            }
        }
    }
    if let Some(search) = filter.get("search").and_then(Value::as_str) {
        if !event
            .content
            .to_lowercase()
            .contains(&search.to_lowercase())
        {
            return false;
        }
    }
    for (name, expected) in filter.iter().filter(|(name, _)| name.starts_with('#')) {
        let Some(values) = expected.as_array() else {
            return false;
        };
        let tag_name = &name[1..];
        let matches = event.tags.iter().any(|tag| {
            let tag = tag.as_slice();
            tag.first().map(String::as_str) == Some(tag_name)
                && tag.get(1).is_some_and(|actual| {
                    values
                        .iter()
                        .filter_map(Value::as_str)
                        .any(|value| value == actual)
                })
        });
        if !matches {
            return false;
        }
    }
    true
}

pub(super) fn sort_events(events: &mut [Event]) {
    events.sort_by(|left, right| {
        right
            .created_at
            .as_secs()
            .cmp(&left.created_at.as_secs())
            .then_with(|| right.id.to_hex().cmp(&left.id.to_hex()))
    });
}

fn append_query_event(
    events: &mut Vec<Event>,
    row: rusqlite::Result<String>,
) -> Result<(), String> {
    let raw = row.map_err(|error| format!("read local authority event: {error}"))?;
    if let Ok(event) = Event::from_json(raw) {
        events.push(event);
    }
    Ok(())
}

fn fts_query(search: &str) -> String {
    search
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(|token| format!("\"{}\"", token.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" AND ")
}
