import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  LookupAccountMergeRecoveryResult,
  LookupAccountMergeReceiptResult,
  RecordAccountMergeReceiptResult,
} from "../src";

const workspaceId = "00000000-0000-8000-8000-000000000101";
const secondWorkspaceId = "00000000-0000-8000-8000-000000000201";
const conversationId = "00000000-0000-8000-8000-000000000102";
const messageId = "00000000-0000-8000-8000-000000000103";
const erasureCommandId = "00000000-0000-8000-8000-000000000104";
const conflictingCommandId = "00000000-0000-8000-8000-000000000204";
const firstContentKeyId = "00000000-0000-8000-8000-000000000105";
const secondContentKeyId = "00000000-0000-8000-8000-000000000106";
const conflictingContentKeyId = "00000000-0000-8000-8000-000000000205";
const mergeReceiptId = "10000000-0000-8000-8000-000000000061";
const mergeIntentId = "20000000-0000-8000-8000-000000000061";
const mergePlanId = "30000000-0000-8000-8000-000000000061";
const mergeCommandId = "40000000-0000-8000-8000-000000000061";
const survivorPunkId = "50000000-0000-8000-8000-000000000061";
const absorbedPunkId = "60000000-0000-8000-8000-000000000061";

const scope = {
  workspaceId,
  conversationId,
  messageId,
  generationId: messageId,
};
const request = {
  ...scope,
  erasureCommandId,
  expectedContentKeyIds: [secondContentKeyId, firstContentKeyId],
};

function accountMergeRegistry(...args: [] | [unknown]) {
  type Rpc = {
    recordAccountMergeReceipt(
      input: unknown,
    ): Promise<RecordAccountMergeReceiptResult>;
    lookupAccountMergeReceipt(
      input: unknown,
    ): Promise<LookupAccountMergeReceiptResult>;
    lookupAccountMergeRecovery(
      input: unknown,
    ): Promise<LookupAccountMergeRecoveryResult>;
    fetch(request: Request): Promise<Response>;
  };
  const factory = exports.AccountMergeReceiptRegistryService as (options: {
    props: unknown;
  }) => Rpc;
  return factory({
    props:
      args.length === 0
        ? {
            role: "punks-account-merge-receipt-writer",
            environment: "local",
          }
        : args[0],
  });
}

describe("ErasureRegistry RPC", () => {
  beforeEach(async () => {
    const existing = await env.ERASURE_TOMBSTONES.list();
    if (existing.objects.length > 0) {
      await env.ERASURE_TOMBSTONES.delete(
        existing.objects.map(({ key }) => key),
      );
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fences the ordinary lookup path until all recovery receipts preserve state", async () => {
    const identity = {
      executionId: "919191919191:linux-x64:coupure:erasure-registry",
      candidateSha: "91".repeat(20),
      stagingDeploymentId: `sha256:${"92".repeat(32)}`,
      type: "coupure" as const,
      authority: "erasure-registry",
      target: {
        kind: "service" as const,
        id: "erasure-registry",
        probe: {
          punkId: "00000000-0000-8000-8000-000000000001",
          workspaceId: "00000000-0000-8000-8000-000000000059",
          workspaceSlug: "promotion-fixture",
          conversationId: "00000000-0000-8000-8000-000000000060",
          messageId: "00000000-0000-8000-8000-000000000058",
        },
      },
    };
    const fault = env.PROMOTION_AUTHORITY_FAULTS.getByName("erasure-registry");
    await expect(fault.injectPromotionFault(identity)).resolves.toMatchObject({
      phase: "injected",
      stateFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: false,
      code: "storage_unavailable",
    });
    for (const proof of [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
      "recu-resistant-pitr",
    ] as const) {
      await expect(
        fault.recoverPromotionFault({ ...identity, proof }),
      ).resolves.toMatchObject({ proof });
    }
    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: true,
      tombstone: null,
    });
  });

  it("records and looks up one canonical Message erasure tombstone", async () => {
    const recorded = await exports.default.record(request);

    expect(recorded.ok).toBe(true);
    if (!recorded.ok) {
      return;
    }
    expect(recorded.replayed).toBe(false);
    expect(recorded.tombstone).toMatchObject({
      schemaVersion: 1,
      ...scope,
      erasureCommandId,
      expectedContentKeyIds: [firstContentKeyId, secondContentKeyId],
    });
    expect(recorded.tombstone.recordedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(recorded.tombstone.tombstoneHash).toMatch(/^[0-9a-f]{64}$/);

    const draftJson = JSON.stringify({
      conversationId,
      erasureCommandId,
      expectedContentKeyIds: [firstContentKeyId, secondContentKeyId],
      generationId: messageId,
      messageId,
      recordedAt: recorded.tombstone.recordedAt,
      schemaVersion: 1,
      workspaceId,
    });
    expect(recorded.tombstone.tombstoneHash).toBe(await sha256(draftJson));
    await expect(
      env.ERASURE_TOMBSTONES.get(tombstonePath(scope)).then((value) =>
        value?.text(),
      ),
    ).resolves.toBe(
      JSON.stringify({
        conversationId,
        erasureCommandId,
        expectedContentKeyIds: [firstContentKeyId, secondContentKeyId],
        generationId: messageId,
        messageId,
        recordedAt: recorded.tombstone.recordedAt,
        schemaVersion: 1,
        tombstoneHash: recorded.tombstone.tombstoneHash,
        workspaceId,
      }),
    );
    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: true,
      tombstone: recorded.tombstone,
    });
  });

  it("replays the exact decision without changing its timestamp or object", async () => {
    const first = await exports.default.record(request);
    const second = await exports.default.record({
      ...request,
      expectedContentKeyIds: [firstContentKeyId, secondContentKeyId],
    });

    expect(first.ok).toBe(true);
    expect(second).toEqual(
      first.ok
        ? { ok: true, replayed: true, tombstone: first.tombstone }
        : undefined,
    );
    await expect(env.ERASURE_TOMBSTONES.list()).resolves.toMatchObject({
      objects: [{ key: tombstonePath(scope) }],
    });
  });

  it("serializes concurrent exact records into one create and one replay", async () => {
    const results = await Promise.all([
      exports.default.record(request),
      exports.default.record(request),
    ]);

    expect(results.every(({ ok }) => ok)).toBe(true);
    expect(
      results.map((result) => (result.ok ? result.replayed : undefined)).sort(),
    ).toEqual([false, true]);
    if (results[0]?.ok && results[1]?.ok) {
      expect(results[0].tombstone).toEqual(results[1].tombstone);
    }
    expect((await env.ERASURE_TOMBSTONES.list()).objects).toHaveLength(1);
  });

  it("fails closed on command and content-key-set idempotency conflicts", async () => {
    await expect(exports.default.record(request)).resolves.toMatchObject({
      ok: true,
    });

    await expect(
      exports.default.record({
        ...request,
        erasureCommandId: conflictingCommandId,
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      exports.default.record({
        ...request,
        expectedContentKeyIds: [conflictingContentKeyId],
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
  });

  it("rejects a stored scope conflict and never returns the mismatched tombstone", async () => {
    const otherScope = { ...scope, workspaceId: secondWorkspaceId };
    const other = await exports.default.record({
      ...request,
      ...otherScope,
    });
    expect(other.ok).toBe(true);
    const otherObject = await env.ERASURE_TOMBSTONES.get(
      tombstonePath(otherScope),
    );
    expect(otherObject).not.toBeNull();
    if (otherObject === null) {
      throw new Error("Expected the other Workspace tombstone");
    }
    await env.ERASURE_TOMBSTONES.put(
      tombstonePath(scope),
      await otherObject.arrayBuffer(),
    );

    await expect(exports.default.record(request)).resolves.toEqual({
      ok: false,
      code: "conflict",
    });
    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: false,
      code: "corrupt_tombstone",
    });
  });

  it("fails closed when an existing object is malformed", async () => {
    await env.ERASURE_TOMBSTONES.put(tombstonePath(scope), "not-json");

    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: false,
      code: "corrupt_tombstone",
    });
    await expect(exports.default.record(request)).resolves.toEqual({
      ok: false,
      code: "corrupt_tombstone",
    });
  });

  it("fails closed when a canonical object has a forged hash", async () => {
    const recorded = await exports.default.record(request);
    expect(recorded.ok).toBe(true);
    const stored = await env.ERASURE_TOMBSTONES.get(tombstonePath(scope));
    if (stored === null) {
      throw new Error("Expected a stored tombstone");
    }
    const forged = JSON.parse(await stored.text()) as Record<string, unknown>;
    forged.tombstoneHash = "0".repeat(64);
    await env.ERASURE_TOMBSTONES.put(
      tombstonePath(scope),
      JSON.stringify(forged),
    );

    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: false,
      code: "corrupt_tombstone",
    });
  });

  it("isolates identical Conversation and Message IDs by Workspace", async () => {
    const otherScope = { ...scope, workspaceId: secondWorkspaceId };
    const first = await exports.default.record(request);
    const second = await exports.default.record({
      ...request,
      ...otherScope,
    });

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toMatchObject({ ok: true, replayed: false });
    await expect(exports.default.lookup(scope)).resolves.toMatchObject({
      ok: true,
      tombstone: { workspaceId },
    });
    await expect(exports.default.lookup(otherScope)).resolves.toMatchObject({
      ok: true,
      tombstone: { workspaceId: secondWorkspaceId },
    });
    const listed = await env.ERASURE_TOMBSTONES.list();
    expect(listed.objects.map(({ key }) => key).sort()).toEqual(
      [tombstonePath(scope), tombstonePath(otherScope)].sort(),
    );
  });

  it.each([
    null,
    {},
    { ...request, workspaceId: "not-a-uuid" },
    {
      ...request,
      workspaceId: "AAAAAAAA-0000-8000-8000-000000000101",
    },
    { ...request, generationId: workspaceId },
    { ...request, expectedContentKeyIds: [] },
    {
      ...request,
      expectedContentKeyIds: [firstContentKeyId, firstContentKeyId],
    },
    { ...request, expectedContentKeyIds: ["not-a-uuid"] },
    {
      ...request,
      expectedContentKeyIds: Array.from(
        { length: 1_001 },
        (_, index) =>
          `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
      ),
    },
    { ...request, unexpected: true },
  ])("rejects invalid record input %#", async (invalid) => {
    await expect(exports.default.record(invalid)).resolves.toEqual({
      ok: false,
      code: "invalid_request",
    });
    await expect(env.ERASURE_TOMBSTONES.list()).resolves.toMatchObject({
      objects: [],
    });
  });

  it("rejects invalid lookup input and returns null for an absent tombstone", async () => {
    await expect(
      exports.default.lookup({ ...scope, unexpected: true }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    await expect(exports.default.lookup(scope)).resolves.toEqual({
      ok: true,
      tombstone: null,
    });
  });

  it("never persists plaintext, plaintext hashes, raw keys, or ciphertext refs", async () => {
    const secret = "DO-NOT-PERSIST-super-secret-plaintext";
    const logged = ["log", "info", "warn", "error"].map((method) =>
      vi.spyOn(console, method as "log").mockImplementation(() => undefined),
    );
    await expect(
      exports.default.record({
        ...request,
        plaintext: secret,
        plaintextHash: `hash-${secret}`,
        contentKey: `raw-key-${secret}`,
        ciphertextRef: `r2://${secret}`,
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    expect((await env.ERASURE_TOMBSTONES.list()).objects).toHaveLength(0);

    await expect(exports.default.record(request)).resolves.toMatchObject({
      ok: true,
    });
    const raw = await env.ERASURE_TOMBSTONES.get(tombstonePath(scope)).then(
      (value) => value?.text(),
    );
    expect(raw).toBeDefined();
    expect(raw).not.toContain(secret);
    expect(
      logged
        .flatMap(({ mock }) => mock.calls)
        .flat()
        .join(" "),
    ).not.toContain(secret);
    expect(Object.keys(JSON.parse(raw ?? "null")).sort()).toEqual([
      "conversationId",
      "erasureCommandId",
      "expectedContentKeyIds",
      "generationId",
      "messageId",
      "recordedAt",
      "schemaVersion",
      "tombstoneHash",
      "workspaceId",
    ]);
  });

  it.each([
    ["GET", "/"],
    ["POST", "/record"],
    ["POST", "/lookup"],
  ])("returns 404 for HTTP %s %s", async (method, path) => {
    const response = await exports.default.fetch(
      new Request(`https://erasure.invalid${path}`, { method }),
    );

    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });
});

describe("Account Merge anti-resurrection receipts", () => {
  const mergeReceiptDecision = {
    receiptId: mergeReceiptId,
    intentId: mergeIntentId,
    planId: mergePlanId,
    planDigest: "a".repeat(64),
    commitCommandId: mergeCommandId,
    survivorPunkId,
    absorbedPunkId,
    accountRevisions: { survivor: 7, absorbed: 4 },
  };
  const mergeReceiptRequest = {
    ...mergeReceiptDecision,
    recoveryDescriptor: '{"authorityManifest":{},"plan":{},"schemaVersion":1}',
  };

  beforeEach(async () => {
    const existing = await env.ERASURE_TOMBSTONES.list();
    if (existing.objects.length > 0) {
      await env.ERASURE_TOMBSTONES.delete(
        existing.objects.map(({ key }) => key),
      );
    }
  });

  it("records, replays, and looks up one canonical terminal receipt", async () => {
    const recorded =
      await accountMergeRegistry().recordAccountMergeReceipt(
        mergeReceiptRequest,
      );
    expect(recorded).toMatchObject({
      ok: true,
      replayed: false,
      receipt: {
        contract: "account-merge.receipt@1",
        schemaVersion: 1,
        ...mergeReceiptDecision,
      },
    });
    if (!recorded.ok) throw new TypeError("Expected a merge receipt");
    expect(recorded.receipt).not.toHaveProperty("recoveryDescriptor");
    expect(recorded.receipt.committedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(recorded.receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await accountMergeRegistry().lookupAccountMergeReceipt({
        absorbedPunkId,
      }),
    ).toEqual({ ok: true, receipt: recorded.receipt });
    await expect(
      accountMergeRegistry().lookupAccountMergeRecovery({ absorbedPunkId }),
    ).resolves.toEqual({
      ok: true,
      receipt: recorded.receipt,
      recoveryDescriptor: mergeReceiptRequest.recoveryDescriptor,
    });
    await expect(
      accountMergeRegistry().recordAccountMergeReceipt(mergeReceiptRequest),
    ).resolves.toEqual({
      ok: true,
      replayed: true,
      receipt: recorded.receipt,
    });
    await expect(env.ERASURE_TOMBSTONES.list()).resolves.toMatchObject({
      objects: [{ key: accountMergeReceiptPath(absorbedPunkId) }],
    });
  });

  it("fails closed for a conflicting decision or corrupt stored receipt", async () => {
    await expect(
      accountMergeRegistry().recordAccountMergeReceipt(mergeReceiptRequest),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      accountMergeRegistry().recordAccountMergeReceipt({
        ...mergeReceiptRequest,
        survivorPunkId: crypto.randomUUID(),
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });
    await expect(
      accountMergeRegistry().recordAccountMergeReceipt({
        ...mergeReceiptRequest,
        recoveryDescriptor: "{}",
      }),
    ).resolves.toEqual({ ok: false, code: "conflict" });

    await env.ERASURE_TOMBSTONES.put(
      accountMergeReceiptPath(absorbedPunkId),
      "not-json",
    );
    await expect(
      accountMergeRegistry().lookupAccountMergeReceipt({ absorbedPunkId }),
    ).resolves.toEqual({ ok: false, code: "corrupt_receipt" });
  });

  it("rejects expanded or cross-account lookup input without writing", async () => {
    await expect(
      accountMergeRegistry().recordAccountMergeReceipt({
        ...mergeReceiptRequest,
        sessionToken: "must-not-cross-registry-boundary",
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    await expect(
      accountMergeRegistry().recordAccountMergeReceipt({
        ...mergeReceiptRequest,
        recoveryDescriptor: '{"schemaVersion":1, "plan":{}}',
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    await expect(
      accountMergeRegistry().lookupAccountMergeReceipt({
        absorbedPunkId,
        survivorPunkId,
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
    expect((await env.ERASURE_TOMBSTONES.list()).objects).toHaveLength(0);
  });

  it("rejects missing, cross-environment, or widened receipt-writer props", async () => {
    for (const props of [
      undefined,
      {},
      {
        role: "punks-account-merge-receipt-writer",
        environment: "staging",
      },
      {
        role: "punks-account-merge-receipt-writer",
        environment: "local",
        delete: true,
      },
    ]) {
      await expect(
        accountMergeRegistry(props).recordAccountMergeReceipt(
          mergeReceiptRequest,
        ),
      ).resolves.toEqual({ ok: false, code: "invalid_request" });
    }
  });
});

function tombstonePath(value: typeof scope): string {
  return `workspaces/${value.workspaceId}/conversations/${value.conversationId}/messages/${value.messageId}/erasure-tombstone.json`;
}

function accountMergeReceiptPath(punkId: string): string {
  return `account-merges/v1/absorbed/${punkId}/receipt.json`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
