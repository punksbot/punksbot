import { WorkerEntrypoint } from "cloudflare:workers";

const MAX_TOKENS = 32;
const MAX_LIMIT = 100;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const tokenPattern = /^h2_[A-Za-z0-9_-]{43}$/;
const requestKeys = [
  "algorithm",
  "conversationId",
  "expectedCursor",
  "limit",
  "threadRootMessageId",
  "tokens",
  "workspaceId",
] as const;
const requestWithCursorKeys = [
  "algorithm",
  "conversationId",
  "cursor",
  "expectedCursor",
  "limit",
  "threadRootMessageId",
  "tokens",
  "workspaceId",
] as const;

/** Internal RPC cursor; the public API must wrap it in an encrypted cursor. */
export type MessageCandidateCursor = readonly [
  createdCursor: number,
  conversationId: string,
  messageId: string,
];

export interface SearchMessageCandidatesInput {
  workspaceId: string;
  conversationId: string;
  threadRootMessageId: string | null;
  expectedCursor: number;
  algorithm: "hmac-sha256-conversation-v2";
  tokens: string[];
  limit: number;
  cursor?: MessageCandidateCursor;
}

export interface MessageSearchCandidate {
  messageId: string;
  conversationId: string;
  createdCursor: number;
  lastCursor: number;
}

export type SearchMessageCandidatesResult =
  | {
      ok: true;
      indexState: "current" | "lagging";
      candidates: MessageSearchCandidate[];
      nextCursor: MessageCandidateCursor | null;
    }
  | { ok: false; code: "invalid_request" | "storage_unavailable" };

interface CandidateRow {
  message_id: unknown;
  conversation_id: unknown;
  created_cursor: unknown;
  last_cursor: unknown;
}

interface ProjectionCheckpointRow {
  projected_cursor: unknown;
}

/** Dedicated private probe for the version executing this Search Worker. */
export class RuntimeIdentityService extends WorkerEntrypoint<CloudflareBindings> {
  override fetch(): Response {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  runtimeVersion(): { versionId: string } {
    return { versionId: this.env.CF_VERSION_METADATA.id };
  }
}

/** Private, bounded lookup of active Message candidates from D1 projections. */
export default class MessageCandidateSearch extends WorkerEntrypoint<CloudflareBindings> {
  /** Finds active candidates containing every supplied opaque lexical token. */
  async searchMessages(input: unknown): Promise<SearchMessageCandidatesResult> {
    const request = validateSearchInput(input);
    if (request === null) {
      return { ok: false, code: "invalid_request" };
    }

    try {
      const database = projectionDatabase(this.env, request.workspaceId);
      const checkpoint = await projectionCheckpoint(
        database,
        request,
      ).first<ProjectionCheckpointRow>();
      if (
        checkpoint === null ||
        !Number.isSafeInteger(checkpoint.projected_cursor) ||
        Number(checkpoint.projected_cursor) < 0
      ) {
        return { ok: false, code: "storage_unavailable" };
      }
      const result = await prepareSearch(database, request).all<CandidateRow>();
      if (
        result.success !== true ||
        !Array.isArray(result.results) ||
        result.results.length > request.limit + 1
      ) {
        return { ok: false, code: "storage_unavailable" };
      }
      const candidates: MessageSearchCandidate[] = [];
      for (const row of result.results) {
        const candidate = candidateFromRow(row, request.conversationId);
        if (candidate === null) {
          return { ok: false, code: "storage_unavailable" };
        }
        candidates.push(candidate);
      }
      const bounded = candidates.slice(0, request.limit);
      const last = bounded.at(-1);
      return {
        ok: true,
        indexState:
          Number(checkpoint.projected_cursor) < request.expectedCursor
            ? "lagging"
            : "current",
        candidates: bounded,
        nextCursor:
          result.results.length > request.limit && last !== undefined
            ? [last.createdCursor, last.conversationId, last.messageId]
            : null,
      };
    } catch {
      return { ok: false, code: "storage_unavailable" };
    }
  }

  /** Refuses every HTTP request; callers must use a service binding RPC. */
  override fetch(_request: Request): Response {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
}

function validateSearchInput(
  input: unknown,
): SearchMessageCandidatesInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const record = input as Record<string, unknown>;
  const hasCursor = Object.hasOwn(record, "cursor");
  if (
    !isExactRecord(record, hasCursor ? requestWithCursorKeys : requestKeys) ||
    typeof record.workspaceId !== "string" ||
    !uuidPattern.test(record.workspaceId) ||
    typeof record.conversationId !== "string" ||
    !uuidPattern.test(record.conversationId) ||
    (record.threadRootMessageId !== null &&
      (typeof record.threadRootMessageId !== "string" ||
        !uuidPattern.test(record.threadRootMessageId))) ||
    !Number.isSafeInteger(record.expectedCursor) ||
    (record.expectedCursor as number) < 0 ||
    record.algorithm !== "hmac-sha256-conversation-v2" ||
    !Array.isArray(record.tokens) ||
    record.tokens.length < 1 ||
    record.tokens.length > MAX_TOKENS ||
    !record.tokens.every(
      (token) => typeof token === "string" && tokenPattern.test(token),
    ) ||
    new Set(record.tokens).size !== record.tokens.length ||
    !Number.isSafeInteger(record.limit) ||
    (record.limit as number) < 1 ||
    (record.limit as number) > MAX_LIMIT
  ) {
    return null;
  }
  const validated: Omit<SearchMessageCandidatesInput, "cursor"> = {
    workspaceId: record.workspaceId,
    conversationId: record.conversationId,
    threadRootMessageId: record.threadRootMessageId as string | null,
    expectedCursor: record.expectedCursor as number,
    algorithm: "hmac-sha256-conversation-v2",
    tokens: [...record.tokens].sort(),
    limit: record.limit as number,
  };
  if (!hasCursor) {
    return validated;
  }
  const cursor = validateCursor(record.cursor, validated.conversationId);
  return cursor === null ? null : { ...validated, cursor };
}

function validateCursor(
  value: unknown,
  conversationId: string,
): MessageCandidateCursor | null {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !Number.isSafeInteger(value[0]) ||
    value[0] < 1 ||
    typeof value[1] !== "string" ||
    !uuidPattern.test(value[1]) ||
    value[1] !== conversationId ||
    typeof value[2] !== "string" ||
    !uuidPattern.test(value[2])
  ) {
    return null;
  }
  return [value[0], value[1], value[2]];
}

function prepareSearch(
  database: D1Database,
  request: SearchMessageCandidatesInput,
): D1PreparedStatement {
  const match = request.tokens.map((token) => `"${token}"`).join(" AND ");
  const baseSql = `SELECT projection.message_id,
                          projection.conversation_id,
                          projection.created_cursor,
                          projection.last_cursor
                   FROM message_search
                   JOIN message_projection AS projection
                     ON projection.workspace_id = message_search.workspace_id
                    AND projection.conversation_id = message_search.conversation_id
                    AND projection.message_id = message_search.message_id
                   WHERE message_search MATCH ?
                     AND message_search.workspace_id = ?
                     AND message_search.conversation_id = ?
                     AND message_search.token_algorithm = ?
                     AND projection.workspace_id = ?
                     AND projection.conversation_id = ?
                     AND (? IS NULL OR projection.thread_root_message_id = ?)
                     AND projection.status = 'active'`;
  const orderAndLimit = ` ORDER BY projection.created_cursor DESC,
                                  projection.conversation_id ASC,
                                  projection.message_id ASC
                           LIMIT ?`;
  if (request.cursor === undefined) {
    return database
      .prepare(`${baseSql}${orderAndLimit}`)
      .bind(
        match,
        request.workspaceId,
        request.conversationId,
        request.algorithm,
        request.workspaceId,
        request.conversationId,
        request.threadRootMessageId,
        request.threadRootMessageId,
        request.limit + 1,
      );
  }
  const [createdCursor, conversationId, messageId] = request.cursor;
  const cursorSql = ` AND (
                        projection.created_cursor < ?
                        OR (
                          projection.created_cursor = ?
                          AND projection.conversation_id > ?
                        )
                        OR (
                          projection.created_cursor = ?
                          AND projection.conversation_id = ?
                          AND projection.message_id > ?
                        )
                      )`;
  return database
    .prepare(`${baseSql}${cursorSql}${orderAndLimit}`)
    .bind(
      match,
      request.workspaceId,
      request.conversationId,
      request.algorithm,
      request.workspaceId,
      request.conversationId,
      request.threadRootMessageId,
      request.threadRootMessageId,
      createdCursor,
      createdCursor,
      conversationId,
      createdCursor,
      conversationId,
      messageId,
      request.limit + 1,
    );
}

function projectionCheckpoint(
  database: D1Database,
  request: SearchMessageCandidatesInput,
): D1PreparedStatement {
  return database
    .prepare(
      `SELECT COALESCE(MAX(last_cursor), 0) AS projected_cursor
       FROM message_projection
       WHERE workspace_id = ?
         AND conversation_id = ?
         AND (? IS NULL OR thread_root_message_id = ?)`,
    )
    .bind(
      request.workspaceId,
      request.conversationId,
      request.threadRootMessageId,
      request.threadRootMessageId,
    );
}

function candidateFromRow(
  row: CandidateRow,
  conversationId: string,
): MessageSearchCandidate | null {
  if (
    typeof row.message_id !== "string" ||
    !uuidPattern.test(row.message_id) ||
    typeof row.conversation_id !== "string" ||
    !uuidPattern.test(row.conversation_id) ||
    row.conversation_id !== conversationId ||
    !Number.isSafeInteger(row.created_cursor) ||
    (row.created_cursor as number) < 1 ||
    !Number.isSafeInteger(row.last_cursor) ||
    (row.last_cursor as number) < (row.created_cursor as number)
  ) {
    return null;
  }
  return {
    messageId: row.message_id,
    conversationId: row.conversation_id,
    createdCursor: row.created_cursor as number,
    lastCursor: row.last_cursor as number,
  };
}

function projectionDatabase(
  env: CloudflareBindings,
  workspaceId: string,
): D1Database {
  const shardCount = Number.parseInt(env.D1_SHARD_COUNT, 10);
  const databases = [
    env.PROJECTION_DB_0,
    env.PROJECTION_DB_1,
    env.PROJECTION_DB_2,
    env.PROJECTION_DB_3,
  ] as const;
  if (shardCount !== databases.length) {
    throw new Error("D1 projection shard bindings are inconsistent");
  }
  const database = databases[shardIndex(workspaceId, shardCount)];
  if (database === undefined) {
    throw new Error("D1 projection shard is not bound");
  }
  return database;
}

function shardIndex(workspaceId: string, shardCount: number): number {
  if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 4) {
    throw new RangeError("D1 shard count is invalid");
  }
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(workspaceId)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % shardCount;
}

function isExactRecord(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys[index])
  );
}
