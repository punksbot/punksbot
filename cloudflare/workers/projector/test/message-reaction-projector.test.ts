import type { MessageReactionProjectionEnvelope } from "@punks/contracts";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import {
  isConsistentMessageReactionProjection,
  projectMessageReactionEnvelope,
} from "../src/message-reaction-projector";
import {
  projectMessageEnvelope,
  type ValidatedMessageProjectionEnvelope,
} from "../src/message-projector";
import { projectionDatabase } from "../src/shards";
import {
  cryptographicMutations,
  signProjectionEnvelope,
} from "./attestation-fixture";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const baseTime = Date.parse("2026-08-21T12:00:00.000Z");
const punkId = "00000000-0000-8000-8000-000000000201";
const botId = "00000000-0000-8000-8000-000000000202";

type ReactionActor =
  | { kind: "punk"; punkId: string }
  | { kind: "bot"; installationId: string };

interface ReactionEnvelopeOptions {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  reactionId: string;
  cursor: number;
  active?: boolean;
  actor?: ReactionActor;
  reaction?: string;
  contract?:
    | "message.reaction-add@1"
    | "message.reaction-remove@1"
    | "message.reaction-toggle@1";
  kind?: 50210 | 50211;
}

function actorId(actor: ReactionActor): string {
  return actor.kind === "punk" ? actor.punkId : actor.installationId;
}

function authorityTags(actor: ReactionActor): [string, ...string[]][] {
  return actor.kind === "punk"
    ? [["workspace_cursor", "1"]]
    : [
        ["installation_cursor", "17"],
        ["admission", "00000000-0000-8000-8000-000000000204"],
        ["action", "00000000-0000-8000-8000-000000000205", "ab".repeat(32)],
      ];
}

function reactionEnvelope({
  workspaceId,
  conversationId,
  messageId,
  reactionId,
  cursor,
  active = true,
  actor = { kind: "punk", punkId },
  reaction = "🔥",
  contract = active ? "message.reaction-add@1" : "message.reaction-remove@1",
  kind = active ? 50210 : 50211,
}: ReactionEnvelopeOptions): MessageReactionProjectionEnvelope {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  const state = {
    id: reactionId,
    workspaceId,
    conversationId,
    messageId,
    actor,
    reaction,
    status: active ? ("active" as const) : ("removed" as const),
    revision: cursor,
    createdCursor: 1,
    cursor,
    createdAt: new Date(baseTime).toISOString(),
    reactedAt: active ? timestamp : null,
    updatedAt: timestamp,
    removedAt: active ? null : timestamp,
  };
  const delta: MessageReactionProjectionEnvelope["delta"] = active
    ? {
        operation: "upsert",
        reaction: {
          id: reactionId,
          messageId,
          actor,
          reaction,
          reactedAt: timestamp,
        },
      }
    : {
        operation: "remove",
        reactionId,
        messageId,
        actor,
        reaction,
      };
  return {
    contract: "message-reaction.projection@1",
    workspaceId,
    conversationId,
    messageId,
    cursor,
    event: {
      id: `${reactionId.replaceAll("-", "").slice(0, 32)}${String(cursor).padStart(32, "0")}`,
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind,
      tags: [
        ["workspace", workspaceId],
        ["conversation", conversationId],
        ["message", messageId],
        ["reaction_entity", reactionId],
        ["cursor", String(cursor)],
        ...authorityTags(actor),
        ["conversation_cursor", String(cursor)],
        ["command", "00000000-0000-8000-8000-000000000203"],
        ["contract", contract],
        ["actor", actor.kind, actorId(actor)],
        ["attestation", "local-v1"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        reaction: state,
        projectionDelta: delta,
      }),
      sig: "0".repeat(128),
    },
    delta,
  };
}

function messageLifecycleEnvelope(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  cursor: number,
  status: "active" | "retracted" | "erased",
): ValidatedMessageProjectionEnvelope {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  const initial = cursor === 1;
  const versionDelta = initial
    ? {
        operation: "upsert" as const,
        version: {
          version: 1,
          contentCommitment: "a".repeat(64),
          ciphertextRef: `messages/${workspaceId}/${messageId}/1.enc`,
          contentKeyId: `key-${messageId}`,
          topicPresent: false,
          createdAt: timestamp,
        },
      }
    : status === "erased"
      ? ({ operation: "erase-all" } as const)
      : ({ operation: "retain" } as const);
  return {
    schemaVersion: 1,
    workspaceId,
    conversationId,
    messageId,
    cursor,
    event: {
      id: `${messageId.replaceAll("-", "").slice(0, 32)}${String(cursor).padStart(32, "0")}`,
      kind:
        status === "erased"
          ? 50204
          : status === "retracted"
            ? 50202
            : initial
              ? 50200
              : 50203,
    },
    state: {
      id: messageId,
      workspaceId,
      conversationId,
      author: { kind: "punk", punkId },
      messageType: "stream-message",
      status,
      mentionedPunkIds: [],
      mediaIds: [],
      parentMessageId: null,
      threadRootMessageId: messageId,
      threadDepth: 0,
      broadcast: false,
      replyCount: 0,
      descendantCount: 0,
      lastReplyAt: null,
      topicPresent: false,
      originalContentCommitment: status === "erased" ? null : "a".repeat(64),
      currentVersion: status === "erased" ? null : 1,
      retraction:
        status === "retracted"
          ? {
              kind: "author",
              requestedAt: timestamp,
              eraseAfter: new Date(baseTime + 604_800_000).toISOString(),
            }
          : null,
      erasureMarker:
        status === "erased"
          ? {
              erasedAt: timestamp,
              retractedAt: new Date(baseTime + 2_000).toISOString(),
              retractionKind: "author",
              destroyedVersionCount: 1,
            }
          : null,
      revision: cursor,
      createdCursor: 1,
      cursor,
      createdAt: new Date(baseTime).toISOString(),
      updatedAt: timestamp,
      editedAt: null,
    },
    versionDelta,
    threadDeltas: [],
    search: { algorithm: "hmac-sha256-conversation-v2", tokens: [] },
  };
}

async function consume(
  messages: MessageReactionProjectionEnvelope[],
  alreadySigned = false,
) {
  const bodies = alreadySigned
    ? messages
    : await Promise.all(messages.map(signProjectionEnvelope));
  const batch = createMessageBatch(
    "punks-projection-local",
    bodies.map((body, index) => ({
      id: `reaction-${index}-${body.cursor}`,
      timestamp: new Date(),
      body,
      attempts: 1,
    })),
  );
  const context = createExecutionContext();
  await worker.queue?.(batch, testEnv, context);
  return getQueueResult(batch, context);
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

describe("Message Reaction D1 projector", () => {
  it("binds the signed event to scope, cursor, entity, actor, contract, kind, and delta", () => {
    const envelope = reactionEnvelope({
      workspaceId: "00000000-0000-8000-8000-000000000210",
      conversationId: "00000000-0000-8000-8000-000000000211",
      messageId: "00000000-0000-8000-8000-000000000212",
      reactionId: "00000000-0000-8000-8000-000000000213",
      cursor: 7,
      contract: "message.reaction-toggle@1",
    });
    expect(isConsistentMessageReactionProjection(envelope)).toBe(true);
    expect(
      isConsistentMessageReactionProjection(
        reactionEnvelope({
          workspaceId: envelope.workspaceId,
          conversationId: envelope.conversationId,
          messageId: envelope.messageId,
          reactionId: "00000000-0000-8000-8000-000000000213",
          cursor: 8,
          active: false,
          contract: "message.reaction-toggle@1",
        }),
      ),
    ).toBe(true);

    const signedContent = JSON.parse(envelope.event.content) as object;

    for (const tampered of [
      { ...envelope, workspaceId: "00000000-0000-8000-8000-000000000219" },
      {
        ...envelope,
        conversationId: "00000000-0000-8000-8000-000000000218",
      },
      { ...envelope, messageId: "00000000-0000-8000-8000-000000000217" },
      { ...envelope, cursor: 8 },
      { ...envelope, event: { ...envelope.event, kind: 50211 } },
      {
        ...envelope,
        event: {
          ...envelope.event,
          tags: envelope.event.tags.map((tag) =>
            tag[0] === "reaction_entity"
              ? ["reaction_entity", "00000000-0000-8000-8000-000000000216"]
              : tag,
          ),
        },
      },
      {
        ...envelope,
        event: {
          ...envelope.event,
          tags: envelope.event.tags.map((tag) =>
            tag[0] === "actor"
              ? ["actor", "punk", "00000000-0000-8000-8000-000000000215"]
              : tag,
          ),
        },
      },
      {
        ...envelope,
        event: {
          ...envelope.event,
          tags: envelope.event.tags.map((tag) =>
            tag[0] === "contract"
              ? ["contract", "message.reaction-remove@1"]
              : tag,
          ),
        },
      },
      {
        ...envelope,
        delta:
          envelope.delta.operation === "upsert"
            ? {
                ...envelope.delta,
                reaction: { ...envelope.delta.reaction, reaction: "👍" },
              }
            : envelope.delta,
      },
      {
        ...envelope,
        event: {
          ...envelope.event,
          content: JSON.stringify({ ...signedContent, plaintext: "secret" }),
        },
      },
    ]) {
      expect(
        isConsistentMessageReactionProjection(
          tampered as MessageReactionProjectionEnvelope,
        ),
      ).toBe(false);
    }
  });

  it("binds each Reaction actor to its own authority cursor namespace", () => {
    const botEnvelope = reactionEnvelope({
      workspaceId: "00000000-0000-8000-8000-000000000240",
      conversationId: "00000000-0000-8000-8000-000000000241",
      messageId: "00000000-0000-8000-8000-000000000242",
      reactionId: "00000000-0000-8000-8000-000000000243",
      cursor: 4,
      actor: { kind: "bot", installationId: botId },
    });
    expect(isConsistentMessageReactionProjection(botEnvelope)).toBe(true);

    const mislabeled = {
      ...botEnvelope,
      event: {
        ...botEnvelope.event,
        tags: [
          ...botEnvelope.event.tags.slice(0, 5),
          ["workspace_cursor", "17"],
          ...botEnvelope.event.tags.slice(8),
        ],
      },
    };
    expect(
      isConsistentMessageReactionProjection(
        mislabeled as MessageReactionProjectionEnvelope,
      ),
    ).toBe(false);
  });

  it("keeps one identity per coordinate across duplicates and out-of-order delivery", async () => {
    const scope = {
      workspaceId: "00000000-0000-8000-8000-000000000220",
      conversationId: "00000000-0000-8000-8000-000000000221",
      messageId: "00000000-0000-8000-8000-000000000222",
      reactionId: "00000000-0000-8000-8000-000000000223",
    };
    const added = reactionEnvelope({ ...scope, cursor: 10 });
    const otherAdded = reactionEnvelope({
      ...scope,
      reactionId: "00000000-0000-8000-8000-000000000226",
      cursor: 11,
      actor: { kind: "bot", installationId: botId },
    });
    const removed = reactionEnvelope({ ...scope, cursor: 12, active: false });

    await projectMessageReactionEnvelope(testEnv.PROJECTION_DB_0, otherAdded);
    await projectMessageReactionEnvelope(testEnv.PROJECTION_DB_0, removed);
    await projectMessageReactionEnvelope(testEnv.PROJECTION_DB_0, added);
    await projectMessageReactionEnvelope(testEnv.PROJECTION_DB_0, removed);

    const row = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT reaction_entity_id, status, last_cursor
       FROM message_reaction_presence_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
         AND actor_kind = 'punk'`,
    )
      .bind(scope.workspaceId, scope.conversationId, scope.messageId)
      .first();
    expect(row).toEqual({
      reaction_entity_id: scope.reactionId,
      status: "removed",
      last_cursor: 12,
    });
    const count = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT active_count, visible_count, last_cursor
       FROM message_reaction_count_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
    )
      .bind(scope.workspaceId, scope.conversationId, scope.messageId)
      .first();
    expect(count).toEqual({
      active_count: 1,
      visible_count: 1,
      last_cursor: 12,
    });

    const sameCoordinateDifferentId = reactionEnvelope({
      ...scope,
      reactionId: "00000000-0000-8000-8000-000000000224",
      cursor: 13,
    });
    const sameIdDifferentCoordinate = reactionEnvelope({
      ...scope,
      messageId: "00000000-0000-8000-8000-000000000225",
      cursor: 13,
    });
    await expect(
      projectMessageReactionEnvelope(
        testEnv.PROJECTION_DB_0,
        sameCoordinateDifferentId,
      ),
    ).rejects.toThrow();
    await expect(
      projectMessageReactionEnvelope(
        testEnv.PROJECTION_DB_0,
        sameIdDifferentCoordinate,
      ),
    ).rejects.toThrow();
  });

  it("materializes bounded absolute counts without plaintext, crypto, or a roster", async () => {
    const scope = {
      workspaceId: "00000000-0000-8000-8000-000000000230",
      conversationId: "00000000-0000-8000-8000-000000000231",
      messageId: "00000000-0000-8000-8000-000000000232",
    };
    await projectMessageReactionEnvelope(
      testEnv.PROJECTION_DB_0,
      reactionEnvelope({
        ...scope,
        reactionId: "00000000-0000-8000-8000-000000000233",
        cursor: 2,
      }),
    );
    await projectMessageReactionEnvelope(
      testEnv.PROJECTION_DB_0,
      reactionEnvelope({
        ...scope,
        reactionId: "00000000-0000-8000-8000-000000000234",
        cursor: 3,
        actor: { kind: "bot", installationId: botId },
        contract: "message.reaction-toggle@1",
      }),
    );

    const count = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT active_count, visible_count
       FROM message_reaction_count_projection
       WHERE workspace_id = ? AND conversation_id = ?
         AND message_id = ? AND reaction = ?`,
    )
      .bind(scope.workspaceId, scope.conversationId, scope.messageId, "🔥")
      .first();
    expect(count).toEqual({ active_count: 2, visible_count: 2 });

    for (const table of [
      "message_reaction_presence_projection",
      "message_reaction_visibility_projection",
      "message_reaction_count_projection",
      "message_reaction_event_projection",
    ]) {
      const columns = await testEnv.PROJECTION_DB_0.prepare(
        `SELECT name FROM pragma_table_info('${table}') ORDER BY name`,
      ).all<{ name: string }>();
      expect(columns.results.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining([
          "actors_json",
          "roster_json",
          "plaintext",
          "content",
          "signed_event_json",
          "ciphertext",
          "content_key_id",
        ]),
      );
    }
  });

  it("derives hide, restore, and irreversible erasure from Message projection", async () => {
    const scope = {
      workspaceId: "00000000-0000-8000-8000-000000000240",
      conversationId: "00000000-0000-8000-8000-000000000241",
      messageId: "00000000-0000-8000-8000-000000000242",
    };
    await projectMessageEnvelope(
      testEnv.PROJECTION_DB_0,
      messageLifecycleEnvelope(
        scope.workspaceId,
        scope.conversationId,
        scope.messageId,
        1,
        "active",
      ),
    );
    await projectMessageReactionEnvelope(
      testEnv.PROJECTION_DB_0,
      reactionEnvelope({
        ...scope,
        reactionId: "00000000-0000-8000-8000-000000000243",
        cursor: 2,
      }),
    );

    const projectLifecycle = (
      cursor: number,
      status: "active" | "retracted" | "erased",
    ) =>
      projectMessageEnvelope(
        testEnv.PROJECTION_DB_0,
        messageLifecycleEnvelope(
          scope.workspaceId,
          scope.conversationId,
          scope.messageId,
          cursor,
          status,
        ),
      );
    const visibility = () =>
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT visibility, last_cursor
         FROM message_reaction_visibility_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
        .bind(scope.workspaceId, scope.conversationId, scope.messageId)
        .first();
    const visibleCount = () =>
      testEnv.PROJECTION_DB_0.prepare(
        `SELECT visible_count, last_cursor
         FROM message_reaction_count_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
        .bind(scope.workspaceId, scope.conversationId, scope.messageId)
        .first();

    await projectLifecycle(4, "retracted");
    expect(await visibility()).toEqual({
      visibility: "temporarily-hidden",
      last_cursor: 4,
    });
    expect(await visibleCount()).toEqual({
      visible_count: 0,
      last_cursor: 4,
    });

    await projectLifecycle(5, "active");
    expect(await visibility()).toEqual({
      visibility: "visible",
      last_cursor: 5,
    });
    expect(await visibleCount()).toEqual({
      visible_count: 1,
      last_cursor: 5,
    });

    await projectLifecycle(6, "erased");
    await projectLifecycle(7, "active");
    expect(await visibility()).toEqual({
      visibility: "permanently-hidden",
      last_cursor: 6,
    });
    expect(await visibleCount()).toEqual({
      visible_count: 0,
      last_cursor: 6,
    });
  });

  it("routes valid Reaction envelopes through Queue and retries inconsistent ones", async () => {
    const scope = {
      workspaceId: "00000000-0000-8000-8000-000000000250",
      conversationId: "00000000-0000-8000-8000-000000000251",
      messageId: "00000000-0000-8000-8000-000000000252",
      reactionId: "00000000-0000-8000-8000-000000000253",
      cursor: 9,
    };
    const valid = reactionEnvelope(scope);
    const invalid = reactionEnvelope({
      ...scope,
      reactionId: "00000000-0000-8000-8000-000000000254",
      cursor: 10,
      kind: 50211,
    });
    const result = await consume([valid, invalid]);

    expect(result.explicitAcks).toEqual(["reaction-0-9"]);
    expect(result.retryMessages).toEqual([{ msgId: "reaction-1-10" }]);
  });

  it("retries every cryptographic Reaction mutation without touching D1", async () => {
    const scope = {
      workspaceId: "00000000-0000-8000-8000-000000000260",
      conversationId: "00000000-0000-8000-8000-000000000261",
      messageId: "00000000-0000-8000-8000-000000000262",
      reactionId: "00000000-0000-8000-8000-000000000263",
      cursor: 15,
    };
    const signed = await signProjectionEnvelope(reactionEnvelope(scope));
    const result = await consume(cryptographicMutations(signed), true);

    expect(result.explicitAcks).toEqual([]);
    expect(result.retryMessages).toHaveLength(5);
    const row = await projectionDatabase(testEnv, scope.workspaceId)
      .prepare(
        `SELECT COUNT(*) AS count FROM message_reaction_event_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
      .bind(scope.workspaceId, scope.conversationId, scope.messageId)
      .first<{ count: number }>();
    expect(row).toEqual({ count: 0 });
  });
});
