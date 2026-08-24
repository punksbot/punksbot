import { WorkerEntrypoint } from "cloudflare:workers";

const SCHEMA_VERSION = 1 as const;
const MAX_CONTENT_KEY_IDS = 1_000;
const MAX_TOMBSTONE_BYTES = 64 * 1024;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hashPattern = /^[0-9a-f]{64}$/;
const scopeKeys = [
  "conversationId",
  "generationId",
  "messageId",
  "workspaceId",
] as const;
const recordKeys = [
  "conversationId",
  "erasureCommandId",
  "expectedContentKeyIds",
  "generationId",
  "messageId",
  "workspaceId",
] as const;
const tombstoneKeys = [
  "conversationId",
  "erasureCommandId",
  "expectedContentKeyIds",
  "generationId",
  "messageId",
  "recordedAt",
  "schemaVersion",
  "tombstoneHash",
  "workspaceId",
] as const;

/** Scope that uniquely identifies one Message erasure generation. */
export interface ErasureScope {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  generationId: string;
}

/** Request to durably record one irreversible erasure decision. */
export interface RecordErasureInput extends ErasureScope {
  erasureCommandId: string;
  expectedContentKeyIds: string[];
}

/** Canonical immutable tombstone stored by the erasure registry. */
export interface ErasureTombstone extends RecordErasureInput {
  schemaVersion: 1;
  recordedAt: string;
  tombstoneHash: string;
}

export type RecordErasureResult =
  | { ok: true; tombstone: ErasureTombstone; replayed: boolean }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "conflict"
        | "corrupt_tombstone"
        | "storage_unavailable";
    };

export type LookupErasureResult =
  | { ok: true; tombstone: ErasureTombstone | null }
  | {
      ok: false;
      code: "invalid_request" | "corrupt_tombstone" | "storage_unavailable";
    };

type TombstoneDraft = Omit<ErasureTombstone, "tombstoneHash">;
type StoredRead =
  | { status: "missing" }
  | { status: "valid"; tombstone: ErasureTombstone }
  | { status: "scope_mismatch" }
  | { status: "corrupt" }
  | { status: "unavailable" };

/** Private, append-only registry of Message erasure tombstones. */
export default class ErasureRegistry extends WorkerEntrypoint<CloudflareBindings> {
  /** Records one create-only tombstone or replays the exact prior decision. */
  async record(input: unknown): Promise<RecordErasureResult> {
    const request = validateRecordInput(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }

    const draft: TombstoneDraft = {
      schemaVersion: SCHEMA_VERSION,
      workspaceId: request.workspaceId,
      conversationId: request.conversationId,
      messageId: request.messageId,
      generationId: request.generationId,
      erasureCommandId: request.erasureCommandId,
      expectedContentKeyIds: request.expectedContentKeyIds,
      recordedAt: new Date().toISOString(),
    };
    const tombstone: ErasureTombstone = {
      ...draft,
      tombstoneHash: await digestHex(canonicalJson(draft)),
    };
    const body = canonicalJson(tombstone);
    const path = tombstonePath(request);

    let created: R2Object | null;
    try {
      created = await this.env.ERASURE_TOMBSTONES.put(path, body, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
      });
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
    if (created !== null) {
      return { ok: true, tombstone, replayed: false };
    }

    const existing = await readStored(this.env.ERASURE_TOMBSTONES, request);
    if (existing.status === "unavailable" || existing.status === "missing") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (existing.status === "corrupt") {
      return { ok: false, code: "corrupt_tombstone" };
    }
    if (existing.status === "scope_mismatch") {
      return { ok: false, code: "conflict" };
    }
    if (!sameDecision(existing.tombstone, request)) {
      return { ok: false, code: "conflict" };
    }
    return { ok: true, tombstone: existing.tombstone, replayed: true };
  }

  /** Looks up the immutable tombstone for an exact Message scope. */
  async lookup(input: unknown): Promise<LookupErasureResult> {
    const scope = validateScopeInput(input);
    if (scope === null) {
      return { ok: false, code: "invalid_request" };
    }
    const stored = await readStored(this.env.ERASURE_TOMBSTONES, scope);
    if (stored.status === "unavailable") {
      return { ok: false, code: "storage_unavailable" };
    }
    if (stored.status === "corrupt" || stored.status === "scope_mismatch") {
      return { ok: false, code: "corrupt_tombstone" };
    }
    return {
      ok: true,
      tombstone: stored.status === "missing" ? null : stored.tombstone,
    };
  }

  /** Refuses every HTTP request; callers must use a service binding RPC. */
  override fetch(_request: Request): Response {
    return new Response(null, { status: 404 });
  }
}

function validateRecordInput(input: unknown): RecordErasureInput | null {
  if (!isExactRecord(input, recordKeys)) {
    return null;
  }
  const scope = validateScopeFields(input);
  if (
    scope === null ||
    typeof input.erasureCommandId !== "string" ||
    !uuidPattern.test(input.erasureCommandId) ||
    !Array.isArray(input.expectedContentKeyIds) ||
    input.expectedContentKeyIds.length === 0 ||
    input.expectedContentKeyIds.length > MAX_CONTENT_KEY_IDS ||
    !input.expectedContentKeyIds.every(
      (value) => typeof value === "string" && uuidPattern.test(value),
    )
  ) {
    return null;
  }
  const expectedContentKeyIds = sortedUnique(input.expectedContentKeyIds);
  if (expectedContentKeyIds === null) {
    return null;
  }
  return {
    ...scope,
    erasureCommandId: input.erasureCommandId,
    expectedContentKeyIds,
  };
}

function validateScopeInput(input: unknown): ErasureScope | null {
  return isExactRecord(input, scopeKeys) ? validateScopeFields(input) : null;
}

function validateScopeFields(
  input: Record<string, unknown>,
): ErasureScope | null {
  if (
    typeof input.workspaceId !== "string" ||
    !uuidPattern.test(input.workspaceId) ||
    typeof input.conversationId !== "string" ||
    !uuidPattern.test(input.conversationId) ||
    typeof input.messageId !== "string" ||
    !uuidPattern.test(input.messageId) ||
    typeof input.generationId !== "string" ||
    input.generationId !== input.messageId
  ) {
    return null;
  }
  return {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    generationId: input.generationId,
  };
}

async function readStored(
  bucket: R2Bucket,
  scope: ErasureScope,
): Promise<StoredRead> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(tombstonePath(scope));
  } catch {
    return { status: "unavailable" };
  }
  if (object === null) {
    return { status: "missing" };
  }
  if (object.size > MAX_TOMBSTONE_BYTES) {
    return { status: "corrupt" };
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      await object.arrayBuffer(),
    );
  } catch {
    return { status: "corrupt" };
  }
  const tombstone = await validateStoredTombstone(text);
  if (tombstone === null) {
    return { status: "corrupt" };
  }
  return sameScope(tombstone, scope)
    ? { status: "valid", tombstone }
    : { status: "scope_mismatch" };
}

async function validateStoredTombstone(
  text: string,
): Promise<ErasureTombstone | null> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isExactRecord(value, tombstoneKeys) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.recordedAt !== "string" ||
    !isCanonicalTimestamp(value.recordedAt) ||
    typeof value.tombstoneHash !== "string" ||
    !hashPattern.test(value.tombstoneHash)
  ) {
    return null;
  }
  const request = validateRecordInput({
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
    messageId: value.messageId,
    generationId: value.generationId,
    erasureCommandId: value.erasureCommandId,
    expectedContentKeyIds: value.expectedContentKeyIds,
  });
  if (
    request === null ||
    !sameStringArray(request.expectedContentKeyIds, value.expectedContentKeyIds)
  ) {
    return null;
  }
  const draft: TombstoneDraft = {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: request.workspaceId,
    conversationId: request.conversationId,
    messageId: request.messageId,
    generationId: request.generationId,
    erasureCommandId: request.erasureCommandId,
    expectedContentKeyIds: request.expectedContentKeyIds,
    recordedAt: value.recordedAt,
  };
  const expectedHash = await digestHex(canonicalJson(draft));
  const tombstone: ErasureTombstone = {
    ...draft,
    tombstoneHash: value.tombstoneHash,
  };
  return expectedHash === value.tombstoneHash &&
    canonicalJson(tombstone) === text
    ? tombstone
    : null;
}

function tombstonePath(scope: ErasureScope): string {
  return `workspaces/${scope.workspaceId}/conversations/${scope.conversationId}/messages/${scope.messageId}/erasure-tombstone.json`;
}

function sameDecision(
  tombstone: ErasureTombstone,
  request: RecordErasureInput,
): boolean {
  return (
    sameScope(tombstone, request) &&
    tombstone.erasureCommandId === request.erasureCommandId &&
    sameStringArray(
      tombstone.expectedContentKeyIds,
      request.expectedContentKeyIds,
    )
  );
}

function sameScope(left: ErasureScope, right: ErasureScope): boolean {
  return (
    left.workspaceId === right.workspaceId &&
    left.conversationId === right.conversationId &&
    left.messageId === right.messageId &&
    left.generationId === right.generationId
  );
}

function sortedUnique(values: string[]): string[] | null {
  const sorted = [...values].sort();
  return sorted.some((value, index) => index > 0 && value === sorted[index - 1])
    ? null
    : sorted;
}

function sameStringArray(left: string[], right: unknown): boolean {
  return (
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isExactRecord<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is Record<Keys[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  return sameStringArray([...keys], actual);
}

function isCanonicalTimestamp(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("Unsupported canonical JSON value");
  }
  return encoded;
}

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
