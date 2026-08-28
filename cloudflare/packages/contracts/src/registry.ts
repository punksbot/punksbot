import { Validator } from "@cfworker/json-schema";

import attestationRequest from "../schemas/attestation.request.schema.json";
import attestationResponse from "../schemas/attestation.response.schema.json";
import authProviderProfile from "../schemas/auth.provider-profile.schema.json";
import authSession from "../schemas/auth.session.schema.json";
import accountMergeFreshProof from "../schemas/account-merge.fresh-proof.schema.json";
import accountMergeCommit from "../schemas/account-merge.commit.schema.json";
import accountMergeCommitResponseSource from "../schemas/account-merge.commit-response.schema.json";
import accountMergePlanCreateSource from "../schemas/account-merge.plan-create.schema.json";
import accountMergePlanResponseSource from "../schemas/account-merge.plan-response.schema.json";
import accountMergePlan from "../schemas/account-merge.plan.schema.json";
import accountMergeReceipt from "../schemas/account-merge.receipt.schema.json";
import accountMergeState from "../schemas/account-merge.state.schema.json";
import authStartResponse from "../schemas/auth.start-response.schema.json";
import authStart from "../schemas/auth.start.schema.json";
import desktopAuthCancel from "../schemas/desktop-auth.cancel.schema.json";
import desktopAuthClaim from "../schemas/desktop-auth.claim.schema.json";
import desktopAuthConfirm from "../schemas/desktop-auth.confirm.schema.json";
import desktopAuthStart from "../schemas/desktop-auth.start.schema.json";
import desktopAuthStatus from "../schemas/desktop-auth.status.schema.json";
import desktopSessionRenew from "../schemas/desktop-session.renew.schema.json";
import desktopSessionRevoke from "../schemas/desktop-session.revoke.schema.json";
import authorResolveResponse from "../schemas/author.resolve-response.schema.json";
import authorResolve from "../schemas/author.resolve.schema.json";
import botActionAdmission from "../schemas/bot-action.admission.schema.json";
import botActionAdmit from "../schemas/bot-action.admit.schema.json";
import botActionComplete from "../schemas/bot-action.complete.schema.json";
import botActionDeliveryResult from "../schemas/bot-action.delivery-result.schema.json";
import botActionDeliverySource from "../schemas/bot-action.delivery.schema.json";
import botActionExecuteResult from "../schemas/bot-action.execute-result.schema.json";
import botActionExecute from "../schemas/bot-action.execute.schema.json";
import botActionReplay from "../schemas/bot-action.replay.schema.json";
import botActionReceiptArchive from "../schemas/bot-action.receipt-archive.schema.json";
import botInvocationClaims from "../schemas/bot-invocation.claims.schema.json";
import botInvocationMintResult from "../schemas/bot-invocation.mint-result.schema.json";
import botInvocationMint from "../schemas/bot-invocation.mint.schema.json";
import botInvocationVerifyResult from "../schemas/bot-invocation.verify-result.schema.json";
import botInvocationVerify from "../schemas/bot-invocation.verify.schema.json";
import botRuntimeReactionInvoke from "../schemas/bot-runtime.reaction-invoke.schema.json";
import botRuntimeReactionResult from "../schemas/bot-runtime.reaction-result.schema.json";
import botInstallationConfigure from "../schemas/bot-installation.configure.schema.json";
import botInstallationGet from "../schemas/bot-installation.get.schema.json";
import botInstallationInstall from "../schemas/bot-installation.install.schema.json";
import botInstallationProjectionSource from "../schemas/bot-installation.projection.schema.json";
import botInstallationRevoke from "../schemas/bot-installation.revoke.schema.json";
import botInstallation from "../schemas/bot-installation.schema.json";
import botInstallationJournalSegment from "../schemas/bot-installation.journal-segment.schema.json";
import botInstallationCommandReceiptArchive from "../schemas/bot-installation.command-receipt-archive.schema.json";
import botWakeOffer from "../schemas/bot-wake.offer.schema.json";
import botWakeQueue from "../schemas/bot-wake.queue.schema.json";
import botWakeClaim from "../schemas/bot-wake.claim.schema.json";
import botWakeClaimResult from "../schemas/bot-wake.claim-result.schema.json";
import botWakeComplete from "../schemas/bot-wake.complete.schema.json";
import botWakeReceiptArchive from "../schemas/bot-wake.receipt-archive.schema.json";
import botConfigEmpty from "../schemas/bot.config.empty.schema.json";
import botGet from "../schemas/bot.get.schema.json";
import botProjectionSource from "../schemas/bot.projection.schema.json";
import botPublish from "../schemas/bot.publish.schema.json";
import botUpdate from "../schemas/bot.update.schema.json";
import bot from "../schemas/bot.schema.json";
import botJournalSegment from "../schemas/bot.journal-segment.schema.json";
import botCommandReceiptArchive from "../schemas/bot.command-receipt-archive.schema.json";
import contractRegistry from "../schemas/contract-registry.schema.json";
import conversationArchive from "../schemas/conversation.archive.schema.json";
import conversationCreate from "../schemas/conversation.create.schema.json";
import conversationEventV2 from "../schemas/conversation.event-v2.schema.json";
import conversationFollowClientFrame from "../schemas/conversation.follow-client-frame.schema.json";
import conversationFollowServerFrameSource from "../schemas/conversation.follow-server-frame.schema.json";
import conversationFollow from "../schemas/conversation.follow.schema.json";
import conversationGet from "../schemas/conversation.get.schema.json";
import conversationJoin from "../schemas/conversation.join.schema.json";
import conversationListResponse from "../schemas/conversation.list-response.schema.json";
import conversationList from "../schemas/conversation.list.schema.json";
import conversationJournalSegment from "../schemas/conversation.journal-segment.schema.json";
import conversationJournalSegmentV2Source from "../schemas/conversation.journal-segment-v2.schema.json";
import conversationMemberRemove from "../schemas/conversation.member-remove.schema.json";
import conversationMemberSetAccess from "../schemas/conversation.member-set-access.schema.json";
import conversationProjectionSource from "../schemas/conversation.projection.schema.json";
import conversationProjectionV2Source from "../schemas/conversation.projection-v2.schema.json";
import conversationRestore from "../schemas/conversation.restore.schema.json";
import conversationUpdate from "../schemas/conversation.update.schema.json";
import conversationView from "../schemas/conversation.view.schema.json";
import conversation from "../schemas/conversation.schema.json";
import desktopCompatibilityResponse from "../schemas/desktop.compatibility-response.schema.json";
import desktopCompatibility from "../schemas/desktop.compatibility.schema.json";
import desktopPresenceDeliverySource from "../schemas/desktop.presence-delivery.schema.json";
import journalSegment from "../schemas/journal.segment.schema.json";
import journalSegmentV2Source from "../schemas/journal.segment-v2.schema.json";
import messageReactionProjectionSource from "../schemas/message-reaction.projection.schema.json";
import messageReaction from "../schemas/message-reaction.schema.json";
import messageEdit from "../schemas/message.edit.schema.json";
import messageFinalizeErasure from "../schemas/message.finalize-erasure.schema.json";
import messageHistoryResponseSource from "../schemas/message.history-response.schema.json";
import messageHistory from "../schemas/message.history.schema.json";
import messageMutationResponseSource from "../schemas/message.mutation-response.schema.json";
import messagePost from "../schemas/message.post.schema.json";
import messagePostResponseSource from "../schemas/message.post-response.schema.json";
import messageProjectionSource from "../schemas/message.projection.schema.json";
import messageReactionAdd from "../schemas/message.reaction-add.schema.json";
import messageReactionMutationResponse from "../schemas/message.reaction-mutation-response.schema.json";
import messageReactionRemove from "../schemas/message.reaction-remove.schema.json";
import messageReactionToggle from "../schemas/message.reaction-toggle.schema.json";
import messageRestore from "../schemas/message.restore.schema.json";
import messageRetract from "../schemas/message.retract.schema.json";
import messageSearchResponseSource from "../schemas/message.search-response.schema.json";
import messageSearch from "../schemas/message.search.schema.json";
import messageView from "../schemas/message.view.schema.json";
import message from "../schemas/message.schema.json";
import mediaUploadAbandon from "../schemas/media-upload.abandon.schema.json";
import mediaUploadFinalize from "../schemas/media-upload.finalize.schema.json";
import mediaUploadGrantCreate from "../schemas/media-upload.grant-create.schema.json";
import mediaUploadGrantSource from "../schemas/media-upload.grant.schema.json";
import mediaUploadPart from "../schemas/media-upload.part.schema.json";
import mediaUploadStatus from "../schemas/media-upload.status.schema.json";
import signedEvent from "../schemas/nostr.signed-event.schema.json";
import unsignedEvent from "../schemas/nostr.unsigned-event.schema.json";
import problem from "../schemas/problem.schema.json";
import presenceHoldServerFrameSource from "../schemas/presence.hold-server-frame.schema.json";
import presenceHold from "../schemas/presence.hold.schema.json";
import presenceStatusSet from "../schemas/presence.status.set.schema.json";
import presenceTypingPatch from "../schemas/presence.typing.patch.schema.json";
import presenceTypingSignal from "../schemas/presence.typing.signal.schema.json";
import presenceView from "../schemas/presence.view.schema.json";
import punk from "../schemas/punk.schema.json";
import punkGet from "../schemas/punk.get.schema.json";
import punkSearchResponse from "../schemas/punk.search-response.schema.json";
import punkSearch from "../schemas/punk.search.schema.json";
import punkSummaryBatchResponse from "../schemas/punk.summary-batch-response.schema.json";
import punkSummaryBatch from "../schemas/punk.summary-batch.schema.json";
import punkSummary from "../schemas/punk.summary.schema.json";
import punkUpdate from "../schemas/punk.update.schema.json";
import workspaceProjection from "../schemas/workspace.projection.schema.json";
import workspaceEventV2 from "../schemas/workspace.event-v2.schema.json";
import workspaceProjectionV2Source from "../schemas/workspace.projection-v2.schema.json";
import workspacePunksView from "../schemas/workspace.punks-view.schema.json";
import workspacePublicView from "../schemas/workspace.public-view.schema.json";
import workspaceCreate from "../schemas/workspace.create.schema.json";
import workspaceGet from "../schemas/workspace.get.schema.json";
import workspaceGovernanceResponseSource from "../schemas/workspace.governance-response.schema.json";
import workspaceGovernanceView from "../schemas/workspace.governance-view.schema.json";
import workspaceGovernance from "../schemas/workspace.governance.schema.json";
import workspaceListResponse from "../schemas/workspace.list-response.schema.json";
import workspaceList from "../schemas/workspace.list.schema.json";
import workspaceInvitation from "../schemas/workspace.invitation.schema.json";
import workspaceInviteClaimResponse from "../schemas/workspace.invite-claim-response.schema.json";
import workspaceInviteClaim from "../schemas/workspace.invite-claim.schema.json";
import workspaceInviteGet from "../schemas/workspace.invite-get.schema.json";
import workspaceInviteResponseSource from "../schemas/workspace.invite-response.schema.json";
import workspaceInviteRevokeResponseSource from "../schemas/workspace.invite-revoke-response.schema.json";
import workspaceInviteRevoke from "../schemas/workspace.invite-revoke.schema.json";
import workspaceInvite from "../schemas/workspace.invite.schema.json";
import workspaceLeave from "../schemas/workspace.leave.schema.json";
import workspaceMemberRemove from "../schemas/workspace.member-remove.schema.json";
import workspaceMemberSetRole from "../schemas/workspace.member-set-role.schema.json";
import workspaceMembershipLifecycleResponse from "../schemas/workspace.membership-lifecycle-response.schema.json";
import workspaceMembershipMutationResponseSource from "../schemas/workspace.membership-mutation-response.schema.json";
import workspaceRename from "../schemas/workspace.rename.schema.json";
import workspaceTransferOwnership from "../schemas/workspace.transfer-ownership.schema.json";
import workspace from "../schemas/workspace.schema.json";

const accountMergePlanCreate = {
  ...accountMergePlanCreateSource,
  properties: {
    ...accountMergePlanCreateSource.properties,
    proofs: {
      ...accountMergePlanCreateSource.properties.proofs,
      items: accountMergeFreshProof,
    },
  },
};

const workspaceInviteResponse = {
  ...workspaceInviteResponseSource,
  properties: {
    ...workspaceInviteResponseSource.properties,
    invitation: workspaceInvitation,
  },
};

const workspaceInviteRevokeResponse = {
  ...workspaceInviteRevokeResponseSource,
  properties: {
    ...workspaceInviteRevokeResponseSource.properties,
    invitation: workspaceInvitation,
  },
};

const workspaceMembershipMutationResponse = {
  ...workspaceMembershipMutationResponseSource,
  properties: {
    ...workspaceMembershipMutationResponseSource.properties,
    workspace: workspaceGovernanceView,
  },
};

const workspaceGovernanceResponse = {
  ...workspaceGovernanceResponseSource,
  properties: {
    ...workspaceGovernanceResponseSource.properties,
    workspace: workspaceGovernanceView,
  },
};

const mediaUploadGrant = {
  ...mediaUploadGrantSource,
  properties: {
    ...mediaUploadGrantSource.properties,
    status: mediaUploadStatus,
  },
};

const [accountMergePlanSuccess, accountMergePlanFailure] =
  accountMergePlanResponseSource.oneOf;
if (
  accountMergePlanSuccess === undefined ||
  accountMergePlanFailure === undefined
) {
  throw new Error("account-merge.plan-response@1 must remain a closed union");
}
const accountMergePlanResponse = {
  ...accountMergePlanResponseSource,
  oneOf: [
    {
      ...accountMergePlanSuccess,
      properties: {
        ...accountMergePlanSuccess.properties,
        plan: accountMergePlan,
      },
    },
    accountMergePlanFailure,
  ],
};

const [accountMergeCommitSuccess, accountMergeCommitFailure] =
  accountMergeCommitResponseSource.oneOf;
if (
  accountMergeCommitSuccess === undefined ||
  accountMergeCommitFailure === undefined
) {
  throw new Error("account-merge.commit-response@1 must remain a closed union");
}
const accountMergeCommitResponse = {
  ...accountMergeCommitResponseSource,
  oneOf: [
    {
      ...accountMergeCommitSuccess,
      properties: {
        ...accountMergeCommitSuccess.properties,
        state: accountMergeState,
      },
    },
    accountMergeCommitFailure,
  ],
};

const conversationProjection = {
  ...conversationProjectionSource,
  properties: {
    ...conversationProjectionSource.properties,
    event: signedEvent,
    state: conversation,
  },
};

const conversationProjectionV2 = {
  ...conversationProjectionV2Source,
  properties: {
    ...conversationProjectionV2Source.properties,
    event: signedEvent,
  },
};

const workspaceProjectionV2 = {
  ...workspaceProjectionV2Source,
  properties: {
    ...workspaceProjectionV2Source.properties,
    event: signedEvent,
  },
};

const embeddedSignedEvent = Object.fromEntries(
  Object.entries(signedEvent).filter(
    ([key]) => key !== "$id" && key !== "$schema",
  ),
);

const journalSegmentV2 = {
  ...journalSegmentV2Source,
  properties: {
    ...journalSegmentV2Source.properties,
    entries: {
      ...journalSegmentV2Source.properties.entries,
      items: {
        ...journalSegmentV2Source.properties.entries.items,
        properties: {
          ...journalSegmentV2Source.properties.entries.items.properties,
          event: embeddedSignedEvent,
          chunks: {
            ...journalSegmentV2Source.properties.entries.items.properties
              .chunks,
            items: {
              ...workspaceProjectionV2,
              properties: {
                ...workspaceProjectionV2.properties,
                event: embeddedSignedEvent,
              },
            },
          },
        },
      },
    },
  },
};

const conversationJournalSegmentV2 = {
  ...conversationJournalSegmentV2Source,
  properties: {
    ...conversationJournalSegmentV2Source.properties,
    entries: {
      ...conversationJournalSegmentV2Source.properties.entries,
      items: {
        ...conversationJournalSegmentV2Source.properties.entries.items,
        properties: {
          ...conversationJournalSegmentV2Source.properties.entries.items
            .properties,
          event: embeddedSignedEvent,
          chunks: {
            ...conversationJournalSegmentV2Source.properties.entries.items
              .properties.chunks,
            items: {
              ...conversationProjectionV2,
              properties: {
                ...conversationProjectionV2.properties,
                event: embeddedSignedEvent,
              },
            },
          },
        },
      },
    },
  },
};

const botProjection = {
  ...botProjectionSource,
  properties: {
    ...botProjectionSource.properties,
    event: signedEvent,
    state: bot,
  },
};

const botInstallationProjection = {
  ...botInstallationProjectionSource,
  properties: {
    ...botInstallationProjectionSource.properties,
    event: signedEvent,
  },
  $defs: {
    ...botInstallationProjectionSource.$defs,
    admission: botActionAdmission,
  },
};

const conversationFollowServerFrame = {
  ...conversationFollowServerFrameSource,
  $defs: {
    ...conversationFollowServerFrameSource.$defs,
    changes: {
      ...conversationFollowServerFrameSource.$defs.changes,
      properties: {
        ...conversationFollowServerFrameSource.$defs.changes.properties,
        messages: {
          ...conversationFollowServerFrameSource.$defs.changes.properties
            .messages,
          items: messageView,
        },
      },
    },
    typing: {
      ...conversationFollowServerFrameSource.$defs.typing,
      properties: {
        ...conversationFollowServerFrameSource.$defs.typing.properties,
        patch: presenceTypingPatch,
      },
    },
  },
};

const presenceHoldServerFrame = {
  ...presenceHoldServerFrameSource,
  $defs: {
    ...presenceHoldServerFrameSource.$defs,
    presenceView: Object.fromEntries(
      Object.entries(presenceView).filter(([key]) => key !== "$id"),
    ),
    accepted: {
      ...presenceHoldServerFrameSource.$defs.accepted,
      properties: {
        ...presenceHoldServerFrameSource.$defs.accepted.properties,
        presences: {
          ...presenceHoldServerFrameSource.$defs.accepted.properties.presences,
          items: { $ref: "#/$defs/presenceView" },
        },
      },
    },
    presence: {
      ...presenceHoldServerFrameSource.$defs.presence,
      properties: {
        ...presenceHoldServerFrameSource.$defs.presence.properties,
        presence: { $ref: "#/$defs/presenceView" },
      },
    },
  },
};

const desktopPresenceDelivery = {
  ...desktopPresenceDeliverySource,
  $defs: {
    ...desktopPresenceDeliverySource.$defs,
    presenceView: Object.fromEntries(
      Object.entries(presenceView).filter(([key]) => key !== "$id"),
    ),
    accepted: {
      ...desktopPresenceDeliverySource.$defs.accepted,
      properties: {
        ...desktopPresenceDeliverySource.$defs.accepted.properties,
        presences: {
          ...desktopPresenceDeliverySource.$defs.accepted.properties.presences,
          items: { $ref: "#/$defs/presenceView" },
        },
      },
    },
    presence: {
      ...desktopPresenceDeliverySource.$defs.presence,
      properties: {
        ...desktopPresenceDeliverySource.$defs.presence.properties,
        presence: { $ref: "#/$defs/presenceView" },
      },
    },
  },
};

const messageProjection = {
  ...messageProjectionSource,
  properties: {
    ...messageProjectionSource.properties,
    event: signedEvent,
  },
};

const messageReactionProjection = {
  ...messageReactionProjectionSource,
  properties: {
    ...messageReactionProjectionSource.properties,
    event: signedEvent,
  },
};

const messageHistoryResponse = {
  ...messageHistoryResponseSource,
  properties: {
    ...messageHistoryResponseSource.properties,
    items: {
      ...messageHistoryResponseSource.properties.items,
      items: messageView,
    },
  },
};

const messagePostResponse = {
  ...messagePostResponseSource,
  properties: {
    ...messagePostResponseSource.properties,
    message: messageView,
  },
};

const messageSearchResponse = {
  ...messageSearchResponseSource,
  properties: {
    ...messageSearchResponseSource.properties,
    items: {
      ...messageSearchResponseSource.properties.items,
      items: {
        ...messageSearchResponseSource.properties.items.items,
        allOf: [
          messageView,
          messageSearchResponseSource.properties.items.items.allOf[1],
        ],
      },
    },
  },
};

const messageMutationResponse = {
  ...messageMutationResponseSource,
  properties: {
    ...messageMutationResponseSource.properties,
    message: messageView,
  },
};

function deliveryReactionSchema(
  source:
    | typeof messageReactionAdd
    | typeof messageReactionRemove
    | typeof messageReactionToggle,
) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["contract", "conversationId", "messageId", "payload"],
    properties: {
      contract: source.properties.contract,
      conversationId: {
        allOf: [
          source.properties.conversationId,
          botActionDeliverySource.$defs.opaqueUuid,
        ],
      },
      messageId: {
        allOf: [
          source.properties.messageId,
          botActionDeliverySource.$defs.opaqueUuid,
        ],
      },
      payload: source.$defs.payload,
    },
  } as const;
}

const botActionDelivery = {
  ...botActionDeliverySource,
  properties: {
    ...botActionDeliverySource.properties,
    proof: {
      allOf: [
        signedEvent,
        {
          type: "object",
          required: ["kind", "tags", "content"],
          properties: {
            kind: { type: "integer", const: 50320 },
            tags: {
              type: "array",
              maxItems: 32,
            },
            content: { type: "string", maxLength: 8192 },
          },
        },
      ],
    },
    action: {
      oneOf: [
        deliveryReactionSchema(messageReactionAdd),
        deliveryReactionSchema(messageReactionRemove),
        deliveryReactionSchema(messageReactionToggle),
      ],
    },
  },
};

export const contractSchemas = {
  "punks://contracts/registry@1": contractRegistry,
  "punks://contracts/journal.segment@1": journalSegment,
  "punks://contracts/journal.segment@2": journalSegmentV2,
  "punks://contracts/problem@1": problem,
  "punks://contracts/punk@1": punk,
  "punks://contracts/punk.get@1": punkGet,
  "punks://contracts/punk.update@1": punkUpdate,
  "punks://contracts/punk.summary@1": punkSummary,
  "punks://contracts/punk.summary-batch@1": punkSummaryBatch,
  "punks://contracts/punk.summary-batch-response@1": punkSummaryBatchResponse,
  "punks://contracts/punk.search@1": punkSearch,
  "punks://contracts/punk.search-response@1": punkSearchResponse,
  "punks://contracts/bot@1": bot,
  "punks://contracts/bot.publish@1": botPublish,
  "punks://contracts/bot.update@1": botUpdate,
  "punks://contracts/bot.config.empty@1": botConfigEmpty,
  "punks://contracts/bot.get@1": botGet,
  "punks://contracts/bot.projection@1": botProjection,
  "punks://contracts/bot.journal-segment@1": botJournalSegment,
  "punks://contracts/bot.command-receipt-archive@1": botCommandReceiptArchive,
  "punks://contracts/bot-installation@1": botInstallation,
  "punks://contracts/bot-installation.install@1": botInstallationInstall,
  "punks://contracts/bot-installation.configure@1": botInstallationConfigure,
  "punks://contracts/bot-installation.revoke@1": botInstallationRevoke,
  "punks://contracts/bot-installation.get@1": botInstallationGet,
  "punks://contracts/bot-installation.projection@1": botInstallationProjection,
  "punks://contracts/bot-installation.journal-segment@1":
    botInstallationJournalSegment,
  "punks://contracts/bot-installation.command-receipt-archive@1":
    botInstallationCommandReceiptArchive,
  "punks://contracts/bot-wake.offer@1": botWakeOffer,
  "punks://contracts/bot-wake.queue@1": botWakeQueue,
  "punks://contracts/bot-wake.claim@1": botWakeClaim,
  "punks://contracts/bot-wake.claim-result@1": botWakeClaimResult,
  "punks://contracts/bot-wake.complete@1": botWakeComplete,
  "punks://contracts/bot-wake.receipt-archive@1": botWakeReceiptArchive,
  "punks://contracts/bot-action.admission@1": botActionAdmission,
  "punks://contracts/bot-action.admit@1": botActionAdmit,
  "punks://contracts/bot-action.replay@1": botActionReplay,
  "punks://contracts/bot-action.complete@1": botActionComplete,
  "punks://contracts/bot-action.execute@1": botActionExecute,
  "punks://contracts/bot-action.execute-result@1": botActionExecuteResult,
  "punks://contracts/bot-action.delivery@1": botActionDelivery,
  "punks://contracts/bot-action.delivery-result@1": botActionDeliveryResult,
  "punks://contracts/bot-action.receipt-archive@1": botActionReceiptArchive,
  "punks://contracts/bot-invocation.claims@1": botInvocationClaims,
  "punks://contracts/bot-invocation.mint@1": botInvocationMint,
  "punks://contracts/bot-invocation.mint-result@1": botInvocationMintResult,
  "punks://contracts/bot-invocation.verify@1": botInvocationVerify,
  "punks://contracts/bot-invocation.verify-result@1": botInvocationVerifyResult,
  "punks://contracts/bot-runtime.reaction-invoke@1": botRuntimeReactionInvoke,
  "punks://contracts/bot-runtime.reaction-result@1": botRuntimeReactionResult,
  "punks://contracts/auth.start@1": authStart,
  "punks://contracts/auth.start-response@1": authStartResponse,
  "punks://contracts/desktop-auth.start@1": desktopAuthStart,
  "punks://contracts/desktop-auth.status@1": desktopAuthStatus,
  "punks://contracts/desktop-auth.claim@1": desktopAuthClaim,
  "punks://contracts/desktop-auth.confirm@1": desktopAuthConfirm,
  "punks://contracts/desktop-auth.cancel@1": desktopAuthCancel,
  "punks://contracts/desktop-session.renew@1": desktopSessionRenew,
  "punks://contracts/desktop-session.revoke@1": desktopSessionRevoke,
  "punks://contracts/auth.provider-profile@1": authProviderProfile,
  "punks://contracts/auth.session@1": authSession,
  "punks://contracts/account-merge.fresh-proof@1": accountMergeFreshProof,
  "punks://contracts/account-merge.plan-create@1": accountMergePlanCreate,
  "punks://contracts/account-merge.plan@1": accountMergePlan,
  "punks://contracts/account-merge.plan-response@1": accountMergePlanResponse,
  "punks://contracts/account-merge.commit@1": accountMergeCommit,
  "punks://contracts/account-merge.receipt@1": accountMergeReceipt,
  "punks://contracts/account-merge.state@1": accountMergeState,
  "punks://contracts/account-merge.commit-response@1":
    accountMergeCommitResponse,
  "punks://contracts/desktop.compatibility@1": desktopCompatibility,
  "punks://contracts/desktop.compatibility-response@1":
    desktopCompatibilityResponse,
  "punks://contracts/author.resolve@1": authorResolve,
  "punks://contracts/author.resolve-response@1": authorResolveResponse,
  "punks://contracts/conversation@1": conversation,
  "punks://contracts/conversation.archive@1": conversationArchive,
  "punks://contracts/conversation.create@1": conversationCreate,
  "punks://contracts/conversation.follow@1": conversationFollow,
  "punks://contracts/conversation.follow-client-frame@1":
    conversationFollowClientFrame,
  "punks://contracts/conversation.follow-server-frame@1":
    conversationFollowServerFrame,
  "punks://contracts/presence.hold@1": presenceHold,
  "punks://contracts/presence.status.set@1": presenceStatusSet,
  "punks://contracts/presence.typing.signal@1": presenceTypingSignal,
  "punks://contracts/presence.view@1": presenceView,
  "punks://contracts/presence.hold-server-frame@1": presenceHoldServerFrame,
  "punks://contracts/presence.typing.patch@1": presenceTypingPatch,
  "punks://contracts/desktop.presence-delivery@1": desktopPresenceDelivery,
  "punks://contracts/conversation.get@1": conversationGet,
  "punks://contracts/conversation.list@1": conversationList,
  "punks://contracts/conversation.list-response@1": conversationListResponse,
  "punks://contracts/conversation.join@1": conversationJoin,
  "punks://contracts/conversation.journal-segment@1":
    conversationJournalSegment,
  "punks://contracts/conversation.journal-segment@2":
    conversationJournalSegmentV2,
  "punks://contracts/conversation.member-remove@1": conversationMemberRemove,
  "punks://contracts/conversation.member-set-access@1":
    conversationMemberSetAccess,
  "punks://contracts/conversation.projection@1": conversationProjection,
  "punks://contracts/conversation.event@2": conversationEventV2,
  "punks://contracts/conversation.projection@2": conversationProjectionV2,
  "punks://contracts/conversation.restore@1": conversationRestore,
  "punks://contracts/conversation.update@1": conversationUpdate,
  "punks://contracts/conversation.view@1": conversationView,
  "punks://contracts/message@1": message,
  "punks://contracts/message-reaction@1": messageReaction,
  "punks://contracts/message-reaction.projection@1": messageReactionProjection,
  "punks://contracts/message.edit@1": messageEdit,
  "punks://contracts/message.finalize-erasure@1": messageFinalizeErasure,
  "punks://contracts/message.history@1": messageHistory,
  "punks://contracts/message.history-response@1": messageHistoryResponse,
  "punks://contracts/message.post@1": messagePost,
  "punks://contracts/message.post-response@1": messagePostResponse,
  "punks://contracts/message.mutation-response@1": messageMutationResponse,
  "punks://contracts/message.projection@1": messageProjection,
  "punks://contracts/message.reaction-add@1": messageReactionAdd,
  "punks://contracts/message.reaction-mutation-response@1":
    messageReactionMutationResponse,
  "punks://contracts/message.reaction-remove@1": messageReactionRemove,
  "punks://contracts/message.reaction-toggle@1": messageReactionToggle,
  "punks://contracts/message.restore@1": messageRestore,
  "punks://contracts/message.retract@1": messageRetract,
  "punks://contracts/message.search@1": messageSearch,
  "punks://contracts/message.search-response@1": messageSearchResponse,
  "punks://contracts/message.view@1": messageView,
  "punks://contracts/media-upload.grant-create@1": mediaUploadGrantCreate,
  "punks://contracts/media-upload.grant@1": mediaUploadGrant,
  "punks://contracts/media-upload.part@1": mediaUploadPart,
  "punks://contracts/media-upload.finalize@1": mediaUploadFinalize,
  "punks://contracts/media-upload.abandon@1": mediaUploadAbandon,
  "punks://contracts/media-upload.status@1": mediaUploadStatus,
  "punks://contracts/workspace@1": workspace,
  "punks://contracts/workspace.create@1": workspaceCreate,
  "punks://contracts/workspace.get@1": workspaceGet,
  "punks://contracts/workspace.governance@1": workspaceGovernance,
  "punks://contracts/workspace.governance-response@1":
    workspaceGovernanceResponse,
  "punks://contracts/workspace.governance-view@1": workspaceGovernanceView,
  "punks://contracts/workspace.list@1": workspaceList,
  "punks://contracts/workspace.list-response@1": workspaceListResponse,
  "punks://contracts/workspace.invitation@1": workspaceInvitation,
  "punks://contracts/workspace.invite@1": workspaceInvite,
  "punks://contracts/workspace.invite-get@1": workspaceInviteGet,
  "punks://contracts/workspace.invite-response@1": workspaceInviteResponse,
  "punks://contracts/workspace.invite-revoke@1": workspaceInviteRevoke,
  "punks://contracts/workspace.invite-revoke-response@1":
    workspaceInviteRevokeResponse,
  "punks://contracts/workspace.invite-claim@1": workspaceInviteClaim,
  "punks://contracts/workspace.invite-claim-response@1":
    workspaceInviteClaimResponse,
  "punks://contracts/workspace.leave@1": workspaceLeave,
  "punks://contracts/workspace.member-remove@1": workspaceMemberRemove,
  "punks://contracts/workspace.member-set-role@1": workspaceMemberSetRole,
  "punks://contracts/workspace.membership-lifecycle-response@1":
    workspaceMembershipLifecycleResponse,
  "punks://contracts/workspace.membership-mutation-response@1":
    workspaceMembershipMutationResponse,
  "punks://contracts/workspace.rename@1": workspaceRename,
  "punks://contracts/workspace.transfer-ownership@1":
    workspaceTransferOwnership,
  "punks://contracts/nostr.unsigned-event@1": unsignedEvent,
  "punks://contracts/nostr.signed-event@1": signedEvent,
  "punks://contracts/attestation.request@1": attestationRequest,
  "punks://contracts/attestation.response@1": attestationResponse,
  "punks://contracts/workspace.projection@1": workspaceProjection,
  "punks://contracts/workspace.event@2": workspaceEventV2,
  "punks://contracts/workspace.projection@2": workspaceProjectionV2,
  "punks://contracts/workspace.punks-view@1": workspacePunksView,
  "punks://contracts/workspace.public-view@1": workspacePublicView,
} as const;

export type ContractId = keyof typeof contractSchemas;

const validators = new Map<ContractId, Validator>();

export function validateContract(
  contractId: ContractId,
  value: unknown,
): { valid: true } | { valid: false; errors: readonly unknown[] } {
  let validator = validators.get(contractId);
  if (validator === undefined) {
    validator = new Validator(
      contractSchemas[contractId] as never,
      "2020-12",
      false,
    );
    validators.set(contractId, validator);
  }

  const result = validator.validate(value);
  if (result.valid) {
    return { valid: true };
  }
  return { valid: false, errors: result.errors };
}
