import type {
  ConversationEventContentV2,
  ConversationMemberDeltaV2,
  ConversationProjectionMessageV2,
  WorkspaceEventContentV2,
  WorkspaceMemberDeltaV2,
  WorkspaceProjectionMessageV2,
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
import { signProjectionEnvelope } from "./attestation-fixture";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const workspaceId = "00000000-0000-8000-8000-000000000801";

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function workspaceV2Projection(
  projectedWorkspaceId = workspaceId,
  cursor = 1,
  memberDeltas: WorkspaceMemberDeltaV2[] = [
    { punkId: "punk_owner", present: true, role: "owner" },
  ],
  options: {
    kind?: 50000 | 50001 | 50003 | 50004;
    contract?:
      | "workspace.create@1"
      | "workspace.rename@1"
      | "workspace.member-set-role@1"
      | "workspace.member-remove@1"
      | "workspace.transfer-ownership@1";
    transition?: WorkspaceEventContentV2["transition"];
    memberCount?: number;
    ownerPunkId?: string;
    slug?: string;
  } = {},
): Promise<WorkspaceProjectionMessageV2[]> {
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(memberDeltas.length / 100)) },
    (_, index) => memberDeltas.slice(index * 100, index * 100 + 100),
  );
  const chunkDigests = await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      sha256Hex(
        canonicalJson({
          schemaVersion: 2,
          workspaceId: projectedWorkspaceId,
          cursor,
          chunkIndex,
          memberDeltas: chunk,
        }),
      ),
    ),
  );
  const deltaDigest = await sha256Hex(
    canonicalJson({ schemaVersion: 2, memberDeltas }),
  );
  const firstDigest = chunkDigests[0];
  if (firstDigest === undefined) {
    throw new Error("Test fixture requires one chunk");
  }
  const content: WorkspaceEventContentV2 = {
    schemaVersion: 2,
    workspace: {
      id: projectedWorkspaceId,
      slug: options.slug ?? `workspace-${cursor}`,
      name: "Bounded Workspace",
      visibility: "private",
      status: "active",
      ownerPunkId: options.ownerPunkId ?? "punk_owner",
      memberCount:
        options.memberCount ??
        memberDeltas.filter((delta) => delta.present).length,
      revision: cursor,
      cursor,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: new Date(
        Date.parse("2026-08-21T10:00:00.000Z") + cursor,
      ).toISOString(),
    },
    transition: options.transition ?? { type: "created" },
    membershipCommitment: {
      algorithm: "sha256-canonical-json",
      deltaDigest,
      deltaCount: memberDeltas.length,
      chunkCount: chunks.length,
      chunkDigests: [firstDigest, ...chunkDigests.slice(1)],
    },
  };
  const targetTag: [string, ...string[]][] =
    content.transition.type === "member-upserted" ||
    content.transition.type === "member-removed"
      ? [["target", "punk", content.transition.targetPunkId]]
      : content.transition.type === "ownership-transferred"
        ? [
            [
              "previous_owner",
              "punk",
              content.transition.memberTransitions[0].targetPunkId,
            ],
            [
              "target",
              "punk",
              content.transition.memberTransitions[1].targetPunkId,
            ],
          ]
        : [];
  const event: WorkspaceProjectionMessageV2["event"] = {
    id: "0".repeat(64),
    pubkey: "0".repeat(64),
    created_at: 1_787_230_800 + cursor,
    kind: options.kind ?? 50000,
    tags: [
      ["workspace", projectedWorkspaceId],
      ["cursor", String(cursor)],
      ["command", "c2111e04-eb7c-42a8-8930-446b2c9d784d"],
      ["contract", options.contract ?? "workspace.create@1"],
      ["actor", "punk", "punk_owner"],
      ...targetTag,
      [
        "delta",
        "sha256",
        deltaDigest,
        String(memberDeltas.length),
        String(chunks.length),
      ],
    ],
    content: canonicalJson(content),
    sig: "0".repeat(128),
  };
  const signed = await signProjectionEnvelope({
    schemaVersion: 2 as const,
    workspaceId: projectedWorkspaceId,
    cursor,
    chunkIndex: 0,
    chunkCount: chunks.length,
    chunkDigest: firstDigest,
    memberDeltas: chunks[0] ?? [],
    event,
  });
  return chunks.map((memberChunk, chunkIndex) => ({
    ...signed,
    chunkIndex,
    chunkDigest: chunkDigests[chunkIndex] ?? "",
    memberDeltas: memberChunk,
  }));
}

async function conversationV2Projection(
  projectedWorkspaceId: string,
  projectedConversationId: string,
  cursor: number,
  memberDeltas: ConversationMemberDeltaV2[],
  options: {
    kind?: 50100 | 50101 | 50102 | 50103 | 50105 | 50106 | 50107;
    contract?:
      | "conversation.create@1"
      | "conversation.join@1"
      | "conversation.member-set-access@1"
      | "conversation.member-remove@1"
      | "conversation.update@1"
      | "conversation.archive@1"
      | "conversation.restore@1";
    transition?: ConversationEventContentV2["transition"];
    memberCount?: number;
    name?: string;
  } = {},
): Promise<ConversationProjectionMessageV2[]> {
  const chunks = Array.from(
    { length: Math.max(1, Math.ceil(memberDeltas.length / 100)) },
    (_, index) => memberDeltas.slice(index * 100, index * 100 + 100),
  );
  const chunkDigests = await Promise.all(
    chunks.map((chunk, chunkIndex) =>
      sha256Hex(
        canonicalJson({
          schemaVersion: 2,
          workspaceId: projectedWorkspaceId,
          conversationId: projectedConversationId,
          cursor,
          chunkIndex,
          memberDeltas: chunk,
        }),
      ),
    ),
  );
  const deltaDigest = await sha256Hex(
    canonicalJson({ schemaVersion: 2, memberDeltas }),
  );
  const firstDigest = chunkDigests[0];
  if (firstDigest === undefined) {
    throw new Error("Test fixture requires one chunk");
  }
  const content: ConversationEventContentV2 = {
    schemaVersion: 2,
    conversation: {
      id: projectedConversationId,
      workspaceId: projectedWorkspaceId,
      name: options.name ?? "Bounded Conversation",
      type: "stream",
      visibility: "private",
      description: null,
      topic: null,
      purpose: null,
      topicRequired: false,
      maxMembers: 1000,
      ttlSeconds: null,
      ttlDeadline: null,
      ownerPunkId: "punk_owner",
      memberCount:
        options.memberCount ??
        memberDeltas.filter((delta) => delta.present).length,
      status: "active",
      revision: cursor,
      cursor,
      createdAt: "2026-08-21T10:00:00.000Z",
      updatedAt: new Date(
        Date.parse("2026-08-21T10:00:00.000Z") + cursor,
      ).toISOString(),
      archivedAt: null,
    },
    transition: options.transition ?? { type: "created" },
    membershipCommitment: {
      algorithm: "sha256-canonical-json",
      deltaDigest,
      deltaCount: memberDeltas.length,
      chunkCount: chunks.length,
      chunkDigests: [firstDigest, ...chunkDigests.slice(1)],
    },
  };
  const targetTag: [string, ...string[]][] =
    content.transition.type === "member-joined" ||
    content.transition.type === "member-access-set" ||
    content.transition.type === "member-removed"
      ? [["target", "punk", content.transition.targetPunkId]]
      : [];
  const event: ConversationProjectionMessageV2["event"] = {
    id: "0".repeat(64),
    pubkey: "0".repeat(64),
    created_at: 1_787_230_800 + cursor,
    kind: options.kind ?? 50100,
    tags: [
      ["workspace", projectedWorkspaceId],
      ["conversation", projectedConversationId],
      ["cursor", String(cursor)],
      ["command", "c2111e04-eb7c-42a8-8930-446b2c9d784d"],
      ["contract", options.contract ?? "conversation.create@1"],
      ["actor", "punk", "punk_owner"],
      ["workspace_cursor", "1"],
      ["workspace_role", "owner"],
      ...targetTag,
      [
        "delta",
        "sha256",
        deltaDigest,
        String(memberDeltas.length),
        String(chunks.length),
      ],
    ],
    content: canonicalJson(content),
    sig: "0".repeat(128),
  };
  const signed = await signProjectionEnvelope({
    schemaVersion: 2 as const,
    workspaceId: projectedWorkspaceId,
    conversationId: projectedConversationId,
    cursor,
    chunkIndex: 0,
    chunkCount: chunks.length,
    chunkDigest: firstDigest,
    memberDeltas: chunks[0] ?? [],
    event,
  });
  return chunks.map((memberChunk, chunkIndex) => ({
    ...signed,
    chunkIndex,
    chunkDigest: chunkDigests[chunkIndex] ?? "",
    memberDeltas: memberChunk,
  }));
}

type MembershipProjectionMessage =
  | WorkspaceProjectionMessageV2
  | ConversationProjectionMessageV2;

async function consume(messages: MembershipProjectionMessage[]) {
  const batch = createMessageBatch(
    "punks-projection-local",
    messages.map((body, index) => ({
      id: `membership-v2-${body.cursor}-${index}`,
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

describe("membership delta Queue projection", () => {
  it("projects a complete v2 Workspace delta and clears staging", async () => {
    const result = await consume(await workspaceV2Projection());
    expect(result.retryMessages).toEqual([]);
    expect(result.explicitAcks).toEqual(["membership-v2-1-0"]);

    const database = projectionDatabase(testEnv, workspaceId);
    const workspace = await database
      .prepare(
        `SELECT member_count, roster_floor_cursor, last_cursor
         FROM workspace_projection WHERE workspace_id = ?`,
      )
      .bind(workspaceId)
      .first<{
        member_count: number;
        roster_floor_cursor: number;
        last_cursor: number;
      }>();
    expect(workspace).toEqual({
      member_count: 1,
      roster_floor_cursor: 0,
      last_cursor: 1,
    });
    const member = await database
      .prepare(
        `SELECT role, present, last_cursor FROM workspace_member_projection
         WHERE workspace_id = ? AND punk_id = ?`,
      )
      .bind(workspaceId, "punk_owner")
      .first<{ role: string; present: number; last_cursor: number }>();
    expect(member).toEqual({ role: "owner", present: 1, last_cursor: 1 });
    const staging = await database
      .prepare("SELECT COUNT(*) AS count FROM membership_delta_batch")
      .first<{ count: number }>();
    expect(staging).toEqual({ count: 0 });
  });

  it("projects both bounded member transitions of one ownership transfer", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000805";
    const transfer = await workspaceV2Projection(
      projectedWorkspaceId,
      2,
      [
        { punkId: "punk_owner", present: true, role: "member" },
        { punkId: "punk_successor", present: true, role: "owner" },
      ],
      {
        kind: 50003,
        contract: "workspace.transfer-ownership@1",
        transition: {
          type: "ownership-transferred",
          memberTransitions: [
            {
              type: "member-upserted",
              targetPunkId: "punk_owner",
              previousRole: "owner",
              role: "member",
            },
            {
              type: "member-upserted",
              targetPunkId: "punk_successor",
              previousRole: "moderator",
              role: "owner",
            },
          ],
        },
        memberCount: 2,
        ownerPunkId: "punk_successor",
      },
    );

    expect((await consume(transfer)).retryMessages).toEqual([]);
    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    const members = await database
      .prepare(
        `SELECT punk_id, role, present, last_cursor
         FROM workspace_member_projection
         WHERE workspace_id = ? ORDER BY punk_id`,
      )
      .bind(projectedWorkspaceId)
      .all<{
        punk_id: string;
        role: string;
        present: number;
        last_cursor: number;
      }>();
    expect(members.results).toEqual([
      {
        punk_id: "punk_owner",
        role: "member",
        present: 1,
        last_cursor: 2,
      },
      {
        punk_id: "punk_successor",
        role: "owner",
        present: 1,
        last_cursor: 2,
      },
    ]);
  });

  it("stages a 1000-member Conversation invisibly and applies it once complete", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000811";
    const projectedConversationId = "00000000-0000-8000-8000-000000000812";
    const memberDeltas: ConversationMemberDeltaV2[] = Array.from(
      { length: 1000 },
      (_, index) => ({
        punkId: index === 0 ? "punk_owner" : `punk_${index}`,
        present: true,
        access: index === 0 ? "owner" : "member",
        joinedAt: "2026-08-21T10:00:00.000Z",
        invitedByPunkId: index === 0 ? null : "punk_owner",
      }),
    );
    const messages = await conversationV2Projection(
      projectedWorkspaceId,
      projectedConversationId,
      1,
      memberDeltas,
    );
    expect(messages).toHaveLength(10);

    const first = messages.at(-1);
    if (first === undefined) {
      throw new Error("Fixture requires a last chunk");
    }
    const staged = await consume([first]);
    expect(staged.retryMessages).toEqual([]);
    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    expect(
      await database
        .prepare(
          "SELECT conversation_id FROM conversation_projection WHERE conversation_id = ?",
        )
        .bind(projectedConversationId)
        .first(),
    ).toBeNull();
    expect(
      await database
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM membership_delta_batch) AS batches,
             (SELECT COUNT(*) FROM membership_delta_chunk) AS chunks`,
        )
        .first<{ batches: number; chunks: number }>(),
    ).toEqual({ batches: 1, chunks: 1 });

    const completed = await consume(messages.slice(0, -1).reverse());
    expect(completed.retryMessages).toEqual([]);
    const parent = await database
      .prepare(
        `SELECT member_count, roster_floor_cursor, last_cursor
         FROM conversation_projection WHERE conversation_id = ?`,
      )
      .bind(projectedConversationId)
      .first<{
        member_count: number;
        roster_floor_cursor: number;
        last_cursor: number;
      }>();
    expect(parent).toEqual({
      member_count: 1000,
      roster_floor_cursor: 0,
      last_cursor: 1,
    });
    expect(
      await database
        .prepare(
          `SELECT COUNT(*) AS count FROM conversation_member_projection
           WHERE conversation_id = ? AND present = 1`,
        )
        .bind(projectedConversationId)
        .first<{ count: number }>(),
    ).toEqual({ count: 1000 });
    expect(
      await database
        .prepare("SELECT COUNT(*) AS count FROM membership_delta_batch")
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });

  it("keeps a newer Conversation tombstone while filling an older missing coordinate", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000821";
    const projectedConversationId = "00000000-0000-8000-8000-000000000822";
    const removedMember: ConversationMemberDeltaV2 = {
      punkId: "punk_member",
      present: false,
      access: "member",
      joinedAt: "2026-08-21T10:00:00.000Z",
      invitedByPunkId: "punk_owner",
    };
    const removed = await conversationV2Projection(
      projectedWorkspaceId,
      projectedConversationId,
      3,
      [removedMember],
      {
        kind: 50103,
        contract: "conversation.member-remove@1",
        transition: {
          type: "member-removed",
          targetPunkId: "punk_member",
          previousAccess: "member",
        },
        memberCount: 1,
      },
    );
    expect((await consume(removed)).retryMessages).toEqual([]);

    const created = await conversationV2Projection(
      projectedWorkspaceId,
      projectedConversationId,
      1,
      [
        {
          punkId: "punk_owner",
          present: true,
          access: "owner",
          joinedAt: "2026-08-21T10:00:00.000Z",
          invitedByPunkId: null,
        },
        { ...removedMember, present: true },
      ],
    );
    expect((await consume(created)).retryMessages).toEqual([]);

    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    const rows = await database
      .prepare(
        `SELECT punk_id, present, last_cursor
         FROM conversation_member_projection
         WHERE conversation_id = ? ORDER BY punk_id`,
      )
      .bind(projectedConversationId)
      .all<{ punk_id: string; present: number; last_cursor: number }>();
    expect(rows.results).toEqual([
      { punk_id: "punk_member", present: 0, last_cursor: 3 },
      { punk_id: "punk_owner", present: 1, last_cursor: 1 },
    ]);
    expect(
      await database
        .prepare(
          `SELECT member_count, last_cursor FROM conversation_projection
           WHERE conversation_id = ?`,
        )
        .bind(projectedConversationId)
        .first<{ member_count: number; last_cursor: number }>(),
    ).toEqual({ member_count: 1, last_cursor: 3 });
  });

  it("applies a member coordinate even when a newer scalar parent already won", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000831";
    const metadata = await workspaceV2Projection(projectedWorkspaceId, 20, [], {
      kind: 50001,
      contract: "workspace.rename@1",
      transition: { type: "renamed", previousSlug: "workspace-19" },
      memberCount: 2,
      slug: "workspace-20",
    });
    expect((await consume(metadata)).retryMessages).toEqual([]);

    const member = await workspaceV2Projection(
      projectedWorkspaceId,
      15,
      [{ punkId: "punk_member", present: true, role: "member" }],
      {
        kind: 50003,
        contract: "workspace.member-set-role@1",
        transition: {
          type: "member-upserted",
          targetPunkId: "punk_member",
          previousRole: null,
          role: "member",
        },
        memberCount: 2,
        slug: "workspace-15",
      },
    );
    expect((await consume(member)).retryMessages).toEqual([]);

    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    expect(
      await database
        .prepare(
          `SELECT slug, member_count, last_cursor FROM workspace_projection
           WHERE workspace_id = ?`,
        )
        .bind(projectedWorkspaceId)
        .first<{
          slug: string;
          member_count: number;
          last_cursor: number;
        }>(),
    ).toEqual({ slug: "workspace-20", member_count: 2, last_cursor: 20 });
    expect(
      await database
        .prepare(
          `SELECT present, last_cursor FROM workspace_member_projection
           WHERE workspace_id = ? AND punk_id = 'punk_member'`,
        )
        .bind(projectedWorkspaceId)
        .first<{ present: number; last_cursor: number }>(),
    ).toEqual({ present: 1, last_cursor: 15 });
  });

  it("refuses a different canonical event for an already staged coordinate", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000841";
    const deltas = Array.from({ length: 101 }, (_, index) => ({
      punkId: index === 0 ? "punk_owner" : `punk_${index}`,
      present: true,
      role: index === 0 ? ("owner" as const) : ("member" as const),
    }));
    const first = await workspaceV2Projection(projectedWorkspaceId, 1, deltas, {
      slug: "staged-a",
    });
    const conflict = await workspaceV2Projection(
      projectedWorkspaceId,
      1,
      deltas,
      { slug: "staged-b" },
    );
    const firstChunk = first[0];
    const conflictingChunk = conflict[0];
    if (firstChunk === undefined || conflictingChunk === undefined) {
      throw new Error("Fixture requires first chunks");
    }
    expect((await consume([firstChunk])).retryMessages).toEqual([]);
    expect((await consume([conflictingChunk])).retryMessages).toHaveLength(1);

    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    const staged = await database
      .prepare(
        `SELECT event_id, chunk_count FROM membership_delta_batch
         WHERE aggregate_id = ? AND cursor = 1`,
      )
      .bind(projectedWorkspaceId)
      .first<{ event_id: string; chunk_count: number }>();
    expect(staged).toEqual({
      event_id: firstChunk.event.id,
      chunk_count: 2,
    });
    expect((await consume(first.slice(1))).retryMessages).toEqual([]);
  });

  it("rejects corrupt or noncanonical bytes already present in staging", async () => {
    const corruptWorkspaceId = "00000000-0000-8000-8000-000000000845";
    const deltas = Array.from({ length: 101 }, (_, index) => ({
      punkId: `corrupt_${index}`,
      present: true,
      role: index === 0 ? ("owner" as const) : ("member" as const),
    }));
    const corrupt = await workspaceV2Projection(corruptWorkspaceId, 1, deltas);
    const corruptFirst = corrupt[0];
    if (corruptFirst === undefined) {
      throw new Error("Fixture requires a first chunk");
    }
    expect((await consume([corruptFirst])).retryMessages).toEqual([]);
    const corruptDatabase = projectionDatabase(testEnv, corruptWorkspaceId);
    await corruptDatabase
      .prepare(
        `UPDATE membership_delta_chunk SET chunk_json = '[]'
         WHERE aggregate_id = ? AND cursor = 1 AND chunk_index = 0`,
      )
      .bind(corruptWorkspaceId)
      .run();
    expect((await consume([corruptFirst])).retryMessages).toHaveLength(1);
    expect(
      await corruptDatabase
        .prepare(
          "SELECT workspace_id FROM workspace_projection WHERE workspace_id = ?",
        )
        .bind(corruptWorkspaceId)
        .first(),
    ).toBeNull();

    const noncanonicalWorkspaceId = "00000000-0000-8000-8000-000000000846";
    const noncanonical = await workspaceV2Projection(
      noncanonicalWorkspaceId,
      1,
      deltas,
    );
    const noncanonicalFirst = noncanonical[0];
    const noncanonicalSecond = noncanonical[1];
    if (noncanonicalFirst === undefined || noncanonicalSecond === undefined) {
      throw new Error("Fixture requires two chunks");
    }
    expect((await consume([noncanonicalFirst])).retryMessages).toEqual([]);
    const noncanonicalDatabase = projectionDatabase(
      testEnv,
      noncanonicalWorkspaceId,
    );
    await noncanonicalDatabase
      .prepare(
        `UPDATE membership_delta_batch SET event_json = ?
         WHERE aggregate_id = ? AND cursor = 1`,
      )
      .bind(JSON.stringify(noncanonicalFirst.event), noncanonicalWorkspaceId)
      .run();
    expect((await consume([noncanonicalSecond])).retryMessages).toHaveLength(1);
    expect(
      await noncanonicalDatabase
        .prepare(
          "SELECT workspace_id FROM workspace_projection WHERE workspace_id = ?",
        )
        .bind(noncanonicalWorkspaceId)
        .first(),
    ).toBeNull();
  });

  it("fails closed on v2 signature, canonicality, tag, coordinate, and digest corruption", async () => {
    const cases: {
      name: string;
      message: WorkspaceProjectionMessageV2;
    }[] = [];

    const signatureBase = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000851")
    )[0];
    if (signatureBase === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    const badSignature = structuredClone(signatureBase);
    badSignature.event.sig = `${badSignature.event.sig[0] === "0" ? "1" : "0"}${badSignature.event.sig.slice(1)}`;
    cases.push({ name: "signature", message: badSignature });

    const canonicalBase = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000852")
    )[0];
    if (canonicalBase === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    const noncanonical = structuredClone(canonicalBase);
    const canonicalContent = JSON.parse(
      noncanonical.event.content,
    ) as WorkspaceEventContentV2;
    noncanonical.event.content = JSON.stringify({
      workspace: canonicalContent.workspace,
      transition: canonicalContent.transition,
      schemaVersion: canonicalContent.schemaVersion,
      membershipCommitment: canonicalContent.membershipCommitment,
    });
    cases.push({
      name: "canonicality",
      message: await signProjectionEnvelope(noncanonical),
    });

    const tagBase = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000853")
    )[0];
    if (tagBase === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    const wrongTag = structuredClone(tagBase);
    wrongTag.event.tags = wrongTag.event.tags.map((tag) =>
      tag[0] === "delta"
        ? ["delta", "sha256", "b".repeat(64), tag[3] ?? "", tag[4] ?? ""]
        : tag,
    );
    cases.push({
      name: "delta-tag",
      message: await signProjectionEnvelope(wrongTag),
    });

    const coordinateBase = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000854")
    )[0];
    if (coordinateBase === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    cases.push({
      name: "coordinate",
      message: { ...coordinateBase, cursor: 2 },
    });

    const chunkBase = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000855")
    )[0];
    if (chunkBase === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    cases.push({
      name: "chunk-digest",
      message: { ...chunkBase, chunkDigest: "b".repeat(64) },
    });

    const globalBase = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000856")
    )[0];
    if (globalBase === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    const wrongGlobal = structuredClone(globalBase);
    const globalContent = JSON.parse(
      wrongGlobal.event.content,
    ) as WorkspaceEventContentV2;
    globalContent.membershipCommitment.deltaDigest = "b".repeat(64);
    wrongGlobal.event.tags = wrongGlobal.event.tags.map((tag) =>
      tag[0] === "delta"
        ? ["delta", "sha256", "b".repeat(64), tag[3] ?? "", tag[4] ?? ""]
        : tag,
    );
    wrongGlobal.event.content = canonicalJson(globalContent);
    cases.push({
      name: "global-digest",
      message: await signProjectionEnvelope(wrongGlobal),
    });

    const duplicate = (
      await workspaceV2Projection("00000000-0000-8000-8000-000000000857", 1, [
        { punkId: "duplicate", present: true, role: "owner" },
        { punkId: "duplicate", present: true, role: "member" },
      ])
    )[0];
    if (duplicate === undefined) {
      throw new Error("Fixture requires one chunk");
    }
    cases.push({ name: "duplicate-coordinate", message: duplicate });

    for (const corruption of cases) {
      const result = await consume([corruption.message]);
      expect(result.retryMessages, corruption.name).toHaveLength(1);
      expect(result.explicitAcks, corruption.name).toEqual([]);
      expect(
        await projectionDatabase(testEnv, corruption.message.workspaceId)
          .prepare(
            `SELECT workspace_id FROM workspace_projection
             WHERE workspace_id = ?`,
          )
          .bind(corruption.message.workspaceId)
          .first(),
        corruption.name,
      ).toBeNull();
    }
  });

  it("cleans expired incomplete staging in bounded batches", async () => {
    const projectedWorkspaceId = "00000000-0000-8000-8000-000000000861";
    const database = projectionDatabase(testEnv, projectedWorkspaceId);
    const expired = Array.from({ length: 101 }, (_, index) => ({
      aggregateId: `expired-${index}`,
      eventId: index.toString(16).padStart(64, "0"),
    }));
    await database
      .prepare(
        `INSERT INTO membership_delta_batch
          (projection_type, aggregate_id, cursor, workspace_id,
           conversation_id, event_id, event_json, delta_digest, delta_count,
           chunk_count, expires_at, created_at)
         SELECT 'workspace',
                json_extract(item.value, '$.aggregateId'),
                1,
                json_extract(item.value, '$.aggregateId'),
                NULL,
                json_extract(item.value, '$.eventId'),
                '{}', ?, 0, 1, ?, ?
         FROM json_each(?) AS item`,
      )
      .bind(
        "a".repeat(64),
        "2000-01-01T00:00:00.000Z",
        "1999-01-01T00:00:00.000Z",
        JSON.stringify(expired),
      )
      .run();

    const message = await workspaceV2Projection(projectedWorkspaceId);
    expect((await consume(message)).retryMessages).toEqual([]);
    expect(
      await database
        .prepare(
          `SELECT COUNT(*) AS count FROM membership_delta_batch
           WHERE expires_at <= '2000-01-01T00:00:00.000Z'`,
        )
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });

    expect((await consume(message)).retryMessages).toEqual([]);
    expect(
      await database
        .prepare(
          `SELECT COUNT(*) AS count FROM membership_delta_batch
           WHERE expires_at <= '2000-01-01T00:00:00.000Z'`,
        )
        .first<{ count: number }>(),
    ).toEqual({ count: 0 });
  });
});

describe("membership delta projection migration", () => {
  it("adds tombstones, aggregate cursors, and bounded staging tables", async () => {
    const workspaceMembers = await testEnv.PROJECTION_DB_0.prepare(
      "PRAGMA table_info(workspace_member_projection)",
    ).all<{ name: string }>();
    const workspace = await testEnv.PROJECTION_DB_0.prepare(
      "PRAGMA table_info(workspace_projection)",
    ).all<{ name: string }>();
    const staging = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name LIKE 'membership_delta_%'
       ORDER BY name`,
    ).all<{ name: string }>();

    expect(workspaceMembers.results.map(({ name }) => name)).toContain(
      "present",
    );
    expect(workspace.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["member_count", "roster_floor_cursor"]),
    );
    expect(staging.results).toEqual([
      { name: "membership_delta_batch" },
      { name: "membership_delta_chunk" },
    ]);
  });
});
