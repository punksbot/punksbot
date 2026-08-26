export type { AttestationRequest } from "./generated/attestation.request";
export type { AttestationResponse } from "./generated/attestation.response";
export type { AccountMergeFreshProof } from "./generated/account-merge.fresh-proof";
export type { CreateAccountMergePlanCommand } from "./generated/account-merge.plan-create";
export type { AccountMergePlanResponse } from "./generated/account-merge.plan-response";
export type { AccountMergePlan } from "./generated/account-merge.plan";
export type { AuthProviderProfile } from "./generated/auth.provider-profile";
export type { FinishPasskeyCommand } from "./generated/auth.passkey-finish";
export type { PasskeyOptionsResponse } from "./generated/auth.passkey-options";
export type { AuthSession } from "./generated/auth.session";
export type { ResolveAuthorsQuery } from "./generated/author.resolve";
export type { ResolveAuthorsResponse } from "./generated/author.resolve-response";
export type { BotActionAdmission } from "./generated/bot-action.admission";
export type { AdmitBotActionCommand } from "./generated/bot-action.admit";
export type { CompleteBotActionCommand } from "./generated/bot-action.complete";
export type { DeliverBotActionResult } from "./generated/bot-action.delivery-result";
export type { DeliverBotActionCommand } from "./generated/bot-action.delivery";
export type { ExecuteBotActionResult } from "./generated/bot-action.execute-result";
export type { ExecuteBotActionCommand } from "./generated/bot-action.execute";
export type { ReplayBotActionCommand } from "./generated/bot-action.replay";
export type { BotActionReceiptArchive } from "./generated/bot-action.receipt-archive";
export type { BotInvocationClaims } from "./generated/bot-invocation.claims";
export type { MintBotInvocationCredentialResult } from "./generated/bot-invocation.mint-result";
export type { MintBotInvocationCredentialCommand } from "./generated/bot-invocation.mint";
export type { VerifyBotInvocationCredentialResult } from "./generated/bot-invocation.verify-result";
export type { VerifyBotInvocationCredentialQuery } from "./generated/bot-invocation.verify";
export type { InvokeBotRuntimeReactionCommand } from "./generated/bot-runtime.reaction-invoke";
export type { InvokeBotRuntimeReactionResult } from "./generated/bot-runtime.reaction-result";
export type { ConfigureBotInstallationCommand } from "./generated/bot-installation.configure";
export type { GetBotInstallationQuery } from "./generated/bot-installation.get";
export type { BotInstallationProjectionEnvelope } from "./generated/bot-installation.projection";
export type { InstallBotCommand } from "./generated/bot-installation.install";
export type { RevokeBotInstallationCommand } from "./generated/bot-installation.revoke";
export type { BotInstallation } from "./generated/bot-installation";
export type { BotInstallationJournalSegmentArchive } from "./generated/bot-installation.journal-segment";
export type { BotInstallationCommandReceiptArchive } from "./generated/bot-installation.command-receipt-archive";
export type { EmptyBotConfig } from "./generated/bot.config.empty";
export type { GetBotQuery } from "./generated/bot.get";
export type { BotProjectionEnvelope } from "./generated/bot.projection";
export type { PublishBotCommand } from "./generated/bot.publish";
export type { UpdateBotCommand } from "./generated/bot.update";
export type { Bot, RuntimeReleaseRef } from "./generated/bot";
export type { BotJournalSegmentArchive } from "./generated/bot.journal-segment";
export type { BotCommandReceiptArchive } from "./generated/bot.command-receipt-archive";
export type { BotWakeOffer } from "./generated/bot-wake.offer";
export type { BotWakeQueueBody } from "./generated/bot-wake.queue";
export type { ClaimBotWakeCommand } from "./generated/bot-wake.claim";
export type { ClaimBotWakeResult } from "./generated/bot-wake.claim-result";
export type { CompleteBotWakeCommand } from "./generated/bot-wake.complete";
export type { BotWakeTerminalReceiptArchive } from "./generated/bot-wake.receipt-archive";
export type { StartAuthResponse } from "./generated/auth.start-response";
export type { StartAuthCommand } from "./generated/auth.start";
export type {
  DesktopAuthStartExchange,
  DesktopAuthStartRequest,
  DesktopAuthStartResponse,
} from "./generated/desktop-auth.start";
export type {
  DesktopAuthStatusExchange,
  DesktopAuthStatusRequest,
  DesktopAuthStatusResponse,
} from "./generated/desktop-auth.status";
export type {
  DesktopAuthClaimExchange,
  DesktopAuthClaimRequest,
  DesktopAuthClaimResponse,
} from "./generated/desktop-auth.claim";
export type {
  DesktopAuthConfirmExchange,
  DesktopAuthConfirmRequest,
  DesktopAuthConfirmResponse,
} from "./generated/desktop-auth.confirm";
export type {
  DesktopAuthCancelExchange,
  DesktopAuthCancelRequest,
  DesktopAuthCancelResponse,
} from "./generated/desktop-auth.cancel";
export type {
  DesktopSessionRenewExchange,
  DesktopSessionRenewPrepareRequest,
  DesktopSessionRenewPreparedResponse,
  DesktopSessionRenewConfirmRequest,
  DesktopSessionRenewConfirmedResponse,
} from "./generated/desktop-session.renew";
export type {
  DesktopSessionRevokeExchange,
  DesktopSessionRevokeRequest,
  DesktopSessionRevokeResponse,
} from "./generated/desktop-session.revoke";
export type { DesktopCompatibilityQuery } from "./generated/desktop.compatibility";
export type { DesktopCompatibilityResponse } from "./generated/desktop.compatibility-response";
export type { DesktopPresenceDelivery } from "./generated/desktop.presence-delivery";
export type { ArchiveConversationCommand } from "./generated/conversation.archive";
export type { CreateConversationCommand } from "./generated/conversation.create";
export type {
  ConversationEventContentV2,
  ConversationMetadata as ConversationMetadataV2,
  MembershipCommitment as ConversationMembershipCommitmentV2,
  Transition as ConversationTransitionV2,
} from "./generated/conversation.event-v2";
export type { ConversationFollowClientFrame } from "./generated/conversation.follow-client-frame";
export type { ConversationFollowServerFrame } from "./generated/conversation.follow-server-frame";
export type { FollowConversationQuery } from "./generated/conversation.follow";
export type { GetConversationQuery } from "./generated/conversation.get";
export type { ListConversationsQuery } from "./generated/conversation.list";
export type {
  ConversationSummary,
  ListConversationsResponse,
} from "./generated/conversation.list-response";
export type { JoinConversationCommand } from "./generated/conversation.join";
export type { ConversationJournalSegmentArchive } from "./generated/conversation.journal-segment";
export type { ConversationMembershipJournalSegmentArchiveV2 } from "./generated/conversation.journal-segment-v2";
export type { RemoveConversationMemberCommand } from "./generated/conversation.member-remove";
export type { SetConversationMemberAccessCommand } from "./generated/conversation.member-set-access";
export type { ConversationProjectionMessage } from "./generated/conversation.projection";
export type {
  ConversationProjectionMessageV2,
  MemberDelta as ConversationMemberDeltaV2,
} from "./generated/conversation.projection-v2";
export type { RestoreConversationCommand } from "./generated/conversation.restore";
export type { UpdateConversationCommand } from "./generated/conversation.update";
export type { ConversationView } from "./generated/conversation.view";
export type { Conversation } from "./generated/conversation";
export type { JournalSegmentArchive } from "./generated/journal.segment";
export type { MembershipJournalSegmentArchiveV2 } from "./generated/journal.segment-v2";
export type { MessageReactionProjectionEnvelope } from "./generated/message-reaction.projection";
export type { MessageReaction } from "./generated/message-reaction";
export type { EditMessageCommand } from "./generated/message.edit";
export type { FinalizeMessageErasureCommand } from "./generated/message.finalize-erasure";
export type { MessageHistoryQuery } from "./generated/message.history";
export type { MessageHistoryResponse } from "./generated/message.history-response";
export type { PostMessageCommand } from "./generated/message.post";
export type { PostMessageResponse } from "./generated/message.post-response";
export type { MessageMutationResponse } from "./generated/message.mutation-response";
export type { MessageProjectionMessage } from "./generated/message.projection";
export type { AddMessageReactionCommand } from "./generated/message.reaction-add";
export type { MessageReactionMutationResponse } from "./generated/message.reaction-mutation-response";
export type { RemoveMessageReactionCommand } from "./generated/message.reaction-remove";
export type { ToggleMessageReactionCommand } from "./generated/message.reaction-toggle";
export type { RestoreMessageCommand } from "./generated/message.restore";
export type { RetractMessageCommand } from "./generated/message.retract";
export type { MessageSearchResponse } from "./generated/message.search-response";
export type { MessageSearchQuery } from "./generated/message.search";
export type { MessageView } from "./generated/message.view";
export type { Message } from "./generated/message";
export type { AbandonMediaUploadCommand } from "./generated/media-upload.abandon";
export type { FinalizeMediaUploadCommand } from "./generated/media-upload.finalize";
export type { CreateMediaUploadGrantCommand } from "./generated/media-upload.grant-create";
export type { MediaUploadGrant } from "./generated/media-upload.grant";
export type { MediaUploadPart } from "./generated/media-upload.part";
export type { MediaUploadStatus } from "./generated/media-upload.status";
export type { SignedNostrEvent } from "./generated/nostr.signed-event";
export type { UnsignedNostrEvent } from "./generated/nostr.unsigned-event";
export type { PunksProblem } from "./generated/problem";
export type { PresenceHoldFrame } from "./generated/presence.hold";
export type { SetPresenceStatusSignal } from "./generated/presence.status.set";
export type { PresenceTypingSignal } from "./generated/presence.typing.signal";
export type { PresenceView } from "./generated/presence.view";
export type { PresenceHoldServerFrame } from "./generated/presence.hold-server-frame";
export type { PresenceTypingPatch } from "./generated/presence.typing.patch";
export type { GetPunkProfileQuery } from "./generated/punk.get";
export type { PunkSearchResponse } from "./generated/punk.search-response";
export type { PunkSearchQuery } from "./generated/punk.search";
export type { PunkSummaryBatchResponse } from "./generated/punk.summary-batch-response";
export type { PunkSummaryBatchQuery } from "./generated/punk.summary-batch";
export type { PunkPublicSummary } from "./generated/punk.summary";
export type { UpdatePunkProfileCommand } from "./generated/punk.update";
export type { Punk } from "./generated/punk";
export type { WorkspaceProjectionMessage } from "./generated/workspace.projection";
export type {
  WorkspaceEventContentV2,
  WorkspaceMetadata as WorkspaceMetadataV2,
  MembershipCommitment as WorkspaceMembershipCommitmentV2,
  Transition as WorkspaceTransitionV2,
} from "./generated/workspace.event-v2";
export type {
  MemberDelta as WorkspaceMemberDeltaV2,
  WorkspaceProjectionMessageV2,
} from "./generated/workspace.projection-v2";
export type { PunksWorkspaceView } from "./generated/workspace.punks-view";
export type { PublicWorkspaceView } from "./generated/workspace.public-view";
export type { CreateWorkspaceCommand } from "./generated/workspace.create";
export type { GetWorkspaceQuery } from "./generated/workspace.get";
export type { GetWorkspaceGovernanceQuery } from "./generated/workspace.governance";
export type { WorkspaceGovernanceResponse } from "./generated/workspace.governance-response";
export type { WorkspaceGovernanceView } from "./generated/workspace.governance-view";
export type { ListWorkspacesQuery } from "./generated/workspace.list";
export type {
  ListWorkspacesResponse,
  WorkspaceSummary,
} from "./generated/workspace.list-response";
export type { WorkspaceInvitationView } from "./generated/workspace.invitation";
export type { CreateWorkspaceInvitationCommand } from "./generated/workspace.invite";
export type { GetWorkspaceInvitationQuery } from "./generated/workspace.invite-get";
export type { CreateWorkspaceInvitationResponse } from "./generated/workspace.invite-response";
export type { RevokeWorkspaceInvitationCommand } from "./generated/workspace.invite-revoke";
export type { RevokeWorkspaceInvitationResponse } from "./generated/workspace.invite-revoke-response";
export type { ClaimWorkspaceInvitationCommand } from "./generated/workspace.invite-claim";
export type { ClaimWorkspaceInvitationResponse } from "./generated/workspace.invite-claim-response";
export type { LeaveWorkspaceCommand } from "./generated/workspace.leave";
export type { RemoveWorkspaceMemberCommand } from "./generated/workspace.member-remove";
export type { SetWorkspaceMemberRoleCommand } from "./generated/workspace.member-set-role";
export type { WorkspaceMembershipLifecycleResponse } from "./generated/workspace.membership-lifecycle-response";
export type { WorkspaceMembershipMutationResponse } from "./generated/workspace.membership-mutation-response";
export type { RenameWorkspaceCommand } from "./generated/workspace.rename";
export type { TransferWorkspaceOwnershipCommand } from "./generated/workspace.transfer-ownership";
export type { Workspace } from "./generated/workspace";

export type { ContractId } from "./registry";
export { contractSchemas, validateContract } from "./registry";
