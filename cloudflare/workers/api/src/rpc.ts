import type {
  ArchiveConversationCommand,
  Bot,
  BotInstallation,
  ConfigureBotInstallationCommand,
  PublishBotCommand,
  Conversation,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  GetConversationQuery,
  EditMessageCommand,
  JoinConversationCommand,
  MessageHistoryQuery,
  MessageSearchQuery,
  MessageReactionMutationResponse,
  AddMessageReactionCommand,
  RemoveMessageReactionCommand,
  ToggleMessageReactionCommand,
  PostMessageCommand,
  InstallBotCommand,
  LeaveWorkspaceCommand,
  RetractMessageCommand,
  RestoreMessageCommand as RestoreMessageDomainCommand,
  RevokeBotInstallationCommand,
  RemoveWorkspaceMemberCommand,
  RemoveConversationMemberCommand,
  RestoreConversationCommand,
  RenameWorkspaceCommand,
  SetConversationMemberAccessCommand,
  SetWorkspaceMemberRoleCommand,
  SignedNostrEvent,
  UpdateConversationCommand,
  UpdateBotCommand,
  Workspace,
  ExecuteBotActionCommand,
  DeliverBotActionCommand,
  DeliverBotActionResult,
  BotActionAdmission,
  BotWakeOffer,
  ClaimWorkspaceInvitationCommand,
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceInvitationCommand,
  CreateWorkspaceInvitationResponse,
  RevokeWorkspaceInvitationCommand,
  RevokeWorkspaceInvitationResponse,
  WorkspaceInvitationView,
  WorkspaceGovernanceView,
  TransferWorkspaceOwnershipCommand,
} from "@punks/contracts";
import type { WorkspacePermission, WorkspaceRole } from "@punks/core";
import type { BoundedMessageState, MessageContentVersion } from "@punks/core";

export type WorkspaceCommand =
  | CreateWorkspaceCommand
  | RenameWorkspaceCommand
  | SetWorkspaceMemberRoleCommand
  | RemoveWorkspaceMemberCommand
  | LeaveWorkspaceCommand
  | TransferWorkspaceOwnershipCommand
  | ClaimWorkspaceInvitationCommand;

export interface WorkspaceMutationAuthorization {
  sessionId: string;
  punkId: string;
}

export type WorkspaceInvitationMutationCommand =
  | CreateWorkspaceInvitationCommand
  | RevokeWorkspaceInvitationCommand;

export type WorkspaceInvitationMutationResponse =
  | CreateWorkspaceInvitationResponse
  | RevokeWorkspaceInvitationResponse;

export type WorkspaceInvitationFailureCode =
  | "invalid_contract"
  | "idempotency_conflict"
  | "command_in_progress"
  | "not_found"
  | "forbidden"
  | "revision_conflict"
  | "invite_invalid"
  | "invite_expired"
  | "invite_exhausted"
  | "invite_revoked"
  | "invite_role_forbidden"
  | "attestation_failed"
  | "internal";

export type WorkspaceInvitationMutationResult =
  | { ok: true; response: WorkspaceInvitationMutationResponse }
  | { ok: false; code: WorkspaceInvitationFailureCode };

export type WorkspaceInvitationQueryResult =
  | { ok: true; invitation: WorkspaceInvitationView }
  | { ok: false; code: "invalid_contract" | "invite_invalid" | "not_found" };

export type WorkspaceInvitationClaimResult =
  | { ok: true; response: ClaimWorkspaceInvitationResponse }
  | { ok: false; code: WorkspaceInvitationFailureCode };

export type BotCommand = PublishBotCommand | UpdateBotCommand;

export type BotInstallationManagementCommand =
  | InstallBotCommand
  | ConfigureBotInstallationCommand
  | RevokeBotInstallationCommand;

export interface BotExecuteRequest {
  command: BotCommand;
  operatorAuthorized: boolean;
}

export interface CommittedBotCommand {
  state: Bot;
  event: SignedNostrEvent;
  previousSlug: string | null;
}

export type BotExecuteResult =
  | { ok: true; value: CommittedBotCommand; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "attestation_failed"
        | "temporarily_unavailable"
        | "internal";
    };

export type BotQueryResult =
  | { ok: true; state: Bot }
  | { ok: false; code: "invalid_contract" | "not_found" | "internal" };

export interface CommittedBotInstallationCommand {
  state: BotInstallation;
  event: SignedNostrEvent;
}

export type BotInstallationExecuteResult =
  | {
      ok: true;
      value: CommittedBotInstallationCommand;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "conflict"
        | "attestation_failed"
        | "temporarily_unavailable"
        | "internal";
    };

export type BotInstallationQueryResult =
  | { ok: true; state: BotInstallation }
  | { ok: false; code: "invalid_contract" | "not_found" | "internal" };

export interface AdmitBotActionRequest {
  command: ExecuteBotActionCommand;
  credential: {
    jti: string;
    issuedAt: number;
    notBefore: number;
    expiresAt: number;
  };
  admissionCommandId: string;
}

export type BotActionAdmissionResult =
  | {
      ok: true;
      admissionId: string;
      admission: BotActionAdmission;
      proof: SignedNostrEvent;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "invalid_credential"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "conflict"
        | "admission_limit"
        | "attestation_failed"
        | "temporarily_unavailable"
        | "internal";
    };

export interface ValidateBotActionAdmissionRequest {
  workspaceId: string;
  installationId: string;
  botId: string;
  actionId: string;
  admissionId: string;
  actionDigest: string;
  authorityGeneration: number;
  proof: SignedNostrEvent;
}

export type ValidateBotActionAdmissionResult =
  | { ok: true; admission: BotActionAdmission }
  | { ok: false; code: "invalid_request" | "not_found" | "forbidden" };

export interface CompleteBotActionRequest {
  workspaceId: string;
  installationId: string;
  admissionId: string;
  actionId: string;
  actionDigest: string;
  outcome: "succeeded" | "failed";
  completionCommandId: string;
}

export type CompleteBotActionResult =
  | { ok: true; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "conflict"
        | "command_in_progress"
        | "attestation_failed"
        | "temporarily_unavailable"
        | "internal";
    };

export interface AuthorizeBotGrantRequest {
  workspaceId: string;
  conversationId: string;
  punkId: string;
}

export type AuthorizeBotGrantResult =
  | { ok: true; conversationCursor: number }
  | { ok: false; code: "invalid_request" | "not_found" | "forbidden" };

interface BotWakeSubscriptionCoordinates {
  workspaceId: string;
  conversationId: string;
  botId: string;
  installationId: string;
  epoch: number;
}

export type BotWakeSubscriptionMutationRequest =
  | (BotWakeSubscriptionCoordinates & {
      operation: "prepare";
      preparationId: string;
    })
  | (BotWakeSubscriptionCoordinates & { operation: "deactivate" })
  | (BotWakeSubscriptionCoordinates & {
      operation: "activate";
      preparationId: string;
      highWaterCursor: number;
    });

export type BotWakeSubscriptionMutationResult =
  | {
      ok: true;
      status: "prepared" | "active" | "disabled";
      epoch: number;
      highWaterCursor: number;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "forbidden"
        | "conflict"
        | "temporarily_unavailable";
    };

export type AuthorizeBotWakeRequest = BotWakeSubscriptionCoordinates & {
  messageCursor: number;
};

export type AuthorizeBotWakeResult =
  | { ok: true; epoch: number; highWaterCursor: number }
  | { ok: false; code: "invalid_request" | "not_found" | "forbidden" };

/** Known-Installation trigger accepted by one already-selected ConversationDO. */
export interface OfferBotWakeRequest {
  installationId: string;
  messageId: string;
}

/** Opaque, authority-derived Message source delivered to BotInstallationDO. */
export interface BotWakeCandidate {
  schemaVersion: 1;
  wakeId: string;
  workspaceId: string;
  installationId: string;
  botId: string;
  conversationId: string;
  messageId: string;
  messageCursor: number;
  subscriptionEpoch: number;
  sourceEventId: string;
  sourceEventDigest: string;
  createdAt: string;
}

export type OfferBotWakeResult =
  | { ok: true; wakeId: string }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "forbidden"
        | "conflict"
        | "temporarily_unavailable"
        | "internal";
    };

export type AcceptBotWakeCandidateResult =
  | {
      ok: true;
      wakeId: string;
      replayed: boolean;
      terminal: boolean;
    }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "authority_revoked"
        | "conflict"
        | "temporarily_unavailable"
        | "internal";
    };

/** Installation-issued proof for one transient Bot-context read. */
export interface ReadBotWakeContextRequest {
  installationId: string;
  wakeId: string;
  turnId: string;
  authorityGeneration: number;
  offerDigest: string;
  offer: BotWakeOffer;
}

export type ReadBotWakeContextResult =
  | { ok: true; content: string }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "authority_revoked"
        | "content_unavailable"
        | "temporarily_unavailable"
        | "internal";
    };

export type ExecuteAdmittedBotReactionRequest = DeliverBotActionCommand;

export type ExecuteAdmittedBotReactionResult = DeliverBotActionResult;

export type BotSlugClaimResult =
  | { ok: true; botId: string; replayed: boolean }
  | { ok: false; code: "invalid_request" | "slug_claimed" };

export type BotSlugResolution =
  | { status: "missing" }
  | { status: "pending" }
  | { status: "active"; botId: string }
  | { status: "redirect"; botId: string; slug: string };

export interface CommittedWorkspaceCommand {
  state: Workspace;
  event: SignedNostrEvent;
}

export type WorkspaceExecuteResult =
  | { ok: true; value: CommittedWorkspaceCommand; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "revision_conflict"
        | "invite_invalid"
        | "invite_expired"
        | "invite_exhausted"
        | "invite_revoked"
        | "invite_role_forbidden"
        | "attestation_failed"
        | "internal";
    };

export type WorkspaceQuery = {
  contract: "workspace.get@1";
  workspaceId: string;
};

export type WorkspaceQueryResult =
  | { ok: true; state: Workspace }
  | { ok: false; code: "invalid_contract" | "not_found" };

export interface WorkspaceGovernancePageQuery {
  workspaceId: string;
  punkId: string;
  limit: number;
  afterPunkId?: string;
  authorityCursor?: number;
}

export type WorkspaceGovernancePageResult =
  | {
      ok: true;
      workspace: WorkspaceGovernanceView;
      members: Workspace["members"];
      authorityCursor: number;
      nextPositionPunkId: string | null;
    }
  | {
      ok: false;
      code: "invalid_request" | "not_found" | "forbidden" | "cursor_stale";
    };

export interface WorkspaceAuthorizationRequest {
  workspaceId: string;
  punkId: string;
  permission: WorkspacePermission;
}

export type WorkspaceAuthorizationResult =
  | {
      ok: true;
      workspaceCursor: number;
      role: WorkspaceRole;
      visibility: Workspace["visibility"];
    }
  | { ok: false; code: "invalid_request" | "not_found" | "forbidden" };

export type ConversationCommand =
  | CreateConversationCommand
  | JoinConversationCommand
  | SetConversationMemberAccessCommand
  | RemoveConversationMemberCommand
  | UpdateConversationCommand
  | ArchiveConversationCommand
  | RestoreConversationCommand;

export interface CommittedConversationCommand {
  state: Conversation;
  event: SignedNostrEvent;
}

export type ConversationExecuteResult =
  | { ok: true; value: CommittedConversationCommand; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "attestation_failed"
        | "internal";
    };

export type ConversationQuery = GetConversationQuery;

export type ConversationQueryResult =
  | { ok: true; state: Conversation }
  | { ok: false; code: "invalid_contract" | "not_found" };

export interface PostMessageRequest {
  messageId: string;
  command: PostMessageCommand;
}

export interface CommittedMessagePost {
  state: BoundedMessageState;
  version: MessageContentVersion;
  event: SignedNostrEvent;
}

export interface MessageMutationRequest {
  messageId: string;
  command:
    | EditMessageCommand
    | RetractMessageCommand
    | RestoreMessageDomainCommand;
}

export interface CommittedMessageMutation {
  state: BoundedMessageState;
  version: MessageContentVersion | null;
  event: SignedNostrEvent | null;
}

export type MessageMutationResult =
  | { ok: true; value: CommittedMessageMutation; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "content_unavailable"
        | "content_finalize_failed"
        | "search_unavailable"
        | "attestation_failed"
        | "internal";
    };

export interface MessageReadRequest {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  punkId: string;
}

export type MessageReadResult =
  | { ok: true; messageJson: string }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "not_found"
        | "forbidden"
        | "content_unavailable"
        | "internal";
    };

export type MessagePostResult =
  | { ok: true; value: CommittedMessagePost; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "content_unavailable"
        | "content_finalize_failed"
        | "search_unavailable"
        | "attestation_failed"
        | "internal";
    };

export interface MessageHistoryRequest {
  query: MessageHistoryQuery;
  punkId: string;
}

export type MessageHistoryResult =
  | { ok: true; responseJson: string }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "cursor_invalid"
        | "not_found"
        | "forbidden"
        | "content_unavailable"
        | "internal";
    };

export interface MessageSearchRequest {
  query: MessageSearchQuery;
  punkId: string;
}

export type MessageSearchResult =
  | { ok: true; responseJson: string }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "cursor_invalid"
        | "not_found"
        | "forbidden"
        | "content_unavailable"
        | "search_unavailable"
        | "internal";
    };

export type MessageReactionCommand =
  | AddMessageReactionCommand
  | RemoveMessageReactionCommand
  | ToggleMessageReactionCommand;

export interface MessageReactionMutationRequest {
  command: MessageReactionCommand;
}

export type MessageReactionMutationResult =
  | {
      ok: true;
      response: MessageReactionMutationResponse;
    }
  | {
      ok: false;
      code:
        | "invalid_contract"
        | "idempotency_conflict"
        | "command_in_progress"
        | "not_found"
        | "forbidden"
        | "invalid_transition"
        | "attestation_failed"
        | "internal";
    };

export type SlugClaimResult =
  | { ok: true; workspaceId: string; replayed: boolean }
  | { ok: false; code: "slug_claimed" };

export type SlugResolution =
  | { status: "missing" }
  | { status: "pending" }
  | { status: "active"; workspaceId: string }
  | { status: "redirect"; workspaceId: string; slug: string };
