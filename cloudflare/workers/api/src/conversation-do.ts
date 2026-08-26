import type {
  AdmitBotActionCommand,
  ArchiveConversationCommand,
  AddMessageReactionCommand,
  AttestationRequest,
  AttestationResponse,
  Conversation,
  ConversationJournalSegmentArchive,
  ConversationFollowServerFrame,
  ConversationProjectionMessage,
  CreateConversationCommand,
  EditMessageCommand,
  FinalizeMessageErasureCommand,
  JoinConversationCommand,
  MessageHistoryQuery,
  MessageHistoryResponse,
  MessageSearchQuery,
  MessageSearchResponse,
  MessageView,
  MessageProjectionMessage,
  MessageReaction,
  MessageReactionMutationResponse,
  MessageReactionProjectionEnvelope,
  PostMessageCommand,
  PresenceTypingPatch,
  RemoveConversationMemberCommand,
  RemoveMessageReactionCommand,
  RetractMessageCommand,
  RestoreConversationCommand,
  RestoreMessageCommand,
  SetConversationMemberAccessCommand,
  SignedNostrEvent,
  ToggleMessageReactionCommand,
  UnsignedNostrEvent,
  UpdateConversationCommand,
  BotActionAdmission,
  BotWakeOffer,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  canonicalMessageReaction,
  authorizeMessageMutation,
  boundedMessageState,
  ConversationDomainError,
  decideArchiveConversation,
  decideCreateConversation,
  decideEditMessage,
  decideFinalizeMessageErasure,
  decideJoinConversation,
  decideAddMessageReaction,
  decideRemoveMessageReaction,
  decideToggleMessageReaction,
  decidePostMessage,
  decideRetractMessage,
  decideRemoveConversationMember,
  decideRestoreConversation,
  decideRestoreMessage,
  decideSetConversationMemberAccess,
  decideUpdateConversation,
  decodeMessageHistoryCursor,
  decodeMessageSearchCursor,
  deriveMessageSearchCursorQueryBinding,
  deriveOpaqueUuid,
  deriveMessageSearchDocument,
  deriveMessageSearchQuery,
  deriveBotActionAdmissionId,
  deriveBotActionDigest,
  deriveBotInstallationId,
  deriveBotWakeId,
  deriveBotWakeOfferDigest,
  deriveBotWakeTurnId,
  encodeMessageSearchCursor,
  messageSearchPlaintextMatchesQuery,
  MESSAGE_SEARCH_ALGORITHM,
  MESSAGE_SEARCH_NORMALIZATION,
  MESSAGE_EVENT_KINDS,
  MESSAGE_REACTION_EVENT_KINDS,
  MessageDomainError,
  MessageReactionDomainError,
  prepareConversationJournalSegment,
  sha256Hex,
  validateBotWakeOffer,
  verifyConversationJournalSegmentHash,
  type WorkspacePermission,
  type Message,
  type MessageDecisionContext,
  type MessageReactionCommandRecord,
  type MessageReactionDecision,
  type MessageReactionDecisionContext,
  type MessageContentVersion,
  type MessageSearchCandidatePosition,
  type MessageSearchCursorScope,
  type PreparedMessageContent,
  type ThreadCounterDelta,
} from "@punks/core";
import { PromotionFaultableDurableObject } from "../../../shared/promotion-faultable-do";

import type {
  ApiEnv,
  MessageCandidateCursor,
  MessageSearchCandidate,
  SearchMessageCandidatesInput,
  SearchMessageCandidatesResult,
} from "./env";
import {
  buildMessageHistoryResponse,
  MESSAGE_HISTORY_MAX_RESPONSE_BYTES,
  MessageHistoryResponseTooLarge,
} from "./message-history";
import { authorizedMessageView } from "./message-view";
import { verifyAttestation } from "./attestation-verification";
import type {
  MessageContentDestructionProof,
  ReadMessageContentResult,
} from "./message-content-do";
import type {
  CommittedConversationCommand,
  CommittedMessagePost,
  CommittedMessageMutation,
  ConversationCommand,
  ConversationExecuteResult,
  ConversationQuery,
  ConversationQueryResult,
  MessagePostResult,
  MessageMutationRequest,
  MessageMutationResult,
  MessageReadRequest,
  MessageReadResult,
  MessageHistoryRequest,
  MessageHistoryResult,
  MessageSearchRequest,
  MessageSearchResult,
  MessageReactionMutationRequest,
  MessageReactionMutationResult,
  PostMessageRequest,
  WorkspaceAuthorizationResult,
  AuthorizeBotGrantResult,
  AuthorizeBotWakeRequest,
  AuthorizeBotWakeResult,
  BotWakeCandidate,
  BotWakeSubscriptionMutationRequest,
  BotWakeSubscriptionMutationResult,
  AcceptBotWakeCandidateResult,
  OfferBotWakeRequest,
  OfferBotWakeResult,
  ReadBotWakeContextRequest,
  ReadBotWakeContextResult,
  ExecuteAdmittedBotReactionRequest,
  ExecuteAdmittedBotReactionResult,
  CompleteBotActionRequest,
  CompleteBotActionResult,
} from "./rpc";

type StateRow = Record<"state_json", string>;
type ResultRow = Record<"payload_hash" | "response_json", string>;
type PendingRow = Record<
  | "command_id"
  | "payload_hash"
  | "command_json"
  | "unsigned_json"
  | "next_state_json"
  | "attempts"
  | "reduction_overlay",
  string | number
>;
type OutboxRow = Record<
  "event_id" | "cursor" | "payload_json" | "attempts",
  string | number
>;
type ContentFinalizationRow = {
  event_id: string;
  workspace_id: string;
  conversation_id: string;
  message_id: string;
  command_id: string;
  content_key_id: string;
  attempts: number;
  next_attempt_at_ms: number;
};
type BotWakeSubscriptionRow = {
  workspace_id: string;
  conversation_id: string;
  bot_id: string;
  installation_id: string;
  epoch: number;
  high_water_cursor: number;
  preparation_id: string | null;
  status: "prepared" | "active" | "disabled";
};
type BotWakeCandidateOutboxRow = {
  wake_id: string;
  installation_id: string;
  message_id: string;
  candidate_json: string;
  attempts: number;
  next_attempt_at: number;
  created_at: string;
};
type BotWakeCandidateSource = {
  conversation: Pick<Conversation, "id" | "workspaceId" | "status">;
  subscription: BotWakeSubscriptionRow;
  message: Message;
  journal: {
    cursor: number;
    event_id: string;
    event_kind: number;
    event_json: string;
  };
  event: SignedNostrEvent;
};
type BotWakeCandidateSourceResult =
  | { ok: true; source: BotWakeCandidateSource }
  | { ok: false; code: "not_found" | "forbidden" | "conflict" };
type JournalRow = Record<"cursor" | "event_json", string | number>;
type FollowChangesFrame = Extract<
  ConversationFollowServerFrame,
  { type: "changes" }
>;
type FollowReactionPatch = FollowChangesFrame["reactionPatches"][number];
type FollowReactionCollectionPatch =
  FollowChangesFrame["reactionCollectionPatches"][number];
type ArchiveHeadRow = Record<"end_cursor" | "segment_hash", string | number>;
type PendingArchiveRow = Record<
  | "start_cursor"
  | "end_cursor"
  | "previous_segment_hash"
  | "segment_hash"
  | "object_key"
  | "events_json"
  | "unsigned_seal_json"
  | "attempts",
  string | number | null
>;
type MessageResultRow = Record<
  "payload_hash" | "request_fingerprint" | "response_json",
  string
>;
type PendingMessageRow = Record<
  | "command_id"
  | "payload_hash"
  | "request_fingerprint"
  | "unsigned_json"
  | "next_message_json"
  | "version_json"
  | "thread_deltas_json"
  | "search_json"
  | "next_conversation_json"
  | "attempts",
  string | number
>;
type MessageReactionRow = {
  reaction_id: string;
  workspace_id: string;
  conversation_id: string;
  message_id: string;
  actor_kind: "punk" | "bot";
  actor_id: string;
  reaction: string;
  status: "active" | "removed";
  revision: number;
  created_cursor: number;
  cursor: number;
  created_at: string;
  reacted_at: string | null;
  updated_at: string;
  removed_at: string | null;
};
type MessageReactionResultRow = {
  semantic_hash: string;
  reaction_id: string;
  command_record_json: string;
  committed_cursor: number | null;
  bot_admission_id: string | null;
  bot_action_digest: string | null;
  bot_outcome: "succeeded" | null;
};
type PendingMessageReactionRow = {
  command_id: string;
  semantic_hash: string;
  reaction_id: string;
  command_json: string;
  command_record_json: string;
  unsigned_json: string;
  next_reaction_json: string;
  projection_delta_json: string;
  next_conversation_json: string;
  attempts: number;
};
type PendingBotReactionRow = PendingMessageReactionRow & {
  request_json: string;
};
type BotActionCompletionRow = {
  admission_id: string;
  request_json: string;
  outcome: "succeeded" | "failed";
  delivered_at: string | null;
  attempts: number;
  next_attempt_at: number;
};
const MAX_PENDING_BOT_ACTION_COMPLETIONS = 1_024;
const MAX_ACTIVE_OR_PREPARED_BOT_WAKE_SUBSCRIPTIONS = 128;
const MAX_BOT_WAKE_SUBSCRIPTION_ROWS = 256;
const MAX_BOT_WAKE_CANDIDATE_OUTBOX_ROWS = 256;
const MAX_BOT_WAKE_CANDIDATE_OUTBOX_BYTES = 1_048_576;
const MAX_BOT_WAKE_CANDIDATE_OUTBOX_ROW_BYTES = 4_096;
const MAX_BOT_WAKE_CANDIDATE_DELIVERIES_PER_ALARM = 20;
type MessageRow = {
  message_id: string;
  workspace_id: string;
  conversation_id: string;
  author_json: string;
  message_type: Message["messageType"];
  status: Message["status"];
  topic_present: number;
  mentioned_punk_ids_json: string;
  media_ids_json: string;
  parent_message_id: string | null;
  thread_root_message_id: string;
  thread_depth: number;
  broadcast: number;
  reply_count: number;
  descendant_count: number;
  last_reply_at: string | null;
  original_content_commitment: string | null;
  current_version: number | null;
  retraction_json: string | null;
  erasure_marker_json: string | null;
  revision: number;
  created_cursor: number;
  cursor: number;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
};

type CommittedThreadDelta = {
  messageId: string;
  replyCountDelta: -1 | 0 | 1;
  descendantCountDelta: -1 | 0 | 1;
  lastReplyAt: string | null;
  revision: number;
  cursor: number;
  updatedAt: string;
};

type MessageErasureScheduleRow = {
  message_id: string;
  retraction_command_id: string;
  erase_after: string;
  attempts: number;
  next_attempt_at_ms: number;
};

type PendingMessageErasure = {
  kind: "message-erasure-pending";
  messageId: string;
  retractionCommandId: string;
  eraseAfter: string;
  expectedContentKeyIds: string[];
};

type FollowAttachment = {
  schemaVersion: 1;
  workspaceId: string;
  conversationId: string;
  punkId: string;
  sessionId: string;
  sessionExpiresAt: string;
  phase: "catch-up" | "live" | "pumping-catch-up" | "pumping-live";
  lastAck: number;
  lastSent: number;
  targetHighWater: number;
  ackDeadlineAt: number | null;
  pumpDeadlineAt: number | null;
};

type FollowAuthorization =
  | { status: "active"; state: Conversation }
  | { status: "archived"; state: Conversation }
  | { status: "denied" };

type PreparedSearchItem = {
  candidate: MessageSearchCandidate;
  version: MessageContentVersion;
  payload: {
    schemaVersion: 1;
    content: string;
    topic: string | null;
  };
  view: MessageSearchResponse["items"][number];
};

type SearchCandidatePreparation =
  | { ok: true; item: PreparedSearchItem | null }
  | {
      ok: false;
      code: "not_found" | "forbidden" | "content_unavailable" | "internal";
    };

interface TypingPatchInput {
  patch: PresenceTypingPatch;
  sessionId: string | null;
}

function parseTypingPatchInput(input: unknown): TypingPatchInput | null {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    !("patch" in input) ||
    !("sessionId" in input) ||
    !validateContract("punks://contracts/presence.typing.patch@1", input.patch)
      .valid ||
    (typeof input.sessionId !== "string" && input.sessionId !== null)
  ) {
    return null;
  }
  return {
    patch: input.patch as PresenceTypingPatch,
    sessionId: input.sessionId,
  };
}

const FOLLOW_PROTOCOL = "punks.follow.v1";
const MAX_TYPING_DELIVERY_FENCES = 10_000;
const MESSAGE_SEARCH_MAX_CANDIDATE_BUDGET = 400;
const MESSAGE_SEARCH_MIN_CANDIDATE_BUDGET = 4;
const MESSAGE_SEARCH_CANDIDATE_FILL_FACTOR = 4;
const MESSAGE_SEARCH_BATCH_SIZE = 100;
const MESSAGE_SEARCH_MAX_RESPONSE_BYTES = 1_048_576;
const MESSAGE_SEARCH_SIZE_MARGIN_BYTES = 4_096;
const MESSAGE_SEARCH_MAX_CURSOR_PLACEHOLDER = "m".repeat(1_024);
const CONVERSATION_ARCHIVE_MAX_BODY_BYTES = 4_500_000;
const MAXIMUM_PROJECTION_PAYLOAD_BYTES = 126_000;
const MAXIMUM_NORMAL_UNDELIVERED_OUTBOX_ROWS = 256;
const MAXIMUM_NORMAL_UNDELIVERED_OUTBOX_BYTES = 2_097_152;
const MAXIMUM_UNDELIVERED_OUTBOX_ROWS = 4_096;
const MAXIMUM_UNDELIVERED_OUTBOX_BYTES = 516_096_000;
const MAXIMUM_NORMAL_REACTION_RESULT_ROWS = 256;
const MAXIMUM_NORMAL_REACTION_RESULT_BYTES = 8_388_608;
const MAXIMUM_REACTION_RESULT_ROWS = 4_096;
const MAXIMUM_REACTION_RESULT_BYTES = 134_217_728;
const MAXIMUM_REACTION_RESULT_ROW_BYTES = 32_768;
const MAXIMUM_NORMAL_MESSAGE_RESULT_ROWS = 256;
const MAXIMUM_NORMAL_MESSAGE_RESULT_BYTES = 67_108_864;
const MAXIMUM_MESSAGE_RESULT_ROWS = 4_096;
const MAXIMUM_MESSAGE_RESULT_BYTES = 1_073_741_824;
const MAXIMUM_MESSAGE_RESULT_ROW_BYTES = 262_144;
const MAXIMUM_NORMAL_CONVERSATION_RESULT_ROWS = 256;
const MAXIMUM_NORMAL_CONVERSATION_RESULT_BYTES = 67_108_864;
const MAXIMUM_CONVERSATION_RESULT_ROWS = 4_096;
const MAXIMUM_CONVERSATION_RESULT_BYTES = 1_073_741_824;
const MAXIMUM_CONVERSATION_RESULT_ROW_BYTES = 262_144;
const MAXIMUM_CONTENT_FINALIZATION_ROWS = 256;
const MAXIMUM_CONTENT_FINALIZATION_BYTES = 16_777_216;
const MAXIMUM_CONTENT_FINALIZATION_ROW_BYTES = 4_096;
const MAXIMUM_RETRY_ATTEMPTS = 63;

const commandContracts = {
  "conversation.archive@1": "punks://contracts/conversation.archive@1",
  "conversation.create@1": "punks://contracts/conversation.create@1",
  "conversation.join@1": "punks://contracts/conversation.join@1",
  "conversation.member-set-access@1":
    "punks://contracts/conversation.member-set-access@1",
  "conversation.member-remove@1":
    "punks://contracts/conversation.member-remove@1",
  "conversation.restore@1": "punks://contracts/conversation.restore@1",
  "conversation.update@1": "punks://contracts/conversation.update@1",
} as const;

export class ConversationDO extends PromotionFaultableDurableObject<ApiEnv> {
  protected override async promotionRecoveryFingerprint(): Promise<string> {
    const current = this.effectiveState();
    if (current === null)
      throw new Error("promotion Conversation target is missing");
    return sha256Hex(canonicalJson(current));
  }

  private alarmScheduling: Promise<void> = Promise.resolve();
  private legacyRequiredOriginalContentCommitment = false;
  private readonly typingDeliveryFences = new Map<
    string,
    PresenceTypingPatch
  >();

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    this.ctx.blockConcurrencyWhile(async () => {
      this.initialize();
      await this.repairDurableAlarm();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (
      request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.get("sec-websocket-protocol") !== FOLLOW_PROTOCOL
    ) {
      return new Response("Not found", { status: 404 });
    }
    const workspaceId =
      request.headers.get("x-punks-follow-workspace-id") ?? "";
    const conversationId =
      request.headers.get("x-punks-follow-conversation-id") ?? "";
    const punkId = request.headers.get("x-punks-follow-punk-id") ?? "";
    const sessionId = request.headers.get("x-punks-follow-session-id") ?? "";
    const sessionExpiresAt =
      request.headers.get("x-punks-follow-session-expires-at") ?? "";
    const afterCursor = Number(
      request.headers.get("x-punks-follow-after-cursor") ?? "NaN",
    );
    const state = this.effectiveState();
    if (
      state === null ||
      state.id !== conversationId ||
      state.workspaceId !== workspaceId ||
      state.status !== "active" ||
      !Number.isSafeInteger(afterCursor) ||
      afterCursor < 0 ||
      afterCursor > state.cursor
    ) {
      return new Response("Not found", { status: 404 });
    }
    const session = await this.env.AUTH_SERVICE.resolveSessionId(sessionId);
    if (
      session === null ||
      !validateContract("punks://contracts/auth.session@1", session).valid ||
      session.sessionId !== sessionId ||
      session.punkId !== punkId ||
      session.expiresAt !== sessionExpiresAt ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      return new Response("Unauthenticated", { status: 401 });
    }
    let rawAuthorization: unknown;
    try {
      rawAuthorization = await this.env.WORKSPACES.getByName(
        workspaceId,
      ).authorize({ workspaceId, punkId, permission: "workspace.read" });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
    const authorization =
      validateSearchWorkspaceAuthorization(rawAuthorization);
    const finalState = this.effectiveState();
    if (
      authorization?.ok !== true ||
      finalState === null ||
      finalState.status !== "active" ||
      !canReadConversation(finalState, punkId)
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    const targetHighWater = this.visibleHighWaterCursor(finalState.cursor);
    if (afterCursor > targetHighWater) {
      return new Response("Resume cursor is not yet publicly visible", {
        status: 409,
      });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server, [
      `punk:${punkId}`,
      `session:${sessionId}`,
    ]);
    const attachment: FollowAttachment = {
      schemaVersion: 1,
      workspaceId,
      conversationId,
      punkId,
      sessionId,
      sessionExpiresAt,
      phase: "catch-up",
      lastAck: afterCursor,
      lastSent: afterCursor,
      targetHighWater,
      ackDeadlineAt: null,
      pumpDeadlineAt: null,
    };
    server.serializeAttachment(attachment);
    let registered: boolean;
    try {
      registered = await this.env.WORKSPACES.getByName(
        workspaceId,
      ).registerRealtimeRevocationTarget({
        workspaceId,
        conversationId,
        punkId,
        sessionId,
        sessionExpiresAt,
      });
    } catch {
      server.close(1013, "realtime revocation registry unavailable");
      return new Response("Realtime capacity unavailable", { status: 503 });
    }
    if (!registered || server.readyState !== WebSocket.OPEN) {
      server.close(1008, "authorization revoked");
      return new Response("Forbidden", { status: 403 });
    }
    this.sendFollowFrame(server, {
      schemaVersion: 1,
      type: "accepted",
      resumeAfterCursor: afterCursor,
      targetHighWaterCursor: targetHighWater,
    });
    try {
      const typing =
        await this.env.PRESENCE.getByName(workspaceId).currentTyping(
          conversationId,
        );
      const finalAuthorization = await this.authorizeFollower(attachment);
      if (finalAuthorization.status === "archived") {
        this.sendConversationUnavailable(
          server,
          finalAuthorization.state.cursor,
        );
      } else if (finalAuthorization.status === "denied") {
        server.close(1008, "authorization revoked");
      } else if (Array.isArray(typing) && typing.length <= 100) {
        for (const patch of typing) {
          if (
            validateContract("punks://contracts/presence.typing.patch@1", patch)
              .valid
          ) {
            this.sendFollowFrame(server, {
              schemaVersion: 1,
              type: "typing",
              patch,
            });
          }
        }
      }
    } catch {
      // Presence is deliberately lossy and never blocks authoritative FOLLOW.
    }
    this.ctx.waitUntil(this.pumpFollower(server));
    return new Response(null, {
      status: 101,
      headers: { "sec-websocket-protocol": FOLLOW_PROTOCOL },
      webSocket: client,
    });
  }

  /** Authorizes a typing intent before Presence makes it snapshot-visible. */
  async authorizeTypingPatch(input: unknown): Promise<{ ok: boolean }> {
    return { ok: (await this.authorizedTypingPatch(input)) !== null };
  }

  /** Closes every live follower for one Workspace Punk before access removal commits. */
  revokeWorkspaceAccess(input: unknown): boolean {
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      !["punkId,workspaceId", "punkId,sessionId,workspaceId"].includes(
        Object.keys(input).sort().join(","),
      )
    ) {
      return false;
    }
    const request = input as Record<string, unknown>;
    if (
      typeof request.workspaceId !== "string" ||
      typeof request.punkId !== "string" ||
      (request.sessionId !== undefined && typeof request.sessionId !== "string")
    ) {
      return false;
    }
    for (const socket of this.ctx.getWebSockets(`punk:${request.punkId}`)) {
      const attachment = parseFollowAttachment(socket.deserializeAttachment());
      if (
        attachment?.workspaceId === request.workspaceId &&
        attachment.punkId === request.punkId &&
        (request.sessionId === undefined ||
          attachment.sessionId === request.sessionId) &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1008, "authorization revoked");
      }
    }
    return true;
  }

  /** Best-effort ephemeral patch accepted only from the Workspace PresenceDO. */
  async publishTypingPatch(input: unknown): Promise<{ ok: boolean }> {
    const authorized = await this.authorizedTypingPatch(input);
    if (authorized === null) return { ok: false };
    const { patch } = authorized;
    const fence = this.claimTypingDeliveryFence(patch);
    if (fence === "capacity") return { ok: false };
    if (fence === "stale") return { ok: true };

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parseFollowAttachment(socket.deserializeAttachment());
      if (attachment === null) {
        socket.close(1008, "invalid attachment");
        continue;
      }
      const authorization = await this.authorizeFollower(attachment);
      if (
        authorization.status === "active" &&
        this.isCurrentTypingDelivery(patch)
      ) {
        this.sendFollowFrame(socket, {
          schemaVersion: 1,
          type: "typing",
          patch,
        });
      } else if (authorization.status === "denied") {
        socket.close(1008, "authorization revoked");
      }
    }
    return { ok: true };
  }

  private async authorizedTypingPatch(
    input: unknown,
  ): Promise<TypingPatchInput | null> {
    const parsed = parseTypingPatchInput(input);
    if (parsed === null) return null;
    const { patch, sessionId } = parsed;
    const state = this.effectiveState();
    if (
      state === null ||
      state.status !== "active" ||
      state.id !== patch.conversationId ||
      state.workspaceId !== patch.workspaceId
    ) {
      return null;
    }
    if (typeof sessionId === "string") {
      let session: Awaited<
        ReturnType<ApiEnv["AUTH_SERVICE"]["resolveSessionId"]>
      >;
      try {
        session = await this.env.AUTH_SERVICE.resolveSessionId(sessionId);
      } catch {
        return null;
      }
      if (
        session === null ||
        !validateContract("punks://contracts/auth.session@1", session).valid ||
        session.sessionId !== sessionId ||
        session.punkId !== patch.punkId ||
        Date.parse(session.expiresAt) <= Date.now() ||
        !canReadConversation(state, patch.punkId)
      ) {
        return null;
      }
      try {
        const authorization = await this.env.WORKSPACES.getByName(
          patch.workspaceId,
        ).authorize({
          workspaceId: patch.workspaceId,
          punkId: patch.punkId,
          permission: "workspace.read",
        });
        if (validateSearchWorkspaceAuthorization(authorization)?.ok !== true) {
          return null;
        }
      } catch {
        return null;
      }
    } else if (patch.active || sessionId !== null) {
      return null;
    }
    return parsed;
  }

  private claimTypingDeliveryFence(
    patch: PresenceTypingPatch,
  ): "current" | "stale" | "capacity" {
    const current = this.typingDeliveryFences.get(patch.punkId);
    if (current !== undefined) {
      if (
        patch.leaseGeneration < current.leaseGeneration ||
        (patch.leaseGeneration === current.leaseGeneration &&
          patch.sequence <= current.sequence)
      ) {
        return "stale";
      }
    } else if (this.typingDeliveryFences.size >= MAX_TYPING_DELIVERY_FENCES) {
      return "capacity";
    }
    this.typingDeliveryFences.set(patch.punkId, patch);
    return "current";
  }

  private isCurrentTypingDelivery(patch: PresenceTypingPatch): boolean {
    const current = this.typingDeliveryFences.get(patch.punkId);
    return (
      current?.leaseGeneration === patch.leaseGeneration &&
      current.sequence === patch.sequence
    );
  }

  private visibleHighWaterCursor(aggregateCursor: number): number {
    const blockedCursor = this.ctx.storage.sql
      .exec<{ cursor: number | null }>(
        `SELECT MIN(outbox.cursor) AS cursor
         FROM outbox JOIN content_finalization
           ON content_finalization.event_id = outbox.event_id`,
      )
      .toArray()[0]?.cursor;
    return typeof blockedCursor === "number"
      ? Math.max(0, Math.min(aggregateCursor, blockedCursor - 1))
      : aggregateCursor;
  }

  private sendFollowFrame(
    socket: WebSocket,
    frame: ConversationFollowServerFrame,
  ): void {
    if (
      !validateContract(
        "punks://contracts/conversation.follow-server-frame@1",
        frame,
      ).valid
    ) {
      throw new Error("Conversation follow frame violated its contract");
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  private async pumpFollower(socket: WebSocket): Promise<void> {
    const attachment = parseFollowAttachment(socket.deserializeAttachment());
    if (attachment === null) {
      socket.close(1008, "invalid attachment");
      return;
    }
    if (
      attachment.phase === "pumping-catch-up" ||
      attachment.phase === "pumping-live"
    ) {
      return;
    }
    if (attachment.lastAck < attachment.lastSent) {
      return;
    }
    const claimed = {
      ...attachment,
      phase: attachment.phase,
    } satisfies FollowAttachment & { phase: "catch-up" | "live" };
    const pumpDeadlineAt = Date.now() + 30_000;
    socket.serializeAttachment({
      ...claimed,
      phase: `pumping-${claimed.phase}`,
      pumpDeadlineAt,
    } satisfies FollowAttachment);
    try {
      await this.ensureAlarmAt(pumpDeadlineAt);
    } catch {
      socket.close(1011, "follower watchdog unavailable");
      return;
    }
    try {
      await this.pumpClaimedFollower(socket, claimed);
    } catch {
      socket.close(1011, "follower pump failed");
    }
  }

  private async pumpClaimedFollower(
    socket: WebSocket,
    attachment: FollowAttachment & { phase: "catch-up" | "live" },
  ): Promise<void> {
    const authorization = await this.authorizeFollower(attachment);
    if (authorization.status === "denied") {
      socket.close(1008, "authorization revoked");
      return;
    }
    if (authorization.status === "archived") {
      this.sendConversationUnavailable(socket, authorization.state.cursor);
      return;
    }
    const hotFloor = this.hotJournalFloor();
    const visibleHighWater = this.visibleHighWaterCursor(
      authorization.state.cursor,
    );
    if (attachment.lastAck < hotFloor) {
      this.sendFollowFrame(socket, {
        schemaVersion: 1,
        type: "resync-required",
        reason: "history_required",
        afterCursor: attachment.lastAck,
        highWaterCursor: visibleHighWater,
      });
      socket.close(1000, "history resync required");
      return;
    }
    const targetHighWater =
      attachment.phase === "catch-up"
        ? attachment.targetHighWater
        : Math.max(attachment.targetHighWater, visibleHighWater);
    if (attachment.lastSent < targetHighWater) {
      const batch = await this.followBatch(attachment, targetHighWater);
      if (batch === null) {
        socket.close(1013, "authorized content temporarily unavailable");
        return;
      }
      const finalAuthorization = await this.authorizeFollower(attachment);
      if (finalAuthorization.status !== "active") {
        if (finalAuthorization.status === "archived") {
          this.sendConversationUnavailable(
            socket,
            finalAuthorization.state.cursor,
          );
        } else {
          socket.close(1008, "authorization revoked");
        }
        return;
      }
      const stableFrame = this.stabilizeFollowFrame(
        batch.frame,
        attachment.punkId,
      );
      this.sendFollowFrame(socket, stableFrame);
      const deadline = Date.now() + 30_000;
      socket.serializeAttachment({
        ...attachment,
        targetHighWater,
        lastSent: stableFrame.throughCursor,
        ackDeadlineAt: deadline,
        pumpDeadlineAt: null,
      } satisfies FollowAttachment);
      this.scheduleAlarm(30_000);
      return;
    }
    const stableState = this.effectiveState();
    if (stableState === null || stableState.status !== "active") {
      if (stableState?.status === "archived") {
        this.sendConversationUnavailable(socket, stableState.cursor);
      } else {
        socket.close(1008, "conversation unavailable");
      }
      return;
    }
    const stableHighWater = this.visibleHighWaterCursor(stableState.cursor);
    if (attachment.phase === "live" && stableHighWater > targetHighWater) {
      socket.serializeAttachment({
        ...attachment,
        targetHighWater: stableHighWater,
        pumpDeadlineAt: null,
      } satisfies FollowAttachment);
      await this.pumpFollower(socket);
      return;
    }
    if (attachment.phase === "catch-up") {
      this.sendFollowFrame(socket, {
        schemaVersion: 1,
        type: "ready",
        highWaterCursor: targetHighWater,
      });
    }
    const liveAttachment = {
      ...attachment,
      phase: "live",
      targetHighWater,
      ackDeadlineAt: null,
      pumpDeadlineAt: null,
    } satisfies FollowAttachment;
    socket.serializeAttachment(liveAttachment);
    if (attachment.phase === "catch-up" && stableHighWater > targetHighWater) {
      this.ctx.waitUntil(this.pumpFollower(socket));
    }
  }

  override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (
      typeof message !== "string" ||
      new TextEncoder().encode(message).byteLength > 2_048
    ) {
      socket.close(1008, "invalid acknowledgement");
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(message) as unknown;
    } catch {
      socket.close(1008, "invalid acknowledgement");
      return;
    }
    if (
      !validateContract(
        "punks://contracts/conversation.follow-client-frame@1",
        frame,
      ).valid
    ) {
      socket.close(1008, "invalid acknowledgement");
      return;
    }
    const attachment = parseFollowAttachment(socket.deserializeAttachment());
    if (attachment === null) {
      socket.close(1008, "invalid attachment");
      return;
    }
    if (attachment.phase.startsWith("pumping-")) {
      socket.close(1008, "acknowledgement during follower pump");
      return;
    }
    const throughCursor = Reflect.get(frame as object, "throughCursor");
    if (
      typeof throughCursor !== "number" ||
      throughCursor < attachment.lastAck ||
      throughCursor > attachment.lastSent
    ) {
      socket.close(1008, "invalid acknowledgement");
      return;
    }
    const acknowledged = {
      ...attachment,
      lastAck: throughCursor,
      ackDeadlineAt:
        throughCursor === attachment.lastSent ? null : attachment.ackDeadlineAt,
    } satisfies FollowAttachment;
    socket.serializeAttachment(acknowledged);
    if (throughCursor === attachment.lastSent) {
      await this.pumpFollower(socket);
    }
  }

  override webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
  ): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(code, reason);
    }
  }

  override webSocketError(socket: WebSocket): void {
    socket.close(1011, "websocket error");
  }

  private async authorizeFollower(
    attachment: FollowAttachment,
  ): Promise<FollowAuthorization> {
    let session: Awaited<
      ReturnType<ApiEnv["AUTH_SERVICE"]["resolveSessionId"]>
    >;
    try {
      session = await this.env.AUTH_SERVICE.resolveSessionId(
        attachment.sessionId,
      );
    } catch {
      return { status: "denied" };
    }
    if (
      session === null ||
      !validateContract("punks://contracts/auth.session@1", session).valid ||
      session.sessionId !== attachment.sessionId ||
      session.punkId !== attachment.punkId ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      return { status: "denied" };
    }
    let rawWorkspaceAuthorization: unknown;
    try {
      rawWorkspaceAuthorization = await this.env.WORKSPACES.getByName(
        attachment.workspaceId,
      ).authorize({
        workspaceId: attachment.workspaceId,
        punkId: attachment.punkId,
        permission: "workspace.read",
      });
    } catch {
      return { status: "denied" };
    }
    const workspaceAuthorization = validateSearchWorkspaceAuthorization(
      rawWorkspaceAuthorization,
    );
    const state = this.effectiveState();
    if (
      workspaceAuthorization?.ok !== true ||
      state === null ||
      state.id !== attachment.conversationId ||
      state.workspaceId !== attachment.workspaceId ||
      !canReadConversation(state, attachment.punkId)
    ) {
      return { status: "denied" };
    }
    return state.status === "archived"
      ? { status: "archived", state }
      : { status: "active", state };
  }

  private hotJournalFloor(): number {
    return (
      this.ctx.storage.sql
        .exec<{ floor: number | null }>(
          "SELECT MAX(end_cursor) AS floor FROM archive_segments",
        )
        .toArray()[0]?.floor ?? 0
    );
  }

  private async followBatch(
    attachment: FollowAttachment,
    targetHighWater: number,
  ): Promise<{
    frame: Extract<ConversationFollowServerFrame, { type: "changes" }>;
  } | null> {
    const rows = this.ctx.storage.sql
      .exec<JournalRow>(
        `SELECT cursor, event_json FROM journal
         WHERE cursor > ? AND cursor <= ? ORDER BY cursor LIMIT 100`,
        attachment.lastSent,
        targetHighWater,
      )
      .toArray();
    if (rows.length === 0) {
      return {
        frame: {
          schemaVersion: 1,
          type: "changes",
          fromExclusiveCursor: attachment.lastSent,
          throughCursor: targetHighWater,
          messages: [],
          threadPatches: [],
          reactionPatches: [],
          reactionCollectionPatches: [],
        },
      };
    }
    let throughCursor = attachment.lastSent;
    const messageIds: string[] = [];
    const reactionIds: string[] = [];
    const reactionCollectionCandidates = new Map<
      string,
      { cursor: number; refreshRequired: boolean }
    >();
    for (const row of rows) {
      let event: SignedNostrEvent;
      try {
        event = JSON.parse(String(row.event_json)) as SignedNostrEvent;
      } catch {
        return null;
      }
      const rowCursor = Number(row.cursor);
      const messageId = event.tags.find((tag) => tag[0] === "message")?.[1];
      if (
        event.kind === MESSAGE_REACTION_EVENT_KINDS.reactionAdded ||
        event.kind === MESSAGE_REACTION_EVENT_KINDS.reactionRemoved
      ) {
        const reactionId = event.tags.find(
          (tag) => tag[0] === "reaction_entity",
        )?.[1];
        if (typeof messageId !== "string" || typeof reactionId !== "string") {
          return null;
        }
        reactionIds.push(reactionId);
        throughCursor = rowCursor;
        continue;
      }
      if (typeof messageId === "string" && isMessageJournalKind(event.kind)) {
        messageIds.push(messageId);
        if (event.kind !== MESSAGE_EVENT_KINDS.messageEdited) {
          reactionCollectionCandidates.set(messageId, {
            cursor: rowCursor,
            refreshRequired: event.kind === MESSAGE_EVENT_KINDS.messageRestored,
          });
        }
        throughCursor = rowCursor;
        break;
      }
      throughCursor = rowCursor;
    }
    const messages: MessageView[] = [];
    for (const messageId of new Set(messageIds)) {
      const view = await this.followMessageView(
        messageId,
        attachment,
        throughCursor,
      );
      if (view === undefined) {
        continue;
      }
      if (view === null) {
        return null;
      }
      messages.push(view);
    }
    const mainIds = new Set(messages.map((message) => message.id));
    const threadPatches = this.ctx.storage.sql
      .exec<Record<"message_id", string>>(
        `SELECT message_id FROM messages
         WHERE cursor > ? AND cursor <= ? ORDER BY cursor, message_id LIMIT 100`,
        attachment.lastSent,
        throughCursor,
      )
      .toArray()
      .map((row) => this.message(row.message_id))
      .filter(
        (message): message is Message =>
          message !== null && !mainIds.has(message.id),
      )
      .map((message) => ({
        messageId: message.id,
        replyCount: message.replyCount,
        descendantCount: message.descendantCount,
        lastReplyAt: message.lastReplyAt,
        revision: message.revision,
        cursor: message.cursor,
      }));
    const reactionPatches = this.followReactionPatches(
      reactionIds,
      attachment.punkId,
      throughCursor,
    );
    const reactionCollectionPatches = this.followReactionCollectionPatches(
      reactionCollectionCandidates,
      throughCursor,
    );
    const frame = {
      schemaVersion: 1 as const,
      type: "changes" as const,
      fromExclusiveCursor: attachment.lastSent,
      throughCursor,
      messages,
      threadPatches,
      reactionPatches,
      reactionCollectionPatches,
    };
    if (new TextEncoder().encode(JSON.stringify(frame)).byteLength > 262_144) {
      return null;
    }
    return { frame };
  }

  private stabilizeFollowFrame(
    frame: FollowChangesFrame,
    punkId: string,
  ): FollowChangesFrame {
    const messages: MessageView[] = [];
    for (const view of frame.messages) {
      const current = this.message(view.id);
      if (current === null || current.cursor > frame.throughCursor) {
        continue;
      }
      if (current.status === "active") {
        if (
          view.status !== "active" ||
          view.cursor !== current.cursor ||
          view.revision !== current.revision ||
          view.currentVersion !== current.currentVersion
        ) {
          continue;
        }
        messages.push(view);
        continue;
      }
      const tombstone = authorizedMessageView(
        boundedMessageState(current),
        null,
      );
      if (
        validateContract("punks://contracts/message.view@1", tombstone).valid
      ) {
        messages.push(tombstone);
      }
    }
    const mainIds = new Set(messages.map((message) => message.id));
    const threadPatches = this.ctx.storage.sql
      .exec<Record<"message_id", string>>(
        `SELECT message_id FROM messages
         WHERE cursor > ? AND cursor <= ? ORDER BY cursor, message_id LIMIT 100`,
        frame.fromExclusiveCursor,
        frame.throughCursor,
      )
      .toArray()
      .map((row) => this.message(row.message_id))
      .filter(
        (message): message is Message =>
          message !== null && !mainIds.has(message.id),
      )
      .map((message) => ({
        messageId: message.id,
        replyCount: message.replyCount,
        descendantCount: message.descendantCount,
        lastReplyAt: message.lastReplyAt,
        revision: message.revision,
        cursor: message.cursor,
      }));
    const reactionPatches = this.stabilizeFollowReactionPatches(
      frame.reactionPatches,
      punkId,
      frame.throughCursor,
    );
    const reactionCollectionPatches =
      this.stabilizeFollowReactionCollectionPatches(
        frame.reactionCollectionPatches,
        frame.throughCursor,
      );
    return {
      ...frame,
      messages,
      threadPatches,
      reactionPatches,
      reactionCollectionPatches,
    };
  }

  private followReactionPatches(
    reactionIds: readonly string[],
    punkId: string,
    throughCursor: number,
  ): FollowReactionPatch[] {
    const patches = new Map<string, FollowReactionPatch>();
    for (const reactionId of reactionIds) {
      const reaction = this.ctx.storage.sql
        .exec<MessageReactionRow>(
          `SELECT reaction_id, workspace_id, conversation_id, message_id,
                  actor_kind, actor_id, reaction, status, revision,
                  created_cursor, cursor, created_at, reacted_at, updated_at,
                  removed_at
           FROM message_reactions WHERE reaction_id = ?`,
          reactionId,
        )
        .toArray()[0];
      if (
        reaction === undefined ||
        reaction.conversation_id !== this.ctx.id.name
      ) {
        continue;
      }
      const key = `${reaction.message_id}\u0000${reaction.reaction}`;
      if (patches.has(key)) {
        continue;
      }
      const patch = this.followReactionCoordinatePatch(
        reaction.message_id,
        reaction.reaction,
        punkId,
        throughCursor,
      );
      if (patch !== null) {
        patches.set(key, patch);
      }
    }
    return [...patches.values()].slice(0, 100);
  }

  private followReactionCoordinatePatch(
    messageId: string,
    reaction: string,
    punkId: string,
    throughCursor: number,
  ): FollowReactionPatch | null {
    const conversation = this.effectiveState();
    if (conversation === null) {
      return null;
    }
    const count = this.ctx.storage.sql
      .exec<{ active_count: number; last_cursor: number }>(
        `SELECT active_count, last_cursor FROM message_reaction_counts
         WHERE message_id = ? AND reaction = ?`,
        messageId,
        reaction,
      )
      .toArray()[0];
    const visibility = this.ctx.storage.sql
      .exec<{ visibility: string; last_cursor: number }>(
        `SELECT visibility, last_cursor FROM message_reaction_visibility
         WHERE message_id = ?`,
        messageId,
      )
      .toArray()[0];
    if (
      count === undefined ||
      visibility === undefined ||
      count.last_cursor > throughCursor ||
      visibility.last_cursor > throughCursor ||
      visibility.visibility !== "visible"
    ) {
      return null;
    }
    const reactedByPunk =
      this.ctx.storage.sql
        .exec<{ present: number }>(
          `SELECT EXISTS(
             SELECT 1 FROM message_reactions
             WHERE workspace_id = ? AND conversation_id = ?
               AND message_id = ? AND reaction = ? AND actor_kind = 'punk'
               AND actor_id = ? AND status = 'active'
           ) AS present`,
          conversation.workspaceId,
          conversation.id,
          messageId,
          reaction,
          punkId,
        )
        .one().present === 1;
    return {
      messageId,
      reaction,
      count: count.active_count,
      reactedByPunk,
      cursor: count.last_cursor,
    };
  }

  private followReactionCollectionPatches(
    candidates: ReadonlyMap<
      string,
      { cursor: number; refreshRequired: boolean }
    >,
    throughCursor: number,
  ): FollowReactionCollectionPatch[] {
    const patches: FollowReactionCollectionPatch[] = [];
    for (const [messageId, candidate] of candidates) {
      const visibility = this.ctx.storage.sql
        .exec<{
          visibility: FollowReactionCollectionPatch["visibility"];
          last_cursor: number;
        }>(
          `SELECT visibility, last_cursor FROM message_reaction_visibility
           WHERE message_id = ?`,
          messageId,
        )
        .toArray()[0];
      if (
        visibility === undefined ||
        visibility.last_cursor !== candidate.cursor ||
        visibility.last_cursor > throughCursor
      ) {
        continue;
      }
      patches.push({
        messageId,
        visibility: visibility.visibility,
        cursor: visibility.last_cursor,
        refreshRequired: candidate.refreshRequired,
      });
    }
    return patches.slice(0, 100);
  }

  private stabilizeFollowReactionPatches(
    patches: readonly FollowReactionPatch[],
    punkId: string,
    throughCursor: number,
  ): FollowReactionPatch[] {
    const stable: FollowReactionPatch[] = [];
    for (const patch of patches) {
      const current = this.followReactionCoordinatePatch(
        patch.messageId,
        patch.reaction,
        punkId,
        throughCursor,
      );
      if (current !== null) {
        stable.push(current);
      }
    }
    return stable.slice(0, 100);
  }

  private stabilizeFollowReactionCollectionPatches(
    patches: readonly FollowReactionCollectionPatch[],
    throughCursor: number,
  ): FollowReactionCollectionPatch[] {
    return this.followReactionCollectionPatches(
      new Map(
        patches.map((patch) => [
          patch.messageId,
          {
            cursor: patch.cursor,
            refreshRequired: patch.refreshRequired,
          },
        ]),
      ),
      throughCursor,
    );
  }

  private async followMessageView(
    messageId: string,
    attachment: FollowAttachment,
    throughCursor: number,
  ): Promise<MessageView | null | undefined> {
    const initial = this.message(messageId);
    if (initial === null || initial.cursor > throughCursor) {
      return undefined;
    }
    let payload: Parameters<typeof authorizedMessageView>[1] = null;
    let readVersion: MessageContentVersion | null = null;
    if (initial.status === "active") {
      const version = initial.contentVersions.find(
        (candidate) => candidate.version === initial.currentVersion,
      );
      if (version === undefined) {
        return null;
      }
      try {
        const read = await this.env.MESSAGE_CONTENT.getByName(
          initial.id,
        ).readAuthorized({
          workspaceId: initial.workspaceId,
          conversationId: initial.conversationId,
          messageId: initial.id,
          generationId: initial.id,
          contentKeyId: version.contentKeyId,
          purpose: "display",
        });
        if (
          !read.ok ||
          read.version !== version.version ||
          read.contentCommitment !== version.contentCommitment
        ) {
          return null;
        }
        payload = read.payload;
        readVersion = version;
      } catch {
        return null;
      }
    }
    if ((await this.authorizeFollower(attachment)).status !== "active") {
      return null;
    }
    const current = this.message(messageId);
    if (current === null || current.cursor > throughCursor) {
      return undefined;
    }
    if (current.status !== "active") {
      payload = null;
    } else {
      const currentVersion = current.contentVersions.find(
        (candidate) => candidate.version === current.currentVersion,
      );
      if (
        payload === null ||
        readVersion === null ||
        currentVersion === undefined ||
        currentVersion.version !== readVersion.version ||
        currentVersion.contentKeyId !== readVersion.contentKeyId ||
        currentVersion.contentCommitment !== readVersion.contentCommitment
      ) {
        return null;
      }
    }
    const view = authorizedMessageView(boundedMessageState(current), payload);
    return validateContract("punks://contracts/message.view@1", view).valid
      ? view
      : null;
  }

  private sendConversationUnavailable(socket: WebSocket, cursor: number): void {
    this.sendFollowFrame(socket, {
      schemaVersion: 1,
      type: "conversation-unavailable",
      reason: "archived",
      cursor,
    });
    socket.close(1000, "conversation archived");
  }

  private wakeFollowers(): void {
    for (const socket of this.ctx.getWebSockets()) {
      this.ctx.waitUntil(this.pumpFollower(socket));
    }
  }

  private prepareFollowerPumpsAfterWake(): boolean {
    let pending = false;
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parseFollowAttachment(socket.deserializeAttachment());
      if (
        attachment === null ||
        (attachment.phase !== "pumping-catch-up" &&
          attachment.phase !== "pumping-live")
      ) {
        continue;
      }
      socket.serializeAttachment({
        ...attachment,
        pumpDeadlineAt: now,
      } satisfies FollowAttachment);
      pending = true;
    }
    return pending;
  }

  private normalizeExpiredFollowerPumps(): boolean {
    const now = Date.now();
    let normalized = false;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parseFollowAttachment(socket.deserializeAttachment());
      if (
        attachment === null ||
        (attachment.phase !== "pumping-catch-up" &&
          attachment.phase !== "pumping-live") ||
        attachment.pumpDeadlineAt === null ||
        attachment.pumpDeadlineAt > now
      ) {
        continue;
      }
      socket.serializeAttachment({
        ...attachment,
        phase: attachment.phase === "pumping-catch-up" ? "catch-up" : "live",
        pumpDeadlineAt: null,
      } satisfies FollowAttachment);
      normalized = true;
    }
    return normalized;
  }

  private expireFollowerBackpressure(): void {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parseFollowAttachment(socket.deserializeAttachment());
      if (
        attachment === null ||
        attachment.ackDeadlineAt === null ||
        attachment.lastAck >= attachment.lastSent ||
        attachment.ackDeadlineAt > now
      ) {
        continue;
      }
      this.sendFollowFrame(socket, {
        schemaVersion: 1,
        type: "resync-required",
        reason: "slow_consumer",
        afterCursor: attachment.lastAck,
        highWaterCursor: attachment.targetHighWater,
      });
      socket.close(1013, "acknowledgement deadline exceeded");
    }
  }

  private scheduleNextFollowerDeadline(): void {
    const deadlines = this.ctx
      .getWebSockets()
      .map((socket) => parseFollowAttachment(socket.deserializeAttachment()))
      .filter(
        (attachment): attachment is FollowAttachment => attachment !== null,
      )
      .map((attachment) =>
        attachment.phase === "pumping-catch-up" ||
        attachment.phase === "pumping-live"
          ? attachment.pumpDeadlineAt
          : attachment.lastAck < attachment.lastSent
            ? attachment.ackDeadlineAt
            : null,
      )
      .filter((deadline): deadline is number => deadline !== null);
    const next = deadlines.sort((left, right) => left - right)[0];
    if (next !== undefined) {
      this.scheduleAlarm(Math.max(0, next - Date.now()));
    }
  }

  async execute(input: unknown): Promise<ConversationExecuteResult> {
    const contract =
      typeof input === "object" && input !== null && "contract" in input
        ? Reflect.get(input, "contract")
        : undefined;
    if (
      typeof contract !== "string" ||
      !(contract in commandContracts) ||
      !validateContract(
        commandContracts[contract as keyof typeof commandContracts],
        input,
      ).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const command = input as ConversationCommand;
    if (
      this.pendingMessage() !== undefined ||
      this.pendingMessageReaction() !== undefined
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    const payloadHash = await sha256Hex(canonicalJson(command));
    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: true,
        value: JSON.parse(
          completed.response_json,
        ) as CommittedConversationCommand,
        replayed: true,
      };
    }

    let pending = this.pending();
    if (pending !== undefined) {
      if (pending.command_id !== command.commandId) {
        return { ok: false, code: "command_in_progress" };
      }
      if (pending.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.attestAndFinalize(pending, true);
    }

    const current = this.effectiveState();
    const conversationId = this.ctx.id.name ?? "";
    if (conversationId.length === 0) {
      return { ok: false, code: "internal" };
    }
    const commandConversationId =
      command.contract === "conversation.create@1"
        ? conversationId
        : command.conversationId;
    if (commandConversationId !== conversationId) {
      return { ok: false, code: "not_found" };
    }

    const authorization = await this.authorizeActor(command);
    if (!authorization.ok) {
      return {
        ok: false,
        code: authorization.code === "not_found" ? "not_found" : "forbidden",
      };
    }
    if (!(await this.targetsBelongToWorkspace(command))) {
      return { ok: false, code: "forbidden" };
    }

    try {
      const context = {
        conversationId,
        cursor: (current?.cursor ?? 0) + 1,
        now: new Date(),
        workspaceCursor: authorization.workspaceCursor,
        workspaceRole: authorization.role,
      };
      const decision = (() => {
        switch (command.contract) {
          case "conversation.create@1":
            return decideCreateConversation(
              current,
              command as CreateConversationCommand,
              context,
            );
          case "conversation.join@1":
            return decideJoinConversation(
              current,
              command as JoinConversationCommand,
              context,
            );
          case "conversation.member-set-access@1":
            return decideSetConversationMemberAccess(
              current,
              command as SetConversationMemberAccessCommand,
              context,
            );
          case "conversation.member-remove@1":
            return decideRemoveConversationMember(
              current,
              command as RemoveConversationMemberCommand,
              context,
            );
          case "conversation.update@1":
            return decideUpdateConversation(
              current,
              command as UpdateConversationCommand,
              context,
            );
          case "conversation.archive@1":
            return decideArchiveConversation(
              current,
              command as ArchiveConversationCommand,
              context,
            );
          case "conversation.restore@1":
            return decideRestoreConversation(
              current,
              command as RestoreConversationCommand,
              context,
            );
        }
      })();
      if (
        !validateContract(
          "punks://contracts/conversation@1",
          decision.nextState,
        ).valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }

      const safetyReduction = isConversationSafetyReduction(current, command);
      const sizingEvent = placeholderSignedEvent(decision.event);
      const sizingResponse: CommittedConversationCommand = {
        state: decision.nextState,
        event: sizingEvent,
      };
      const sizingProjection: ConversationProjectionMessage = {
        schemaVersion: 1,
        workspaceId: decision.nextState.workspaceId,
        conversationId: decision.nextState.id,
        cursor: decision.nextState.cursor,
        event: sizingEvent,
        state: decision.nextState,
      };
      const sizingResponseJson = JSON.stringify(sizingResponse);
      if (
        !this.hasConversationCommitCapacity(
          current,
          decision.nextState,
          JSON.stringify(sizingProjection),
          conversationResultByteLength({
            commandId: command.commandId,
            payloadHash,
            responseJson: sizingResponseJson,
          }),
          safetyReduction,
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (!safetyReduction && !(await this.ensureJournalCapacity())) {
        return { ok: false, code: "internal" };
      }
      if (
        this.hasPendingAggregateMutation() ||
        !sameConversationSnapshot(this.state(), current)
      ) {
        return { ok: false, code: "command_in_progress" };
      }

      if (this.hasPendingAggregateMutation()) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_command
          (singleton, command_id, payload_hash, command_json, unsigned_json,
           next_state_json, reduction_overlay, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(decision.event),
        JSON.stringify(decision.nextState),
        safetyReduction ? 1 : 0,
        new Date().toISOString(),
      );
      pending = this.pending();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      this.scheduleAlarm(1_000);
      return this.attestAndFinalize(pending, false);
    } catch (error) {
      if (error instanceof ConversationDomainError) {
        const code =
          error.code === "already_exists" ? "invalid_transition" : error.code;
        return { ok: false, code };
      }
      return { ok: false, code: "internal" };
    }
  }

  async postMessage(input: unknown): Promise<MessagePostResult> {
    if (
      !isPostMessageRequest(input) ||
      !validateContract("punks://contracts/message.post@1", input.command).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const { command, messageId } = input;
    const conversationId = this.ctx.id.name ?? "";
    if (
      conversationId.length === 0 ||
      command.conversationId !== conversationId ||
      command.actor.kind !== "punk"
    ) {
      return {
        ok: false,
        code: command.actor.kind === "bot" ? "forbidden" : "not_found",
      };
    }
    const punkId = command.actor.punkId;
    const expectedMessageId = await deriveOpaqueUuid(
      "punks.message.v1",
      canonicalJson({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        commandId: command.commandId,
      }),
    );
    if (messageId !== expectedMessageId) {
      return { ok: false, code: "not_found" };
    }

    const initialAuthorization = await this.authorizeMessageActor(command);
    const initialConversation = this.state();
    if (!initialAuthorization.ok || initialConversation === null) {
      return {
        ok: false,
        code: initialAuthorization.ok ? "not_found" : initialAuthorization.code,
      };
    }
    if (!canWriteConversation(initialConversation, punkId)) {
      return { ok: false, code: "forbidden" };
    }
    if (
      this.pending() !== undefined ||
      this.pendingMessageReaction() !== undefined
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    const requestFingerprint = await messageRequestFingerprint(
      command,
      this.env.MESSAGE_SEARCH_MASTER_KEY,
    );
    const completed = this.messageResult(command.commandId);
    if (
      completed !== undefined &&
      this.message(messageId)?.status === "erased"
    ) {
      if (completed.request_fingerprint !== requestFingerprint) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: true,
        value: JSON.parse(completed.response_json) as CommittedMessagePost,
        replayed: true,
      };
    }
    const pendingBeforeStage = this.pendingMessage();
    if (
      pendingBeforeStage !== undefined &&
      pendingBeforeStage.command_id !== command.commandId
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    if (
      completed === undefined &&
      pendingBeforeStage === undefined &&
      !this.hasContentFinalizationCapacity()
    ) {
      return { ok: false, code: "internal" };
    }

    const staged = await this.stageMessageContent(messageId, command);
    if (!staged.ok) {
      return staged;
    }
    const payloadHash = await messageCommandFingerprint(
      command,
      staged.prepared,
    );
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.recoverCommittedMessage(
        messageId,
        command,
        staged.prepared,
        JSON.parse(completed.response_json) as CommittedMessagePost,
      );
    }
    const existingPending = this.pendingMessage();
    if (existingPending !== undefined) {
      if (existingPending.command_id !== command.commandId) {
        return { ok: false, code: "command_in_progress" };
      }
      if (existingPending.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.attestAndFinalizeMessage(existingPending, true);
    }
    let search: MessageProjectionMessage["search"];
    try {
      const derived = await deriveMessageSearchDocument(
        {
          workspaceId: command.workspaceId,
          conversationId: command.conversationId,
          plaintext: `${command.payload.content}\n${command.payload.topic ?? ""}`,
        },
        new TextEncoder().encode(this.env.MESSAGE_SEARCH_MASTER_KEY),
      );
      search = {
        ...derived,
        tokens: [...new Set(derived.tokens)].slice(0, 1_024),
      };
    } catch {
      return { ok: false, code: "search_unavailable" };
    }

    const authorization = await this.authorizeMessageActor(command);
    if (!authorization.ok) {
      return { ok: false, code: authorization.code };
    }
    if (this.hasPendingAggregateMutation()) {
      return { ok: false, code: "command_in_progress" };
    }
    const conversation = this.state();
    if (
      conversation === null ||
      conversation.id !== command.conversationId ||
      conversation.workspaceId !== command.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    if (!canWriteConversation(conversation, punkId)) {
      return { ok: false, code: "forbidden" };
    }
    if (!this.hasContentFinalizationCapacity()) {
      return { ok: false, code: "internal" };
    }

    try {
      const current = this.message(messageId);
      const parent =
        command.payload.replyToMessageId === null
          ? null
          : this.message(command.payload.replyToMessageId);
      const root =
        parent === null ? null : this.message(parent.threadRootMessageId);
      const now = new Date();
      const cursor = conversation.cursor + 1;
      const decision = decidePostMessage(current, command, {
        messageId,
        cursor,
        now,
        workspaceCursor: authorization.workspaceCursor,
        conversationCursor: cursor,
        conversation: {
          type: conversation.type,
          visibility: conversation.visibility,
          status: conversation.status,
          topicRequired: conversation.topicRequired,
        },
        authorization: {
          workspaceRole: authorization.role,
          conversationAccess:
            conversation.members.find((member) => member.punkId === punkId)
              ?.access ?? null,
          botCapabilities: new Set(),
        },
        preparedContent: staged.prepared,
        parentMessage: parent,
        threadRootMessage: root,
      });
      if (decision.event === null) {
        return { ok: false, code: "internal" };
      }
      const version = decision.nextState.contentVersions[0];
      if (version === undefined) {
        return { ok: false, code: "internal" };
      }
      const nextConversation = renewConversationAfterMessage(
        conversation,
        now,
        cursor,
      );
      const committedThreadDeltas = this.prepareThreadDeltas(
        decision.threadDeltas,
        now,
        cursor,
      );
      const projection: MessageProjectionMessage = {
        schemaVersion: 1,
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        messageId,
        cursor,
        event: {
          ...decision.event,
          id: "0".repeat(64),
          pubkey: "0".repeat(64),
          sig: "0".repeat(128),
        },
        state: boundedMessageState(decision.nextState),
        versionDelta: { operation: "upsert", version },
        threadDeltas: projectionThreadDeltas(committedThreadDeltas),
        search,
      };
      if (
        !validateContract("punks://contracts/message@1", decision.nextState)
          .valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid ||
        !validateContract("punks://contracts/message.projection@1", projection)
          .valid
      ) {
        return { ok: false, code: "internal" };
      }
      const sizingResponse: CommittedMessagePost = {
        state: boundedMessageState(decision.nextState),
        version,
        event: projection.event,
      };
      const sizingResponseJson = JSON.stringify(sizingResponse);
      if (
        !this.hasMessageCommitCapacity(
          current,
          sizingResponse.state,
          JSON.stringify(projection),
          messageResultByteLength({
            commandId: command.commandId,
            payloadHash,
            requestFingerprint,
            responseJson: sizingResponseJson,
          }),
          false,
        )
      ) {
        return { ok: false, code: "internal" };
      }

      if (!(await this.ensureJournalCapacity())) {
        return { ok: false, code: "internal" };
      }
      if (
        !sameConversationSnapshot(this.state(), conversation) ||
        canonicalJson(this.message(messageId)) !== canonicalJson(current) ||
        canonicalJson(
          command.payload.replyToMessageId === null
            ? null
            : this.message(command.payload.replyToMessageId),
        ) !== canonicalJson(parent)
      ) {
        return { ok: false, code: "command_in_progress" };
      }

      if (this.hasPendingAggregateMutation()) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_message_command
          (singleton, command_id, payload_hash, request_fingerprint, unsigned_json,
           next_message_json, version_json, thread_deltas_json, search_json,
           next_conversation_json, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        requestFingerprint,
        JSON.stringify(decision.event),
        JSON.stringify(boundedMessageState(decision.nextState)),
        JSON.stringify(version),
        JSON.stringify(committedThreadDeltas),
        JSON.stringify(search),
        JSON.stringify(nextConversation),
        now.toISOString(),
      );
      const pending = this.pendingMessage();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      this.scheduleAlarm(1_000);
      return this.attestAndFinalizeMessage(pending, false);
    } catch (error) {
      if (error instanceof MessageDomainError) {
        return {
          ok: false,
          code:
            error.code === "idempotency_conflict"
              ? "idempotency_conflict"
              : error.code === "not_found"
                ? "not_found"
                : error.code === "forbidden"
                  ? "forbidden"
                  : "invalid_transition",
        };
      }
      return { ok: false, code: "internal" };
    }
  }

  authorizeBotGrant(input: unknown): AuthorizeBotGrantResult {
    if (!isAuthorizeBotGrantRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      this.ctx.id.name !== input.conversationId ||
      conversation.id !== input.conversationId ||
      conversation.workspaceId !== input.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    if (conversation.status !== "active") {
      return { ok: false, code: "forbidden" };
    }
    const access = conversation.members.find(
      (member) => member.punkId === input.punkId,
    )?.access;
    if (access !== "owner" && access !== "manager") {
      return { ok: false, code: "forbidden" };
    }
    return { ok: true, conversationCursor: conversation.cursor };
  }

  async executeBotWakeSubscription(
    input: unknown,
  ): Promise<BotWakeSubscriptionMutationResult> {
    if (!isBotWakeSubscriptionMutationRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    if (!(await botWakeCoordinatesMatch(input))) {
      return { ok: false, code: "invalid_request" };
    }
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      this.ctx.id.name !== input.conversationId ||
      conversation.id !== input.conversationId ||
      conversation.workspaceId !== input.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    const current = this.botWakeSubscription(input.installationId);
    if (input.operation === "deactivate") {
      if (current !== undefined && current.epoch > input.epoch) {
        return { ok: false, code: "conflict" };
      }
      if (current?.epoch === input.epoch && current.status === "disabled") {
        return {
          ok: true,
          status: "disabled",
          epoch: current.epoch,
          highWaterCursor: current.high_water_cursor,
          replayed: true,
        };
      }
      const highWaterCursor = current?.high_water_cursor ?? conversation.cursor;
      if (
        current === undefined &&
        this.botWakeSubscriptionCounts().total >= MAX_BOT_WAKE_SUBSCRIPTION_ROWS
      ) {
        return {
          ok: true,
          status: "disabled",
          epoch: input.epoch,
          highWaterCursor,
          replayed: false,
        };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO bot_wake_subscriptions
          (installation_id, workspace_id, conversation_id, bot_id, epoch,
           high_water_cursor, preparation_id, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'disabled', ?)
         ON CONFLICT(installation_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           conversation_id = excluded.conversation_id,
           bot_id = excluded.bot_id,
           epoch = excluded.epoch,
           high_water_cursor = excluded.high_water_cursor,
           preparation_id = NULL,
           status = 'disabled',
           updated_at = excluded.updated_at`,
        input.installationId,
        input.workspaceId,
        input.conversationId,
        input.botId,
        input.epoch,
        highWaterCursor,
        new Date().toISOString(),
      );
      return {
        ok: true,
        status: "disabled",
        epoch: input.epoch,
        highWaterCursor,
        replayed: false,
      };
    }
    if (conversation.status !== "active") {
      return { ok: false, code: "forbidden" };
    }
    if (input.operation === "prepare") {
      if (current !== undefined && current.epoch > input.epoch) {
        return { ok: false, code: "conflict" };
      }
      if (current?.epoch === input.epoch) {
        if (
          current.workspace_id === input.workspaceId &&
          current.conversation_id === input.conversationId &&
          current.bot_id === input.botId &&
          (current.status === "prepared" || current.status === "active") &&
          current.preparation_id === input.preparationId
        ) {
          return {
            ok: true,
            status: current.status,
            epoch: current.epoch,
            highWaterCursor: current.high_water_cursor,
            replayed: true,
          };
        }
        if (current.status !== "prepared") {
          return { ok: false, code: "conflict" };
        }
      }
      const subscriptionCounts = this.botWakeSubscriptionCounts();
      if (
        (current === undefined &&
          subscriptionCounts.total >= MAX_BOT_WAKE_SUBSCRIPTION_ROWS) ||
        ((current === undefined || current.status === "disabled") &&
          subscriptionCounts.live >=
            MAX_ACTIVE_OR_PREPARED_BOT_WAKE_SUBSCRIPTIONS)
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO bot_wake_subscriptions
          (installation_id, workspace_id, conversation_id, bot_id, epoch,
           high_water_cursor, preparation_id, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'prepared', ?)
         ON CONFLICT(installation_id) DO UPDATE SET
           workspace_id = excluded.workspace_id,
           conversation_id = excluded.conversation_id,
           bot_id = excluded.bot_id,
           epoch = excluded.epoch,
           high_water_cursor = excluded.high_water_cursor,
           preparation_id = excluded.preparation_id,
           status = 'prepared',
           updated_at = excluded.updated_at`,
        input.installationId,
        input.workspaceId,
        input.conversationId,
        input.botId,
        input.epoch,
        conversation.cursor,
        input.preparationId,
        new Date().toISOString(),
      );
      return {
        ok: true,
        status: "prepared",
        epoch: input.epoch,
        highWaterCursor: conversation.cursor,
        replayed: false,
      };
    }
    if (
      current === undefined ||
      current.workspace_id !== input.workspaceId ||
      current.conversation_id !== input.conversationId ||
      current.bot_id !== input.botId ||
      current.epoch !== input.epoch ||
      current.preparation_id !== input.preparationId ||
      current.high_water_cursor !== input.highWaterCursor
    ) {
      return { ok: false, code: "conflict" };
    }
    if (current.status === "active") {
      return {
        ok: true,
        status: "active",
        epoch: current.epoch,
        highWaterCursor: current.high_water_cursor,
        replayed: true,
      };
    }
    if (current.status !== "prepared") {
      return { ok: false, code: "conflict" };
    }
    this.ctx.storage.sql.exec(
      `UPDATE bot_wake_subscriptions
       SET status = 'active', updated_at = ?
       WHERE installation_id = ? AND epoch = ? AND status = 'prepared'`,
      new Date().toISOString(),
      input.installationId,
      input.epoch,
    );
    return {
      ok: true,
      status: "active",
      epoch: current.epoch,
      highWaterCursor: current.high_water_cursor,
      replayed: false,
    };
  }

  async authorizeBotWake(input: unknown): Promise<AuthorizeBotWakeResult> {
    if (!isAuthorizeBotWakeRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    if (!(await botWakeCoordinatesMatch(input))) {
      return { ok: false, code: "invalid_request" };
    }
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      this.ctx.id.name !== input.conversationId ||
      conversation.id !== input.conversationId ||
      conversation.workspaceId !== input.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    const subscription = this.botWakeSubscription(input.installationId);
    if (
      conversation.status !== "active" ||
      subscription === undefined ||
      subscription.workspace_id !== input.workspaceId ||
      subscription.conversation_id !== input.conversationId ||
      subscription.bot_id !== input.botId ||
      subscription.epoch !== input.epoch ||
      subscription.status !== "active" ||
      input.messageCursor <= subscription.high_water_cursor ||
      input.messageCursor > conversation.cursor
    ) {
      return { ok: false, code: "forbidden" };
    }
    return {
      ok: true,
      epoch: subscription.epoch,
      highWaterCursor: subscription.high_water_cursor,
    };
  }

  async offerBotWake(input: unknown): Promise<OfferBotWakeResult> {
    if (!isOfferBotWakeRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    const sourceResult = this.botWakeCandidateSource(
      input.installationId,
      input.messageId,
    );
    if (!sourceResult.ok) {
      return sourceResult;
    }
    const source = sourceResult.source;
    const [verifiedSource, exactInstallation] = await Promise.all([
      verifyAttestation(source.event, this.env),
      botWakeCoordinatesMatch({
        workspaceId: source.conversation.workspaceId,
        botId: source.subscription.bot_id,
        installationId: source.subscription.installation_id,
      }),
    ]);
    if (!verifiedSource || !exactInstallation) {
      return { ok: false, code: "conflict" };
    }
    let wakeId: string;
    let sourceEventDigest: string;
    try {
      [wakeId, sourceEventDigest] = await Promise.all([
        deriveBotWakeId({
          installationId: source.subscription.installation_id,
          subscriptionEpoch: source.subscription.epoch,
          messageId: source.message.id,
          messageCursor: source.message.createdCursor,
        }),
        sha256Hex(canonicalJson(source.event)),
      ]);
    } catch {
      return { ok: false, code: "internal" };
    }
    const candidate: BotWakeCandidate = {
      schemaVersion: 1,
      wakeId,
      workspaceId: source.conversation.workspaceId,
      installationId: source.subscription.installation_id,
      botId: source.subscription.bot_id,
      conversationId: source.conversation.id,
      messageId: source.message.id,
      messageCursor: source.message.createdCursor,
      subscriptionEpoch: source.subscription.epoch,
      sourceEventId: source.event.id,
      sourceEventDigest,
      createdAt: source.message.createdAt,
    };
    if (!isBotWakeCandidate(candidate)) {
      return { ok: false, code: "internal" };
    }
    const candidateJson = canonicalJson(candidate);
    const candidateRowBytes = botWakeCandidateOutboxRowByteLength({
      wakeId,
      installationId: candidate.installationId,
      messageId: candidate.messageId,
      candidateJson,
      createdAt: candidate.createdAt,
    });
    if (candidateRowBytes > MAX_BOT_WAKE_CANDIDATE_OUTBOX_ROW_BYTES) {
      return { ok: false, code: "internal" };
    }

    let persisted = false;
    let failure: Extract<OfferBotWakeResult, { ok: false }> | undefined;
    try {
      this.ctx.storage.transactionSync(() => {
        const finalSource = this.botWakeCandidateSource(
          input.installationId,
          input.messageId,
        );
        if (
          !finalSource.ok ||
          !sameBotWakeCandidateSource(finalSource.source, source)
        ) {
          failure = { ok: false, code: "conflict" };
          return;
        }
        const existing = this.botWakeCandidateOutbox(wakeId);
        if (existing !== undefined) {
          if (
            existing.installation_id === candidate.installationId &&
            existing.message_id === candidate.messageId &&
            existing.candidate_json === candidateJson
          ) {
            persisted = true;
          } else {
            failure = { ok: false, code: "conflict" };
          }
          return;
        }
        if (!this.hasBotWakeCandidateOutboxCapacity(candidateRowBytes)) {
          failure = { ok: false, code: "temporarily_unavailable" };
          return;
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO bot_wake_candidate_outbox
            (wake_id, installation_id, message_id, candidate_json, attempts,
             next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, 0, 0, ?)`,
          wakeId,
          candidate.installationId,
          candidate.messageId,
          candidateJson,
          candidate.createdAt,
        );
        persisted = true;
      });
    } catch {
      return { ok: false, code: "internal" };
    }
    if (!persisted) {
      return failure ?? { ok: false, code: "internal" };
    }

    try {
      await this.ensureAlarmAt(Date.now() + 1_000);
    } catch {
      // The source is already durable. Constructor repair re-arms delivery.
    }
    const row = this.botWakeCandidateOutbox(wakeId);
    if (row !== undefined) {
      await this.deliverBotWakeCandidate(row);
    }
    return { ok: true, wakeId };
  }

  async readBotWakeContext(input: unknown): Promise<ReadBotWakeContextResult> {
    if (!(await isReadBotWakeContextRequest(input))) {
      return { ok: false, code: "invalid_request" };
    }
    const proof = input as ReadBotWakeContextRequest;
    const sourceResult = this.botWakeCandidateSource(
      proof.installationId,
      proof.offer.messageId,
    );
    if (!sourceResult.ok) {
      return {
        ok: false,
        code:
          sourceResult.code === "not_found" ? "not_found" : "authority_revoked",
      };
    }
    const source = sourceResult.source;
    if (
      !(await botWakeContextProofMatchesSource(proof, source)) ||
      !(await verifyAttestation(source.event, this.env))
    ) {
      return { ok: false, code: "authority_revoked" };
    }
    const version = source.message.contentVersions[0];
    if (version === undefined) {
      return { ok: false, code: "internal" };
    }
    let read: ReadMessageContentResult;
    try {
      read = await this.env.MESSAGE_CONTENT.getByName(
        source.message.id,
      ).readAuthorized({
        workspaceId: source.message.workspaceId,
        conversationId: source.message.conversationId,
        messageId: source.message.id,
        generationId: source.message.id,
        contentKeyId: version.contentKeyId,
        purpose: "bot-context",
      });
    } catch {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (!read.ok) {
      return {
        ok: false,
        code:
          read.code === "storage_unavailable"
            ? "temporarily_unavailable"
            : "content_unavailable",
      };
    }
    if (
      read.version !== version.version ||
      read.contentCommitment !== version.contentCommitment ||
      !isExactBotContextPayload(read.payload) ||
      utf8ByteLength(read.payload.content) > 8_192
    ) {
      return { ok: false, code: "content_unavailable" };
    }
    const finalSource = this.botWakeCandidateSource(
      proof.installationId,
      proof.offer.messageId,
    );
    if (
      !finalSource.ok ||
      !sameBotWakeCandidateSource(finalSource.source, source) ||
      !(await botWakeContextProofMatchesSource(proof, finalSource.source))
    ) {
      return { ok: false, code: "authority_revoked" };
    }
    return { ok: true, content: read.payload.content };
  }

  async executeBotReaction(
    input: unknown,
  ): Promise<ExecuteAdmittedBotReactionResult> {
    if (!isExecuteAdmittedBotReactionRequest(input)) {
      return botDeliveryFailure("invalid_request");
    }
    const request = input;
    if (this.ctx.id.name !== request.action.conversationId) {
      return botDeliveryFailure("not_found");
    }
    if (!(await verifyAttestation(request.proof, this.env))) {
      return botDeliveryFailure("forbidden");
    }
    const admission = admissionFromProof(request.proof);
    if (
      admission === null ||
      !(await proofMatchesBotReaction(request, admission))
    ) {
      return botDeliveryFailure("forbidden");
    }
    let reaction: string;
    try {
      reaction = canonicalMessageReaction(request.action.payload.reaction);
    } catch (error) {
      return botReactionDomainFailure(error);
    }
    const command = botReactionCommand(request, reaction);
    const reactionId = await deriveOpaqueUuid(
      "punks.message-reaction.v1",
      canonicalJson({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        messageId: command.messageId,
        actor: command.actor,
        reaction,
      }),
    );
    const semanticHash = await sha256Hex(
      canonicalJson({ ...command, reactionId }),
    );
    const completed = this.messageReactionResult(command.commandId);
    if (completed !== undefined) {
      if (
        completed.semantic_hash !== semanticHash ||
        completed.reaction_id !== reactionId ||
        !this.hasExactBotCompletion(request, "succeeded")
      ) {
        return botDeliveryFailure("conflict");
      }
      this.scheduleAlarm(0);
      return botDeliverySuccess(true);
    }
    if (
      this.pending() !== undefined ||
      this.pendingMessage() !== undefined ||
      this.pendingMessageReaction() !== undefined
    ) {
      return botDeliveryFailure("command_in_progress");
    }
    const existingPending = this.pendingBotReaction();
    if (existingPending !== undefined) {
      if (
        existingPending.command_id !== command.commandId ||
        existingPending.semantic_hash !== semanticHash ||
        existingPending.reaction_id !== reactionId ||
        canonicalJson(parseJson(existingPending.request_json)) !==
          canonicalJson(request)
      ) {
        return botDeliveryFailure("command_in_progress");
      }
      return this.attestAndFinalizeBotReaction(existingPending, true);
    }
    if (!this.hasBotCompletionCapacity(request.admissionId)) {
      return botDeliveryFailure("temporarily_unavailable");
    }

    const conversation = this.state();
    const target = this.message(command.messageId);
    if (
      conversation === null ||
      conversation.id !== command.conversationId ||
      conversation.workspaceId !== command.workspaceId ||
      conversation.status !== "active" ||
      target === null ||
      target.workspaceId !== command.workspaceId ||
      target.conversationId !== command.conversationId ||
      target.status !== "active"
    ) {
      this.recordBotCompletion(request, "failed");
      this.scheduleAlarm(0);
      return botDeliveryFailure(target === null ? "not_found" : "forbidden");
    }
    const current = this.messageReaction(reactionId);
    const cursor = conversation.cursor + 1;
    const now = new Date();
    const context: MessageReactionDecisionContext = {
      reactionId,
      cursor,
      now,
      authority: {
        kind: "bot-installation",
        installationCursor: admission.installationCursor,
        admissionId: admission.id,
        actionId: admission.actionId,
        actionDigest: admission.actionDigest,
      },
      conversationCursor: cursor,
      targetMessage: {
        id: target.id,
        workspaceId: target.workspaceId,
        conversationId: target.conversationId,
        status: target.status,
      },
      conversation: {
        status: conversation.status,
        visibility: conversation.visibility,
      },
      authorization: {
        workspaceRole: null,
        // Exact admission delegates write access without adding a member row.
        conversationAccess: "member",
        botCapabilities: new Set(["messages.react"]),
      },
      priorCommand: null,
    };
    let decision: MessageReactionDecision;
    try {
      decision = decideMessageReaction(current, command, context);
    } catch (error) {
      const failed = botReactionDomainFailure(error);
      if (failed.code === "not_found" || failed.code === "forbidden") {
        this.recordBotCompletion(request, "failed");
        this.scheduleAlarm(0);
      }
      return failed;
    }
    const commandRecordJson = JSON.stringify(decision.commandRecord);
    const resultBytes = messageReactionResultByteLength({
      commandId: command.commandId,
      semanticHash,
      reactionId,
      commandRecordJson,
      botAdmissionId: request.admissionId,
      botActionDigest: request.actionDigest,
      botOutcome: "succeeded",
    });
    if (decision.event === null) {
      if (!this.hasMessageReactionResultCapacity(resultBytes)) {
        return botDeliveryFailure("temporarily_unavailable");
      }
      try {
        this.ctx.storage.transactionSync(() => {
          if (this.hasPendingAggregateMutation()) {
            throw new Error("Conversation aggregate became busy");
          }
          const latestConversation = this.state();
          const latestTarget = this.message(command.messageId);
          if (
            latestConversation?.cursor !== conversation.cursor ||
            latestTarget?.status !== "active"
          ) {
            throw new Error("Reaction target changed before no-op commit");
          }
          if (!this.hasMessageReactionResultCapacity(resultBytes)) {
            throw new Error("Reaction result capacity changed");
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO message_reaction_command_results
              (command_id, semantic_hash, reaction_id, command_record_json,
               committed_cursor, bot_admission_id, bot_action_digest,
               bot_outcome, committed_at)
             VALUES (?, ?, ?, ?, NULL, ?, ?, 'succeeded', ?)`,
            command.commandId,
            semanticHash,
            reactionId,
            commandRecordJson,
            request.admissionId,
            request.actionDigest,
            now.toISOString(),
          );
          this.recordBotCompletion(request, "succeeded");
        });
      } catch {
        return botDeliveryFailure("command_in_progress");
      }
      this.scheduleAlarm(0);
      return botDeliverySuccess(false);
    }
    const nextConversation = renewConversationAfterMessage(
      conversation,
      now,
      cursor,
    );
    if (
      decision.nextState === null ||
      decision.projectionDelta === null ||
      !validateContract(
        "punks://contracts/message-reaction@1",
        decision.nextState,
      ).valid ||
      !validateContract(
        "punks://contracts/nostr.unsigned-event@1",
        decision.event,
      ).valid
    ) {
      return botDeliveryFailure("internal");
    }
    const unsignedProjection: MessageReactionProjectionEnvelope = {
      contract: "message-reaction.projection@1",
      workspaceId: request.workspaceId,
      conversationId: request.action.conversationId,
      messageId: request.action.messageId,
      cursor,
      event: {
        ...decision.event,
        id: "0".repeat(64),
        pubkey: "0".repeat(64),
        sig: "0".repeat(128),
      },
      delta: decision.projectionDelta,
    };
    const safetyReduction = decision.effect === "removed";
    if (
      !this.hasMessageReactionCommitCapacity(
        current,
        decision.nextState,
        JSON.stringify(unsignedProjection),
        resultBytes,
        safetyReduction,
      )
    ) {
      return botDeliveryFailure("temporarily_unavailable");
    }
    if (!safetyReduction && !(await this.ensureJournalCapacity())) {
      return botDeliveryFailure("temporarily_unavailable");
    }
    if (
      !sameConversationSnapshot(this.state(), conversation) ||
      canonicalJson(this.message(command.messageId)) !==
        canonicalJson(target) ||
      canonicalJson(this.messageReaction(reactionId)) !==
        canonicalJson(current) ||
      !this.hasMessageReactionCommitCapacity(
        current,
        decision.nextState,
        JSON.stringify(unsignedProjection),
        resultBytes,
        safetyReduction,
      )
    ) {
      return botDeliveryFailure("command_in_progress");
    }
    if (this.hasPendingAggregateMutation()) {
      return botDeliveryFailure("command_in_progress");
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO pending_bot_reaction
        (singleton, command_id, semantic_hash, reaction_id, request_json,
         command_json, command_record_json, unsigned_json, next_reaction_json,
         projection_delta_json, next_conversation_json, attempts, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      command.commandId,
      semanticHash,
      reactionId,
      JSON.stringify(request),
      JSON.stringify(command),
      commandRecordJson,
      JSON.stringify(decision.event),
      JSON.stringify(decision.nextState),
      JSON.stringify(decision.projectionDelta),
      JSON.stringify(nextConversation),
      now.toISOString(),
    );
    const pending = this.pendingBotReaction();
    if (pending === undefined) {
      return botDeliveryFailure("internal");
    }
    this.scheduleAlarm(1_000);
    return this.attestAndFinalizeBotReaction(pending, false);
  }

  async mutateMessageReaction(
    input: unknown,
  ): Promise<MessageReactionMutationResult> {
    if (!isMessageReactionMutationRequest(input)) {
      return { ok: false, code: "invalid_contract" };
    }
    const contractId =
      input.command.contract === "message.reaction-add@1"
        ? "punks://contracts/message.reaction-add@1"
        : input.command.contract === "message.reaction-remove@1"
          ? "punks://contracts/message.reaction-remove@1"
          : input.command.contract === "message.reaction-toggle@1"
            ? "punks://contracts/message.reaction-toggle@1"
            : null;
    if (
      contractId === null ||
      !validateContract(contractId, input.command).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const command = input.command;
    if (command.actor.kind !== "punk") {
      return { ok: false, code: "forbidden" };
    }
    if (
      this.ctx.id.name !== command.conversationId ||
      this.effectiveState()?.workspaceId !== command.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }

    let reaction: string;
    try {
      reaction = canonicalMessageReaction(command.payload.reaction);
    } catch (error) {
      return messageReactionDomainFailure(error);
    }
    const normalizedCommand = {
      ...command,
      payload: { reaction },
    } as typeof command;
    const reactionId = await deriveOpaqueUuid(
      "punks.message-reaction.v1",
      canonicalJson({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        messageId: command.messageId,
        actor: command.actor,
        reaction,
      }),
    );
    const semanticHash = await sha256Hex(
      canonicalJson({ ...normalizedCommand, reactionId }),
    );

    const initialAuthorization =
      await this.authorizeMessageReaction(normalizedCommand);
    if (!initialAuthorization.ok) {
      return initialAuthorization;
    }
    const completed = this.messageReactionResult(command.commandId);
    if (completed !== undefined) {
      if (
        completed.semantic_hash !== semanticHash ||
        completed.reaction_id !== reactionId
      ) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.messageReactionReplay(completed);
    }
    if (this.pending() !== undefined || this.pendingMessage() !== undefined) {
      return { ok: false, code: "command_in_progress" };
    }
    const existingPending = this.pendingMessageReaction();
    if (existingPending !== undefined) {
      if (existingPending.command_id !== command.commandId) {
        return { ok: false, code: "command_in_progress" };
      }
      if (
        existingPending.semantic_hash !== semanticHash ||
        existingPending.reaction_id !== reactionId
      ) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.attestAndFinalizeMessageReaction(existingPending, true);
    }

    const finalAuthorization =
      await this.authorizeMessageReaction(normalizedCommand);
    if (!finalAuthorization.ok) {
      return finalAuthorization;
    }
    if (this.hasPendingAggregateMutation()) {
      return { ok: false, code: "command_in_progress" };
    }
    const conversation = this.state();
    const target = this.message(command.messageId);
    if (conversation === null || target === null) {
      return { ok: false, code: "not_found" };
    }
    const current = this.messageReaction(reactionId);
    const cursor = conversation.cursor + 1;
    const now = new Date();
    const context = messageReactionDecisionContext(
      reactionId,
      cursor,
      now,
      conversation,
      target,
      finalAuthorization.workspaceCursor,
      finalAuthorization.role,
      command.actor.punkId,
      null,
    );
    let decision: MessageReactionDecision;
    try {
      decision = decideMessageReaction(current, normalizedCommand, context);
    } catch (error) {
      return messageReactionDomainFailure(error);
    }
    const commandRecordJson = JSON.stringify(decision.commandRecord);
    const resultBytes = messageReactionResultByteLength({
      commandId: command.commandId,
      semanticHash,
      reactionId,
      commandRecordJson,
    });

    if (decision.event === null) {
      const response = messageReactionResponse(
        this.visibleMessageReaction(decision.nextState),
        decision.effect,
        false,
      );
      if (
        !validateContract(
          "punks://contracts/message.reaction-mutation-response@1",
          response,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }
      if (!this.hasMessageReactionResultCapacity(resultBytes)) {
        return { ok: false, code: "internal" };
      }
      try {
        this.ctx.storage.transactionSync(() => {
          if (this.hasPendingAggregateMutation()) {
            throw new Error("Aggregate mutation became busy");
          }
          const latestConversation = this.state();
          const latestTarget = this.message(command.messageId);
          if (
            latestConversation === null ||
            latestTarget === null ||
            latestConversation.cursor !== conversation.cursor ||
            latestTarget.status !== "active"
          ) {
            throw new Error("Reaction target changed before no-op commit");
          }
          if (!this.hasMessageReactionResultCapacity(resultBytes)) {
            throw new Error("Reaction result capacity changed");
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO message_reaction_command_results
              (command_id, semantic_hash, reaction_id, command_record_json,
               committed_cursor, committed_at)
             VALUES (?, ?, ?, ?, NULL, ?)`,
            command.commandId,
            semanticHash,
            reactionId,
            commandRecordJson,
            now.toISOString(),
          );
        });
      } catch {
        return { ok: false, code: "command_in_progress" };
      }
      return { ok: true, response };
    }

    const nextConversation = renewConversationAfterMessage(
      conversation,
      now,
      cursor,
    );
    const unsignedProjection: MessageReactionProjectionEnvelope = {
      contract: "message-reaction.projection@1",
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      cursor,
      event: {
        ...decision.event,
        id: "0".repeat(64),
        pubkey: "0".repeat(64),
        sig: "0".repeat(128),
      },
      delta: decision.projectionDelta as NonNullable<
        MessageReactionDecision["projectionDelta"]
      >,
    };
    if (
      decision.nextState === null ||
      !validateContract(
        "punks://contracts/message-reaction@1",
        decision.nextState,
      ).valid ||
      !validateContract(
        "punks://contracts/nostr.unsigned-event@1",
        decision.event,
      ).valid ||
      !validateContract(
        "punks://contracts/message-reaction.projection@1",
        unsignedProjection,
      ).valid
    ) {
      return { ok: false, code: "internal" };
    }
    const safetyReduction = decision.effect === "removed";
    const unsignedProjectionJson = JSON.stringify(unsignedProjection);
    if (
      !this.hasMessageReactionCommitCapacity(
        current,
        decision.nextState,
        unsignedProjectionJson,
        resultBytes,
        safetyReduction,
      )
    ) {
      return { ok: false, code: "internal" };
    }
    if (!safetyReduction && !(await this.ensureJournalCapacity())) {
      return { ok: false, code: "internal" };
    }
    if (
      !sameConversationSnapshot(this.state(), conversation) ||
      canonicalJson(this.message(command.messageId)) !==
        canonicalJson(target) ||
      canonicalJson(this.messageReaction(reactionId)) !==
        canonicalJson(current) ||
      !this.hasMessageReactionCommitCapacity(
        current,
        decision.nextState,
        unsignedProjectionJson,
        resultBytes,
        safetyReduction,
      )
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    try {
      if (this.hasPendingAggregateMutation()) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_message_reaction_command
          (singleton, command_id, semantic_hash, reaction_id, command_json,
           command_record_json, unsigned_json, next_reaction_json,
           projection_delta_json, next_conversation_json, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        semanticHash,
        reactionId,
        JSON.stringify(normalizedCommand),
        commandRecordJson,
        JSON.stringify(decision.event),
        JSON.stringify(decision.nextState),
        JSON.stringify(decision.projectionDelta),
        JSON.stringify(nextConversation),
        now.toISOString(),
      );
    } catch {
      return { ok: false, code: "command_in_progress" };
    }
    const pending = this.pendingMessageReaction();
    if (pending === undefined) {
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(1_000);
    return this.attestAndFinalizeMessageReaction(pending, false);
  }

  async mutateMessage(input: unknown): Promise<MessageMutationResult> {
    if (!isMessageMutationRequest(input)) {
      return { ok: false, code: "invalid_contract" };
    }
    const contractId =
      input.command.contract === "message.edit@1"
        ? "punks://contracts/message.edit@1"
        : input.command.contract === "message.retract@1"
          ? "punks://contracts/message.retract@1"
          : input.command.contract === "message.restore@1"
            ? "punks://contracts/message.restore@1"
            : null;
    if (
      contractId === null ||
      !validateContract(contractId, input.command).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    if (input.command.contract !== "message.edit@1") {
      return this.mutateMessageState(input.messageId, input.command);
    }
    const { command, messageId } = input;
    const conversation = this.state();
    if (
      this.ctx.id.name !== command.conversationId ||
      command.messageId !== messageId ||
      command.actor.kind !== "punk" ||
      conversation === null ||
      conversation.id !== command.conversationId ||
      conversation.workspaceId !== command.workspaceId
    ) {
      return {
        ok: false,
        code: command.actor.kind === "bot" ? "forbidden" : "not_found",
      };
    }
    const current = this.message(messageId);
    if (current === null) {
      return { ok: false, code: "not_found" };
    }
    const initialAuthorization = await this.authorizeMessageMutationActor(
      current,
      command,
      conversation,
      new Date(),
      conversation.cursor + 1,
    );
    if (!initialAuthorization.ok) {
      return initialAuthorization;
    }
    if (
      this.pending() !== undefined ||
      this.pendingMessageReaction() !== undefined
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    const requestFingerprint = await messageRequestFingerprint(
      command,
      this.env.MESSAGE_SEARCH_MASTER_KEY,
    );
    const completed = this.messageResult(command.commandId);
    if (completed !== undefined && current.status === "erased") {
      if (completed.request_fingerprint !== requestFingerprint) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: true,
        value: JSON.parse(completed.response_json) as CommittedMessageMutation,
        replayed: true,
      };
    }
    const pendingBeforeStage = this.pendingMessage();
    if (
      pendingBeforeStage !== undefined &&
      pendingBeforeStage.command_id !== command.commandId
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    if (
      completed === undefined &&
      this.contentFinalizationForMessage(messageId) !== undefined
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    if (
      completed === undefined &&
      pendingBeforeStage === undefined &&
      !this.hasContentFinalizationCapacity()
    ) {
      return { ok: false, code: "internal" };
    }
    const committed =
      completed === undefined
        ? undefined
        : (JSON.parse(completed.response_json) as CommittedMessageMutation);
    if (
      committed !== undefined &&
      (committed.version === null || committed.event === null)
    ) {
      return { ok: false, code: "internal" };
    }
    const pendingVersion =
      pendingBeforeStage === undefined
        ? undefined
        : (JSON.parse(
            String(pendingBeforeStage.version_json),
          ) as MessageContentVersion);
    const committedVersion = committed?.version ?? undefined;
    const expectedVersion =
      committedVersion?.version ??
      pendingVersion?.version ??
      (current.currentVersion ?? 0) + 1;
    const staged = await this.stageEditedMessageContent(
      messageId,
      command,
      expectedVersion,
    );
    if (!staged.ok) {
      return staged;
    }
    const payloadHash = await messageCommandFingerprint(
      command,
      staged.prepared,
    );
    if (completed !== undefined && committed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.recoverCommittedMessageMutation(
        messageId,
        command,
        staged.prepared,
        committed,
      );
    }
    if (pendingBeforeStage !== undefined) {
      if (pendingBeforeStage.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.attestAndFinalizeMessageMutation(pendingBeforeStage, true);
    }

    let search: MessageProjectionMessage["search"];
    try {
      const derived = await deriveMessageSearchDocument(
        {
          workspaceId: command.workspaceId,
          conversationId: command.conversationId,
          plaintext: `${command.payload.content}\n${command.payload.topic ?? ""}`,
        },
        new TextEncoder().encode(this.env.MESSAGE_SEARCH_MASTER_KEY),
      );
      search = {
        ...derived,
        tokens: [...new Set(derived.tokens)].slice(0, 1_024),
      };
    } catch {
      return { ok: false, code: "search_unavailable" };
    }

    const latestConversation = this.state();
    const latestMessage = this.message(messageId);
    if (latestConversation === null || latestMessage === null) {
      return { ok: false, code: "not_found" };
    }
    const now = new Date();
    const cursor = latestConversation.cursor + 1;
    const authorization = await this.authorizeMessageMutationActor(
      latestMessage,
      command,
      latestConversation,
      now,
      cursor,
    );
    if (!authorization.ok) {
      return authorization;
    }
    if (
      this.hasPendingAggregateMutation() ||
      this.contentFinalizationForMessage(messageId) !== undefined
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    if (!this.hasContentFinalizationCapacity()) {
      return { ok: false, code: "internal" };
    }

    try {
      const decision = decideEditMessage(latestMessage, command, {
        ...authorization.context,
        preparedContent: staged.prepared,
        parentMessage: null,
        threadRootMessage: null,
      });
      if (decision.event === null) {
        const response: CommittedMessageMutation = {
          state: boundedMessageState(decision.nextState),
          version: null,
          event: null,
        };
        const responseJson = JSON.stringify(response);
        const resultBytes = messageResultByteLength({
          commandId: command.commandId,
          payloadHash,
          requestFingerprint,
          responseJson,
        });
        if (!this.hasMessageResultCapacity(resultBytes)) {
          return { ok: false, code: "internal" };
        }
        try {
          this.ctx.storage.transactionSync(() => {
            if (
              this.hasPendingAggregateMutation() ||
              !sameConversationSnapshot(this.state(), latestConversation) ||
              canonicalJson(this.message(messageId)) !==
                canonicalJson(latestMessage) ||
              !this.hasMessageResultCapacity(resultBytes)
            ) {
              throw new Error("Message no-op capacity or state changed");
            }
            this.ctx.storage.sql.exec(
              `INSERT INTO message_command_results
                (command_id, payload_hash, request_fingerprint, response_json,
                 committed_at)
               VALUES (?, ?, ?, ?, ?)`,
              command.commandId,
              payloadHash,
              requestFingerprint,
              responseJson,
              now.toISOString(),
            );
          });
        } catch {
          return { ok: false, code: "internal" };
        }
        return { ok: true, value: response, replayed: false };
      }
      const version = decision.nextState.contentVersions.find(
        (candidate) => candidate.version === expectedVersion,
      );
      if (version === undefined) {
        return { ok: false, code: "internal" };
      }
      const nextConversation = renewConversationAfterMessage(
        latestConversation,
        now,
        cursor,
      );
      const projection: MessageProjectionMessage = {
        schemaVersion: 1,
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        messageId,
        cursor,
        event: {
          ...decision.event,
          id: "0".repeat(64),
          pubkey: "0".repeat(64),
          sig: "0".repeat(128),
        },
        state: boundedMessageState(decision.nextState),
        versionDelta: { operation: "upsert", version },
        threadDeltas: [],
        search,
      };
      if (
        !validateContract("punks://contracts/message@1", decision.nextState)
          .valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid ||
        !validateContract("punks://contracts/message.projection@1", projection)
          .valid
      ) {
        return { ok: false, code: "internal" };
      }
      const sizingResponse: CommittedMessageMutation = {
        state: boundedMessageState(decision.nextState),
        version,
        event: projection.event,
      };
      const sizingResponseJson = JSON.stringify(sizingResponse);
      if (
        !this.hasMessageCommitCapacity(
          latestMessage,
          sizingResponse.state,
          JSON.stringify(projection),
          messageResultByteLength({
            commandId: command.commandId,
            payloadHash,
            requestFingerprint,
            responseJson: sizingResponseJson,
          }),
          false,
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (!(await this.ensureJournalCapacity())) {
        return { ok: false, code: "internal" };
      }
      if (
        !sameConversationSnapshot(this.state(), latestConversation) ||
        canonicalJson(this.message(messageId)) !== canonicalJson(latestMessage)
      ) {
        return { ok: false, code: "command_in_progress" };
      }
      if (this.hasPendingAggregateMutation()) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_message_command
          (singleton, command_id, payload_hash, request_fingerprint, unsigned_json,
           next_message_json, version_json, thread_deltas_json, search_json,
           next_conversation_json, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, '[]', ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        requestFingerprint,
        JSON.stringify(decision.event),
        JSON.stringify(boundedMessageState(decision.nextState)),
        JSON.stringify(version),
        JSON.stringify(search),
        JSON.stringify(nextConversation),
        now.toISOString(),
      );
      const pending = this.pendingMessage();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      this.scheduleAlarm(1_000);
      return this.attestAndFinalizeMessageMutation(pending, false);
    } catch (error) {
      return messageMutationDomainFailure(error);
    }
  }

  private async mutateMessageState(
    messageId: string,
    command: RetractMessageCommand | RestoreMessageCommand,
  ): Promise<MessageMutationResult> {
    const conversation = this.state();
    if (
      this.ctx.id.name !== command.conversationId ||
      command.messageId !== messageId ||
      command.actor.kind !== "punk" ||
      conversation === null ||
      conversation.id !== command.conversationId ||
      conversation.workspaceId !== command.workspaceId
    ) {
      return {
        ok: false,
        code: command.actor.kind === "bot" ? "forbidden" : "not_found",
      };
    }
    const current = this.message(messageId);
    if (current === null) {
      return { ok: false, code: "not_found" };
    }
    const initialAuthorization = await this.authorizeMessageMutationActor(
      current,
      command,
      conversation,
      new Date(),
      conversation.cursor + 1,
    );
    if (!initialAuthorization.ok) {
      return initialAuthorization;
    }
    if (
      this.pending() !== undefined ||
      this.pendingMessageReaction() !== undefined
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    const pending = this.pendingMessage();
    if (pending !== undefined && pending.command_id !== command.commandId) {
      return { ok: false, code: "command_in_progress" };
    }
    const payloadHash = await sha256Hex(canonicalJson(command));
    const requestFingerprint = await messageRequestFingerprint(
      command,
      this.env.MESSAGE_SEARCH_MASTER_KEY,
    );
    const completed = this.messageResult(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: true,
        value: JSON.parse(completed.response_json) as CommittedMessageMutation,
        replayed: true,
      };
    }
    if (pending !== undefined) {
      if (pending.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.attestAndFinalizeMessageStateMutation(pending, true);
    }

    let search: MessageProjectionMessage["search"] = {
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [],
    };
    if (command.contract === "message.restore@1") {
      const version = current.contentVersions.find(
        (candidate) => candidate.version === current.currentVersion,
      );
      if (version === undefined) {
        return { ok: false, code: "internal" };
      }
      let read: Awaited<
        ReturnType<
          ReturnType<ApiEnv["MESSAGE_CONTENT"]["getByName"]>["readAuthorized"]
        >
      >;
      try {
        read = await this.env.MESSAGE_CONTENT.getByName(
          messageId,
        ).readAuthorized({
          workspaceId: command.workspaceId,
          conversationId: command.conversationId,
          messageId,
          generationId: messageId,
          contentKeyId: version.contentKeyId,
          purpose: "search",
        });
      } catch {
        return { ok: false, code: "content_unavailable" };
      }
      if (
        !read.ok ||
        read.version !== version.version ||
        read.contentCommitment !== version.contentCommitment
      ) {
        return { ok: false, code: "content_unavailable" };
      }
      try {
        const derived = await deriveMessageSearchDocument(
          {
            workspaceId: command.workspaceId,
            conversationId: command.conversationId,
            plaintext: `${read.payload.content}\n${read.payload.topic ?? ""}`,
          },
          new TextEncoder().encode(this.env.MESSAGE_SEARCH_MASTER_KEY),
        );
        search = {
          ...derived,
          tokens: [...new Set(derived.tokens)].slice(0, 1_024),
        };
      } catch {
        return { ok: false, code: "search_unavailable" };
      }
    }

    const latestConversation = this.state();
    const latestMessage = this.message(messageId);
    if (latestConversation === null || latestMessage === null) {
      return { ok: false, code: "not_found" };
    }
    const now = new Date();
    const cursor = latestConversation.cursor + 1;
    const authorization = await this.authorizeMessageMutationActor(
      latestMessage,
      command,
      latestConversation,
      now,
      cursor,
    );
    if (!authorization.ok) {
      return authorization;
    }
    if (this.hasPendingAggregateMutation()) {
      return { ok: false, code: "command_in_progress" };
    }

    try {
      const decision =
        command.contract === "message.retract@1"
          ? decideRetractMessage(latestMessage, command, authorization.context)
          : decideRestoreMessage(latestMessage, command, authorization.context);
      if (decision.event === null) {
        const response: CommittedMessageMutation = {
          state: boundedMessageState(decision.nextState),
          version: null,
          event: null,
        };
        const responseJson = JSON.stringify(response);
        const resultBytes = messageResultByteLength({
          commandId: command.commandId,
          payloadHash,
          requestFingerprint,
          responseJson,
        });
        if (!this.hasMessageResultCapacity(resultBytes)) {
          return { ok: false, code: "internal" };
        }
        try {
          this.ctx.storage.transactionSync(() => {
            if (
              this.hasPendingAggregateMutation() ||
              !sameConversationSnapshot(this.state(), latestConversation) ||
              canonicalJson(this.message(messageId)) !==
                canonicalJson(latestMessage) ||
              !this.hasMessageResultCapacity(resultBytes)
            ) {
              throw new Error("Message no-op capacity or state changed");
            }
            this.ctx.storage.sql.exec(
              `INSERT INTO message_command_results
                (command_id, payload_hash, request_fingerprint, response_json,
                 committed_at)
               VALUES (?, ?, ?, ?, ?)`,
              command.commandId,
              payloadHash,
              requestFingerprint,
              responseJson,
              now.toISOString(),
            );
          });
        } catch {
          return { ok: false, code: "internal" };
        }
        return { ok: true, value: response, replayed: false };
      }
      const committedThreadDeltas = this.prepareThreadDeltasForStatus(
        decision.threadDeltas,
        latestMessage,
        decision.nextState.status,
        now,
        cursor,
      );
      const nextConversation = renewConversationAfterMessage(
        latestConversation,
        now,
        cursor,
      );
      const projection: MessageProjectionMessage = {
        schemaVersion: 1,
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        messageId,
        cursor,
        event: {
          ...decision.event,
          id: "0".repeat(64),
          pubkey: "0".repeat(64),
          sig: "0".repeat(128),
        },
        state: boundedMessageState(decision.nextState),
        versionDelta: { operation: "retain" },
        threadDeltas: projectionThreadDeltas(committedThreadDeltas),
        search,
      };
      if (
        !validateContract("punks://contracts/message@1", decision.nextState)
          .valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid ||
        !validateContract("punks://contracts/message.projection@1", projection)
          .valid
      ) {
        return { ok: false, code: "internal" };
      }
      const sizingResponse: CommittedMessageMutation = {
        state: boundedMessageState(decision.nextState),
        version: null,
        event: projection.event,
      };
      const sizingResponseJson = JSON.stringify(sizingResponse);
      if (
        !this.hasMessageCommitCapacity(
          latestMessage,
          sizingResponse.state,
          JSON.stringify(projection),
          messageResultByteLength({
            commandId: command.commandId,
            payloadHash,
            requestFingerprint,
            responseJson: sizingResponseJson,
          }),
          command.contract === "message.retract@1",
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        command.contract === "message.restore@1" &&
        !(await this.ensureJournalCapacity())
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        !sameConversationSnapshot(this.state(), latestConversation) ||
        canonicalJson(this.message(messageId)) !== canonicalJson(latestMessage)
      ) {
        return { ok: false, code: "command_in_progress" };
      }
      if (this.hasPendingAggregateMutation()) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_message_command
          (singleton, command_id, payload_hash, request_fingerprint, unsigned_json,
           next_message_json, version_json, thread_deltas_json, search_json,
           next_conversation_json, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, 'null', ?, ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        requestFingerprint,
        JSON.stringify(decision.event),
        JSON.stringify(boundedMessageState(decision.nextState)),
        JSON.stringify(committedThreadDeltas),
        JSON.stringify(search),
        JSON.stringify(nextConversation),
        now.toISOString(),
      );
      const createdPending = this.pendingMessage();
      if (createdPending === undefined) {
        return { ok: false, code: "internal" };
      }
      this.scheduleAlarm(1_000);
      return this.attestAndFinalizeMessageStateMutation(createdPending, false);
    } catch (error) {
      return messageMutationDomainFailure(error);
    }
  }

  async readMessage(input: unknown): Promise<MessageReadResult> {
    if (!isMessageReadRequest(input)) {
      return { ok: false, code: "invalid_contract" };
    }
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      this.ctx.id.name !== input.conversationId ||
      conversation.id !== input.conversationId ||
      conversation.workspaceId !== input.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    const authorization = await this.env.WORKSPACES.getByName(
      input.workspaceId,
    ).authorize({
      workspaceId: input.workspaceId,
      punkId: input.punkId,
      permission: "workspace.read",
    });
    if (!authorization.ok) {
      return {
        ok: false,
        code: authorization.code === "forbidden" ? "forbidden" : "not_found",
      };
    }
    if (!canReadConversation(conversation, input.punkId)) {
      return { ok: false, code: "forbidden" };
    }
    const message = this.message(input.messageId);
    if (
      message === null ||
      message.workspaceId !== input.workspaceId ||
      message.conversationId !== input.conversationId
    ) {
      return { ok: false, code: "not_found" };
    }
    let payload: Parameters<typeof authorizedMessageView>[1] = null;
    let readVersion: MessageContentVersion | null = null;
    if (message.status === "active") {
      const version = message.contentVersions.find(
        (candidate) => candidate.version === message.currentVersion,
      );
      if (version === undefined) {
        return { ok: false, code: "internal" };
      }
      try {
        const read = await this.env.MESSAGE_CONTENT.getByName(
          message.id,
        ).readAuthorized({
          workspaceId: message.workspaceId,
          conversationId: message.conversationId,
          messageId: message.id,
          generationId: message.id,
          contentKeyId: version.contentKeyId,
          purpose: "display",
        });
        if (
          !read.ok ||
          read.version !== version.version ||
          read.contentCommitment !== version.contentCommitment
        ) {
          return { ok: false, code: "content_unavailable" };
        }
        payload = read.payload;
        readVersion = version;
      } catch {
        return { ok: false, code: "content_unavailable" };
      }
    }
    const finalAuthorization = await this.env.WORKSPACES.getByName(
      input.workspaceId,
    ).authorize({
      workspaceId: input.workspaceId,
      punkId: input.punkId,
      permission: "workspace.read",
    });
    if (!finalAuthorization.ok) {
      return {
        ok: false,
        code:
          finalAuthorization.code === "forbidden" ? "forbidden" : "not_found",
      };
    }
    const finalConversation = this.effectiveState();
    const finalMessage = this.message(input.messageId);
    if (
      finalConversation === null ||
      finalConversation.id !== input.conversationId ||
      finalConversation.workspaceId !== input.workspaceId ||
      !canReadConversation(finalConversation, input.punkId)
    ) {
      return { ok: false, code: "forbidden" };
    }
    if (
      finalMessage === null ||
      finalMessage.workspaceId !== input.workspaceId ||
      finalMessage.conversationId !== input.conversationId
    ) {
      return { ok: false, code: "not_found" };
    }
    if (finalMessage.status !== "active") {
      payload = null;
    } else {
      const finalVersion = finalMessage.contentVersions.find(
        (candidate) => candidate.version === finalMessage.currentVersion,
      );
      if (
        payload === null ||
        readVersion === null ||
        finalVersion === undefined ||
        finalVersion.version !== readVersion.version ||
        finalVersion.contentKeyId !== readVersion.contentKeyId ||
        finalVersion.contentCommitment !== readVersion.contentCommitment
      ) {
        return { ok: false, code: "content_unavailable" };
      }
    }
    try {
      const view = authorizedMessageView(
        boundedMessageState(finalMessage),
        payload,
      );
      if (!validateContract("punks://contracts/message.view@1", view).valid) {
        return { ok: false, code: "internal" };
      }
      return { ok: true, messageJson: JSON.stringify(view) };
    } catch {
      return { ok: false, code: "internal" };
    }
  }

  async history(input: unknown): Promise<MessageHistoryResult> {
    try {
      await this.requirePromotionAuthorityAvailable();
    } catch {
      return { ok: false, code: "content_unavailable" };
    }
    if (
      !isMessageHistoryRequest(input) ||
      !validateContract("punks://contracts/message.history@1", input.query)
        .valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const { punkId, query } = input;
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      conversation.id !== query.conversationId ||
      conversation.workspaceId !== query.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    const initialAuthorization = await this.authorizeHistoryReader(
      query,
      punkId,
      conversation,
    );
    if (!initialAuthorization.ok) {
      return initialAuthorization;
    }

    const cursorKey = new TextEncoder().encode(
      this.env.MESSAGE_HISTORY_CURSOR_KEY,
    );
    if (cursorKey.byteLength < 32) {
      return { ok: false, code: "internal" };
    }
    let direction: "older" | "newer";
    let highWaterCursor: number;
    let positionCursor: number | null;
    if (query.cursor === null) {
      direction = query.direction ?? "older";
      highWaterCursor = conversation.cursor;
      positionCursor = null;
    } else {
      try {
        const decoded = await decodeMessageHistoryCursor(
          query.cursor,
          {
            workspaceId: query.workspaceId,
            conversationId: query.conversationId,
            ...(query.threadRootMessageId === undefined
              ? {}
              : { threadRootMessageId: query.threadRootMessageId }),
          },
          cursorKey,
        );
        direction = decoded.direction;
        highWaterCursor = decoded.highWaterCursor;
        positionCursor = decoded.positionCursor;
      } catch {
        return { ok: false, code: "cursor_invalid" };
      }
    }
    if (highWaterCursor > conversation.cursor) {
      return { ok: false, code: "cursor_invalid" };
    }

    const messageIds = this.historyMessageIds(
      query,
      highWaterCursor,
      positionCursor,
      direction,
      query.limit + 1,
    );
    const candidates: MessageView[] = [];
    for (const messageId of messageIds.slice(0, query.limit)) {
      const message = this.message(messageId);
      if (message === null) {
        return { ok: false, code: "internal" };
      }
      let payload: Parameters<typeof authorizedMessageView>[1] = null;
      if (message.status === "active") {
        const version = message.contentVersions.find(
          (candidate) => candidate.version === message.currentVersion,
        );
        if (version === undefined) {
          return { ok: false, code: "internal" };
        }
        const read = await this.env.MESSAGE_CONTENT.getByName(
          message.id,
        ).readAuthorized({
          workspaceId: message.workspaceId,
          conversationId: message.conversationId,
          messageId: message.id,
          generationId: message.id,
          contentKeyId: version.contentKeyId,
          purpose: "display",
        });
        if (
          !read.ok ||
          read.version !== version.version ||
          read.contentCommitment !== version.contentCommitment
        ) {
          return { ok: false, code: "content_unavailable" };
        }
        payload = read.payload;
      }
      let view: MessageView;
      try {
        view = authorizedMessageView(boundedMessageState(message), payload);
      } catch {
        return { ok: false, code: "internal" };
      }
      if (!validateContract("punks://contracts/message.view@1", view).valid) {
        return { ok: false, code: "internal" };
      }
      candidates.push(view);
    }

    let response: MessageHistoryResponse;
    try {
      response = await buildMessageHistoryResponse({
        workspaceId: query.workspaceId,
        conversationId: query.conversationId,
        ...(query.threadRootMessageId === undefined
          ? {}
          : { threadRootMessageId: query.threadRootMessageId }),
        highWaterCursor,
        direction,
        candidates,
        hasMoreAfterCandidates: messageIds.length > query.limit,
        cursorKey,
      });
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof MessageHistoryResponseTooLarge
            ? "content_unavailable"
            : "internal",
      };
    }

    const beforeFinalAuthorization = this.effectiveState();
    if (
      beforeFinalAuthorization === null ||
      beforeFinalAuthorization.id !== query.conversationId ||
      beforeFinalAuthorization.workspaceId !== query.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    const finalAuthorization = await this.authorizeHistoryReader(
      query,
      punkId,
      beforeFinalAuthorization,
    );
    if (!finalAuthorization.ok) {
      return finalAuthorization;
    }
    const finalConversation = this.effectiveState();
    if (
      finalConversation === null ||
      finalConversation.id !== query.conversationId ||
      finalConversation.workspaceId !== query.workspaceId ||
      !canReadConversation(finalConversation, punkId)
    ) {
      return { ok: false, code: "forbidden" };
    }
    const stableItems: MessageView[] = [];
    for (const staleView of response.items) {
      const current = this.message(staleView.id);
      if (
        current === null ||
        current.createdCursor !== staleView.createdCursor
      ) {
        return { ok: false, code: "internal" };
      }
      let payload: Parameters<typeof authorizedMessageView>[1] = null;
      if (current.status === "active") {
        if (
          staleView.status !== "active" ||
          staleView.currentVersion !== current.currentVersion ||
          typeof staleView.content !== "string"
        ) {
          return { ok: false, code: "content_unavailable" };
        }
        payload = {
          schemaVersion: 1,
          content: staleView.content,
          topic: staleView.topic,
        };
      }
      const stableView = authorizedMessageView(
        boundedMessageState(current),
        payload,
      );
      if (
        !validateContract("punks://contracts/message.view@1", stableView).valid
      ) {
        return { ok: false, code: "internal" };
      }
      stableItems.push(stableView);
    }
    response = { ...response, items: stableItems };
    if (
      new TextEncoder().encode(JSON.stringify(response)).byteLength >
      MESSAGE_HISTORY_MAX_RESPONSE_BYTES
    ) {
      return { ok: false, code: "content_unavailable" };
    }
    if (
      !validateContract(
        "punks://contracts/message.history-response@1",
        response,
      ).valid
    ) {
      return { ok: false, code: "internal" };
    }
    return { ok: true, responseJson: JSON.stringify(response) };
  }

  async searchMessages(input: unknown): Promise<MessageSearchResult> {
    if (
      !isMessageSearchRequest(input) ||
      !validateContract("punks://contracts/message.search@1", input.query).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const { punkId, query } = input;
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      this.ctx.id.name !== query.conversationId ||
      conversation.id !== query.conversationId ||
      conversation.workspaceId !== query.workspaceId ||
      conversation.status !== "active"
    ) {
      return { ok: false, code: "not_found" };
    }
    const initialAuthorization = await this.authorizeSearchReader(
      query,
      punkId,
    );
    if (!initialAuthorization.ok) {
      return initialAuthorization;
    }

    const encoder = new TextEncoder();
    if (
      typeof this.env.MESSAGE_SEARCH_MASTER_KEY !== "string" ||
      typeof this.env.MESSAGE_SEARCH_CURSOR_KEY !== "string" ||
      encoder.encode(this.env.MESSAGE_SEARCH_MASTER_KEY).byteLength < 32 ||
      encoder.encode(this.env.MESSAGE_SEARCH_CURSOR_KEY).byteLength < 32 ||
      this.env.MESSAGE_SEARCH_MASTER_KEY === this.env.MESSAGE_SEARCH_CURSOR_KEY
    ) {
      return { ok: false, code: "search_unavailable" };
    }
    const masterKey = encoder.encode(this.env.MESSAGE_SEARCH_MASTER_KEY);
    const cursorKey = encoder.encode(this.env.MESSAGE_SEARCH_CURSOR_KEY);
    let derivedQuery: Awaited<ReturnType<typeof deriveMessageSearchQuery>>;
    try {
      derivedQuery = await deriveMessageSearchQuery(
        {
          workspaceId: query.workspaceId,
          conversationId: query.conversationId,
          plaintext: query.query,
        },
        masterKey,
      );
    } catch {
      return { ok: false, code: "invalid_contract" };
    }
    let queryBinding: string;
    try {
      queryBinding = await deriveMessageSearchCursorQueryBinding(
        {
          punkId,
          workspaceId: query.workspaceId,
          conversationId: query.conversationId,
          algorithm: derivedQuery.algorithm,
          tokens: derivedQuery.tokens,
        },
        cursorKey,
      );
    } catch {
      return { ok: false, code: "search_unavailable" };
    }
    const cursorScope: MessageSearchCursorScope = {
      punkId,
      workspaceId: query.workspaceId,
      conversationId: query.conversationId,
      threadRootMessageId: query.threadRootMessageId,
      algorithm: MESSAGE_SEARCH_ALGORITHM,
      normalization: MESSAGE_SEARCH_NORMALIZATION,
      queryBinding,
      limit: query.limit,
    };
    let searchPosition: MessageSearchCandidatePosition | null = null;
    if (query.cursor !== null) {
      try {
        searchPosition = (
          await decodeMessageSearchCursor(query.cursor, cursorScope, cursorKey)
        ).position;
      } catch {
        return { ok: false, code: "cursor_invalid" };
      }
    }

    const preparedItems: PreparedSearchItem[] = [];
    const expectedCursor = this.messageSearchExpectedCursor(query);
    if (expectedCursor === null) {
      return { ok: false, code: "internal" };
    }
    const candidateBudget = Math.min(
      MESSAGE_SEARCH_MAX_CANDIDATE_BUDGET,
      Math.max(
        MESSAGE_SEARCH_MIN_CANDIDATE_BUDGET,
        query.limit * MESSAGE_SEARCH_CANDIDATE_FILL_FACTOR,
      ),
    );
    let lastConsumedPosition = searchPosition;
    let scannedCandidates = 0;
    let hasMore = false;
    let exhausted = false;
    let partialReason: "index_lagging" | "index_unavailable" | null = null;

    searchLoop: while (
      preparedItems.length < query.limit &&
      scannedCandidates < candidateBudget
    ) {
      const batchLimit = Math.min(
        MESSAGE_SEARCH_BATCH_SIZE,
        candidateBudget - scannedCandidates,
      );
      const searchRequest: SearchMessageCandidatesInput = {
        workspaceId: query.workspaceId,
        conversationId: query.conversationId,
        threadRootMessageId: query.threadRootMessageId,
        expectedCursor,
        algorithm: MESSAGE_SEARCH_ALGORITHM,
        tokens: derivedQuery.tokens,
        limit: batchLimit,
        ...(searchPosition === null ? {} : { cursor: searchPosition }),
      };
      let rawResult: unknown;
      try {
        rawResult = await this.env.MESSAGE_SEARCH.searchMessages(searchRequest);
      } catch {
        partialReason = "index_unavailable";
        hasMore = true;
        break;
      }
      const searchResult = validateSearchMessageCandidatesResult(
        rawResult,
        searchRequest,
      );
      if (searchResult === null) {
        return { ok: false, code: "search_unavailable" };
      }
      if (!searchResult.ok) {
        if (searchResult.code === "invalid_request") {
          return { ok: false, code: "search_unavailable" };
        }
        partialReason = "index_unavailable";
        hasMore = true;
        break;
      }
      if (searchResult.indexState === "lagging") {
        partialReason = "index_lagging";
      }
      if (searchResult.candidates.length === 0) {
        exhausted = true;
        break;
      }
      for (let index = 0; index < searchResult.candidates.length; index += 1) {
        const candidate = searchResult.candidates[index];
        if (candidate === undefined) {
          return { ok: false, code: "search_unavailable" };
        }
        const prepared = await this.prepareSearchCandidate(
          candidate,
          query,
          punkId,
        );
        if (!prepared.ok) {
          return prepared;
        }
        if (
          prepared.item !== null &&
          !messageSearchResponseFits(
            query,
            [...preparedItems.map(({ view }) => view), prepared.item.view],
            MESSAGE_SEARCH_MAX_CURSOR_PLACEHOLDER,
          )
        ) {
          if (lastConsumedPosition === null) {
            return { ok: false, code: "content_unavailable" };
          }
          hasMore = true;
          break searchLoop;
        }
        if (prepared.item !== null) {
          preparedItems.push(prepared.item);
        }
        lastConsumedPosition = candidatePosition(candidate);
        scannedCandidates += 1;
        if (preparedItems.length === query.limit) {
          hasMore =
            index + 1 < searchResult.candidates.length ||
            searchResult.nextCursor !== null;
          break searchLoop;
        }
      }
      if (searchResult.nextCursor === null) {
        exhausted = true;
        break;
      }
      searchPosition = searchResult.nextCursor;
    }
    if (!exhausted && scannedCandidates >= candidateBudget) {
      hasMore = true;
    }

    let nextCursor: string | null = null;
    if (partialReason !== null) {
      nextCursor = query.cursor;
    } else if (hasMore) {
      if (lastConsumedPosition === null) {
        return { ok: false, code: "search_unavailable" };
      }
      try {
        nextCursor = await encodeMessageSearchCursor(
          {
            version: 1,
            ...cursorScope,
            position: lastConsumedPosition,
          },
          cursorKey,
        );
      } catch {
        return { ok: false, code: "search_unavailable" };
      }
    }

    const finalAuthorization = await this.authorizeSearchReader(query, punkId);
    if (!finalAuthorization.ok) {
      return finalAuthorization;
    }
    const finalConversation = this.effectiveState();
    if (
      finalConversation === null ||
      finalConversation.id !== query.conversationId ||
      finalConversation.workspaceId !== query.workspaceId ||
      finalConversation.status !== "active" ||
      !canReadConversation(finalConversation, punkId)
    ) {
      return { ok: false, code: "forbidden" };
    }
    const stableItems: MessageSearchResponse["items"] = [];
    for (const prepared of preparedItems) {
      const current = this.message(prepared.candidate.messageId);
      if (
        current === null ||
        current.workspaceId !== query.workspaceId ||
        current.conversationId !== query.conversationId ||
        (query.threadRootMessageId !== null &&
          current.threadRootMessageId !== query.threadRootMessageId) ||
        current.createdCursor !== prepared.candidate.createdCursor
      ) {
        return { ok: false, code: "internal" };
      }
      if (current.status !== "active") {
        continue;
      }
      const currentVersion = current.contentVersions.find(
        (candidate) => candidate.version === current.currentVersion,
      );
      if (
        currentVersion === undefined ||
        currentVersion.version !== prepared.version.version ||
        currentVersion.contentKeyId !== prepared.version.contentKeyId ||
        currentVersion.contentCommitment !==
          prepared.version.contentCommitment ||
        !messageSearchPlaintextMatchesQuery(prepared.payload, query.query)
      ) {
        continue;
      }
      const view = authorizedMessageView(
        boundedMessageState(current),
        prepared.payload,
      );
      if (
        !validateContract("punks://contracts/message.view@1", view).valid ||
        view.status !== "active"
      ) {
        return { ok: false, code: "internal" };
      }
      stableItems.push(view as MessageSearchResponse["items"][number]);
    }
    const response: MessageSearchResponse = {
      workspaceId: query.workspaceId,
      conversationId: query.conversationId,
      threadRootMessageId: query.threadRootMessageId,
      order: "createdCursor-descending",
      completeness: partialReason === null ? "complete" : "partial",
      partialReason,
      items: stableItems,
      nextCursor,
    };
    const responseJson = JSON.stringify(response);
    if (
      encoder.encode(responseJson).byteLength >
        MESSAGE_SEARCH_MAX_RESPONSE_BYTES ||
      !validateContract("punks://contracts/message.search-response@1", response)
        .valid
    ) {
      return { ok: false, code: "content_unavailable" };
    }
    return { ok: true, responseJson };
  }

  query(input: unknown): ConversationQueryResult {
    if (
      !validateContract("punks://contracts/conversation.get@1", input).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const query = input as ConversationQuery;
    const state = this.effectiveState();
    if (
      state === null ||
      state.id !== query.conversationId ||
      state.workspaceId !== query.workspaceId
    ) {
      return { ok: false, code: "not_found" };
    }
    return { ok: true, state };
  }

  follow(): { ok: false; code: "invalid_contract" } {
    return { ok: false, code: "invalid_contract" };
  }

  override async alarm(): Promise<void> {
    const resumeFollowerPumps = this.normalizeExpiredFollowerPumps();
    if (resumeFollowerPumps) {
      this.wakeFollowers();
    }
    this.expireFollowerBackpressure();
    await this.flushBotWakeCandidateOutbox();
    this.preemptPendingReactionsForDueMessageErasure();
    await this.reconcileDueMessageErasure();
    const pending = this.pending();
    if (pending !== undefined) {
      await this.attestAndFinalize(pending, true);
    }
    const pendingMessage = this.pendingMessage();
    if (pendingMessage !== undefined) {
      await this.resumePendingMessage(pendingMessage);
    }
    const pendingReaction = this.pendingMessageReaction();
    if (pendingReaction !== undefined) {
      await this.attestAndFinalizeMessageReaction(pendingReaction, true);
      if (this.pendingMessageReaction() !== undefined) {
        return;
      }
      await this.alarmScheduling;
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
      return;
    }
    const pendingBotReaction = this.pendingBotReaction();
    if (pendingBotReaction !== undefined) {
      await this.attestAndFinalizeBotReaction(pendingBotReaction, true);
      if (this.pendingBotReaction() !== undefined) {
        return;
      }
    }
    await this.reconcileBotActionCompletions();
    await this.reconcileContentFinalizations();
    await this.flushOutbox();
    await this.archiveJournalIfNeeded();
    await this.archiveExpiredConversation();
    this.scheduleTtlAlarm();
    this.scheduleNextMessageErasure();
    this.scheduleNextFollowerDeadline();
  }

  private preemptPendingReactionsForDueMessageErasure(): void {
    const due = this.ctx.storage.sql
      .exec<{ message_id: string }>(
        `SELECT message_id FROM message_erasure_schedule
         WHERE next_attempt_at_ms <= ?
         ORDER BY next_attempt_at_ms, message_id LIMIT 1`,
        Date.now(),
      )
      .toArray()[0];
    if (due === undefined) {
      return;
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM pending_message_reaction_command WHERE singleton = 1",
    );
    const pendingBot = this.pendingBotReaction();
    if (pendingBot === undefined) {
      return;
    }
    const request = parseExecuteAdmittedBotReactionRequest(
      pendingBot.request_json,
    );
    if (
      request === null ||
      !this.hasBotCompletionCapacity(request.admissionId)
    ) {
      return;
    }
    try {
      this.ctx.storage.transactionSync(() => {
        const current = this.pendingBotReaction();
        if (!samePendingBotReaction(current, pendingBot)) {
          return;
        }
        this.recordBotCompletion(request, "failed");
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_bot_reaction WHERE singleton = 1",
        );
      });
      this.scheduleAlarm(0);
    } catch {
      // The admitted Bot action retains its durable pending row if its
      // completion reserve was concurrently consumed.
    }
  }

  private async resumePendingMessage(
    pending: PendingMessageRow,
  ): Promise<void> {
    const pendingErasure = parsePendingMessageErasure(pending.unsigned_json);
    if (pendingErasure !== null) {
      await this.reconcilePendingMessageErasure(pending, pendingErasure);
      return;
    }
    let event: UnsignedNostrEvent;
    try {
      event = JSON.parse(String(pending.unsigned_json)) as UnsignedNostrEvent;
    } catch {
      this.markPendingMessageFailure(pending);
      return;
    }
    const contract = eventContractTag(event);
    if (contract === "message.post@1") {
      await this.attestAndFinalizeMessage(pending, true);
    } else if (contract === "message.edit@1") {
      await this.attestAndFinalizeMessageMutation(pending, true);
    } else if (
      contract === "message.retract@1" ||
      contract === "message.restore@1"
    ) {
      await this.attestAndFinalizeMessageStateMutation(pending, true);
    } else if (contract === "message.finalize-erasure@1") {
      await this.attestAndFinalizeMessageErasure(pending, true);
    } else {
      this.markPendingMessageFailure(pending);
    }
  }

  private initialize(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS conversation_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS command_results (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_command (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        command_json TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_state_json TEXT NOT NULL,
        reduction_overlay INTEGER NOT NULL DEFAULT 0
          CHECK (reduction_overlay IN (0, 1)),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        author_json TEXT NOT NULL,
        message_type TEXT NOT NULL,
        status TEXT NOT NULL,
        topic_present INTEGER NOT NULL CHECK (topic_present IN (0, 1)),
        mentioned_punk_ids_json TEXT NOT NULL,
        media_ids_json TEXT NOT NULL,
        parent_message_id TEXT,
        thread_root_message_id TEXT NOT NULL,
        thread_depth INTEGER NOT NULL,
        broadcast INTEGER NOT NULL CHECK (broadcast IN (0, 1)),
        reply_count INTEGER NOT NULL CHECK (reply_count >= 0),
        descendant_count INTEGER NOT NULL CHECK (descendant_count >= 0),
        last_reply_at TEXT,
        original_content_commitment TEXT,
        current_version INTEGER,
        retraction_json TEXT,
        erasure_marker_json TEXT,
        revision INTEGER NOT NULL,
        created_cursor INTEGER NOT NULL,
        cursor INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        edited_at TEXT,
        CHECK (
          (status = 'erased' AND original_content_commitment IS NULL)
          OR (status != 'erased' AND original_content_commitment IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX IF NOT EXISTS messages_thread
        ON messages (thread_root_message_id, cursor);

      CREATE INDEX IF NOT EXISTS messages_history
        ON messages (created_cursor DESC, message_id ASC);

      CREATE INDEX IF NOT EXISTS messages_thread_history
        ON messages (
          thread_root_message_id,
          created_cursor DESC,
          message_id ASC
        );

      CREATE TABLE IF NOT EXISTS message_versions (
        message_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_commitment TEXT NOT NULL,
        ciphertext_ref TEXT NOT NULL UNIQUE,
        content_key_id TEXT NOT NULL UNIQUE,
        topic_present INTEGER NOT NULL CHECK (topic_present IN (0, 1)),
        created_at TEXT NOT NULL,
        PRIMARY KEY (message_id, version),
        FOREIGN KEY (message_id) REFERENCES messages(message_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS message_command_results (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        response_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_message_command (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        request_fingerprint TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_message_json TEXT NOT NULL,
        version_json TEXT NOT NULL,
        thread_deltas_json TEXT NOT NULL,
        search_json TEXT NOT NULL,
        next_conversation_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS message_reactions (
        reaction_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('punk', 'bot')),
        actor_id TEXT NOT NULL,
        reaction TEXT NOT NULL CHECK (length(reaction) BETWEEN 1 AND 66),
        status TEXT NOT NULL CHECK (status IN ('active', 'removed')),
        revision INTEGER NOT NULL CHECK (revision >= 1),
        created_cursor INTEGER NOT NULL CHECK (created_cursor >= 1),
        cursor INTEGER NOT NULL CHECK (cursor >= created_cursor),
        created_at TEXT NOT NULL,
        reacted_at TEXT,
        updated_at TEXT NOT NULL,
        removed_at TEXT,
        UNIQUE (
          workspace_id, conversation_id, message_id, actor_kind, actor_id,
          reaction
        ),
        CHECK (
          (status = 'active' AND reacted_at IS NOT NULL AND removed_at IS NULL)
          OR
          (status = 'removed' AND reacted_at IS NULL AND removed_at IS NOT NULL)
        )
      ) STRICT;

      CREATE INDEX IF NOT EXISTS message_reactions_message_value
        ON message_reactions (
          workspace_id, conversation_id, message_id, reaction, status
        );

      CREATE TABLE IF NOT EXISTS message_reaction_counts (
        message_id TEXT NOT NULL,
        reaction TEXT NOT NULL CHECK (length(reaction) BETWEEN 1 AND 66),
        active_count INTEGER NOT NULL
          CHECK (active_count BETWEEN 0 AND 2147483647),
        last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1),
        PRIMARY KEY (message_id, reaction)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS message_reaction_visibility (
        message_id TEXT PRIMARY KEY NOT NULL,
        visibility TEXT NOT NULL CHECK (
          visibility IN (
            'visible', 'temporarily-hidden', 'permanently-hidden'
          )
        ),
        last_cursor INTEGER NOT NULL CHECK (last_cursor >= 1)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS message_reaction_command_results (
        command_id TEXT PRIMARY KEY NOT NULL,
        semantic_hash TEXT NOT NULL,
        reaction_id TEXT NOT NULL,
        command_record_json TEXT NOT NULL,
        committed_cursor INTEGER,
        bot_admission_id TEXT,
        bot_action_digest TEXT,
        bot_outcome TEXT CHECK (bot_outcome IS NULL OR bot_outcome = 'succeeded'),
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_message_reaction_command (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        semantic_hash TEXT NOT NULL,
        reaction_id TEXT NOT NULL,
        command_json TEXT NOT NULL,
        command_record_json TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_reaction_json TEXT NOT NULL,
        projection_delta_json TEXT NOT NULL,
        next_conversation_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_bot_reaction (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        semantic_hash TEXT NOT NULL,
        reaction_id TEXT NOT NULL,
        request_json TEXT NOT NULL,
        command_json TEXT NOT NULL,
        command_record_json TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_reaction_json TEXT NOT NULL,
        projection_delta_json TEXT NOT NULL,
        next_conversation_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bot_action_completions (
        admission_id TEXT PRIMARY KEY NOT NULL,
        request_json TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bot_wake_subscriptions (
        installation_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        bot_id TEXT NOT NULL,
        epoch INTEGER NOT NULL CHECK (epoch >= 1),
        high_water_cursor INTEGER NOT NULL CHECK (high_water_cursor >= 1),
        preparation_id TEXT,
        status TEXT NOT NULL CHECK (
          status IN ('prepared', 'active', 'disabled')
        ),
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bot_wake_candidate_outbox (
        wake_id TEXT PRIMARY KEY NOT NULL,
        installation_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        candidate_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0
          CHECK (attempts BETWEEN 0 AND 63),
        next_attempt_at INTEGER NOT NULL CHECK (next_attempt_at >= 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS bot_wake_candidate_outbox_due
        ON bot_wake_candidate_outbox (next_attempt_at, wake_id);

      CREATE TABLE IF NOT EXISTS message_erasure_schedule (
        message_id TEXT PRIMARY KEY NOT NULL,
        retraction_command_id TEXT NOT NULL,
        erase_after TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at_ms INTEGER NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS message_erasure_due
        ON message_erasure_schedule (next_attempt_at_ms, message_id);

      CREATE TABLE IF NOT EXISTS journal (
        cursor INTEGER PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_kind INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY NOT NULL,
        cursor INTEGER NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projection_delivery_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        enqueued_through_cursor INTEGER NOT NULL CHECK (
          enqueued_through_cursor >= 0
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS content_finalization (
        event_id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL UNIQUE,
        command_id TEXT NOT NULL UNIQUE,
        content_key_id TEXT NOT NULL UNIQUE,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS archive_segments (
        start_cursor INTEGER PRIMARY KEY NOT NULL,
        end_cursor INTEGER NOT NULL UNIQUE,
        previous_segment_hash TEXT,
        segment_hash TEXT NOT NULL UNIQUE,
        object_key TEXT NOT NULL UNIQUE,
        seal_json TEXT NOT NULL,
        archived_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_archive (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        start_cursor INTEGER NOT NULL,
        end_cursor INTEGER NOT NULL,
        previous_segment_hash TEXT,
        segment_hash TEXT NOT NULL,
        object_key TEXT NOT NULL,
        events_json TEXT NOT NULL,
        unsigned_seal_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_archive_seals (
        segment_hash TEXT PRIMARY KEY NOT NULL,
        seal_json TEXT NOT NULL,
        persisted_at TEXT NOT NULL
      ) STRICT;
    `);
    const botWakeSubscriptionColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(bot_wake_subscriptions)")
      .toArray();
    if (
      !botWakeSubscriptionColumns.some(({ name }) => name === "preparation_id")
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE bot_wake_subscriptions ADD COLUMN preparation_id TEXT",
      );
    }
    const pendingCommandColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_command)")
      .toArray();
    if (
      !pendingCommandColumns.some((column) => column.name === "command_json")
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN command_json TEXT NOT NULL DEFAULT '{}'",
      );
    }
    if (
      !pendingCommandColumns.some(
        (column) => column.name === "reduction_overlay",
      )
    ) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE pending_command
         ADD COLUMN reduction_overlay INTEGER NOT NULL DEFAULT 0
         CHECK (reduction_overlay IN (0, 1))`,
      );
    }
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO message_reaction_visibility
        (message_id, visibility, last_cursor)
       SELECT message_id,
              CASE status
                WHEN 'active' THEN 'visible'
                WHEN 'retracted' THEN 'temporarily-hidden'
                ELSE 'permanently-hidden'
              END,
              cursor
       FROM messages`,
    );
    const resultColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(message_command_results)")
      .toArray();
    if (
      !resultColumns.some((column) => column.name === "request_fingerprint")
    ) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE message_command_results
         ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT ''`,
      );
    }
    const pendingMessageColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_message_command)")
      .toArray();
    if (
      !pendingMessageColumns.some(
        (column) => column.name === "request_fingerprint",
      )
    ) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE pending_message_command
         ADD COLUMN request_fingerprint TEXT NOT NULL DEFAULT ''`,
      );
    }
    const completionColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(bot_action_completions)")
      .toArray();
    if (
      !completionColumns.some((column) => column.name === "next_attempt_at")
    ) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE bot_action_completions
         ADD COLUMN next_attempt_at INTEGER NOT NULL DEFAULT 0`,
      );
    }
    const reactionResultColumns = this.ctx.storage.sql
      .exec<{ name: string }>(
        "PRAGMA table_info(message_reaction_command_results)",
      )
      .toArray();
    if (
      !reactionResultColumns.some(
        (column) => column.name === "bot_admission_id",
      )
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE message_reaction_command_results ADD COLUMN bot_admission_id TEXT",
      );
    }
    if (
      !reactionResultColumns.some(
        (column) => column.name === "bot_action_digest",
      )
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE message_reaction_command_results ADD COLUMN bot_action_digest TEXT",
      );
    }
    if (
      !reactionResultColumns.some((column) => column.name === "bot_outcome")
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE message_reaction_command_results ADD COLUMN bot_outcome TEXT",
      );
    }
    this.ctx.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS bot_action_completions_due
       ON bot_action_completions (delivered_at, next_attempt_at, admission_id)`,
    );
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO projection_delivery_state
          (singleton, enqueued_through_cursor) VALUES (1, 0)`,
      );
      const legacyDeliveredThrough = this.ctx.storage.sql
        .exec<{ cursor: number | null }>(
          `SELECT MAX(cursor) AS cursor FROM outbox
           WHERE delivered_at IS NOT NULL`,
        )
        .one().cursor;
      if (legacyDeliveredThrough !== null) {
        this.ctx.storage.sql.exec(
          `UPDATE projection_delivery_state
           SET enqueued_through_cursor = MAX(enqueued_through_cursor, ?)
           WHERE singleton = 1`,
          legacyDeliveredThrough,
        );
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM outbox WHERE delivered_at IS NOT NULL",
      );
    });
    this.legacyRequiredOriginalContentCommitment =
      this.ctx.storage.sql
        .exec<{ name: string; notnull: number }>("PRAGMA table_info(messages)")
        .toArray()
        .find((column) => column.name === "original_content_commitment")
        ?.notnull === 1;
  }

  private async repairDurableAlarm(): Promise<void> {
    if (this.prepareFollowerPumpsAfterWake()) {
      await this.ctx.storage.setAlarm(Date.now());
      return;
    }
    const durableWork = this.ctx.storage.sql
      .exec<{ has_work: number }>(
        `SELECT (
           EXISTS(SELECT 1 FROM pending_command) OR
           EXISTS(SELECT 1 FROM pending_message_command) OR
           EXISTS(SELECT 1 FROM pending_message_reaction_command) OR
           EXISTS(SELECT 1 FROM pending_bot_reaction) OR
           EXISTS(SELECT 1 FROM content_finalization) OR
           EXISTS(SELECT 1 FROM outbox WHERE delivered_at IS NULL) OR
           EXISTS(SELECT 1 FROM pending_archive)
         ) AS has_work`,
      )
      .one().has_work;
    if (durableWork === 1 || !this.hasJournalCapacity()) {
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
      return;
    }
    const state = this.state();
    const nextErasure = this.ctx.storage.sql
      .exec<{ next_attempt_at_ms: number | null }>(
        `SELECT MIN(next_attempt_at_ms) AS next_attempt_at_ms
         FROM message_erasure_schedule`,
      )
      .toArray()[0]?.next_attempt_at_ms;
    const nextBotCompletion = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at
         FROM bot_action_completions WHERE delivered_at IS NULL`,
      )
      .one().next_attempt_at;
    const nextBotWakeCandidate = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at
         FROM bot_wake_candidate_outbox`,
      )
      .one().next_attempt_at;
    const deadlines: number[] = [];
    if (
      state !== null &&
      state.status === "active" &&
      state.ttlDeadline !== null
    ) {
      deadlines.push(Date.parse(state.ttlDeadline));
    }
    if (typeof nextErasure === "number") {
      deadlines.push(nextErasure);
    }
    if (typeof nextBotCompletion === "number") {
      deadlines.push(nextBotCompletion);
    }
    if (typeof nextBotWakeCandidate === "number") {
      deadlines.push(nextBotWakeCandidate);
    }
    if (deadlines.length > 0) {
      await this.ctx.storage.setAlarm(Math.min(...deadlines));
    }
    this.scheduleNextFollowerDeadline();
  }

  private state(): Conversation | null {
    const row = this.ctx.storage.sql
      .exec<StateRow>(
        "SELECT state_json FROM conversation_state WHERE singleton = 1",
      )
      .toArray()[0];
    return row === undefined
      ? null
      : (JSON.parse(row.state_json) as Conversation);
  }

  private botWakeSubscription(
    installationId: string,
  ): BotWakeSubscriptionRow | undefined {
    return this.ctx.storage.sql
      .exec<BotWakeSubscriptionRow>(
        `SELECT workspace_id, conversation_id, bot_id, installation_id,
                epoch, high_water_cursor, preparation_id, status
         FROM bot_wake_subscriptions WHERE installation_id = ?`,
        installationId,
      )
      .toArray()[0];
  }

  private botWakeCandidateSource(
    installationId: string,
    messageId: string,
  ): BotWakeCandidateSourceResult {
    const conversation = this.effectiveState();
    if (conversation === null || this.ctx.id.name !== conversation.id) {
      return { ok: false, code: "not_found" };
    }
    if (conversation.status !== "active") {
      return { ok: false, code: "forbidden" };
    }
    if (this.hasPendingAggregateMutation()) {
      return { ok: false, code: "conflict" };
    }
    const subscription = this.botWakeSubscription(installationId);
    if (
      subscription === undefined ||
      subscription.workspace_id !== conversation.workspaceId ||
      subscription.conversation_id !== conversation.id ||
      subscription.installation_id !== installationId ||
      subscription.status !== "active"
    ) {
      return { ok: false, code: "forbidden" };
    }
    const message = this.message(messageId);
    if (message === null) {
      return { ok: false, code: "not_found" };
    }
    if (
      message.workspaceId !== conversation.workspaceId ||
      message.conversationId !== conversation.id ||
      message.status !== "active" ||
      message.createdCursor <= subscription.high_water_cursor ||
      message.cursor !== message.createdCursor ||
      message.currentVersion !== 1 ||
      message.revision !== 1 ||
      message.editedAt !== null ||
      message.retraction !== null ||
      message.erasureMarker !== null ||
      message.contentVersions.length !== 1 ||
      message.contentVersions[0]?.version !== 1 ||
      this.contentFinalizationForMessage(message.id) !== undefined
    ) {
      return { ok: false, code: "forbidden" };
    }
    const journal = this.ctx.storage.sql
      .exec<{
        cursor: number;
        event_id: string;
        event_kind: number;
        event_json: string;
      }>(
        `SELECT cursor, event_id, event_kind, event_json FROM journal
         WHERE cursor = ?`,
        message.createdCursor,
      )
      .toArray()[0];
    if (journal === undefined) {
      return { ok: false, code: "conflict" };
    }
    const parsedEvent = parseJson(journal.event_json);
    if (
      !validateContract("punks://contracts/nostr.signed-event@1", parsedEvent)
        .valid ||
      !botWakeSourceEventMatchesMessage(
        parsedEvent as SignedNostrEvent,
        journal,
        message,
      )
    ) {
      return { ok: false, code: "conflict" };
    }
    return {
      ok: true,
      source: {
        conversation: {
          id: conversation.id,
          workspaceId: conversation.workspaceId,
          status: conversation.status,
        },
        subscription,
        message,
        journal,
        event: parsedEvent as SignedNostrEvent,
      },
    };
  }

  private botWakeCandidateOutbox(
    wakeId: string,
  ): BotWakeCandidateOutboxRow | undefined {
    return this.ctx.storage.sql
      .exec<BotWakeCandidateOutboxRow>(
        `SELECT wake_id, installation_id, message_id, candidate_json,
                attempts, next_attempt_at, created_at
         FROM bot_wake_candidate_outbox WHERE wake_id = ?`,
        wakeId,
      )
      .toArray()[0];
  }

  private hasBotWakeCandidateOutboxCapacity(
    candidateRowBytes: number,
  ): boolean {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(wake_id AS BLOB)) +
                  length(CAST(installation_id AS BLOB)) +
                  length(CAST(message_id AS BLOB)) +
                  length(CAST(candidate_json AS BLOB)) +
                  length(CAST(created_at AS BLOB)) + 16
                ), 0) AS bytes
         FROM bot_wake_candidate_outbox`,
      )
      .one();
    return (
      Number(usage.rows) + 1 <= MAX_BOT_WAKE_CANDIDATE_OUTBOX_ROWS &&
      Number(usage.bytes) + candidateRowBytes <=
        MAX_BOT_WAKE_CANDIDATE_OUTBOX_BYTES
    );
  }

  private async deliverBotWakeCandidate(
    row: BotWakeCandidateOutboxRow,
  ): Promise<void> {
    const parsed = parseJson(row.candidate_json);
    if (
      !isBotWakeCandidate(parsed) ||
      canonicalJson(parsed) !== row.candidate_json ||
      parsed.wakeId !== row.wake_id ||
      parsed.installationId !== row.installation_id ||
      parsed.messageId !== row.message_id
    ) {
      this.deferBotWakeCandidate(row);
      return;
    }
    try {
      const journal = this.ctx.storage.sql
        .exec<{ event_id: string; event_kind: number; event_json: string }>(
          `SELECT event_id, event_kind, event_json FROM journal
           WHERE cursor = ?`,
          parsed.messageCursor,
        )
        .toArray()[0];
      const sourceEvent =
        journal === undefined ? null : parseJson(journal.event_json);
      if (
        journal === undefined ||
        !validateContract("punks://contracts/nostr.signed-event@1", sourceEvent)
          .valid ||
        !botWakeCandidateMatchesSourceEvent(
          parsed,
          sourceEvent as SignedNostrEvent,
          journal,
        )
      ) {
        this.deferBotWakeCandidate(row);
        return;
      }
      const [expectedWakeId, exactCoordinates, verifiedSource, exactDigest] =
        await Promise.all([
          deriveBotWakeId({
            installationId: parsed.installationId,
            subscriptionEpoch: parsed.subscriptionEpoch,
            messageId: parsed.messageId,
            messageCursor: parsed.messageCursor,
          }),
          botWakeCoordinatesMatch({
            workspaceId: parsed.workspaceId,
            botId: parsed.botId,
            installationId: parsed.installationId,
          }),
          verifyAttestation(sourceEvent as SignedNostrEvent, this.env),
          sha256Hex(canonicalJson(sourceEvent)),
        ]);
      if (
        expectedWakeId !== parsed.wakeId ||
        !exactCoordinates ||
        !verifiedSource ||
        exactDigest !== parsed.sourceEventDigest
      ) {
        this.deferBotWakeCandidate(row);
        return;
      }
      const result: unknown = await this.env.BOT_INSTALLATIONS.getByName(
        parsed.installationId,
      ).acceptBotWakeCandidate(parsed);
      const accepted = exactAcceptBotWakeCandidateResult(result, parsed.wakeId);
      if (accepted === null) {
        this.deferBotWakeCandidate(row);
        return;
      }
      if (
        accepted.ok ||
        accepted.code === "authority_revoked" ||
        accepted.code === "not_found" ||
        accepted.code === "conflict"
      ) {
        this.deleteBotWakeCandidate(row);
        return;
      }
      this.deferBotWakeCandidate(row);
    } catch {
      this.deferBotWakeCandidate(row);
    }
  }

  private deleteBotWakeCandidate(row: BotWakeCandidateOutboxRow): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM bot_wake_candidate_outbox
       WHERE wake_id = ? AND installation_id = ? AND message_id = ?
         AND candidate_json = ? AND attempts = ? AND next_attempt_at = ?
         AND created_at = ?`,
      row.wake_id,
      row.installation_id,
      row.message_id,
      row.candidate_json,
      row.attempts,
      row.next_attempt_at,
      row.created_at,
    );
  }

  private deferBotWakeCandidate(row: BotWakeCandidateOutboxRow): void {
    const attempts = nextRetryAttempt(row.attempts);
    const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
    this.ctx.storage.sql.exec(
      `UPDATE bot_wake_candidate_outbox
       SET attempts = ?, next_attempt_at = ?
       WHERE wake_id = ? AND installation_id = ? AND message_id = ?
         AND candidate_json = ? AND attempts = ? AND next_attempt_at = ?
         AND created_at = ?`,
      attempts,
      Date.now() + delay,
      row.wake_id,
      row.installation_id,
      row.message_id,
      row.candidate_json,
      row.attempts,
      row.next_attempt_at,
      row.created_at,
    );
    this.scheduleAlarm(delay);
  }

  private async flushBotWakeCandidateOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<BotWakeCandidateOutboxRow>(
        `SELECT wake_id, installation_id, message_id, candidate_json,
                attempts, next_attempt_at, created_at
         FROM bot_wake_candidate_outbox
         WHERE next_attempt_at <= ?
         ORDER BY next_attempt_at, wake_id
         LIMIT ?`,
        Date.now(),
        MAX_BOT_WAKE_CANDIDATE_DELIVERIES_PER_ALARM,
      )
      .toArray();
    for (const row of rows) {
      await this.deliverBotWakeCandidate(row);
    }
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at
         FROM bot_wake_candidate_outbox`,
      )
      .one().next_attempt_at;
    if (next !== null) {
      this.scheduleAlarm(Math.max(1_000, next - Date.now()));
    }
  }

  private botWakeSubscriptionCounts(): { total: number; live: number } {
    return this.ctx.storage.sql
      .exec<{ total: number; live: number }>(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status IN ('prepared', 'active')
                                  THEN 1 ELSE 0 END), 0) AS live
         FROM bot_wake_subscriptions`,
      )
      .one();
  }

  private effectiveState(): Conversation | null {
    const committed = this.state();
    const pending = this.pending();
    if (pending === undefined || Number(pending.reduction_overlay) !== 1) {
      return committed;
    }
    if (committed === null) {
      return null;
    }
    const command = parseConversationCommand(String(pending.command_json));
    const unsigned = parseUnsignedEvent(String(pending.unsigned_json));
    const overlay = parseConversation(String(pending.next_state_json));
    if (
      command === null ||
      unsigned === null ||
      overlay === null ||
      !isConversationSafetyReduction(committed, command)
    ) {
      return null;
    }
    const workspaceCursor = Number(unsigned.tags[6]?.[1]);
    const workspaceRole = unsigned.tags[7]?.[1];
    if (
      !Number.isSafeInteger(workspaceCursor) ||
      workspaceCursor < 1 ||
      !isWorkspaceRole(workspaceRole)
    ) {
      return null;
    }
    let expected: { nextState: Conversation; event: UnsignedNostrEvent };
    const context = {
      conversationId: committed.id,
      cursor: overlay.cursor,
      now: new Date(overlay.updatedAt),
      workspaceCursor,
      workspaceRole,
    };
    try {
      expected = decideConversationCommand(committed, command, context);
    } catch {
      return null;
    }
    return canonicalJson(expected.nextState) === canonicalJson(overlay) &&
      canonicalJson(expected.event) === canonicalJson(unsigned)
      ? overlay
      : null;
  }

  private result(commandId: string): ResultRow | undefined {
    return this.ctx.storage.sql
      .exec<ResultRow>(
        "SELECT payload_hash, response_json FROM command_results WHERE command_id = ?",
        commandId,
      )
      .toArray()[0];
  }

  private pending(): PendingRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingRow>(
        `SELECT command_id, payload_hash, command_json, unsigned_json,
                next_state_json, reduction_overlay, attempts
         FROM pending_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private pendingMessage(): PendingMessageRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingMessageRow>(
        `SELECT command_id, payload_hash, unsigned_json, next_message_json,
                request_fingerprint, version_json, thread_deltas_json, search_json,
                next_conversation_json, attempts
         FROM pending_message_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private pendingMessageReaction(): PendingMessageReactionRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingMessageReactionRow>(
        `SELECT command_id, semantic_hash, reaction_id, command_json,
                command_record_json, unsigned_json, next_reaction_json,
                projection_delta_json, next_conversation_json, attempts
         FROM pending_message_reaction_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private messageReaction(reactionId: string): MessageReaction | null {
    const row = this.ctx.storage.sql
      .exec<MessageReactionRow>(
        `SELECT reaction_id, workspace_id, conversation_id, message_id,
                actor_kind, actor_id, reaction, status, revision,
                created_cursor, cursor, created_at, reacted_at, updated_at,
                removed_at
         FROM message_reactions WHERE reaction_id = ?`,
        reactionId,
      )
      .toArray()[0];
    if (row === undefined) {
      return null;
    }
    return {
      id: row.reaction_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      actor:
        row.actor_kind === "punk"
          ? { kind: "punk", punkId: row.actor_id }
          : { kind: "bot", installationId: row.actor_id },
      reaction: row.reaction,
      status: row.status,
      revision: Number(row.revision),
      createdCursor: Number(row.created_cursor),
      cursor: Number(row.cursor),
      createdAt: row.created_at,
      reactedAt: row.reacted_at,
      updatedAt: row.updated_at,
      removedAt: row.removed_at,
    };
  }

  private messageReactionResult(
    commandId: string,
  ): MessageReactionResultRow | undefined {
    return this.ctx.storage.sql
      .exec<MessageReactionResultRow>(
        `SELECT semantic_hash, reaction_id, command_record_json,
                committed_cursor, bot_admission_id, bot_action_digest,
                bot_outcome
         FROM message_reaction_command_results WHERE command_id = ?`,
        commandId,
      )
      .toArray()[0];
  }

  private messageReactionStorageUsage(): {
    resultRows: number;
    resultBytes: number;
  } {
    const results = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(command_id AS BLOB)) +
                  length(CAST(semantic_hash AS BLOB)) +
                  length(CAST(reaction_id AS BLOB)) +
                  length(CAST(command_record_json AS BLOB)) +
                  COALESCE(length(CAST(bot_admission_id AS BLOB)), 0) +
                  COALESCE(length(CAST(bot_action_digest AS BLOB)), 0) +
                  COALESCE(length(CAST(bot_outcome AS BLOB)), 0) +
                  length(CAST(committed_at AS BLOB))
                ), 0) AS bytes
         FROM message_reaction_command_results`,
      )
      .one();
    return {
      resultRows: Number(results.rows),
      resultBytes: Number(results.bytes),
    };
  }

  private outboxStorageUsage(): { rows: number; bytes: number } {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) AS bytes
         FROM outbox WHERE delivered_at IS NULL`,
      )
      .one();
    return { rows: Number(usage.rows), bytes: Number(usage.bytes) };
  }

  private terminalLiabilities(): {
    outbox: number;
    conversationResults: number;
    messageResults: number;
    reactionResults: number;
  } {
    const conversationResults = conversationTerminalLiability(this.state());
    const messages = this.ctx.storage.sql
      .exec<{ liabilities: number }>(
        `SELECT COALESCE(SUM(
           CASE status WHEN 'active' THEN 2 WHEN 'retracted' THEN 1 ELSE 0 END
         ), 0) AS liabilities FROM messages`,
      )
      .one().liabilities;
    const reactions = this.ctx.storage.sql
      .exec<{ liabilities: number }>(
        `SELECT COUNT(*) AS liabilities FROM message_reactions
         WHERE status = 'active'`,
      )
      .one().liabilities;
    const messageResults = Number(messages);
    const reactionResults = Number(reactions);
    return {
      outbox: conversationResults + messageResults + reactionResults,
      conversationResults,
      messageResults,
      reactionResults,
    };
  }

  private hasOutboxCommitCapacity(
    projectionJson: string,
    liabilityDelta: number,
    safetyReduction: boolean,
  ): boolean {
    const projectionBytes = utf8ByteLength(projectionJson);
    if (projectionBytes > MAXIMUM_PROJECTION_PAYLOAD_BYTES) {
      return false;
    }
    const usage = this.outboxStorageUsage();
    const liabilities = this.terminalLiabilities().outbox;
    const liabilitiesAfter = liabilities + liabilityDelta;
    if (!Number.isSafeInteger(liabilitiesAfter) || liabilitiesAfter < 0) {
      return false;
    }
    const normalCapacity =
      usage.rows + 1 <= MAXIMUM_NORMAL_UNDELIVERED_OUTBOX_ROWS &&
      usage.bytes + projectionBytes <= MAXIMUM_NORMAL_UNDELIVERED_OUTBOX_BYTES;
    const hardCapacity =
      usage.rows + 1 + liabilitiesAfter <= MAXIMUM_UNDELIVERED_OUTBOX_ROWS &&
      usage.bytes +
        projectionBytes +
        liabilitiesAfter * MAXIMUM_PROJECTION_PAYLOAD_BYTES <=
        MAXIMUM_UNDELIVERED_OUTBOX_BYTES;
    if (normalCapacity && hardCapacity) {
      return true;
    }
    if (!safetyReduction) {
      return false;
    }
    return (
      usage.rows + 1 + liabilitiesAfter <= usage.rows + liabilities &&
      usage.bytes +
        projectionBytes +
        liabilitiesAfter * MAXIMUM_PROJECTION_PAYLOAD_BYTES <=
        usage.bytes + liabilities * MAXIMUM_PROJECTION_PAYLOAD_BYTES
    );
  }

  private hasResultCommitCapacity(input: {
    usage: { rows: number; bytes: number };
    resultBytes: number;
    liabilities: number;
    liabilityDelta: number;
    normalRows: number;
    normalBytes: number;
    hardRows: number;
    hardBytes: number;
    maximumRowBytes: number;
    safetyReduction: boolean;
  }): boolean {
    if (
      !Number.isSafeInteger(input.resultBytes) ||
      input.resultBytes < 1 ||
      input.resultBytes > input.maximumRowBytes
    ) {
      return false;
    }
    const liabilitiesAfter = input.liabilities + input.liabilityDelta;
    if (!Number.isSafeInteger(liabilitiesAfter) || liabilitiesAfter < 0) {
      return false;
    }
    const normalCapacity =
      input.usage.rows + 1 <= input.normalRows &&
      input.usage.bytes + input.resultBytes <= input.normalBytes;
    const hardCapacity =
      input.usage.rows + 1 + liabilitiesAfter <= input.hardRows &&
      input.usage.bytes +
        input.resultBytes +
        liabilitiesAfter * input.maximumRowBytes <=
        input.hardBytes;
    if (normalCapacity && hardCapacity) {
      return true;
    }
    if (!input.safetyReduction) {
      return false;
    }
    return (
      input.usage.rows + 1 + liabilitiesAfter <=
        input.usage.rows + input.liabilities &&
      input.usage.bytes +
        input.resultBytes +
        liabilitiesAfter * input.maximumRowBytes <=
        input.usage.bytes + input.liabilities * input.maximumRowBytes
    );
  }

  private hasMessageReactionResultCapacity(resultBytes: number): boolean {
    if (
      !Number.isSafeInteger(resultBytes) ||
      resultBytes < 1 ||
      resultBytes > MAXIMUM_REACTION_RESULT_ROW_BYTES
    ) {
      return false;
    }
    const usage = this.messageReactionStorageUsage();
    return this.hasResultCommitCapacity({
      usage: { rows: usage.resultRows, bytes: usage.resultBytes },
      resultBytes,
      liabilities: this.terminalLiabilities().reactionResults,
      liabilityDelta: 0,
      normalRows: MAXIMUM_NORMAL_REACTION_RESULT_ROWS,
      normalBytes: MAXIMUM_NORMAL_REACTION_RESULT_BYTES,
      hardRows: MAXIMUM_REACTION_RESULT_ROWS,
      hardBytes: MAXIMUM_REACTION_RESULT_BYTES,
      maximumRowBytes: MAXIMUM_REACTION_RESULT_ROW_BYTES,
      safetyReduction: false,
    });
  }

  private hasMessageReactionCommitCapacity(
    current: MessageReaction | null,
    next: MessageReaction,
    projectionJson: string,
    resultBytes: number,
    safetyReduction: boolean,
  ): boolean {
    const currentLiability = current?.status === "active" ? 1 : 0;
    const nextLiability = next.status === "active" ? 1 : 0;
    const liabilityDelta = nextLiability - currentLiability;
    if (
      !this.hasOutboxCommitCapacity(
        projectionJson,
        liabilityDelta,
        safetyReduction,
      )
    ) {
      return false;
    }
    const usage = this.messageReactionStorageUsage();
    return this.hasResultCommitCapacity({
      usage: { rows: usage.resultRows, bytes: usage.resultBytes },
      resultBytes,
      liabilities: this.terminalLiabilities().reactionResults,
      liabilityDelta,
      normalRows: MAXIMUM_NORMAL_REACTION_RESULT_ROWS,
      normalBytes: MAXIMUM_NORMAL_REACTION_RESULT_BYTES,
      hardRows: MAXIMUM_REACTION_RESULT_ROWS,
      hardBytes: MAXIMUM_REACTION_RESULT_BYTES,
      maximumRowBytes: MAXIMUM_REACTION_RESULT_ROW_BYTES,
      safetyReduction,
    });
  }

  private pendingBotReaction(): PendingBotReactionRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingBotReactionRow>(
        `SELECT command_id, semantic_hash, reaction_id, request_json,
                command_json, command_record_json, unsigned_json,
                next_reaction_json, projection_delta_json,
                next_conversation_json, attempts
         FROM pending_bot_reaction WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private botActionCompletion(
    admissionId: string,
  ): BotActionCompletionRow | undefined {
    return this.ctx.storage.sql
      .exec<BotActionCompletionRow>(
        `SELECT admission_id, request_json, outcome, delivered_at, attempts,
                next_attempt_at
         FROM bot_action_completions WHERE admission_id = ?`,
        admissionId,
      )
      .toArray()[0];
  }

  private hasExactBotCompletion(
    request: ExecuteAdmittedBotReactionRequest,
    outcome: "succeeded" | "failed",
  ): boolean {
    if (outcome === "succeeded") {
      const result = this.messageReactionResult(request.reactionCommandId);
      return (
        result !== undefined &&
        result.bot_admission_id === request.admissionId &&
        result.bot_action_digest === request.actionDigest &&
        result.bot_outcome === "succeeded"
      );
    }
    const completion = this.botActionCompletion(request.admissionId);
    return (
      completion !== undefined &&
      completion.outcome === "failed" &&
      canonicalJson(parseJson(completion.request_json)) ===
        canonicalJson(completionRequest(request, "failed"))
    );
  }

  private hasBotCompletionCapacity(admissionId: string): boolean {
    if (this.botActionCompletion(admissionId) !== undefined) {
      return true;
    }
    return (
      this.ctx.storage.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM bot_action_completions
           WHERE delivered_at IS NULL`,
        )
        .one().count < MAX_PENDING_BOT_ACTION_COMPLETIONS
    );
  }

  private recordBotCompletion(
    request: ExecuteAdmittedBotReactionRequest,
    outcome: "succeeded" | "failed",
  ): void {
    const completion = completionRequest(request, outcome);
    const existing = this.botActionCompletion(request.admissionId);
    if (existing !== undefined) {
      if (
        existing.outcome !== outcome ||
        canonicalJson(parseJson(existing.request_json)) !==
          canonicalJson(completion)
      ) {
        throw new Error("Bot action completion outcome cannot change");
      }
      return;
    }
    if (!this.hasBotCompletionCapacity(request.admissionId)) {
      throw new Error("Bot action completion backlog is full");
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO bot_action_completions
        (admission_id, request_json, outcome, delivered_at, attempts,
         next_attempt_at, created_at)
       VALUES (?, ?, ?, NULL, 0, ?, ?)`,
      request.admissionId,
      JSON.stringify(completion),
      outcome,
      Date.now(),
      new Date().toISOString(),
    );
  }

  private async attestAndFinalizeBotReaction(
    pending: PendingBotReactionRow,
    replayed: boolean,
  ): Promise<ExecuteAdmittedBotReactionResult> {
    const request = parseExecuteAdmittedBotReactionRequest(
      pending.request_json,
    );
    const command = parseMessageReactionCommand(pending.command_json);
    const commandRecord = parseJson(
      pending.command_record_json,
    ) as MessageReactionCommandRecord | null;
    const unsignedEvent = parseUnsignedEvent(pending.unsigned_json);
    const nextReaction = parseMessageReaction(pending.next_reaction_json);
    const delta = parseJson(pending.projection_delta_json) as NonNullable<
      MessageReactionDecision["projectionDelta"]
    > | null;
    const nextConversation = parseConversation(pending.next_conversation_json);
    if (
      request === null ||
      command === null ||
      commandRecord === null ||
      unsignedEvent === null ||
      nextReaction === null ||
      delta === null ||
      nextConversation === null
    ) {
      this.markPendingBotReactionFailure(pending);
      return botDeliveryFailure("internal");
    }
    const admission = admissionFromProof(request.proof);
    if (
      admission === null ||
      !(await verifyAttestation(request.proof, this.env)) ||
      !(await proofMatchesBotReaction(request, admission))
    ) {
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_bot_reaction WHERE singleton = 1",
      );
      return botDeliveryFailure("forbidden");
    }
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent, "message-journal");
    } catch {
      this.markPendingBotReactionFailure(pending);
      return botDeliveryFailure("attestation_failed");
    }
    if (!attestedEventPreservesUnsigned(signedEvent, unsignedEvent)) {
      this.markPendingBotReactionFailure(pending);
      return botDeliveryFailure("attestation_failed");
    }
    const projection: MessageReactionProjectionEnvelope = {
      contract: "message-reaction.projection@1",
      workspaceId: request.workspaceId,
      conversationId: request.action.conversationId,
      messageId: request.action.messageId,
      cursor: nextConversation.cursor,
      event: signedEvent,
      delta,
    };
    if (
      !validateContract(
        "punks://contracts/message-reaction.projection@1",
        projection,
      ).valid
    ) {
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_bot_reaction WHERE singleton = 1",
      );
      return botDeliveryFailure("forbidden");
    }
    const projectionJson = JSON.stringify(projection);
    const commandRecordJson = JSON.stringify(commandRecord);
    const resultBytes = messageReactionResultByteLength({
      commandId: pending.command_id,
      semanticHash: pending.semantic_hash,
      reactionId: pending.reaction_id,
      commandRecordJson,
      botAdmissionId: request.admissionId,
      botActionDigest: request.actionDigest,
      botOutcome: "succeeded",
    });
    const safetyReduction = commandRecord.effect === "removed";

    let committed = false;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pendingBotReaction();
        if (!samePendingBotReaction(currentPending, pending)) {
          const result = this.messageReactionResult(pending.command_id);
          committed =
            result !== undefined &&
            result.semantic_hash === pending.semantic_hash &&
            result.reaction_id === pending.reaction_id &&
            this.hasExactBotCompletion(request, "succeeded");
          return;
        }
        const conversation = this.state();
        const target = this.message(request.action.messageId);
        const current = this.messageReaction(pending.reaction_id);
        if (
          conversation === null ||
          target === null ||
          conversation.cursor + 1 !== nextConversation.cursor ||
          conversation.status !== "active" ||
          target.status !== "active" ||
          target.workspaceId !== request.workspaceId ||
          target.conversationId !== request.action.conversationId ||
          (nextReaction.revision > 1 &&
            (current === null ||
              current.revision + 1 !== nextReaction.revision)) ||
          (nextReaction.revision === 1 && current !== null)
        ) {
          throw new Error("Bot Reaction state changed before commit");
        }
        if (
          !this.hasMessageReactionCommitCapacity(
            current,
            nextReaction,
            projectionJson,
            resultBytes,
            safetyReduction,
          )
        ) {
          throw new Error("Bot Reaction storage capacity changed");
        }
        this.writeMessageReaction(nextReaction, commandRecord.effect);
        const committedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextConversation),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          nextConversation.cursor,
          signedEvent.id,
          signedEvent.kind,
          JSON.stringify(signedEvent),
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO message_reaction_command_results
            (command_id, semantic_hash, reaction_id, command_record_json,
             committed_cursor, bot_admission_id, bot_action_digest,
             bot_outcome, committed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'succeeded', ?)`,
          pending.command_id,
          pending.semantic_hash,
          pending.reaction_id,
          commandRecordJson,
          nextConversation.cursor,
          request.admissionId,
          request.actionDigest,
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          signedEvent.id,
          nextConversation.cursor,
          projectionJson,
        );
        this.recordBotCompletion(request, "succeeded");
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_bot_reaction WHERE singleton = 1",
        );
        committed = true;
      });
    } catch {
      this.markPendingBotReactionFailure(pending);
      return botDeliveryFailure("temporarily_unavailable");
    }
    if (!committed) {
      return botDeliveryFailure("internal");
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    this.scheduleTtlAlarm(nextConversation);
    this.wakeFollowers();
    return botDeliverySuccess(replayed);
  }

  private markPendingBotReactionFailure(pending: PendingBotReactionRow): void {
    const current = this.pendingBotReaction();
    if (!samePendingBotReaction(current, pending)) {
      return;
    }
    if (current === undefined) {
      return;
    }
    const attempts = nextRetryAttempt(current.attempts);
    this.ctx.storage.sql.exec(
      "UPDATE pending_bot_reaction SET attempts = ? WHERE singleton = 1",
      attempts,
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private async reconcileBotActionCompletions(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<BotActionCompletionRow>(
        `SELECT admission_id, request_json, outcome, delivered_at, attempts,
                next_attempt_at
         FROM bot_action_completions
         WHERE delivered_at IS NULL AND next_attempt_at <= ?
         ORDER BY next_attempt_at, admission_id LIMIT 20`,
        Date.now(),
      )
      .toArray();
    for (const row of rows) {
      const request = parseCompleteBotActionRequest(row.request_json);
      if (request === null || request.outcome !== row.outcome) {
        this.deferBotActionCompletion(row);
        continue;
      }
      try {
        const result: unknown = await this.env.BOT_INSTALLATIONS.getByName(
          request.installationId,
        ).completeBotAction(request);
        if (!isExactBotActionCompletionResult(result) || result.ok !== true) {
          throw new Error("Installation completion remains retryable");
        }
        this.ctx.storage.sql.exec(
          "DELETE FROM bot_action_completions WHERE admission_id = ?",
          row.admission_id,
        );
      } catch {
        this.deferBotActionCompletion(row);
      }
    }
    if (rows.length === 20) {
      this.scheduleAlarm(0);
    }
    this.scheduleNextBotActionCompletion();
  }

  private deferBotActionCompletion(row: BotActionCompletionRow): void {
    const attempts = nextRetryAttempt(row.attempts);
    const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
    this.ctx.storage.sql.exec(
      `UPDATE bot_action_completions SET attempts = ?, next_attempt_at = ?
       WHERE admission_id = ? AND delivered_at IS NULL`,
      attempts,
      Date.now() + delay,
      row.admission_id,
    );
  }

  private scheduleNextBotActionCompletion(): void {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at
         FROM bot_action_completions WHERE delivered_at IS NULL`,
      )
      .one().next_attempt_at;
    if (next !== null) {
      this.scheduleAlarm(Math.max(1, next - Date.now()));
    }
  }

  private hasPendingAggregateMutation(): boolean {
    return (
      this.pending() !== undefined ||
      this.pendingMessage() !== undefined ||
      this.pendingMessageReaction() !== undefined ||
      this.pendingBotReaction() !== undefined
    );
  }

  private messageResult(commandId: string): MessageResultRow | undefined {
    return this.ctx.storage.sql
      .exec<MessageResultRow>(
        `SELECT payload_hash, request_fingerprint, response_json
         FROM message_command_results
         WHERE command_id = ?`,
        commandId,
      )
      .toArray()[0];
  }

  private messageResultStorageUsage(): { rows: number; bytes: number } {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(command_id AS BLOB)) +
                  length(CAST(payload_hash AS BLOB)) +
                  length(CAST(request_fingerprint AS BLOB)) +
                  length(CAST(response_json AS BLOB)) +
                  length(CAST(committed_at AS BLOB))
                ), 0) AS bytes
         FROM message_command_results`,
      )
      .one();
    return { rows: Number(usage.rows), bytes: Number(usage.bytes) };
  }

  private hasMessageResultCapacity(resultBytes: number): boolean {
    if (
      !Number.isSafeInteger(resultBytes) ||
      resultBytes < 1 ||
      resultBytes > MAXIMUM_MESSAGE_RESULT_ROW_BYTES
    ) {
      return false;
    }
    const usage = this.messageResultStorageUsage();
    return this.hasResultCommitCapacity({
      usage,
      resultBytes,
      liabilities: this.terminalLiabilities().messageResults,
      liabilityDelta: 0,
      normalRows: MAXIMUM_NORMAL_MESSAGE_RESULT_ROWS,
      normalBytes: MAXIMUM_NORMAL_MESSAGE_RESULT_BYTES,
      hardRows: MAXIMUM_MESSAGE_RESULT_ROWS,
      hardBytes: MAXIMUM_MESSAGE_RESULT_BYTES,
      maximumRowBytes: MAXIMUM_MESSAGE_RESULT_ROW_BYTES,
      safetyReduction: false,
    });
  }

  private hasMessageCommitCapacity(
    current: Message | null,
    next: ReturnType<typeof boundedMessageState>,
    projectionJson: string,
    resultBytes: number,
    safetyReduction: boolean,
  ): boolean {
    const liabilityDelta =
      messageTerminalLiability(next) - messageTerminalLiability(current);
    if (
      !this.hasOutboxCommitCapacity(
        projectionJson,
        liabilityDelta,
        safetyReduction,
      )
    ) {
      return false;
    }
    return this.hasResultCommitCapacity({
      usage: this.messageResultStorageUsage(),
      resultBytes,
      liabilities: this.terminalLiabilities().messageResults,
      liabilityDelta,
      normalRows: MAXIMUM_NORMAL_MESSAGE_RESULT_ROWS,
      normalBytes: MAXIMUM_NORMAL_MESSAGE_RESULT_BYTES,
      hardRows: MAXIMUM_MESSAGE_RESULT_ROWS,
      hardBytes: MAXIMUM_MESSAGE_RESULT_BYTES,
      maximumRowBytes: MAXIMUM_MESSAGE_RESULT_ROW_BYTES,
      safetyReduction,
    });
  }

  private conversationResultStorageUsage(): { rows: number; bytes: number } {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(command_id AS BLOB)) +
                  length(CAST(payload_hash AS BLOB)) +
                  length(CAST(response_json AS BLOB)) +
                  length(CAST(committed_at AS BLOB))
                ), 0) AS bytes
         FROM command_results`,
      )
      .one();
    return { rows: Number(usage.rows), bytes: Number(usage.bytes) };
  }

  private hasConversationCommitCapacity(
    current: Conversation | null,
    next: Conversation,
    projectionJson: string,
    resultBytes: number,
    safetyReduction: boolean,
  ): boolean {
    const liabilityDelta =
      conversationTerminalLiability(next) -
      conversationTerminalLiability(current);
    if (
      !this.hasOutboxCommitCapacity(
        projectionJson,
        liabilityDelta,
        safetyReduction,
      )
    ) {
      return false;
    }
    return this.hasResultCommitCapacity({
      usage: this.conversationResultStorageUsage(),
      resultBytes,
      liabilities: this.terminalLiabilities().conversationResults,
      liabilityDelta,
      normalRows: MAXIMUM_NORMAL_CONVERSATION_RESULT_ROWS,
      normalBytes: MAXIMUM_NORMAL_CONVERSATION_RESULT_BYTES,
      hardRows: MAXIMUM_CONVERSATION_RESULT_ROWS,
      hardBytes: MAXIMUM_CONVERSATION_RESULT_BYTES,
      maximumRowBytes: MAXIMUM_CONVERSATION_RESULT_ROW_BYTES,
      safetyReduction,
    });
  }

  private message(messageId: string): Message | null {
    const row = this.ctx.storage.sql
      .exec<MessageRow>(
        `SELECT message_id, workspace_id, conversation_id, author_json,
                message_type, status, topic_present, mentioned_punk_ids_json,
                media_ids_json, parent_message_id, thread_root_message_id,
                thread_depth, broadcast, reply_count, descendant_count,
                last_reply_at, original_content_commitment, current_version,
                retraction_json, erasure_marker_json, revision, created_cursor,
                cursor,
                created_at, updated_at, edited_at
         FROM messages WHERE message_id = ?`,
        messageId,
      )
      .toArray()[0];
    if (row === undefined) {
      return null;
    }
    const contentVersions = this.ctx.storage.sql
      .exec<{
        version: number;
        content_commitment: string;
        ciphertext_ref: string;
        content_key_id: string;
        topic_present: number;
        created_at: string;
      }>(
        `SELECT version, content_commitment, ciphertext_ref, content_key_id,
                topic_present, created_at
         FROM message_versions WHERE message_id = ? ORDER BY version`,
        messageId,
      )
      .toArray()
      .map(
        (version): MessageContentVersion => ({
          version: version.version,
          contentCommitment: version.content_commitment,
          ciphertextRef: version.ciphertext_ref,
          contentKeyId: version.content_key_id,
          topicPresent: version.topic_present === 1,
          createdAt: version.created_at,
        }),
      );
    return {
      id: row.message_id,
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      author: JSON.parse(row.author_json) as Message["author"],
      messageType: row.message_type,
      status: row.status,
      topicPresent: row.topic_present === 1,
      mentionedPunkIds: JSON.parse(row.mentioned_punk_ids_json) as string[],
      mediaIds: JSON.parse(row.media_ids_json) as string[],
      parentMessageId: row.parent_message_id,
      threadRootMessageId: row.thread_root_message_id,
      threadDepth: row.thread_depth,
      broadcast: row.broadcast === 1,
      replyCount: row.reply_count,
      descendantCount: row.descendant_count,
      lastReplyAt: row.last_reply_at,
      originalContentCommitment:
        row.status === "erased" ? null : row.original_content_commitment,
      currentVersion: row.current_version,
      contentVersions,
      retraction:
        row.retraction_json === null
          ? null
          : (JSON.parse(row.retraction_json) as Message["retraction"]),
      erasureMarker:
        row.erasure_marker_json === null
          ? null
          : (JSON.parse(row.erasure_marker_json) as Message["erasureMarker"]),
      revision: row.revision,
      createdCursor: row.created_cursor,
      cursor: row.cursor,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      editedAt: row.edited_at,
    };
  }

  private async authorizeHistoryReader(
    query: MessageHistoryQuery,
    punkId: string,
    conversation: Conversation,
  ): Promise<{ ok: true } | { ok: false; code: "not_found" | "forbidden" }> {
    if (!canReadConversation(conversation, punkId)) {
      return { ok: false, code: "forbidden" };
    }
    const authorization = await this.env.WORKSPACES.getByName(
      query.workspaceId,
    ).authorize({
      workspaceId: query.workspaceId,
      punkId,
      permission: "workspace.read",
    });
    if (!authorization.ok) {
      return {
        ok: false,
        code: authorization.code === "forbidden" ? "forbidden" : "not_found",
      };
    }
    return { ok: true };
  }

  private async authorizeSearchReader(
    query: MessageSearchQuery,
    punkId: string,
  ): Promise<
    { ok: true } | { ok: false; code: "not_found" | "forbidden" | "internal" }
  > {
    const initial = this.effectiveState();
    if (
      initial === null ||
      initial.id !== query.conversationId ||
      initial.workspaceId !== query.workspaceId ||
      initial.status !== "active"
    ) {
      return { ok: false, code: "not_found" };
    }
    if (query.threadRootMessageId !== null) {
      const root = this.message(query.threadRootMessageId);
      if (
        root === null ||
        root.workspaceId !== query.workspaceId ||
        root.conversationId !== query.conversationId ||
        root.threadRootMessageId !== query.threadRootMessageId
      ) {
        return { ok: false, code: "not_found" };
      }
    }
    if (!canReadConversation(initial, punkId)) {
      return { ok: false, code: "forbidden" };
    }
    let rawAuthorization: unknown;
    try {
      rawAuthorization = await this.env.WORKSPACES.getByName(
        query.workspaceId,
      ).authorize({
        workspaceId: query.workspaceId,
        punkId,
        permission: "workspace.read",
      });
    } catch {
      return { ok: false, code: "internal" };
    }
    const authorization =
      validateSearchWorkspaceAuthorization(rawAuthorization);
    if (authorization === null) {
      return { ok: false, code: "internal" };
    }
    if (authorization.ok !== true) {
      return {
        ok: false,
        code: authorization.code === "forbidden" ? "forbidden" : "not_found",
      };
    }
    const current = this.effectiveState();
    if (
      current === null ||
      current.id !== query.conversationId ||
      current.workspaceId !== query.workspaceId ||
      current.status !== "active"
    ) {
      return { ok: false, code: "not_found" };
    }
    return canReadConversation(current, punkId)
      ? { ok: true }
      : { ok: false, code: "forbidden" };
  }

  private async prepareSearchCandidate(
    candidate: MessageSearchCandidate,
    query: MessageSearchQuery,
    punkId: string,
  ): Promise<SearchCandidatePreparation> {
    const initialAuthorization = await this.authorizeSearchReader(
      query,
      punkId,
    );
    if (!initialAuthorization.ok) {
      return initialAuthorization;
    }
    const initial = this.message(candidate.messageId);
    if (
      initial === null ||
      initial.workspaceId !== query.workspaceId ||
      initial.conversationId !== query.conversationId ||
      (query.threadRootMessageId !== null &&
        initial.threadRootMessageId !== query.threadRootMessageId) ||
      initial.createdCursor !== candidate.createdCursor
    ) {
      return { ok: false, code: "internal" };
    }
    if (initial.status !== "active") {
      return { ok: true, item: null };
    }
    const version = initial.contentVersions.find(
      (entry) => entry.version === initial.currentVersion,
    );
    if (version === undefined) {
      return { ok: false, code: "internal" };
    }
    let payload: PreparedSearchItem["payload"];
    try {
      const rawRead: unknown = await this.env.MESSAGE_CONTENT.getByName(
        initial.id,
      ).readAuthorized({
        workspaceId: initial.workspaceId,
        conversationId: initial.conversationId,
        messageId: initial.id,
        generationId: initial.id,
        contentKeyId: version.contentKeyId,
        purpose: "search",
      });
      const read = validateSearchContentReadResult(rawRead);
      if (
        read === null ||
        read.ok !== true ||
        read.version !== version.version ||
        read.contentCommitment !== version.contentCommitment ||
        !isMessageSearchPayload(read.payload)
      ) {
        return { ok: false, code: "content_unavailable" };
      }
      payload = read.payload;
    } catch {
      return { ok: false, code: "content_unavailable" };
    }
    const finalAuthorization = await this.authorizeSearchReader(query, punkId);
    if (!finalAuthorization.ok) {
      return finalAuthorization;
    }
    const current = this.message(candidate.messageId);
    if (
      current === null ||
      current.workspaceId !== query.workspaceId ||
      current.conversationId !== query.conversationId ||
      (query.threadRootMessageId !== null &&
        current.threadRootMessageId !== query.threadRootMessageId) ||
      current.createdCursor !== candidate.createdCursor
    ) {
      return { ok: false, code: "internal" };
    }
    if (current.status !== "active") {
      return { ok: true, item: null };
    }
    const currentVersion = current.contentVersions.find(
      (entry) => entry.version === current.currentVersion,
    );
    if (
      currentVersion === undefined ||
      currentVersion.version !== version.version ||
      currentVersion.contentKeyId !== version.contentKeyId ||
      currentVersion.contentCommitment !== version.contentCommitment ||
      !messageSearchPlaintextMatchesQuery(payload, query.query)
    ) {
      return { ok: true, item: null };
    }
    const view = authorizedMessageView(boundedMessageState(current), payload);
    if (
      !validateContract("punks://contracts/message.view@1", view).valid ||
      view.status !== "active"
    ) {
      return { ok: false, code: "internal" };
    }
    return {
      ok: true,
      item: {
        candidate,
        version,
        payload,
        view: view as MessageSearchResponse["items"][number],
      },
    };
  }

  private messageSearchExpectedCursor(
    query: MessageSearchQuery,
  ): number | null {
    const clauses = ["workspace_id = ?", "conversation_id = ?"];
    const bindings: string[] = [query.workspaceId, query.conversationId];
    if (query.threadRootMessageId !== null) {
      clauses.push("thread_root_message_id = ?");
      bindings.push(query.threadRootMessageId);
    }
    const row = this.ctx.storage.sql
      .exec<{ expected_cursor: number }>(
        `SELECT COALESCE(MAX(cursor), 0) AS expected_cursor
         FROM messages
         WHERE ${clauses.join(" AND ")}`,
        ...bindings,
      )
      .toArray()[0];
    return row !== undefined &&
      Number.isSafeInteger(row.expected_cursor) &&
      row.expected_cursor >= 0
      ? row.expected_cursor
      : null;
  }

  private historyMessageIds(
    query: MessageHistoryQuery,
    highWaterCursor: number,
    positionCursor: number | null,
    direction: "older" | "newer",
    limit: number,
  ): string[] {
    const clauses = [
      "workspace_id = ?",
      "conversation_id = ?",
      "created_cursor <= ?",
    ];
    const bindings: (number | string)[] = [
      query.workspaceId,
      query.conversationId,
      highWaterCursor,
    ];
    if (query.threadRootMessageId !== undefined) {
      clauses.push("thread_root_message_id = ?");
      bindings.push(query.threadRootMessageId);
    }
    if (positionCursor !== null) {
      clauses.push(
        direction === "older" ? "created_cursor < ?" : "created_cursor > ?",
      );
      bindings.push(positionCursor);
    }
    bindings.push(limit);
    return this.ctx.storage.sql
      .exec<Record<"message_id", string>>(
        `SELECT message_id FROM messages
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_cursor ${direction === "older" ? "DESC" : "ASC"},
                  message_id ASC
         LIMIT ?`,
        ...bindings,
      )
      .toArray()
      .map((row) => row.message_id);
  }

  private async authorizeMessageActor(command: PostMessageCommand): Promise<
    | {
        ok: true;
        workspaceCursor: number;
        role: Exclude<WorkspaceAuthorizationResult, { ok: false }>["role"];
      }
    | { ok: false; code: "not_found" | "forbidden" }
  > {
    if (command.actor.kind !== "punk") {
      return { ok: false, code: "forbidden" };
    }
    const punkId = command.actor.punkId;
    const authorization = await this.env.WORKSPACES.getByName(
      command.workspaceId,
    ).authorize({
      workspaceId: command.workspaceId,
      punkId,
      permission: "conversations.write",
    });
    if (!authorization.ok) {
      return {
        ok: false,
        code: authorization.code === "forbidden" ? "forbidden" : "not_found",
      };
    }
    return authorization;
  }

  private async authorizeMessageMutationActor(
    current: Message,
    command: EditMessageCommand | RetractMessageCommand | RestoreMessageCommand,
    conversation: Conversation,
    now: Date,
    cursor: number,
  ): Promise<
    | { ok: true; context: MessageDecisionContext }
    | { ok: false; code: "not_found" | "forbidden" | "invalid_transition" }
  > {
    if (command.actor.kind !== "punk") {
      return { ok: false, code: "forbidden" };
    }
    const punkId = command.actor.punkId;
    const authorization = await this.env.WORKSPACES.getByName(
      command.workspaceId,
    ).authorize({
      workspaceId: command.workspaceId,
      punkId,
      permission: "workspace.read",
    });
    if (!authorization.ok) {
      return {
        ok: false,
        code: authorization.code === "forbidden" ? "forbidden" : "not_found",
      };
    }
    const context: MessageDecisionContext = {
      messageId: current.id,
      cursor,
      now,
      workspaceCursor: authorization.workspaceCursor,
      conversationCursor: cursor,
      conversation: {
        type: conversation.type,
        visibility: conversation.visibility,
        status: conversation.status,
        topicRequired: conversation.topicRequired,
      },
      authorization: {
        workspaceRole: authorization.role,
        conversationAccess:
          conversation.members.find((member) => member.punkId === punkId)
            ?.access ?? null,
        botCapabilities: new Set(),
      },
    };
    try {
      authorizeMessageMutation(current, command, context);
      return { ok: true, context };
    } catch (error) {
      if (error instanceof MessageDomainError) {
        return {
          ok: false,
          code:
            error.code === "not_found"
              ? "not_found"
              : error.code === "forbidden"
                ? "forbidden"
                : "invalid_transition",
        };
      }
      return { ok: false, code: "invalid_transition" };
    }
  }

  private async stageMessageContent(
    messageId: string,
    command: PostMessageCommand,
  ): Promise<
    | { ok: true; prepared: PreparedMessageContent }
    | {
        ok: false;
        code:
          | "invalid_contract"
          | "idempotency_conflict"
          | "content_unavailable";
      }
  > {
    const result = await this.env.MESSAGE_CONTENT.getByName(messageId).stage({
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId,
      generationId: messageId,
      operationId: command.commandId,
      version: 1,
      payload: {
        schemaVersion: 1,
        content: command.payload.content,
        topic: command.payload.topic,
      },
    });
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.code === "invalid_request"
            ? "invalid_contract"
            : result.code === "idempotency_conflict" ||
                result.code === "version_conflict"
              ? "idempotency_conflict"
              : "content_unavailable",
      };
    }
    return { ok: true, prepared: result.prepared };
  }

  private async stageEditedMessageContent(
    messageId: string,
    command: EditMessageCommand,
    version: number,
  ): Promise<
    | { ok: true; prepared: PreparedMessageContent }
    | {
        ok: false;
        code:
          | "invalid_contract"
          | "idempotency_conflict"
          | "content_unavailable";
      }
  > {
    const result = await this.env.MESSAGE_CONTENT.getByName(messageId).stage({
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId,
      generationId: messageId,
      operationId: command.commandId,
      version,
      payload: {
        schemaVersion: 1,
        content: command.payload.content,
        topic: command.payload.topic,
      },
    });
    if (!result.ok) {
      return {
        ok: false,
        code:
          result.code === "invalid_request"
            ? "invalid_contract"
            : result.code === "idempotency_conflict" ||
                result.code === "version_conflict"
              ? "idempotency_conflict"
              : "content_unavailable",
      };
    }
    return { ok: true, prepared: result.prepared };
  }

  private prepareThreadDeltas(
    deltas: readonly ThreadCounterDelta[],
    now: Date,
    cursor: number,
  ): CommittedThreadDelta[] {
    const combined = new Map<
      string,
      { replyCountDelta: number; descendantCountDelta: number }
    >();
    for (const delta of deltas) {
      const entry = combined.get(delta.messageId) ?? {
        replyCountDelta: 0,
        descendantCountDelta: 0,
      };
      if ("replyCountDelta" in delta) {
        entry.replyCountDelta += delta.replyCountDelta;
      } else {
        entry.descendantCountDelta += delta.descendantCountDelta;
      }
      combined.set(delta.messageId, entry);
    }
    return [...combined.entries()].map(([messageId, delta]) => {
      const target = this.message(messageId);
      if (target === null) {
        throw new MessageDomainError(
          "invalid_transition",
          "Thread counter target is missing",
        );
      }
      return {
        messageId,
        replyCountDelta: delta.replyCountDelta as -1 | 0 | 1,
        descendantCountDelta: delta.descendantCountDelta as -1 | 0 | 1,
        lastReplyAt: now.toISOString(),
        revision: target.revision + 1,
        cursor,
        updatedAt: now.toISOString(),
      };
    });
  }

  private prepareThreadDeltasForStatus(
    deltas: readonly ThreadCounterDelta[],
    transitioningMessage: Message,
    nextStatus: Message["status"],
    now: Date,
    cursor: number,
  ): CommittedThreadDelta[] {
    const combined = new Map<
      string,
      { replyCountDelta: number; descendantCountDelta: number }
    >();
    for (const delta of deltas) {
      const entry = combined.get(delta.messageId) ?? {
        replyCountDelta: 0,
        descendantCountDelta: 0,
      };
      if ("replyCountDelta" in delta) {
        entry.replyCountDelta += delta.replyCountDelta;
      } else {
        entry.descendantCountDelta += delta.descendantCountDelta;
      }
      combined.set(delta.messageId, entry);
    }
    return [...combined.entries()].map(([messageId, delta]) => {
      const target = this.message(messageId);
      if (target === null) {
        throw new MessageDomainError(
          "invalid_transition",
          "Thread counter target is missing",
        );
      }
      const rootTarget =
        target.parentMessageId === null &&
        target.threadRootMessageId === target.id;
      const row = this.ctx.storage.sql
        .exec<{ last_reply_at: string | null }>(
          rootTarget
            ? `SELECT MAX(created_at) AS last_reply_at FROM messages
               WHERE workspace_id = ? AND conversation_id = ?
                 AND thread_root_message_id = ? AND message_id <> ?
                 AND message_id <> ? AND status = 'active'`
            : `SELECT MAX(created_at) AS last_reply_at FROM messages
               WHERE workspace_id = ? AND conversation_id = ?
                 AND parent_message_id = ? AND message_id <> ?
                 AND message_id <> ? AND status = 'active'`,
          target.workspaceId,
          target.conversationId,
          target.id,
          target.id,
          transitioningMessage.id,
        )
        .toArray()[0];
      const transitioningQualifies = rootTarget
        ? transitioningMessage.id !== target.id &&
          transitioningMessage.threadRootMessageId === target.id
        : transitioningMessage.parentMessageId === target.id;
      const restoredCreatedAt =
        nextStatus === "active" && transitioningQualifies
          ? transitioningMessage.createdAt
          : null;
      const lastReplyAt =
        [row?.last_reply_at ?? null, restoredCreatedAt]
          .filter((value): value is string => value !== null)
          .sort()
          .at(-1) ?? null;
      return {
        messageId,
        replyCountDelta: delta.replyCountDelta as -1 | 0 | 1,
        descendantCountDelta: delta.descendantCountDelta as -1 | 0 | 1,
        lastReplyAt,
        revision: target.revision + 1,
        cursor,
        updatedAt: now.toISOString(),
      };
    });
  }

  private async recoverCommittedMessage(
    messageId: string,
    command: PostMessageCommand,
    prepared: PreparedMessageContent,
    committed: CommittedMessagePost,
  ): Promise<MessagePostResult> {
    if (prepared.contentKeyId !== committed.version.contentKeyId) {
      return { ok: false, code: "idempotency_conflict" };
    }
    const pendingFinalization = this.contentFinalization(committed.event.id);
    if (pendingFinalization !== undefined) {
      if (!(await this.reconcileContentFinalization(pendingFinalization))) {
        return { ok: false, code: "content_finalize_failed" };
      }
      this.ctx.waitUntil(this.flushOutbox());
      return { ok: true, value: committed, replayed: true };
    }
    const finalized = await this.env.MESSAGE_CONTENT.getByName(
      messageId,
    ).finalize({
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId,
      generationId: messageId,
      operationId: command.commandId,
      contentKeyId: committed.version.contentKeyId,
    });
    if (!finalized.ok) {
      return { ok: false, code: "content_finalize_failed" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    return { ok: true, value: committed, replayed: true };
  }

  private async recoverCommittedMessageMutation(
    messageId: string,
    command: EditMessageCommand,
    prepared: PreparedMessageContent,
    committed: CommittedMessageMutation,
  ): Promise<MessageMutationResult> {
    const version = committed.version;
    const event = committed.event;
    if (version === null || event === null) {
      return { ok: false, code: "internal" };
    }
    if (prepared.contentKeyId !== version.contentKeyId) {
      return { ok: false, code: "idempotency_conflict" };
    }
    const pendingFinalization = this.contentFinalization(event.id);
    if (pendingFinalization !== undefined) {
      if (!(await this.reconcileContentFinalization(pendingFinalization))) {
        return { ok: false, code: "content_finalize_failed" };
      }
      this.ctx.waitUntil(this.flushOutbox());
      return { ok: true, value: committed, replayed: true };
    }
    try {
      const finalized = await this.env.MESSAGE_CONTENT.getByName(
        messageId,
      ).finalize({
        workspaceId: command.workspaceId,
        conversationId: command.conversationId,
        messageId,
        generationId: messageId,
        operationId: command.commandId,
        contentKeyId: version.contentKeyId,
      });
      if (!finalized.ok) {
        return { ok: false, code: "content_finalize_failed" };
      }
    } catch {
      return { ok: false, code: "content_finalize_failed" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    return { ok: true, value: committed, replayed: true };
  }

  private async authorizeActor(
    command: ConversationCommand,
  ): Promise<WorkspaceAuthorizationResult> {
    const permission: WorkspacePermission =
      command.contract === "conversation.create@1" ||
      command.contract === "conversation.join@1"
        ? "conversations.write"
        : "workspace.read";
    return this.env.WORKSPACES.getByName(command.workspaceId).authorize({
      workspaceId: command.workspaceId,
      punkId: command.actor.punkId,
      permission,
    });
  }

  private async targetsBelongToWorkspace(
    command: ConversationCommand,
  ): Promise<boolean> {
    const targets =
      command.contract === "conversation.create@1"
        ? (command.payload.participantPunkIds ?? [])
        : command.contract === "conversation.member-set-access@1"
          ? [command.payload.targetPunkId]
          : [];
    for (const punkId of new Set(targets)) {
      const result = await this.env.WORKSPACES.getByName(
        command.workspaceId,
      ).authorize({
        workspaceId: command.workspaceId,
        punkId,
        permission: "workspace.read",
      });
      if (!result.ok) {
        return false;
      }
    }
    return true;
  }

  private async authorizeMessageReaction(
    command:
      | AddMessageReactionCommand
      | RemoveMessageReactionCommand
      | ToggleMessageReactionCommand,
  ): Promise<
    | {
        ok: true;
        workspaceCursor: number;
        role: Exclude<WorkspaceAuthorizationResult, { ok: false }>["role"];
      }
    | { ok: false; code: "not_found" | "forbidden" }
  > {
    if (command.actor.kind !== "punk") {
      return { ok: false, code: "forbidden" };
    }
    let rawAuthorization: unknown;
    try {
      rawAuthorization = await this.env.WORKSPACES.getByName(
        command.workspaceId,
      ).authorize({
        workspaceId: command.workspaceId,
        punkId: command.actor.punkId,
        permission: "conversations.write",
      });
    } catch {
      return { ok: false, code: "forbidden" };
    }
    const authorization =
      validateSearchWorkspaceAuthorization(rawAuthorization);
    if (authorization === null || authorization.ok !== true) {
      return {
        ok: false,
        code:
          authorization?.ok === false && authorization.code === "not_found"
            ? "not_found"
            : "forbidden",
      };
    }
    const conversation = this.effectiveState();
    const target = this.message(command.messageId);
    if (
      conversation === null ||
      target === null ||
      conversation.id !== command.conversationId ||
      conversation.workspaceId !== command.workspaceId ||
      target.workspaceId !== command.workspaceId ||
      target.conversationId !== command.conversationId
    ) {
      return { ok: false, code: "not_found" };
    }
    if (!canWriteConversation(conversation, command.actor.punkId)) {
      return { ok: false, code: "forbidden" };
    }
    return {
      ok: true,
      workspaceCursor: authorization.workspaceCursor,
      role: authorization.role,
    };
  }

  private messageReactionReplay(
    completed: MessageReactionResultRow,
  ): MessageReactionMutationResult {
    let record: MessageReactionCommandRecord;
    try {
      record = JSON.parse(
        completed.command_record_json,
      ) as MessageReactionCommandRecord;
    } catch {
      return { ok: false, code: "internal" };
    }
    const response = messageReactionResponse(
      this.visibleMessageReaction(this.messageReaction(completed.reaction_id)),
      record.effect,
      true,
    );
    if (
      !validateContract(
        "punks://contracts/message.reaction-mutation-response@1",
        response,
      ).valid
    ) {
      return { ok: false, code: "internal" };
    }
    return { ok: true, response };
  }

  private async attestAndFinalizeMessageReaction(
    pending: PendingMessageReactionRow,
    replayed: boolean,
  ): Promise<MessageReactionMutationResult> {
    let command:
      | AddMessageReactionCommand
      | RemoveMessageReactionCommand
      | ToggleMessageReactionCommand;
    let nextReaction: MessageReaction;
    let nextConversation: Conversation;
    let commandRecord: MessageReactionCommandRecord;
    let delta: NonNullable<MessageReactionDecision["projectionDelta"]>;
    let unsignedEvent: UnsignedNostrEvent;
    try {
      command = JSON.parse(pending.command_json) as typeof command;
      nextReaction = JSON.parse(pending.next_reaction_json) as MessageReaction;
      nextConversation = JSON.parse(
        pending.next_conversation_json,
      ) as Conversation;
      commandRecord = JSON.parse(
        pending.command_record_json,
      ) as MessageReactionCommandRecord;
      delta = JSON.parse(pending.projection_delta_json) as typeof delta;
      unsignedEvent = JSON.parse(pending.unsigned_json) as UnsignedNostrEvent;
    } catch {
      this.markPendingMessageReactionFailure(pending);
      return { ok: false, code: "internal" };
    }
    if (!(await this.authorizeMessageReaction(command)).ok) {
      this.abandonPendingMessageReaction(pending);
      return { ok: false, code: "forbidden" };
    }

    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent, "message-journal");
    } catch {
      this.markPendingMessageReactionFailure(pending);
      return { ok: false, code: "attestation_failed" };
    }
    if (!attestedEventPreservesUnsigned(signedEvent, unsignedEvent)) {
      this.markPendingMessageReactionFailure(pending);
      return { ok: false, code: "attestation_failed" };
    }
    const projection: MessageReactionProjectionEnvelope = {
      contract: "message-reaction.projection@1",
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      cursor: nextConversation.cursor,
      event: signedEvent,
      delta,
    };
    if (
      !validateContract(
        "punks://contracts/message-reaction.projection@1",
        projection,
      ).valid
    ) {
      this.markPendingMessageReactionFailure(pending);
      return { ok: false, code: "internal" };
    }
    if (!(await this.authorizeMessageReaction(command)).ok) {
      this.abandonPendingMessageReaction(pending);
      return { ok: false, code: "forbidden" };
    }
    const projectionJson = JSON.stringify(projection);
    const commandRecordJson = JSON.stringify(commandRecord);
    const resultBytes = messageReactionResultByteLength({
      commandId: pending.command_id,
      semanticHash: pending.semantic_hash,
      reactionId: pending.reaction_id,
      commandRecordJson,
    });
    const safetyReduction = commandRecord.effect === "removed";

    let committed = false;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pendingMessageReaction();
        if (
          currentPending === undefined ||
          currentPending.command_id !== pending.command_id ||
          currentPending.semantic_hash !== pending.semantic_hash ||
          currentPending.reaction_id !== pending.reaction_id
        ) {
          const existing = this.messageReactionResult(pending.command_id);
          committed =
            existing !== undefined &&
            existing.semantic_hash === pending.semantic_hash &&
            existing.reaction_id === pending.reaction_id;
          return;
        }
        const conversation = this.state();
        const target = this.message(command.messageId);
        const current = this.messageReaction(pending.reaction_id);
        if (
          conversation === null ||
          target === null ||
          conversation.id !== nextConversation.id ||
          conversation.workspaceId !== nextConversation.workspaceId ||
          conversation.cursor + 1 !== nextConversation.cursor ||
          conversation.status !== "active" ||
          target.status !== "active" ||
          target.workspaceId !== command.workspaceId ||
          target.conversationId !== command.conversationId ||
          (nextReaction.revision > 1 &&
            (current === null ||
              current.revision + 1 !== nextReaction.revision)) ||
          (nextReaction.revision === 1 && current !== null)
        ) {
          throw new Error("Reaction state changed before commit");
        }
        if (
          !this.hasMessageReactionCommitCapacity(
            current,
            nextReaction,
            projectionJson,
            resultBytes,
            safetyReduction,
          )
        ) {
          throw new Error("Reaction storage capacity changed");
        }
        this.writeMessageReaction(nextReaction, commandRecord.effect);
        const committedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextConversation),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          nextConversation.cursor,
          signedEvent.id,
          signedEvent.kind,
          JSON.stringify(signedEvent),
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO message_reaction_command_results
            (command_id, semantic_hash, reaction_id, command_record_json,
             committed_cursor, committed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          pending.command_id,
          pending.semantic_hash,
          pending.reaction_id,
          commandRecordJson,
          nextConversation.cursor,
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          signedEvent.id,
          nextConversation.cursor,
          projectionJson,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_message_reaction_command WHERE singleton = 1",
        );
        committed = true;
      });
    } catch {
      this.markPendingMessageReactionFailure(pending);
      return { ok: false, code: "internal" };
    }
    if (!committed) {
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    this.scheduleTtlAlarm(nextConversation);
    this.wakeFollowers();
    const result = this.messageReactionResult(pending.command_id);
    return result === undefined
      ? { ok: false, code: "internal" }
      : this.messageReactionReplayWithFlag(result, replayed);
  }

  private messageReactionReplayWithFlag(
    completed: MessageReactionResultRow,
    replayed: boolean,
  ): MessageReactionMutationResult {
    const result = this.messageReactionReplay(completed);
    if (!result.ok || replayed) {
      return result;
    }
    return {
      ok: true,
      response: { ...result.response, replayed: false },
    };
  }

  private writeMessageReaction(
    reaction: MessageReaction,
    effect: MessageReactionCommandRecord["effect"],
  ): void {
    const actorId =
      reaction.actor.kind === "punk"
        ? reaction.actor.punkId
        : reaction.actor.installationId;
    this.ctx.storage.sql.exec(
      `INSERT INTO message_reactions
        (reaction_id, workspace_id, conversation_id, message_id, actor_kind,
         actor_id, reaction, status, revision, created_cursor, cursor,
         created_at, reacted_at, updated_at, removed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(reaction_id) DO UPDATE SET
         status = excluded.status,
         revision = excluded.revision,
         cursor = excluded.cursor,
         reacted_at = excluded.reacted_at,
         updated_at = excluded.updated_at,
         removed_at = excluded.removed_at`,
      reaction.id,
      reaction.workspaceId,
      reaction.conversationId,
      reaction.messageId,
      reaction.actor.kind,
      actorId,
      reaction.reaction,
      reaction.status,
      reaction.revision,
      reaction.createdCursor,
      reaction.cursor,
      reaction.createdAt,
      reaction.reactedAt,
      reaction.updatedAt,
      reaction.removedAt,
    );
    if (effect === "added") {
      this.ctx.storage.sql.exec(
        `INSERT INTO message_reaction_counts
          (message_id, reaction, active_count, last_cursor)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(message_id, reaction) DO UPDATE SET
           active_count = active_count + 1,
           last_cursor = excluded.last_cursor`,
        reaction.messageId,
        reaction.reaction,
        reaction.cursor,
      );
    } else if (effect === "removed") {
      const count = this.ctx.storage.sql
        .exec<{ active_count: number }>(
          `SELECT active_count FROM message_reaction_counts
           WHERE message_id = ? AND reaction = ?`,
          reaction.messageId,
          reaction.reaction,
        )
        .toArray()[0]?.active_count;
      if (count === undefined || count < 1) {
        throw new Error("Reaction count cannot become negative");
      }
      this.ctx.storage.sql.exec(
        `UPDATE message_reaction_counts
         SET active_count = active_count - 1, last_cursor = ?
         WHERE message_id = ? AND reaction = ?`,
        reaction.cursor,
        reaction.messageId,
        reaction.reaction,
      );
    }
  }

  private visibleMessageReaction(
    reaction: MessageReaction | null,
  ): MessageReaction | null {
    if (reaction === null || reaction.status !== "active") {
      return null;
    }
    const visibility = this.ctx.storage.sql
      .exec<{ visibility: string }>(
        `SELECT visibility FROM message_reaction_visibility
         WHERE message_id = ?`,
        reaction.messageId,
      )
      .toArray()[0]?.visibility;
    return visibility === "visible" ? reaction : null;
  }

  private setMessageReactionVisibility(
    messageId: string,
    visibility: "visible" | "temporarily-hidden" | "permanently-hidden",
    cursor: number,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO message_reaction_visibility
        (message_id, visibility, last_cursor)
       VALUES (?, ?, ?)
       ON CONFLICT(message_id) DO UPDATE SET
         visibility = CASE
           WHEN message_reaction_visibility.visibility = 'permanently-hidden'
             THEN 'permanently-hidden'
           ELSE excluded.visibility
         END,
         last_cursor = MAX(message_reaction_visibility.last_cursor, excluded.last_cursor)`,
      messageId,
      visibility,
      cursor,
    );
  }

  private abandonPendingMessageReaction(
    pending: PendingMessageReactionRow,
  ): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_message_reaction_command
       WHERE singleton = 1 AND command_id = ? AND semantic_hash = ?`,
      pending.command_id,
      pending.semantic_hash,
    );
  }

  private markPendingMessageReactionFailure(
    pending: PendingMessageReactionRow,
  ): void {
    const attempts = nextRetryAttempt(pending.attempts);
    this.ctx.storage.sql.exec(
      `UPDATE pending_message_reaction_command SET attempts = ?
       WHERE singleton = 1 AND command_id = ? AND semantic_hash = ?`,
      attempts,
      pending.command_id,
      pending.semantic_hash,
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private async attestAndFinalize(
    pending: PendingRow,
    replayed: boolean,
  ): Promise<ConversationExecuteResult> {
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(
        JSON.parse(String(pending.unsigned_json)) as UnsignedNostrEvent,
      );
    } catch {
      this.markPendingFailure();
      return { ok: false, code: "attestation_failed" };
    }

    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    const state = JSON.parse(String(pending.next_state_json)) as Conversation;
    let finalized: CommittedConversationCommand | undefined;

    this.ctx.storage.transactionSync(() => {
      const currentPending = this.pending();
      if (currentPending === undefined) {
        const existing = this.result(commandId);
        if (existing !== undefined && existing.payload_hash === payloadHash) {
          finalized = JSON.parse(
            existing.response_json,
          ) as CommittedConversationCommand;
        }
        return;
      }
      if (
        currentPending.command_id !== commandId ||
        currentPending.payload_hash !== payloadHash ||
        currentPending.command_json !== pending.command_json ||
        currentPending.unsigned_json !== pending.unsigned_json ||
        currentPending.next_state_json !== pending.next_state_json ||
        currentPending.reduction_overlay !== pending.reduction_overlay
      ) {
        return;
      }
      const committed = this.state();
      if (
        state.id !== this.ctx.id.name ||
        state.cursor !== (committed?.cursor ?? 0) + 1
      ) {
        return;
      }

      const response: CommittedConversationCommand = {
        state,
        event: signedEvent,
      };
      const projection: ConversationProjectionMessage = {
        schemaVersion: 1,
        workspaceId: state.workspaceId,
        conversationId: state.id,
        cursor: state.cursor,
        event: signedEvent,
        state,
      };
      const responseJson = JSON.stringify(response);
      const projectionJson = JSON.stringify(projection);
      const resultBytes = conversationResultByteLength({
        commandId,
        payloadHash,
        responseJson,
      });
      const safetyReduction = Number(pending.reduction_overlay) === 1;
      if (
        !this.hasConversationCommitCapacity(
          committed,
          state,
          projectionJson,
          resultBytes,
          safetyReduction,
        )
      ) {
        throw new Error("Conversation storage capacity changed");
      }
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
        JSON.stringify(state),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO journal (cursor, event_id, event_kind, event_json, committed_at)
         VALUES (?, ?, ?, ?, ?)`,
        state.cursor,
        signedEvent.id,
        signedEvent.kind,
        JSON.stringify(signedEvent),
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO command_results (command_id, payload_hash, response_json, committed_at)
         VALUES (?, ?, ?, ?)`,
        commandId,
        payloadHash,
        responseJson,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO outbox (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, ?, NULL, 0)`,
        signedEvent.id,
        state.cursor,
        projectionJson,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_command WHERE singleton = 1",
      );
      finalized = response;
    });

    if (finalized === undefined) {
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    this.scheduleTtlAlarm(state);
    this.wakeFollowers();
    return { ok: true, value: finalized, replayed };
  }

  private async attestAndFinalizeMessage(
    pending: PendingMessageRow,
    replayed: boolean,
  ): Promise<MessagePostResult> {
    const pendingState = JSON.parse(
      String(pending.next_message_json),
    ) as ReturnType<typeof boundedMessageState>;
    const pendingVersion = JSON.parse(
      String(pending.version_json),
    ) as MessageContentVersion;
    if (!(await this.authorizePendingMessage(pendingState))) {
      const released = await this.releasePendingMessageContentClaim(
        pendingState,
        pending,
        pendingVersion,
      );
      if (released) {
        this.abandonPendingMessage(pending);
      } else {
        this.markPendingMessageFailure(pending);
      }
      return { ok: false, code: "forbidden" };
    }

    if (
      !(await this.claimPendingMessageContent(
        pendingState,
        pending,
        pendingVersion,
      ))
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "content_finalize_failed" };
    }

    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(
        JSON.parse(String(pending.unsigned_json)) as UnsignedNostrEvent,
        "message-journal",
      );
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "attestation_failed" };
    }

    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    const state = pendingState;
    const version = pendingVersion;
    const threadDeltas = JSON.parse(
      String(pending.thread_deltas_json),
    ) as CommittedThreadDelta[];
    const search = JSON.parse(
      String(pending.search_json),
    ) as MessageProjectionMessage["search"];
    const nextConversation = JSON.parse(
      String(pending.next_conversation_json),
    ) as Conversation;
    const response: CommittedMessagePost = {
      state,
      version,
      event: signedEvent,
    };
    const projection: MessageProjectionMessage = {
      schemaVersion: 1,
      workspaceId: state.workspaceId,
      conversationId: state.conversationId,
      messageId: state.id,
      cursor: state.cursor,
      event: signedEvent,
      state,
      versionDelta: { operation: "upsert", version },
      threadDeltas: projectionThreadDeltas(threadDeltas),
      search,
    };
    if (
      !validateContract("punks://contracts/message.projection@1", projection)
        .valid
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }
    const responseJson = JSON.stringify(response);
    const projectionJson = JSON.stringify(projection);
    const resultBytes = messageResultByteLength({
      commandId,
      payloadHash,
      requestFingerprint: String(pending.request_fingerprint),
      responseJson,
    });

    if (!(await this.claimPendingMessageContent(state, pending, version))) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "content_finalize_failed" };
    }
    if (!(await this.authorizePendingMessage(state))) {
      const released = await this.releasePendingMessageContentClaim(
        state,
        pending,
        version,
      );
      if (released) {
        this.abandonPendingMessage(pending);
      } else {
        this.markPendingMessageFailure(pending);
      }
      return { ok: false, code: "forbidden" };
    }

    let finalized: CommittedMessagePost | undefined;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pendingMessage();
        if (currentPending === undefined) {
          const existing = this.messageResult(commandId);
          if (existing !== undefined && existing.payload_hash === payloadHash) {
            finalized = JSON.parse(
              existing.response_json,
            ) as CommittedMessagePost;
          }
          return;
        }
        if (
          currentPending.command_id !== commandId ||
          currentPending.payload_hash !== payloadHash
        ) {
          return;
        }
        const currentConversation = this.state();
        const currentMessage = this.message(state.id);
        if (
          currentConversation === null ||
          currentMessage !== null ||
          currentConversation.id !== nextConversation.id ||
          currentConversation.workspaceId !== nextConversation.workspaceId ||
          currentConversation.cursor + 1 !== nextConversation.cursor
        ) {
          return;
        }
        if (!this.hasContentFinalizationCapacity()) {
          throw new Error("Message content finalization capacity changed");
        }
        if (
          !this.hasMessageCommitCapacity(
            currentMessage,
            state,
            projectionJson,
            resultBytes,
            false,
          )
        ) {
          throw new Error("Message storage capacity changed");
        }

        this.insertMessage(state, version);
        this.setMessageReactionVisibility(state.id, "visible", state.cursor);
        for (const delta of threadDeltas) {
          const target = this.message(delta.messageId);
          if (
            target === null ||
            target.workspaceId !== state.workspaceId ||
            target.conversationId !== state.conversationId ||
            target.revision + 1 !== delta.revision
          ) {
            throw new Error("Thread target changed before Message commit");
          }
          this.ctx.storage.sql.exec(
            `UPDATE messages
             SET reply_count = reply_count + ?,
                 descendant_count = descendant_count + ?,
                 last_reply_at = ?, revision = ?, cursor = ?, updated_at = ?
             WHERE message_id = ? AND workspace_id = ? AND conversation_id = ?`,
            delta.replyCountDelta,
            delta.descendantCountDelta,
            delta.lastReplyAt,
            delta.revision,
            delta.cursor,
            delta.updatedAt,
            delta.messageId,
            state.workspaceId,
            state.conversationId,
          );
        }
        const now = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextConversation),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          nextConversation.cursor,
          signedEvent.id,
          signedEvent.kind,
          JSON.stringify(signedEvent),
          now,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO message_command_results
            (command_id, payload_hash, request_fingerprint, response_json,
             committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          commandId,
          payloadHash,
          String(pending.request_fingerprint),
          responseJson,
          now,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          signedEvent.id,
          nextConversation.cursor,
          projectionJson,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO content_finalization
            (event_id, workspace_id, conversation_id, message_id, command_id,
             content_key_id, attempts, next_attempt_at_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          signedEvent.id,
          state.workspaceId,
          state.conversationId,
          state.id,
          commandId,
          version.contentKeyId,
          Date.now(),
          now,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_message_command WHERE singleton = 1",
        );
        finalized = response;
      });
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }

    if (finalized === undefined) {
      return { ok: false, code: "internal" };
    }
    const finalization = this.contentFinalization(signedEvent.id);
    const contentFinalized =
      finalization !== undefined &&
      (await this.reconcileContentFinalization(finalization));
    if (contentFinalized) {
      this.ctx.waitUntil(this.flushOutbox());
    }
    this.scheduleTtlAlarm(nextConversation);
    if (!contentFinalized) {
      return { ok: false, code: "content_finalize_failed" };
    }
    return { ok: true, value: finalized, replayed };
  }

  private async attestAndFinalizeMessageMutation(
    pending: PendingMessageRow,
    replayed: boolean,
  ): Promise<MessageMutationResult> {
    const pendingState = JSON.parse(
      String(pending.next_message_json),
    ) as ReturnType<typeof boundedMessageState>;
    const pendingVersion = JSON.parse(
      String(pending.version_json),
    ) as MessageContentVersion;
    const nextConversation = JSON.parse(
      String(pending.next_conversation_json),
    ) as Conversation;
    const unsignedEvent = JSON.parse(
      String(pending.unsigned_json),
    ) as UnsignedNostrEvent;
    const currentBeforeAttestation = this.message(pendingState.id);
    if (
      currentBeforeAttestation === null ||
      !(await this.authorizePendingMessageMutation(
        currentBeforeAttestation,
        pendingState,
        nextConversation,
        unsignedEvent,
      ))
    ) {
      const released = await this.releasePendingMessageContentClaim(
        pendingState,
        pending,
        pendingVersion,
      );
      if (released) {
        this.abandonPendingMessage(pending);
      } else {
        this.markPendingMessageFailure(pending);
      }
      return { ok: false, code: "forbidden" };
    }

    if (
      !(await this.claimPendingMessageContent(
        pendingState,
        pending,
        pendingVersion,
      ))
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "content_finalize_failed" };
    }

    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent, "message-journal");
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "attestation_failed" };
    }

    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    const state = pendingState;
    const version = pendingVersion;
    const search = JSON.parse(
      String(pending.search_json),
    ) as MessageProjectionMessage["search"];
    const response: CommittedMessageMutation = {
      state,
      version,
      event: signedEvent,
    };
    const projection: MessageProjectionMessage = {
      schemaVersion: 1,
      workspaceId: state.workspaceId,
      conversationId: state.conversationId,
      messageId: state.id,
      cursor: state.cursor,
      event: signedEvent,
      state,
      versionDelta: { operation: "upsert", version },
      threadDeltas: [],
      search,
    };
    if (
      !validateContract("punks://contracts/message.projection@1", projection)
        .valid
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }
    const responseJson = JSON.stringify(response);
    const projectionJson = JSON.stringify(projection);
    const resultBytes = messageResultByteLength({
      commandId,
      payloadHash,
      requestFingerprint: String(pending.request_fingerprint),
      responseJson,
    });

    if (!(await this.claimPendingMessageContent(state, pending, version))) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "content_finalize_failed" };
    }
    const currentBeforeCommit = this.message(state.id);
    if (
      currentBeforeCommit === null ||
      !(await this.authorizePendingMessageMutation(
        currentBeforeCommit,
        state,
        nextConversation,
        unsignedEvent,
      ))
    ) {
      const released = await this.releasePendingMessageContentClaim(
        state,
        pending,
        version,
      );
      if (released) {
        this.abandonPendingMessage(pending);
      } else {
        this.markPendingMessageFailure(pending);
      }
      return { ok: false, code: "forbidden" };
    }

    let finalized: CommittedMessageMutation | undefined;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pendingMessage();
        if (currentPending === undefined) {
          const existing = this.messageResult(commandId);
          if (existing !== undefined && existing.payload_hash === payloadHash) {
            finalized = JSON.parse(
              existing.response_json,
            ) as CommittedMessageMutation;
          }
          return;
        }
        if (
          currentPending.command_id !== commandId ||
          currentPending.payload_hash !== payloadHash
        ) {
          return;
        }
        const currentConversation = this.state();
        const currentMessage = this.message(state.id);
        if (
          currentConversation === null ||
          currentMessage === null ||
          currentConversation.id !== nextConversation.id ||
          currentConversation.workspaceId !== nextConversation.workspaceId ||
          currentConversation.cursor + 1 !== nextConversation.cursor ||
          currentMessage.workspaceId !== state.workspaceId ||
          currentMessage.conversationId !== state.conversationId ||
          currentMessage.revision + 1 !== state.revision ||
          currentMessage.currentVersion === null ||
          currentMessage.currentVersion + 1 !== version.version
        ) {
          return;
        }
        if (!this.hasContentFinalizationCapacity()) {
          throw new Error("Message content finalization capacity changed");
        }
        if (
          !this.hasMessageCommitCapacity(
            currentMessage,
            state,
            projectionJson,
            resultBytes,
            false,
          )
        ) {
          throw new Error("Message storage capacity changed");
        }

        this.updateMessage(state);
        this.insertMessageVersion(state.id, version);
        const now = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextConversation),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          nextConversation.cursor,
          signedEvent.id,
          signedEvent.kind,
          JSON.stringify(signedEvent),
          now,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO message_command_results
            (command_id, payload_hash, request_fingerprint, response_json,
             committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          commandId,
          payloadHash,
          String(pending.request_fingerprint),
          responseJson,
          now,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          signedEvent.id,
          nextConversation.cursor,
          projectionJson,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO content_finalization
            (event_id, workspace_id, conversation_id, message_id, command_id,
             content_key_id, attempts, next_attempt_at_ms, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          signedEvent.id,
          state.workspaceId,
          state.conversationId,
          state.id,
          commandId,
          version.contentKeyId,
          Date.now(),
          now,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_message_command WHERE singleton = 1",
        );
        finalized = response;
      });
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }

    if (finalized === undefined) {
      return { ok: false, code: "internal" };
    }
    const finalization = this.contentFinalization(signedEvent.id);
    const contentFinalized =
      finalization !== undefined &&
      (await this.reconcileContentFinalization(finalization));
    if (contentFinalized) {
      this.ctx.waitUntil(this.flushOutbox());
    }
    this.scheduleTtlAlarm(nextConversation);
    if (!contentFinalized) {
      return { ok: false, code: "content_finalize_failed" };
    }
    return { ok: true, value: finalized, replayed };
  }

  private async attestAndFinalizeMessageStateMutation(
    pending: PendingMessageRow,
    replayed: boolean,
  ): Promise<MessageMutationResult> {
    let state = JSON.parse(String(pending.next_message_json)) as ReturnType<
      typeof boundedMessageState
    >;
    let nextConversation = JSON.parse(
      String(pending.next_conversation_json),
    ) as Conversation;
    let unsignedEvent = JSON.parse(
      String(pending.unsigned_json),
    ) as UnsignedNostrEvent;
    const currentBeforeAttestation = this.message(state.id);
    if (
      currentBeforeAttestation === null ||
      !(await this.authorizePendingMessageMutation(
        currentBeforeAttestation,
        state,
        nextConversation,
        unsignedEvent,
      ))
    ) {
      this.abandonPendingMessage(pending);
      return { ok: false, code: "forbidden" };
    }

    if (messageContractTag(unsignedEvent) === "message.retract@1") {
      const refreshed = await this.refreshPendingRetraction(pending, state);
      if (refreshed === null) {
        this.abandonPendingMessage(pending);
        return { ok: false, code: "forbidden" };
      }
      pending = refreshed;
      state = JSON.parse(String(pending.next_message_json)) as ReturnType<
        typeof boundedMessageState
      >;
      nextConversation = JSON.parse(
        String(pending.next_conversation_json),
      ) as Conversation;
      unsignedEvent = JSON.parse(
        String(pending.unsigned_json),
      ) as UnsignedNostrEvent;
    }

    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent, "message-journal");
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "attestation_failed" };
    }
    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    const threadDeltas = JSON.parse(
      String(pending.thread_deltas_json),
    ) as CommittedThreadDelta[];
    const search = JSON.parse(
      String(pending.search_json),
    ) as MessageProjectionMessage["search"];
    const response: CommittedMessageMutation = {
      state,
      version: null,
      event: signedEvent,
    };
    const projection: MessageProjectionMessage = {
      schemaVersion: 1,
      workspaceId: state.workspaceId,
      conversationId: state.conversationId,
      messageId: state.id,
      cursor: state.cursor,
      event: signedEvent,
      state,
      versionDelta: { operation: "retain" },
      threadDeltas: projectionThreadDeltas(threadDeltas),
      search,
    };
    if (
      !validateContract("punks://contracts/message.projection@1", projection)
        .valid
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }
    const responseJson = JSON.stringify(response);
    const projectionJson = JSON.stringify(projection);
    const resultBytes = messageResultByteLength({
      commandId,
      payloadHash,
      requestFingerprint: String(pending.request_fingerprint),
      responseJson,
    });

    const currentBeforeCommit = this.message(state.id);
    if (
      currentBeforeCommit === null ||
      !(await this.authorizePendingMessageMutation(
        currentBeforeCommit,
        state,
        nextConversation,
        unsignedEvent,
      ))
    ) {
      this.abandonPendingMessage(pending);
      return { ok: false, code: "forbidden" };
    }

    let finalized: CommittedMessageMutation | undefined;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pendingMessage();
        if (currentPending === undefined) {
          const existing = this.messageResult(commandId);
          if (existing !== undefined && existing.payload_hash === payloadHash) {
            finalized = JSON.parse(
              existing.response_json,
            ) as CommittedMessageMutation;
          }
          return;
        }
        if (
          currentPending.command_id !== commandId ||
          currentPending.payload_hash !== payloadHash
        ) {
          return;
        }
        const currentConversation = this.state();
        const currentMessage = this.message(state.id);
        if (
          currentConversation === null ||
          currentMessage === null ||
          currentConversation.id !== nextConversation.id ||
          currentConversation.workspaceId !== nextConversation.workspaceId ||
          currentConversation.cursor + 1 !== nextConversation.cursor ||
          currentMessage.workspaceId !== state.workspaceId ||
          currentMessage.conversationId !== state.conversationId ||
          currentMessage.revision + 1 !== state.revision
        ) {
          return;
        }
        const contract = messageContractTag(unsignedEvent);
        if (contract === null) {
          return;
        }
        if (
          contract === "message.restore@1" &&
          (currentMessage.retraction === null ||
            Date.now() >=
              new Date(currentMessage.retraction.eraseAfter).getTime())
        ) {
          return;
        }
        if (
          !this.hasMessageCommitCapacity(
            currentMessage,
            state,
            projectionJson,
            resultBytes,
            contract === "message.retract@1",
          )
        ) {
          throw new Error("Message storage capacity changed");
        }

        this.updateMessage(state);
        this.setMessageReactionVisibility(
          state.id,
          contract === "message.retract@1" ? "temporarily-hidden" : "visible",
          state.cursor,
        );
        if (contract === "message.retract@1") {
          if (state.retraction === null) {
            throw new Error("Retracted Message is missing its schedule");
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO message_erasure_schedule
              (message_id, retraction_command_id, erase_after, attempts,
               next_attempt_at_ms)
             VALUES (?, ?, ?, 0, ?)
             ON CONFLICT(message_id) DO UPDATE SET
               retraction_command_id = excluded.retraction_command_id,
               erase_after = excluded.erase_after,
               attempts = 0,
               next_attempt_at_ms = excluded.next_attempt_at_ms`,
            state.id,
            state.retraction.commandId,
            state.retraction.eraseAfter,
            Date.parse(state.retraction.eraseAfter),
          );
        } else if (contract === "message.restore@1") {
          this.ctx.storage.sql.exec(
            `DELETE FROM message_erasure_schedule
             WHERE message_id = ? AND retraction_command_id = ?`,
            state.id,
            currentMessage.retraction?.commandId ?? "",
          );
        }
        for (const delta of threadDeltas) {
          const target = this.message(delta.messageId);
          if (
            target === null ||
            target.workspaceId !== state.workspaceId ||
            target.conversationId !== state.conversationId ||
            target.revision + 1 !== delta.revision
          ) {
            throw new Error("Thread target changed before Message mutation");
          }
          this.ctx.storage.sql.exec(
            `UPDATE messages
             SET reply_count = reply_count + ?,
                 descendant_count = descendant_count + ?,
                 last_reply_at = ?, revision = ?, cursor = ?, updated_at = ?
             WHERE message_id = ? AND workspace_id = ? AND conversation_id = ?`,
            delta.replyCountDelta,
            delta.descendantCountDelta,
            delta.lastReplyAt,
            delta.revision,
            delta.cursor,
            delta.updatedAt,
            delta.messageId,
            state.workspaceId,
            state.conversationId,
          );
        }
        const committedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextConversation),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          nextConversation.cursor,
          signedEvent.id,
          signedEvent.kind,
          JSON.stringify(signedEvent),
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO message_command_results
            (command_id, payload_hash, request_fingerprint, response_json,
             committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          commandId,
          payloadHash,
          String(pending.request_fingerprint),
          responseJson,
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          signedEvent.id,
          nextConversation.cursor,
          projectionJson,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_message_command WHERE singleton = 1",
        );
        finalized = response;
      });
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }
    if (finalized === undefined) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "invalid_transition" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    this.scheduleTtlAlarm(nextConversation);
    this.scheduleNextMessageErasure();
    this.wakeFollowers();
    return { ok: true, value: finalized, replayed };
  }

  private async refreshPendingRetraction(
    pending: PendingMessageRow,
    preparedState: ReturnType<typeof boundedMessageState>,
  ): Promise<PendingMessageRow | null> {
    const retraction = preparedState.retraction;
    const conversation = this.state();
    const current = this.message(preparedState.id);
    if (
      retraction === null ||
      retraction.commandId !== String(pending.command_id) ||
      conversation === null ||
      current === null ||
      conversation.id !== preparedState.conversationId ||
      conversation.workspaceId !== preparedState.workspaceId ||
      current.workspaceId !== preparedState.workspaceId ||
      current.conversationId !== preparedState.conversationId
    ) {
      return null;
    }
    const command: RetractMessageCommand = {
      contract: "message.retract@1",
      commandId: retraction.commandId,
      workspaceId: preparedState.workspaceId,
      conversationId: preparedState.conversationId,
      messageId: preparedState.id,
      actor: retraction.actor,
      payload: {
        reasonCode: retraction.reasonCode,
        publicReason: retraction.publicReason,
      },
    };
    if (
      !validateContract("punks://contracts/message.retract@1", command).valid
    ) {
      return null;
    }

    const cursor = conversation.cursor + 1;
    const authorization = await this.authorizeMessageMutationActor(
      current,
      command,
      conversation,
      new Date(),
      cursor,
    );
    if (!authorization.ok) {
      return null;
    }

    const acceptedAt = new Date();
    let decision: ReturnType<typeof decideRetractMessage>;
    try {
      decision = decideRetractMessage(current, command, {
        ...authorization.context,
        now: acceptedAt,
      });
    } catch {
      return null;
    }
    if (decision.event === null) {
      return null;
    }
    const threadDeltas = this.prepareThreadDeltasForStatus(
      decision.threadDeltas,
      current,
      decision.nextState.status,
      acceptedAt,
      cursor,
    );
    const nextConversation = renewConversationAfterMessage(
      conversation,
      acceptedAt,
      cursor,
    );
    const state = boundedMessageState(decision.nextState);
    const search = JSON.parse(
      String(pending.search_json),
    ) as MessageProjectionMessage["search"];
    const projection: MessageProjectionMessage = {
      schemaVersion: 1,
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      cursor,
      event: {
        ...decision.event,
        id: "0".repeat(64),
        pubkey: "0".repeat(64),
        sig: "0".repeat(128),
      },
      state,
      versionDelta: { operation: "retain" },
      threadDeltas: projectionThreadDeltas(threadDeltas),
      search,
    };
    if (
      !validateContract("punks://contracts/message@1", decision.nextState)
        .valid ||
      !validateContract(
        "punks://contracts/nostr.unsigned-event@1",
        decision.event,
      ).valid ||
      !validateContract("punks://contracts/message.projection@1", projection)
        .valid
    ) {
      return null;
    }

    const previousUnsignedJson = String(pending.unsigned_json);
    this.ctx.storage.transactionSync(() => {
      const latestConversation = this.state();
      const latestMessage = this.message(command.messageId);
      if (
        latestConversation === null ||
        latestMessage === null ||
        latestConversation.cursor !== conversation.cursor ||
        latestMessage.revision !== current.revision
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        `UPDATE pending_message_command
         SET unsigned_json = ?, next_message_json = ?,
             thread_deltas_json = ?, next_conversation_json = ?
         WHERE singleton = 1 AND command_id = ? AND payload_hash = ?
           AND unsigned_json = ?`,
        JSON.stringify(decision.event),
        JSON.stringify(state),
        JSON.stringify(threadDeltas),
        JSON.stringify(nextConversation),
        String(pending.command_id),
        String(pending.payload_hash),
        previousUnsignedJson,
      );
    });
    const refreshed = this.pendingMessage();
    if (
      refreshed === undefined ||
      refreshed.command_id !== pending.command_id ||
      refreshed.payload_hash !== pending.payload_hash
    ) {
      return null;
    }
    return refreshed;
  }

  private async reconcileDueMessageErasure(): Promise<void> {
    if (this.pendingMessage() !== undefined) {
      return;
    }
    const row = this.ctx.storage.sql
      .exec<MessageErasureScheduleRow>(
        `SELECT message_id, retraction_command_id, erase_after, attempts,
                next_attempt_at_ms
         FROM message_erasure_schedule
         WHERE next_attempt_at_ms <= ?
         ORDER BY next_attempt_at_ms, message_id LIMIT 1`,
        Date.now(),
      )
      .toArray()[0];
    if (row === undefined) {
      this.scheduleNextMessageErasure();
      return;
    }
    const message = this.message(row.message_id);
    const conversation = this.state();
    if (
      message === null ||
      conversation === null ||
      message.status !== "retracted" ||
      message.retraction === null ||
      message.retraction.commandId !== row.retraction_command_id ||
      message.retraction.eraseAfter !== row.erase_after
    ) {
      this.ctx.storage.sql.exec(
        `DELETE FROM message_erasure_schedule
         WHERE message_id = ? AND retraction_command_id = ? AND erase_after = ?`,
        row.message_id,
        row.retraction_command_id,
        row.erase_after,
      );
      this.scheduleNextMessageErasure();
      return;
    }
    if (
      this.hasPendingAggregateMutation() ||
      this.contentFinalizationForMessage(message.id) !== undefined
    ) {
      this.markMessageErasureFailure(row);
      return;
    }
    const commandId = await deriveOpaqueUuid(
      "punks.message.final-erasure.v1",
      canonicalJson({
        workspaceId: message.workspaceId,
        conversationId: message.conversationId,
        messageId: message.id,
        retractionCommandId: row.retraction_command_id,
        eraseAfter: row.erase_after,
      }),
    );
    const expectedContentKeyIds = message.contentVersions
      .map((version) => version.contentKeyId)
      .sort();
    if (expectedContentKeyIds.length === 0) {
      this.markMessageErasureFailure(row);
      return;
    }
    const pendingErasure: PendingMessageErasure = {
      kind: "message-erasure-pending",
      messageId: message.id,
      retractionCommandId: row.retraction_command_id,
      eraseAfter: row.erase_after,
      expectedContentKeyIds,
    };
    const payloadHash = await sha256Hex(
      canonicalJson({ commandId, ...pendingErasure }),
    );
    let pending: PendingMessageRow | undefined;
    this.ctx.storage.transactionSync(() => {
      const current = this.message(row.message_id);
      if (
        this.hasPendingAggregateMutation() ||
        current === null ||
        current.status !== "retracted" ||
        current.retraction === null ||
        current.retraction.commandId !== row.retraction_command_id ||
        current.retraction.eraseAfter !== row.erase_after ||
        Date.now() < Date.parse(row.erase_after) ||
        this.contentFinalizationForMessage(current.id) !== undefined
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_message_command
          (singleton, command_id, payload_hash, request_fingerprint, unsigned_json,
           next_message_json, version_json, thread_deltas_json, search_json,
           next_conversation_json, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, 'null', '[]', ?, ?, 0, ?)`,
        commandId,
        payloadHash,
        payloadHash,
        JSON.stringify(pendingErasure),
        JSON.stringify(boundedMessageState(current)),
        JSON.stringify({
          algorithm: "hmac-sha256-conversation-v2",
          tokens: [],
        }),
        JSON.stringify(conversation),
        new Date().toISOString(),
      );
      pending = this.pendingMessage();
    });
    if (pending === undefined) {
      this.markMessageErasureFailure(row);
      return;
    }
    await this.reconcilePendingMessageErasure(pending, pendingErasure);
  }

  private async reconcilePendingMessageErasure(
    pending: PendingMessageRow,
    pendingErasure: PendingMessageErasure,
  ): Promise<void> {
    const current = this.message(pendingErasure.messageId);
    const conversation = this.state();
    if (
      current === null ||
      conversation === null ||
      current.status !== "retracted" ||
      current.retraction === null ||
      current.retraction.commandId !== pendingErasure.retractionCommandId ||
      current.retraction.eraseAfter !== pendingErasure.eraseAfter ||
      Date.now() < Date.parse(pendingErasure.eraseAfter) ||
      !sameStringValues(
        current.contentVersions.map((version) => version.contentKeyId),
        pendingErasure.expectedContentKeyIds,
      )
    ) {
      this.abandonPendingMessage(pending);
      return;
    }
    let destroyed: Awaited<
      ReturnType<
        ReturnType<ApiEnv["MESSAGE_CONTENT"]["getByName"]>["destroyGeneration"]
      >
    >;
    try {
      destroyed = await this.env.MESSAGE_CONTENT.getByName(
        current.id,
      ).destroyGeneration({
        workspaceId: current.workspaceId,
        conversationId: current.conversationId,
        messageId: current.id,
        generationId: current.id,
        operationId: String(pending.command_id),
        expectedContentKeyIds: pendingErasure.expectedContentKeyIds,
      });
    } catch {
      this.markPendingMessageFailure(pending);
      this.markMessageErasureFailureByMessage(current.id);
      return;
    }
    if (
      !destroyed.ok ||
      !(await validDestructionProof(destroyed.proof, current, pending))
    ) {
      this.markPendingMessageFailure(pending);
      this.markMessageErasureFailureByMessage(current.id);
      return;
    }
    const latest = this.message(current.id);
    const latestConversation = this.state();
    if (
      latest === null ||
      latestConversation === null ||
      latest.status !== "retracted" ||
      latest.retraction === null ||
      latest.retraction.commandId !== pendingErasure.retractionCommandId ||
      latest.retraction.eraseAfter !== pendingErasure.eraseAfter
    ) {
      this.abandonPendingMessage(pending);
      return;
    }
    const command: FinalizeMessageErasureCommand = {
      contract: "message.finalize-erasure@1",
      commandId: String(pending.command_id),
      workspaceId: latest.workspaceId,
      conversationId: latest.conversationId,
      messageId: latest.id,
      actor: { kind: "service", service: "crypto-erasure" },
      payload: {
        expectedRetractionCommandId: pendingErasure.retractionCommandId,
      },
    };
    try {
      const erasedAt = new Date(destroyed.proof.destroyedAt);
      const cursor = latestConversation.cursor + 1;
      const decision = decideFinalizeMessageErasure(latest, command, {
        cursor,
        now: erasedAt,
        destroyedContentKeyIds: destroyed.proof.destroyedContentKeyIds,
      });
      if (decision.event === null) {
        this.abandonPendingMessage(pending);
        return;
      }
      const nextConversation = renewConversationAfterMessage(
        latestConversation,
        erasedAt,
        cursor,
      );
      const projection: MessageProjectionMessage = {
        schemaVersion: 1,
        workspaceId: latest.workspaceId,
        conversationId: latest.conversationId,
        messageId: latest.id,
        cursor,
        event: {
          ...decision.event,
          id: "0".repeat(64),
          pubkey: "0".repeat(64),
          sig: "0".repeat(128),
        },
        state: boundedMessageState(decision.nextState),
        versionDelta: { operation: "erase-all" },
        threadDeltas: [],
        search: {
          algorithm: "hmac-sha256-conversation-v2",
          tokens: [],
        },
      };
      if (
        !validateContract("punks://contracts/message.projection@1", projection)
          .valid
      ) {
        this.markPendingMessageFailure(pending);
        return;
      }
      const sizingResponse: CommittedMessageMutation = {
        state: boundedMessageState(decision.nextState),
        version: null,
        event: projection.event,
      };
      const sizingResponseJson = JSON.stringify(sizingResponse);
      if (
        !this.hasMessageCommitCapacity(
          latest,
          sizingResponse.state,
          JSON.stringify(projection),
          messageResultByteLength({
            commandId: String(pending.command_id),
            payloadHash: String(pending.payload_hash),
            requestFingerprint: String(pending.request_fingerprint),
            responseJson: sizingResponseJson,
          }),
          true,
        )
      ) {
        this.markPendingMessageFailure(pending);
        return;
      }
      this.ctx.storage.sql.exec(
        `UPDATE pending_message_command
         SET unsigned_json = ?, next_message_json = ?, version_json = ?,
             thread_deltas_json = ?, search_json = ?,
             next_conversation_json = ?
         WHERE singleton = 1 AND command_id = ? AND payload_hash = ?`,
        JSON.stringify(decision.event),
        JSON.stringify(boundedMessageState(decision.nextState)),
        JSON.stringify(destroyed.proof),
        JSON.stringify(pendingErasure),
        JSON.stringify(projection.search),
        JSON.stringify(nextConversation),
        String(pending.command_id),
        String(pending.payload_hash),
      );
      const prepared = this.pendingMessage();
      if (prepared === undefined) {
        return;
      }
      await this.attestAndFinalizeMessageErasure(prepared, destroyed.replayed);
    } catch {
      this.markPendingMessageFailure(pending);
      this.markMessageErasureFailureByMessage(current.id);
    }
  }

  private async attestAndFinalizeMessageErasure(
    pending: PendingMessageRow,
    replayed: boolean,
  ): Promise<MessageMutationResult> {
    let event: UnsignedNostrEvent;
    let proof: MessageContentDestructionProof;
    let erasureIntent: PendingMessageErasure;
    try {
      event = JSON.parse(String(pending.unsigned_json)) as UnsignedNostrEvent;
      proof = JSON.parse(
        String(pending.version_json),
      ) as MessageContentDestructionProof;
      erasureIntent = JSON.parse(
        String(pending.thread_deltas_json),
      ) as PendingMessageErasure;
    } catch {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }
    const currentBeforeAttestation = this.message(proof.messageId);
    if (
      eventContractTag(event) !== "message.finalize-erasure@1" ||
      !isPendingMessageErasure(erasureIntent) ||
      erasureIntent.messageId !== proof.messageId ||
      currentBeforeAttestation === null ||
      !(await validDestructionProof(
        proof,
        currentBeforeAttestation,
        pending,
      )) ||
      currentBeforeAttestation.status !== "retracted" ||
      currentBeforeAttestation.retraction === null ||
      Date.now() < Date.parse(currentBeforeAttestation.retraction.eraseAfter)
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "invalid_transition" };
    }
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(event, "message-journal");
    } catch {
      this.markPendingMessageFailure(pending);
      this.markMessageErasureFailureByMessage(proof.messageId);
      return { ok: false, code: "attestation_failed" };
    }
    const state = JSON.parse(String(pending.next_message_json)) as ReturnType<
      typeof boundedMessageState
    >;
    const nextConversation = JSON.parse(
      String(pending.next_conversation_json),
    ) as Conversation;
    const response: CommittedMessageMutation = {
      state,
      version: null,
      event: signedEvent,
    };
    const projection: MessageProjectionMessage = {
      schemaVersion: 1,
      workspaceId: state.workspaceId,
      conversationId: state.conversationId,
      messageId: state.id,
      cursor: state.cursor,
      event: signedEvent,
      state,
      versionDelta: { operation: "erase-all" },
      threadDeltas: [],
      search: {
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [],
      },
    };
    if (
      !validateContract("punks://contracts/message.projection@1", projection)
        .valid
    ) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "internal" };
    }
    const responseJson = JSON.stringify(response);
    const projectionJson = JSON.stringify(projection);
    const resultBytes = messageResultByteLength({
      commandId: String(pending.command_id),
      payloadHash: String(pending.payload_hash),
      requestFingerprint: String(pending.request_fingerprint),
      responseJson,
    });
    let finalized: CommittedMessageMutation | undefined;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pendingMessage();
        const currentMessage = this.message(state.id);
        const currentConversation = this.state();
        if (currentPending === undefined) {
          const existing = this.messageResult(String(pending.command_id));
          if (
            existing !== undefined &&
            existing.payload_hash === String(pending.payload_hash)
          ) {
            finalized = JSON.parse(
              existing.response_json,
            ) as CommittedMessageMutation;
          }
          return;
        }
        if (
          currentPending.command_id !== pending.command_id ||
          currentPending.payload_hash !== pending.payload_hash ||
          currentMessage === null ||
          currentConversation === null ||
          currentMessage.status !== "retracted" ||
          currentMessage.retraction === null ||
          currentMessage.retraction.commandId !==
            erasureIntent.retractionCommandId ||
          currentMessage.retraction.eraseAfter !== erasureIntent.eraseAfter ||
          currentMessage.revision + 1 !== state.revision ||
          currentConversation.cursor + 1 !== nextConversation.cursor ||
          state.status !== "erased" ||
          state.erasureMarker?.erasedAt !== proof.destroyedAt
        ) {
          return;
        }
        if (
          !this.hasMessageCommitCapacity(
            currentMessage,
            state,
            projectionJson,
            resultBytes,
            true,
          )
        ) {
          throw new Error("Message erasure storage capacity changed");
        }
        const retractionCommandId = currentMessage.retraction.commandId;
        this.updateMessage(state);
        this.setMessageReactionVisibility(
          state.id,
          "permanently-hidden",
          state.cursor,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM message_versions WHERE message_id = ?",
          state.id,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM content_finalization WHERE message_id = ?",
          state.id,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextConversation),
        );
        const committedAt = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO journal
            (cursor, event_id, event_kind, event_json, committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          nextConversation.cursor,
          signedEvent.id,
          signedEvent.kind,
          JSON.stringify(signedEvent),
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO message_command_results
            (command_id, payload_hash, request_fingerprint, response_json,
             committed_at)
           VALUES (?, ?, ?, ?, ?)`,
          String(pending.command_id),
          String(pending.payload_hash),
          String(pending.request_fingerprint),
          responseJson,
          committedAt,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, cursor, payload_json, delivered_at, attempts)
           VALUES (?, ?, ?, NULL, 0)`,
          signedEvent.id,
          nextConversation.cursor,
          projectionJson,
        );
        this.ctx.storage.sql.exec(
          `DELETE FROM message_erasure_schedule
           WHERE message_id = ? AND retraction_command_id = ?`,
          state.id,
          retractionCommandId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_message_command WHERE singleton = 1",
        );
        finalized = response;
      });
    } catch {
      this.markPendingMessageFailure(pending);
      this.markMessageErasureFailureByMessage(state.id);
      return { ok: false, code: "internal" };
    }
    if (finalized === undefined) {
      this.markPendingMessageFailure(pending);
      return { ok: false, code: "invalid_transition" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    this.scheduleTtlAlarm(nextConversation);
    this.scheduleNextMessageErasure();
    this.wakeFollowers();
    return { ok: true, value: finalized, replayed };
  }

  private updateMessage(state: ReturnType<typeof boundedMessageState>): void {
    this.ctx.storage.sql.exec(
      `UPDATE messages
       SET author_json = ?, message_type = ?, status = ?, topic_present = ?,
           mentioned_punk_ids_json = ?, media_ids_json = ?,
           parent_message_id = ?, thread_root_message_id = ?, thread_depth = ?,
           broadcast = ?, reply_count = ?, descendant_count = ?,
           last_reply_at = ?, original_content_commitment = ?,
           current_version = ?, retraction_json = ?, erasure_marker_json = ?,
           revision = ?, created_cursor = ?, cursor = ?, created_at = ?,
           updated_at = ?, edited_at = ?
       WHERE message_id = ? AND workspace_id = ? AND conversation_id = ?`,
      JSON.stringify(state.author),
      state.messageType,
      state.status,
      state.topicPresent ? 1 : 0,
      JSON.stringify(state.mentionedPunkIds),
      JSON.stringify(state.mediaIds),
      state.parentMessageId,
      state.threadRootMessageId,
      state.threadDepth,
      state.broadcast ? 1 : 0,
      state.replyCount,
      state.descendantCount,
      state.lastReplyAt,
      state.originalContentCommitment ??
        (this.legacyRequiredOriginalContentCommitment ? "" : null),
      state.currentVersion,
      state.retraction === null ? null : JSON.stringify(state.retraction),
      state.erasureMarker === null ? null : JSON.stringify(state.erasureMarker),
      state.revision,
      state.createdCursor,
      state.cursor,
      state.createdAt,
      state.updatedAt,
      state.editedAt,
      state.id,
      state.workspaceId,
      state.conversationId,
    );
  }

  private insertMessageVersion(
    messageId: string,
    version: MessageContentVersion,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO message_versions
        (message_id, version, content_commitment, ciphertext_ref,
         content_key_id, topic_present, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      messageId,
      version.version,
      version.contentCommitment,
      version.ciphertextRef,
      version.contentKeyId,
      version.topicPresent ? 1 : 0,
      version.createdAt,
    );
  }

  private insertMessage(
    state: ReturnType<typeof boundedMessageState>,
    version: MessageContentVersion,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO messages
        (message_id, workspace_id, conversation_id, author_json, message_type,
         status, topic_present, mentioned_punk_ids_json, media_ids_json,
         parent_message_id, thread_root_message_id, thread_depth, broadcast,
         reply_count, descendant_count, last_reply_at,
         original_content_commitment,
         current_version, retraction_json, erasure_marker_json, revision,
         created_cursor, cursor, created_at, updated_at, edited_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      state.id,
      state.workspaceId,
      state.conversationId,
      JSON.stringify(state.author),
      state.messageType,
      state.status,
      state.topicPresent ? 1 : 0,
      JSON.stringify(state.mentionedPunkIds),
      JSON.stringify(state.mediaIds),
      state.parentMessageId,
      state.threadRootMessageId,
      state.threadDepth,
      state.broadcast ? 1 : 0,
      state.replyCount,
      state.descendantCount,
      state.lastReplyAt,
      state.originalContentCommitment,
      state.currentVersion,
      state.retraction === null ? null : JSON.stringify(state.retraction),
      state.erasureMarker === null ? null : JSON.stringify(state.erasureMarker),
      state.revision,
      state.createdCursor,
      state.cursor,
      state.createdAt,
      state.updatedAt,
      state.editedAt,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO message_versions
        (message_id, version, content_commitment, ciphertext_ref,
         content_key_id,
         topic_present, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      state.id,
      version.version,
      version.contentCommitment,
      version.ciphertextRef,
      version.contentKeyId,
      version.topicPresent ? 1 : 0,
      version.createdAt,
    );
  }

  private async attest(
    event: UnsignedNostrEvent,
    purpose: AttestationRequest["purpose"] = "conversation-journal",
  ): Promise<SignedNostrEvent> {
    const body: AttestationRequest = {
      purpose,
      event,
    };
    const response = await this.env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/internal/v1/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      throw new Error(`Attestation service returned ${response.status}`);
    }
    const responseBody: unknown = await response.json();
    if (
      !validateContract(
        "punks://contracts/attestation.response@1",
        responseBody,
      ).valid
    ) {
      throw new Error("Attestation service violated its contract");
    }
    const signed = (responseBody as AttestationResponse).event;
    if (
      !attestedEventPreservesUnsigned(signed, event) ||
      !(await verifyAttestation(signed, this.env))
    ) {
      throw new Error(
        "Attestation signature is not trusted in this environment",
      );
    }
    return signed;
  }

  private async claimPendingMessageContent(
    state: ReturnType<typeof boundedMessageState>,
    pending: PendingMessageRow,
    version: MessageContentVersion,
  ): Promise<boolean> {
    try {
      const result = await this.env.MESSAGE_CONTENT.getByName(
        state.id,
      ).claimForCommit({
        workspaceId: state.workspaceId,
        conversationId: state.conversationId,
        messageId: state.id,
        generationId: state.id,
        operationId: String(pending.command_id),
        contentKeyId: version.contentKeyId,
      });
      return (
        result.ok &&
        result.prepared.contentKeyId === version.contentKeyId &&
        result.prepared.version === version.version &&
        result.prepared.contentCommitment === version.contentCommitment &&
        result.prepared.ciphertextRef === version.ciphertextRef
      );
    } catch {
      return false;
    }
  }

  private async releasePendingMessageContentClaim(
    state: ReturnType<typeof boundedMessageState>,
    pending: PendingMessageRow,
    version: MessageContentVersion,
  ): Promise<boolean> {
    try {
      const result = await this.env.MESSAGE_CONTENT.getByName(
        state.id,
      ).releaseCommitClaim({
        workspaceId: state.workspaceId,
        conversationId: state.conversationId,
        messageId: state.id,
        generationId: state.id,
        operationId: String(pending.command_id),
        contentKeyId: version.contentKeyId,
      });
      return result.ok;
    } catch {
      // Keep the pending command so its durable alarm can retry the safe release.
      return false;
    }
  }

  private contentFinalization(
    eventId: string,
  ): ContentFinalizationRow | undefined {
    return this.ctx.storage.sql
      .exec<ContentFinalizationRow>(
        `SELECT event_id, workspace_id, conversation_id, message_id,
                command_id, content_key_id, attempts, next_attempt_at_ms
         FROM content_finalization WHERE event_id = ?`,
        eventId,
      )
      .toArray()[0];
  }

  private contentFinalizationForMessage(
    messageId: string,
  ): ContentFinalizationRow | undefined {
    return this.ctx.storage.sql
      .exec<ContentFinalizationRow>(
        `SELECT event_id, workspace_id, conversation_id, message_id,
                command_id, content_key_id, attempts, next_attempt_at_ms
         FROM content_finalization WHERE message_id = ?
         ORDER BY created_at LIMIT 1`,
        messageId,
      )
      .toArray()[0];
  }

  private hasContentFinalizationCapacity(): boolean {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(event_id AS BLOB)) +
                  length(CAST(workspace_id AS BLOB)) +
                  length(CAST(conversation_id AS BLOB)) +
                  length(CAST(message_id AS BLOB)) +
                  length(CAST(command_id AS BLOB)) +
                  length(CAST(content_key_id AS BLOB)) +
                  length(CAST(created_at AS BLOB)) + 16
                ), 0) AS bytes
         FROM content_finalization`,
      )
      .one();
    return (
      Number(usage.rows) + 1 <= MAXIMUM_CONTENT_FINALIZATION_ROWS &&
      Number(usage.bytes) + MAXIMUM_CONTENT_FINALIZATION_ROW_BYTES <=
        MAXIMUM_CONTENT_FINALIZATION_BYTES
    );
  }

  private markMessageErasureFailure(row: MessageErasureScheduleRow): void {
    const attempts = nextRetryAttempt(row.attempts);
    const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
    this.ctx.storage.sql.exec(
      `UPDATE message_erasure_schedule
       SET attempts = ?, next_attempt_at_ms = ?
       WHERE message_id = ? AND retraction_command_id = ?
         AND erase_after = ? AND attempts = ?`,
      attempts,
      Date.now() + delay,
      row.message_id,
      row.retraction_command_id,
      row.erase_after,
      row.attempts,
    );
    this.scheduleAlarm(delay);
  }

  private markMessageErasureFailureByMessage(messageId: string): void {
    const row = this.ctx.storage.sql
      .exec<MessageErasureScheduleRow>(
        `SELECT message_id, retraction_command_id, erase_after, attempts,
                next_attempt_at_ms
         FROM message_erasure_schedule WHERE message_id = ?`,
        messageId,
      )
      .toArray()[0];
    if (row !== undefined) {
      this.markMessageErasureFailure(row);
    }
  }

  private scheduleNextMessageErasure(): void {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at_ms: number | null }>(
        `SELECT MIN(next_attempt_at_ms) AS next_attempt_at_ms
         FROM message_erasure_schedule`,
      )
      .toArray()[0]?.next_attempt_at_ms;
    if (typeof next === "number") {
      this.scheduleAlarm(Math.max(0, next - Date.now()));
    }
  }

  private async reconcileContentFinalization(
    row: ContentFinalizationRow,
  ): Promise<boolean> {
    const request = {
      workspaceId: row.workspace_id,
      conversationId: row.conversation_id,
      messageId: row.message_id,
      generationId: row.message_id,
      operationId: row.command_id,
      contentKeyId: row.content_key_id,
    };
    const vault = this.env.MESSAGE_CONTENT.getByName(row.message_id);
    let claimed: Awaited<ReturnType<typeof vault.claimForCommit>>;
    try {
      claimed = await vault.claimForCommit(request);
    } catch {
      this.markContentFinalizationFailure(row);
      return false;
    }
    if (!claimed.ok || claimed.prepared.contentKeyId !== row.content_key_id) {
      this.markContentFinalizationFailure(row);
      return false;
    }
    let finalized: Awaited<ReturnType<typeof vault.finalize>>;
    try {
      finalized = await vault.finalize(request);
    } catch {
      this.markContentFinalizationFailure(row);
      return false;
    }
    if (
      !finalized.ok ||
      finalized.prepared.contentKeyId !== row.content_key_id
    ) {
      this.markContentFinalizationFailure(row);
      return false;
    }
    this.ctx.storage.sql.exec(
      `DELETE FROM content_finalization
       WHERE event_id = ? AND command_id = ? AND content_key_id = ?`,
      row.event_id,
      row.command_id,
      row.content_key_id,
    );
    const reconciliationComplete =
      this.contentFinalization(row.event_id) === undefined;
    if (reconciliationComplete) {
      this.wakeFollowers();
    }
    return reconciliationComplete;
  }

  private async reconcileContentFinalizations(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<ContentFinalizationRow>(
        `SELECT event_id, workspace_id, conversation_id, message_id,
                command_id, content_key_id, attempts, next_attempt_at_ms
         FROM content_finalization
         WHERE next_attempt_at_ms <= ?
         ORDER BY next_attempt_at_ms, event_id LIMIT 20`,
        Date.now(),
      )
      .toArray();
    for (const row of rows) {
      await this.reconcileContentFinalization(row);
    }
    this.scheduleNextContentFinalization();
  }

  private markContentFinalizationFailure(row: ContentFinalizationRow): void {
    const attempts = nextRetryAttempt(row.attempts);
    const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
    this.ctx.storage.sql.exec(
      `UPDATE content_finalization
       SET attempts = ?, next_attempt_at_ms = ?
       WHERE event_id = ? AND command_id = ? AND content_key_id = ?
         AND attempts = ?`,
      attempts,
      Date.now() + delay,
      row.event_id,
      row.command_id,
      row.content_key_id,
      row.attempts,
    );
    this.scheduleAlarm(delay);
  }

  private scheduleNextContentFinalization(): void {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at_ms: number }>(
        `SELECT MIN(next_attempt_at_ms) AS next_attempt_at_ms
         FROM content_finalization`,
      )
      .toArray()[0]?.next_attempt_at_ms;
    if (typeof next === "number") {
      this.scheduleAlarm(Math.max(0, next - Date.now()));
    }
  }

  private markPendingFailure(): void {
    const attempts = nextRetryAttempt(this.pending()?.attempts);
    this.ctx.storage.sql.exec(
      "UPDATE pending_command SET attempts = ? WHERE singleton = 1",
      attempts,
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private markPendingMessageFailure(pending: PendingMessageRow): void {
    const attempts = nextRetryAttempt(pending.attempts);
    this.ctx.storage.sql.exec(
      `UPDATE pending_message_command SET attempts = ?
       WHERE singleton = 1 AND command_id = ? AND payload_hash = ?`,
      attempts,
      String(pending.command_id),
      String(pending.payload_hash),
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private async authorizePendingMessage(
    state: ReturnType<typeof boundedMessageState>,
  ): Promise<boolean> {
    if (state.author.kind !== "punk") {
      return false;
    }
    const authorization = await this.env.WORKSPACES.getByName(
      state.workspaceId,
    ).authorize({
      workspaceId: state.workspaceId,
      punkId: state.author.punkId,
      permission: "conversations.write",
    });
    if (!authorization.ok) {
      return false;
    }
    const conversation = this.effectiveState();
    return (
      conversation !== null &&
      conversation.id === state.conversationId &&
      conversation.workspaceId === state.workspaceId &&
      conversation.status === "active" &&
      canWriteConversation(conversation, state.author.punkId)
    );
  }

  private async authorizePendingMessageMutation(
    current: Message,
    state: ReturnType<typeof boundedMessageState>,
    nextConversation: Conversation,
    event: UnsignedNostrEvent,
  ): Promise<boolean> {
    const contract = messageContractTag(event);
    const actorTags = event.tags.filter((tag) => tag[0] === "actor");
    const workspaceTags = event.tags.filter((tag) => tag[0] === "workspace");
    const conversationTags = event.tags.filter(
      (tag) => tag[0] === "conversation",
    );
    const messageTags = event.tags.filter((tag) => tag[0] === "message");
    const actor = actorTags[0];
    if (
      contract === null ||
      actorTags.length !== 1 ||
      actor?.[1] !== "punk" ||
      typeof actor[2] !== "string" ||
      workspaceTags.length !== 1 ||
      workspaceTags[0]?.[1] !== state.workspaceId ||
      conversationTags.length !== 1 ||
      conversationTags[0]?.[1] !== state.conversationId ||
      messageTags.length !== 1 ||
      messageTags[0]?.[1] !== state.id
    ) {
      return false;
    }
    const punkId = actor[2];
    const authorization = await this.env.WORKSPACES.getByName(
      state.workspaceId,
    ).authorize({
      workspaceId: state.workspaceId,
      punkId,
      permission: "workspace.read",
    });
    if (!authorization.ok) {
      return false;
    }
    const conversation = this.effectiveState();
    if (
      conversation === null ||
      conversation.id !== state.conversationId ||
      conversation.workspaceId !== state.workspaceId ||
      conversation.status !== "active" ||
      nextConversation.id !== conversation.id ||
      nextConversation.workspaceId !== conversation.workspaceId ||
      nextConversation.cursor !== state.cursor
    ) {
      return false;
    }
    const context: MessageDecisionContext = {
      messageId: current.id,
      cursor: state.cursor,
      now: new Date(),
      workspaceCursor: authorization.workspaceCursor,
      conversationCursor: state.cursor,
      conversation: {
        type: conversation.type,
        visibility: conversation.visibility,
        status: conversation.status,
        topicRequired: conversation.topicRequired,
      },
      authorization: {
        workspaceRole: authorization.role,
        conversationAccess:
          conversation.members.find((member) => member.punkId === punkId)
            ?.access ?? null,
        botCapabilities: new Set(),
      },
    };
    try {
      authorizeMessageMutation(
        current,
        {
          contract,
          actor: { kind: "punk", punkId },
        },
        context,
      );
      return true;
    } catch {
      return false;
    }
  }

  private abandonPendingMessage(pending: PendingMessageRow): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_message_command
       WHERE singleton = 1 AND command_id = ? AND payload_hash = ?`,
      String(pending.command_id),
      String(pending.payload_hash),
    );
  }

  private async flushOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<OutboxRow>(
        `SELECT event_id, cursor, payload_json, attempts FROM outbox
         WHERE delivered_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM content_finalization
             WHERE content_finalization.event_id = outbox.event_id
           )
           AND cursor < COALESCE(
             (
               SELECT MIN(blocked.cursor)
               FROM outbox AS blocked
               JOIN content_finalization
                 ON content_finalization.event_id = blocked.event_id
               WHERE blocked.delivered_at IS NULL
             ),
             9223372036854775807
           )
         ORDER BY cursor LIMIT 20`,
      )
      .toArray();
    for (const row of rows) {
      try {
        await this.env.PROJECTION_QUEUE.send(
          JSON.parse(String(row.payload_json)),
        );
        let snapshotCommitted = false;
        this.ctx.storage.transactionSync(() => {
          const current = this.ctx.storage.sql
            .exec<{
              cursor: number;
              payload_json: string;
              attempts: number;
            }>(
              `SELECT cursor, payload_json, attempts FROM outbox
               WHERE event_id = ? AND delivered_at IS NULL`,
              row.event_id,
            )
            .toArray()[0];
          if (current === undefined) {
            return;
          }
          if (
            Number(current.cursor) !== Number(row.cursor) ||
            String(current.payload_json) !== String(row.payload_json) ||
            Number(current.attempts) !== Number(row.attempts)
          ) {
            return;
          }
          const enqueuedThrough = this.enqueuedThroughCursor();
          const cursor = Number(current.cursor);
          if (cursor !== enqueuedThrough + 1) {
            throw new Error("Projection outbox cursor is not contiguous");
          }
          this.ctx.storage.sql.exec(
            `UPDATE projection_delivery_state
             SET enqueued_through_cursor = ? WHERE singleton = 1`,
            cursor,
          );
          this.ctx.storage.sql.exec(
            `DELETE FROM outbox
             WHERE event_id = ? AND cursor = ? AND payload_json = ?
               AND attempts = ? AND delivered_at IS NULL`,
            row.event_id,
            cursor,
            current.payload_json,
            current.attempts,
          );
          snapshotCommitted = true;
        });
        if (!snapshotCommitted) {
          this.scheduleAlarm(0);
          return;
        }
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        this.ctx.storage.sql.exec(
          "UPDATE outbox SET attempts = ? WHERE event_id = ?",
          attempts,
          row.event_id,
        );
        this.scheduleAlarm(
          Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
        );
        return;
      }
    }
    if (rows.length === 20) {
      this.scheduleAlarm(0);
    }
  }

  private enqueuedThroughCursor(): number {
    return Number(
      this.ctx.storage.sql
        .exec<{ enqueued_through_cursor: number }>(
          `SELECT enqueued_through_cursor FROM projection_delivery_state
           WHERE singleton = 1`,
        )
        .one().enqueued_through_cursor,
    );
  }

  private pendingArchive(): PendingArchiveRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingArchiveRow>(
        `SELECT start_cursor, end_cursor, previous_segment_hash, segment_hash,
                object_key, events_json, unsigned_seal_json, attempts
         FROM pending_archive WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private archiveLimits(): { hotEvents: number; segmentEvents: number } {
    return {
      hotEvents: this.positiveInteger(
        this.env.JOURNAL_HOT_EVENTS,
        1_000,
        1,
        100_000,
      ),
      segmentEvents: this.positiveInteger(
        this.env.JOURNAL_SEGMENT_EVENTS,
        250,
        1,
        500,
      ),
    };
  }

  private hasJournalCapacity(): boolean {
    const { hotEvents, segmentEvents } = this.archiveLimits();
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
      .one().count;
    return count < hotEvents + segmentEvents;
  }

  private async ensureJournalCapacity(): Promise<boolean> {
    if (this.hasJournalCapacity()) {
      return true;
    }
    await this.archiveJournalIfNeeded();
    return this.hasJournalCapacity();
  }

  private async archiveJournalIfNeeded(): Promise<void> {
    try {
      let pending = this.pendingArchive();
      if (pending === undefined) {
        pending = await this.preparePendingArchive();
      }
      if (pending !== undefined) {
        await this.writePendingArchive(pending);
      }
    } catch {
      const pending = this.pendingArchive();
      if (pending === undefined) {
        this.scheduleAlarm(1_000);
        return;
      }
      const attempts = nextRetryAttempt(pending.attempts);
      this.ctx.storage.sql.exec(
        "UPDATE pending_archive SET attempts = ? WHERE singleton = 1",
        attempts,
      );
      this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
    }
  }

  private async preparePendingArchive(): Promise<
    PendingArchiveRow | undefined
  > {
    const { hotEvents, segmentEvents } = this.archiveLimits();
    const count =
      this.ctx.storage.sql
        .exec<Record<"count", number>>("SELECT COUNT(*) AS count FROM journal")
        .toArray()[0]?.count ?? 0;
    if (count < hotEvents + segmentEvents) {
      return undefined;
    }

    const rows = this.ctx.storage.sql
      .exec<JournalRow>(
        `SELECT cursor, event_json FROM journal
         WHERE cursor <= ? ORDER BY cursor LIMIT ?`,
        this.enqueuedThroughCursor(),
        segmentEvents,
      )
      .toArray();
    const maxBytes = 4_000_000;
    const selected: JournalRow[] = [];
    let selectedBytes = 0;
    for (const row of rows) {
      const rowBytes = new TextEncoder().encode(
        String(row.event_json),
      ).byteLength;
      if (selected.length > 0 && selectedBytes + rowBytes > maxBytes) {
        break;
      }
      selected.push(row);
      selectedBytes += rowBytes;
    }
    if (selected.length === 0) {
      return undefined;
    }

    const state = this.state();
    if (state === null) {
      throw new Error("Cannot archive a journal without Conversation state");
    }
    const archiveHead = this.ctx.storage.sql
      .exec<ArchiveHeadRow>(
        `SELECT end_cursor, segment_hash FROM archive_segments
         ORDER BY end_cursor DESC LIMIT 1`,
      )
      .toArray()[0];
    const expectedStartCursor =
      archiveHead === undefined ? 1 : Number(archiveHead.end_cursor) + 1;
    if (Number(selected[0]?.cursor) !== expectedStartCursor) {
      throw new Error("Conversation journal archive cursor is not contiguous");
    }
    const previousSegmentHash =
      archiveHead === undefined ? null : String(archiveHead.segment_hash);
    const draft = await prepareConversationJournalSegment(
      state.workspaceId,
      state.id,
      selected.map((row) => ({
        cursor: Number(row.cursor),
        event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
      })),
      previousSegmentHash,
      new Date(),
    );

    const raced = this.pendingArchive();
    if (raced !== undefined) {
      return raced;
    }
    const objectKey = `workspaces/${state.workspaceId}/conversations/${state.id}/journal/${draft.startCursor}-${draft.endCursor}-${draft.segmentHash}.json`;
    this.ctx.storage.sql.exec(
      `INSERT INTO pending_archive
        (singleton, start_cursor, end_cursor, previous_segment_hash, segment_hash,
         object_key, events_json, unsigned_seal_json, attempts, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      draft.startCursor,
      draft.endCursor,
      draft.previousSegmentHash,
      draft.segmentHash,
      objectKey,
      JSON.stringify(draft.events),
      JSON.stringify(draft.unsignedSeal),
      new Date().toISOString(),
    );
    await this.ctx.storage.sync();
    return this.pendingArchive();
  }

  private async writePendingArchive(pending: PendingArchiveRow): Promise<void> {
    const state = this.state();
    if (state === null) {
      throw new Error("Cannot archive a journal without Conversation state");
    }
    if (Number(pending.end_cursor) > this.enqueuedThroughCursor()) {
      this.scheduleAlarm(1_000);
      return;
    }
    const unsignedSeal = JSON.parse(
      String(pending.unsigned_seal_json),
    ) as UnsignedNostrEvent;
    const seal = await this.persistedArchiveSeal(
      String(pending.segment_hash),
      unsignedSeal,
    );
    if (seal.kind !== 50104) {
      throw new Error(
        "Conversation journal archive seal used an unexpected event kind",
      );
    }
    let archive: ConversationJournalSegmentArchive = {
      schemaVersion: 1,
      workspaceId: state.workspaceId,
      conversationId: state.id,
      startCursor: Number(pending.start_cursor),
      endCursor: Number(pending.end_cursor),
      previousSegmentHash:
        pending.previous_segment_hash === null
          ? null
          : String(pending.previous_segment_hash),
      segmentHash: String(pending.segment_hash),
      events: JSON.parse(
        String(pending.events_json),
      ) as ConversationJournalSegmentArchive["events"],
      seal: { ...seal, kind: 50104 },
    };
    if (
      !validateContract(
        "punks://contracts/conversation.journal-segment@1",
        archive,
      ).valid
    ) {
      throw new Error(
        "Conversation journal archive violated its canonical contract",
      );
    }
    if (!(await verifyConversationJournalSegmentHash(archive))) {
      throw new Error(
        "Conversation journal archive hash does not match events",
      );
    }

    const body = canonicalJson(archive);
    if (
      new TextEncoder().encode(body).byteLength >
      CONVERSATION_ARCHIVE_MAX_BODY_BYTES
    ) {
      throw new Error(
        "Conversation journal archive exceeds its bounded body size",
      );
    }

    const objectKey = String(pending.object_key);
    const metadata = {
      workspaceId: state.workspaceId,
      conversationId: state.id,
      segmentHash: archive.segmentHash,
      startCursor: String(archive.startCursor),
      endCursor: String(archive.endCursor),
    };
    const stored = await this.env.JOURNAL_ARCHIVE_BUCKET.put(objectKey, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: metadata,
    });
    if (stored === null) {
      const existing = await this.env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
      if (
        existing === null ||
        existing.size > CONVERSATION_ARCHIVE_MAX_BODY_BYTES
      ) {
        throw new Error(
          "Conversation journal archive precondition failed without an existing object",
        );
      }
      const existingText = await existing.text();
      const existingBody = parseJson(existingText);
      if (
        existingBody === null ||
        !validateContract(
          "punks://contracts/conversation.journal-segment@1",
          existingBody,
        ).valid
      ) {
        throw new Error(
          "Existing Conversation journal archive violated its canonical contract",
        );
      }
      const existingArchive = existingBody as ConversationJournalSegmentArchive;
      if (
        existingText !== canonicalJson(existingArchive) ||
        existing.httpMetadata?.contentType !== "application/json" ||
        canonicalJson(existing.customMetadata) !== canonicalJson(metadata) ||
        existingArchive.workspaceId !== state.workspaceId ||
        existingArchive.conversationId !== state.id ||
        existingArchive.startCursor !== Number(pending.start_cursor) ||
        existingArchive.endCursor !== Number(pending.end_cursor) ||
        existingArchive.previousSegmentHash !== pending.previous_segment_hash ||
        existingArchive.segmentHash !== pending.segment_hash ||
        canonicalJson(existingArchive.events) !==
          canonicalJson(parseJson(String(pending.events_json))) ||
        !attestedEventPreservesUnsigned(existingArchive.seal, unsignedSeal) ||
        !(await verifyAttestation(existingArchive.seal, this.env)) ||
        !(await verifyConversationJournalSegmentHash(existingArchive))
      ) {
        throw new Error(
          "Existing Conversation journal archive failed integrity verification",
        );
      }
      archive = existingArchive;
    }

    this.ctx.storage.transactionSync(() => {
      const current = this.pendingArchive();
      if (!samePendingArchive(current, pending)) {
        return;
      }
      const currentHead = this.ctx.storage.sql
        .exec<ArchiveHeadRow>(
          `SELECT end_cursor, segment_hash FROM archive_segments
           ORDER BY end_cursor DESC LIMIT 1`,
        )
        .toArray()[0];
      const expectedPrevious =
        currentHead === undefined ? null : String(currentHead.segment_hash);
      const expectedStart =
        currentHead === undefined ? 1 : Number(currentHead.end_cursor) + 1;
      const localEvents = this.ctx.storage.sql
        .exec<JournalRow>(
          `SELECT cursor, event_json FROM journal
           WHERE cursor >= ? AND cursor <= ? ORDER BY cursor`,
          archive.startCursor,
          archive.endCursor,
        )
        .toArray();
      if (
        archive.workspaceId !== state.workspaceId ||
        archive.conversationId !== state.id ||
        archive.startCursor !== expectedStart ||
        archive.previousSegmentHash !== expectedPrevious ||
        archive.endCursor > this.enqueuedThroughCursor() ||
        localEvents.length !== archive.events.length ||
        localEvents.some(
          (row, index) =>
            Number(row.cursor) !== archive.startCursor + index ||
            canonicalJson(parseJson(String(row.event_json))) !==
              canonicalJson(archive.events[index]),
        )
      ) {
        throw new Error("Conversation journal changed before archive commit");
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO archive_segments
          (start_cursor, end_cursor, previous_segment_hash, segment_hash,
           object_key, seal_json, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        archive.startCursor,
        archive.endCursor,
        archive.previousSegmentHash,
        archive.segmentHash,
        objectKey,
        JSON.stringify(archive.seal),
        new Date().toISOString(),
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM journal WHERE cursor >= ? AND cursor <= ?",
        archive.startCursor,
        archive.endCursor,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_archive WHERE singleton = 1",
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_archive_seals WHERE segment_hash = ?",
        archive.segmentHash,
      );
    });
    this.scheduleAlarm(0);
  }

  private async persistedArchiveSeal(
    segmentHash: string,
    unsigned: UnsignedNostrEvent,
  ): Promise<SignedNostrEvent> {
    let row = this.ctx.storage.sql
      .exec<{ seal_json: string }>(
        "SELECT seal_json FROM pending_archive_seals WHERE segment_hash = ?",
        segmentHash,
      )
      .toArray()[0];
    if (row === undefined) {
      const signed = await this.attest(
        unsigned,
        "conversation-journal-segment",
      );
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO pending_archive_seals
          (segment_hash, seal_json, persisted_at) VALUES (?, ?, ?)`,
        segmentHash,
        JSON.stringify(signed),
        new Date().toISOString(),
      );
      await this.ctx.storage.sync();
      row = this.ctx.storage.sql
        .exec<{ seal_json: string }>(
          "SELECT seal_json FROM pending_archive_seals WHERE segment_hash = ?",
          segmentHash,
        )
        .toArray()[0];
    }
    const seal = row === undefined ? null : parseJson(row.seal_json);
    if (
      seal === null ||
      !validateContract("punks://contracts/nostr.signed-event@1", seal).valid ||
      !attestedEventPreservesUnsigned(seal as SignedNostrEvent, unsigned) ||
      !(await verifyAttestation(seal as SignedNostrEvent, this.env))
    ) {
      throw new Error("Persisted Conversation journal archive seal is invalid");
    }
    return seal as SignedNostrEvent;
  }

  private positiveInteger(
    configured: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const value = Number.parseInt(configured, 10);
    return Number.isSafeInteger(value) && value >= minimum && value <= maximum
      ? value
      : fallback;
  }

  private ensureAlarmAt(scheduledAt: number): Promise<void> {
    this.alarmScheduling = this.alarmScheduling
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.ctx.storage.getAlarm();
        if (existing === null || scheduledAt < existing) {
          await this.ctx.storage.setAlarm(scheduledAt);
        }
      });
    this.ctx.waitUntil(this.alarmScheduling);
    return this.alarmScheduling;
  }

  private scheduleAlarm(delayMs: number): void {
    void this.ensureAlarmAt(Date.now() + delayMs);
  }

  private scheduleTtlAlarm(state = this.state()): void {
    if (
      state === null ||
      state.status !== "active" ||
      state.ttlDeadline === null
    ) {
      return;
    }
    this.scheduleAlarm(Math.max(0, Date.parse(state.ttlDeadline) - Date.now()));
  }

  private async archiveExpiredConversation(): Promise<void> {
    const state = this.state();
    if (
      state === null ||
      state.status !== "active" ||
      state.ttlDeadline === null ||
      Date.parse(state.ttlDeadline) > Date.now()
    ) {
      return;
    }
    const command: ArchiveConversationCommand = {
      contract: "conversation.archive@1",
      commandId: await deriveOpaqueUuid(
        "punks.conversation.ttl-expiry.v1",
        canonicalJson({
          conversationId: state.id,
          ttlDeadline: state.ttlDeadline,
          workspaceId: state.workspaceId,
        }),
      ),
      workspaceId: state.workspaceId,
      conversationId: state.id,
      actor: { kind: "punk", punkId: state.ownerPunkId },
      payload: { cause: "ttl_expired" },
    };
    const result = await this.execute(command);
    if (!result.ok && result.code !== "invalid_transition") {
      this.scheduleAlarm(1_000);
    }
  }
}

function isPostMessageRequest(value: unknown): value is PostMessageRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    "messageId" in value &&
    typeof value.messageId === "string" &&
    "command" in value &&
    typeof value.command === "object" &&
    value.command !== null
  );
}

function sameConversationSnapshot(
  current: Conversation | null,
  expected: Conversation | null,
): boolean {
  return canonicalJson(current) === canonicalJson(expected);
}

function isConversationSafetyReduction(
  current: Conversation | null,
  command: ConversationCommand,
): boolean {
  if (current === null) {
    return false;
  }
  if (command.contract === "conversation.archive@1") {
    return current.status === "active";
  }
  if (command.contract === "conversation.member-remove@1") {
    return current.members.some(
      (member) => member.punkId === command.payload.targetPunkId,
    );
  }
  if (command.contract !== "conversation.member-set-access@1") {
    return false;
  }
  const existing = current.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  return (
    existing !== undefined &&
    isStrictConversationAccessReduction(existing.access, command.payload.access)
  );
}

function isStrictConversationAccessReduction(
  current: Conversation["members"][number]["access"],
  next: Conversation["members"][number]["access"],
): boolean {
  const capabilities = {
    owner: new Set(["read", "write", "manage"]),
    manager: new Set(["read", "write", "manage"]),
    member: new Set(["read", "write"]),
    guest: new Set(["read"]),
  } as const;
  const currentCapabilities = capabilities[current];
  const nextCapabilities = capabilities[next];
  return (
    nextCapabilities.size < currentCapabilities.size &&
    [...nextCapabilities].every((capability) =>
      currentCapabilities.has(capability),
    )
  );
}

function isWorkspaceRole(
  value: string | undefined,
): value is "owner" | "moderator" | "member" | "guest" {
  return (
    value === "owner" ||
    value === "moderator" ||
    value === "member" ||
    value === "guest"
  );
}

function parseConversationCommand(value: string): ConversationCommand | null {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const contract = Reflect.get(parsed, "contract");
  if (typeof contract !== "string" || !(contract in commandContracts)) {
    return null;
  }
  return validateContract(
    commandContracts[contract as keyof typeof commandContracts],
    parsed,
  ).valid
    ? (parsed as ConversationCommand)
    : null;
}

function decideConversationCommand(
  current: Conversation,
  command: ConversationCommand,
  context: {
    conversationId: string;
    cursor: number;
    now: Date;
    workspaceCursor: number;
    workspaceRole: "owner" | "moderator" | "member" | "guest";
  },
): { nextState: Conversation; event: UnsignedNostrEvent } {
  switch (command.contract) {
    case "conversation.member-set-access@1":
      return decideSetConversationMemberAccess(current, command, context);
    case "conversation.member-remove@1":
      return decideRemoveConversationMember(current, command, context);
    case "conversation.archive@1":
      return decideArchiveConversation(current, command, context);
    default:
      throw new Error("Conversation pending overlay is not a reduction");
  }
}

function parseFollowAttachment(value: unknown): FollowAttachment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "ackDeadlineAt",
    "conversationId",
    "lastAck",
    "lastSent",
    "phase",
    "pumpDeadlineAt",
    "punkId",
    "schemaVersion",
    "sessionExpiresAt",
    "sessionId",
    "targetHighWater",
    "workspaceId",
  ];
  if (Object.keys(record).sort().join(",") !== expectedKeys.join(",")) {
    return null;
  }
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  if (
    record.schemaVersion !== 1 ||
    typeof record.workspaceId !== "string" ||
    !uuid.test(record.workspaceId) ||
    typeof record.conversationId !== "string" ||
    !uuid.test(record.conversationId) ||
    typeof record.punkId !== "string" ||
    !uuid.test(record.punkId) ||
    typeof record.sessionId !== "string" ||
    !uuid.test(record.sessionId) ||
    typeof record.sessionExpiresAt !== "string" ||
    Number.isNaN(Date.parse(record.sessionExpiresAt)) ||
    (record.phase !== "catch-up" &&
      record.phase !== "live" &&
      record.phase !== "pumping-catch-up" &&
      record.phase !== "pumping-live") ||
    !Number.isSafeInteger(record.lastAck) ||
    !Number.isSafeInteger(record.lastSent) ||
    !Number.isSafeInteger(record.targetHighWater) ||
    Number(record.lastAck) < 0 ||
    Number(record.lastSent) < Number(record.lastAck) ||
    Number(record.targetHighWater) < Number(record.lastSent) ||
    (record.ackDeadlineAt !== null &&
      (!Number.isSafeInteger(record.ackDeadlineAt) ||
        Number(record.ackDeadlineAt) < 0)) ||
    (record.pumpDeadlineAt !== null &&
      (!Number.isSafeInteger(record.pumpDeadlineAt) ||
        Number(record.pumpDeadlineAt) < 0)) ||
    (record.phase === "pumping-catch-up" || record.phase === "pumping-live") !==
      (record.pumpDeadlineAt !== null)
  ) {
    return null;
  }
  return record as FollowAttachment;
}

function isMessageMutationRequest(
  value: unknown,
): value is MessageMutationRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 2 &&
    "messageId" in value &&
    typeof value.messageId === "string" &&
    "command" in value &&
    typeof value.command === "object" &&
    value.command !== null
  );
}

function isMessageReadRequest(value: unknown): value is MessageReadRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 4 &&
    "workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    "conversationId" in value &&
    typeof value.conversationId === "string" &&
    "messageId" in value &&
    typeof value.messageId === "string" &&
    "punkId" in value &&
    typeof value.punkId === "string"
  );
}

function messageContractTag(
  event: UnsignedNostrEvent,
): "message.edit@1" | "message.retract@1" | "message.restore@1" | null {
  const contract = eventContractTag(event);
  return contract === "message.edit@1" ||
    contract === "message.retract@1" ||
    contract === "message.restore@1"
    ? contract
    : null;
}

function eventContractTag(
  event: UnsignedNostrEvent,
):
  | "message.post@1"
  | "message.edit@1"
  | "message.retract@1"
  | "message.restore@1"
  | "message.finalize-erasure@1"
  | null {
  const tags = event.tags.filter((tag) => tag[0] === "contract");
  if (tags.length !== 1) {
    return null;
  }
  const contract = tags[0]?.[1];
  return contract === "message.post@1" ||
    contract === "message.edit@1" ||
    contract === "message.retract@1" ||
    contract === "message.restore@1" ||
    contract === "message.finalize-erasure@1"
    ? contract
    : null;
}

function parsePendingMessageErasure(
  value: string | number,
): PendingMessageErasure | null {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return isPendingMessageErasure(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPendingMessageErasure(
  value: unknown,
): value is PendingMessageErasure {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = record.expectedContentKeyIds;
  return (
    keys.join(",") ===
      "eraseAfter,expectedContentKeyIds,kind,messageId,retractionCommandId" &&
    record.kind === "message-erasure-pending" &&
    typeof record.messageId === "string" &&
    typeof record.retractionCommandId === "string" &&
    typeof record.eraseAfter === "string" &&
    !Number.isNaN(Date.parse(record.eraseAfter)) &&
    Array.isArray(expected) &&
    expected.length >= 1 &&
    expected.length <= 1_000 &&
    isCanonicalContentKeyIds(expected)
  );
}

function sameStringValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSorted = [...new Set(left)].sort();
  const rightSorted = [...new Set(right)].sort();
  return (
    leftSorted.length === left.length &&
    rightSorted.length === right.length &&
    leftSorted.length === rightSorted.length &&
    leftSorted.every((value, index) => value === rightSorted[index])
  );
}

function isCanonicalContentKeyIds(values: readonly unknown[]): boolean {
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  return values.every(
    (value, index) =>
      typeof value === "string" &&
      uuid.test(value) &&
      (index === 0 || String(values[index - 1]) < value),
  );
}

async function validDestructionProof(
  proof: MessageContentDestructionProof,
  message: Message,
  pending: PendingMessageRow,
): Promise<boolean> {
  if (
    proof.schemaVersion !== 1 ||
    proof.operationId !== String(pending.command_id) ||
    proof.workspaceId !== message.workspaceId ||
    proof.conversationId !== message.conversationId ||
    proof.messageId !== message.id ||
    proof.generationId !== message.id ||
    !Array.isArray(proof.destroyedContentKeyIds) ||
    proof.destroyedContentKeyIds.length < 1 ||
    proof.destroyedContentKeyIds.length > 1_000 ||
    !isCanonicalContentKeyIds(proof.destroyedContentKeyIds) ||
    !message.contentVersions.every((version) =>
      proof.destroyedContentKeyIds.includes(version.contentKeyId),
    ) ||
    Number.isNaN(Date.parse(proof.destroyedAt)) ||
    new Date(proof.destroyedAt).toISOString() !== proof.destroyedAt ||
    !/^[0-9a-f]{64}$/.test(proof.proofHash)
  ) {
    return false;
  }
  const draft = {
    schemaVersion: 1 as const,
    operationId: proof.operationId,
    workspaceId: proof.workspaceId,
    conversationId: proof.conversationId,
    messageId: proof.messageId,
    generationId: proof.generationId,
    destroyedAt: proof.destroyedAt,
    destroyedContentKeyIds: proof.destroyedContentKeyIds,
  };
  return (await sha256Hex(JSON.stringify(draft))) === proof.proofHash;
}

function isMessageReactionMutationRequest(
  value: unknown,
): value is MessageReactionMutationRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).join(",") === "command" &&
    "command" in value &&
    typeof value.command === "object" &&
    value.command !== null &&
    !Array.isArray(value.command)
  );
}

function decideMessageReaction(
  current: MessageReaction | null,
  command:
    | AddMessageReactionCommand
    | RemoveMessageReactionCommand
    | ToggleMessageReactionCommand,
  context: MessageReactionDecisionContext,
): MessageReactionDecision {
  switch (command.contract) {
    case "message.reaction-add@1":
      return decideAddMessageReaction(current, command, context);
    case "message.reaction-remove@1":
      return decideRemoveMessageReaction(current, command, context);
    case "message.reaction-toggle@1":
      return decideToggleMessageReaction(current, command, context);
  }
}

function messageReactionDecisionContext(
  reactionId: string,
  cursor: number,
  now: Date,
  conversation: Conversation,
  target: Message,
  workspaceCursor: number,
  workspaceRole: Exclude<WorkspaceAuthorizationResult, { ok: false }>["role"],
  punkId: string,
  priorCommand: MessageReactionCommandRecord | null,
): MessageReactionDecisionContext {
  return {
    reactionId,
    cursor,
    now,
    authority: { kind: "workspace", workspaceCursor },
    conversationCursor: cursor,
    targetMessage: {
      id: target.id,
      workspaceId: target.workspaceId,
      conversationId: target.conversationId,
      status: target.status,
    },
    conversation: {
      status: conversation.status,
      visibility: conversation.visibility,
    },
    authorization: {
      workspaceRole,
      conversationAccess:
        conversation.members.find((member) => member.punkId === punkId)
          ?.access ?? null,
      botCapabilities: new Set(),
    },
    priorCommand,
  };
}

function messageReactionResponse(
  reaction: MessageReaction | null,
  effect: MessageReactionMutationResponse["effect"],
  replayed: boolean,
): MessageReactionMutationResponse {
  return {
    reaction:
      reaction?.status === "active" && reaction.reactedAt !== null
        ? {
            id: reaction.id,
            workspaceId: reaction.workspaceId,
            conversationId: reaction.conversationId,
            messageId: reaction.messageId,
            actor: reaction.actor,
            reaction: reaction.reaction,
            reactedAt: reaction.reactedAt,
          }
        : null,
    effect,
    replayed,
  };
}

function messageReactionDomainFailure(
  error: unknown,
): MessageReactionMutationResult {
  if (error instanceof MessageReactionDomainError) {
    return { ok: false, code: error.code };
  }
  return { ok: false, code: "internal" };
}

function attestedEventPreservesUnsigned(
  signed: SignedNostrEvent,
  unsigned: UnsignedNostrEvent,
): boolean {
  const attestation = signed.tags.at(-1);
  return (
    signed.created_at === unsigned.created_at &&
    signed.kind === unsigned.kind &&
    signed.content === unsigned.content &&
    signed.tags.length === unsigned.tags.length + 1 &&
    JSON.stringify(signed.tags.slice(0, -1)) ===
      JSON.stringify(unsigned.tags) &&
    attestation?.length === 2 &&
    attestation[0] === "attestation" &&
    typeof attestation[1] === "string" &&
    attestation[1].length > 0
  );
}

function isMessageHistoryRequest(
  value: unknown,
): value is MessageHistoryRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 2 &&
    "punkId" in value &&
    typeof value.punkId === "string" &&
    value.punkId.length > 0 &&
    "query" in value &&
    typeof value.query === "object" &&
    value.query !== null
  );
}

function isMessageSearchRequest(value: unknown): value is MessageSearchRequest {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).sort().join(",") === "punkId,query" &&
    "punkId" in value &&
    typeof value.punkId === "string" &&
    isUuid(value.punkId) &&
    "query" in value &&
    typeof value.query === "object" &&
    value.query !== null
  );
}

function isMessageSearchPayload(
  value: unknown,
): value is PreparedSearchItem["payload"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).sort().join(",") === "content,schemaVersion,topic" &&
    record.schemaVersion === 1 &&
    typeof record.content === "string" &&
    (record.topic === null || typeof record.topic === "string")
  );
}

function validateSearchWorkspaceAuthorization(
  value: unknown,
): WorkspaceAuthorizationResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_request" ||
        record.code === "not_found" ||
        record.code === "forbidden")
      ? (record as Extract<WorkspaceAuthorizationResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !==
      "ok,role,visibility,workspaceCursor" ||
    !Number.isSafeInteger(record.workspaceCursor) ||
    Number(record.workspaceCursor) < 1 ||
    (record.role !== "owner" &&
      record.role !== "moderator" &&
      record.role !== "member" &&
      record.role !== "guest") ||
    (record.visibility !== "private" &&
      record.visibility !== "punks" &&
      record.visibility !== "public")
  ) {
    return null;
  }
  return record as unknown as Extract<
    WorkspaceAuthorizationResult,
    { ok: true }
  >;
}

function validateSearchContentReadResult(
  value: unknown,
): ReadMessageContentResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_request" ||
        record.code === "not_found" ||
        record.code === "not_finalized" ||
        record.code === "generation_destroyed" ||
        record.code === "integrity_failure" ||
        record.code === "storage_unavailable")
      ? (record as Extract<ReadMessageContentResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !==
      "contentCommitment,ok,payload,version" ||
    typeof record.contentCommitment !== "string" ||
    !/^[0-9a-f]{64}$/u.test(record.contentCommitment) ||
    !Number.isSafeInteger(record.version) ||
    Number(record.version) < 1 ||
    Number(record.version) > 1_000 ||
    !isMessageSearchPayload(record.payload)
  ) {
    return null;
  }
  return record as unknown as Extract<ReadMessageContentResult, { ok: true }>;
}

function candidatePosition(
  candidate: MessageSearchCandidate,
): MessageSearchCandidatePosition {
  return [
    candidate.createdCursor,
    candidate.conversationId,
    candidate.messageId,
  ];
}

function searchPositionFollows(
  position: MessageCandidateCursor,
  cursor: MessageCandidateCursor,
): boolean {
  return (
    position[0] < cursor[0] ||
    (position[0] === cursor[0] &&
      (position[1] > cursor[1] ||
        (position[1] === cursor[1] && position[2] > cursor[2])))
  );
}

function sameSearchPosition(
  left: MessageCandidateCursor,
  right: MessageCandidateCursor,
): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

function validateSearchMessageCandidatesResult(
  value: unknown,
  request: SearchMessageCandidatesInput,
): SearchMessageCandidatesResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_request" ||
        record.code === "storage_unavailable")
      ? (record as Extract<SearchMessageCandidatesResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !==
      "candidates,indexState,nextCursor,ok" ||
    (record.indexState !== "current" && record.indexState !== "lagging") ||
    !Array.isArray(record.candidates) ||
    record.candidates.length > request.limit
  ) {
    return null;
  }
  const candidates: MessageSearchCandidate[] = [];
  const messageIds = new Set<string>();
  let previous: MessageCandidateCursor | undefined = request.cursor;
  for (const value of record.candidates) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const candidate = value as Record<string, unknown>;
    if (
      Object.keys(candidate).sort().join(",") !==
        "conversationId,createdCursor,lastCursor,messageId" ||
      typeof candidate.messageId !== "string" ||
      !isUuid(candidate.messageId) ||
      messageIds.has(candidate.messageId) ||
      candidate.conversationId !== request.conversationId ||
      !Number.isSafeInteger(candidate.createdCursor) ||
      Number(candidate.createdCursor) < 1 ||
      !Number.isSafeInteger(candidate.lastCursor) ||
      Number(candidate.lastCursor) < Number(candidate.createdCursor)
    ) {
      return null;
    }
    const validated: MessageSearchCandidate = {
      messageId: candidate.messageId,
      conversationId: request.conversationId,
      createdCursor: Number(candidate.createdCursor),
      lastCursor: Number(candidate.lastCursor),
    };
    const position = candidatePosition(validated);
    if (previous !== undefined && !searchPositionFollows(position, previous)) {
      return null;
    }
    candidates.push(validated);
    messageIds.add(validated.messageId);
    previous = position;
  }
  let nextCursor: MessageCandidateCursor | null;
  if (record.nextCursor === null) {
    nextCursor = null;
  } else if (
    !isMessageCandidateCursor(record.nextCursor, request.conversationId) ||
    candidates.length === 0 ||
    !sameSearchPosition(
      record.nextCursor,
      candidatePosition(
        candidates[candidates.length - 1] as MessageSearchCandidate,
      ),
    )
  ) {
    return null;
  } else {
    nextCursor = record.nextCursor;
  }
  return {
    ok: true,
    indexState: record.indexState,
    candidates,
    nextCursor,
  };
}

function isMessageCandidateCursor(
  value: unknown,
  conversationId: string,
): value is MessageCandidateCursor {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    Number.isSafeInteger(value[0]) &&
    Number(value[0]) >= 1 &&
    value[1] === conversationId &&
    typeof value[2] === "string" &&
    isUuid(value[2])
  );
}

function messageSearchResponseFits(
  query: MessageSearchQuery,
  items: MessageView[],
  nextCursor: string | null,
): boolean {
  return (
    new TextEncoder().encode(
      JSON.stringify({
        workspaceId: query.workspaceId,
        conversationId: query.conversationId,
        threadRootMessageId: query.threadRootMessageId,
        order: "createdCursor-descending",
        completeness: "partial",
        partialReason: "index_lagging",
        items,
        nextCursor,
      }),
    ).byteLength <=
    MESSAGE_SEARCH_MAX_RESPONSE_BYTES - MESSAGE_SEARCH_SIZE_MARGIN_BYTES
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
    value,
  );
}

function isMessageJournalKind(kind: number): boolean {
  return (
    kind === MESSAGE_EVENT_KINDS.messagePosted ||
    kind === MESSAGE_EVENT_KINDS.messageEdited ||
    kind === MESSAGE_EVENT_KINDS.messageRetracted ||
    kind === MESSAGE_EVENT_KINDS.messageRestored ||
    kind === MESSAGE_EVENT_KINDS.messageErasureMarked
  );
}

function canReadConversation(
  conversation: Conversation,
  punkId: string,
): boolean {
  const access = conversation.members.find(
    (member) => member.punkId === punkId,
  )?.access;
  return conversation.visibility === "open" || access !== undefined;
}

function canWriteConversation(
  conversation: Conversation,
  punkId: string,
): boolean {
  const access = conversation.members.find(
    (member) => member.punkId === punkId,
  )?.access;
  if (access === "guest") {
    return false;
  }
  return conversation.visibility === "open" || access !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function samePendingArchive(
  current: PendingArchiveRow | undefined,
  expected: PendingArchiveRow,
): boolean {
  return (
    current !== undefined &&
    current.start_cursor === expected.start_cursor &&
    current.end_cursor === expected.end_cursor &&
    current.previous_segment_hash === expected.previous_segment_hash &&
    current.segment_hash === expected.segment_hash &&
    current.object_key === expected.object_key &&
    current.events_json === expected.events_json &&
    current.unsigned_seal_json === expected.unsigned_seal_json
  );
}

function hasExactObjectKeys(
  value: Record<string, unknown>,
  keys: string[],
): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function isOpaqueUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function isOfferBotWakeRequest(input: unknown): input is OfferBotWakeRequest {
  return (
    isRecord(input) &&
    hasExactObjectKeys(input, ["installationId", "messageId"]) &&
    isOpaqueUuid(input.installationId) &&
    isOpaqueUuid(input.messageId)
  );
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isBotWakeCandidate(value: unknown): value is BotWakeCandidate {
  return (
    isRecord(value) &&
    hasExactObjectKeys(value, [
      "schemaVersion",
      "wakeId",
      "workspaceId",
      "installationId",
      "botId",
      "conversationId",
      "messageId",
      "messageCursor",
      "subscriptionEpoch",
      "sourceEventId",
      "sourceEventDigest",
      "createdAt",
    ]) &&
    value.schemaVersion === 1 &&
    isOpaqueUuid(value.wakeId) &&
    typeof value.workspaceId === "string" &&
    isUuid(value.workspaceId) &&
    isOpaqueUuid(value.installationId) &&
    isOpaqueUuid(value.botId) &&
    typeof value.conversationId === "string" &&
    isUuid(value.conversationId) &&
    isOpaqueUuid(value.messageId) &&
    Number.isSafeInteger(value.messageCursor) &&
    Number(value.messageCursor) >= 1 &&
    Number.isSafeInteger(value.subscriptionEpoch) &&
    Number(value.subscriptionEpoch) >= 1 &&
    typeof value.sourceEventId === "string" &&
    /^[0-9a-f]{64}$/.test(value.sourceEventId) &&
    typeof value.sourceEventDigest === "string" &&
    /^[0-9a-f]{64}$/.test(value.sourceEventDigest) &&
    isCanonicalIsoTimestamp(value.createdAt)
  );
}

async function isReadBotWakeContextRequest(input: unknown): Promise<boolean> {
  if (
    !isRecord(input) ||
    !hasExactObjectKeys(input, [
      "installationId",
      "wakeId",
      "turnId",
      "authorityGeneration",
      "offerDigest",
      "offer",
    ]) ||
    !isOpaqueUuid(input.installationId) ||
    !isOpaqueUuid(input.wakeId) ||
    !isOpaqueUuid(input.turnId) ||
    !Number.isSafeInteger(input.authorityGeneration) ||
    Number(input.authorityGeneration) < 1 ||
    typeof input.offerDigest !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.offerDigest) ||
    !(await validateBotWakeOffer(input.offer))
  ) {
    return false;
  }
  const offer = input.offer as BotWakeOffer;
  return (
    offer.installationId === input.installationId &&
    offer.wakeId === input.wakeId &&
    offer.subscriptionEpoch === input.authorityGeneration &&
    input.turnId === (await deriveBotWakeTurnId(offer.wakeId)) &&
    input.offerDigest === (await deriveBotWakeOfferDigest(offer))
  );
}

async function botWakeContextProofMatchesSource(
  proof: ReadBotWakeContextRequest,
  source: BotWakeCandidateSource,
): Promise<boolean> {
  const offer = proof.offer;
  return (
    offer.workspaceId === source.conversation.workspaceId &&
    offer.installationId === source.subscription.installation_id &&
    offer.botId === source.subscription.bot_id &&
    offer.conversationId === source.conversation.id &&
    offer.messageId === source.message.id &&
    offer.messageCursor === source.message.createdCursor &&
    offer.subscriptionEpoch === source.subscription.epoch &&
    offer.sourceEventId === source.event.id &&
    offer.sourceEventDigest ===
      (await sha256Hex(canonicalJson(source.event))) &&
    offer.createdAt === source.message.createdAt
  );
}

function isExactBotContextPayload(
  value: unknown,
): value is { schemaVersion: 1; content: string; topic: string | null } {
  return (
    isRecord(value) &&
    hasExactObjectKeys(value, ["schemaVersion", "content", "topic"]) &&
    value.schemaVersion === 1 &&
    typeof value.content === "string" &&
    (typeof value.topic === "string" || value.topic === null)
  );
}

function exactAcceptBotWakeCandidateResult(
  value: unknown,
  wakeId: string,
): AcceptBotWakeCandidateResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  if (value.ok) {
    return hasExactObjectKeys(value, [
      "ok",
      "wakeId",
      "replayed",
      "terminal",
    ]) &&
      value.wakeId === wakeId &&
      typeof value.replayed === "boolean" &&
      typeof value.terminal === "boolean"
      ? (value as AcceptBotWakeCandidateResult)
      : null;
  }
  return hasExactObjectKeys(value, ["ok", "code"]) &&
    (value.code === "invalid_request" ||
      value.code === "not_found" ||
      value.code === "authority_revoked" ||
      value.code === "conflict" ||
      value.code === "temporarily_unavailable" ||
      value.code === "internal")
    ? (value as AcceptBotWakeCandidateResult)
    : null;
}

function botWakeSourceEventMatchesMessage(
  event: SignedNostrEvent,
  journal: {
    cursor: number;
    event_id: string;
    event_kind: number;
    event_json: string;
  },
  message: Message,
): boolean {
  const body = parseJson(event.content);
  const version = message.contentVersions[0];
  if (
    version === undefined ||
    !isRecord(body) ||
    !hasExactObjectKeys(body, ["schemaVersion", "message", "versionDelta"]) ||
    body.schemaVersion !== 1 ||
    !isRecord(body.versionDelta) ||
    !hasExactObjectKeys(body.versionDelta, ["operation", "version"]) ||
    body.versionDelta.operation !== "upsert"
  ) {
    return false;
  }
  const authorId =
    message.author.kind === "punk"
      ? message.author.punkId
      : message.author.installationId;
  const expectedPrefix = [
    ["workspace", message.workspaceId],
    ["conversation", message.conversationId],
    ["message", message.id],
    ["cursor", String(message.createdCursor)],
  ];
  return (
    journal.cursor === message.createdCursor &&
    journal.event_id === event.id &&
    journal.event_kind === MESSAGE_EVENT_KINDS.messagePosted &&
    event.kind === MESSAGE_EVENT_KINDS.messagePosted &&
    event.created_at === Math.floor(Date.parse(message.createdAt) / 1_000) &&
    expectedPrefix.every(
      (tag, index) => canonicalJson(event.tags[index]) === canonicalJson(tag),
    ) &&
    canonicalJson(event.tags[5]) ===
      canonicalJson(["contract", "message.post@1"]) &&
    canonicalJson(event.tags[6]) ===
      canonicalJson(["actor", message.author.kind, authorId]) &&
    canonicalJson(body.message) ===
      canonicalJson(boundedMessageState(message)) &&
    canonicalJson(body.versionDelta.version) === canonicalJson(version)
  );
}

function botWakeCandidateMatchesSourceEvent(
  candidate: BotWakeCandidate,
  event: SignedNostrEvent,
  journal: { event_id: string; event_kind: number; event_json: string },
): boolean {
  const body = parseJson(event.content);
  if (!isRecord(body) || !isRecord(body.message) || body.schemaVersion !== 1) {
    return false;
  }
  const expectedPrefix = [
    ["workspace", candidate.workspaceId],
    ["conversation", candidate.conversationId],
    ["message", candidate.messageId],
    ["cursor", String(candidate.messageCursor)],
  ];
  return (
    journal.event_id === candidate.sourceEventId &&
    journal.event_id === event.id &&
    journal.event_kind === MESSAGE_EVENT_KINDS.messagePosted &&
    event.kind === MESSAGE_EVENT_KINDS.messagePosted &&
    expectedPrefix.every(
      (tag, index) => canonicalJson(event.tags[index]) === canonicalJson(tag),
    ) &&
    body.message.id === candidate.messageId &&
    body.message.workspaceId === candidate.workspaceId &&
    body.message.conversationId === candidate.conversationId &&
    body.message.createdCursor === candidate.messageCursor &&
    body.message.createdAt === candidate.createdAt
  );
}

function sameBotWakeCandidateSource(
  current: BotWakeCandidateSource,
  expected: BotWakeCandidateSource,
): boolean {
  return canonicalJson(current) === canonicalJson(expected);
}

function botWakeCandidateOutboxRowByteLength(input: {
  wakeId: string;
  installationId: string;
  messageId: string;
  candidateJson: string;
  createdAt: string;
}): number {
  return (
    utf8ByteLength(input.wakeId) +
    utf8ByteLength(input.installationId) +
    utf8ByteLength(input.messageId) +
    utf8ByteLength(input.candidateJson) +
    utf8ByteLength(input.createdAt) +
    16
  );
}

function isAuthorizeBotGrantRequest(
  input: unknown,
): input is { workspaceId: string; conversationId: string; punkId: string } {
  return (
    isRecord(input) &&
    hasExactObjectKeys(input, ["workspaceId", "conversationId", "punkId"]) &&
    typeof input.workspaceId === "string" &&
    isUuid(input.workspaceId) &&
    typeof input.conversationId === "string" &&
    isUuid(input.conversationId) &&
    typeof input.punkId === "string" &&
    isUuid(input.punkId)
  );
}

function hasBotWakeCoordinates(input: Record<string, unknown>): boolean {
  return (
    typeof input.workspaceId === "string" &&
    isUuid(input.workspaceId) &&
    typeof input.conversationId === "string" &&
    isUuid(input.conversationId) &&
    typeof input.botId === "string" &&
    isOpaqueUuid(input.botId) &&
    typeof input.installationId === "string" &&
    isOpaqueUuid(input.installationId) &&
    Number.isSafeInteger(input.epoch) &&
    Number(input.epoch) >= 1
  );
}

function isBotWakeSubscriptionMutationRequest(
  input: unknown,
): input is BotWakeSubscriptionMutationRequest {
  if (!isRecord(input) || !hasBotWakeCoordinates(input)) {
    return false;
  }
  if (input.operation === "deactivate") {
    return hasExactObjectKeys(input, [
      "operation",
      "workspaceId",
      "conversationId",
      "botId",
      "installationId",
      "epoch",
    ]);
  }
  if (input.operation === "prepare") {
    return (
      hasExactObjectKeys(input, [
        "operation",
        "workspaceId",
        "conversationId",
        "botId",
        "installationId",
        "epoch",
        "preparationId",
      ]) &&
      typeof input.preparationId === "string" &&
      isUuid(input.preparationId)
    );
  }
  return (
    input.operation === "activate" &&
    hasExactObjectKeys(input, [
      "operation",
      "workspaceId",
      "conversationId",
      "botId",
      "installationId",
      "epoch",
      "preparationId",
      "highWaterCursor",
    ]) &&
    typeof input.preparationId === "string" &&
    isUuid(input.preparationId) &&
    Number.isSafeInteger(input.highWaterCursor) &&
    Number(input.highWaterCursor) >= 1
  );
}

function isAuthorizeBotWakeRequest(
  input: unknown,
): input is AuthorizeBotWakeRequest {
  return (
    isRecord(input) &&
    hasExactObjectKeys(input, [
      "workspaceId",
      "conversationId",
      "botId",
      "installationId",
      "epoch",
      "messageCursor",
    ]) &&
    hasBotWakeCoordinates(input) &&
    Number.isSafeInteger(input.messageCursor) &&
    Number(input.messageCursor) >= 1
  );
}

async function botWakeCoordinatesMatch(
  input: Pick<
    BotWakeSubscriptionMutationRequest | AuthorizeBotWakeRequest,
    "workspaceId" | "botId" | "installationId"
  >,
): Promise<boolean> {
  try {
    return (
      (await deriveBotInstallationId(input.workspaceId, input.botId)) ===
      input.installationId
    );
  } catch {
    return false;
  }
}

function isExecuteAdmittedBotReactionRequest(
  input: unknown,
): input is ExecuteAdmittedBotReactionRequest {
  return validateContract("punks://contracts/bot-action.delivery@1", input)
    .valid;
}

function parseExecuteAdmittedBotReactionRequest(
  value: string,
): ExecuteAdmittedBotReactionRequest | null {
  const parsed = parseJson(value);
  return isExecuteAdmittedBotReactionRequest(parsed) ? parsed : null;
}

function botReactionCommand(
  request: ExecuteAdmittedBotReactionRequest,
  reaction: string,
):
  | AddMessageReactionCommand
  | RemoveMessageReactionCommand
  | ToggleMessageReactionCommand {
  return {
    ...request.action,
    commandId: request.reactionCommandId,
    workspaceId: request.workspaceId,
    actor: { kind: "bot", installationId: request.installationId },
    payload: { reaction },
  } as
    | AddMessageReactionCommand
    | RemoveMessageReactionCommand
    | ToggleMessageReactionCommand;
}

function parseMessageReactionCommand(
  value: string,
):
  | AddMessageReactionCommand
  | RemoveMessageReactionCommand
  | ToggleMessageReactionCommand
  | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) {
    return null;
  }
  const contractId =
    parsed.contract === "message.reaction-add@1"
      ? "punks://contracts/message.reaction-add@1"
      : parsed.contract === "message.reaction-remove@1"
        ? "punks://contracts/message.reaction-remove@1"
        : parsed.contract === "message.reaction-toggle@1"
          ? "punks://contracts/message.reaction-toggle@1"
          : null;
  return contractId !== null && validateContract(contractId, parsed).valid
    ? (parsed as unknown as
        | AddMessageReactionCommand
        | RemoveMessageReactionCommand
        | ToggleMessageReactionCommand)
    : null;
}

function admissionFromProof(
  event: SignedNostrEvent,
): BotActionAdmission | null {
  const content = parseJson(event.content);
  if (
    !isRecord(content) ||
    !hasExactObjectKeys(content, ["schemaVersion", "admission"]) ||
    content.schemaVersion !== 1 ||
    !validateContract(
      "punks://contracts/bot-action.admission@1",
      content.admission,
    ).valid
  ) {
    return null;
  }
  return content.admission as BotActionAdmission;
}

async function proofMatchesBotReaction(
  request: ExecuteAdmittedBotReactionRequest,
  admission: BotActionAdmission,
): Promise<boolean> {
  const expectedCommandId = await deriveOpaqueUuid(
    "punks.bot-action-admit-command.v1",
    `${request.installationId}\u0000${request.actionId}`,
  );
  const admittedCommand: AdmitBotActionCommand = {
    contract: "bot-action.admit@1",
    commandId: expectedCommandId,
    actionId: request.actionId,
    workspaceId: request.workspaceId,
    installationId: request.installationId,
    actor: { kind: "bot", installationId: request.installationId },
    action: request.action,
  };
  const exactActionDigest = await deriveBotActionDigest(admittedCommand);
  const exactAdmissionId = await deriveBotActionAdmissionId(
    request.installationId,
    request.actionId,
  );
  const exactReactionCommandId = await deriveOpaqueUuid(
    "punks.bot-reaction-command.v1",
    `${request.admissionId}\u0000${request.actionId}`,
  );
  const exactCompletionCommandId = await deriveOpaqueUuid(
    "punks.bot-action-completion-command.v1",
    `${request.admissionId}\u0000succeeded`,
  );
  const exactFailureCompletionCommandId = await deriveOpaqueUuid(
    "punks.bot-action-completion-command.v1",
    `${request.admissionId}\u0000failed`,
  );
  const expectedTags = [
    ["workspace", request.workspaceId],
    ["installation", request.installationId],
    ["bot", request.botId],
    ["cursor", String(admission.admittedCursor)],
    ["command", expectedCommandId],
    ["contract", "bot-action.admit@1"],
    ["actor", "bot", request.installationId],
    ["admission", request.admissionId],
    ["action", request.actionId, request.actionDigest],
    ["action_contract", request.action.contract],
    ["capability", "messages.react"],
    ["conversation", request.action.conversationId],
    ["message", request.action.messageId],
  ];
  return (
    request.proof.kind === 50320 &&
    request.admissionId === exactAdmissionId &&
    request.reactionCommandId === exactReactionCommandId &&
    request.completionCommandId === exactCompletionCommandId &&
    request.failureCompletionCommandId === exactFailureCompletionCommandId &&
    request.actionDigest === exactActionDigest &&
    admission.actionDigest === exactActionDigest &&
    request.proof.tags.length === expectedTags.length + 1 &&
    expectedTags.every(
      (tag, index) =>
        canonicalJson(request.proof.tags[index]) === canonicalJson(tag),
    ) &&
    request.proof.tags.at(-1)?.[0] === "attestation" &&
    request.proof.content === canonicalJson({ schemaVersion: 1, admission }) &&
    admission.id === request.admissionId &&
    admission.actionId === request.actionId &&
    admission.actionDigest === request.actionDigest &&
    admission.workspaceId === request.workspaceId &&
    admission.installationId === request.installationId &&
    admission.botId === request.botId &&
    admission.authorityGeneration === request.authorityGeneration &&
    admission.actionContract === request.action.contract &&
    admission.capability === "messages.react" &&
    admission.risk === "routine" &&
    admission.resource.kind === "message" &&
    admission.resource.conversationId === request.action.conversationId &&
    admission.resource.messageId === request.action.messageId &&
    admission.installationCursor === admission.admittedCursor &&
    admission.status === "admitted" &&
    admission.outcome === null &&
    admission.completedCursor === null &&
    admission.completedAt === null &&
    Number.isFinite(Date.parse(admission.admittedAt)) &&
    Math.floor(Date.parse(admission.admittedAt) / 1_000) ===
      request.proof.created_at
  );
}

function parseMessageReaction(value: string): MessageReaction | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/message-reaction@1", parsed).valid
    ? (parsed as MessageReaction)
    : null;
}

function parseConversation(value: string): Conversation | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/conversation@1", parsed).valid
    ? (parsed as Conversation)
    : null;
}

function parseUnsignedEvent(value: string): UnsignedNostrEvent | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/nostr.unsigned-event@1", parsed)
    .valid
    ? (parsed as UnsignedNostrEvent)
    : null;
}

function completionRequest(
  request: ExecuteAdmittedBotReactionRequest,
  outcome: "succeeded" | "failed",
): CompleteBotActionRequest {
  return {
    workspaceId: request.workspaceId,
    installationId: request.installationId,
    admissionId: request.admissionId,
    actionId: request.actionId,
    actionDigest: request.actionDigest,
    outcome,
    completionCommandId:
      outcome === "succeeded"
        ? request.completionCommandId
        : request.failureCompletionCommandId,
  };
}

function parseCompleteBotActionRequest(
  value: string,
): CompleteBotActionRequest | null {
  const parsed = parseJson(value);
  if (
    !isRecord(parsed) ||
    !hasExactObjectKeys(parsed, [
      "workspaceId",
      "installationId",
      "admissionId",
      "actionId",
      "actionDigest",
      "outcome",
      "completionCommandId",
    ])
  ) {
    return null;
  }
  return isOpaqueUuid(parsed.workspaceId) &&
    isOpaqueUuid(parsed.installationId) &&
    isOpaqueUuid(parsed.admissionId) &&
    isOpaqueUuid(parsed.actionId) &&
    isOpaqueUuid(parsed.completionCommandId) &&
    typeof parsed.actionDigest === "string" &&
    /^[0-9a-f]{64}$/.test(parsed.actionDigest) &&
    (parsed.outcome === "succeeded" || parsed.outcome === "failed")
    ? (parsed as unknown as CompleteBotActionRequest)
    : null;
}

function isExactBotActionCompletionResult(
  value: unknown,
): value is CompleteBotActionResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }
  if (value.ok) {
    return (
      hasExactObjectKeys(value, ["ok", "replayed"]) &&
      typeof value.replayed === "boolean"
    );
  }
  return (
    hasExactObjectKeys(value, ["code", "ok"]) &&
    (value.code === "invalid_request" ||
      value.code === "not_found" ||
      value.code === "conflict" ||
      value.code === "command_in_progress" ||
      value.code === "attestation_failed" ||
      value.code === "temporarily_unavailable" ||
      value.code === "internal")
  );
}

function samePendingBotReaction(
  current: PendingBotReactionRow | undefined,
  expected: PendingBotReactionRow,
): boolean {
  return (
    current !== undefined &&
    current.command_id === expected.command_id &&
    current.semantic_hash === expected.semantic_hash &&
    current.reaction_id === expected.reaction_id &&
    current.request_json === expected.request_json &&
    current.command_json === expected.command_json &&
    current.command_record_json === expected.command_record_json &&
    current.unsigned_json === expected.unsigned_json &&
    current.next_reaction_json === expected.next_reaction_json &&
    current.projection_delta_json === expected.projection_delta_json &&
    current.next_conversation_json === expected.next_conversation_json
  );
}

function botReactionDomainFailure(
  error: unknown,
): ExecuteAdmittedBotReactionResult & { ok: false } {
  if (!(error instanceof MessageReactionDomainError)) {
    return botDeliveryFailure("internal");
  }
  return botDeliveryFailure(
    error.code === "idempotency_conflict"
      ? "conflict"
      : error.code === "invalid_transition"
        ? "forbidden"
        : error.code,
  );
}

function botDeliverySuccess(
  replayed: boolean,
): Extract<ExecuteAdmittedBotReactionResult, { ok: true }> {
  return {
    contract: "bot-action.delivery-result@1",
    ok: true,
    replayed,
  };
}

function botDeliveryFailure(
  code: Extract<ExecuteAdmittedBotReactionResult, { ok: false }>["code"],
): Extract<ExecuteAdmittedBotReactionResult, { ok: false }> {
  return {
    contract: "bot-action.delivery-result@1",
    ok: false,
    code,
  };
}

function renewConversationAfterMessage(
  conversation: Conversation,
  now: Date,
  cursor: number,
): Conversation {
  return {
    ...conversation,
    revision: conversation.revision + 1,
    cursor,
    updatedAt: now.toISOString(),
    ttlDeadline:
      conversation.status === "active" && conversation.ttlSeconds !== null
        ? new Date(
            now.getTime() + conversation.ttlSeconds * 1_000,
          ).toISOString()
        : conversation.ttlDeadline,
  };
}

function projectionThreadDeltas(
  deltas: readonly CommittedThreadDelta[],
): MessageProjectionMessage["threadDeltas"] {
  if (deltas.length === 0) {
    return [];
  }
  const first = deltas[0];
  if (first === undefined) {
    return [];
  }
  const second = deltas[1];
  return second === undefined ? [first] : [first, second];
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function placeholderSignedEvent(event: UnsignedNostrEvent): SignedNostrEvent {
  return {
    ...event,
    id: "0".repeat(64),
    pubkey: "0".repeat(64),
    sig: "0".repeat(128),
  };
}

function messageTerminalLiability(
  message: Pick<Message, "status"> | null,
): number {
  if (message?.status === "active") {
    return 2;
  }
  return message?.status === "retracted" ? 1 : 0;
}

function conversationTerminalLiability(
  conversation: Conversation | null,
): number {
  if (conversation?.status !== "active") {
    return 0;
  }
  return (
    1 +
    conversation.members.reduce((total, member) => {
      switch (member.access) {
        case "owner":
        case "manager":
          return total + 3;
        case "member":
          return total + 2;
        case "guest":
          return total + 1;
      }
      return total;
    }, 0)
  );
}

function nextRetryAttempt(value: string | number | null | undefined): number {
  const attempts = Number(value ?? 0);
  return Number.isSafeInteger(attempts) && attempts >= 0
    ? Math.min(MAXIMUM_RETRY_ATTEMPTS, attempts + 1)
    : MAXIMUM_RETRY_ATTEMPTS;
}

function messageReactionResultByteLength(input: {
  commandId: string;
  semanticHash: string;
  reactionId: string;
  commandRecordJson: string;
  botAdmissionId?: string;
  botActionDigest?: string;
  botOutcome?: "succeeded";
}): number {
  return [
    input.commandId,
    input.semanticHash,
    input.reactionId,
    input.commandRecordJson,
    input.botAdmissionId ?? "",
    input.botActionDigest ?? "",
    input.botOutcome ?? "",
    // ISO-8601 committed_at is always 24 ASCII bytes.
    "0000-00-00T00:00:00.000Z",
  ].reduce((total, value) => total + utf8ByteLength(value), 0);
}

function messageResultByteLength(input: {
  commandId: string;
  payloadHash: string;
  requestFingerprint: string;
  responseJson: string;
}): number {
  return [
    input.commandId,
    input.payloadHash,
    input.requestFingerprint,
    input.responseJson,
    "0000-00-00T00:00:00.000Z",
  ].reduce((total, value) => total + utf8ByteLength(value), 0);
}

function conversationResultByteLength(input: {
  commandId: string;
  payloadHash: string;
  responseJson: string;
}): number {
  return [
    input.commandId,
    input.payloadHash,
    input.responseJson,
    "0000-00-00T00:00:00.000Z",
  ].reduce((total, value) => total + utf8ByteLength(value), 0);
}

async function messageCommandFingerprint(
  command: PostMessageCommand | EditMessageCommand,
  prepared: PreparedMessageContent,
): Promise<string> {
  const {
    content: _content,
    topic: _topic,
    ...nonContentPayload
  } = command.payload;
  return sha256Hex(
    canonicalJson({
      ...command,
      payload: {
        ...nonContentPayload,
        contentCommitment: prepared.contentCommitment,
        topicPresent: prepared.topicPresent,
      },
    }),
  );
}

async function messageRequestFingerprint(
  command:
    | PostMessageCommand
    | EditMessageCommand
    | RetractMessageCommand
    | RestoreMessageCommand,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(canonicalJson(command)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function messageMutationDomainFailure(error: unknown): MessageMutationResult {
  if (error instanceof MessageDomainError) {
    return {
      ok: false,
      code:
        error.code === "idempotency_conflict"
          ? "idempotency_conflict"
          : error.code === "not_found"
            ? "not_found"
            : error.code === "forbidden"
              ? "forbidden"
              : "invalid_transition",
    };
  }
  return { ok: false, code: "internal" };
}
