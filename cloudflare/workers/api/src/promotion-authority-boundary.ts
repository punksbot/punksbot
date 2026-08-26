import type {
  PromotionAuthorityFaultIdentity,
  PromotionAuthorityFaultRecovery,
  PromotionAuthorityFaultState,
} from "../../../shared/promotion-faultable-do";

import type { ApiEnv } from "./env";

export interface PromotionAuthorityBoundaryState
  extends PromotionAuthorityFaultState {
  worker: string;
  binding: string;
  className: string;
}

interface PromotionAuthorityStub {
  injectPromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState>;
  recoverPromotionFault(
    input: PromotionAuthorityFaultRecovery,
  ): Promise<PromotionAuthorityFaultState>;
  probePromotionFault(
    executionId: string,
  ): Promise<PromotionAuthorityFaultState | null>;
  observePromotionFault(
    executionId: string,
  ): Promise<PromotionAuthorityFaultState>;
}

interface AuthorityTarget {
  worker: string;
  binding: string;
  className: string;
  stub: PromotionAuthorityStub;
}

const AUTH_TARGETS: Record<string, { binding: string; className: string }> = {
  "auth-punk": { binding: "PUNKS", className: "PunkDO" },
  "auth-session-revocation": {
    binding: "SESSION_REVOCATIONS",
    className: "SessionRevocationDO",
  },
  "auth-session": { binding: "SESSIONS", className: "SessionDO" },
};

function apiTarget(
  env: ApiEnv,
  authority: string,
  targetId: string,
): AuthorityTarget | null {
  if (authority === "api-workspace") {
    return {
      worker: "punks-api-staging",
      binding: "WORKSPACES",
      className: "WorkspaceDO",
      stub: env.WORKSPACES.getByName(targetId),
    };
  }
  if (authority === "api-workspace-slug") {
    return {
      worker: "punks-api-staging",
      binding: "WORKSPACE_SLUGS",
      className: "WorkspaceSlugDO",
      stub: env.WORKSPACE_SLUGS.getByName(targetId),
    };
  }
  if (authority === "api-conversation") {
    return {
      worker: "punks-api-staging",
      binding: "CONVERSATIONS",
      className: "ConversationDO",
      stub: env.CONVERSATIONS.getByName(targetId),
    };
  }
  if (authority === "api-message-content") {
    return {
      worker: "punks-api-staging",
      binding: "MESSAGE_CONTENT",
      className: "MessageContentDO",
      stub: env.MESSAGE_CONTENT.getByName(targetId),
    };
  }
  return null;
}

function target(
  env: ApiEnv,
  identity: PromotionAuthorityFaultIdentity,
): AuthorityTarget {
  const selected = apiTarget(env, identity.authority, identity.target.id);
  if (selected !== null) return selected;
  const auth = AUTH_TARGETS[identity.authority];
  if (auth !== undefined) {
    return {
      worker: "punks-auth-staging",
      binding: auth.binding,
      className: auth.className,
      stub: {
        injectPromotionFault: (input) =>
          env.AUTH_PROMOTION_FAULTS.injectPromotionFault(input),
        recoverPromotionFault: (input) =>
          env.AUTH_PROMOTION_FAULTS.recoverPromotionFault(input),
        probePromotionFault: () =>
          env.AUTH_PROMOTION_FAULTS.probePromotionFault(identity),
        observePromotionFault: () =>
          env.AUTH_PROMOTION_FAULTS.observePromotionFault(identity),
      },
    };
  }
  if (identity.authority === "erasure-registry") {
    return {
      worker: "punks-erasure-staging",
      binding: "PROMOTION_AUTHORITY_FAULTS",
      className: "PromotionAuthorityFaultDO",
      stub: {
        injectPromotionFault: (input) =>
          env.ERASURE_PROMOTION_FAULTS.injectPromotionFault(input),
        recoverPromotionFault: (input) =>
          env.ERASURE_PROMOTION_FAULTS.recoverPromotionFault(input),
        probePromotionFault: () =>
          env.ERASURE_PROMOTION_FAULTS.probePromotionFault(identity),
        observePromotionFault: () =>
          env.ERASURE_PROMOTION_FAULTS.observePromotionFault(identity),
      },
    };
  }
  if (identity.authority === "internal-event-signature") {
    return {
      worker: "punks-attestation-staging",
      binding: "PROMOTION_AUTHORITY_FAULTS",
      className: "PromotionAuthorityFaultDO",
      stub: {
        injectPromotionFault: (input) =>
          env.ATTESTATION_PROMOTION_FAULTS.injectPromotionFault(input),
        recoverPromotionFault: (input) =>
          env.ATTESTATION_PROMOTION_FAULTS.recoverPromotionFault(input),
        probePromotionFault: () =>
          env.ATTESTATION_PROMOTION_FAULTS.probePromotionFault(identity),
        observePromotionFault: () =>
          env.ATTESTATION_PROMOTION_FAULTS.observePromotionFault(identity),
      },
    };
  }
  throw new Error(`promotion authority ${identity.authority} is unavailable`);
}

function observed(
  selected: AuthorityTarget,
  state: PromotionAuthorityFaultState,
): PromotionAuthorityBoundaryState {
  return {
    ...state,
    worker: selected.worker,
    binding: selected.binding,
    className: selected.className,
  };
}

/** Installs the fault in the named production authority binding. */
export async function injectPromotionAuthorityFault(
  env: ApiEnv,
  identity: PromotionAuthorityFaultIdentity,
): Promise<PromotionAuthorityBoundaryState> {
  const selected = target(env, identity);
  return observed(selected, await selected.stub.injectPromotionFault(identity));
}

/** Applies an ordered recovery receipt in the same authority binding. */
export async function recoverPromotionAuthorityFault(
  env: ApiEnv,
  input: PromotionAuthorityFaultRecovery,
): Promise<PromotionAuthorityBoundaryState> {
  const selected = target(env, input);
  return observed(selected, await selected.stub.recoverPromotionFault(input));
}

/** Reads the fault from the named authority rather than the receipt controller. */
export async function probePromotionAuthorityFault(
  env: ApiEnv,
  identity: PromotionAuthorityFaultIdentity,
): Promise<PromotionAuthorityBoundaryState | null> {
  const selected = target(env, identity);
  const state = await selected.stub.probePromotionFault(identity.executionId);
  return state === null ? null : observed(selected, state);
}

/** Runs inside the authority and therefore fails from its own RPC boundary. */
export async function observePromotionAuthorityFault(
  env: ApiEnv,
  identity: PromotionAuthorityFaultIdentity,
): Promise<PromotionAuthorityBoundaryState> {
  const selected = target(env, identity);
  return observed(
    selected,
    await selected.stub.observePromotionFault(identity.executionId),
  );
}
