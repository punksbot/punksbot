import type { AccountMergeCommitResponse } from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const survivorPunkId = "00000000-0000-8000-8000-000000000001";
const absorbedPunkId = "00000000-0000-8000-8000-000000000002";
const intentId = "10000000-0000-8000-8000-000000000061";
const planId = "20000000-0000-8000-8000-000000000061";

function command() {
  return {
    contract: "account-merge.commit@1" as const,
    commandId: "30000000-0000-8000-8000-000000000061",
    intentId,
    planId,
    planDigest: "a".repeat(64),
    survivorPunkId,
    absorbedPunkId,
    accountRevisions: { survivor: 1, absorbed: 1 },
    confirmation: "merge_accounts_irreversibly" as const,
  };
}

describe("Account Merge API", () => {
  it("commits only from the survivor Session and returns typed progress", async () => {
    const body = command();
    const response = await SELF.fetch(
      `https://punks.bot/api/v1/account-merges/${intentId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-owner",
          "idempotency-key": body.commandId,
        },
        body: JSON.stringify(body),
      },
    );

    expect(response.status, await response.clone().text()).toBe(202);
    const result = (await response.json()) as AccountMergeCommitResponse;
    expect(
      validateContract(
        "punks://contracts/account-merge.commit-response@1",
        result,
      ),
    ).toEqual({ valid: true });
    expect(result).toMatchObject({
      ok: true,
      state: {
        status: "applying",
        survivorPunkId,
        absorbedPunkId,
      },
    });

    const forbidden = await SELF.fetch(
      `https://punks.bot/api/v1/account-merges/${intentId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "__Host-punks_session=session-other",
          "idempotency-key": body.commandId,
        },
        body: JSON.stringify(body),
      },
    );
    expect(forbidden.status).toBe(403);
  });

  it("reads progress only through a current authenticated Punk", async () => {
    const response = await SELF.fetch(
      `https://punks.bot/api/v1/account-merges/${intentId}?planId=${planId}`,
      { headers: { cookie: "__Host-punks_session=session-owner" } },
    );
    expect(response.status, await response.clone().text()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      state: { intentId, planId, survivorPunkId },
    });

    const unauthenticated = await SELF.fetch(
      `https://punks.bot/api/v1/account-merges/${intentId}?planId=${planId}`,
    );
    expect(unauthenticated.status).toBe(401);
  });

  it("rejects malformed percent-encoding as a typed invalid path", async () => {
    const response = await SELF.fetch(
      "https://punks.bot/api/v1/account-merges/%",
      {
        method: "POST",
        headers: { cookie: "__Host-punks_session=session-owner" },
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      type: "https://punks.bot/problems/invalid-input",
      code: "invalid_input",
    });
  });
});
