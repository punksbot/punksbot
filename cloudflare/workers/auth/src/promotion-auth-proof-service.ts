import { WorkerEntrypoint } from "cloudflare:workers";

import { deriveOpaqueUuid } from "@punks/core";

import { hash, pkceChallenge, randomToken } from "./crypto";
import type { AuthEnv } from "./env";
import { aggregateName } from "./session";

const SHA1_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

interface PromotionAuthProofInput {
  sourceSha: string;
  stagingDeploymentId: string;
  flowId: string;
}

const METHODS = ["google", "github", "passkey"] as const;
type PromotionAuthMethod = (typeof METHODS)[number];

interface PromotionAuthMatrixCoordinates {
  successFlowId: string;
  cancellationFlowId: string;
}

interface PromotionAuthMatrixProofInput {
  sourceSha: string;
  stagingDeploymentId: string;
  flows: Record<PromotionAuthMethod, PromotionAuthMatrixCoordinates>;
}

function validInput(input: unknown): input is PromotionAuthProofInput {
  return (
    input !== null &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).sort().join(",") ===
      ["flowId", "sourceSha", "stagingDeploymentId"].join(",") &&
    "sourceSha" in input &&
    typeof input.sourceSha === "string" &&
    SHA1_RE.test(input.sourceSha) &&
    "stagingDeploymentId" in input &&
    typeof input.stagingDeploymentId === "string" &&
    DEPLOYMENT_RE.test(input.stagingDeploymentId) &&
    "flowId" in input &&
    typeof input.flowId === "string" &&
    UUID_RE.test(input.flowId)
  );
}

function validMatrixInput(
  input: unknown,
): input is PromotionAuthMatrixProofInput {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(",") !==
      ["flows", "sourceSha", "stagingDeploymentId"].join(",") ||
    !("sourceSha" in input) ||
    typeof input.sourceSha !== "string" ||
    !SHA1_RE.test(input.sourceSha) ||
    !("stagingDeploymentId" in input) ||
    typeof input.stagingDeploymentId !== "string" ||
    !DEPLOYMENT_RE.test(input.stagingDeploymentId) ||
    !("flows" in input) ||
    input.flows === null ||
    typeof input.flows !== "object" ||
    Array.isArray(input.flows) ||
    Object.keys(input.flows).sort().join(",") !== [...METHODS].sort().join(",")
  ) {
    return false;
  }
  const flows = input.flows as Record<string, unknown>;
  const ids: string[] = [];
  for (const method of METHODS) {
    const pair = flows[method];
    if (
      pair === null ||
      typeof pair !== "object" ||
      Array.isArray(pair) ||
      Object.keys(pair).sort().join(",") !==
        ["cancellationFlowId", "successFlowId"].join(",") ||
      !("successFlowId" in pair) ||
      typeof pair.successFlowId !== "string" ||
      !UUID_RE.test(pair.successFlowId) ||
      !("cancellationFlowId" in pair) ||
      typeof pair.cancellationFlowId !== "string" ||
      !UUID_RE.test(pair.cancellationFlowId)
    ) {
      return false;
    }
    ids.push(pair.successFlowId, pair.cancellationFlowId);
  }
  return new Set(ids).size === ids.length;
}

/** Private live proof service over confirmed Auth Durable Object state. */
export class PromotionAuthProofService extends WorkerEntrypoint<AuthEnv> {
  override fetch(): Response {
    return new Response(null, { status: 404 });
  }

  async attest(input: unknown): Promise<unknown | null> {
    if (this.env.ENVIRONMENT !== "staging") return null;
    if (validMatrixInput(input)) return this.attestMatrix(input);
    if (!validInput(input)) return null;
    const flow = await this.env.DESKTOP_AUTH_FLOWS.getByName(
      input.flowId,
    ).promotionProof();
    if (
      flow === null ||
      flow.environment !== "staging" ||
      flow.sourceSha !== input.sourceSha ||
      flow.stagingDeploymentId !== input.stagingDeploymentId
    ) {
      return null;
    }
    const negative = await this.negativeBindings(
      flow.method,
      input.sourceSha,
      input.stagingDeploymentId,
    );
    if (negative === null) return null;
    const { wrongOauthState, wrongBrowserBinding, wrongNativePkceVerifier } =
      negative;
    return {
      schema: "punks.live-staging-auth-proof.v1",
      sourceSha: flow.sourceSha,
      stagingDeploymentId: flow.stagingDeploymentId,
      authWorkerVersionId: this.env.CF_VERSION_METADATA.id,
      flow,
      negative: {
        wrongOauthState,
        wrongBrowserBinding,
        wrongNativePkceVerifier,
      },
      observedAt: new Date().toISOString(),
    };
  }

  private async attestMatrix(
    input: PromotionAuthMatrixProofInput,
  ): Promise<unknown | null> {
    const flows = {} as Record<
      PromotionAuthMethod,
      { success: unknown; cancellation: unknown }
    >;
    for (const method of METHODS) {
      const coordinates = input.flows[method];
      const [success, cancellation] = await Promise.all([
        this.env.DESKTOP_AUTH_FLOWS.getByName(
          coordinates.successFlowId,
        ).promotionSuccessProof(),
        this.env.DESKTOP_AUTH_FLOWS.getByName(
          coordinates.cancellationFlowId,
        ).promotionCancellationProof(),
      ]);
      if (
        success === null ||
        cancellation === null ||
        success.flowId !== coordinates.successFlowId ||
        cancellation.flowId !== coordinates.cancellationFlowId ||
        success.method !== method ||
        cancellation.method !== method ||
        success.sourceSha !== input.sourceSha ||
        cancellation.sourceSha !== input.sourceSha ||
        success.stagingDeploymentId !== input.stagingDeploymentId ||
        cancellation.stagingDeploymentId !== input.stagingDeploymentId
      ) {
        return null;
      }
      flows[method] = { success, cancellation };
    }
    const negative = await this.negativeBindings(
      "github",
      input.sourceSha,
      input.stagingDeploymentId,
    );
    if (negative === null) return null;
    return {
      schema: "punks.live-staging-auth-matrix-proof.v2",
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      authWorkerVersionId: this.env.CF_VERSION_METADATA.id,
      flows,
      negative,
      observedAt: new Date().toISOString(),
    };
  }

  private async negativeBindings(
    method: "google" | "github",
    sourceSha: string,
    stagingDeploymentId: string,
  ): Promise<{
    wrongOauthState: "refused";
    wrongBrowserBinding: "refused";
    wrongNativePkceVerifier: "refused";
    wrongPasskeyChallenge: "refused";
  } | null> {
    const negativeFlowId = await deriveOpaqueUuid(
      "punks.promotion.auth-negative-flow.v1",
      `${sourceSha}:${stagingDeploymentId}:${crypto.randomUUID()}`,
    );
    const verifier = randomToken(32);
    const verifierCommitment = await pkceChallenge(verifier);
    const negative = this.env.DESKTOP_AUTH_FLOWS.getByName(negativeFlowId);
    const now = Date.now();
    const created = await negative.create({
      flowId: negativeFlowId,
      intent: "sign_in",
      method,
      purpose: null,
      workspaceOwnershipTransfer: null,
      verifierCommitment,
      environment: "staging",
      currentSessionId: null,
      currentPunkId: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
      promotionSourceSha: sourceSha,
      promotionStagingDeploymentId: stagingDeploymentId,
    });
    const launched = created ? await negative.browserLaunch() : null;
    const wrongVerifier = await negative.claim(
      await pkceChallenge(randomToken(32)),
    );
    const wrongBrowser = await negative.browserFlow(
      await hash(randomToken(32)),
    );
    const validState = randomToken(32);
    const wrongState = randomToken(32);
    const transaction = this.env.AUTH_TRANSACTIONS.getByName(
      await aggregateName("transaction", validState),
    );
    const transactionCreated =
      launched?.ok === true &&
      (await transaction.create({
        provider: method,
        intent: "sign_in",
        returnTo: "/",
        browserBindingHash: await hash(launched.browserBinding),
        codeVerifier: launched.codeVerifier,
        currentPunkId: null,
        currentSessionId: null,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 10 * 60_000).toISOString(),
        desktop: { flowId: negativeFlowId },
        returnedStateHash: await hash(validState),
      }));
    const wrongReturnedState =
      await transaction.beginDesktopWithReturnedState(wrongState);
    const passkeyFlowId = await deriveOpaqueUuid(
      "punks.promotion.auth-negative-passkey-flow.v1",
      `${sourceSha}:${stagingDeploymentId}:${crypto.randomUUID()}`,
    );
    const passkeyCommitment = await pkceChallenge(randomToken(32));
    const passkey = this.env.DESKTOP_AUTH_FLOWS.getByName(passkeyFlowId);
    const passkeyCreated = await passkey.create({
      flowId: passkeyFlowId,
      intent: "sign_in",
      method: "passkey",
      purpose: null,
      workspaceOwnershipTransfer: null,
      verifierCommitment: passkeyCommitment,
      environment: "staging",
      currentSessionId: null,
      currentPunkId: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 5 * 60_000).toISOString(),
      promotionSourceSha: sourceSha,
      promotionStagingDeploymentId: stagingDeploymentId,
    });
    const passkeyLaunch = passkeyCreated ? await passkey.browserLaunch() : null;
    const passkeyChallenge = randomToken(32);
    const passkeyChallengeBound =
      passkeyLaunch?.ok === true &&
      (await passkey.setPasskeyChallenge({
        browserBindingHash: await hash(passkeyLaunch.browserBinding),
        challenge: passkeyChallenge,
      }));
    const wrongPasskeyChallenge = await passkey.setPasskeyChallenge({
      browserBindingHash:
        passkeyLaunch?.ok === true
          ? await hash(passkeyLaunch.browserBinding)
          : await hash(randomToken(32)),
      challenge: randomToken(32),
    });
    if (
      launched?.ok !== true ||
      !transactionCreated ||
      wrongVerifier.ok ||
      wrongVerifier.code !== "binding_mismatch" ||
      wrongBrowser !== null ||
      wrongReturnedState.ok ||
      wrongReturnedState.code !== "binding_mismatch" ||
      !passkeyChallengeBound ||
      wrongPasskeyChallenge
    ) {
      return null;
    }
    await Promise.all([
      negative.cancel(verifierCommitment),
      passkey.cancel(passkeyCommitment),
    ]);
    return {
      wrongOauthState: "refused",
      wrongBrowserBinding: "refused",
      wrongNativePkceVerifier: "refused",
      wrongPasskeyChallenge: "refused",
    };
  }
}
