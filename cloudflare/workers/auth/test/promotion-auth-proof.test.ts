import { describe, expect, it } from "vitest";

import { hash } from "../src/crypto";
import { authEnv } from "./desktop-ceremony-helpers";

describe("promotion Auth terminal proofs", () => {
  it("redacts one source-bound OAuth success and cancellation", async () => {
    const sourceSha = "ab".repeat(20);
    const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
    const create = async (flowId: string, commitment: string) => {
      const stub = authEnv.DESKTOP_AUTH_FLOWS.getByName(flowId);
      expect(
        await stub.create({
          flowId,
          intent: "sign_in",
          method: "google",
          purpose: null,
          workspaceOwnershipTransfer: null,
          verifierCommitment: commitment,
          environment: "staging",
          currentSessionId: null,
          currentPunkId: null,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          promotionSourceSha: sourceSha,
          promotionStagingDeploymentId: stagingDeploymentId,
        }),
      ).toBe(true);
      return stub;
    };

    const successFlowId = crypto.randomUUID();
    const commitment = "p".repeat(43);
    const success = await create(successFlowId, commitment);
    const launched = await success.browserLaunch();
    if (!launched.ok) throw new Error("OAuth launch missing");
    expect(
      await success.recordBrowserComplete({
        browserBindingHash: await hash(launched.browserBinding),
      }),
    ).toMatchObject({ ok: true });
    const punkId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    expect(await success.ready({ punkId, outcomeCode: "authenticated" })).toBe(
      true,
    );
    const delivery = await success.claim(commitment);
    if (!delivery.ok || delivery.kind !== "session") {
      throw new Error("OAuth delivery missing");
    }
    expect(
      await success.recordPreparedSession({
        deliveryId: delivery.deliveryId,
        sessionId,
      }),
    ).toBe(true);
    expect(
      await success.confirmed({ deliveryId: delivery.deliveryId, sessionId }),
    ).not.toBeNull();
    await expect(success.promotionSuccessProof()).resolves.toMatchObject({
      flowId: successFlowId,
      method: "google",
      methodEvidence: {
        kind: "oauth",
        oauthStateHash: await hash(launched.state),
        providerPkceHash: await hash(launched.codeVerifier),
      },
      sourceSha,
      stagingDeploymentId,
    });

    const cancellationFlowId = crypto.randomUUID();
    const cancellationCommitment = "c".repeat(43);
    const cancellation = await create(
      cancellationFlowId,
      cancellationCommitment,
    );
    expect((await cancellation.browserLaunch()).ok).toBe(true);
    expect(await cancellation.cancel(cancellationCommitment)).not.toBeNull();
    await expect(
      cancellation.promotionCancellationProof(),
    ).resolves.toMatchObject({
      flowId: cancellationFlowId,
      method: "google",
      outcomeCode: "cancelled",
      sourceSha,
      stagingDeploymentId,
    });
  });
});
