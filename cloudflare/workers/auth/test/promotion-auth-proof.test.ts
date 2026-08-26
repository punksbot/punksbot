import { describe, expect, it } from "vitest";

import { hash } from "../src/crypto";
import { authEnv } from "./desktop-ceremony-helpers";

describe("promotion Auth terminal proofs", () => {
  it("redacts one source-bound passkey success and cancellation", async () => {
    const sourceSha = "ab".repeat(20);
    const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
    const create = async (flowId: string, commitment: string) => {
      const stub = authEnv.DESKTOP_AUTH_FLOWS.getByName(flowId);
      expect(
        await stub.create({
          flowId,
          intent: "sign_in",
          method: "passkey",
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
    if (!launched.ok) throw new Error("passkey launch missing");
    expect(
      await success.setPasskeyChallenge({
        browserBindingHash: await hash(launched.browserBinding),
        challenge: "passkey-challenge",
      }),
    ).toBe(true);
    expect(await success.recordPasskeyAuthentication("f".repeat(64))).toBe(
      true,
    );
    const punkId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    expect(
      await success.ready({ punkId, outcomeCode: "passkey_authenticated" }),
    ).toBe(true);
    const delivery = await success.claim(commitment);
    if (!delivery.ok || delivery.kind !== "session") {
      throw new Error("passkey delivery missing");
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
      method: "passkey",
      methodEvidence: {
        kind: "passkey",
        credentialIdHash: "f".repeat(64),
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
      method: "passkey",
      outcomeCode: "cancelled",
      sourceSha,
      stagingDeploymentId,
    });
  });
});
