import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const sourceSha = "ab".repeat(20);
const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
const flowId = "70000000-0000-8000-8000-000000000058";
const methods = ["google", "github", "passkey"] as const;
const flows = Object.fromEntries(
  methods.map((method, index) => [
    method,
    {
      successFlowId: `${index + 1}0000000-0000-8000-8000-000000000058`,
      cancellationFlowId: `${index + 4}0000000-0000-8000-8000-000000000058`,
    },
  ]),
);

async function request(
  authorization = `Bearer ${env.OPERATOR_PROVISIONING_TOKEN}`,
) {
  return SELF.fetch(
    "https://staging.punks.bot/api/internal/v1/promotion/auth-proof",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        contract: "promotion.auth-proof@1",
        sourceSha,
        stagingDeploymentId,
        flowId,
      }),
    },
  );
}

async function requestMatrix() {
  return SELF.fetch(
    "https://staging.punks.bot/api/internal/v1/promotion/auth-proof",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPERATOR_PROVISIONING_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contract: "promotion.auth-matrix-proof@2",
        sourceSha,
        stagingDeploymentId,
        flows,
      }),
    },
  );
}

describe("live staging Auth promotion proof", () => {
  it("returns only a confirmed provider flow and live negative bindings", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      proof: {
        schema: "punks.live-staging-auth-proof.v1",
        sourceSha,
        stagingDeploymentId,
        flow: {
          flowId,
          method: "github",
          environment: "staging",
          outcomeCode: "authenticated",
        },
        negative: {
          wrongOauthState: "refused",
          wrongBrowserBinding: "refused",
          wrongNativePkceVerifier: "refused",
        },
      },
    });
  });

  it("keeps the proof behind the operator boundary", async () => {
    expect((await request("Bearer invalid")).status).toBe(403);
  });

  it("returns the six source-bound provider outcomes as one atomic matrix", async () => {
    const response = await requestMatrix();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      proof: {
        schema: "punks.live-staging-auth-matrix-proof.v2",
        sourceSha,
        stagingDeploymentId,
        flows: {
          google: {
            success: { method: "google", outcomeCode: "authenticated" },
            cancellation: { method: "google", outcomeCode: "cancelled" },
          },
          github: {
            success: { method: "github", outcomeCode: "authenticated" },
            cancellation: { method: "github", outcomeCode: "cancelled" },
          },
          passkey: {
            success: {
              method: "passkey",
              outcomeCode: "passkey_authenticated",
            },
            cancellation: { method: "passkey", outcomeCode: "cancelled" },
          },
        },
        negative: {
          wrongOauthState: "refused",
          wrongBrowserBinding: "refused",
          wrongNativePkceVerifier: "refused",
          wrongPasskeyChallenge: "refused",
        },
      },
    });
  });
});
