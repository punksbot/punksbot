import type {
  AuthSession,
  ConversationSummary,
  DesktopCompatibilityQuery,
  DesktopCompatibilityResponse,
  MessageReactionMutationResponse,
  MessageView,
  ResolveAuthorsQuery,
  ResolveAuthorsResponse,
  WorkspaceSummary,
} from "@punks/contracts";

import type {
  ConversationDetails,
  MessageHistoryPage,
  PostMessageInput,
  ToggleReactionInput,
} from "./index";

/** Construction options for the versioned desktop account client. */
export interface HttpPunksAccountClientOptions {
  baseUrl: string | URL;
  clientVersion: string;
  distribution: DesktopCompatibilityQuery["distribution"];
  platform: DesktopCompatibilityQuery["platform"];
  fetch?: typeof globalThis.fetch;
}

/** Cancellation token accepted at every declared cancellable boundary. */
export interface CancellableOperation {
  signal?: AbortSignal;
}

/** Identity and generation that authorize one open WorkspaceSession. */
export interface WorkspaceLease {
  origin: string;
  punkId: string;
  workspaceId: string;
  generation: number;
}

/** Arguments accepted by a Workspace timeline read. */
export interface WorkspaceTimelineOptions extends CancellableOperation {
  conversationId: string;
  limit?: number;
}

/** Arguments accepted by a Workspace thread read. */
export interface WorkspaceThreadOptions extends WorkspaceTimelineOptions {
  threadRootMessageId: string;
}

/** Semantic operations scoped to one generation-bound Workspace. */
export interface WorkspaceSession {
  readonly lease: WorkspaceLease;
  close(): void;
  listStreams(options?: CancellableOperation): Promise<ConversationSummary[]>;
  getStream(
    conversationId: string,
    options?: CancellableOperation,
  ): Promise<ConversationDetails>;
  getTimeline(options: WorkspaceTimelineOptions): Promise<MessageHistoryPage>;
  getThread(options: WorkspaceThreadOptions): Promise<MessageHistoryPage>;
  resolveAuthors(
    authors: ResolveAuthorsQuery["authors"],
    options?: CancellableOperation,
  ): Promise<ResolveAuthorsResponse["authors"]>;
  postMessage(
    input: Omit<PostMessageInput, "workspaceId"> & CancellableOperation,
  ): Promise<MessageView>;
  addReaction(
    input: Omit<ToggleReactionInput, "workspaceId"> & CancellableOperation,
  ): Promise<MessageReactionMutationResponse>;
  removeReaction(
    input: Omit<ToggleReactionInput, "workspaceId"> & CancellableOperation,
  ): Promise<MessageReactionMutationResponse>;
}

/** Versioned, cookie-authenticated account boundary used by desktop shells. */
export interface PunksAccountClient {
  checkCompatibility(
    options?: CancellableOperation,
  ): Promise<DesktopCompatibilityResponse>;
  getSession(options?: CancellableOperation): Promise<AuthSession>;
  listWorkspaces(options?: CancellableOperation): Promise<WorkspaceSummary[]>;
  resolveWorkspace(
    idOrSlug: string,
    options?: CancellableOperation,
  ): Promise<WorkspaceSummary | null>;
  openWorkspace(
    workspaceId: string,
    options?: CancellableOperation,
  ): Promise<WorkspaceSession>;
}
