import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  projectMessageEnvelope,
  type ProjectedMessageThreadDelta,
  type ProjectedMessageVersionDelta,
  type ValidatedMessageProjectionEnvelope,
} from "../src/message-projector";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const messageId = "b1eb1b84-f8eb-43ea-9dd4-06cd9da20974";
const authorId = "00000000-0000-8000-8000-000000000002";
const baseTime = Date.parse("2026-08-20T14:00:00.000Z");

interface EnvelopeOptions {
  workspaceId: string;
  cursor: number;
  createdCursor?: number;
  projectedMessageId?: string;
  status?: "active" | "retracted" | "erased";
  currentVersion?: number | null;
  revision?: number;
  replyCount?: number;
  descendantCount?: number;
  lastReplyAt?: string | null;
  searchTokens?: string[];
  eventContent?: string;
  eventKind?: number;
  untrustedPlaintext?: string;
  topicPresent?: boolean;
  versionDelta?: ProjectedMessageVersionDelta;
  threadDeltas?: ProjectedMessageThreadDelta[];
  parentMessageId?: string | null;
  threadRootMessageId?: string;
  threadDepth?: number;
}

function contentVersion(
  workspaceId: string,
  version: number,
  topicPresent = false,
) {
  return {
    version,
    contentCommitment: String(version).repeat(64),
    ciphertextRef: `r2://cipher/${workspaceId}/${version}`,
    contentKeyId: `key-${workspaceId}-${version}`,
    topicPresent,
    createdAt: new Date(baseTime + version * 100).toISOString(),
  };
}

function envelope({
  workspaceId,
  cursor,
  createdCursor = cursor,
  projectedMessageId = messageId,
  status = "active",
  currentVersion = status === "erased" ? null : 1,
  revision = cursor,
  replyCount = 0,
  descendantCount = 0,
  lastReplyAt = null,
  searchTokens = [`h2_DefaultToken_${cursor}`],
  eventContent,
  eventKind,
  untrustedPlaintext,
  topicPresent = false,
  versionDelta,
  threadDeltas = [],
  parentMessageId = null,
  threadRootMessageId = projectedMessageId,
  threadDepth = 0,
}: EnvelopeOptions): ValidatedMessageProjectionEnvelope {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  const retraction =
    status === "retracted"
      ? {
          commandId: "589433da-5c94-45e1-851a-737c9b09c1c1",
          kind: "author" as const,
          requestedAt: timestamp,
          eraseAfter: new Date(
            baseTime + 7 * 24 * 60 * 60 * 1_000,
          ).toISOString(),
        }
      : null;
  const erasureMarker =
    status === "erased"
      ? {
          erasedAt: timestamp,
          retractedAt: new Date(baseTime + 2_000).toISOString(),
          retractionKind: "author" as const,
          destroyedVersionCount: 2,
        }
      : null;

  return {
    schemaVersion: 1,
    workspaceId,
    conversationId,
    messageId: projectedMessageId,
    cursor,
    event: {
      id: `${workspaceId.replaceAll("-", "").slice(0, 32)}${String(cursor).padStart(32, "0")}`,
      kind:
        eventKind ??
        (status === "erased" ? 50204 : status === "retracted" ? 50202 : 50200),
      content: eventContent,
    },
    state: {
      id: projectedMessageId,
      workspaceId,
      conversationId,
      author: { kind: "punk", punkId: authorId },
      messageType: "stream-message",
      status,
      mentionedPunkIds: [],
      mediaIds: [],
      parentMessageId,
      threadRootMessageId,
      threadDepth,
      broadcast: false,
      replyCount,
      descendantCount,
      lastReplyAt,
      topicPresent,
      originalContentCommitment: status === "erased" ? null : "a".repeat(64),
      currentVersion,
      retraction,
      erasureMarker,
      revision,
      createdCursor,
      cursor,
      createdAt: new Date(baseTime).toISOString(),
      updatedAt: timestamp,
      editedAt: cursor > 1 ? timestamp : null,
      untrustedPlaintext,
    },
    versionDelta:
      versionDelta ??
      (status === "erased"
        ? { operation: "erase-all" }
        : status === "retracted"
          ? { operation: "retain" }
          : {
              operation: "upsert",
              version: contentVersion(
                workspaceId,
                currentVersion ?? 1,
                topicPresent,
              ),
            }),
    threadDeltas,
    search: { algorithm: "hmac-sha256-conversation-v2", tokens: searchTokens },
  };
}

function committedThreadDelta(
  targetMessageId: string,
  cursor: number,
  revision: number,
  replyCountDelta: -1 | 1,
  descendantCountDelta: -1 | 1,
) {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  return {
    messageId: targetMessageId,
    replyCountDelta,
    descendantCountDelta,
    lastReplyAt: timestamp,
    revision,
    cursor,
    updatedAt: timestamp,
  };
}

beforeAll(async () => {
  await Promise.all(
    [
      testEnv.PROJECTION_DB_0,
      testEnv.PROJECTION_DB_1,
      testEnv.PROJECTION_DB_2,
      testEnv.PROJECTION_DB_3,
    ].map((database) => applyD1Migrations(database, testEnv.TEST_MIGRATIONS)),
  );
});

describe("Message D1 projector", () => {
  it("is idempotent, fills late version deltas, and replaces tokens only at the winning cursor", async () => {
    const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
    const oldToken = "h2_aB-Cd_Ef0123456789old";
    const latestToken = "h2_Zy-Xw_Vu9876543210latest";
    const first = envelope({
      workspaceId,
      cursor: 1,
      searchTokens: [oldToken],
    });
    const latest = envelope({
      workspaceId,
      cursor: 2,
      createdCursor: 1,
      currentVersion: 2,
      searchTokens: [latestToken],
    });

    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, latest);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, first);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, first);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, latest);

    const projected = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT current_version, revision, created_cursor, last_cursor,
              original_content_commitment
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first<{
        current_version: number;
        revision: number;
        created_cursor: number;
        last_cursor: number;
        original_content_commitment: string;
      }>();
    expect(projected).toEqual({
      current_version: 2,
      revision: 2,
      created_cursor: 1,
      last_cursor: 2,
      original_content_commitment: "a".repeat(64),
    });

    const versions = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT version, content_commitment, ciphertext_ref, content_key_id
       FROM message_version_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
       ORDER BY version`,
    )
      .bind(workspaceId, conversationId, messageId)
      .all();
    expect(versions.results).toEqual([
      {
        version: 1,
        content_commitment: "1".repeat(64),
        ciphertext_ref: `r2://cipher/${workspaceId}/1`,
        content_key_id: `key-${workspaceId}-1`,
      },
      {
        version: 2,
        content_commitment: "2".repeat(64),
        ciphertext_ref: `r2://cipher/${workspaceId}/2`,
        content_key_id: `key-${workspaceId}-2`,
      },
    ]);
    const events = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT COUNT(*) AS count FROM message_event_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first<{ count: number }>();
    expect(events?.count).toBe(2);

    const currentToken = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT message_id FROM message_search
       WHERE message_search MATCH ? AND workspace_id = ?`,
    )
      .bind(`"${latestToken}"`, workspaceId)
      .first<{ message_id: string }>();
    const staleToken = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT message_id FROM message_search
       WHERE message_search MATCH ? AND workspace_id = ?`,
    )
      .bind(`"${oldToken}"`, workspaceId)
      .first<{ message_id: string }>();
    expect(currentToken?.message_id).toBe(messageId);
    expect(staleToken).toBeNull();
    await expect(
      testEnv.PROJECTION_DB_0.prepare(
        `UPDATE message_search_document
         SET token_algorithm = 'hmac-sha256-v1'
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
        .bind(workspaceId, conversationId, messageId)
        .run(),
    ).rejects.toThrow();
    expect(
      await testEnv.PROJECTION_DB_0.prepare(
        `SELECT token_algorithm FROM message_search_document
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
        .bind(workspaceId, conversationId, messageId)
        .first(),
    ).toEqual({ token_algorithm: "hmac-sha256-conversation-v2" });

    const legacyHashColumns = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT name FROM pragma_table_info('message_projection')
       WHERE name LIKE '%_hash'
       UNION ALL
       SELECT name FROM pragma_table_info('message_version_projection')
       WHERE name LIKE '%_hash'`,
    ).all();
    expect(legacyHashColumns.results).toEqual([]);
  });

  it("orders same-time history by immutable createdCursor and exposes the matching index", async () => {
    const workspaceId = "dbb539c1-3cbb-4e29-af42-f5c13b2d76b4";
    const olderMessageId = "66e8c463-5c4f-4dbe-a1dd-a38692f42d57";
    const newerMessageId = "2e8885a3-4642-4ba5-98f6-7fc34c17ce4a";

    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 20,
        createdCursor: 20,
        projectedMessageId: newerMessageId,
      }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 10,
        createdCursor: 10,
        projectedMessageId: olderMessageId,
      }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 30,
        createdCursor: 20,
        projectedMessageId: newerMessageId,
        currentVersion: 2,
      }),
    );

    const history = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT message_id, created_cursor, created_at, last_cursor
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ?
       ORDER BY created_cursor ASC`,
    )
      .bind(workspaceId, conversationId)
      .all();
    expect(history.results).toEqual([
      {
        message_id: olderMessageId,
        created_cursor: 10,
        created_at: new Date(baseTime).toISOString(),
        last_cursor: 10,
      },
      {
        message_id: newerMessageId,
        created_cursor: 20,
        created_at: new Date(baseTime).toISOString(),
        last_cursor: 30,
      },
    ]);

    const historyIndex = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT name FROM pragma_index_info('message_projection_conversation_history')
       ORDER BY seqno`,
    ).all();
    expect(historyIndex.results).toEqual([
      { name: "workspace_id" },
      { name: "conversation_id" },
      { name: "created_cursor" },
      { name: "message_id" },
    ]);
  });

  it("rejects reuse of one Conversation cursor by a different Message", async () => {
    const workspaceId = "c9ad92bf-16eb-4ced-888d-89f34f1c3fb3";
    const conflictingMessageId = "4cdbe9b9-6670-433b-8a3e-b75c238f31ec";

    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({ workspaceId, cursor: 1 }),
    );
    await expect(
      projectMessageEnvelope(
        testEnv.PROJECTION_DB_0,
        envelope({
          workspaceId,
          cursor: 1,
          projectedMessageId: conflictingMessageId,
        }),
      ),
    ).rejects.toThrow();

    const projected = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT message_id FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ?`,
    )
      .bind(workspaceId, conversationId)
      .all();
    expect(projected.results).toEqual([{ message_id: messageId }]);
  });

  it("reconciles duplicate and out-of-order thread deltas without crossing Workspace boundaries", async () => {
    const workspaceA = "1b68b91a-9525-4790-a4d8-76afc282664f";
    const workspaceB = "a7fe9b41-6db2-4b10-b0bd-eaaf63ffb296";
    const firstReplyId = "1af51bb0-ec64-4669-9c79-94b64fa5603f";
    const secondReplyId = "eb1650b2-c960-429f-b5ec-955f1294de47";
    const latestReplyAt = "2026-08-20T15:00:00.000Z";
    const createFirstReply = envelope({
      workspaceId: workspaceA,
      cursor: 2,
      projectedMessageId: firstReplyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 2, 2, 1, 1)],
    });
    const retractFirstReply = envelope({
      workspaceId: workspaceA,
      cursor: 3,
      createdCursor: 2,
      projectedMessageId: firstReplyId,
      status: "retracted",
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 3, 3, -1, -1)],
    });
    const createSecondReply = envelope({
      workspaceId: workspaceA,
      cursor: 4,
      projectedMessageId: secondReplyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 4, 4, 1, 1)],
    });

    // Retraction and creation both arrive before their target root, in reverse.
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, retractFirstReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, createFirstReply);
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({ workspaceId: workspaceA, cursor: 1 }),
    );
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, createSecondReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, createSecondReply);
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId: workspaceB,
        cursor: 1,
        replyCount: 2,
        descendantCount: 3,
      }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId: workspaceA,
        cursor: 5,
        createdCursor: 1,
        replyCount: 1,
        descendantCount: 1,
        lastReplyAt: latestReplyAt,
      }),
    );
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, createFirstReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, retractFirstReply);

    const rows = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT workspace_id, reply_count, descendant_count,
              reply_count_base, descendant_count_base, last_reply_at, last_cursor
       FROM message_projection
       WHERE workspace_id IN (?, ?)
         AND conversation_id = ? AND message_id = ?
       ORDER BY workspace_id`,
    )
      .bind(workspaceA, workspaceB, conversationId, messageId)
      .all();
    expect(rows.results).toEqual([
      {
        workspace_id: workspaceA,
        reply_count: 1,
        descendant_count: 1,
        reply_count_base: 1,
        descendant_count_base: 1,
        last_reply_at: latestReplyAt,
        last_cursor: 5,
      },
      {
        workspace_id: workspaceB,
        reply_count: 2,
        descendant_count: 3,
        reply_count_base: 2,
        descendant_count_base: 3,
        last_reply_at: null,
        last_cursor: 1,
      },
    ]);

    const ledger = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT cursor, reply_count_delta, descendant_count_delta
       FROM message_thread_delta_projection
       WHERE workspace_id = ? AND conversation_id = ?
         AND target_message_id = ?
       ORDER BY cursor`,
    )
      .bind(workspaceA, conversationId, messageId)
      .all();
    expect(ledger.results).toEqual([
      { cursor: 2, reply_count_delta: 1, descendant_count_delta: 1 },
      { cursor: 3, reply_count_delta: -1, descendant_count_delta: -1 },
      { cursor: 4, reply_count_delta: 1, descendant_count_delta: 1 },
    ]);
  });

  it("projects thread metadata idempotently without regressing newer Message snapshots", async () => {
    const workspaceId = "39b68d2e-308c-469f-8c01-569610373f07";
    const firstReplyId = "2b10933c-3afe-4df1-8557-bdb6c2e5a2f3";
    const lateReplyId = "791e1fbe-6c85-4672-90e3-03cdcc90b710";
    const rootCreated = envelope({ workspaceId, cursor: 1, revision: 1 });
    const rootEdited = envelope({
      workspaceId,
      cursor: 2,
      createdCursor: 1,
      currentVersion: 2,
      revision: 2,
    });
    const firstReply = envelope({
      workspaceId,
      cursor: 3,
      revision: 1,
      projectedMessageId: firstReplyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 3, 3, 1, 1)],
    });

    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, rootCreated);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, firstReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, firstReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, rootEdited);

    const derived = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT current_version, reply_count, descendant_count, last_reply_at,
              revision, state_cursor, last_cursor, state_event_id,
              last_event_id, updated_at
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(derived).toEqual({
      current_version: 2,
      reply_count: 1,
      descendant_count: 1,
      last_reply_at: new Date(baseTime + 3_000).toISOString(),
      revision: 3,
      state_cursor: 2,
      last_cursor: 3,
      state_event_id: rootEdited.event.id,
      last_event_id: firstReply.event.id,
      updated_at: new Date(baseTime + 3_000).toISOString(),
    });
    const ledger = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT cursor, target_last_reply_at, target_revision, target_updated_at
       FROM message_thread_delta_projection
       WHERE workspace_id = ? AND conversation_id = ?
         AND target_message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .all();
    expect(ledger.results).toEqual([
      {
        cursor: 3,
        target_last_reply_at: new Date(baseTime + 3_000).toISOString(),
        target_revision: 3,
        target_updated_at: new Date(baseTime + 3_000).toISOString(),
      },
    ]);

    const newerRootSnapshot = envelope({
      workspaceId,
      cursor: 5,
      createdCursor: 1,
      currentVersion: 3,
      revision: 5,
      replyCount: 2,
      descendantCount: 2,
      lastReplyAt: new Date(baseTime + 5_000).toISOString(),
    });
    const lateOlderReply = envelope({
      workspaceId,
      cursor: 4,
      revision: 1,
      projectedMessageId: lateReplyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 4, 4, 1, 1)],
    });
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, newerRootSnapshot);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, lateOlderReply);

    const stable = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT current_version, reply_count, descendant_count, last_reply_at,
              revision, state_cursor, last_cursor, state_event_id,
              last_event_id, updated_at
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(stable).toEqual({
      current_version: 3,
      reply_count: 2,
      descendant_count: 2,
      last_reply_at: new Date(baseTime + 5_000).toISOString(),
      revision: 5,
      state_cursor: 5,
      last_cursor: 5,
      state_event_id: newerRootSnapshot.event.id,
      last_event_id: newerRootSnapshot.event.id,
      updated_at: new Date(baseTime + 5_000).toISOString(),
    });
  });

  it("advances thread metadata on an erased root without reviving its content", async () => {
    const workspaceId = "8cd61c3e-12a3-45bb-8f6d-82c16cc59154";
    const replyId = "acb13a7e-8a9a-4e94-8997-078b36aedeca";
    const erasedRoot = envelope({
      workspaceId,
      cursor: 2,
      createdCursor: 1,
      status: "erased",
      revision: 2,
    });
    const reply = envelope({
      workspaceId,
      cursor: 3,
      projectedMessageId: replyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 3, 3, 1, 1)],
    });

    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({ workspaceId, cursor: 1 }),
    );
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, erasedRoot);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, reply);

    const root = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT status, current_version, reply_count, descendant_count,
              last_reply_at, revision, state_cursor, last_cursor, updated_at
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(root).toEqual({
      status: "erased",
      current_version: null,
      reply_count: 1,
      descendant_count: 1,
      last_reply_at: new Date(baseTime + 3_000).toISOString(),
      revision: 3,
      state_cursor: 2,
      last_cursor: 3,
      updated_at: new Date(baseTime + 3_000).toISOString(),
    });

    const terminalRows = await testEnv.PROJECTION_DB_0.batch([
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT status, last_cursor FROM message_tombstone_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      ).bind(workspaceId, conversationId, messageId),
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT COUNT(*) AS count FROM message_version_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      ).bind(workspaceId, conversationId, messageId),
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT COUNT(*) AS count FROM message_search_document
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      ).bind(workspaceId, conversationId, messageId),
    ]);
    expect(terminalRows.map(({ results }) => results)).toEqual([
      [{ status: "erased", last_cursor: 2 }],
      [{ count: 0 }],
      [{ count: 0 }],
    ]);
  });

  it("blocks late state, version, and search upserts after an erased root advances", async () => {
    const workspaceId = "15b99d20-b0c6-4b92-887e-4bff44f5414b";
    const replyId = "c0e2c490-a102-45a2-ab5f-d86f2cbe1a67";
    const forbiddenToken = "h2_Zy-Xw_Vu9876543210forbidden";

    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({ workspaceId, cursor: 1 }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 2,
        createdCursor: 1,
        status: "erased",
        revision: 2,
      }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 3,
        projectedMessageId: replyId,
        parentMessageId: messageId,
        threadRootMessageId: messageId,
        threadDepth: 1,
        threadDeltas: [committedThreadDelta(messageId, 3, 3, 1, 1)],
      }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 4,
        createdCursor: 1,
        currentVersion: 2,
        revision: 4,
        eventKind: 50201,
        topicPresent: true,
        searchTokens: [forbiddenToken],
      }),
    );

    const root = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT status, current_version, topic_present, reply_count,
              descendant_count, revision, state_cursor, last_cursor
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(root).toEqual({
      status: "erased",
      current_version: null,
      topic_present: 0,
      reply_count: 1,
      descendant_count: 1,
      revision: 3,
      state_cursor: 2,
      last_cursor: 3,
    });

    const terminalRows = await testEnv.PROJECTION_DB_0.batch([
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT status, last_cursor FROM message_tombstone_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      ).bind(workspaceId, conversationId, messageId),
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT COUNT(*) AS count FROM message_version_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      ).bind(workspaceId, conversationId, messageId),
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT COUNT(*) AS count FROM message_search_document
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      ).bind(workspaceId, conversationId, messageId),
    ]);
    expect(terminalRows.map(({ results }) => results)).toEqual([
      [{ status: "erased", last_cursor: 2 }],
      [{ count: 0 }],
      [{ count: 0 }],
    ]);
    expect(
      await testEnv.PROJECTION_DB_0.prepare(
        `SELECT message_id FROM message_search
         WHERE message_search MATCH ? AND workspace_id = ?`,
      )
        .bind(`"${forbiddenToken}"`, workspaceId)
        .first(),
    ).toBeNull();
  });

  it("applies erased-root thread deltas idempotently and in cursor order", async () => {
    const workspaceId = "1b5a1e47-c194-40ed-88a5-5413af3be9d7";
    const olderReplyId = "95b29033-5742-4975-bad4-e13ab08c409c";
    const newerReplyId = "a8f646dc-051d-4c60-b9eb-837b37104d5c";
    const olderReply = envelope({
      workspaceId,
      cursor: 3,
      projectedMessageId: olderReplyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 3, 3, 1, 1)],
    });
    const newerReply = envelope({
      workspaceId,
      cursor: 4,
      projectedMessageId: newerReplyId,
      parentMessageId: messageId,
      threadRootMessageId: messageId,
      threadDepth: 1,
      threadDeltas: [committedThreadDelta(messageId, 4, 4, 1, 1)],
    });

    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({ workspaceId, cursor: 1 }),
    );
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      envelope({
        workspaceId,
        cursor: 2,
        createdCursor: 1,
        status: "erased",
        revision: 2,
      }),
    );
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, newerReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, newerReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, olderReply);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, olderReply);

    const root = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT status, current_version, reply_count, descendant_count,
              last_reply_at, revision, state_cursor, last_cursor,
              last_event_id, updated_at
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(root).toEqual({
      status: "erased",
      current_version: null,
      reply_count: 2,
      descendant_count: 2,
      last_reply_at: new Date(baseTime + 4_000).toISOString(),
      revision: 4,
      state_cursor: 2,
      last_cursor: 4,
      last_event_id: newerReply.event.id,
      updated_at: new Date(baseTime + 4_000).toISOString(),
    });
    const ledger = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT cursor, target_revision FROM message_thread_delta_projection
       WHERE workspace_id = ? AND conversation_id = ?
         AND target_message_id = ?
       ORDER BY cursor`,
    )
      .bind(workspaceId, conversationId, messageId)
      .all();
    expect(ledger.results).toEqual([
      { cursor: 3, target_revision: 3 },
      { cursor: 4, target_revision: 4 },
    ]);
  });

  it("suppresses search on retraction, restores supplied tokens, and erases every content reference", async () => {
    const workspaceId = "dd5b2867-7a50-4575-a12e-441efd0d9701";
    const plaintext = "PLAINTEXT_MUST_NEVER_REACH_D1";
    const active = envelope({
      workspaceId,
      cursor: 1,
      currentVersion: 1,
      searchTokens: ["h2_aB-Cd_Ef0123456789active"],
      eventContent: plaintext,
      untrustedPlaintext: plaintext,
      topicPresent: true,
    });
    const edited = envelope({
      workspaceId,
      cursor: 2,
      createdCursor: 1,
      currentVersion: 2,
      searchTokens: ["h2_aB-Cd_Ef0123456789edited"],
    });
    const retracted = envelope({
      workspaceId,
      cursor: 3,
      createdCursor: 1,
      status: "retracted",
      currentVersion: 2,
      searchTokens: ["h2_aB-Cd_Ef0123456789ignored"],
    });
    const restored = envelope({
      workspaceId,
      cursor: 4,
      createdCursor: 1,
      currentVersion: 2,
      searchTokens: ["h2_Zy-Xw_Vu9876543210restored"],
      versionDelta: { operation: "retain" },
    });
    const erased = envelope({
      workspaceId,
      cursor: 5,
      createdCursor: 1,
      status: "erased",
      searchTokens: ["h2_Zy-Xw_Vu9876543210ignored"],
    });
    const forbiddenResurrection = envelope({
      workspaceId,
      cursor: 6,
      createdCursor: 1,
      currentVersion: 3,
      searchTokens: ["h2_Zy-Xw_Vu9876543210forbidden"],
    });

    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, active);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, edited);

    const activeRows = await testEnv.PROJECTION_DB_0.batch([
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_event_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_version_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_search_document WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_tombstone_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_thread_delta_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
    ]);
    expect(
      JSON.stringify(activeRows.map((result) => result.results)),
    ).not.toContain(plaintext);

    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, retracted);
    expect(
      await testEnv.PROJECTION_DB_0.prepare(
        `SELECT message_id FROM message_search
         WHERE message_search MATCH ? AND workspace_id = ?`,
      )
        .bind('"h2_aB-Cd_Ef0123456789active"', workspaceId)
        .first(),
    ).toBeNull();

    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, restored);
    expect(
      await testEnv.PROJECTION_DB_0.prepare(
        `SELECT message_id FROM message_search
         WHERE message_search MATCH ? AND workspace_id = ?`,
      )
        .bind('"h2_Zy-Xw_Vu9876543210restored"', workspaceId)
        .first<{ message_id: string }>(),
    ).toEqual({ message_id: messageId });

    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, erased);
    await projectMessageEnvelope(testEnv.PROJECTION_DB_0, restored);
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      forbiddenResurrection,
    );

    const message = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT status, current_version, last_cursor
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(message).toEqual({
      status: "erased",
      current_version: null,
      last_cursor: 5,
    });
    const versions = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT COUNT(*) AS count FROM message_version_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first<{ count: number }>();
    expect(versions?.count).toBe(0);
    const searchable = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT COUNT(*) AS count FROM message_search_document
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first<{ count: number }>();
    expect(searchable?.count).toBe(0);
    const tombstone = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT status, retraction_kind, retracted_at, erased_at,
              destroyed_version_count, last_cursor
       FROM message_tombstone_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(workspaceId, conversationId, messageId)
      .first();
    expect(tombstone).toEqual({
      status: "erased",
      retraction_kind: "author",
      retracted_at: "2026-08-20T14:00:02.000Z",
      erased_at: "2026-08-20T14:00:05.000Z",
      destroyed_version_count: 2,
      last_cursor: 5,
    });

    const storedRows = await testEnv.PROJECTION_DB_0.batch([
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_event_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_version_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_search_document WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_tombstone_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
      testEnv.PROJECTION_DB_0.prepare(
        "SELECT * FROM message_thread_delta_projection WHERE workspace_id = ?",
      ).bind(workspaceId),
    ]);
    const storedText = JSON.stringify(
      storedRows.map((result) => result.results),
    );
    expect(storedText).not.toContain(plaintext);
    expect(storedText).not.toContain("r2://cipher/");
    expect(storedText).not.toContain(`key-${workspaceId}`);

    const forbiddenTombstoneColumns = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT name FROM pragma_table_info('message_tombstone_projection')
       WHERE lower(name) LIKE '%cipher%'
          OR lower(name) LIKE '%key%'
          OR lower(name) LIKE '%token%'`,
    ).all();
    expect(forbiddenTombstoneColumns.results).toEqual([]);
  });
});
