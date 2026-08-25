use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::{
    message_mutations::canonical_reaction, social_validation::validate_message_view_runtime,
    validate_uuid, ClientFailure, MessageView,
};

/// Typed `punks.follow.v1` server frame.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
pub enum FollowServerFrame {
    Accepted {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "resumeAfterCursor")]
        resume_after_cursor: u64,
        #[serde(rename = "targetHighWaterCursor")]
        target_high_water_cursor: u64,
    },
    Changes {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "fromExclusiveCursor")]
        from_exclusive_cursor: u64,
        #[serde(rename = "throughCursor")]
        through_cursor: u64,
        messages: Vec<MessageView>,
        #[serde(rename = "threadPatches")]
        thread_patches: Vec<ThreadPatch>,
        #[serde(rename = "reactionPatches")]
        reaction_patches: Vec<ReactionPatch>,
        #[serde(rename = "reactionCollectionPatches")]
        reaction_collection_patches: Vec<ReactionCollectionPatch>,
    },
    Ready {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        #[serde(rename = "highWaterCursor")]
        high_water_cursor: u64,
    },
    ResyncRequired {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        reason: ServerResyncReason,
        #[serde(rename = "afterCursor")]
        after_cursor: u64,
        #[serde(rename = "highWaterCursor")]
        high_water_cursor: u64,
    },
    ConversationUnavailable {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        reason: ConversationUnavailableReason,
        cursor: u64,
    },
}

/// Absolute thread counters delivered inside one atomic FOLLOW batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThreadPatch {
    pub message_id: String,
    pub reply_count: u64,
    pub descendant_count: u64,
    pub last_reply_at: Option<String>,
    pub revision: u64,
    pub cursor: u64,
}

/// Absolute Reaction count delivered inside one atomic FOLLOW batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionPatch {
    pub message_id: String,
    pub reaction: String,
    pub count: u64,
    pub reacted_by_punk: bool,
    pub cursor: u64,
}

/// Absolute Reaction collection visibility delivered inside a FOLLOW batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReactionCollectionPatch {
    pub message_id: String,
    pub visibility: String,
    pub cursor: u64,
    pub refresh_required: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerResyncReason {
    HistoryRequired,
    SlowConsumer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationUnavailableReason {
    Archived,
}

/// Typed renderer-confirmed ACK; construction is private to the reducer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowAck {
    schema_version: u8,
    #[serde(rename = "type")]
    frame_type: &'static str,
    through_cursor: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FollowPhase {
    AwaitingAcceptance,
    CatchingUp,
    Live,
    ResyncRequired,
    Terminal,
}

/// Monotone local authority for one Conversation FOLLOW generation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowState {
    pub phase: FollowPhase,
    pub pagination_high_water: u64,
    pub follow_checkpoint: u64,
    pub applied_cursor: u64,
    pub target_high_water_cursor: Option<u64>,
    pub pending_confirmation_cursor: Option<u64>,
    last_batch_signature: Option<String>,
}

impl FollowState {
    pub fn new(pagination_high_water: u64) -> Self {
        Self {
            phase: FollowPhase::AwaitingAcceptance,
            pagination_high_water,
            follow_checkpoint: pagination_high_water,
            applied_cursor: pagination_high_water,
            target_high_water_cursor: None,
            pending_confirmation_cursor: None,
            last_batch_signature: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientResyncReason {
    CursorGap,
    CursorDivergence,
    ProtocolViolation,
    HistoryRequired,
    SlowConsumer,
}

/// Indivisible action emitted by the pure FOLLOW reducer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FollowEffect {
    None,
    ApplyBatch(FollowServerFrame),
    BecameLive,
    Resync {
        reason: ClientResyncReason,
        after_cursor: u64,
        high_water_cursor: u64,
    },
    Terminal {
        reason: ConversationUnavailableReason,
        cursor: u64,
    },
}

impl FollowEffect {
    /// Stable normalized label compared by the common conformance corpus.
    pub fn trace_name(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::ApplyBatch(_) => "apply_batch",
            Self::BecameLive => "became_live",
            Self::Resync {
                reason: ClientResyncReason::CursorGap,
                ..
            } => "resync:cursor_gap",
            Self::Resync {
                reason: ClientResyncReason::CursorDivergence,
                ..
            } => "resync:cursor_divergence",
            Self::Resync {
                reason: ClientResyncReason::ProtocolViolation,
                ..
            } => "resync:protocol_violation",
            Self::Resync {
                reason: ClientResyncReason::HistoryRequired,
                ..
            } => "resync:history_required",
            Self::Resync {
                reason: ClientResyncReason::SlowConsumer,
                ..
            } => "resync:slow_consumer",
            Self::Terminal { .. } => "terminal",
        }
    }
}

pub struct FollowReduction {
    pub state: FollowState,
    pub effect: FollowEffect,
}

pub struct FollowConfirmation {
    pub state: FollowState,
    pub ack: Option<FollowAck>,
}

fn invalid_follow_frame() -> ClientFailure {
    ClientFailure::contract("conversation.follow-server-frame@1")
}

/// Validates the closed FOLLOW contract and its authorized scope before IPC.
pub(crate) fn validate_follow_frame(
    frame: &FollowServerFrame,
    workspace_id: &str,
    conversation_id: &str,
) -> Result<(), ClientFailure> {
    match frame {
        FollowServerFrame::Accepted {
            schema_version,
            resume_after_cursor,
            target_high_water_cursor,
        } => {
            if *schema_version != 1 || target_high_water_cursor < resume_after_cursor {
                return Err(invalid_follow_frame());
            }
        }
        FollowServerFrame::Ready { schema_version, .. }
        | FollowServerFrame::ResyncRequired { schema_version, .. } => {
            if *schema_version != 1 {
                return Err(invalid_follow_frame());
            }
        }
        FollowServerFrame::ConversationUnavailable {
            schema_version,
            cursor,
            ..
        } => {
            if *schema_version != 1 || *cursor < 1 {
                return Err(invalid_follow_frame());
            }
        }
        FollowServerFrame::Changes {
            schema_version,
            from_exclusive_cursor,
            through_cursor,
            messages,
            thread_patches,
            reaction_patches,
            reaction_collection_patches,
        } => {
            if *schema_version != 1
                || *through_cursor <= *from_exclusive_cursor
                || messages.len() > 100
                || thread_patches.len() > 100
                || reaction_patches.len() > 100
                || reaction_collection_patches.len() > 100
            {
                return Err(invalid_follow_frame());
            }

            let mut message_ids = HashSet::with_capacity(messages.len());
            for message in messages {
                validate_message_view_runtime(message, workspace_id, conversation_id)?;
                if message.cursor <= *from_exclusive_cursor
                    || message.cursor > *through_cursor
                    || !message_ids.insert(message.id.as_str())
                {
                    return Err(invalid_follow_frame());
                }
            }

            let mut thread_message_ids = HashSet::with_capacity(thread_patches.len());
            for patch in thread_patches {
                validate_uuid(&patch.message_id, "messageId")?;
                if patch.revision < 1
                    || patch.cursor <= *from_exclusive_cursor
                    || patch.cursor > *through_cursor
                    || !thread_message_ids.insert(patch.message_id.as_str())
                {
                    return Err(invalid_follow_frame());
                }
            }

            let mut reaction_keys = HashSet::with_capacity(reaction_patches.len());
            for patch in reaction_patches {
                validate_uuid(&patch.message_id, "messageId")?;
                let canonical = canonical_reaction(&patch.reaction)?;
                if canonical != patch.reaction
                    || patch.count > 2_147_483_647
                    || patch.cursor <= *from_exclusive_cursor
                    || patch.cursor > *through_cursor
                    || !reaction_keys.insert((patch.message_id.as_str(), patch.reaction.as_str()))
                {
                    return Err(invalid_follow_frame());
                }
            }

            let mut collection_message_ids =
                HashSet::with_capacity(reaction_collection_patches.len());
            for patch in reaction_collection_patches {
                validate_uuid(&patch.message_id, "messageId")?;
                if !matches!(
                    patch.visibility.as_str(),
                    "visible" | "temporarily-hidden" | "permanently-hidden"
                ) || patch.cursor <= *from_exclusive_cursor
                    || patch.cursor > *through_cursor
                    || !collection_message_ids.insert(patch.message_id.as_str())
                {
                    return Err(invalid_follow_frame());
                }
            }
        }
    }
    Ok(())
}

fn resync(
    state: &FollowState,
    reason: ClientResyncReason,
    high_water_cursor: u64,
) -> FollowReduction {
    let mut next = state.clone();
    next.phase = FollowPhase::ResyncRequired;
    FollowReduction {
        state: next,
        effect: FollowEffect::Resync {
            reason,
            after_cursor: state.follow_checkpoint,
            high_water_cursor,
        },
    }
}

/// Reduces one strict server frame without acknowledging renderer work.
pub fn reduce_follow_frame(state: &FollowState, frame: FollowServerFrame) -> FollowReduction {
    if matches!(
        state.phase,
        FollowPhase::ResyncRequired | FollowPhase::Terminal
    ) {
        return FollowReduction {
            state: state.clone(),
            effect: FollowEffect::None,
        };
    }
    match &frame {
        FollowServerFrame::ResyncRequired {
            reason,
            high_water_cursor,
            ..
        } => {
            let reason = match reason {
                ServerResyncReason::HistoryRequired => ClientResyncReason::HistoryRequired,
                ServerResyncReason::SlowConsumer => ClientResyncReason::SlowConsumer,
            };
            resync(state, reason, *high_water_cursor)
        }
        FollowServerFrame::ConversationUnavailable { reason, cursor, .. } => {
            let mut next = state.clone();
            next.phase = FollowPhase::Terminal;
            FollowReduction {
                state: next,
                effect: FollowEffect::Terminal {
                    reason: *reason,
                    cursor: *cursor,
                },
            }
        }
        FollowServerFrame::Accepted {
            schema_version,
            resume_after_cursor,
            target_high_water_cursor,
        } => {
            if *schema_version != 1
                || state.phase != FollowPhase::AwaitingAcceptance
                || *resume_after_cursor != state.applied_cursor
                || target_high_water_cursor < resume_after_cursor
            {
                return resync(
                    state,
                    ClientResyncReason::ProtocolViolation,
                    *target_high_water_cursor,
                );
            }
            let mut next = state.clone();
            next.phase = FollowPhase::CatchingUp;
            next.target_high_water_cursor = Some(*target_high_water_cursor);
            FollowReduction {
                state: next,
                effect: FollowEffect::None,
            }
        }
        FollowServerFrame::Ready {
            schema_version,
            high_water_cursor,
        } => {
            if *schema_version != 1
                || state.phase != FollowPhase::CatchingUp
                || state.pending_confirmation_cursor.is_some()
                || Some(*high_water_cursor) != state.target_high_water_cursor
                || *high_water_cursor != state.applied_cursor
            {
                return resync(
                    state,
                    ClientResyncReason::ProtocolViolation,
                    *high_water_cursor,
                );
            }
            let mut next = state.clone();
            next.phase = FollowPhase::Live;
            FollowReduction {
                state: next,
                effect: FollowEffect::BecameLive,
            }
        }
        FollowServerFrame::Changes {
            schema_version,
            from_exclusive_cursor,
            through_cursor,
            messages,
            thread_patches,
            reaction_patches,
            reaction_collection_patches,
        } => {
            if !matches!(state.phase, FollowPhase::CatchingUp | FollowPhase::Live) {
                return resync(
                    state,
                    ClientResyncReason::ProtocolViolation,
                    *through_cursor,
                );
            }
            let signature = match serde_json::to_string(&frame) {
                Ok(signature) => signature,
                Err(_) => {
                    return resync(
                        state,
                        ClientResyncReason::ProtocolViolation,
                        *through_cursor,
                    )
                }
            };
            if state.last_batch_signature.as_ref() == Some(&signature) {
                return FollowReduction {
                    state: state.clone(),
                    effect: FollowEffect::None,
                };
            }
            if state.pending_confirmation_cursor.is_some()
                || *from_exclusive_cursor < state.applied_cursor
            {
                return resync(state, ClientResyncReason::CursorDivergence, *through_cursor);
            }
            if *from_exclusive_cursor > state.applied_cursor {
                return resync(state, ClientResyncReason::CursorGap, *through_cursor);
            }
            let bounded = messages
                .iter()
                .all(|message| message.cursor <= *through_cursor)
                && thread_patches
                    .iter()
                    .all(|patch| patch.cursor <= *through_cursor)
                && reaction_patches
                    .iter()
                    .all(|patch| patch.cursor <= *through_cursor)
                && reaction_collection_patches
                    .iter()
                    .all(|patch| patch.cursor <= *through_cursor);
            if *schema_version != 1
                || *through_cursor <= *from_exclusive_cursor
                || !bounded
                || (state.phase == FollowPhase::CatchingUp
                    && state
                        .target_high_water_cursor
                        .is_some_and(|target| *through_cursor > target))
            {
                return resync(
                    state,
                    ClientResyncReason::ProtocolViolation,
                    *through_cursor,
                );
            }
            let mut next = state.clone();
            next.applied_cursor = *through_cursor;
            next.pending_confirmation_cursor = Some(*through_cursor);
            next.last_batch_signature = Some(signature);
            FollowReduction {
                state: next,
                effect: FollowEffect::ApplyBatch(frame),
            }
        }
    }
}

/// Produces an ACK only for the exact batch confirmed by the renderer.
pub fn confirm_follow_batch(state: &FollowState, through_cursor: u64) -> FollowConfirmation {
    if state.pending_confirmation_cursor != Some(through_cursor)
        || state.applied_cursor != through_cursor
    {
        let mut next = state.clone();
        next.phase = FollowPhase::ResyncRequired;
        return FollowConfirmation {
            state: next,
            ack: None,
        };
    }
    let mut next = state.clone();
    next.follow_checkpoint = through_cursor;
    next.pending_confirmation_cursor = None;
    FollowConfirmation {
        state: next,
        ack: Some(FollowAck {
            schema_version: 1,
            frame_type: "ack",
            through_cursor,
        }),
    }
}
