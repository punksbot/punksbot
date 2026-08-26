import { WorkerEntrypoint } from "cloudflare:workers";

const promotionFaultStates = new Map();
const promotionRecoveryProofs = [
  "roll-forward",
  "rpo-logique-nul",
  "session-non-restauree",
  "recu-resistant-pitr",
];

export class PromotionAuthorityFaultService extends WorkerEntrypoint {
  injectPromotionFault(input) {
    const existing = promotionFaultStates.get(input.executionId);
    if (existing !== undefined) return structuredClone(existing);
    const state = {
      schema: "punks.promotion-authority-fault-state.v1",
      ...input,
      phase: "injected",
      proof: null,
      sequence: 1,
      stateFingerprint: "f".repeat(64),
    };
    promotionFaultStates.set(input.executionId, state);
    return structuredClone(state);
  }

  recoverPromotionFault(input) {
    const existing = promotionFaultStates.get(input.executionId);
    const index = promotionRecoveryProofs.indexOf(input.proof);
    if (existing === undefined || index < 0) {
      throw new Error("promotion fault recovery is invalid");
    }
    const state = {
      ...existing,
      phase:
        index === promotionRecoveryProofs.length - 1
          ? "recovered"
          : "recovering",
      proof: input.proof,
      sequence: index + 2,
    };
    promotionFaultStates.set(input.executionId, state);
    return structuredClone(state);
  }

  probePromotionFault(input) {
    return structuredClone(promotionFaultStates.get(input.executionId) ?? null);
  }

  observePromotionFault(input) {
    const state = promotionFaultStates.get(input.executionId);
    if (state === undefined)
      throw new Error("promotion authority fault is missing");
    if (state.phase !== "recovered") {
      throw new Error(
        `promotion authority fault is active:${state.phase}:${state.type}`,
      );
    }
    return structuredClone(state);
  }
}

export class RuntimeIdentityService extends WorkerEntrypoint {
  async runtimeVersion() {
    return { versionId: "00000000-0000-4000-8000-000000000003" };
  }
}

const tombstones = new Map();
const calls = [];
let lookupMode = "available";
let recordMode = "available";

const canonicalJson = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const digestHex = async (value) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

const scopeKey = (scope) =>
  [
    scope.workspaceId,
    scope.conversationId,
    scope.messageId,
    scope.generationId,
  ].join("/");

const sameDecision = (left, right) =>
  left.workspaceId === right.workspaceId &&
  left.conversationId === right.conversationId &&
  left.messageId === right.messageId &&
  left.generationId === right.generationId &&
  left.erasureCommandId === right.erasureCommandId &&
  JSON.stringify(left.expectedContentKeyIds) ===
    JSON.stringify([...right.expectedContentKeyIds].sort());

async function createTombstone(input) {
  const draft = {
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    generationId: input.generationId,
    erasureCommandId: input.erasureCommandId,
    expectedContentKeyIds: [...input.expectedContentKeyIds].sort(),
    recordedAt: "2026-08-20T20:00:00.000Z",
  };
  return {
    ...draft,
    tombstoneHash: await digestHex(canonicalJson(draft)),
  };
}

export default class ErasureFixture extends WorkerEntrypoint {
  async lookup(input) {
    calls.push({ method: "lookup", input: structuredClone(input) });
    if (lookupMode === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (lookupMode === "corrupt") {
      return { ok: false, code: "corrupt_tombstone" };
    }
    if (lookupMode === "malformed") {
      return { ok: true, tombstone: { schemaVersion: 1 } };
    }
    return {
      ok: true,
      tombstone: tombstones.get(scopeKey(input)) ?? null,
    };
  }

  async record(input) {
    calls.push({ method: "record", input: structuredClone(input) });
    if (recordMode === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (recordMode === "conflict") {
      return { ok: false, code: "conflict" };
    }
    if (recordMode === "malformed") {
      return {
        ok: true,
        tombstone: { schemaVersion: 1 },
        replayed: false,
      };
    }
    const key = scopeKey(input);
    const existing = tombstones.get(key);
    if (existing !== undefined) {
      return sameDecision(existing, input)
        ? { ok: true, tombstone: existing, replayed: true }
        : { ok: false, code: "conflict" };
    }
    const tombstone = await createTombstone(input);
    tombstones.set(key, tombstone);
    return { ok: true, tombstone, replayed: false };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/__test/reset") {
      tombstones.clear();
      calls.length = 0;
      lookupMode = "available";
      recordMode = "available";
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/mode") {
      const mode = await request.json();
      lookupMode = mode.lookup ?? lookupMode;
      recordMode = mode.record ?? recordMode;
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/tombstone") {
      const input = await request.json();
      const tombstone = await createTombstone(input);
      tombstones.set(scopeKey(input), tombstone);
      return Response.json({ ok: true, tombstone });
    }
    if (request.method === "GET" && url.pathname === "/__test/calls") {
      return Response.json({ calls });
    }
    return new Response(null, { status: 404 });
  }
}
