import type {
  AuthSession,
  ConversationFollowServerFrame,
  ConversationSummary,
  ConversationView,
  DesktopCompatibilityResponse,
  DesktopPresenceDelivery,
  GetWorkspaceGovernanceQuery,
  MessageHistoryResponse,
  MessageReactionMutationResponse,
  MessageSearchResponse,
  MessageView,
  Punk,
  PunkPublicSummary,
  PunkSearchQuery,
  PunkSearchResponse,
  PunkSummaryBatchResponse,
  PresenceTypingPatch,
  ResolveAuthorsQuery,
  ResolveAuthorsResponse,
  WorkspaceSummary,
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceInvitationCommand,
  CreateWorkspaceInvitationResponse,
  RevokeWorkspaceInvitationCommand,
  RevokeWorkspaceInvitationResponse,
  SetWorkspaceMemberRoleCommand,
  Workspace,
  WorkspaceInvitationView,
  WorkspaceMembershipLifecycleResponse,
  WorkspaceMembershipMutationResponse,
  WorkspaceGovernanceResponse,
} from "@punks/contracts";

import type {
  AccountSessionStateView,
  AuthenticationMethod,
  CeremonyPhaseView,
  IdentityLinkProvider,
} from "./punksAuthentication";
import type { WorkspaceIdentity } from "./punksWorkspaceIdentity";

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

export type MessageReplyTarget = {
  messageId: string;
  threadRootMessageId: string;
  threadDepth: number;
};

export type PostTextInput = {
  conversationId: string;
  content: string;
  topic?: string | null;
  replyTarget?: MessageReplyTarget;
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

export type MessageSearchInput = {
  conversationId: string;
  threadRootMessageId: string | null;
  query: string;
  cursor: string | null;
  limit: number;
};

export type UpdatePunkProfileInput = {
  expectedRevision: number;
  displayName: string;
  avatarUrl: string | null;
};

export type PunkSearchInput = PunkSearchQuery["query"];
export type PunkSearchPage = PunkSearchResponse;

export type CreateWorkspaceInvitationInput =
  CreateWorkspaceInvitationCommand["payload"];
export type ClaimWorkspaceInvitationInput = {
  code: string;
  expectedRevision: number;
};
export type RevokeWorkspaceInvitationInput =
  RevokeWorkspaceInvitationCommand["payload"];
export type SetWorkspaceMemberRoleInput =
  SetWorkspaceMemberRoleCommand["payload"];
export type RemoveWorkspaceMemberInput = {
  targetPunkId: string;
  expectedRevision: number;
};
export type TransferWorkspaceOwnershipInput = {
  targetPunkId: string;
  expectedRevision: number;
};
export type WorkspaceGovernancePageInput = Pick<
  GetWorkspaceGovernanceQuery,
  "limit" | "cursor"
>;

export type PunksNavigationTarget = {
  kind: "home" | "workspace" | "conversation" | "message";
  path: string;
};

type ChangesFrame = Extract<ConversationFollowServerFrame, { type: "changes" }>;

export type PunksFollowDelivery =
  | { kind: "apply_batch"; frame: ChangesFrame }
  | { kind: "typing"; patch: PresenceTypingPatch }
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

export type PunksPresenceDelivery = DesktopPresenceDelivery;

export interface PunksPresence {
  nextDelivery(): Promise<PunksPresenceDelivery>;
  setStatus(status: string | null): Promise<void>;
  signalTyping(conversationId: string, active: boolean): Promise<void>;
  close(): Promise<void>;
}

export interface PunksWorkspaceSession {
  readonly lease: WorkspaceLease;
  close(): Promise<void>;
  listStreams(): Promise<ConversationSummary[]>;
  getStream(conversationId: string): Promise<ConversationView>;
  getTimeline(input: MessagePageInput): Promise<MessageHistoryResponse>;
  getThread(input: ThreadPageInput): Promise<MessageHistoryResponse>;
  searchMessages(input: MessageSearchInput): Promise<MessageSearchResponse>;
  resolveAuthors(
    authors: ResolveAuthorsQuery["authors"],
  ): Promise<ResolveAuthorsResponse["authors"]>;
  getPunkSummaries(punkIds: string[]): Promise<PunkSummaryBatchResponse>;
  searchPunks(input: {
    query: PunkSearchInput;
    limit: number;
    cursor: string | null;
  }): Promise<PunkSearchPage>;
  getGovernancePage(
    input: WorkspaceGovernancePageInput,
  ): Promise<WorkspaceGovernanceResponse>;
  createInvitation(
    input: CreateWorkspaceInvitationInput,
  ): Promise<CreateWorkspaceInvitationResponse>;
  revokeInvitation(
    input: RevokeWorkspaceInvitationInput,
  ): Promise<RevokeWorkspaceInvitationResponse>;
  setMemberRole(
    input: SetWorkspaceMemberRoleInput,
  ): Promise<WorkspaceMembershipMutationResponse>;
  removeMember(
    input: RemoveWorkspaceMemberInput,
  ): Promise<WorkspaceMembershipMutationResponse>;
  leaveWorkspace(): Promise<WorkspaceMembershipLifecycleResponse>;
  transferOwnership(
    input: TransferWorkspaceOwnershipInput,
  ): Promise<WorkspaceMembershipLifecycleResponse>;
  followConversation(
    conversationId: string,
    afterCursor: number,
  ): Promise<PunksFollow>;
  holdPresence(): Promise<PunksPresence>;
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
  getPunkProfile(): Promise<Punk>;
  updatePunkProfile(input: UpdatePunkProfileInput): Promise<Punk>;
  getWorkspaceInvitation(code: string): Promise<WorkspaceInvitationView>;
  claimWorkspaceInvitation(
    input: ClaimWorkspaceInvitationInput,
  ): Promise<ClaimWorkspaceInvitationResponse>;
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

export type FakePunksClientSeed = {
  compatibility: DesktopCompatibilityResponse;
  session: AuthSession;
  accountSessionState?: AccountSessionStateView;
  workspaces: WorkspaceSummary[];
  streams: Record<string, ConversationSummary[]>;
  messages: Record<string, MessageView[]>;
  profile?: Punk;
  punkSummaries?: PunkPublicSummary[];
  governance?: Record<string, Workspace>;
  invitations?: Array<{
    code: string;
    invitation: WorkspaceInvitationView;
    issuerPunkId?: string;
  }>;
  followFrames?: Record<string, ConversationFollowServerFrame[]>;
  messageSearchState?: Record<
    string,
    {
      completeness: "complete" | "partial";
      partialReason: "index_lagging" | "index_unavailable" | null;
    }
  >;
};
