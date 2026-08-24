import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  listConversationCandidates,
  listWorkspaceCandidates,
} from "../src/directory-service";
import { projectionDatabase } from "../src/shards";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const punkId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const otherWorkspaceId = "55555555-5555-4555-8555-555555555555";
const secondWorkspaceId = "99999999-9999-4999-8999-999999999999";
const database = projectionDatabase(testEnv, workspaceId);

async function insertWorkspace(
  id: string,
  slug: string,
  status: "active" | "deleting" = "active",
): Promise<void> {
  const target = projectionDatabase(testEnv, id);
  await target
    .prepare(
      `INSERT INTO workspace_projection
       (workspace_id, slug, name, visibility, status, owner_punk_id,
        revision, last_cursor, created_at, updated_at, member_count,
        roster_floor_cursor)
       VALUES (?, ?, ?, 'private', ?, ?, 1, 1, ?, ?, 1, 1)`,
    )
    .bind(
      id,
      slug,
      slug === "alpha" ? "Alpha" : "Hidden",
      status,
      punkId,
      "2026-08-22T10:00:00.000Z",
      "2026-08-22T10:00:00.000Z",
    )
    .run();
  await target
    .prepare(
      `INSERT INTO workspace_member_projection
       (workspace_id, punk_id, role, last_cursor, updated_at, present)
       VALUES (?, ?, 'member', 1, ?, ?)`,
    )
    .bind(id, punkId, "2026-08-22T10:00:00.000Z", status === "active" ? 1 : 0)
    .run();
}

async function insertConversation(input: {
  id: string;
  name: string;
  type?: "stream" | "forum";
  visibility?: "open" | "private";
  status?: "active" | "archived";
  member?: boolean;
}): Promise<void> {
  await database
    .prepare(
      `INSERT INTO conversation_projection
       (conversation_id, workspace_id, name, conversation_type, visibility,
        description, topic, purpose, topic_required, max_members, ttl_seconds,
        status, owner_punk_id, revision, last_cursor, created_at, updated_at,
        archived_at, ttl_deadline, member_count, roster_floor_cursor)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 0, NULL, NULL, ?, ?, 1, 1,
        ?, ?, NULL, NULL, ?, 1)`,
    )
    .bind(
      input.id,
      workspaceId,
      input.name,
      input.type ?? "stream",
      input.visibility ?? "open",
      input.status ?? "active",
      punkId,
      "2026-08-22T10:00:00.000Z",
      "2026-08-22T10:00:00.000Z",
      input.member === true ? 1 : 0,
    )
    .run();
  if (input.member === true) {
    await database
      .prepare(
        `INSERT INTO conversation_member_projection
         (workspace_id, conversation_id, punk_id, access, joined_at,
          invited_by_punk_id, last_cursor, updated_at, present)
         VALUES (?, ?, ?, 'member', ?, NULL, 1, ?, 1)`,
      )
      .bind(
        workspaceId,
        input.id,
        punkId,
        "2026-08-22T10:00:00.000Z",
        "2026-08-22T10:00:00.000Z",
      )
      .run();
  }
}

beforeAll(async () => {
  await Promise.all(
    [
      testEnv.PROJECTION_DB_0,
      testEnv.PROJECTION_DB_1,
      testEnv.PROJECTION_DB_2,
      testEnv.PROJECTION_DB_3,
    ].map((binding) => applyD1Migrations(binding, testEnv.TEST_MIGRATIONS)),
  );
  await insertWorkspace(workspaceId, "alpha");
  await insertWorkspace(otherWorkspaceId, "hidden", "deleting");
  await insertWorkspace(secondWorkspaceId, "second");

  await insertConversation({
    id: "33333333-3333-4333-8333-333333333333",
    name: "general",
  });
  await insertConversation({
    id: "44444444-4444-4444-8444-444444444444",
    name: "private-member",
    visibility: "private",
    member: true,
  });
  await insertConversation({
    id: "66666666-6666-4666-8666-666666666666",
    name: "private-hidden",
    visibility: "private",
  });
  await insertConversation({
    id: "77777777-7777-4777-8777-777777777777",
    name: "forum",
    type: "forum",
    member: true,
  });
  await insertConversation({
    id: "88888888-8888-4888-8888-888888888888",
    name: "archived",
    status: "archived",
    member: true,
  });
});

describe("ProjectionDirectoryService candidates", () => {
  it("finds only present memberships in active Workspaces across all shards", async () => {
    await expect(
      listWorkspaceCandidates(testEnv, { punkId, limit: 50 }),
    ).resolves.toEqual([
      {
        workspaceId,
        slug: "alpha",
        name: "Alpha",
        visibility: "private",
        role: "member",
        revision: 1,
      },
      {
        workspaceId: secondWorkspaceId,
        slug: "second",
        name: "Hidden",
        visibility: "private",
        role: "member",
        revision: 1,
      },
    ]);
  });

  it("continues after a stable opaque-cursor position", async () => {
    await expect(
      listWorkspaceCandidates(testEnv, {
        punkId,
        limit: 1,
        afterId: workspaceId,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ workspaceId: secondWorkspaceId }),
    ]);
    await expect(
      listConversationCandidates(testEnv, {
        workspaceId,
        punkId,
        limit: 1,
        afterId: "33333333-3333-4333-8333-333333333333",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: "44444444-4444-4444-8444-444444444444",
      }),
    ]);
  });

  it("finds active Streams and hides private candidates without access", async () => {
    await expect(
      listConversationCandidates(testEnv, { workspaceId, punkId, limit: 50 }),
    ).resolves.toEqual([
      expect.objectContaining({ name: "general", visibility: "open" }),
      expect.objectContaining({
        name: "private-member",
        visibility: "private",
      }),
    ]);
  });

  it("fails closed for malformed or unbounded candidate requests", async () => {
    await expect(
      listWorkspaceCandidates(testEnv, { punkId: "", limit: 50 }),
    ).resolves.toEqual([]);
    await expect(
      listWorkspaceCandidates(testEnv, {
        punkId,
        limit: 50,
        afterId: "forged",
      }),
    ).resolves.toEqual([]);
    await expect(
      listConversationCandidates(testEnv, {
        workspaceId,
        punkId,
        limit: 102,
      }),
    ).resolves.toEqual([]);
  });
});
