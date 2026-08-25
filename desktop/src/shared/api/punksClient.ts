import {
  confirmFollowBatch,
  createFollowState,
  reduceFollowFrame,
  type FollowState,
} from "@punks/client/follow-reducer";
import type {
  AuthSession,
  ConversationFollowServerFrame,
  ConversationSummary,
  ConversationView,
  DesktopCompatibilityResponse,
  MessageHistoryResponse,
  MessageReactionMutationResponse,
  MessageView,
  ResolveAuthorsQuery,
  ResolveAuthorsResponse,
  WorkspaceSummary,
} from "@punks/contracts";
import { TauriPunksAccountClient } from "./punksTauriClient";
import type {
  AccountSessionStateView,
  AuthenticationMethod,
  CeremonyPhaseView,
  IdentityLinkProvider,
} from "./punksAuthentication";
import { PunksDesktopFailure } from "./punksFailure";
import { canonicalPunksReaction } from "./punksReaction";
import {
  resolveWorkspaceIdentity,
  type WorkspaceIdentity,
} from "./punksWorkspaceIdentity";

export { PunksDesktopFailure } from "./punksFailure";
export type { PunksFailureKind } from "./punksFailure";
export type {
  AccountSessionStateView,
  AuthenticationIntent,
  AuthenticationMethod,
  CeremonyPhaseView,
  IdentityLinkProvider,
} from "./punksAuthentication";
export type { WorkspaceIdentity } from "./punksWorkspaceIdentity";

export type WorkspaceLease = {
  origin: string;
  punkId: string;
  workspaceId: string;
  generation: number;
};

export type MessagePageInput = {
  conversationId: string;
  limit?: number;
  cursor?: string;
};

export type ThreadPageInput = MessagePageInput & {
  threadRootMessageId: string;
};

export type PostTextInput = {
  conversationId: string;
  content: string;
  topic?: string | null;
  replyToMessageId?: string;
};

export type EditMessageInput = {
  conversationId: string;
  messageId: string;
  content: string;
  topic?: string | null;
};

export type RetractMessageInput = {
  conversationId: string;
  messageId: string;
  reasonCode?: string | null;
  publicReason?: string | null;
};

export type RestoreMessageInput = {
  conversationId: string;
  messageId: string;
};

export type ReactionInput = {
  conversationId: string;
  messageId: string;
  reaction: string;
};

export type PunksNavigationTarget = {
  kind: "home" | "workspace" | "conversation" | "message";
  path: string;
};

type ChangesFrame = Extract<ConversationFollowServerFrame, { type: "changes" }>;

export type PunksFollowDelivery =
  | { kind: "apply_batch"; frame: ChangesFrame }
  | { kind: "became_live" }
  | {
      kind: "resync";
      reason:
        | "cursor_gap"
        | "cursor_divergence"
        | "protocol_violation"
        | "history_required"
        | "slow_consumer";
      afterCursor: number;
      highWaterCursor: number;
    }
  | { kind: "terminal"; reason: "archived"; cursor: number };

export interface PunksFollow {
  nextDelivery(): Promise<PunksFollowDelivery>;
  confirmBatch(throughCursor: number): Promise<void>;
  close(): Promise<void>;
}

export interface PunksWorkspaceSession {
  readonly lease: WorkspaceLease;
  close(): Promise<void>;
  listStreams(): Promise<ConversationSummary[]>;
  getStream(conversationId: string): Promise<ConversationView>;
  getTimeline(input: MessagePageInput): Promise<MessageHistoryResponse>;
  getThread(input: ThreadPageInput): Promise<MessageHistoryResponse>;
  resolveAuthors(
    authors: ResolveAuthorsQuery["authors"],
  ): Promise<ResolveAuthorsResponse["authors"]>;
  followConversation(
    conversationId: string,
    afterCursor: number,
  ): Promise<PunksFollow>;
  postMessage(input: PostTextInput): Promise<MessageView>;
  editMessage(input: EditMessageInput): Promise<MessageView>;
  retractMessage(input: RetractMessageInput): Promise<MessageView>;
  restoreMessage(input: RestoreMessageInput): Promise<MessageView>;
  addReaction(input: ReactionInput): Promise<MessageReactionMutationResponse>;
  removeReaction(
    input: ReactionInput,
  ): Promise<MessageReactionMutationResponse>;
}

export interface PunksAccountClient {
  checkCompatibility(): Promise<DesktopCompatibilityResponse>;
  getAccountSessionState(): Promise<AccountSessionStateView>;
  startSignIn(provider: AuthenticationMethod): Promise<CeremonyPhaseView>;
  startAccountSwitch(
    provider: AuthenticationMethod,
  ): Promise<CeremonyPhaseView>;
  startReauthentication(
    method: AuthenticationMethod,
    purpose: string,
  ): Promise<CeremonyPhaseView>;
  startIdentityLink(provider: IdentityLinkProvider): Promise<CeremonyPhaseView>;
  startPasskeyRegistration(): Promise<CeremonyPhaseView>;
  resumeInterruptedAuthentication(): Promise<CeremonyPhaseView>;
  cancelAuthentication(): Promise<CeremonyPhaseView>;
  renewAccountSession(): Promise<CeremonyPhaseView>;
  signOut(): Promise<"revoked" | "queued">;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  resolveWorkspace(
    identity: WorkspaceIdentity,
  ): Promise<WorkspaceSummary | null>;
  openWorkspace(workspaceId: string): Promise<PunksWorkspaceSession>;
  /** Native envelope validation; test clients may omit this boundary. */
  validateNavigation?(url: string): Promise<PunksNavigationTarget>;
}

/** Creates the packaged desktop implementation; raw Tauri invocation stays private. */
export function createTauriPunksAccountClient(): PunksAccountClient {
  return new TauriPunksAccountClient();
}

export type FakePunksClientSeed = {
  compatibility: DesktopCompatibilityResponse;
  session: AuthSession;
  accountSessionState?: AccountSessionStateView;
  workspaces: WorkspaceSummary[];
  streams: Record<string, ConversationSummary[]>;
  messages: Record<string, MessageView[]>;
  followFrames?: Record<string, ConversationFollowServerFrame[]>;
};

/** Deterministic adapter implementing the same semantic interface as Rust. */
export function createFakePunksAccountClient(
  input: FakePunksClientSeed,
): PunksAccountClient {
  const seed = structuredClone(input);
  let ceremonyPhase: CeremonyPhaseView = { phase: "idle" };
  let accountSessionState: AccountSessionStateView = structuredClone(
    seed.accountSessionState ?? {
      state: "authenticated",
      session: seed.session,
      authentication: ceremonyPhase,
      resumeAvailable: false,
    },
  );
  let compatible = false;
  let generation = 0;
  let activeLease: WorkspaceLease | null = null;
  const reactionViews = new Map<
    string,
    NonNullable<MessageReactionMutationResponse["reaction"]>
  >();
  const retractedMessageBodies = new Map<
    string,
    { content: string | null; topic: string | null }
  >();

  const assertCompatible = () => {
    if (!compatible) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "desktop-social-loop@1 compatibility must be confirmed first",
      );
    }
  };
  const assertCapability = (capability: string) => {
    if (!seed.compatibility.capabilities.includes(capability)) {
      throw new PunksDesktopFailure(
        "contract_violation",
        `Punks capability ${capability} is not available`,
      );
    }
  };
  const assertCurrent = (lease: WorkspaceLease) => {
    if (
      activeLease === null ||
      activeLease.origin !== lease.origin ||
      activeLease.punkId !== lease.punkId ||
      activeLease.workspaceId !== lease.workspaceId ||
      activeLease.generation !== lease.generation
    ) {
      throw new PunksDesktopFailure(
        "stale_workspace",
        "WorkspaceSession lease is no longer current",
      );
    }
  };

  const account: PunksAccountClient = {
    async checkCompatibility() {
      compatible = seed.compatibility.compatible;
      return structuredClone(seed.compatibility);
    },
    async getAccountSessionState() {
      assertCompatible();
      return structuredClone(accountSessionState);
    },
    async startSignIn(provider) {
      assertCompatible();
      if (accountSessionState.state !== "signed_out") {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Sign-in requires a signed-out Account client",
        );
      }
      ceremonyPhase = {
        phase: "started",
        intent: "sign_in",
        method: provider,
      };
      accountSessionState = {
        ...accountSessionState,
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return structuredClone(ceremonyPhase);
    },
    async startAccountSwitch(provider) {
      assertCompatible();
      ceremonyPhase = {
        phase: "started",
        intent: "switch_account",
        method: provider,
      };
      accountSessionState = {
        ...accountSessionState,
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return structuredClone(ceremonyPhase);
    },
    async startReauthentication(method, _purpose) {
      assertCompatible();
      ceremonyPhase = {
        phase: "started",
        intent: "reauthenticate",
        method,
      };
      accountSessionState = {
        ...accountSessionState,
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return structuredClone(ceremonyPhase);
    },
    async startIdentityLink(provider) {
      assertCompatible();
      ceremonyPhase = {
        phase: "started",
        intent: provider === "google" ? "link_google" : "link_github",
        method: provider,
      };
      accountSessionState = {
        ...accountSessionState,
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return structuredClone(ceremonyPhase);
    },
    async startPasskeyRegistration() {
      assertCompatible();
      ceremonyPhase = {
        phase: "started",
        intent: "register_passkey",
        method: "passkey",
      };
      accountSessionState = {
        ...accountSessionState,
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return structuredClone(ceremonyPhase);
    },
    async resumeInterruptedAuthentication() {
      assertCompatible();
      if (!accountSessionState.resumeAvailable) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "No interrupted desktop authentication can be resumed",
        );
      }
      accountSessionState = {
        ...accountSessionState,
        resumeAvailable: false,
      };
      return structuredClone(accountSessionState.authentication);
    },
    async cancelAuthentication() {
      assertCompatible();
      ceremonyPhase = { phase: "cancelled" };
      accountSessionState = {
        ...accountSessionState,
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return structuredClone(ceremonyPhase);
    },
    async renewAccountSession() {
      assertCompatible();
      return structuredClone(accountSessionState.authentication);
    },
    async signOut() {
      assertCompatible();
      ceremonyPhase = { phase: "idle" };
      accountSessionState = {
        state: "signed_out",
        authentication: ceremonyPhase,
        resumeAvailable: false,
      };
      return "revoked" as const;
    },
    async listWorkspaces() {
      assertCompatible();
      return structuredClone(seed.workspaces);
    },
    async resolveWorkspace(identity) {
      assertCompatible();
      const workspace = resolveWorkspaceIdentity(seed.workspaces, identity);
      return workspace === undefined ? null : structuredClone(workspace);
    },
    async openWorkspace(workspaceId) {
      assertCompatible();
      const workspace = seed.workspaces.find(
        (candidate) => candidate.id === workspaceId,
      );
      if (!workspace) {
        throw new PunksDesktopFailure("problem", "Workspace is not accessible");
      }
      generation += 1;
      const lease: WorkspaceLease = {
        origin: seed.compatibility.origin,
        punkId: seed.session.punkId,
        workspaceId,
        generation,
      };
      activeLease = lease;
      const streams = seed.streams[workspaceId] ?? [];
      const historyCursors = new Map<
        string,
        { scope: string; offset: number }
      >();
      const historyOffset = (
        cursor: string | undefined,
        scope: string,
        total: number,
      ) => {
        if (cursor === undefined) return total;
        const continuation = historyCursors.get(cursor);
        if (continuation?.scope !== scope) {
          throw new PunksDesktopFailure(
            "contract_violation",
            "Message history cursor is invalid for this scope",
          );
        }
        return continuation.offset;
      };
      const historyCursor = (scope: string, offset: number) => {
        const payload = `${scope.replaceAll("-", "")}_${offset}`;
        const cursor = `mhc1.${payload}.${"A".repeat(43)}`;
        historyCursors.set(cursor, { scope, offset });
        return cursor;
      };
      return {
        lease,
        async close() {
          assertCurrent(lease);
          activeLease = null;
          generation += 1;
        },
        async listStreams() {
          assertCurrent(lease);
          return structuredClone(streams);
        },
        async getStream(conversationId) {
          assertCurrent(lease);
          const stream = streams.find((item) => item.id === conversationId);
          if (!stream) {
            throw new PunksDesktopFailure(
              "problem",
              "Stream is not accessible",
            );
          }
          return {
            ...structuredClone(stream),
            maxMembers: null,
            status: "active",
            createdAt: stream.updatedAt,
            archivedAt: null,
          };
        },
        async getTimeline({ conversationId, limit, cursor }) {
          assertCurrent(lease);
          const stream = streams.find((item) => item.id === conversationId);
          if (!stream) {
            throw new PunksDesktopFailure(
              "problem",
              "Stream is not accessible",
            );
          }
          const all = seed.messages[conversationId] ?? [];
          const size = limit ?? 50;
          const end = historyOffset(cursor, conversationId, all.length);
          const start = Math.max(0, end - size);
          const items = all.slice(start, end);
          assertCurrent(lease);
          return {
            workspaceId,
            conversationId,
            highWaterCursor: Math.max(
              1,
              stream.cursor,
              all.at(-1)?.cursor ?? 0,
            ),
            order: "createdCursor-ascending",
            items: structuredClone(items),
            nextCursor: start > 0 ? historyCursor(conversationId, start) : null,
          };
        },
        async getThread(input) {
          assertCurrent(lease);
          const stream = streams.find(
            (item) => item.id === input.conversationId,
          );
          if (!stream) {
            throw new PunksDesktopFailure(
              "problem",
              "Stream is not accessible",
            );
          }
          const all = (seed.messages[input.conversationId] ?? []).filter(
            (message) =>
              message.threadRootMessageId === input.threadRootMessageId,
          );
          const scope = `${input.conversationId}_${input.threadRootMessageId}`;
          const size = input.limit ?? 50;
          const end = historyOffset(input.cursor, scope, all.length);
          const start = Math.max(0, end - size);
          const items = all.slice(start, end);
          assertCurrent(lease);
          return {
            workspaceId,
            conversationId: input.conversationId,
            highWaterCursor: Math.max(
              1,
              stream.cursor,
              all.at(-1)?.cursor ?? 0,
            ),
            order: "createdCursor-ascending",
            items: structuredClone(items),
            nextCursor: start > 0 ? historyCursor(scope, start) : null,
          };
        },
        async resolveAuthors(authors) {
          assertCurrent(lease);
          return authors.flatMap((author) =>
            author.kind === "punk" && author.punkId === seed.session.punkId
              ? [
                  {
                    kind: "punk" as const,
                    punkId: seed.session.punkId,
                    displayName: seed.session.punk.displayName,
                    avatarUrl: seed.session.punk.avatarUrl,
                  },
                ]
              : [],
          );
        },
        async followConversation(conversationId, afterCursor) {
          assertCurrent(lease);
          const stream = streams.find((item) => item.id === conversationId);
          if (stream === undefined) {
            throw new PunksDesktopFailure(
              "problem",
              "Stream is not accessible",
            );
          }
          const configuredFrames = seed.followFrames?.[conversationId];
          const highWaterCursor = Math.max(
            afterCursor,
            stream.cursor,
            seed.messages[conversationId]?.at(-1)?.cursor ?? 0,
          );
          const pendingMessages = (seed.messages[conversationId] ?? [])
            .filter(
              (message) =>
                message.cursor > afterCursor &&
                message.cursor <= highWaterCursor,
            )
            .sort((left, right) => left.cursor - right.cursor);
          const defaultChanges: ConversationFollowServerFrame[] = [];
          let changesFrom = afterCursor;
          for (let index = 0; index < pendingMessages.length; index += 100) {
            const messages = pendingMessages.slice(index, index + 100);
            const throughCursor = messages.at(-1)?.cursor ?? changesFrom;
            if (throughCursor <= changesFrom) continue;
            defaultChanges.push({
              schemaVersion: 1,
              type: "changes",
              fromExclusiveCursor: changesFrom,
              throughCursor,
              messages,
              threadPatches: [],
              reactionPatches: [],
              reactionCollectionPatches: [],
            });
            changesFrom = throughCursor;
          }
          if (changesFrom < highWaterCursor) {
            defaultChanges.push({
              schemaVersion: 1,
              type: "changes",
              fromExclusiveCursor: changesFrom,
              throughCursor: highWaterCursor,
              messages: [],
              threadPatches: [],
              reactionPatches: [],
              reactionCollectionPatches: [],
            });
          }
          const frames = structuredClone(
            configuredFrames ?? [
              {
                schemaVersion: 1 as const,
                type: "accepted" as const,
                resumeAfterCursor: afterCursor,
                targetHighWaterCursor: highWaterCursor,
              },
              ...defaultChanges,
              {
                schemaVersion: 1 as const,
                type: "ready" as const,
                highWaterCursor,
              },
            ],
          );
          let state: FollowState = createFollowState(afterCursor);
          let closed = false;
          return {
            async nextDelivery() {
              assertCurrent(lease);
              if (closed) {
                throw new PunksDesktopFailure(
                  "cancelled",
                  "Punks FOLLOW operation is closed",
                );
              }
              while (frames.length > 0) {
                const frame = frames.shift();
                if (frame === undefined) break;
                const reduction = reduceFollowFrame(state, frame);
                state = reduction.state;
                assertCurrent(lease);
                if (reduction.effect.kind === "none") continue;
                if (reduction.effect.kind === "apply_batch") {
                  return {
                    kind: "apply_batch" as const,
                    frame: reduction.effect.frame,
                  };
                }
                if (reduction.effect.kind === "became_live") {
                  return { kind: "became_live" as const };
                }
                if (reduction.effect.kind === "resync") {
                  return {
                    kind: "resync" as const,
                    reason: reduction.effect.reason,
                    afterCursor: reduction.effect.afterCursor,
                    highWaterCursor: reduction.effect.highWaterCursor,
                  };
                }
                return {
                  kind: "terminal" as const,
                  reason: reduction.effect.reason,
                  cursor: reduction.effect.cursor,
                };
              }
              throw new PunksDesktopFailure(
                "transport",
                "Punks FOLLOW fixture has no more frames",
              );
            },
            async confirmBatch(throughCursor) {
              assertCurrent(lease);
              const confirmation = confirmFollowBatch(state, throughCursor);
              state = confirmation.state;
              if (confirmation.ack === null) {
                throw new PunksDesktopFailure(
                  "contract_violation",
                  "Punks FOLLOW confirmation is invalid",
                );
              }
            },
            async close() {
              closed = true;
            },
          };
        },
        async postMessage({
          conversationId,
          content,
          topic,
          replyToMessageId,
        }) {
          assertCapability("message-post");
          assertCurrent(lease);
          if (content.trim().length === 0) {
            throw new PunksDesktopFailure(
              "contract_violation",
              "Message content must not be empty",
            );
          }
          let messages = seed.messages[conversationId];
          if (messages === undefined) {
            messages = [];
            seed.messages[conversationId] = messages;
          }
          const parent = replyToMessageId
            ? messages.find((message) => message.id === replyToMessageId)
            : undefined;
          if (replyToMessageId !== undefined && parent?.status !== "active") {
            throw new PunksDesktopFailure(
              "problem",
              "Reply target is unavailable",
            );
          }
          const id = crypto.randomUUID();
          const root = parent?.threadRootMessageId ?? id;
          const cursor = (messages.at(-1)?.cursor ?? 0) + 1;
          const stream = streams.find((item) => item.id === conversationId);
          if (
            stream?.topicRequired === true &&
            replyToMessageId === undefined &&
            (topic === undefined || topic === null || topic.trim().length === 0)
          ) {
            throw new PunksDesktopFailure(
              "problem",
              "A subject is required for this Stream",
            );
          }
          const timestamp = new Date().toISOString();
          const message: MessageView = {
            id,
            workspaceId,
            conversationId,
            author: { kind: "punk", punkId: seed.session.punkId },
            messageType: "stream-message",
            status: "active",
            content,
            topic: topic?.trim() || null,
            mentionedPunkIds: [],
            mediaIds: [],
            parentMessageId: replyToMessageId ?? null,
            threadRootMessageId: root,
            threadDepth: parent === undefined ? 0 : parent.threadDepth + 1,
            broadcast: false,
            replyCount: 0,
            descendantCount: 0,
            lastReplyAt: null,
            currentVersion: 1,
            retractionKind: null,
            retractedAt: null,
            eraseAfter: null,
            publicReason: null,
            erasedAt: null,
            revision: 1,
            createdCursor: cursor,
            cursor,
            createdAt: timestamp,
            updatedAt: timestamp,
            editedAt: null,
          };
          messages.push(message);
          if (stream !== undefined)
            stream.cursor = Math.max(stream.cursor, cursor);
          assertCurrent(lease);
          return structuredClone(message);
        },
        async editMessage(input) {
          assertCapability("message-lifecycle");
          assertCurrent(lease);
          const messages = seed.messages[input.conversationId] ?? [];
          const message = messages.find(
            (candidate) => candidate.id === input.messageId,
          );
          if (message === undefined) {
            throw new PunksDesktopFailure(
              "problem",
              "Message is not accessible",
            );
          }
          if (
            message.author.kind !== "punk" ||
            message.author.punkId !== seed.session.punkId
          ) {
            throw new PunksDesktopFailure(
              "problem",
              "Only the author can edit this Message",
            );
          }
          if (message.status !== "active") {
            throw new PunksDesktopFailure(
              "problem",
              "Retracted Messages cannot be edited",
            );
          }
          const stream = streams.find(
            (item) => item.id === input.conversationId,
          );
          if (
            stream?.topicRequired === true &&
            message.parentMessageId === null &&
            (input.topic === undefined ||
              input.topic === null ||
              input.topic.trim().length === 0)
          ) {
            throw new PunksDesktopFailure(
              "problem",
              "A subject is required for this Stream",
            );
          }
          if (input.content.trim().length === 0) {
            throw new PunksDesktopFailure(
              "contract_violation",
              "Message content must not be empty",
            );
          }
          const timestamp = new Date().toISOString();
          message.content = input.content;
          message.topic = input.topic?.trim() || null;
          message.revision += 1;
          message.currentVersion = (message.currentVersion ?? 0) + 1;
          message.editedAt = timestamp;
          message.updatedAt = timestamp;
          message.cursor = (messages.at(-1)?.cursor ?? message.cursor) + 1;
          if (stream !== undefined)
            stream.cursor = Math.max(stream.cursor, message.cursor);
          assertCurrent(lease);
          return structuredClone(message);
        },
        async retractMessage(input) {
          assertCapability("message-lifecycle");
          assertCurrent(lease);
          const messages = seed.messages[input.conversationId] ?? [];
          const message = messages.find(
            (candidate) => candidate.id === input.messageId,
          );
          if (message === undefined) {
            throw new PunksDesktopFailure(
              "problem",
              "Message is not accessible",
            );
          }
          const canModerate =
            workspace.role === "owner" || workspace.role === "moderator";
          const isAuthor =
            message.author.kind === "punk" &&
            message.author.punkId === seed.session.punkId;
          if (!isAuthor && !canModerate) {
            throw new PunksDesktopFailure(
              "problem",
              "The Punk cannot retract this Message",
            );
          }
          if (message.status === "erased") {
            throw new PunksDesktopFailure(
              "problem",
              "Erased Messages cannot be retracted",
            );
          }
          if (message.status === "retracted") {
            throw new PunksDesktopFailure(
              "problem",
              "Message is already retracted",
            );
          }
          if (message.status === "active") {
            retractedMessageBodies.set(message.id, {
              content: message.content,
              topic: message.topic,
            });
            const timestamp = new Date().toISOString();
            message.status = "retracted";
            message.content = null;
            message.topic = null;
            message.retractionKind = isAuthor ? "author" : "moderation";
            message.retractedAt = timestamp;
            message.eraseAfter = new Date(
              Date.now() + 7 * 24 * 60 * 60 * 1000,
            ).toISOString();
            message.publicReason = input.publicReason ?? null;
            message.revision += 1;
            message.cursor = (messages.at(-1)?.cursor ?? message.cursor) + 1;
            message.updatedAt = timestamp;
            const stream = streams.find(
              (item) => item.id === input.conversationId,
            );
            if (stream !== undefined)
              stream.cursor = Math.max(stream.cursor, message.cursor);
          }
          assertCurrent(lease);
          return structuredClone(message);
        },
        async restoreMessage(input) {
          assertCapability("message-lifecycle");
          assertCurrent(lease);
          const messages = seed.messages[input.conversationId] ?? [];
          const message = messages.find(
            (candidate) => candidate.id === input.messageId,
          );
          if (message === undefined) {
            throw new PunksDesktopFailure(
              "problem",
              "Message is not accessible",
            );
          }
          const canModerate =
            workspace.role === "owner" || workspace.role === "moderator";
          const isAuthor =
            message.author.kind === "punk" &&
            message.author.punkId === seed.session.punkId;
          const canRestore =
            message.retractionKind === "moderation"
              ? canModerate
              : message.retractionKind === "author"
                ? isAuthor
                : false;
          if (!canRestore) {
            throw new PunksDesktopFailure(
              "problem",
              "The Punk cannot restore this type of Message retraction",
            );
          }
          if (message.status !== "retracted") {
            return structuredClone(message);
          }
          if (
            message.eraseAfter !== null &&
            Date.parse(message.eraseAfter) <= Date.now()
          ) {
            throw new PunksDesktopFailure(
              "problem",
              "The Message restoration grace period has expired",
            );
          }
          const original = retractedMessageBodies.get(message.id);
          if (original === undefined) {
            throw new PunksDesktopFailure(
              "problem",
              "The original Message version is unavailable",
            );
          }
          const timestamp = new Date().toISOString();
          message.status = "active";
          message.content = original.content;
          message.topic = original.topic;
          message.retractionKind = null;
          message.retractedAt = null;
          message.eraseAfter = null;
          message.publicReason = null;
          message.revision += 1;
          message.cursor = (messages.at(-1)?.cursor ?? message.cursor) + 1;
          message.updatedAt = timestamp;
          const stream = streams.find(
            (item) => item.id === input.conversationId,
          );
          if (stream !== undefined)
            stream.cursor = Math.max(stream.cursor, message.cursor);
          assertCurrent(lease);
          return structuredClone(message);
        },
        async addReaction(input) {
          assertCapability("unicode-reactions");
          assertCurrent(lease);
          const canonicalReaction = canonicalPunksReaction(input.reaction);
          const messages = seed.messages[input.conversationId] ?? [];
          const message = messages.find(
            (candidate) => candidate.id === input.messageId,
          );
          if (message?.status !== "active") {
            throw new PunksDesktopFailure(
              "problem",
              "Reaction target is unavailable",
            );
          }
          const key = `${workspaceId}:${input.conversationId}:${input.messageId}:${canonicalReaction}`;
          const existing = reactionViews.get(key);
          if (existing !== undefined) {
            return {
              reaction: structuredClone(existing),
              effect: "unchanged" as const,
              replayed: false,
            };
          }
          const view = {
            id: crypto.randomUUID(),
            workspaceId,
            conversationId: input.conversationId,
            messageId: input.messageId,
            actor: { kind: "punk" as const, punkId: seed.session.punkId },
            reaction: canonicalReaction,
            reactedAt: new Date().toISOString(),
          };
          reactionViews.set(key, view);
          assertCurrent(lease);
          return {
            reaction: structuredClone(view),
            effect: "added" as const,
            replayed: false,
          };
        },
        async removeReaction(input) {
          assertCapability("unicode-reactions");
          assertCurrent(lease);
          const canonicalReaction = canonicalPunksReaction(input.reaction);
          const key = `${workspaceId}:${input.conversationId}:${input.messageId}:${canonicalReaction}`;
          const messages = seed.messages[input.conversationId] ?? [];
          const message = messages.find(
            (candidate) => candidate.id === input.messageId,
          );
          if (message?.status !== "active") {
            throw new PunksDesktopFailure(
              "problem",
              "Reaction target is unavailable",
            );
          }
          const existing = reactionViews.get(key);
          reactionViews.delete(key);
          assertCurrent(lease);
          return {
            reaction: null,
            effect:
              existing === undefined
                ? ("unchanged" as const)
                : ("removed" as const),
            replayed: false,
          };
        },
      };
    },
  };
  return account;
}
