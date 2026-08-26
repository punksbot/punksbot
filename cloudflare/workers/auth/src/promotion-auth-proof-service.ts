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

/** Private live proof service over confirmed Auth Durable Object state. */
export class PromotionAuthProofService extends WorkerEntrypoint<AuthEnv> {
  override fetch(): Response {
    return new Response(null, { status: 404 });
  }

  async attest(input: unknown): Promise<unknown | null> {
    if (!validInput(input) || this.env.ENVIRONMENT !== "staging") return null;
    const flow = await this.env.DESKTOP_AUTH_FLOWS.getByName(
      input.flowId,
    ).promotionProof();
    if (flow === null || flow.environment !== "staging") return null;

    const negativeFlowId = await deriveOpaqueUuid(
      "punks.promotion.auth-negative-flow.v1",
      `${input.sourceSha}:${input.stagingDeploymentId}:${crypto.randomUUID()}`,
    );
    const verifier = randomToken(32);
    const verifierCommitment = await pkceChallenge(verifier);
    const negative = this.env.DESKTOP_AUTH_FLOWS.getByName(negativeFlowId);
    const now = Date.now();
    const created = await negative.create({
      flowId: negativeFlowId,
      intent: "sign_in",
      method: flow.method,
      purpose: null,
      workspaceOwnershipTransfer: null,
      verifierCommitment,
      environment: "staging",
      currentSessionId: null,
      currentPunkId: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 10 * 60_000).toISOString(),
    });
    const launched = created ? await negative.browserLaunch() : null;
    const wrongVerifier = await negative.claim(
      await pkceChallenge(randomToken(32)),
    );
    const wrongBrowser = await negative.browserFlow(
      await hash(randomToken(32)),
    );
    const wrongState = await this.env.AUTH_TRANSACTIONS.getByName(
      await aggregateName("transaction", randomToken(32)),
    ).begin(await hash(randomToken(32)));
    if (
      launched?.ok !== true ||
      wrongVerifier.ok ||
      wrongVerifier.code !== "binding_mismatch" ||
      wrongBrowser !== null ||
      wrongState.ok ||
      wrongState.code !== "missing"
    ) {
      return null;
    }
    return {
      schema: "punks.live-staging-auth-proof.v1",
      sourceSha: input.sourceSha,
      stagingDeploymentId: input.stagingDeploymentId,
      authWorkerVersionId: this.env.CF_VERSION_METADATA.id,
      flow,
      negative: {
        wrongOauthState: "refused",
        wrongBrowserBinding: "refused",
        wrongNativePkceVerifier: "refused",
      },
      observedAt: new Date().toISOString(),
    };
  }
}
