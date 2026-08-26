import { DurableObject } from "cloudflare:workers";

import type { AuthProviderProfile } from "@punks/contracts";

import { hash, randomToken } from "./crypto";
import type { AuthEnv } from "./env";
import { aggregateName } from "./session";
import type { WorkspaceOwnershipTransferBinding } from "./desktop-reauth-grant-do";

export type DesktopAuthIntent =
  | "sign_in"
  | "switch_account"
  | "reauthenticate"
  | "link_google"
  | "link_github"
  | "register_passkey";

export type DesktopAuthMethod = "google" | "github" | "passkey";

export type DesktopAuthPhase =
  | "started"
  | "browser_complete"
  | "ready"
  | "delivering"
  | "confirmed"
  | "cancelled"
  | "expired";

export type DesktopAuthResult =
  | "success"
  | "human_action_required"
  | "security_failure"
  | "transient_interruption";

export type DesktopAuthOutcomeCode =
  | "account_created"
  | "account_creation_confirmation_required"
  | "authenticated"
  | "cancelled"
  | "expired"
  | "link_required"
  | "link_pending"
  | "linked"
  | "merge_required"
  | "passkey_authenticated"
  | "passkey_invalid"
  | "passkey_registration_pending"
  | "passkey_registered"
  | "passkey_unknown_or_invalid"
  | "provider_error"
  | "reauthenticated"
  | "reauthentication_failed"
  | "session_expired"
  | "temporarily_unavailable";

export interface DesktopPendingIdentity {
  profile: AuthProviderProfile;
  subjectHash: string;
  emailHash: string;
  transactionId: string;
}

export interface DesktopPendingPasskey {
  credentialId: string;
  subjectHash: string;
  emailHash: string;
  transactionId: string;
}

export interface DesktopAuthFlowRecord {
  flowId: string;
  intent: DesktopAuthIntent;
  method: DesktopAuthMethod;
  purpose:
    | "link_google"
    | "link_github"
    | "register_passkey"
    | "transfer_workspace_ownership"
    | null;
  workspaceOwnershipTransfer: WorkspaceOwnershipTransferBinding | null;
  verifierCommitment: string;
  environment: "local" | "staging" | "production";
  phase: DesktopAuthPhase;
  result: DesktopAuthResult;
  outcomeCode: DesktopAuthOutcomeCode | null;
  currentSessionId: string | null;
  currentPunkId: string | null;
  punkId: string | null;
  createdAt: string;
  expiresAt: string;
  browserCompletedAt: string | null;
  browserBinding: string | null;
  browserBindingHash: string | null;
  oauthState: string | null;
  codeVerifier: string | null;
  passkeyChallenge: string | null;
  pendingIdentity: DesktopPendingIdentity | null;
  pendingPasskey: DesktopPendingPasskey | null;
  browserEffectCommitted: boolean;
  deliveryId: string | null;
  authorizationId: string | null;
  authorizationExpiresAt: string | null;
  sessionToken: string | null;
  sessionId: string | null;
  revokeCapability: string | null;
  deliveryStartedAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

export interface CreateDesktopAuthFlow
  extends Pick<
    DesktopAuthFlowRecord,
    | "flowId"
    | "intent"
    | "method"
    | "purpose"
    | "workspaceOwnershipTransfer"
    | "verifierCommitment"
    | "environment"
    | "currentSessionId"
    | "currentPunkId"
    | "createdAt"
    | "expiresAt"
  > {}

/** Redacted terminal facts proving one real desktop provider ceremony. */
export interface DesktopPromotionAuthProof {
  flowId: string;
  method: DesktopAuthMethod;
  intent: DesktopAuthIntent;
  environment: "local" | "staging" | "production";
  outcomeCode: DesktopAuthOutcomeCode;
  punkId: string;
  sessionId: string;
  browserCompletedAt: string;
  confirmedAt: string;
  browserBindingHash: string;
  oauthStateHash: string;
  providerPkceHash: string;
  nativeVerifierCommitment: string;
}

export type BrowserLaunchResult =
  | {
      ok: true;
      flow: DesktopAuthFlowRecord;
      browserBinding: string;
      state: string;
      codeVerifier: string;
    }
  | { ok: false; code: "missing" | "terminal" | "expired" };

export type ClaimDesktopAuthFlowResult =
  | {
      ok: true;
      kind: "session";
      flow: DesktopAuthFlowRecord;
      deliveryId: string;
      sessionToken: string;
      revokeCapability: string;
    }
  | {
      ok: true;
      kind: "reauthorization";
      flow: DesktopAuthFlowRecord;
      deliveryId: string;
      authorizationId: string;
    }
  | {
      ok: false;
      code:
        | "missing"
        | "binding_mismatch"
        | "not_ready"
        | "terminal"
        | "expired";
    };

const FLOW_KEY = "desktop_auth_flow_v1";
const READY_TTL_MS = 5 * 60_000;
const DELIVERY_TTL_MS = 10 * 60_000;
const POST_BROWSER_CAP_MS = 20 * 60_000;

function terminal(phase: DesktopAuthPhase): boolean {
  return phase === "confirmed" || phase === "cancelled" || phase === "expired";
}

function minIso(...timestamps: number[]): string {
  return new Date(Math.min(...timestamps)).toISOString();
}

export class DesktopAuthFlowDO extends DurableObject<AuthEnv> {
  async create(input: CreateDesktopAuthFlow): Promise<boolean> {
    if (
      (await this.read()) !== null ||
      Date.parse(input.expiresAt) <= Date.now() ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.verifierCommitment)
    ) {
      return false;
    }
    const record: DesktopAuthFlowRecord = {
      ...input,
      phase: "started",
      result: "human_action_required",
      outcomeCode: null,
      punkId: null,
      browserCompletedAt: null,
      browserBinding: null,
      browserBindingHash: null,
      oauthState: null,
      codeVerifier: null,
      passkeyChallenge: null,
      pendingIdentity: null,
      pendingPasskey: null,
      browserEffectCommitted: false,
      deliveryId: null,
      authorizationId: null,
      authorizationExpiresAt: null,
      sessionToken: null,
      sessionId: null,
      revokeCapability: null,
      deliveryStartedAt: null,
      confirmedAt: null,
      cancelledAt: null,
    };
    await this.write(record);
    if (!(await this.indexHandoff(record, "pending"))) {
      await this.ctx.storage.delete(FLOW_KEY);
      return false;
    }
    return true;
  }

  async browserLaunch(): Promise<BrowserLaunchResult> {
    const flow = await this.current();
    if (flow === null) return { ok: false, code: "missing" };
    if (flow.phase === "expired") return { ok: false, code: "expired" };
    if (terminal(flow.phase) || flow.phase !== "started") {
      return { ok: false, code: "terminal" };
    }
    if (
      flow.browserBinding === null ||
      flow.browserBindingHash === null ||
      flow.oauthState === null ||
      flow.codeVerifier === null
    ) {
      flow.browserBinding = randomToken(32);
      flow.browserBindingHash = await hash(flow.browserBinding);
      flow.oauthState = randomToken(32);
      flow.codeVerifier = randomToken(64);
      await this.write(flow);
    }
    return {
      ok: true,
      flow,
      browserBinding: flow.browserBinding,
      state: flow.oauthState,
      codeVerifier: flow.codeVerifier,
    };
  }

  async recordBrowserComplete(input: {
    browserBindingHash: string;
    pendingIdentity?: DesktopPendingIdentity;
    pendingPasskey?: DesktopPendingPasskey;
    outcomeCode?: DesktopAuthOutcomeCode;
  }): Promise<
    | { ok: true; flow: DesktopAuthFlowRecord }
    | {
        ok: false;
        code: "missing" | "binding_mismatch" | "terminal" | "expired";
      }
  > {
    const flow = await this.current();
    if (flow === null) return { ok: false, code: "missing" };
    if (flow.phase === "expired") return { ok: false, code: "expired" };
    if (terminal(flow.phase)) return { ok: false, code: "terminal" };
    if (flow.browserBindingHash !== input.browserBindingHash) {
      return { ok: false, code: "binding_mismatch" };
    }
    if (flow.browserCompletedAt === null) {
      const now = Date.now();
      flow.browserCompletedAt = new Date(now).toISOString();
      flow.expiresAt = minIso(now + READY_TTL_MS, now + POST_BROWSER_CAP_MS);
      flow.phase = "browser_complete";
      flow.result = "human_action_required";
      flow.pendingIdentity = input.pendingIdentity ?? null;
      flow.pendingPasskey = input.pendingPasskey ?? null;
      flow.outcomeCode = input.outcomeCode ?? null;
      await this.write(flow);
    }
    return { ok: true, flow };
  }

  async browserFlow(
    browserBindingHash: string,
  ): Promise<DesktopAuthFlowRecord | null> {
    const flow = await this.current();
    return flow !== null && flow.browserBindingHash === browserBindingHash
      ? flow
      : null;
  }

  /** Internal Worker RPC; never exposed as a public flow-status response. */
  async browserMetadata(): Promise<DesktopAuthFlowRecord | null> {
    return this.current();
  }

  /** Returns no secrets and only a fully confirmed staging OAuth ceremony. */
  async promotionProof(): Promise<DesktopPromotionAuthProof | null> {
    const flow = await this.read();
    if (
      flow === null ||
      flow.phase !== "confirmed" ||
      flow.result !== "success" ||
      flow.method === "passkey" ||
      flow.outcomeCode === null ||
      flow.punkId === null ||
      flow.sessionId === null ||
      flow.browserCompletedAt === null ||
      flow.confirmedAt === null ||
      flow.browserBindingHash === null ||
      flow.oauthState === null ||
      flow.codeVerifier === null
    ) {
      return null;
    }
    return {
      flowId: flow.flowId,
      method: flow.method,
      intent: flow.intent,
      environment: flow.environment,
      outcomeCode: flow.outcomeCode,
      punkId: flow.punkId,
      sessionId: flow.sessionId,
      browserCompletedAt: flow.browserCompletedAt,
      confirmedAt: flow.confirmedAt,
      browserBindingHash: flow.browserBindingHash,
      oauthStateHash: await hash(flow.oauthState),
      providerPkceHash: await hash(flow.codeVerifier),
      nativeVerifierCommitment: flow.verifierCommitment,
    };
  }

  async setPasskeyChallenge(input: {
    browserBindingHash: string;
    challenge: string;
  }): Promise<boolean> {
    const flow = await this.current();
    if (
      flow === null ||
      flow.method !== "passkey" ||
      flow.phase !== "started" ||
      flow.browserBindingHash !== input.browserBindingHash ||
      (flow.passkeyChallenge !== null &&
        flow.passkeyChallenge !== input.challenge)
    ) {
      return false;
    }
    if (flow.passkeyChallenge === null) {
      flow.passkeyChallenge = input.challenge;
      await this.write(flow);
    }
    return true;
  }

  async pendingIdentity(browserBindingHash: string): Promise<
    | {
        ok: true;
        flow: DesktopAuthFlowRecord;
        identity: DesktopPendingIdentity;
      }
    | {
        ok: false;
        code: "missing" | "binding_mismatch" | "not_pending" | "expired";
      }
  > {
    const flow = await this.current();
    if (flow === null) return { ok: false, code: "missing" };
    if (flow.phase === "expired") return { ok: false, code: "expired" };
    if (flow.browserBindingHash !== browserBindingHash) {
      return { ok: false, code: "binding_mismatch" };
    }
    if (flow.phase !== "browser_complete" || flow.pendingIdentity === null) {
      return { ok: false, code: "not_pending" };
    }
    return { ok: true, flow, identity: flow.pendingIdentity };
  }

  async ready(input: {
    punkId: string;
    outcomeCode: DesktopAuthOutcomeCode;
  }): Promise<boolean> {
    const flow = await this.current();
    if (
      flow === null ||
      flow.phase === "expired" ||
      terminal(flow.phase) ||
      (flow.phase !== "started" && flow.phase !== "browser_complete")
    ) {
      return false;
    }
    if (flow.browserCompletedAt === null) {
      const now = Date.now();
      flow.browserCompletedAt = new Date(now).toISOString();
      flow.expiresAt = minIso(now + READY_TTL_MS, now + POST_BROWSER_CAP_MS);
    }
    flow.phase = "ready";
    flow.result = "success";
    flow.outcomeCode = input.outcomeCode;
    flow.punkId = input.punkId;
    if (flow.intent !== "link_google" && flow.intent !== "link_github") {
      flow.pendingIdentity = null;
    }
    if (flow.intent !== "register_passkey") {
      flow.pendingPasskey = null;
    }
    if (!(await this.indexHandoff(flow, "prepared"))) return false;
    await this.write(flow);
    return true;
  }

  async fail(input: {
    browserBindingHash: string;
    result: Exclude<DesktopAuthResult, "success">;
    outcomeCode: DesktopAuthOutcomeCode;
  }): Promise<boolean> {
    const flow = await this.current();
    if (
      flow === null ||
      terminal(flow.phase) ||
      flow.browserBindingHash !== input.browserBindingHash
    ) {
      return false;
    }
    flow.phase = "cancelled";
    flow.result = input.result;
    flow.outcomeCode = input.outcomeCode;
    flow.cancelledAt = new Date().toISOString();
    flow.expiresAt = flow.cancelledAt;
    await this.write(flow, false);
    await this.revokePrepared(flow);
    await this.removeHandoff(flow);
    return true;
  }

  async status(
    verifierCommitment: string,
  ): Promise<DesktopAuthFlowRecord | null> {
    const flow = await this.current();
    return flow !== null && flow.verifierCommitment === verifierCommitment
      ? flow
      : null;
  }

  /** Account-merge inventory reads only the bound Punk and public handoff state. */
  async readForAccountMerge(): Promise<{
    punkId: string;
    kind: "desktop-auth-flow";
    state: "pending" | "prepared" | "deliverable";
    expiresAt: string;
  } | null> {
    const flow = await this.current();
    if (flow === null || flow.currentPunkId === null || terminal(flow.phase)) {
      return null;
    }
    return {
      punkId: flow.currentPunkId,
      kind: "desktop-auth-flow",
      state:
        flow.phase === "started" || flow.phase === "browser_complete"
          ? "pending"
          : flow.phase === "ready"
            ? "prepared"
            : "deliverable",
      expiresAt: flow.expiresAt,
    };
  }

  /** Cancels this exact active native flow during merge roll-forward. */
  async cancelForAccountMerge(input: {
    handoffId: string;
    punkId: string;
    kind: "desktop-auth-flow";
    state: "pending" | "prepared" | "deliverable";
    expiresAt: string;
  }): Promise<boolean> {
    const current = await this.readForAccountMerge();
    if (current === null) return true;
    if (
      input.handoffId !== this.ctx.id.name ||
      current.punkId !== input.punkId ||
      current.kind !== input.kind ||
      current.state !== input.state ||
      current.expiresAt !== input.expiresAt
    ) {
      return false;
    }
    const flow = await this.read();
    if (flow === null) return true;
    return (await this.cancel(flow.verifierCommitment)) !== null;
  }

  async claim(verifierCommitment: string): Promise<ClaimDesktopAuthFlowResult> {
    const flow = await this.current();
    if (flow === null) return { ok: false, code: "missing" };
    if (flow.verifierCommitment !== verifierCommitment) {
      return { ok: false, code: "binding_mismatch" };
    }
    if (flow.phase === "expired") return { ok: false, code: "expired" };
    if (flow.phase === "cancelled") return { ok: false, code: "terminal" };
    if (
      flow.phase !== "ready" &&
      flow.phase !== "delivering" &&
      flow.phase !== "confirmed"
    ) {
      return { ok: false, code: "not_ready" };
    }
    if (flow.deliveryId === null) {
      if (flow.phase !== "ready" || flow.punkId === null) {
        return { ok: false, code: "not_ready" };
      }
      const now = Date.now();
      const completedAt = Date.parse(flow.browserCompletedAt ?? flow.createdAt);
      flow.deliveryId = crypto.randomUUID();
      if (flow.intent === "reauthenticate") {
        flow.authorizationId = crypto.randomUUID();
        flow.authorizationExpiresAt = minIso(
          now + 5 * 60_000,
          Date.parse(flow.expiresAt),
        );
      } else {
        flow.sessionToken = randomToken(32);
        flow.revokeCapability = randomToken(32);
      }
      flow.deliveryStartedAt = new Date(now).toISOString();
      flow.expiresAt = minIso(
        now + DELIVERY_TTL_MS,
        completedAt + POST_BROWSER_CAP_MS,
      );
      flow.phase = "delivering";
      if (!(await this.indexHandoff(flow, "deliverable"))) {
        return { ok: false, code: "not_ready" };
      }
      await this.write(flow);
    }
    if (flow.intent === "reauthenticate") {
      return flow.authorizationId === null
        ? { ok: false, code: "not_ready" }
        : {
            ok: true,
            kind: "reauthorization",
            flow,
            deliveryId: flow.deliveryId,
            authorizationId: flow.authorizationId,
          };
    }
    return flow.sessionToken === null || flow.revokeCapability === null
      ? { ok: false, code: "not_ready" }
      : {
          ok: true,
          kind: "session",
          flow,
          deliveryId: flow.deliveryId,
          sessionToken: flow.sessionToken,
          revokeCapability: flow.revokeCapability,
        };
  }

  async recordPreparedSession(input: {
    deliveryId: string;
    sessionId: string;
  }): Promise<boolean> {
    const flow = await this.current();
    if (
      flow === null ||
      flow.phase !== "delivering" ||
      flow.deliveryId !== input.deliveryId ||
      (flow.sessionId !== null && flow.sessionId !== input.sessionId)
    ) {
      return false;
    }
    flow.sessionId = input.sessionId;
    await this.write(flow);
    return true;
  }

  async browserEffect(
    deliveryId: string,
  ): Promise<DesktopAuthFlowRecord | null> {
    const flow = await this.current();
    if (
      flow === null ||
      (flow.phase !== "delivering" && flow.phase !== "confirmed") ||
      flow.deliveryId !== deliveryId
    ) {
      return null;
    }
    return flow;
  }

  async browserEffectCommitted(deliveryId: string): Promise<boolean> {
    const flow = await this.current();
    if (
      flow === null ||
      (flow.phase !== "delivering" && flow.phase !== "confirmed") ||
      flow.deliveryId !== deliveryId
    ) {
      return false;
    }
    if (!flow.browserEffectCommitted) {
      flow.browserEffectCommitted = true;
      if (flow.intent === "link_google" || flow.intent === "link_github") {
        flow.outcomeCode = "linked";
      } else if (flow.intent === "register_passkey") {
        flow.outcomeCode = "passkey_registered";
      }
      flow.pendingIdentity = null;
      flow.pendingPasskey = null;
      await this.write(flow);
    }
    return true;
  }

  async failDelivery(input: {
    deliveryId: string;
    result: Exclude<DesktopAuthResult, "success">;
    outcomeCode: DesktopAuthOutcomeCode;
  }): Promise<boolean> {
    const flow = await this.current();
    if (
      flow === null ||
      flow.phase !== "delivering" ||
      flow.deliveryId !== input.deliveryId
    ) {
      return false;
    }
    flow.phase = "cancelled";
    flow.result = input.result;
    flow.outcomeCode = input.outcomeCode;
    flow.cancelledAt = new Date().toISOString();
    flow.expiresAt = flow.cancelledAt;
    await this.write(flow, false);
    await this.revokePrepared(flow);
    await this.removeHandoff(flow);
    return true;
  }

  async confirmation(input: {
    verifierCommitment: string;
    deliveryId: string;
  }): Promise<
    | { ok: true; flow: DesktopAuthFlowRecord }
    | {
        ok: false;
        code: "missing" | "binding_mismatch" | "not_delivering" | "expired";
      }
  > {
    const flow = await this.current();
    if (flow === null) return { ok: false, code: "missing" };
    if (flow.verifierCommitment !== input.verifierCommitment) {
      return { ok: false, code: "binding_mismatch" };
    }
    if (flow.phase === "expired") return { ok: false, code: "expired" };
    if (
      (flow.phase !== "delivering" && flow.phase !== "confirmed") ||
      flow.deliveryId !== input.deliveryId ||
      (flow.intent === "reauthenticate"
        ? flow.currentSessionId === null
        : flow.sessionId === null)
    ) {
      return { ok: false, code: "not_delivering" };
    }
    return { ok: true, flow };
  }

  async confirmed(input: {
    deliveryId: string;
    sessionId: string;
  }): Promise<DesktopAuthFlowRecord | null> {
    const flow = await this.current();
    if (
      flow === null ||
      (flow.phase !== "delivering" && flow.phase !== "confirmed") ||
      flow.deliveryId !== input.deliveryId ||
      (flow.intent === "reauthenticate"
        ? flow.currentSessionId !== input.sessionId
        : flow.sessionId !== input.sessionId)
    ) {
      return null;
    }
    if (flow.phase !== "confirmed") {
      flow.phase = "confirmed";
      flow.result = "success";
      flow.confirmedAt = new Date().toISOString();
      await this.write(flow, false);
      await this.removeHandoff(flow);
    }
    return flow;
  }

  async cancel(
    verifierCommitment: string,
  ): Promise<DesktopAuthFlowRecord | null> {
    const flow = await this.current();
    if (flow === null || flow.verifierCommitment !== verifierCommitment) {
      return null;
    }
    if (flow.phase === "cancelled" || flow.phase === "expired") return flow;
    if (flow.phase === "confirmed") return null;
    flow.phase = "cancelled";
    flow.result = "security_failure";
    flow.outcomeCode = "cancelled";
    flow.cancelledAt = new Date().toISOString();
    flow.expiresAt = flow.cancelledAt;
    await this.write(flow, false);
    await this.revokePrepared(flow);
    await this.removeHandoff(flow);
    return flow;
  }

  override async alarm(): Promise<void> {
    const flow = await this.read();
    if (flow === null || terminal(flow.phase)) return;
    flow.phase = "expired";
    flow.result = "security_failure";
    flow.outcomeCode = "expired";
    flow.expiresAt = new Date().toISOString();
    await this.write(flow, false);
    await this.revokePrepared(flow);
    await this.removeHandoff(flow);
  }

  private async current(): Promise<DesktopAuthFlowRecord | null> {
    const flow = await this.read();
    if (
      flow !== null &&
      !terminal(flow.phase) &&
      Date.parse(flow.expiresAt) <= Date.now()
    ) {
      await this.alarm();
      return this.read();
    }
    return flow;
  }

  private async read(): Promise<DesktopAuthFlowRecord | null> {
    return (
      (await this.ctx.storage.get<DesktopAuthFlowRecord>(FLOW_KEY)) ?? null
    );
  }

  private async write(
    flow: DesktopAuthFlowRecord,
    scheduleAlarm = true,
  ): Promise<void> {
    await this.ctx.storage.put(FLOW_KEY, flow);
    if (scheduleAlarm && !terminal(flow.phase)) {
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(flow.expiresAt)));
    }
  }

  private async revokePrepared(flow: DesktopAuthFlowRecord): Promise<void> {
    if (flow.sessionId !== null) {
      await this.env.SESSIONS.getByName(flow.sessionId).revoke();
    }
    if (flow.pendingPasskey !== null && flow.currentPunkId !== null) {
      await this.env.PASSKEY_CREDENTIALS.getByName(
        await aggregateName(
          "passkey-credential",
          flow.pendingPasskey.credentialId,
        ),
      ).release({
        punkId: flow.currentPunkId,
        transactionId: flow.pendingPasskey.transactionId,
      });
    }
  }

  private async indexHandoff(
    flow: DesktopAuthFlowRecord,
    state: "pending" | "prepared" | "deliverable",
  ): Promise<boolean> {
    if (flow.currentPunkId === null) return true;
    try {
      return await this.env.PUNKS.getByName(
        flow.currentPunkId,
      ).recordAccountMergeHandoff({
        handoffId: flow.flowId,
        punkId: flow.currentPunkId,
        kind: "desktop-auth-flow",
        state,
        expiresAt: flow.expiresAt,
      });
    } catch {
      return false;
    }
  }

  private async removeHandoff(flow: DesktopAuthFlowRecord): Promise<void> {
    if (flow.currentPunkId !== null) {
      await this.env.PUNKS.getByName(
        flow.currentPunkId,
      ).removeAccountMergeHandoff(flow.flowId);
    }
  }
}
