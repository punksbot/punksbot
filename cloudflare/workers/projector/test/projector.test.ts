import type {
  ConversationProjectionMessage,
  MessageProjectionMessage,
  WorkspaceProjectionMessage,
} from "@punks/contracts";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import worker from "../src";
import { projectionDatabase } from "../src/shards";
import {
  cryptographicMutations,
  signProjectionEnvelope,
  withAttestationRegistry,
} from "./attestation-fixture";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";

function projection(
  cursor: number,
  slug: string,
  members: WorkspaceProjectionMessage["state"]["members"] = [
    { punkId: "punk_owner", role: "owner" },
  ],
): WorkspaceProjectionMessage {
  const timestamp = new Date(1_787_227_200_000 + cursor * 1_000).toISOString();
  const state: WorkspaceProjectionMessage["state"] = {
    id: workspaceId,
    slug,
    name: "Core Team",
    visibility: "private",
    status: "active",
    ownerPunkId: "punk_owner",
    members,
    revision: cursor,
    cursor,
    createdAt: new Date(1_787_227_200_000).toISOString(),
    updatedAt: timestamp,
  };
  const contract =
    cursor === 1
      ? "workspace.create@1"
      : cursor === 2
        ? "workspace.rename@1"
        : cursor === 3
          ? "workspace.member-set-role@1"
          : "workspace.member-remove@1";
  const kind =
    cursor === 1 ? 50000 : cursor === 2 ? 50001 : cursor === 3 ? 50003 : 50004;
  return {
    schemaVersion: 1,
    workspaceId,
    cursor,
    event: {
      id: String(cursor).padStart(64, "0"),
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind,
      tags: [
        ["workspace", workspaceId],
        ["cursor", String(cursor)],
        ["contract", contract],
      ],
      content: JSON.stringify({ schemaVersion: 1, workspace: state }),
      sig: "0".repeat(128),
    },
    state,
  };
}

async function consume(
  messages: (
    | WorkspaceProjectionMessage
    | ConversationProjectionMessage
    | MessageProjectionMessage
  )[],
  options: { alreadySigned?: boolean; environment?: TestEnv } = {},
) {
  const bodies = options.alreadySigned
    ? messages
    : await Promise.all(messages.map(signProjectionEnvelope));
  const batch = createMessageBatch(
    "punks-projection-local",
    bodies.map((body, index) => ({
      id: `message-${index}-${body.cursor}`,
      timestamp: new Date(),
      body,
      attempts: 1,
    })),
  );
  const context = createExecutionContext();
  await worker.queue?.(batch, options.environment ?? testEnv, context);
  return getQueueResult(batch, context);
}

function rebound<Projection>(
  projectionValue: Projection,
  replacements: readonly (readonly [string, string])[],
): Projection {
  let serialized = JSON.stringify(projectionValue);
  for (const [source, target] of replacements) {
    serialized = serialized.replaceAll(source, target);
  }
  return JSON.parse(serialized) as Projection;
}

interface MessageProjectionOptions {
  workspaceId?: string;
  conversationId?: string;
  messageId?: string;
  cursor?: number;
}

function messageProjection({
  workspaceId: projectedWorkspaceId = "dbb539c1-3cbb-4e29-af42-f5c13b2d76b4",
  conversationId = "ef8c7fb1-c8e4-4d04-94ef-ee41c5f556db",
  messageId = "99755ed1-a008-4c84-86d0-0f197fa9ec7b",
  cursor = 11,
}: MessageProjectionOptions = {}): MessageProjectionMessage {
  const timestamp = new Date(1_787_234_400_000 + cursor * 1_000).toISOString();
  const version: MessageProjectionMessage["versionDelta"] = {
    operation: "upsert",
    version: {
      version: 1,
      contentCommitment: "b".repeat(64),
      ciphertextRef: `messages/${projectedWorkspaceId}/${messageId}/1.enc`,
      contentKeyId: "message-key-1",
      topicPresent: false,
      createdAt: timestamp,
    },
  };
  const state: MessageProjectionMessage["state"] = {
    id: messageId,
    workspaceId: projectedWorkspaceId,
    conversationId,
    author: {
      kind: "punk",
      punkId: "2a72c6dc-3cd0-4734-84c2-f6e92ec45771",
    },
    messageType: "stream-message",
    status: "active",
    topicPresent: false,
    mentionedPunkIds: [],
    mediaIds: [],
    parentMessageId: null,
    threadRootMessageId: messageId,
    threadDepth: 0,
    broadcast: false,
    replyCount: 0,
    descendantCount: 0,
    lastReplyAt: null,
    originalContentCommitment: "b".repeat(64),
    currentVersion: 1,
    retraction: null,
    erasureMarker: null,
    revision: 1,
    createdCursor: cursor,
    cursor,
    createdAt: timestamp,
    updatedAt: timestamp,
    editedAt: null,
  };
  return {
    schemaVersion: 1,
    workspaceId: projectedWorkspaceId,
    conversationId,
    messageId,
    cursor,
    event: {
      id: `3${String(cursor).padStart(63, "0")}`,
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind: 50200,
      tags: [
        ["workspace", projectedWorkspaceId],
        ["conversation", conversationId],
        ["message", messageId],
        ["cursor", String(cursor)],
        ["command", "c2111e04-eb7c-42a8-8930-446b2c9d784d"],
        ["contract", "message.post@1"],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        message: state,
        versionDelta: version,
      }),
      sig: "0".repeat(128),
    },
    state,
    versionDelta: version,
    threadDeltas: [],
    search: {
      algorithm: "hmac-sha256-conversation-v2",
      tokens: [`h2_${"A".repeat(43)}`],
    },
  };
}

function conversationProjection(
  cursor: number,
  members: ConversationProjectionMessage["state"]["members"],
): ConversationProjectionMessage {
  const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
  const timestamp = new Date(1_787_230_800_000 + cursor * 1_000).toISOString();
  const state: ConversationProjectionMessage["state"] = {
    id: conversationId,
    workspaceId,
    name: "general",
    type: "stream",
    visibility: "open",
    description: "Workspace-wide discussion",
    topic: null,
    purpose: null,
    topicRequired: false,
    maxMembers: null,
    ttlSeconds: null,
    ttlDeadline: null,
    ownerPunkId: "punk_owner",
    members,
    status: "active",
    revision: cursor,
    cursor,
    createdAt: new Date(1_787_230_800_000).toISOString(),
    updatedAt: timestamp,
    archivedAt: null,
  };
  const contract =
    cursor === 1
      ? "conversation.create@1"
      : cursor === 2
        ? "conversation.join@1"
        : "conversation.member-remove@1";
  const kind = cursor === 1 ? 50100 : cursor === 2 ? 50101 : 50103;
  return {
    schemaVersion: 1,
    workspaceId,
    conversationId,
    cursor,
    event: {
      id: `1${String(cursor).padStart(63, "0")}`,
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind,
      tags: [
        ["workspace", workspaceId],
        ["conversation", conversationId],
        ["cursor", String(cursor)],
        ["contract", contract],
      ],
      content: JSON.stringify({ schemaVersion: 1, conversation: state }),
      sig: "0".repeat(128),
    },
    state,
  };
}

function conversationLifecycleProjection(
  source: ConversationProjectionMessage,
  cursor: number,
  kind: 50105 | 50106 | 50107,
  contract:
    | "conversation.update@1"
    | "conversation.archive@1"
    | "conversation.restore@1",
  patch: Partial<ConversationProjectionMessage["state"]>,
): ConversationProjectionMessage {
  const timestamp = new Date(1_787_230_800_000 + cursor * 1_000).toISOString();
  const state: ConversationProjectionMessage["state"] = {
    ...source.state,
    ...patch,
    revision: cursor,
    cursor,
    updatedAt: timestamp,
  };
  return {
    schemaVersion: 1,
    workspaceId: source.workspaceId,
    conversationId: source.conversationId,
    cursor,
    event: {
      id: `2${String(cursor).padStart(63, "0")}`,
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind,
      tags: [
        ["workspace", source.workspaceId],
        ["conversation", source.conversationId],
        ["cursor", String(cursor)],
        ["contract", contract],
      ],
      content: JSON.stringify({ schemaVersion: 1, conversation: state }),
      sig: "0".repeat(128),
    },
    state,
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

describe("shared projection attestation chokepoint", () => {
  it("retries every ID, tag, content, signature, and key-version mutation per legacy family", async () => {
    const mutationCases: readonly {
      family: string;
      body:
        | WorkspaceProjectionMessage
        | ConversationProjectionMessage
        | MessageProjectionMessage;
      database: D1Database;
      count: () => Promise<{ count: number } | null>;
    }[] = [
      (() => {
        const projectedWorkspaceId = "00000000-0000-8000-8000-000000000701";
        const body = rebound(projection(1, "attested-workspace"), [
          [workspaceId, projectedWorkspaceId],
        ]);
        const database = projectionDatabase(testEnv, projectedWorkspaceId);
        return {
          family: "workspace",
          body,
          database,
          count: () =>
            database
              .prepare(
                "SELECT COUNT(*) AS count FROM workspace_projection WHERE workspace_id = ?",
              )
              .bind(projectedWorkspaceId)
              .first<{ count: number }>(),
        };
      })(),
      (() => {
        const projectedWorkspaceId = "00000000-0000-8000-8000-000000000710";
        const projectedConversationId = "00000000-0000-8000-8000-000000000711";
        const body = rebound(
          conversationProjection(1, [
            {
              punkId: "punk_owner",
              access: "owner",
              joinedAt: "2026-08-20T13:00:00.000Z",
              invitedByPunkId: null,
            },
          ]),
          [
            [workspaceId, projectedWorkspaceId],
            ["e3a92f8d-f013-46b7-9370-5ca1c79b6280", projectedConversationId],
          ],
        );
        const database = projectionDatabase(testEnv, projectedWorkspaceId);
        return {
          family: "conversation",
          body,
          database,
          count: () =>
            database
              .prepare(
                "SELECT COUNT(*) AS count FROM conversation_projection WHERE conversation_id = ?",
              )
              .bind(projectedConversationId)
              .first<{ count: number }>(),
        };
      })(),
      (() => {
        const scope = {
          workspaceId: "00000000-0000-8000-8000-000000000720",
          conversationId: "00000000-0000-8000-8000-000000000721",
          messageId: "00000000-0000-8000-8000-000000000722",
          cursor: 21,
        };
        const body = messageProjection(scope);
        const database = projectionDatabase(testEnv, scope.workspaceId);
        return {
          family: "message",
          body,
          database,
          count: () =>
            database
              .prepare(
                `SELECT COUNT(*) AS count FROM message_projection
                 WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
              )
              .bind(scope.workspaceId, scope.conversationId, scope.messageId)
              .first<{ count: number }>(),
        };
      })(),
    ];

    for (const mutationCase of mutationCases) {
      const signed = await signProjectionEnvelope(mutationCase.body);
      const result = await consume(cryptographicMutations(signed), {
        alreadySigned: true,
      });
      expect(result.explicitAcks, mutationCase.family).toEqual([]);
      expect(result.retryMessages, mutationCase.family).toHaveLength(5);
      expect(await mutationCase.count(), mutationCase.family).toEqual({
        count: 0,
      });
    }
  });

  it("retries absent or malformed registries without touching D1", async () => {
    const cases = [
      {
        workspaceId: "00000000-0000-8000-8000-000000000731",
        registry: undefined,
      },
      {
        workspaceId: "00000000-0000-8000-8000-000000000732",
        registry: '{"local":[]}',
      },
    ] as const;

    for (const registryCase of cases) {
      const body = await signProjectionEnvelope(
        rebound(projection(1, "registry-fail-closed"), [
          [workspaceId, registryCase.workspaceId],
        ]),
      );
      const result = await consume([body], {
        alreadySigned: true,
        environment: withAttestationRegistry(testEnv, registryCase.registry),
      });
      expect(result.explicitAcks).toEqual([]);
      expect(result.retryMessages).toHaveLength(1);
      const row = await projectionDatabase(testEnv, registryCase.workspaceId)
        .prepare(
          "SELECT COUNT(*) AS count FROM workspace_projection WHERE workspace_id = ?",
        )
        .bind(registryCase.workspaceId)
        .first<{ count: number }>();
      expect(row).toEqual({ count: 0 });
    }
  });
});

describe("Workspace D1 projector", () => {
  it("is idempotent and does not regress on out-of-order delivery", async () => {
    const result = await consume([
      projection(1, "core-team"),
      projection(2, "renamed-team"),
      projection(1, "core-team"),
    ]);
    expect(result.retryMessages).toEqual([]);

    const row = await testEnv.PROJECTION_DB_0.prepare(
      "SELECT slug, revision, last_cursor FROM workspace_projection WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ slug: string; revision: number; last_cursor: number }>();
    expect(row).toEqual({ slug: "renamed-team", revision: 2, last_cursor: 2 });

    const events = await testEnv.PROJECTION_DB_0.prepare(
      "SELECT COUNT(*) AS count FROM workspace_event_projection WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ count: number }>();
    expect(events?.count).toBe(2);
  });

  it("keeps FTS5 synchronized with the winning cursor", async () => {
    const hit = await testEnv.PROJECTION_DB_0.prepare(
      "SELECT workspace_id FROM workspace_search WHERE workspace_search MATCH ?",
    )
      .bind("renamed")
      .first<{ workspace_id: string }>();
    expect(hit?.workspace_id).toBe(workspaceId);
  });

  it("projects the winning membership snapshot without old-event resurrection", async () => {
    const withMember = projection(3, "renamed-team", [
      { punkId: "punk_owner", role: "owner" },
      { punkId: "punk_member", role: "member" },
    ]);
    const removed = projection(4, "renamed-team");
    const result = await consume([withMember, removed, withMember]);
    expect(result.retryMessages).toEqual([]);

    const memberships = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT punk_id, role, present, last_cursor
       FROM workspace_member_projection
       WHERE workspace_id = ?
       ORDER BY punk_id`,
    )
      .bind(workspaceId)
      .all<{
        punk_id: string;
        role: string;
        present: number;
        last_cursor: number;
      }>();
    expect(memberships.results).toEqual([
      { punk_id: "punk_member", role: "member", present: 0, last_cursor: 4 },
      { punk_id: "punk_owner", role: "owner", present: 1, last_cursor: 4 },
    ]);
  });

  it("advances the v1 snapshot barrier so a missing old coordinate cannot appear later", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000871";
    const winning = rebound(projection(4, "barrier-team"), [
      [workspaceId, projectedWorkspaceId],
    ]);
    const stale = rebound(
      projection(3, "barrier-team", [
        { punkId: "punk_owner", role: "owner" },
        { punkId: "punk_late", role: "member" },
      ]),
      [[workspaceId, projectedWorkspaceId]],
    );
    expect((await consume([winning, stale])).retryMessages).toEqual([]);

    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    expect(
      await database
        .prepare(
          `SELECT roster_floor_cursor FROM workspace_projection
           WHERE workspace_id = ?`,
        )
        .bind(projectedWorkspaceId)
        .first<{ roster_floor_cursor: number }>(),
    ).toEqual({ roster_floor_cursor: 4 });
    expect(
      await database
        .prepare(
          `SELECT punk_id FROM workspace_member_projection
           WHERE workspace_id = ? AND punk_id = 'punk_late'`,
        )
        .bind(projectedWorkspaceId)
        .first(),
    ).toBeNull();
  });

  it("retries a structurally valid message whose cross-field invariants disagree", async () => {
    const inconsistent = projection(5, "tampered-team");
    inconsistent.state.id = "1b68b91a-9525-4790-a4d8-76afc282664f";
    const result = await consume([inconsistent]);
    expect(result.retryMessages).toHaveLength(1);

    const row = await testEnv.PROJECTION_DB_0.prepare(
      "SELECT slug, last_cursor FROM workspace_projection WHERE workspace_id = ?",
    )
      .bind(workspaceId)
      .first<{ slug: string; last_cursor: number }>();
    expect(row).toEqual({ slug: "renamed-team", last_cursor: 4 });
  });

  it("projects Conversation metadata, FTS, and the winning membership snapshot", async () => {
    const owner = {
      punkId: "punk_owner",
      access: "owner" as const,
      joinedAt: "2026-08-20T13:00:00.000Z",
      invitedByPunkId: null,
    };
    const member = {
      punkId: "punk_member",
      access: "member" as const,
      joinedAt: "2026-08-20T13:01:00.000Z",
      invitedByPunkId: null,
    };
    const created = conversationProjection(1, [owner]);
    const joined = conversationProjection(2, [owner, member]);
    const removed = conversationProjection(3, [owner]);
    const result = await consume([created, joined, removed, joined]);
    expect(result.retryMessages).toEqual([]);

    const conversation = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT name, conversation_type, visibility, last_cursor
       FROM conversation_projection WHERE conversation_id = ?`,
    )
      .bind(created.conversationId)
      .first<{
        name: string;
        conversation_type: string;
        visibility: string;
        last_cursor: number;
      }>();
    expect(conversation).toEqual({
      name: "general",
      conversation_type: "stream",
      visibility: "open",
      last_cursor: 3,
    });
    const members = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT punk_id, access, present, last_cursor
       FROM conversation_member_projection
       WHERE conversation_id = ? ORDER BY punk_id`,
    )
      .bind(created.conversationId)
      .all<{
        punk_id: string;
        access: string;
        present: number;
        last_cursor: number;
      }>();
    expect(members.results).toEqual([
      {
        punk_id: "punk_member",
        access: "member",
        present: 0,
        last_cursor: 3,
      },
      { punk_id: "punk_owner", access: "owner", present: 1, last_cursor: 3 },
    ]);
    const search = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT conversation_id FROM conversation_search
       WHERE conversation_search MATCH ?`,
    )
      .bind("discussion")
      .first<{ conversation_id: string }>();
    expect(search?.conversation_id).toBe(created.conversationId);
  });

  it("projects Conversation metadata and lifecycle without cursor regression", async () => {
    const owner = {
      punkId: "punk_owner",
      access: "owner" as const,
      joinedAt: "2026-08-20T13:00:00.000Z",
      invitedByPunkId: null,
    };
    const baseline = conversationProjection(3, [owner]);
    const updated = conversationLifecycleProjection(
      baseline,
      4,
      50105,
      "conversation.update@1",
      {
        name: "outage-response",
        topic: "Database saturation",
        ttlSeconds: 120,
        ttlDeadline: "2026-08-20T13:04:00.000Z",
      },
    );
    const archived = conversationLifecycleProjection(
      updated,
      5,
      50106,
      "conversation.archive@1",
      {
        status: "archived",
        archivedAt: "2026-08-20T13:05:00.000Z",
        ttlDeadline: null,
      },
    );
    const restored = conversationLifecycleProjection(
      archived,
      6,
      50107,
      "conversation.restore@1",
      {
        status: "active",
        archivedAt: null,
        ttlDeadline: "2026-08-20T13:08:00.000Z",
      },
    );
    const result = await consume([updated, restored, archived]);
    expect(result.retryMessages).toEqual([]);

    const row = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT name, topic, status, ttl_seconds, ttl_deadline, last_cursor
       FROM conversation_projection WHERE conversation_id = ?`,
    )
      .bind(baseline.conversationId)
      .first<{
        name: string;
        topic: string;
        status: string;
        ttl_seconds: number;
        ttl_deadline: string;
        last_cursor: number;
      }>();
    expect(row).toEqual({
      name: "outage-response",
      topic: "Database saturation",
      status: "active",
      ttl_seconds: 120,
      ttl_deadline: "2026-08-20T13:08:00.000Z",
      last_cursor: 6,
    });
    const search = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT conversation_id FROM conversation_search
       WHERE conversation_search MATCH ?`,
    )
      .bind("outage")
      .first<{ conversation_id: string }>();
    expect(search?.conversation_id).toBe(baseline.conversationId);
  });
});

describe("Message D1 Queue projector", () => {
  it("projects and explicitly acknowledges a valid Message envelope", async () => {
    const message = messageProjection();

    const result = await consume([message]);

    expect(result.retryMessages).toEqual([]);
    expect(result.explicitAcks).toEqual([`message-0-${message.cursor}`]);
    const projected = await projectionDatabase(testEnv, message.workspaceId)
      .prepare(
        `SELECT status, current_version, created_cursor, last_cursor
       FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
      .bind(message.workspaceId, message.conversationId, message.messageId)
      .first();
    expect(projected).toEqual({
      status: "active",
      current_version: 1,
      created_cursor: 11,
      last_cursor: 11,
    });
  });

  it("retries a cross-field-invalid Message envelope without projecting it", async () => {
    const message = messageProjection({
      workspaceId: "83e3f6cd-2920-4209-96d4-bf4bfd38e4f2",
      conversationId: "b871f4cf-3771-4381-b72c-f7a156e61c9e",
      messageId: "f74b2bd7-09a0-4c84-aa92-f88dd51659c2",
      cursor: 12,
    });
    message.state.originalContentCommitment = "c".repeat(64);

    const result = await consume([message]);

    expect(result.retryMessages).toEqual([{ msgId: "message-0-12" }]);
    expect(result.explicitAcks).toEqual([]);
    const projected = await projectionDatabase(testEnv, message.workspaceId)
      .prepare(
        `SELECT message_id FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
      .bind(message.workspaceId, message.conversationId, message.messageId)
      .first();
    expect(projected).toBeNull();
  });

  it("retries a schema-valid Message envelope with an impossible transition", async () => {
    const message = messageProjection({
      workspaceId: "c971ddeb-f6a2-470d-896b-0cd219056e86",
      conversationId: "e3bdc098-9639-413e-ae29-a0a06f90308d",
      messageId: "5358f4a0-3700-4a2f-ad45-7bb98cb9201d",
      cursor: 13,
    });
    message.versionDelta = { operation: "retain" };
    message.event.content = JSON.stringify({
      schemaVersion: 1,
      message: message.state,
      versionDelta: message.versionDelta,
    });

    const result = await consume([message]);

    expect(result.retryMessages).toEqual([{ msgId: "message-0-13" }]);
    expect(result.explicitAcks).toEqual([]);
    const projected = await projectionDatabase(testEnv, message.workspaceId)
      .prepare(
        `SELECT message_id FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?`,
      )
      .bind(message.workspaceId, message.conversationId, message.messageId)
      .first();
    expect(projected).toBeNull();
  });

  it("retries a Message after a D1 cursor conflict without a partial projection", async () => {
    const scope = {
      workspaceId: "c27fdfd1-3ebf-4e6b-a425-6dd5321bba39",
      conversationId: "1d0fc3b5-4c1f-485d-9875-9a7d431d7de1",
      cursor: 14,
    };
    const accepted = messageProjection({
      ...scope,
      messageId: "53430430-1428-4fdc-ac2c-c6c5bb0ea68f",
    });
    const conflicting = messageProjection({
      ...scope,
      messageId: "e51fd067-f89e-4c66-a809-32a0679088d0",
    });

    const result = await consume([accepted, conflicting]);

    expect(result.explicitAcks).toEqual(["message-0-14"]);
    expect(result.retryMessages).toEqual([{ msgId: "message-1-14" }]);
    const database = projectionDatabase(testEnv, scope.workspaceId);
    const projected = await database
      .prepare(
        `SELECT message_id FROM message_projection
       WHERE workspace_id = ? AND conversation_id = ?
       ORDER BY message_id`,
      )
      .bind(scope.workspaceId, scope.conversationId)
      .all();
    expect(projected.results).toEqual([{ message_id: accepted.messageId }]);
    const events = await database
      .prepare(
        `SELECT message_id FROM message_event_projection
       WHERE workspace_id = ? AND conversation_id = ?`,
      )
      .bind(scope.workspaceId, scope.conversationId)
      .all();
    expect(events.results).toEqual([{ message_id: accepted.messageId }]);
  });
});
