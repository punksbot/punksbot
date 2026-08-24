import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const workspaceId = "00000000-0000-8000-8000-000000000101";
const secondWorkspaceId = "00000000-0000-8000-8000-000000000201";
const conversationId = "00000000-0000-8000-8000-000000000102";
const messageId = "00000000-0000-8000-8000-000000000103";
const erasureCommandId = "00000000-0000-8000-8000-000000000104";
const conflictingCommandId = "00000000-0000-8000-8000-000000000204";
const firstContentKeyId = "00000000-0000-8000-8000-000000000105";
const secondContentKeyId = "00000000-0000-8000-8000-000000000106";
const conflictingContentKeyId = "00000000-0000-8000-8000-000000000205";

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

function tombstonePath(value: typeof scope): string {
  return `workspaces/${value.workspaceId}/conversations/${value.conversationId}/messages/${value.messageId}/erasure-tombstone.json`;
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
