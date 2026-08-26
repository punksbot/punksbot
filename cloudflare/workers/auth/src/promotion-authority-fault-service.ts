import { WorkerEntrypoint } from "cloudflare:workers";

import type {
  PromotionAuthorityFaultIdentity,
  PromotionAuthorityFaultRecovery,
  PromotionAuthorityFaultState,
} from "../../../shared/promotion-faultable-do";

import type { AuthEnv } from "./env";

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

interface PromotionBusinessAuthorityStub extends PromotionAuthorityStub {
  query?(): Promise<unknown>;
  status?(): Promise<unknown>;
  get?(): Promise<unknown>;
}

function authorityStub(
  env: AuthEnv,
  authority: string,
  targetId: string,
): PromotionAuthorityStub {
  if (authority === "auth-punk") return env.PUNKS.getByName(targetId);
  if (authority === "auth-session-revocation") {
    return env.SESSION_REVOCATIONS.getByName(targetId);
  }
  if (authority === "auth-session") {
    return env.SESSIONS.getByName(targetId);
  }
  throw new Error(`unknown Auth promotion authority ${authority}`);
}

/** Private service binding that applies chaos state to the real Auth DO class. */
export class PromotionAuthorityFaultService extends WorkerEntrypoint<AuthEnv> {
  override fetch(): Response {
    return new Response(null, { status: 404 });
  }

  async injectPromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState> {
    return authorityStub(
      this.env,
      input.authority,
      input.target.id,
    ).injectPromotionFault(input);
  }

  async recoverPromotionFault(
    input: PromotionAuthorityFaultRecovery,
  ): Promise<PromotionAuthorityFaultState> {
    return authorityStub(
      this.env,
      input.authority,
      input.target.id,
    ).recoverPromotionFault(input);
  }

  async probePromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState | null> {
    return authorityStub(
      this.env,
      input.authority,
      input.target.id,
    ).probePromotionFault(input.executionId);
  }

  async observePromotionFault(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState> {
    return authorityStub(
      this.env,
      input.authority,
      input.target.id,
    ).observePromotionFault(input.executionId);
  }

  /** Executes one ordinary Auth authority read, then returns its fault state. */
  async observePromotionBusinessOperation(
    input: PromotionAuthorityFaultIdentity,
  ): Promise<PromotionAuthorityFaultState> {
    const stub = authorityStub(
      this.env,
      input.authority,
      input.target.id,
    ) as PromotionBusinessAuthorityStub;
    if (input.authority === "auth-punk") {
      await stub.query?.();
    } else if (input.authority === "auth-session-revocation") {
      await stub.status?.();
    } else if (input.authority === "auth-session") {
      await stub.get?.();
    } else {
      throw new Error(`unknown Auth promotion authority ${input.authority}`);
    }
    const state = await stub.probePromotionFault(input.executionId);
    if (state === null) {
      throw new Error("promotion authority fault is missing");
    }
    return state;
  }
}
