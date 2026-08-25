import { WorkerEntrypoint } from "cloudflare:workers";
import {
  canonicalPunkAvatarUrl,
  canonicalPunkDisplayName,
  canonicalPunkSearchKey,
  canonicalPunkSearchPrefix,
} from "@punks/core";

import type { ProjectionShardEnv } from "./shards";
import { projectionDatabase } from "./shards";

const OPAQUE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ProjectionDirectoryEnv extends ProjectionShardEnv {
  ENVIRONMENT: string;
}

export interface WorkspaceCandidate {
  workspaceId: string;
  slug: string;
  name: string;
  visibility: "private" | "punks" | "public";
  role: "owner" | "moderator" | "member" | "guest";
  revision: number;
}

export interface ConversationCandidate {
  id: string;
  workspaceId: string;
  name: string;
  type: "stream";
  visibility: "open" | "private";
  description: string | null;
  topic: string | null;
  purpose: string | null;
  topicRequired: boolean;
  ttlSeconds: number | null;
  ttlDeadline: string | null;
  revision: number;
  cursor: number;
  updatedAt: string;
}

/** Eventual candidate only; API callers must reauthorize the summary. */
export interface PunkProfileCandidate {
  punkId: string;
  displayName: string;
  avatarUrl: string | null;
  revision: number;
}

interface PunkProfileProjection extends PunkProfileCandidate {
  updatedAt: string;
}

interface WorkspaceCandidateRow {
  workspace_id: string;
  slug: string;
  name: string;
  visibility: WorkspaceCandidate["visibility"];
  role: WorkspaceCandidate["role"];
  revision: number;
}

interface ConversationCandidateRow {
  conversation_id: string;
  workspace_id: string;
  name: string;
  visibility: ConversationCandidate["visibility"];
  description: string | null;
  topic: string | null;
  purpose: string | null;
  topic_required: number;
  ttl_seconds: number | null;
  ttl_deadline: string | null;
  revision: number;
  last_cursor: number;
  updated_at: string;
}

interface PunkProfileRow {
  punk_id: string;
  display_name: string;
  search_key: string;
  avatar_url: string | null;
  revision: number;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validLimit(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 101;
}

function validAfterId(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && OPAQUE_UUID.test(value))
  );
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function punkProfileProjection(value: unknown): PunkProfileProjection | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "avatarUrl",
      "displayName",
      "punkId",
      "revision",
      "updatedAt",
    ]) ||
    typeof value.punkId !== "string" ||
    !OPAQUE_UUID.test(value.punkId) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 1 ||
    Number(value.revision) > 2_147_483_647 ||
    !canonicalTimestamp(value.updatedAt)
  ) {
    return null;
  }
  try {
    const displayName = canonicalPunkDisplayName(value.displayName);
    const avatarUrl = canonicalPunkAvatarUrl(value.avatarUrl);
    if (displayName !== value.displayName || avatarUrl !== value.avatarUrl) {
      return null;
    }
    return {
      punkId: value.punkId,
      displayName,
      avatarUrl,
      revision: Number(value.revision),
      updatedAt: value.updatedAt,
    };
  } catch {
    return null;
  }
}

function shardBindings(env: ProjectionShardEnv): readonly D1Database[] {
  return [
    env.PROJECTION_DB_0,
    env.PROJECTION_DB_1,
    env.PROJECTION_DB_2,
    env.PROJECTION_DB_3,
  ];
}

/** Replicates the eventual profile candidate to every fixed D1 shard. */
export async function upsertPunkProfile(
  env: ProjectionShardEnv,
  input: unknown,
): Promise<boolean> {
  const profile = punkProfileProjection(input);
  if (profile === null) return false;
  const databases = shardBindings(env);
  const current = await Promise.all(
    databases.map(async (database) => {
      const row = await database
        .prepare(
          `SELECT punk_id, display_name, search_key, avatar_url, revision,
                  updated_at
           FROM punk_profile_projection WHERE punk_id = ?`,
        )
        .bind(profile.punkId)
        .first<PunkProfileRow>();
      return row;
    }),
  );
  const searchKey = canonicalPunkSearchKey(profile.displayName);
  if (
    current.some(
      (row) =>
        row !== null &&
        row.revision === profile.revision &&
        (row.display_name !== profile.displayName ||
          row.search_key !== searchKey ||
          row.avatar_url !== profile.avatarUrl ||
          row.updated_at !== profile.updatedAt),
    )
  ) {
    return false;
  }
  await Promise.all(
    databases.map(async (database, index) => {
      const row = current[index] ?? null;
      if (row !== null && row.revision >= profile.revision) return;
      await database
        .prepare(
          `INSERT INTO punk_profile_projection
             (punk_id, display_name, search_key, avatar_url, revision, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(punk_id) DO UPDATE SET
             display_name = excluded.display_name,
             search_key = excluded.search_key,
             avatar_url = excluded.avatar_url,
             revision = excluded.revision,
             updated_at = excluded.updated_at
           WHERE excluded.revision > punk_profile_projection.revision`,
        )
        .bind(
          profile.punkId,
          profile.displayName,
          searchKey,
          profile.avatarUrl,
          profile.revision,
          profile.updatedAt,
        )
        .run();
    }),
  );
  return true;
}

/**
 * Returns bounded eventual candidates already joined to a present membership.
 * The caller still has to reauthorize each Account and Workspace coordinate.
 */
export async function searchPunkCandidates(
  env: ProjectionShardEnv,
  input: unknown,
): Promise<PunkProfileCandidate[]> {
  if (
    !isRecord(input) ||
    !exactKeys(
      input,
      input.afterPunkId === undefined
        ? ["limit", "prefix", "workspaceId"]
        : ["afterPunkId", "limit", "prefix", "workspaceId"],
    ) ||
    typeof input.workspaceId !== "string" ||
    !OPAQUE_UUID.test(input.workspaceId) ||
    typeof input.prefix !== "string" ||
    !validLimit(input.limit) ||
    !validAfterId(input.afterPunkId)
  ) {
    return [];
  }
  let prefix: string;
  try {
    prefix = canonicalPunkSearchPrefix(input.prefix);
  } catch {
    return [];
  }
  if (prefix !== input.prefix) return [];
  const afterPunkId = input.afterPunkId ?? null;
  const result = await projectionDatabase(env, input.workspaceId)
    .prepare(
      `SELECT profile.punk_id, profile.display_name, profile.search_key,
              profile.avatar_url, profile.revision, profile.updated_at
       FROM punk_profile_projection AS profile
       JOIN workspace_member_projection AS member
         ON member.punk_id = profile.punk_id
        AND member.workspace_id = ?
        AND member.present = 1
       WHERE profile.search_key >= ?
         AND profile.search_key < ?
         AND (? IS NULL OR profile.punk_id > ?)
       ORDER BY profile.punk_id
       LIMIT ?`,
    )
    .bind(
      input.workspaceId,
      prefix,
      `${prefix}\u{10ffff}`,
      afterPunkId,
      afterPunkId,
      input.limit,
    )
    .all<PunkProfileRow>();
  return result.results.map((row) => ({
    punkId: row.punk_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    revision: row.revision,
  }));
}

/**
 * Returns eventual candidates only. Every caller must reauthorize each result
 * against its authoritative Workspace Durable Object before disclosure.
 */
export async function listWorkspaceCandidates(
  env: ProjectionShardEnv,
  input: unknown,
): Promise<WorkspaceCandidate[]> {
  if (
    !isRecord(input) ||
    typeof input.punkId !== "string" ||
    !OPAQUE_UUID.test(input.punkId) ||
    !validLimit(input.limit) ||
    !validAfterId(input.afterId)
  ) {
    return [];
  }
  const punkId = input.punkId;
  const limit = input.limit;
  const afterId = input.afterId ?? null;
  const pages = await Promise.all(
    shardBindings(env).map((database) =>
      database
        .prepare(
          `SELECT workspace.workspace_id, workspace.slug, workspace.name,
                  workspace.visibility, member.role, workspace.revision
           FROM workspace_member_projection AS member
           JOIN workspace_projection AS workspace
             ON workspace.workspace_id = member.workspace_id
           WHERE member.punk_id = ?
             AND member.present = 1
             AND workspace.status = 'active'
             AND (? IS NULL OR workspace.workspace_id > ?)
           ORDER BY workspace.workspace_id
           LIMIT ?`,
        )
        .bind(punkId, afterId, afterId, limit)
        .all<WorkspaceCandidateRow>(),
    ),
  );
  return pages
    .flatMap(({ results }) => results)
    .map((row) => ({
      workspaceId: row.workspace_id,
      slug: row.slug,
      name: row.name,
      visibility: row.visibility,
      role: row.role,
      revision: row.revision,
    }))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
    .slice(0, limit);
}

/**
 * Returns eventual Stream candidates only. The API must reauthorize both the
 * Workspace and every Conversation Durable Object before returning a view.
 */
export async function listConversationCandidates(
  env: ProjectionShardEnv,
  input: unknown,
): Promise<ConversationCandidate[]> {
  if (
    !isRecord(input) ||
    typeof input.workspaceId !== "string" ||
    !OPAQUE_UUID.test(input.workspaceId) ||
    typeof input.punkId !== "string" ||
    !OPAQUE_UUID.test(input.punkId) ||
    !validLimit(input.limit) ||
    !validAfterId(input.afterId)
  ) {
    return [];
  }
  const workspaceId = input.workspaceId;
  const punkId = input.punkId;
  const limit = input.limit;
  const afterId = input.afterId ?? null;
  const result = await projectionDatabase(env, workspaceId)
    .prepare(
      `SELECT conversation.conversation_id, conversation.workspace_id,
              conversation.name, conversation.visibility,
              conversation.description, conversation.topic,
              conversation.purpose, conversation.topic_required,
              conversation.ttl_seconds, conversation.ttl_deadline,
              conversation.revision, conversation.last_cursor,
              conversation.updated_at
       FROM conversation_projection AS conversation
       WHERE conversation.workspace_id = ?
         AND conversation.conversation_type = 'stream'
         AND conversation.status = 'active'
         AND (? IS NULL OR conversation.conversation_id > ?)
         AND (
           conversation.visibility = 'open'
           OR EXISTS (
             SELECT 1
             FROM conversation_member_projection AS member
             WHERE member.workspace_id = conversation.workspace_id
               AND member.conversation_id = conversation.conversation_id
               AND member.punk_id = ?
               AND member.present = 1
           )
         )
       ORDER BY conversation.conversation_id
       LIMIT ?`,
    )
    .bind(workspaceId, afterId, afterId, punkId, limit)
    .all<ConversationCandidateRow>();
  return result.results.map((row) => ({
    id: row.conversation_id,
    workspaceId: row.workspace_id,
    name: row.name,
    type: "stream",
    visibility: row.visibility,
    description: row.description,
    topic: row.topic,
    purpose: row.purpose,
    topicRequired: row.topic_required === 1,
    ttlSeconds: row.ttl_seconds,
    ttlDeadline: row.ttl_deadline,
    revision: row.revision,
    cursor: row.last_cursor,
    updatedAt: row.updated_at,
  }));
}

/** Private RPC entrypoint for the authoritative API Worker. */
export class ProjectionDirectoryService extends WorkerEntrypoint<ProjectionDirectoryEnv> {
  override fetch(): Response {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  listWorkspaceCandidates(input: unknown): Promise<WorkspaceCandidate[]> {
    return listWorkspaceCandidates(this.env, input);
  }

  listConversationCandidates(input: unknown): Promise<ConversationCandidate[]> {
    return listConversationCandidates(this.env, input);
  }

  upsertPunkProfile(input: unknown): Promise<boolean> {
    return upsertPunkProfile(this.env, input);
  }

  searchPunkCandidates(input: unknown): Promise<PunkProfileCandidate[]> {
    return searchPunkCandidates(this.env, input);
  }
}
