import { applyD1Migrations, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

interface Candidate {
  messageId: string;
  conversationId: string;
  createdCursor: number;
  lastCursor: number;
}

interface SearchSuccess {
  ok: true;
  indexState: "current" | "lagging";
  candidates: Candidate[];
  nextCursor: [number, string, string] | null;
}

const testEnv = env as TestEnv;
const databases = [
  testEnv.PROJECTION_DB_0,
  testEnv.PROJECTION_DB_1,
  testEnv.PROJECTION_DB_2,
  testEnv.PROJECTION_DB_3,
] as const;
const workspaceByShard = [
  "00000000-0000-8000-8000-000000000201",
  "00000000-0000-8000-8000-000000000101",
  "8cd61c3e-12a3-45bb-8f6d-82c16cc59154",
  "15b99d20-b0c6-4b92-887e-4bff44f5414b",
] as const;
const conversationId = "00000000-0000-8000-8000-000000000301";
const secondConversationId = "00000000-0000-8000-8000-000000000302";
const tokenA = `h2_${"A".repeat(43)}`;
const tokenB = `h2_${"B".repeat(43)}`;
const tokenC = `h2_${"C".repeat(43)}`;
const tokenD = `h2_${"D".repeat(43)}`;
const base64UrlToken = `h2_${"-_".repeat(21)}-`;

function messageId(shard: number, suffix: number): string {
  return `00000000-0000-8000-8${String(shard).padStart(3, "0")}-${String(suffix).padStart(12, "0")}`;
}

async function seedMessage(
  database: D1Database,
  options: {
    workspaceId: string;
    conversationId?: string;
    messageId: string;
    tokens: string[];
    status?: "active" | "retracted" | "erased";
    createdCursor?: number;
    lastCursor?: number;
    threadRootMessageId?: string;
  },
): Promise<void> {
  const status = options.status ?? "active";
  const selectedConversationId = options.conversationId ?? conversationId;
  const createdCursor = options.createdCursor ?? 1;
  const lastCursor = options.lastCursor ?? createdCursor;
  const timestamp = new Date(
    Date.parse("2026-08-20T12:00:00.000Z") + createdCursor * 1_000,
  ).toISOString();
  await database.batch([
    database
      .prepare(
        `INSERT INTO message_projection
          (workspace_id, conversation_id, message_id, actor_kind, actor_id,
           message_type, status, mentioned_punk_ids_json, media_ids_json,
           parent_message_id, thread_root_message_id, thread_depth, broadcast,
           reply_count, descendant_count, reply_count_base,
           descendant_count_base, last_reply_at, topic_present,
           original_content_commitment, current_version, revision,
           created_cursor, state_cursor, last_cursor, state_event_id,
           last_event_id, created_at, updated_at, edited_at)
         VALUES (?, ?, ?, 'punk', ?, 'stream-message', ?, '[]', '[]', NULL,
                 ?, 0, 0, 0, 0, 0, 0, NULL, 0, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .bind(
        options.workspaceId,
        selectedConversationId,
        options.messageId,
        "00000000-0000-8000-8000-000000000999",
        status,
        options.threadRootMessageId ?? options.messageId,
        status === "erased" ? null : "a".repeat(64),
        status === "erased" ? null : 1,
        createdCursor,
        lastCursor,
        lastCursor,
        `state-${options.messageId}`,
        `event-${options.messageId}`,
        timestamp,
        timestamp,
      ),
    database
      .prepare(
        `INSERT INTO message_search_document
          (workspace_id, conversation_id, message_id, token_algorithm,
           opaque_tokens, last_cursor, last_event_id)
         VALUES (?, ?, ?, 'hmac-sha256-conversation-v2', ?, ?, ?)`,
      )
      .bind(
        options.workspaceId,
        selectedConversationId,
        options.messageId,
        options.tokens.join(" "),
        lastCursor,
        `search-${options.messageId}`,
      ),
  ]);
}

async function search(input: unknown): Promise<SearchSuccess> {
  const record = input as Record<string, unknown>;
  const result = await exports.default.searchMessages({
    threadRootMessageId: null,
    expectedCursor: 0,
    ...record,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Search failed: ${result.code}`);
  }
  return result as SearchSuccess;
}

beforeAll(async () => {
  await Promise.all(
    databases.map((database) =>
      applyD1Migrations(database, testEnv.TEST_MIGRATIONS),
    ),
  );

  for (const [shard, workspaceId] of workspaceByShard.entries()) {
    const database = databases[shard];
    if (database === undefined) {
      throw new Error(`Missing test shard ${shard}`);
    }
    await seedMessage(database, {
      workspaceId,
      messageId: messageId(shard, 1),
      tokens: [tokenA, tokenB],
      createdCursor: shard + 1,
    });
  }
  await seedMessage(databases[1], {
    workspaceId: workspaceByShard[0],
    messageId: messageId(1, 99),
    tokens: [tokenA, tokenB],
  });

  const lexicalWorkspace = workspaceByShard[2];
  await seedMessage(databases[2], {
    workspaceId: lexicalWorkspace,
    messageId: messageId(2, 2),
    tokens: [tokenA],
  });
  await seedMessage(databases[2], {
    workspaceId: lexicalWorkspace,
    messageId: messageId(2, 3),
    tokens: [tokenA, tokenB],
    status: "retracted",
  });
  await seedMessage(databases[2], {
    workspaceId: lexicalWorkspace,
    messageId: messageId(2, 4),
    tokens: [tokenA, tokenB],
    status: "erased",
  });

  const paginationWorkspace = workspaceByShard[3];
  for (let index = 10; index < 15; index += 1) {
    await seedMessage(databases[3], {
      workspaceId: paginationWorkspace,
      messageId: messageId(3, index),
      tokens: [tokenC],
      createdCursor: index,
      lastCursor: index + 20,
    });
  }
});

describe("private Message candidate search RPC", () => {
  it("confines candidates to one Fil and reports its projection lag", async () => {
    const workspaceId = workspaceByShard[2];
    const firstRoot = messageId(2, 5_000);
    const secondRoot = messageId(2, 5_001);
    const firstReply = messageId(2, 5_002);
    const secondReply = messageId(2, 5_003);
    await seedMessage(databases[2], {
      workspaceId,
      messageId: firstReply,
      threadRootMessageId: firstRoot,
      tokens: [tokenD],
      createdCursor: 200,
      lastCursor: 210,
    });
    await seedMessage(databases[2], {
      workspaceId,
      messageId: secondReply,
      threadRootMessageId: secondRoot,
      tokens: [tokenD],
      createdCursor: 201,
      lastCursor: 211,
    });

    const current = await exports.default.searchMessages({
      workspaceId,
      conversationId,
      threadRootMessageId: firstRoot,
      expectedCursor: 210,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenD],
      limit: 10,
    });
    expect(current).toMatchObject({
      ok: true,
      indexState: "current",
      candidates: [{ messageId: firstReply }],
    });

    const lagging = await exports.default.searchMessages({
      workspaceId,
      conversationId,
      threadRootMessageId: firstRoot,
      expectedCursor: 211,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenD],
      limit: 10,
    });
    expect(lagging).toMatchObject({ ok: true, indexState: "lagging" });
  });

  it("requires an explicit Conversation scope", async () => {
    await expect(
      exports.default.searchMessages({
        workspaceId: workspaceByShard[0],
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [tokenA],
        limit: 1,
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  });

  it("quotes opaque base64url tokens containing hyphen and underscore", async () => {
    const projectedMessageId = messageId(0, 50);
    expect(base64UrlToken.slice(3)).toHaveLength(43);
    expect(base64UrlToken).toContain("-");
    expect(base64UrlToken).toContain("_");
    await seedMessage(databases[0], {
      workspaceId: workspaceByShard[0],
      messageId: projectedMessageId,
      tokens: [tokenA, base64UrlToken],
      createdCursor: 50,
    });

    const result = await search({
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [base64UrlToken, tokenA],
      limit: 10,
    });
    expect(result.candidates.map(({ messageId: id }) => id)).toEqual([
      projectedMessageId,
    ]);
  });

  it("uses the projector FNV-1a Workspace shard mapping and never scans another shard", async () => {
    for (const [shard, workspaceId] of workspaceByShard.entries()) {
      const result = await search({
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [tokenA, tokenB],
        limit: 100,
      });
      expect(result.candidates.map(({ messageId: id }) => id)).toContain(
        messageId(shard, 1),
      );
      expect(result.candidates.map(({ messageId: id }) => id)).not.toContain(
        messageId(1, 99),
      );
    }
  });

  it("requires every lexical token and excludes retracted and erased Messages", async () => {
    const result = await search({
      workspaceId: workspaceByShard[2],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA, tokenB],
      limit: 100,
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      messageId: messageId(2, 1),
      conversationId,
      createdCursor: 3,
      lastCursor: 3,
    });
    expect(Object.keys(result.candidates[0] ?? {}).sort()).toEqual([
      "conversationId",
      "createdCursor",
      "lastCursor",
      "messageId",
    ]);
  });

  it("paginates a stable keyset without duplicates or omissions", async () => {
    const workspaceId = workspaceByShard[3];
    const collected: Candidate[] = [];
    let cursor: SearchSuccess["nextCursor"] = null;
    do {
      const result = await search({
        workspaceId,
        conversationId,
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [tokenC],
        limit: 2,
        ...(cursor === null ? {} : { cursor }),
      });
      collected.push(...result.candidates);
      cursor = result.nextCursor;
    } while (cursor !== null);

    expect(collected).toHaveLength(5);
    expect(new Set(collected.map(({ messageId: id }) => id)).size).toBe(5);
    expect(collected.map(({ createdCursor }) => createdCursor)).toEqual([
      14, 13, 12, 11, 10,
    ]);
  });

  it("keeps Workspace pagination stable when another Workspace changes the shared FTS shard", async () => {
    const workspaceId = workspaceByShard[3];
    const interferingWorkspaceId = "00000000-0000-8000-8000-000000000402";
    const first = await search({
      workspaceId,
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenC],
      limit: 2,
    });
    expect(first.candidates.map(({ createdCursor }) => createdCursor)).toEqual([
      14, 13,
    ]);
    expect(first.nextCursor).not.toBeNull();

    for (let index = 0; index < 64; index += 1) {
      await seedMessage(databases[3], {
        workspaceId: interferingWorkspaceId,
        messageId: messageId(3, 1_000 + index),
        tokens: [tokenC],
        createdCursor: 1_000 + index,
      });
    }
    const interfering = await search({
      workspaceId: interferingWorkspaceId,
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenC],
      limit: 1,
    });
    expect(interfering.candidates).toHaveLength(1);

    const second = await search({
      workspaceId,
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenC],
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.candidates.map(({ createdCursor }) => createdCursor)).toEqual(
      [12, 11],
    );
    expect(
      second.candidates.some(({ messageId: id }) =>
        first.candidates.some(({ messageId: firstId }) => firstId === id),
      ),
    ).toBe(false);
  });

  it("keeps results and continuation independent from other Conversations in the Workspace", async () => {
    const workspaceId = workspaceByShard[3];
    for (let index = 1; index <= 3; index += 1) {
      await seedMessage(databases[3], {
        workspaceId,
        conversationId,
        messageId: messageId(3, 2_000 + index),
        tokens: [tokenD],
        createdCursor: index,
      });
    }
    const input = {
      workspaceId,
      conversationId,
      algorithm: "hmac-sha256-conversation-v2" as const,
      tokens: [tokenD],
      limit: 2,
    };
    const before = await search(input);

    for (let index = 0; index < 64; index += 1) {
      await seedMessage(databases[3], {
        workspaceId,
        conversationId: secondConversationId,
        messageId: messageId(3, 3_000 + index),
        tokens: [tokenD],
        createdCursor: 1_000 + index,
      });
    }
    const after = await search(input);

    expect(after).toEqual(before);
    expect(after.candidates).toHaveLength(2);
    expect(
      after.candidates.every(
        (candidate) => candidate.conversationId === conversationId,
      ),
    ).toBe(true);
    expect(after.nextCursor?.[1]).toBe(conversationId);
  });

  it("rejects a candidate cursor from another Conversation", async () => {
    await expect(
      exports.default.searchMessages({
        workspaceId: workspaceByShard[3],
        conversationId,
        threadRootMessageId: null,
        expectedCursor: 0,
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [tokenD],
        limit: 2,
        cursor: [2, secondConversationId, messageId(3, 2_002)],
      }),
    ).resolves.toEqual({ ok: false, code: "invalid_request" });
  });

  it.each([
    null,
    {},
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
      unexpected: true,
    },
    {
      workspaceId: workspaceByShard[2].toUpperCase(),
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId: "E3a92f8d-f013-46b7-9370-5ca1c79b6280",
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "sha256",
      tokens: [tokenA],
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [],
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: Array.from(
        { length: 33 },
        (_, index) => `h2_${String(index).padStart(43, "A")}`,
      ),
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA, tokenA],
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: ["plaintext"],
      limit: 1,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 0,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 101,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1.5,
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
      cursor: [1, conversationId],
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
      cursor: [Number.NaN, conversationId, messageId(0, 1)],
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
      cursor: [0, conversationId, messageId(0, 1)],
    },
    {
      workspaceId: workspaceByShard[0],
      conversationId,
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [tokenA],
      limit: 1,
      cursor: [0, 1, conversationId, messageId(0, 1)],
    },
  ])("rejects malformed or oversized RPC input %#", async (input) => {
    await expect(exports.default.searchMessages(input)).resolves.toEqual({
      ok: false,
      code: "invalid_request",
    });
  });

  it.each([
    ["GET", "/"],
    ["POST", "/api/v1/search"],
  ])("returns 404 for HTTP %s %s", async (method, path) => {
    const response = await exports.default.fetch(
      new Request(`https://search.punks.test${path}`, { method }),
    );
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });

  it("fails closed when the selected D1 shard cannot execute the search", async () => {
    await testEnv.PROJECTION_DB_0.prepare("DROP TABLE message_search").run();

    await expect(
      exports.default.searchMessages({
        workspaceId: workspaceByShard[0],
        conversationId,
        threadRootMessageId: null,
        expectedCursor: 0,
        algorithm: "hmac-sha256-conversation-v2",
        tokens: [tokenA],
        limit: 10,
      }),
    ).resolves.toEqual({ ok: false, code: "storage_unavailable" });
  });
});
