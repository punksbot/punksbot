import type {
  PromotionAuthorityFaultIdentity,
  PromotionAuthorityFaultRecovery,
  PromotionAuthorityFaultState,
} from "../../../shared/promotion-faultable-do";
import { PROMOTION_AUTHORITY_FAULT_ACTIVE } from "../../../shared/promotion-faultable-do";
import { deriveOpaqueUuid } from "@punks/core";

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
  finalizePromotionAuthorityAfterPitr(
    input: PromotionAuthorityFaultRecovery,
    expectedStateFingerprint: string,
  ): Promise<PromotionAuthorityFaultState>;
}

interface AuthorityTarget {
  worker: string;
  binding: string;
  className: string;
  stub: PromotionAuthorityStub;
  businessOperation(): Promise<void>;
}

async function promotionFixtureCommandId(sourceSha: string): Promise<string> {
  return deriveOpaqueUuid("punks.promotion.fixture.v1\0workspace", sourceSha);
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
  identity: PromotionAuthorityFaultIdentity,
): AuthorityTarget | null {
  const authority = identity.authority;
  const targetId = identity.target.id;
  if (authority === "api-workspace") {
    const stub = env.WORKSPACES.getByName(targetId);
    return {
      worker: "punks-api-staging",
      binding: "WORKSPACES",
      className: "WorkspaceDO",
      stub,
      async businessOperation() {
        const probe = identity.target.probe;
        const result = await stub.execute({
          contract: "workspace.create@1",
          commandId: await promotionFixtureCommandId(identity.candidateSha),
          actor: { kind: "punk", punkId: probe.punkId },
          payload: {
            slug: probe.workspaceSlug,
            name: `Promotion ${identity.candidateSha.slice(0, 12)}`,
            visibility: "private",
          },
        });
        if (!result.ok && result.code === "internal") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
        if (!result.ok) {
          throw new Error("Workspace business probe did not replay");
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
        const probe = identity.target.probe;
        const result = await stub.history({
          query: {
            contract: "message.history@1",
            workspaceId: probe.workspaceId,
            conversationId: probe.conversationId,
            cursor: null,
            limit: 1,
            direction: "older",
          },
          punkId: probe.punkId,
        });
        if (!result.ok && result.code === "content_unavailable") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
        if (!result.ok) {
          throw new Error("Conversation history business probe failed");
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
        const probe = identity.target.probe;
        const result = await env.CONVERSATIONS.getByName(
          probe.conversationId,
        ).readMessage({
          workspaceId: probe.workspaceId,
          conversationId: probe.conversationId,
          messageId: probe.messageId,
          punkId: probe.punkId,
        });
        if (!result.ok && result.code === "content_unavailable") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
        if (!result.ok) {
          throw new Error("Message content business probe failed");
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
  const selected = apiTarget(env, identity);
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
        finalizePromotionAuthorityAfterPitr: (input, fingerprint) =>
          env.AUTH_PROMOTION_FAULTS.finalizePromotionAuthorityAfterPitr(
            input,
            fingerprint,
          ),
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
        finalizePromotionAuthorityAfterPitr: (input, fingerprint) =>
          env.ERASURE_PROMOTION_FAULTS.finalizePromotionAuthorityAfterPitr(
            input,
            fingerprint,
          ),
      },
      async businessOperation() {
        const probe = identity.target.probe;
        const result = await env.ERASURE_REGISTRY.lookup({
          workspaceId: probe.workspaceId,
          conversationId: probe.conversationId,
          messageId: probe.messageId,
          generationId: probe.messageId,
        });
        if (!result.ok && result.code === "storage_unavailable") {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
        if (!result.ok) {
          throw new Error("Erasure registry business probe failed");
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
        finalizePromotionAuthorityAfterPitr: (input, fingerprint) =>
          env.ATTESTATION_PROMOTION_FAULTS.finalizePromotionAuthorityAfterPitr(
            input,
            fingerprint,
          ),
      },
      async businessOperation() {
        const probe = identity.target.probe;
        const response = await env.ATTESTATION.fetch(
          new Request("https://punks-attestation/internal/v1/attest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              purpose: "workspace-journal",
              event: {
                created_at: Math.floor(Date.now() / 1_000),
                kind: 50000,
                tags: [
                  ["workspace", probe.workspaceId],
                  ["cursor", "1"],
                  ["command", probe.messageId],
                  ["contract", "workspace.create@1"],
                  ["actor", "punk", probe.punkId],
                ],
                content: '{"schemaVersion":1}',
              },
            }),
          }),
        );
        if (response.status === 503) {
          throw new Error(PROMOTION_AUTHORITY_FAULT_ACTIVE);
        }
        if (response.status !== 200) {
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
  const beforeRecovery = await selected.stub.probePromotionFault(
    input.executionId,
  );
  if (beforeRecovery === null) {
    throw new Error("promotion authority recovery has no injected state");
  }
  let recovered: PromotionAuthorityFaultState;
  try {
    recovered = await selected.stub.recoverPromotionFault(input);
  } catch (error) {
    if (
      input.proof !== "recu-resistant-pitr" ||
      input.authority === "auth-session"
    ) {
      throw error;
    }
    const restored = await selected.stub.probePromotionFault(input.executionId);
    if (restored !== null) {
      throw new Error("promotion authority did not apply its PITR bookmark");
    }
    const beforePitr = await selected.stub.finalizePromotionAuthorityAfterPitr(
      input,
      beforeRecovery.stateFingerprint,
    );
    if (
      beforePitr.phase !== "recovered" ||
      beforePitr.proof !== "recu-resistant-pitr" ||
      beforePitr.stateFingerprint !== beforeRecovery.stateFingerprint
    ) {
      throw new Error("promotion authority diverged after PITR finalization");
    }
    return observed(selected, beforePitr);
  }
  if (
    input.proof === "recu-resistant-pitr" &&
    input.authority !== "auth-session"
  ) {
    let restored = await selected.stub.probePromotionFault(input.executionId);
    if (restored === null) {
      restored = await selected.stub.finalizePromotionAuthorityAfterPitr(
        input,
        recovered.stateFingerprint,
      );
    }
    if (
      restored === null ||
      restored.phase !== "recovered" ||
      restored.proof !== "recu-resistant-pitr" ||
      restored.stateFingerprint !== recovered.stateFingerprint
    ) {
      throw new Error("promotion authority resurrected after PITR");
    }
    return observed(selected, restored);
  }
  return observed(selected, recovered);
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
