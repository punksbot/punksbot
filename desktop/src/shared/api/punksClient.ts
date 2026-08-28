import type {
  MessageReactionMutationResponse,
  MessageView,
  Punk,
  PunkPublicSummary,
  PunkSearchResponse,
  PunkSummaryBatchResponse,
} from "@punks/contracts";
import { TauriPunksAccountClient } from "./punksTauriClient";
import { createFakeGovernanceAuthority } from "./punksFakeGovernance";
import { createFakeFollow } from "./punksFakeFollow";
import { createFakeMessageSearch } from "./punksFakeMessageSearch";
import { createFakePresence } from "./punksFakePresence";
import type {
  AccountSessionStateView,
  CeremonyPhaseView,
} from "./punksAuthentication";
import { PunksDesktopFailure } from "./punksFailure";
import type {
  FakePunksClientSeed,
  PunksAccountClient,
  WorkspaceOwnershipTransferReauthenticationInput,
  WorkspaceLease,
} from "./punksClientTypes";
import { canonicalPunksReaction } from "./punksReaction";
import { resolveWorkspaceIdentity } from "./punksWorkspaceIdentity";

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
export type * from "./punksClientTypes";

/** Creates the packaged desktop implementation; raw Tauri invocation stays private. */
export function createTauriPunksAccountClient(): PunksAccountClient {
  return new TauriPunksAccountClient();
}
function assertAuthenticationMethod(method: unknown): void {
  if (method !== "google" && method !== "github") {
    throw new PunksDesktopFailure(
      "contract_violation",
      "Authentication method is not supported",
    );
  }
}

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
  let pendingReauthorizationPurpose: string | null = null;
  let pendingOwnershipTransferReauthorization: WorkspaceOwnershipTransferReauthenticationInput | null =
    null;
  let profile: Punk = structuredClone(
    seed.profile ?? {
      id: seed.session.punkId,
      status: "active",
      displayName: seed.session.punk.displayName,
      avatarUrl: seed.session.punk.avatarUrl,
      identities: [
        {
          provider: "google",
          subjectHash: "a".repeat(64),
          emailHash: "b".repeat(64),
          verifiedEmail: "fake-punk@example.test",
          username: null,
          credentialId: null,
          linkedAt: seed.session.authenticatedAt,
        },
      ],
      mergedInto: null,
      revision: 1,
      createdAt: seed.session.authenticatedAt,
      updatedAt: seed.session.authenticatedAt,
    },
  );
  let punkSummaries: PunkPublicSummary[] = structuredClone(
    seed.punkSummaries ?? [
      {
        punkId: profile.id,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
      },
    ],
  );
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
  const governance = createFakeGovernanceAuthority(
    seed,
    assertCapability,
    assertCurrent,
    (lease, input) => {
      if (
        pendingReauthorizationPurpose !== "transfer_workspace_ownership" ||
        pendingOwnershipTransferReauthorization?.workspaceId !==
          lease.workspaceId ||
        pendingOwnershipTransferReauthorization.targetPunkId !==
          input.targetPunkId ||
        pendingOwnershipTransferReauthorization.expectedRevision !==
          input.expectedRevision
      ) {
        throw new PunksDesktopFailure(
          "problem",
          "A fresh ownership-transfer reauthorization is required",
        );
      }
      pendingReauthorizationPurpose = null;
      pendingOwnershipTransferReauthorization = null;
    },
    (lease) => {
      assertCurrent(lease);
      activeLease = null;
      generation += 1;
    },
  );

  const account: PunksAccountClient = {
    ...governance.account,
    async checkCompatibility() {
      compatible = seed.compatibility.compatible;
      return structuredClone(seed.compatibility);
    },
    async getAccountSessionState() {
      assertCompatible();
      if (
        pendingReauthorizationPurpose !== null &&
        accountSessionState.authentication.phase === "started" &&
        accountSessionState.authentication.intent === "reauthenticate"
      ) {
        ceremonyPhase = {
          phase: "confirmed",
          sessionId: seed.session.sessionId,
        };
        accountSessionState = {
          ...accountSessionState,
          authentication: ceremonyPhase,
        };
      }
      return structuredClone(accountSessionState);
    },
    async getPunkProfile() {
      assertCompatible();
      assertCapability("identity-governance");
      return structuredClone(profile);
    },
    async updatePunkProfile(input) {
      assertCompatible();
      assertCapability("identity-governance");
      if (input.expectedRevision !== profile.revision) {
        throw new PunksDesktopFailure(
          "problem",
          "Punk profile revision changed",
          { code: "revision_conflict" },
        );
      }
      const displayName = input.displayName.trim().normalize("NFC");
      if (displayName.length === 0) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Punk display name is invalid",
        );
      }
      profile = {
        ...profile,
        displayName,
        avatarUrl: input.avatarUrl,
        revision: profile.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      punkSummaries = punkSummaries.map((summary) =>
        summary.punkId === profile.id
          ? {
              punkId: profile.id,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            }
          : summary,
      );
      if (accountSessionState.state === "authenticated") {
        accountSessionState = {
          ...accountSessionState,
          session: {
            ...accountSessionState.session,
            punk: {
              id: profile.id,
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            },
          },
        };
      }
      return structuredClone(profile);
    },
    async startSignIn(provider) {
      assertCompatible();
      assertAuthenticationMethod(provider);
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
      assertAuthenticationMethod(provider);
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
    async startReauthentication(method, purpose, workspaceOwnershipTransfer) {
      assertCompatible();
      assertAuthenticationMethod(method);
      if (purpose === "register_passkey")
        throw new PunksDesktopFailure(
          "contract_violation",
          "Authentication purpose is not supported",
        );
      if (
        (purpose === "transfer_workspace_ownership") !==
        (workspaceOwnershipTransfer !== undefined)
      ) {
        throw new PunksDesktopFailure(
          "problem",
          "Ownership reauthentication requires its exact target",
        );
      }
      pendingReauthorizationPurpose = purpose;
      pendingOwnershipTransferReauthorization =
        workspaceOwnershipTransfer === undefined
          ? null
          : structuredClone(workspaceOwnershipTransfer);
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
      assertAuthenticationMethod(provider);
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
      pendingReauthorizationPurpose = null;
      pendingOwnershipTransferReauthorization = null;
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
      pendingReauthorizationPurpose = null;
      pendingOwnershipTransferReauthorization = null;
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
      const searchMessages = createFakeMessageSearch({
        seed,
        streams,
        lease,
        workspaceId,
        assertCapability,
        assertCurrent,
      });
      return {
        lease,
        ...governance.workspace(lease),
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
        searchMessages,
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
        async getPunkSummaries(punkIds) {
          assertCapability("identity-governance");
          assertCurrent(lease);
          const requested = new Set(punkIds);
          return {
            contract: "punk.summary-batch-response@1" as const,
            workspaceId,
            items: structuredClone(
              punkSummaries.filter((summary) => requested.has(summary.punkId)),
            ) as PunkSummaryBatchResponse["items"],
          };
        },
        async searchPunks(input) {
          assertCapability("identity-governance");
          assertCurrent(lease);
          const query = input.query;
          const matches =
            query.kind === "punk_id"
              ? punkSummaries.filter(
                  (summary) => summary.punkId === query.punkId,
                )
              : punkSummaries.filter((summary) =>
                  summary.displayName
                    .normalize("NFKC")
                    .toLocaleLowerCase("en-US")
                    .startsWith(
                      query.value
                        .trim()
                        .normalize("NFKC")
                        .toLocaleLowerCase("en-US"),
                    ),
                );
          assertCurrent(lease);
          return {
            contract: "punk.search-response@1" as const,
            workspaceId,
            items: structuredClone(
              matches.slice(0, input.limit),
            ) as PunkSearchResponse["items"],
            nextCursor: null,
          };
        },
        async followConversation(conversationId, afterCursor) {
          return createFakeFollow({
            conversationId,
            afterCursor,
            streams,
            messages: seed.messages[conversationId] ?? [],
            configuredFrames: seed.followFrames?.[conversationId],
            assertCurrent: () => assertCurrent(lease),
          });
        },
        async holdPresence() {
          return createFakePresence({
            lease,
            punkId: seed.session.punkId,
            assertCapability: () => assertCapability("presence"),
            assertCurrent: () => assertCurrent(lease),
          });
        },
        async postMessage({ conversationId, content, topic, replyTarget }) {
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
          const parent = replyTarget
            ? messages.find((message) => message.id === replyTarget.messageId)
            : undefined;
          if (
            replyTarget !== undefined &&
            (parent?.status !== "active" ||
              parent.threadRootMessageId !== replyTarget.threadRootMessageId ||
              parent.threadDepth !== replyTarget.threadDepth)
          ) {
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
            replyTarget === undefined &&
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
            parentMessageId: replyTarget?.messageId ?? null,
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
