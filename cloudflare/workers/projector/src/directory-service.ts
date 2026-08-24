import { WorkerEntrypoint } from "cloudflare:workers";

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

function shardBindings(env: ProjectionShardEnv): readonly D1Database[] {
  return [
    env.PROJECTION_DB_0,
    env.PROJECTION_DB_1,
    env.PROJECTION_DB_2,
    env.PROJECTION_DB_3,
  ];
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
}
