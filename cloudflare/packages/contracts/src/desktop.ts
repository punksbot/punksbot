import { Validator } from "@cfworker/json-schema";

import authSession from "../schemas/auth.session.schema.json";
import conversationListResponse from "../schemas/conversation.list-response.schema.json";
import conversationView from "../schemas/conversation.view.schema.json";
import desktopCompatibilityResponse from "../schemas/desktop.compatibility-response.schema.json";
import messageHistoryResponseSource from "../schemas/message.history-response.schema.json";
import messageMutationResponseSource from "../schemas/message.mutation-response.schema.json";
import messageReactionMutationResponse from "../schemas/message.reaction-mutation-response.schema.json";
import messageView from "../schemas/message.view.schema.json";
import punkSearchResponse from "../schemas/punk.search-response.schema.json";
import punkSummaryBatchResponse from "../schemas/punk.summary-batch-response.schema.json";
import punk from "../schemas/punk.schema.json";
import workspaceListResponse from "../schemas/workspace.list-response.schema.json";
import workspaceInvitation from "../schemas/workspace.invitation.schema.json";
import workspaceInviteClaimResponse from "../schemas/workspace.invite-claim-response.schema.json";
import workspaceInviteResponseSource from "../schemas/workspace.invite-response.schema.json";
import workspaceInviteRevokeResponseSource from "../schemas/workspace.invite-revoke-response.schema.json";
import workspaceMembershipMutationResponseSource from "../schemas/workspace.membership-mutation-response.schema.json";
import workspace from "../schemas/workspace.schema.json";

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

const messageMutationResponse = {
  ...messageMutationResponseSource,
  properties: {
    ...messageMutationResponseSource.properties,
    message: messageView,
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
    workspace,
  },
};

/** Exact response contracts consumed by the isolated desktop product. */
export const desktopContractSchemas = {
  "punks://contracts/auth.session@1": authSession,
  "punks://contracts/conversation.list-response@1": conversationListResponse,
  "punks://contracts/conversation.view@1": conversationView,
  "punks://contracts/desktop.compatibility-response@1":
    desktopCompatibilityResponse,
  "punks://contracts/message.history-response@1": messageHistoryResponse,
  "punks://contracts/message.mutation-response@1": messageMutationResponse,
  "punks://contracts/message.reaction-mutation-response@1":
    messageReactionMutationResponse,
  "punks://contracts/message.view@1": messageView,
  "punks://contracts/punk@1": punk,
  "punks://contracts/punk.search-response@1": punkSearchResponse,
  "punks://contracts/punk.summary-batch-response@1": punkSummaryBatchResponse,
  "punks://contracts/workspace.list-response@1": workspaceListResponse,
  "punks://contracts/workspace@1": workspace,
  "punks://contracts/workspace.invitation@1": workspaceInvitation,
  "punks://contracts/workspace.invite-response@1": workspaceInviteResponse,
  "punks://contracts/workspace.invite-revoke-response@1":
    workspaceInviteRevokeResponse,
  "punks://contracts/workspace.invite-claim-response@1":
    workspaceInviteClaimResponse,
  "punks://contracts/workspace.membership-mutation-response@1":
    workspaceMembershipMutationResponse,
} as const;

export type DesktopContractId = keyof typeof desktopContractSchemas;

const validators = new Map<DesktopContractId, Validator>();

/**
 * Validate a native desktop response without importing the server-wide
 * contract registry into the distributable client.
 */
export function validateDesktopContract(
  contractId: DesktopContractId,
  value: unknown,
): { valid: true } | { valid: false; errors: readonly unknown[] } {
  let validator = validators.get(contractId);
  if (validator === undefined) {
    validator = new Validator(
      desktopContractSchemas[contractId] as never,
      "2020-12",
      false,
    );
    validators.set(contractId, validator);
  }

  const result = validator.validate(value);
  return result.valid
    ? { valid: true }
    : { valid: false, errors: result.errors };
}
