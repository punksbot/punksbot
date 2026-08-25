import { validateContract } from "@punks/contracts";
import type {
  CancellableOperation,
  HttpPunksAccountClientOptions,
  PunksAccountClient,
  WorkspaceLease,
  WorkspaceTimelineOptions,
} from "./account-types";
import {
  acceptNextDirectoryCursor,
  resolveAuthorsOperation,
} from "./account-operations";
import {
  classifyObservedInterruption,
  clientProblem,
  PunksClientError,
} from "./client-error";

export {
  confirmFollowBatch,
  createFollowState,
  reduceFollowFrame,
} from "./follow-reducer";
export type {
  FollowConfirmation,
  FollowEffect,
  FollowPhase,
  FollowReduction,
  FollowState,
} from "./follow-reducer";
export type {
  CancellableOperation,
  HttpPunksAccountClientOptions,
  PunksAccountClient,
  WorkspaceIdentity,
  WorkspaceLease,
  WorkspaceSession,
  WorkspaceThreadOptions,
  WorkspaceTimelineOptions,
} from "./account-types";
export { PunksClientError, type PunksFailureKind } from "./client-error";
export {
  normalizeSemanticTrace,
  runFollowCorpus,
  runOperationCorpus,
  runSemanticScenario,
  runValidationCorpus,
} from "./conformance";
export type {
  CorpusRun,
  NormalizedTrace,
  SemanticEvent,
  SemanticScenario,
} from "./conformance";
export {
  validateDirectoryCursor,
  validateHistoryCursor,
} from "./cursors";
import type {
  AddMessageReactionCommand,
  AuthSession,
  ContractId,
  Conversation,
  ConversationSummary,
  ConversationView,
  DesktopCompatibilityQuery,
  DesktopCompatibilityResponse,
  ListConversationsResponse,
  ListWorkspacesResponse,
  MessageHistoryResponse,
  MessageReactionMutationResponse,
  MessageView,
  PostMessageCommand,
  PostMessageResponse,
  PunksProblem,
  PublicWorkspaceView,
  PunksWorkspaceView,
  RemoveMessageReactionCommand,
  ToggleMessageReactionCommand,
  Workspace,
  WorkspaceSummary,
} from "@punks/contracts";

/** Workspace representation visible to the current Punk. */
export type WorkspaceView =
  | Workspace
  | PunksWorkspaceView
  | PublicWorkspaceView;

/** Conversation representation visible to the current Punk. */
export type ConversationDetails = Conversation | ConversationView;

/** Stable coordinates of a Conversation within its Workspace. */
export interface ConversationCoordinates {
  workspaceId: string;
  conversationId: string;
}

/** Options for loading the most recent authorized Message page. */
export interface MessageHistoryOptions extends ConversationCoordinates {
  limit?: number;
  threadRootMessageId?: string;
}

/** A Message page whose opaque continuation cursor remains inside the client. */
export interface MessageHistoryPage {
  items: MessageView[];
  hasMore: boolean;
  nextPage(): Promise<MessageHistoryPage | null>;
}

/** Content required by the initial Punks UI Message composer. */
export interface PostMessageInput extends ConversationCoordinates {
  content: string;
}

/** Coordinate and canonical value used to toggle a Reaction. */
export interface ToggleReactionInput extends ConversationCoordinates {
  messageId: string;
  reaction: string;
}

/** Local development state ready for the Punks UI to render. */
export interface LocalBootstrap {
  session: AuthSession;
  workspace: WorkspaceView;
  conversation: ConversationDetails;
  messages: MessageView[];
}

/** Small client interface shared by the Punks UI and behavioral tests. */
export interface PunksClient {
  bootstrapLocal(): Promise<LocalBootstrap>;
  getSession(): Promise<AuthSession>;
  getWorkspace(slug: string): Promise<WorkspaceView>;
  getConversation(
    coordinates: ConversationCoordinates,
  ): Promise<ConversationDetails>;
  getMessageHistory(
    options: MessageHistoryOptions,
  ): Promise<MessageHistoryPage>;
  postMessage(input: PostMessageInput): Promise<MessageView>;
  toggleReaction(
    input: ToggleReactionInput,
  ): Promise<MessageReactionMutationResponse>;
}

/** Seed accepted by the in-memory adapter used by UI fixtures and tests. */
export interface MemoryPunksClientSeed {
  session: AuthSession;
  workspace: Workspace;
  conversation: Conversation;
  messages?: readonly MessageView[];
}

/** Construction options for the HTTP adapter. */
export interface HttpPunksClientOptions {
  baseUrl?: string | URL;
  fetch?: typeof globalThis.fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validated<T>(contractId: ContractId, value: unknown): T {
  if (!validateContract(contractId, value).valid) {
    throw clientProblem(`Response violated ${contractId}`, {
      kind: "contract_violation",
    });
  }
  return value as T;
}

function defaultBaseUrl(): string {
  if (typeof globalThis.location === "undefined") {
    throw clientProblem("baseUrl is required outside a browser context");
  }
  return globalThis.location.origin;
}

/** Creates the cookie-authenticated HTTP adapter for local or hosted Punks Bot. */
export function createHttpPunksClient(
  options: HttpPunksClientOptions = {},
): PunksClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const baseUrl = new URL(options.baseUrl ?? defaultBaseUrl());
  const buildUrl = (path: string): URL =>
    new URL(
      path.replace(/^\/+/, ""),
      `${baseUrl.toString().replace(/\/+$/, "")}/`,
    );
  let currentSession: AuthSession | null = null;

  const request = async (
    path: string,
    init: RequestInit = {},
  ): Promise<unknown> => {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.signal?.aborted === true) {
      throw clientProblem("Punks request was cancelled before emission", {
        kind: "cancelled",
      });
    }
    let response: Response;
    try {
      response = await fetcher(buildUrl(path), {
        ...init,
        credentials: "include",
        headers,
      });
    } catch {
      throw clientProblem("Punks Bot is temporarily unreachable", {
        code: "temporarily_unavailable",
        retry: "later",
        status: 503,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw clientProblem("Punks Bot returned invalid JSON");
    }
    if (!response.ok) {
      if (validateContract("punks://contracts/problem@1", body).valid) {
        throw new PunksClientError(body as PunksProblem);
      }
      throw clientProblem(
        `Punks Bot returned an invalid error response (${response.status})`,
      );
    }
    return body;
  };

  const getSession = async (): Promise<AuthSession> => {
    const body = await request("/api/auth/v1/session");
    if (!isRecord(body)) {
      throw clientProblem("Session response is invalid");
    }
    const session = validated<AuthSession>(
      "punks://contracts/auth.session@1",
      body.session,
    );
    currentSession = session;
    return session;
  };

  const getWorkspace = async (slug: string): Promise<WorkspaceView> => {
    const body = await request(
      `/api/v1/workspaces/${encodeURIComponent(slug)}`,
    );
    if (!isRecord(body)) {
      throw clientProblem("Workspace response is invalid");
    }
    const workspace = body.workspace;
    if (!isRecord(workspace)) {
      throw clientProblem("Workspace response is invalid");
    }
    if ("ownerPunkId" in workspace) {
      return validated<Workspace>("punks://contracts/workspace@1", workspace);
    }
    if (workspace.visibility === "public") {
      return validated<PublicWorkspaceView>(
        "punks://contracts/workspace.public-view@1",
        workspace,
      );
    }
    return validated<PunksWorkspaceView>(
      "punks://contracts/workspace.punks-view@1",
      workspace,
    );
  };

  const getConversation = async ({
    workspaceId,
    conversationId,
  }: ConversationCoordinates): Promise<ConversationDetails> => {
    const body = await request(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
    );
    if (!isRecord(body) || !isRecord(body.conversation)) {
      throw clientProblem("Conversation response is invalid");
    }
    return "ownerPunkId" in body.conversation
      ? validated<Conversation>(
          "punks://contracts/conversation@1",
          body.conversation,
        )
      : validated<ConversationView>(
          "punks://contracts/conversation.view@1",
          body.conversation,
        );
  };

  const loadMessageHistory = async (
    {
      workspaceId,
      conversationId,
      limit,
      threadRootMessageId,
    }: MessageHistoryOptions,
    cursor?: string,
  ): Promise<MessageHistoryPage> => {
    const query = new URLSearchParams();
    if (cursor !== undefined) query.set("cursor", cursor);
    if (limit !== undefined) query.set("limit", String(limit));
    if (threadRootMessageId !== undefined) {
      query.set("threadRootMessageId", threadRootMessageId);
    }
    const suffix = query.size === 0 ? "" : `?${query.toString()}`;
    const body = await request(
      `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    );
    const history = validated<MessageHistoryResponse>(
      "punks://contracts/message.history-response@1",
      body,
    );
    return {
      items: history.items,
      hasMore: history.nextCursor !== null,
      async nextPage() {
        return history.nextCursor === null
          ? null
          : loadMessageHistory(
              {
                workspaceId,
                conversationId,
                ...(limit === undefined ? {} : { limit }),
                ...(threadRootMessageId === undefined
                  ? {}
                  : { threadRootMessageId }),
              },
              history.nextCursor,
            );
      },
    };
  };

  const getMessageHistory = (
    options: MessageHistoryOptions,
  ): Promise<MessageHistoryPage> => loadMessageHistory(options);

  const client: PunksClient = {
    async bootstrapLocal() {
      const body = await request("/__dev/bootstrap", { method: "POST" });
      if (
        !isRecord(body) ||
        !isRecord(body.coordinates) ||
        typeof body.coordinates.workspaceSlug !== "string" ||
        typeof body.coordinates.workspaceId !== "string" ||
        typeof body.coordinates.conversationId !== "string"
      ) {
        throw clientProblem("Local bootstrap response is invalid");
      }
      const session = validated<AuthSession>(
        "punks://contracts/auth.session@1",
        body.session,
      );
      currentSession = session;
      const coordinates: ConversationCoordinates = {
        workspaceId: body.coordinates.workspaceId,
        conversationId: body.coordinates.conversationId,
      };
      const [workspace, conversation, history] = await Promise.all([
        getWorkspace(body.coordinates.workspaceSlug),
        getConversation(coordinates),
        getMessageHistory(coordinates),
      ]);
      return { session, workspace, conversation, messages: history.items };
    },
    getSession,
    getWorkspace,
    getConversation,
    getMessageHistory,
    async postMessage({ workspaceId, conversationId, content }) {
      const session = currentSession ?? (await getSession());
      const commandId = crypto.randomUUID();
      const command: PostMessageCommand = {
        contract: "message.post@1",
        commandId,
        workspaceId,
        conversationId,
        actor: { kind: "punk", punkId: session.punkId },
        payload: {
          content,
          replyToMessageId: null,
          broadcast: false,
          topic: null,
          mentionedPunkIds: [],
          mediaIds: [],
        },
      };
      const body = await request(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": commandId,
          },
          body: JSON.stringify(command),
        },
      );
      return validated<PostMessageResponse>(
        "punks://contracts/message.post-response@1",
        body,
      ).message;
    },
    async toggleReaction({ workspaceId, conversationId, messageId, reaction }) {
      const session = currentSession ?? (await getSession());
      const commandId = crypto.randomUUID();
      const command: ToggleMessageReactionCommand = {
        contract: "message.reaction-toggle@1",
        commandId,
        workspaceId,
        conversationId,
        messageId,
        actor: { kind: "punk", punkId: session.punkId },
        payload: { reaction },
      };
      const body = await request(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions/toggle`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": commandId,
          },
          body: JSON.stringify(command),
        },
      );
      return validated<MessageReactionMutationResponse>(
        "punks://contracts/message.reaction-mutation-response@1",
        body,
      );
    },
  };
  return client;
}

function staleWorkspaceProblem(): PunksClientError {
  return clientProblem("WorkspaceSession lease is no longer current", {
    kind: "stale_workspace",
  });
}

function cancellationInit(signal: AbortSignal | undefined): RequestInit {
  return signal === undefined ? {} : { signal };
}

/** Semantic HTTP implementation; ambiguous mutations are never replayed. */
export function createHttpPunksAccountClient(
  options: HttpPunksAccountClientOptions,
): PunksAccountClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  const configuredBase = new URL(options.baseUrl);
  const origin = configuredBase.origin;
  const buildUrl = (path: string): URL =>
    new URL(path.replace(/^\/+/, ""), `${origin}/`);
  let compatibility: DesktopCompatibilityResponse | null = null;
  let currentSession: AuthSession | null = null;
  let knownWorkspacesById = new Map<string, WorkspaceSummary>();
  let knownWorkspaceIdsBySlug = new Map<string, string>();
  let generation = 0;
  let activeLease: WorkspaceLease | null = null;

  const request = async (
    path: string,
    init: RequestInit = {},
    safety: "read" | "mutation" = "read",
  ): Promise<unknown> => {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.signal?.aborted === true) {
      throw clientProblem("Punks request was cancelled before emission", {
        kind: "cancelled",
      });
    }
    let response: Response;
    try {
      response = await fetcher(buildUrl(path), {
        ...init,
        credentials: "include",
        headers,
      });
    } catch (error) {
      const cancelled =
        error instanceof DOMException && error.name === "AbortError";
      const interruption = classifyObservedInterruption({
        kind: safety,
        emitted: true,
        cancelled,
      });
      throw clientProblem(
        interruption.failureKind === "ambiguous"
          ? "The mutation outcome is ambiguous; resolve authoritative state before a new intent"
          : cancelled
            ? "Punks request was cancelled"
            : "Punks Bot is temporarily unreachable",
        {
          code: "temporarily_unavailable",
          kind: interruption.failureKind,
          retry:
            interruption.failureKind === "ambiguous" ? "same_command" : "later",
          status: 503,
        },
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw clientProblem("Punks Bot returned invalid JSON", {
        kind: "contract_violation",
      });
    }
    if (!response.ok) {
      if (validateContract("punks://contracts/problem@1", body).valid) {
        throw new PunksClientError(body as PunksProblem);
      }
      throw clientProblem(
        `Punks Bot returned an invalid error response (${response.status})`,
        { kind: "contract_violation" },
      );
    }
    return body;
  };

  const assertCompatible = (): void => {
    if (compatibility?.compatible !== true) {
      throw clientProblem(
        "desktop-social-loop@1 compatibility must be confirmed first",
        { kind: "contract_violation" },
      );
    }
  };

  const assertCurrent = (lease: WorkspaceLease): void => {
    if (
      activeLease === null ||
      activeLease.origin !== lease.origin ||
      activeLease.punkId !== lease.punkId ||
      activeLease.workspaceId !== lease.workspaceId ||
      activeLease.generation !== lease.generation
    ) {
      throw staleWorkspaceProblem();
    }
  };

  const listWorkspaces = async (
    options: CancellableOperation = {},
  ): Promise<WorkspaceSummary[]> => {
    assertCompatible();
    const items: WorkspaceSummary[] = [];
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor !== null) query.set("cursor", cursor);
      const response = validated<ListWorkspacesResponse>(
        "punks://contracts/workspace.list-response@1",
        await request(
          `/api/v1/workspaces?${query.toString()}`,
          cancellationInit(options.signal),
        ),
      );
      items.push(...response.items);
      cursor = acceptNextDirectoryCursor(seenCursors, response.nextCursor);
    } while (cursor !== null);
    knownWorkspacesById = new Map(
      items.map((workspace) => [workspace.id, workspace]),
    );
    knownWorkspaceIdsBySlug = new Map(
      items.map((workspace) => [workspace.slug, workspace.id]),
    );
    return items;
  };

  const account: PunksAccountClient = {
    async checkCompatibility(cancellation = {}) {
      const query: DesktopCompatibilityQuery = {
        contract: "desktop.compatibility@1",
        profile: "desktop-social-loop@1",
        clientVersion: options.clientVersion,
        distribution: options.distribution,
        platform: options.platform,
      };
      const response = validated<DesktopCompatibilityResponse>(
        "punks://contracts/desktop.compatibility-response@1",
        await request("/api/v1/desktop/compatibility", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(query),
          ...cancellationInit(cancellation.signal),
        }),
      );
      if (response.origin !== origin) {
        throw clientProblem(
          "Compatibility response changed the pinned origin",
          {
            kind: "contract_violation",
          },
        );
      }
      compatibility = response;
      return response;
    },
    async getSession(options = {}) {
      assertCompatible();
      const body = await request(
        "/api/auth/v1/session",
        cancellationInit(options.signal),
      );
      if (!isRecord(body)) {
        throw clientProblem("Session response is invalid", {
          kind: "contract_violation",
        });
      }
      const session = validated<AuthSession>(
        "punks://contracts/auth.session@1",
        body.session,
      );
      currentSession = session;
      return session;
    },
    listWorkspaces,
    async resolveWorkspace(identity, options = {}) {
      const resolveCached = () =>
        identity.kind === "id"
          ? knownWorkspacesById.get(identity.workspaceId)
          : knownWorkspacesById.get(
              knownWorkspaceIdsBySlug.get(identity.workspaceSlug) ?? "",
            );
      const cached = resolveCached();
      if (cached !== undefined) return cached;
      await listWorkspaces(options);
      return resolveCached() ?? null;
    },
    async openWorkspace(workspaceId, options = {}) {
      assertCompatible();
      generation += 1;
      const openingGeneration = generation;
      activeLease = null;
      const session = currentSession ?? (await account.getSession(options));
      const workspace =
        knownWorkspacesById.get(workspaceId) ??
        (await account.resolveWorkspace({ kind: "id", workspaceId }, options));
      if (generation !== openingGeneration) {
        throw staleWorkspaceProblem();
      }
      if (workspace === null || workspace.id !== workspaceId) {
        throw clientProblem(`Workspace ${workspaceId} is not accessible`, {
          code: "not_found",
          status: 404,
        });
      }
      const lease: WorkspaceLease = {
        origin,
        punkId: session.punkId,
        workspaceId,
        generation: openingGeneration,
      };
      activeLease = lease;

      const leasedRequest = async (
        path: string,
        init?: RequestInit,
        safety: "read" | "mutation" = "read",
      ): Promise<unknown> => {
        assertCurrent(lease);
        const body = await request(path, init, safety);
        assertCurrent(lease);
        return body;
      };

      const loadHistory = async (
        options: WorkspaceTimelineOptions,
        threadRootMessageId?: string,
        cursor?: string,
      ): Promise<MessageHistoryPage> => {
        const query = new URLSearchParams();
        if (options.limit !== undefined) {
          query.set("limit", String(options.limit));
        }
        if (threadRootMessageId !== undefined) {
          query.set("threadRootMessageId", threadRootMessageId);
        }
        if (cursor !== undefined) query.set("cursor", cursor);
        const suffix = query.size === 0 ? "" : `?${query.toString()}`;
        const history = validated<MessageHistoryResponse>(
          "punks://contracts/message.history-response@1",
          await leasedRequest(
            `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(options.conversationId)}/messages${suffix}`,
            cancellationInit(options.signal),
          ),
        );
        assertCurrent(lease);
        return {
          items: history.items,
          hasMore: history.nextCursor !== null,
          async nextPage() {
            return history.nextCursor === null
              ? null
              : loadHistory(options, threadRootMessageId, history.nextCursor);
          },
        };
      };

      const mutateReaction = async (
        action: "add" | "remove",
        input: Omit<ToggleReactionInput, "workspaceId"> & CancellableOperation,
      ): Promise<MessageReactionMutationResponse> => {
        const commandId = crypto.randomUUID();
        const common = {
          commandId,
          workspaceId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          actor: { kind: "punk" as const, punkId: lease.punkId },
          payload: { reaction: input.reaction },
        };
        const command:
          | AddMessageReactionCommand
          | RemoveMessageReactionCommand =
          action === "add"
            ? { ...common, contract: "message.reaction-add@1" }
            : { ...common, contract: "message.reaction-remove@1" };
        const body = await leasedRequest(
          `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(input.conversationId)}/messages/${encodeURIComponent(input.messageId)}/reactions/${action}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "idempotency-key": commandId,
            },
            body: JSON.stringify(command),
            ...cancellationInit(input.signal),
          },
          "mutation",
        );
        const response = validated<MessageReactionMutationResponse>(
          "punks://contracts/message.reaction-mutation-response@1",
          body,
        );
        assertCurrent(lease);
        return response;
      };

      return {
        lease,
        close() {
          if (activeLease?.generation === lease.generation) {
            activeLease = null;
            generation += 1;
          }
        },
        async listStreams(options = {}) {
          const items: ConversationSummary[] = [];
          const seenCursors = new Set<string>();
          let cursor: string | null = null;
          do {
            const query = new URLSearchParams({ limit: "100" });
            if (cursor !== null) query.set("cursor", cursor);
            const response = validated<ListConversationsResponse>(
              "punks://contracts/conversation.list-response@1",
              await leasedRequest(
                `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations?${query.toString()}`,
                cancellationInit(options.signal),
              ),
            );
            if (response.workspaceId !== workspaceId) {
              throw clientProblem(
                "Conversation directory changed the Workspace scope",
                { kind: "contract_violation" },
              );
            }
            items.push(...response.items);
            cursor = acceptNextDirectoryCursor(
              seenCursors,
              response.nextCursor,
            );
          } while (cursor !== null);
          assertCurrent(lease);
          return items;
        },
        async getStream(conversationId, options = {}) {
          const body = await leasedRequest(
            `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
            cancellationInit(options.signal),
          );
          if (!isRecord(body) || !isRecord(body.conversation)) {
            throw clientProblem("Conversation response is invalid", {
              kind: "contract_violation",
            });
          }
          const conversation =
            "ownerPunkId" in body.conversation
              ? validated<Conversation>(
                  "punks://contracts/conversation@1",
                  body.conversation,
                )
              : validated<ConversationView>(
                  "punks://contracts/conversation.view@1",
                  body.conversation,
                );
          assertCurrent(lease);
          return conversation;
        },
        getTimeline(options) {
          return loadHistory(options);
        },
        getThread(options) {
          return loadHistory(options, options.threadRootMessageId);
        },
        resolveAuthors(authors, options = {}) {
          return resolveAuthorsOperation(
            leasedRequest,
            () => assertCurrent(lease),
            workspaceId,
            authors,
            options.signal,
          );
        },
        async postMessage({ conversationId, content, signal }) {
          const commandId = crypto.randomUUID();
          const command: PostMessageCommand = {
            contract: "message.post@1",
            commandId,
            workspaceId,
            conversationId,
            actor: { kind: "punk", punkId: lease.punkId },
            payload: {
              content,
              replyToMessageId: null,
              broadcast: false,
              topic: null,
              mentionedPunkIds: [],
              mediaIds: [],
            },
          };
          const response = validated<PostMessageResponse>(
            "punks://contracts/message.post-response@1",
            await leasedRequest(
              `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
              {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                  "idempotency-key": commandId,
                },
                body: JSON.stringify(command),
                ...cancellationInit(signal),
              },
              "mutation",
            ),
          );
          assertCurrent(lease);
          return response.message;
        },
        addReaction(input) {
          return mutateReaction("add", input);
        },
        removeReaction(input) {
          return mutateReaction("remove", input);
        },
      };
    },
  };
  return account;
}

/** Creates an isolated in-memory adapter with the same public client interface. */
export function createMemoryPunksClient(
  seed: MemoryPunksClientSeed,
): PunksClient {
  const state = structuredClone({
    ...seed,
    messages: [...(seed.messages ?? [])],
  });
  const reactions = new Map<
    string,
    NonNullable<MessageReactionMutationResponse["reaction"]>
  >();

  const getHistory = (
    options: MessageHistoryOptions,
    end = state.messages.length,
  ): MessageHistoryPage => {
    const scopedMessages =
      options.threadRootMessageId === undefined
        ? state.messages
        : state.messages.filter(
            (message) =>
              message.threadRootMessageId === options.threadRootMessageId,
          );
    const boundedEnd = Math.min(end, scopedMessages.length);
    const start = Math.max(0, boundedEnd - (options.limit ?? 50));
    return {
      items: structuredClone(scopedMessages.slice(start, boundedEnd)),
      hasMore: start > 0,
      async nextPage() {
        return start === 0 ? null : getHistory(options, start);
      },
    };
  };

  return {
    async bootstrapLocal() {
      return structuredClone({
        session: state.session,
        workspace: state.workspace,
        conversation: state.conversation,
        messages: state.messages,
      });
    },
    async getSession() {
      return structuredClone(state.session);
    },
    async getWorkspace(slug) {
      if (slug !== state.workspace.slug) {
        throw clientProblem(`Workspace ${slug} does not exist`, {
          code: "not_found",
          status: 404,
        });
      }
      return structuredClone(state.workspace);
    },
    async getConversation({ workspaceId, conversationId }) {
      if (
        workspaceId !== state.workspace.id ||
        conversationId !== state.conversation.id
      ) {
        throw clientProblem(`Conversation ${conversationId} does not exist`, {
          code: "not_found",
          status: 404,
        });
      }
      return structuredClone(state.conversation);
    },
    async getMessageHistory(options) {
      const { workspaceId, conversationId } = options;
      if (
        workspaceId !== state.workspace.id ||
        conversationId !== state.conversation.id
      ) {
        throw clientProblem(`Conversation ${conversationId} does not exist`, {
          code: "not_found",
          status: 404,
        });
      }
      return getHistory(options);
    },
    async postMessage({ workspaceId, conversationId, content }) {
      if (
        workspaceId !== state.workspace.id ||
        conversationId !== state.conversation.id
      ) {
        throw clientProblem(`Conversation ${conversationId} does not exist`, {
          code: "not_found",
          status: 404,
        });
      }
      const timestamp = new Date().toISOString();
      const messageId = crypto.randomUUID();
      const cursor =
        state.messages.reduce(
          (highest, message) => Math.max(highest, message.cursor),
          0,
        ) + 1;
      const message: MessageView = {
        id: messageId,
        workspaceId,
        conversationId,
        author: { kind: "punk", punkId: state.session.punkId },
        messageType:
          state.conversation.type === "forum" ? "forum-post" : "stream-message",
        status: "active",
        content,
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
        parentMessageId: null,
        threadRootMessageId: messageId,
        threadDepth: 0,
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
      state.messages.push(message);
      return structuredClone(message);
    },
    async toggleReaction({ workspaceId, conversationId, messageId, reaction }) {
      if (
        workspaceId !== state.workspace.id ||
        conversationId !== state.conversation.id ||
        !state.messages.some((message) => message.id === messageId)
      ) {
        throw clientProblem(`Message ${messageId} does not exist`, {
          code: "not_found",
          status: 404,
        });
      }
      const canonicalReaction = reaction.normalize("NFC").trim();
      const key = `${messageId}\u0000${state.session.punkId}\u0000${canonicalReaction}`;
      if (reactions.has(key)) {
        reactions.delete(key);
        return { reaction: null, effect: "removed", replayed: false };
      }
      const value: NonNullable<MessageReactionMutationResponse["reaction"]> = {
        id: crypto.randomUUID(),
        workspaceId,
        conversationId,
        messageId,
        actor: { kind: "punk", punkId: state.session.punkId },
        reaction: canonicalReaction,
        reactedAt: new Date().toISOString(),
      };
      reactions.set(key, value);
      return {
        reaction: structuredClone(value),
        effect: "added",
        replayed: false,
      };
    },
  };
}
