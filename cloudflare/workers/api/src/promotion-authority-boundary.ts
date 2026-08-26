import type {
  PromotionAuthorityFaultIdentity,
  PromotionAuthorityFaultRecovery,
  PromotionAuthorityFaultState,
} from "../../../shared/promotion-faultable-do";
import { PROMOTION_AUTHORITY_FAULT_ACTIVE } from "../../../shared/promotion-faultable-do";

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
  businessOperation(): Promise<void>;
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
    const stub = env.WORKSPACES.getByName(targetId);
    return {
      worker: "punks-api-staging",
      binding: "WORKSPACES",
      className: "WorkspaceDO",
      stub,
      async businessOperation() {
        const result = await stub.execute(null);
        if (!result.ok && result.code === "internal") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
      },
    };
  }
  if (authority === "api-workspace-slug") {
    const stub = env.WORKSPACE_SLUGS.getByName(targetId);
    return {
      worker: "punks-api-staging",
      binding: "WORKSPACE_SLUGS",
      className: "WorkspaceSlugDO",
      stub,
      async businessOperation() {
        await stub.resolve();
      },
    };
  }
  if (authority === "api-conversation") {
    const stub = env.CONVERSATIONS.getByName(targetId);
    return {
      worker: "punks-api-staging",
      binding: "CONVERSATIONS",
      className: "ConversationDO",
      stub,
      async businessOperation() {
        const result = await stub.history(null);
        if (!result.ok && result.code === "content_unavailable") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
      },
    };
  }
  if (authority === "api-message-content") {
    const stub = env.MESSAGE_CONTENT.getByName(targetId);
    return {
      worker: "punks-api-staging",
      binding: "MESSAGE_CONTENT",
      className: "MessageContentDO",
      stub,
      async businessOperation() {
        const result = await stub.readAuthorized(null);
        if (!result.ok && result.code === "storage_unavailable") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
      },
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
      async businessOperation() {
        await env.AUTH_PROMOTION_FAULTS.observePromotionBusinessOperation(
          identity,
        );
      },
    };
  }
  if (identity.authority === "erasure-registry") {
    return {
      worker: "punks-erasure-staging",
      binding: "ERASURE_REGISTRY",
      className: "ErasureRegistry",
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
      async businessOperation() {
        const messageId = "00000000-0000-8000-8000-000000000058";
        const result = await env.ERASURE_REGISTRY.lookup({
          workspaceId: "00000000-0000-8000-8000-000000000059",
          conversationId: "00000000-0000-8000-8000-000000000060",
          messageId,
          generationId: messageId,
        });
        if (!result.ok && result.code === "storage_unavailable") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
      },
    };
  }
  if (identity.authority === "internal-event-signature") {
    return {
      worker: "punks-attestation-staging",
      binding: "ATTESTATION",
      className: "AttestationWorker",
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
      async businessOperation() {
        const response = await env.ATTESTATION.fetch(
          new Request("https://punks-attestation/internal/v1/attest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}",
          }),
        );
        if (response.status === 503) {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
        if (response.status !== 400) {
          throw new Error(
            "Attestation business probe returned an invalid status",
          );
        }
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
  await selected.businessOperation();
  const state = await selected.stub.probePromotionFault(identity.executionId);
  if (state === null) throw new Error("promotion authority fault is missing");
  if (state.phase !== "recovered") {
    throw new Error(
      `${PROMOTION_AUTHORITY_FAULT_ACTIVE}:${state.phase}:${state.type}`,
    );
  }
  return observed(selected, state);
}
