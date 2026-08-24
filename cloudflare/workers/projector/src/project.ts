import type {
  ConversationProjectionMessage,
  WorkspaceProjectionMessage,
} from "@punks/contracts";

function hasSingleTag(
  message: WorkspaceProjectionMessage,
  name: string,
  expectedValue: string,
): boolean {
  const tags = message.event.tags.filter(([tagName]) => tagName === name);
  return tags.length === 1 && tags[0]?.[1] === expectedValue;
}

export function isConsistentWorkspaceProjection(
  message: WorkspaceProjectionMessage,
): boolean {
  const expectedContract =
    message.event.kind === 50000
      ? "workspace.create@1"
      : message.event.kind === 50001
        ? "workspace.rename@1"
        : message.event.kind === 50003
          ? "workspace.member-set-role@1"
          : message.event.kind === 50004
            ? "workspace.member-remove@1"
            : null;
  if (
    expectedContract === null ||
    message.workspaceId !== message.state.id ||
    message.cursor !== message.state.cursor ||
    !hasSingleTag(message, "workspace", message.workspaceId) ||
    !hasSingleTag(message, "cursor", String(message.cursor)) ||
    !hasSingleTag(message, "contract", expectedContract)
  ) {
    return false;
  }

  try {
    const content = JSON.parse(message.event.content) as unknown;
    if (
      typeof content !== "object" ||
      content === null ||
      !("workspace" in content)
    ) {
      return false;
    }
    const workspace = Reflect.get(content, "workspace") as unknown;
    return (
      typeof workspace === "object" &&
      workspace !== null &&
      Reflect.get(workspace, "id") === message.state.id &&
      Reflect.get(workspace, "slug") === message.state.slug &&
      Reflect.get(workspace, "cursor") === message.state.cursor &&
      Reflect.get(workspace, "revision") === message.state.revision
    );
  } catch {
    return false;
  }
}

export async function projectWorkspace(
  database: D1Database,
  message: WorkspaceProjectionMessage,
  projectedAt = new Date(),
): Promise<void> {
  const state = message.state;
  await database.batch([
    database
      .prepare(
        `INSERT INTO workspace_event_projection
          (event_id, workspace_id, cursor, event_json, projected_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO NOTHING`,
      )
      .bind(
        message.event.id,
        message.workspaceId,
        message.cursor,
        JSON.stringify(message.event),
        projectedAt.toISOString(),
      ),
    database
      .prepare(
        `INSERT INTO workspace_projection
          (workspace_id, slug, name, visibility, status, owner_punk_id,
           revision, last_cursor, created_at, updated_at, member_count,
           roster_floor_cursor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(workspace_id) DO UPDATE SET
           slug = excluded.slug,
           name = excluded.name,
           visibility = excluded.visibility,
           status = excluded.status,
           owner_punk_id = excluded.owner_punk_id,
           revision = excluded.revision,
           last_cursor = excluded.last_cursor,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           member_count = excluded.member_count
         WHERE excluded.last_cursor > workspace_projection.last_cursor`,
      )
      .bind(
        state.id,
        state.slug,
        state.name,
        state.visibility,
        state.status,
        state.ownerPunkId,
        state.revision,
        message.cursor,
        state.createdAt,
        state.updatedAt,
        state.members.length,
      ),
    database
      .prepare(
        `UPDATE workspace_member_projection
         SET present = 0,
             last_cursor = ?,
             updated_at = ?
         WHERE workspace_id = ?
           AND last_cursor < ?
           AND NOT EXISTS (
             SELECT 1 FROM json_each(?) AS member
             WHERE json_extract(member.value, '$.punkId') =
                   workspace_member_projection.punk_id
           )
           AND ? > (
             SELECT roster_floor_cursor FROM workspace_projection
             WHERE workspace_id = ?
           )`,
      )
      .bind(
        message.cursor,
        projectedAt.toISOString(),
        message.workspaceId,
        message.cursor,
        JSON.stringify(state.members),
        message.cursor,
        message.workspaceId,
      ),
    database
      .prepare(
        `INSERT INTO workspace_member_projection
          (workspace_id, punk_id, role, last_cursor, updated_at, present)
         SELECT ?,
                json_extract(member.value, '$.punkId'),
                json_extract(member.value, '$.role'),
                ?,
                ?,
                1
         FROM json_each(?) AS member
         WHERE ? > (
           SELECT roster_floor_cursor FROM workspace_projection
           WHERE workspace_id = ?
         )
         ON CONFLICT(workspace_id, punk_id) DO UPDATE SET
           role = excluded.role,
           last_cursor = excluded.last_cursor,
           updated_at = excluded.updated_at,
           present = 1
         WHERE excluded.last_cursor > workspace_member_projection.last_cursor`,
      )
      .bind(
        message.workspaceId,
        message.cursor,
        projectedAt.toISOString(),
        JSON.stringify(state.members),
        message.cursor,
        message.workspaceId,
      ),
    database
      .prepare(
        `UPDATE workspace_projection
         SET roster_floor_cursor = ?
         WHERE workspace_id = ? AND roster_floor_cursor < ?`,
      )
      .bind(message.cursor, message.workspaceId, message.cursor),
  ]);
}

function hasSingleConversationTag(
  message: ConversationProjectionMessage,
  name: string,
  expectedValue: string,
): boolean {
  const tags = message.event.tags.filter(([tagName]) => tagName === name);
  return tags.length === 1 && tags[0]?.[1] === expectedValue;
}

export function isConsistentConversationProjection(
  message: ConversationProjectionMessage,
): boolean {
  const expectedContract =
    message.event.kind === 50100
      ? "conversation.create@1"
      : message.event.kind === 50101
        ? "conversation.join@1"
        : message.event.kind === 50102
          ? "conversation.member-set-access@1"
          : message.event.kind === 50103
            ? "conversation.member-remove@1"
            : message.event.kind === 50105
              ? "conversation.update@1"
              : message.event.kind === 50106
                ? "conversation.archive@1"
                : message.event.kind === 50107
                  ? "conversation.restore@1"
                  : null;
  if (
    expectedContract === null ||
    message.workspaceId !== message.state.workspaceId ||
    message.conversationId !== message.state.id ||
    message.cursor !== message.state.cursor ||
    !hasSingleConversationTag(message, "workspace", message.workspaceId) ||
    !hasSingleConversationTag(
      message,
      "conversation",
      message.conversationId,
    ) ||
    !hasSingleConversationTag(message, "cursor", String(message.cursor)) ||
    !hasSingleConversationTag(message, "contract", expectedContract)
  ) {
    return false;
  }

  try {
    const content = JSON.parse(message.event.content) as unknown;
    if (
      typeof content !== "object" ||
      content === null ||
      !("conversation" in content)
    ) {
      return false;
    }
    const state = Reflect.get(content, "conversation") as unknown;
    return (
      typeof state === "object" &&
      state !== null &&
      Reflect.get(state, "id") === message.state.id &&
      Reflect.get(state, "workspaceId") === message.state.workspaceId &&
      Reflect.get(state, "cursor") === message.state.cursor &&
      Reflect.get(state, "revision") === message.state.revision
    );
  } catch {
    return false;
  }
}

export async function projectConversation(
  database: D1Database,
  message: ConversationProjectionMessage,
  projectedAt = new Date(),
): Promise<void> {
  const state = message.state;
  await database.batch([
    database
      .prepare(
        `INSERT INTO conversation_event_projection
          (event_id, workspace_id, conversation_id, cursor, event_json, projected_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO NOTHING`,
      )
      .bind(
        message.event.id,
        message.workspaceId,
        message.conversationId,
        message.cursor,
        JSON.stringify(message.event),
        projectedAt.toISOString(),
      ),
    database
      .prepare(
        `INSERT INTO conversation_projection
          (conversation_id, workspace_id, name, conversation_type, visibility,
           description, topic, purpose, topic_required, max_members, ttl_seconds,
           ttl_deadline,
           status, owner_punk_id, revision, last_cursor, created_at, updated_at,
           archived_at, member_count, roster_floor_cursor)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT(conversation_id) DO UPDATE SET
           name = excluded.name,
           conversation_type = excluded.conversation_type,
           visibility = excluded.visibility,
           description = excluded.description,
           topic = excluded.topic,
           purpose = excluded.purpose,
           topic_required = excluded.topic_required,
           max_members = excluded.max_members,
           ttl_seconds = excluded.ttl_seconds,
           ttl_deadline = excluded.ttl_deadline,
           status = excluded.status,
           owner_punk_id = excluded.owner_punk_id,
           revision = excluded.revision,
           last_cursor = excluded.last_cursor,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           archived_at = excluded.archived_at,
           member_count = excluded.member_count
         WHERE excluded.workspace_id = conversation_projection.workspace_id
           AND excluded.last_cursor > conversation_projection.last_cursor`,
      )
      .bind(
        state.id,
        state.workspaceId,
        state.name,
        state.type,
        state.visibility,
        state.description,
        state.topic,
        state.purpose,
        state.topicRequired ? 1 : 0,
        state.maxMembers,
        state.ttlSeconds,
        state.ttlDeadline,
        state.status,
        state.ownerPunkId,
        state.revision,
        message.cursor,
        state.createdAt,
        state.updatedAt,
        state.archivedAt,
        state.members.length,
      ),
    database
      .prepare(
        `UPDATE conversation_member_projection
         SET present = 0,
             last_cursor = ?,
             updated_at = ?
         WHERE conversation_id = ? AND workspace_id = ?
           AND last_cursor < ?
           AND NOT EXISTS (
             SELECT 1 FROM json_each(?) AS member
             WHERE json_extract(member.value, '$.punkId') =
                   conversation_member_projection.punk_id
           )
           AND ? > (
             SELECT roster_floor_cursor FROM conversation_projection
             WHERE conversation_id = ? AND workspace_id = ?
           )`,
      )
      .bind(
        message.cursor,
        projectedAt.toISOString(),
        message.conversationId,
        message.workspaceId,
        message.cursor,
        JSON.stringify(state.members),
        message.cursor,
        message.conversationId,
        message.workspaceId,
      ),
    database
      .prepare(
        `INSERT INTO conversation_member_projection
          (workspace_id, conversation_id, punk_id, access, joined_at,
           invited_by_punk_id, last_cursor, updated_at, present)
         SELECT ?, ?,
                json_extract(member.value, '$.punkId'),
                json_extract(member.value, '$.access'),
                json_extract(member.value, '$.joinedAt'),
                json_extract(member.value, '$.invitedByPunkId'),
                ?, ?, 1
         FROM json_each(?) AS member
         WHERE ? > (
           SELECT roster_floor_cursor FROM conversation_projection
           WHERE conversation_id = ? AND workspace_id = ?
         )
         ON CONFLICT(conversation_id, punk_id) DO UPDATE SET
           access = excluded.access,
           joined_at = excluded.joined_at,
           invited_by_punk_id = excluded.invited_by_punk_id,
           last_cursor = excluded.last_cursor,
           updated_at = excluded.updated_at,
           present = 1
         WHERE excluded.workspace_id = conversation_member_projection.workspace_id
           AND excluded.last_cursor > conversation_member_projection.last_cursor`,
      )
      .bind(
        message.workspaceId,
        message.conversationId,
        message.cursor,
        projectedAt.toISOString(),
        JSON.stringify(state.members),
        message.cursor,
        message.conversationId,
        message.workspaceId,
      ),
    database
      .prepare(
        `UPDATE conversation_projection
         SET roster_floor_cursor = ?
         WHERE conversation_id = ? AND workspace_id = ?
           AND roster_floor_cursor < ?`,
      )
      .bind(
        message.cursor,
        message.conversationId,
        message.workspaceId,
        message.cursor,
      ),
  ]);
}
