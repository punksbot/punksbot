import { describe, expect, it } from "vitest";

import { validateContract } from "../src";

const receipt = {
  contract: "account-merge.receipt@1",
  schemaVersion: 1,
  receiptId: "10000000-0000-8000-8000-000000000061",
  intentId: "20000000-0000-8000-8000-000000000061",
  planId: "30000000-0000-8000-8000-000000000061",
  planDigest: "a".repeat(64),
  commitCommandId: "40000000-0000-8000-8000-000000000061",
  survivorPunkId: "50000000-0000-8000-8000-000000000061",
  absorbedPunkId: "60000000-0000-8000-8000-000000000061",
  accountRevisions: { survivor: 7, absorbed: 4 },
  committedAt: "2032-01-01T00:00:00.000Z",
  receiptHash: "b".repeat(64),
} as const;

const state = {
  contract: "account-merge.state@1",
  schemaVersion: 1,
  intentId: receipt.intentId,
  planId: receipt.planId,
  planDigest: receipt.planDigest,
  status: "applying",
  survivorPunkId: receipt.survivorPunkId,
  absorbedPunkId: receipt.absorbedPunkId,
  applicationCursor: 3,
  applicationTotal: 8,
  receipt,
  lastFailure: null,
  committedAt: receipt.committedAt,
  completedAt: null,
  updatedAt: "2032-01-01T00:00:01.000Z",
} as const;

describe("account merge commit contracts", () => {
  it("accepts the exact irreversible command and immutable receipt", () => {
    const command = {
      contract: "account-merge.commit@1",
      commandId: receipt.commitCommandId,
      intentId: receipt.intentId,
      planId: receipt.planId,
      planDigest: receipt.planDigest,
      survivorPunkId: receipt.survivorPunkId,
      absorbedPunkId: receipt.absorbedPunkId,
      accountRevisions: receipt.accountRevisions,
      confirmation: "merge_accounts_irreversibly",
    };

    expect(
      validateContract("punks://contracts/account-merge.commit@1", command)
        .valid,
    ).toBe(true);
    expect(
      validateContract("punks://contracts/account-merge.receipt@1", receipt)
        .valid,
    ).toBe(true);
    expect(
      validateContract("punks://contracts/account-merge.commit@1", {
        ...command,
        confirmation: "yes",
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/account-merge.receipt@1", {
        ...receipt,
        sessionToken: "forbidden",
      }).valid,
    ).toBe(false);
  });

  it("pins receipt presence to the point of no return and completion", () => {
    expect(
      validateContract("punks://contracts/account-merge.state@1", state).valid,
    ).toBe(true);
    expect(
      validateContract("punks://contracts/account-merge.state@1", {
        ...state,
        status: "planned",
        applicationCursor: 0,
        receipt: null,
        committedAt: null,
      }).valid,
    ).toBe(true);
    expect(
      validateContract("punks://contracts/account-merge.state@1", {
        ...state,
        status: "preparing",
        receipt,
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/account-merge.state@1" as never, {
        ...state,
        status: "completed",
        completedAt: null,
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/account-merge.state@1" as never, {
        ...state,
        status: "completed",
        applicationCursor: state.applicationTotal,
        completedAt: "2032-01-01T00:00:02.000Z",
      }).valid,
    ).toBe(true);
  });

  it("keeps post-commit progress and pre-commit failures typed", () => {
    expect(
      validateContract(
        "punks://contracts/account-merge.commit-response@1" as never,
        {
          contract: "account-merge.commit-response@1",
          ok: true,
          state,
          replayed: false,
        },
      ).valid,
    ).toBe(true);
    for (const code of [
      "invalid_request",
      "plan_unavailable",
      "plan_expired",
      "revision_conflict",
      "blocking_conflict",
      "authority_unavailable",
      "idempotency_conflict",
      "receipt_conflict",
    ]) {
      expect(
        validateContract(
          "punks://contracts/account-merge.commit-response@1" as never,
          {
            contract: "account-merge.commit-response@1",
            ok: false,
            code,
            correlationId: "merge-commit",
          },
        ).valid,
        code,
      ).toBe(true);
    }
  });
});
