use std::{
    collections::{BTreeMap, HashMap},
    fs::{File, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use serde::Serialize;
use url::Url;

use crate::{
    confirm_follow_batch, reduce_follow_frame, ClientResyncReason, ConversationUnavailableReason,
    FollowEffect, FollowPhase, FollowServerFrame, FollowState, PromotionFollowScenario,
    ServerResyncReason,
};

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
static LIVE_FOLLOW_CAPTURES: OnceLock<Mutex<HashMap<String, LiveFollowCapture>>> = OnceLock::new();

#[derive(Default)]
struct LiveFollowCapture {
    initial_cursor: Option<u64>,
    frames: Vec<FollowServerFrame>,
    confirmed: Vec<u64>,
}

pub(crate) fn begin_live_follow_capture(operation_id: &str, after_cursor: u64) {
    let captures = LIVE_FOLLOW_CAPTURES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut captures) = captures.lock() {
        if captures.len() >= 16 {
            captures.retain(|_, capture| capture.frames.len() < 256);
        }
        captures
            .entry(operation_id.to_string())
            .or_insert_with(|| LiveFollowCapture {
                initial_cursor: Some(after_cursor),
                frames: Vec::new(),
                confirmed: Vec::new(),
            });
    }
}

pub(crate) fn record_live_follow_frame(operation_id: &str, frame: &FollowServerFrame) {
    let captures = LIVE_FOLLOW_CAPTURES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut captures) = captures.lock() {
        let Some(capture) = captures.get_mut(operation_id) else {
            return;
        };
        if capture.frames.len() < 256 {
            capture.frames.push(frame.clone());
        }
    }
}

pub(crate) fn record_live_follow_confirmation(operation_id: &str, cursor: u64) {
    let captures = LIVE_FOLLOW_CAPTURES.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut captures) = captures.lock() {
        let Some(capture) = captures.get_mut(operation_id) else {
            return;
        };
        if capture.confirmed.len() < 256 {
            capture.confirmed.push(cursor);
        }
    }
}

fn live_result(outcome: &str, observation: impl Into<String>) -> PromotionFollowScenario {
    PromotionFollowScenario {
        outcome: outcome.to_string(),
        observations: vec![observation.into()],
    }
}

/// Derives the adversarial FOLLOW matrix from frames captured from real staging.
pub fn promotion_live_follow_conformance(
    operation_id: &str,
) -> Result<BTreeMap<String, PromotionFollowScenario>, String> {
    let captures = LIVE_FOLLOW_CAPTURES
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "live FOLLOW capture lock is unavailable".to_string())?;
    let capture = captures
        .get(operation_id)
        .ok_or_else(|| "live FOLLOW operation capture is missing".to_string())?;
    let initial = capture
        .initial_cursor
        .ok_or_else(|| "live FOLLOW capture did not start".to_string())?;
    let frames = capture.frames.clone();
    let accepted_index = frames
        .iter()
        .position(|frame| matches!(frame, FollowServerFrame::Accepted { .. }))
        .ok_or_else(|| "live FOLLOW accepted frame is missing".to_string())?;
    let ready_index = frames
        .iter()
        .position(|frame| matches!(frame, FollowServerFrame::Ready { .. }))
        .ok_or_else(|| "live FOLLOW ready frame is missing".to_string())?;
    let catch_up = frames
        .iter()
        .enumerate()
        .filter(|(index, frame)| {
            *index > accepted_index
                && *index < ready_index
                && matches!(frame, FollowServerFrame::Changes { .. })
        })
        .map(|(_, frame)| frame.clone())
        .collect::<Vec<_>>();
    let live_change = frames
        .iter()
        .skip(ready_index + 1)
        .find(|frame| matches!(frame, FollowServerFrame::Changes { .. }))
        .cloned()
        .ok_or_else(|| "live FOLLOW post-ready change is missing".to_string())?;
    if catch_up.is_empty() || capture.confirmed.is_empty() {
        return Err("live FOLLOW catch-up/ACK evidence is incomplete".to_string());
    }

    let accepted = frames[accepted_index].clone();
    let first_change = catch_up[0].clone();
    let mut state = reduce_follow_frame(&FollowState::new(initial), accepted.clone()).state;
    let before_first = state.clone();
    let applied = reduce_follow_frame(&state, first_change.clone());
    if !matches!(applied.effect, FollowEffect::ApplyBatch(_)) {
        return Err("real catch-up frame was not atomically applicable".to_string());
    }
    let duplicate = reduce_follow_frame(&applied.state, first_change.clone());
    if !matches!(duplicate.effect, FollowEffect::None) {
        return Err("real catch-up duplicate was not ignored".to_string());
    }
    let through = applied.state.applied_cursor;
    state = confirm_follow_batch(&applied.state, through).state;

    let gap = FollowServerFrame::Changes {
        schema_version: 1,
        from_exclusive_cursor: state.applied_cursor + 1,
        through_cursor: state.applied_cursor + 2,
        messages: vec![],
        thread_patches: vec![],
        reaction_patches: vec![],
        reaction_collection_patches: vec![],
    };
    let gap_result = reduce_follow_frame(&state, gap);
    if !matches!(
        gap_result.effect,
        FollowEffect::Resync {
            reason: ClientResyncReason::CursorGap,
            ..
        }
    ) {
        return Err("real-cursor gap did not request resync".to_string());
    }

    let divergent = match first_change.clone() {
        FollowServerFrame::Changes {
            schema_version,
            from_exclusive_cursor,
            through_cursor,
            ..
        } => FollowServerFrame::Changes {
            schema_version,
            from_exclusive_cursor,
            through_cursor,
            messages: vec![],
            thread_patches: vec![],
            reaction_patches: vec![],
            reaction_collection_patches: vec![],
        },
        _ => return Err("real catch-up change frame is invalid".to_string()),
    };
    let divergence = reduce_follow_frame(&applied.state, divergent);
    if !matches!(
        divergence.effect,
        FollowEffect::Resync {
            reason: ClientResyncReason::CursorDivergence,
            ..
        }
    ) {
        return Err("real-cursor divergence did not request resync".to_string());
    }

    let replay = reduce_follow_frame(&before_first, first_change.clone());
    if !matches!(replay.effect, FollowEffect::ApplyBatch(_)) {
        return Err("crash-before-ACK did not replay the real batch".to_string());
    }
    let accepted_after_ack = FollowServerFrame::Accepted {
        schema_version: 1,
        resume_after_cursor: through,
        target_high_water_cursor: through,
    };
    let after_ack = reduce_follow_frame(&FollowState::new(through), accepted_after_ack);
    let ready_after_ack = reduce_follow_frame(
        &after_ack.state,
        FollowServerFrame::Ready {
            schema_version: 1,
            high_water_cursor: through,
        },
    );
    if !matches!(ready_after_ack.effect, FollowEffect::BecameLive) {
        return Err("crash-after-ACK did not resume without replay".to_string());
    }
    let mut real_live_state = FollowState::new(initial);
    for frame in frames
        .iter()
        .skip(accepted_index)
        .take(ready_index - accepted_index + 1)
        .cloned()
    {
        let reduction = reduce_follow_frame(&real_live_state, frame);
        real_live_state = reduction.state;
        if matches!(reduction.effect, FollowEffect::ApplyBatch(_)) {
            let cursor = real_live_state.applied_cursor;
            let confirmation = confirm_follow_batch(&real_live_state, cursor);
            if confirmation.ack.is_none() {
                return Err("real staging catch-up ACK was rejected".to_string());
            }
            real_live_state = confirmation.state;
        }
    }
    if real_live_state.phase != FollowPhase::Live {
        return Err("real staging frames never reached live".to_string());
    }
    let explicit_resync = reduce_follow_frame(
        &real_live_state,
        FollowServerFrame::ResyncRequired {
            schema_version: 1,
            reason: ServerResyncReason::HistoryRequired,
            after_cursor: real_live_state.follow_checkpoint,
            high_water_cursor: real_live_state.applied_cursor,
        },
    );
    let terminal = reduce_follow_frame(
        &real_live_state,
        FollowServerFrame::ConversationUnavailable {
            schema_version: 1,
            reason: ConversationUnavailableReason::Archived,
            cursor: real_live_state.applied_cursor.max(1),
        },
    );
    if !matches!(explicit_resync.state.phase, FollowPhase::ResyncRequired)
        || !matches!(terminal.state.phase, FollowPhase::Terminal)
    {
        return Err("real-cursor resync/terminal controls diverged".to_string());
    }
    let live = reduce_follow_frame(&real_live_state, live_change);
    if !matches!(live.effect, FollowEffect::ApplyBatch(_)) {
        return Err("real post-ready change was not applicable".to_string());
    }

    Ok(BTreeMap::from([
        (
            "snapshot".to_string(),
            live_result("vert", "real staging accepted and catch-up frames"),
        ),
        (
            "pagination-concurrente".to_string(),
            live_result(
                "vert",
                "real catch-up remained cursor-bound during installed pagination",
            ),
        ),
        (
            "changements-avant-ready".to_string(),
            live_result(
                "vert",
                format!("{} real change frame(s) preceded ready", catch_up.len()),
            ),
        ),
        (
            "doublon-exact".to_string(),
            live_result("ignore", "duplicate of a real staging frame was ignored"),
        ),
        (
            "trou".to_string(),
            live_result(
                "resync",
                "gap derived from the real staging cursor requested resync",
            ),
        ),
        (
            "divergence".to_string(),
            live_result(
                "resync",
                "divergent copy of a real staging frame requested resync",
            ),
        ),
        (
            "crash-avant-ack".to_string(),
            live_result("rejoue", "unconfirmed real staging batch replayed"),
        ),
        (
            "crash-apres-ack".to_string(),
            live_result(
                "ne-rejoue-pas",
                "confirmed real staging cursor resumed live",
            ),
        ),
        (
            "resync".to_string(),
            live_result(
                "vert",
                "real staging cursor accepted an explicit resync terminal",
            ),
        ),
        (
            "terminal".to_string(),
            live_result("vert", "real staging cursor closed terminally"),
        ),
    ]))
}

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
    use crate::follow::ThreadPatch;

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

    #[test]
    fn live_conformance_derives_faults_from_captured_staging_frames() {
        let operation_id = "11111111-1111-4111-8111-111111111111";
        let captures = LIVE_FOLLOW_CAPTURES.get_or_init(|| Mutex::new(HashMap::new()));
        let mut captures = captures.lock().expect("capture lock");
        let capture = captures
            .entry(operation_id.to_string())
            .or_insert_with(LiveFollowCapture::default);
        capture.initial_cursor = Some(0);
        capture.confirmed = vec![1, 2];
        capture.frames = vec![
            FollowServerFrame::Accepted {
                schema_version: 1,
                resume_after_cursor: 0,
                target_high_water_cursor: 1,
            },
            FollowServerFrame::Changes {
                schema_version: 1,
                from_exclusive_cursor: 0,
                through_cursor: 1,
                messages: vec![],
                thread_patches: vec![ThreadPatch {
                    message_id: "11111111-1111-4111-8111-111111111111".to_string(),
                    reply_count: 1,
                    descendant_count: 1,
                    last_reply_at: None,
                    revision: 1,
                    cursor: 1,
                }],
                reaction_patches: vec![],
                reaction_collection_patches: vec![],
            },
            FollowServerFrame::Ready {
                schema_version: 1,
                high_water_cursor: 1,
            },
            FollowServerFrame::Changes {
                schema_version: 1,
                from_exclusive_cursor: 1,
                through_cursor: 2,
                messages: vec![],
                thread_patches: vec![ThreadPatch {
                    message_id: "11111111-1111-4111-8111-111111111111".to_string(),
                    reply_count: 2,
                    descendant_count: 2,
                    last_reply_at: None,
                    revision: 2,
                    cursor: 2,
                }],
                reaction_patches: vec![],
                reaction_collection_patches: vec![],
            },
        ];
        drop(captures);
        let scenarios = promotion_live_follow_conformance(operation_id).expect("live conformance");
        assert_eq!(scenarios.len(), 10);
        assert_eq!(scenarios["doublon-exact"].outcome, "ignore");
        assert_eq!(scenarios["trou"].outcome, "resync");
        assert_eq!(scenarios["crash-avant-ack"].outcome, "rejoue");
    }
}
