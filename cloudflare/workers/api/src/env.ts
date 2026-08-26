export interface ErasureScope {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  generationId: string;
}

export interface RecordErasureInput extends ErasureScope {
  erasureCommandId: string;
  expectedContentKeyIds: string[];
}

export interface ErasureTombstone extends RecordErasureInput {
  schemaVersion: 1;
  recordedAt: string;
  tombstoneHash: string;
}

export type LookupErasureResult =
  | { ok: true; tombstone: ErasureTombstone | null }
  | {
      ok: false;
      code: "invalid_request" | "corrupt_tombstone" | "storage_unavailable";
    };

export type RecordErasureResult =
  | { ok: true; tombstone: ErasureTombstone; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "conflict"
        | "corrupt_tombstone"
        | "storage_unavailable";
    };

export interface ErasureRegistryService {
  lookup(input: ErasureScope): Promise<LookupErasureResult>;
  record(input: RecordErasureInput): Promise<RecordErasureResult>;
}

export type MessageCandidateCursor = readonly [
  createdCursor: number,
  conversationId: string,
  messageId: string,
];

export interface SearchMessageCandidatesInput {
  workspaceId: string;
  conversationId: string;
  threadRootMessageId: string | null;
  expectedCursor: number;
  algorithm: "hmac-sha256-conversation-v2";
  tokens: string[];
  limit: number;
  cursor?: MessageCandidateCursor;
}

export interface MessageSearchCandidate {
  messageId: string;
  conversationId: string;
  createdCursor: number;
  lastCursor: number;
}

export type SearchMessageCandidatesResult =
  | {
      ok: true;
      indexState: "current" | "lagging";
      candidates: MessageSearchCandidate[];
      nextCursor: MessageCandidateCursor | null;
    }
  | { ok: false; code: "invalid_request" | "storage_unavailable" };

export interface MessageCandidateSearchService {
  searchMessages(
    input: SearchMessageCandidatesInput,
  ): Promise<SearchMessageCandidatesResult>;
}

export interface ProjectionWorkspaceCandidate {
  workspaceId: string;
  slug: string;
  name: string;
  visibility: "private" | "punks" | "public";
  role: "owner" | "moderator" | "member" | "guest";
  revision: number;
}

export interface ProjectionConversationCandidate {
  id: string;
  workspaceId: string;
  name: string;
  type: "stream";
  visibility: "open" | "private";
  description: string | null;
  topic: string | null;
  purpose: string | null;
  topicRequired: boolean;
  ttlSeconds: number | null;
  ttlDeadline: string | null;
  revision: number;
  cursor: number;
  updatedAt: string;
}

export interface ProjectionPunkCandidate {
  punkId: string;
  displayName: string;
  avatarUrl: string | null;
  revision: number;
}

export interface ProjectionDirectoryService {
  listWorkspaceCandidates(input: {
    punkId: string;
    limit: number;
    afterId?: string;
  }): Promise<ProjectionWorkspaceCandidate[]>;
  listConversationCandidates(input: {
    workspaceId: string;
    punkId: string;
    limit: number;
    afterId?: string;
  }): Promise<ProjectionConversationCandidate[]>;
  upsertPunkProfile(input: {
    punkId: string;
    displayName: string;
    avatarUrl: string | null;
    revision: number;
    updatedAt: string;
  }): Promise<boolean>;
  searchPunkCandidates(input: {
    workspaceId: string;
    prefix: string;
    limit: number;
    afterPunkId?: string;
  }): Promise<ProjectionPunkCandidate[]>;
}

export type PunkProfileUpdateResult =
  | {
      ok: true;
      state: import("@punks/contracts").Punk;
      replayed: boolean;
    }
  | {
      ok: false;
      code: "invalid_input" | "not_found" | "inactive" | "idempotency_conflict";
    }
  | { ok: false; code: "revision_conflict"; currentRevision: number };

/** Private probe returning only the Worker version executing the RPC call. */
export interface RuntimeIdentityService {
  runtimeVersion(): Promise<{ versionId: string }>;
}

export interface ApiEnv extends CloudflareBindings {
  BOT_WAKE_QUEUE: Queue<import("@punks/contracts").BotWakeQueueBody>;
  OPERATOR_PROVISIONING_TOKEN: string;
  /** Public, environment-scoped Attestation key-version registry. */
  ATTESTATION_PUBLIC_KEYS_JSON: string;
  /** Secret provisioned with Wrangler; intentionally absent from wrangler vars. */
  MESSAGE_SEARCH_MASTER_KEY: string;
  /** Secret provisioned with Wrangler; intentionally absent from wrangler vars. */
  MESSAGE_SEARCH_CURSOR_KEY: string;
  /** Secret provisioned with Wrangler; intentionally absent from wrangler vars. */
  MESSAGE_HISTORY_CURSOR_KEY: string;
  /** Independent secret for Punk-bound Workspace and Stream continuations. */
  DIRECTORY_CURSOR_KEY: string;
  /** Independent HMAC key for short, upload-intention-scoped credentials. */
  MEDIA_UPLOAD_GRANT_KEY: string;
  ERASURE_REGISTRY: CloudflareBindings["ERASURE_REGISTRY"] &
    ErasureRegistryService;
  MESSAGE_SEARCH: CloudflareBindings["MESSAGE_SEARCH"] &
    MessageCandidateSearchService;
  PROJECTION_DIRECTORY: Fetcher & ProjectionDirectoryService;
  AUTH_RUNTIME_IDENTITY: CloudflareBindings["AUTH_RUNTIME_IDENTITY"] &
    RuntimeIdentityService;
  ATTESTATION_RUNTIME_IDENTITY: CloudflareBindings["ATTESTATION_RUNTIME_IDENTITY"] &
    RuntimeIdentityService;
  ERASURE_RUNTIME_IDENTITY: CloudflareBindings["ERASURE_RUNTIME_IDENTITY"] &
    RuntimeIdentityService;
  PROJECTOR_RUNTIME_IDENTITY: CloudflareBindings["PROJECTOR_RUNTIME_IDENTITY"] &
    RuntimeIdentityService;
  SEARCH_RUNTIME_IDENTITY: CloudflareBindings["SEARCH_RUNTIME_IDENTITY"] &
    RuntimeIdentityService;
  BOT_RUNTIME_IDENTITY: CloudflareBindings["BOT_RUNTIME_IDENTITY"] &
    RuntimeIdentityService;
  ACCOUNT_MERGE_AUTHORITY: CloudflareBindings["ACCOUNT_MERGE_AUTHORITY"] & {
    commitAccountMergePlan(input: unknown): Promise<unknown>;
    readAccountMergeState(input: unknown): Promise<unknown>;
  };
  WORKSPACE_OWNERSHIP_AUTHORITY: CloudflareBindings["WORKSPACE_OWNERSHIP_AUTHORITY"] & {
    consume(input: unknown): Promise<boolean>;
  };
  ACCOUNT_MERGE_RIGHTS_INDEX: CloudflareBindings["ACCOUNT_MERGE_RIGHTS_INDEX"] & {
    prepareWorkspaceMembershipChange(input: unknown): Promise<boolean>;
    commitWorkspaceMembershipChange(input: unknown): Promise<boolean>;
    abortWorkspaceMembershipChange(input: unknown): Promise<boolean>;
  };
  AUTH_SERVICE: CloudflareBindings["AUTH_SERVICE"] & {
    resolveSessionCookie(
      cookie: string,
    ): Promise<import("@punks/contracts").AuthSession | null>;
    resolveSessionId(
      sessionId: string,
    ): Promise<import("@punks/contracts").AuthSession | null>;
    punkExists(punkId: string): Promise<boolean>;
    resolvePunkSummary(punkId: string): Promise<{
      id: string;
      displayName: string;
      avatarUrl: string | null;
      revision: number;
      updatedAt: string;
    } | null>;
    getPunkProfile(
      punkId: string,
    ): Promise<import("@punks/contracts").Punk | null>;
    updatePunkProfile(
      punkId: string,
      command: unknown,
    ): Promise<PunkProfileUpdateResult>;
  };
  BOT_INVOCATION_VERIFIER: CloudflareBindings["BOT_INVOCATION_VERIFIER"] & {
    verifyBotInvocation(
      input: unknown,
    ): Promise<import("@punks/contracts").VerifyBotInvocationCredentialResult>;
  };
}
