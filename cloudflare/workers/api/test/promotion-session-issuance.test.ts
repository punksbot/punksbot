import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const SOURCE_SHA = "cd".repeat(20);

async function issue(
  body: unknown,
  authorization = `Bearer ${env.OPERATOR_PROVISIONING_TOKEN}`,
) {
  return SELF.fetch(
    "https://staging.punks.bot/api/internal/v1/promotion/session",
    {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("promotion Session issuance", () => {
  it("returns only the source-bound native bundle through operator authority", async () => {
    const response = await issue({
      contract: "promotion.session-issue@1",
      sourceSha: SOURCE_SHA,
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      sourceSha: SOURCE_SHA,
      session: {
        source_sha: SOURCE_SHA,
        cookie: `__Host-punks_session=${"s".repeat(48)}`,
        metadata: {
          session_id: "70000000-0000-8000-8000-000000000058",
          punk_id: "80000000-0000-8000-8000-000000000058",
          expires_at_seconds: 4_102_444_800,
          last_renewed_at_seconds: null,
        },
        revoke_capability: "r".repeat(64),
        revoke_expires_at_seconds: 4_102_444_800,
      },
    });
  });

  it("fails closed without the exact operator credential or source SHA", async () => {
    expect(
      (
        await issue(
          { contract: "promotion.session-issue@1", sourceSha: SOURCE_SHA },
          "Bearer invalid",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await issue({
          contract: "promotion.session-issue@1",
          sourceSha: "not-a-sha",
        })
      ).status,
    ).toBe(400);
  });
});
