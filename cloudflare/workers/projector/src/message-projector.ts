import { messageReactionLifecycleStatements } from "./message-reaction-projector";

export interface ProjectedMessageContentVersion {
  version: number;
  contentCommitment: string;
  ciphertextRef: string;
  contentKeyId: string;
  topicPresent: boolean;
  createdAt: string;
}

export type ProjectedMessageActor =
  | { kind: "punk"; punkId: string }
  | { kind: "bot"; installationId: string };

export interface ProjectedMessageRetraction {
  kind: "author" | "moderation";
  requestedAt: string;
  eraseAfter: string;
  reasonCode?: string | null;
}

export interface ProjectedMessageErasureMarker {
  erasedAt: string;
  retractedAt: string;
  retractionKind: "author" | "moderation";
  destroyedVersionCount: number;
}

export interface ProjectedMessageState {
  id: string;
  workspaceId: string;
  conversationId: string;
  author: ProjectedMessageActor;
  messageType: "stream-message" | "forum-post" | "forum-comment";
  status: "active" | "retracted" | "erased";
  mentionedPunkIds: readonly string[];
  mediaIds: readonly string[];
  parentMessageId: string | null;
  threadRootMessageId: string;
  threadDepth: number;
  broadcast: boolean;
  replyCount: number;
  descendantCount: number;
  lastReplyAt: string | null;
  topicPresent: boolean;
  originalContentCommitment: string | null;
  currentVersion: number | null;
  retraction: ProjectedMessageRetraction | null;
  erasureMarker: ProjectedMessageErasureMarker | null;
  revision: number;
  createdCursor: number;
  cursor: number;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  [field: string]: unknown;
}

export type ProjectedMessageVersionDelta =
  | {
      operation: "upsert";
      version: ProjectedMessageContentVersion;
    }
  | { operation: "retain" }
  | { operation: "erase-all" };

export interface ProjectedMessageThreadDelta {
  messageId: string;
  replyCountDelta?: 1 | -1;
  descendantCountDelta?: 1 | -1;
  lastReplyAt: string | null;
  revision: number;
  cursor: number;
  updatedAt: string;
}

export interface ValidatedMessageProjectionEnvelope {
  schemaVersion: 1;
  workspaceId: string;
  conversationId: string;
  messageId: string;
  cursor: number;
  event: {
    id: string;
    kind: number;
    [field: string]: unknown;
  };
  state: ProjectedMessageState;
  /** One bounded content-history mutation; never a complete version list. */
  versionDelta: ProjectedMessageVersionDelta;
  /** Counter mutations for roots/ancestors affected by this Message event. */
  threadDeltas: readonly ProjectedMessageThreadDelta[];
  /** Opaque lexical tokens prepared by the Conversation-scoped HMAC producer. */
  search: {
    algorithm: "hmac-sha256-conversation-v2";
    tokens: readonly string[];
  };
}

function actorId(actor: ProjectedMessageActor): string {
  return actor.kind === "punk" ? actor.punkId : actor.installationId;
}

function assertConsistentScope(
  envelope: ValidatedMessageProjectionEnvelope,
): void {
  const { state } = envelope;
  if (
    state.id !== envelope.messageId ||
    state.workspaceId !== envelope.workspaceId ||
    state.conversationId !== envelope.conversationId ||
    state.cursor !== envelope.cursor ||
    state.createdCursor > state.cursor ||
    envelope.threadDeltas.some((delta) => delta.cursor !== envelope.cursor)
  ) {
    throw new RangeError("Message projection scope or cursor is inconsistent");
  }
}

function winningStateEnvelopePredicate(): string {
  return `EXISTS (
    SELECT 1 FROM message_projection
    WHERE workspace_id = ?
      AND conversation_id = ?
      AND message_id = ?
      AND state_cursor = ?
      AND state_event_id = ?
  )`;
}

interface AggregatedThreadDelta {
  messageId: string;
  replyCountDelta: number;
  descendantCountDelta: number;
  lastReplyAt: string | null;
  revision: number;
  cursor: number;
  updatedAt: string;
}

function aggregateThreadDeltas(
  deltas: readonly ProjectedMessageThreadDelta[],
): AggregatedThreadDelta[] {
  const byMessage = new Map<string, AggregatedThreadDelta>();
  for (const delta of deltas) {
    const aggregate = byMessage.get(delta.messageId) ?? {
      messageId: delta.messageId,
      replyCountDelta: 0,
      descendantCountDelta: 0,
      lastReplyAt: delta.lastReplyAt,
      revision: delta.revision,
      cursor: delta.cursor,
      updatedAt: delta.updatedAt,
    };
    if (
      aggregate.lastReplyAt !== delta.lastReplyAt ||
      aggregate.revision !== delta.revision ||
      aggregate.cursor !== delta.cursor ||
      aggregate.updatedAt !== delta.updatedAt
    ) {
      throw new RangeError("Message thread delta metadata is inconsistent");
    }
    aggregate.replyCountDelta += delta.replyCountDelta ?? 0;
    aggregate.descendantCountDelta += delta.descendantCountDelta ?? 0;
    byMessage.set(delta.messageId, aggregate);
  }

  const aggregated = [...byMessage.values()].filter(
    ({ replyCountDelta, descendantCountDelta }) =>
      replyCountDelta !== 0 || descendantCountDelta !== 0,
  );
  if (
    aggregated.some(
      ({ replyCountDelta, descendantCountDelta }) =>
        Math.abs(replyCountDelta) > 1 || Math.abs(descendantCountDelta) > 1,
    )
  ) {
    throw new RangeError("Message thread deltas are inconsistent");
  }
  return aggregated;
}

function reconcileThreadCounters(
  database: D1Database,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): D1PreparedStatement {
  // Erasure terminates content and lifecycle state, not derived thread
  // metadata: later child events must still advance an erased root's counters.
  return database
    .prepare(
      `UPDATE message_projection
       SET reply_count = MAX(
             0,
             reply_count_base + COALESCE((
               SELECT SUM(delta.reply_count_delta)
               FROM message_thread_delta_projection AS delta
               WHERE delta.workspace_id = message_projection.workspace_id
                 AND delta.conversation_id = message_projection.conversation_id
                 AND delta.target_message_id = message_projection.message_id
                 AND delta.cursor > message_projection.state_cursor
             ), 0)
           ),
           descendant_count = MAX(
             0,
             descendant_count_base + COALESCE((
               SELECT SUM(delta.descendant_count_delta)
               FROM message_thread_delta_projection AS delta
               WHERE delta.workspace_id = message_projection.workspace_id
                 AND delta.conversation_id = message_projection.conversation_id
                 AND delta.target_message_id = message_projection.message_id
                 AND delta.cursor > message_projection.state_cursor
             ), 0)
           ),
           last_reply_at = CASE
             WHEN EXISTS (
               SELECT 1
               FROM message_thread_delta_projection AS delta
               WHERE delta.workspace_id = message_projection.workspace_id
                 AND delta.conversation_id = message_projection.conversation_id
                 AND delta.target_message_id = message_projection.message_id
                 AND delta.cursor > message_projection.state_cursor
                 AND delta.target_revision IS NOT NULL
             ) THEN (
               SELECT delta.target_last_reply_at
               FROM message_thread_delta_projection AS delta
               WHERE delta.workspace_id = message_projection.workspace_id
                 AND delta.conversation_id = message_projection.conversation_id
                 AND delta.target_message_id = message_projection.message_id
                 AND delta.cursor > message_projection.state_cursor
                 AND delta.target_revision IS NOT NULL
               ORDER BY delta.cursor DESC
               LIMIT 1
             )
             ELSE last_reply_at
           END,
           revision = COALESCE((
             SELECT delta.target_revision
             FROM message_thread_delta_projection AS delta
             WHERE delta.workspace_id = message_projection.workspace_id
               AND delta.conversation_id = message_projection.conversation_id
               AND delta.target_message_id = message_projection.message_id
               AND delta.cursor > message_projection.state_cursor
               AND delta.target_revision IS NOT NULL
             ORDER BY delta.cursor DESC
             LIMIT 1
           ), revision),
           updated_at = COALESCE((
             SELECT delta.target_updated_at
             FROM message_thread_delta_projection AS delta
             WHERE delta.workspace_id = message_projection.workspace_id
               AND delta.conversation_id = message_projection.conversation_id
               AND delta.target_message_id = message_projection.message_id
               AND delta.cursor > message_projection.state_cursor
               AND delta.target_revision IS NOT NULL
             ORDER BY delta.cursor DESC
             LIMIT 1
           ), updated_at),
           last_cursor = COALESCE((
             SELECT MAX(delta.cursor)
             FROM message_thread_delta_projection AS delta
             WHERE delta.workspace_id = message_projection.workspace_id
               AND delta.conversation_id = message_projection.conversation_id
               AND delta.target_message_id = message_projection.message_id
               AND delta.cursor > message_projection.state_cursor
           ), state_cursor),
           last_event_id = COALESCE((
             SELECT delta.event_id
             FROM message_thread_delta_projection AS delta
             WHERE delta.workspace_id = message_projection.workspace_id
               AND delta.conversation_id = message_projection.conversation_id
               AND delta.target_message_id = message_projection.message_id
               AND delta.cursor > message_projection.state_cursor
             ORDER BY delta.cursor DESC
             LIMIT 1
           ), state_event_id)
       WHERE workspace_id = ?
         AND conversation_id = ?
         AND message_id = ?`,
    )
    .bind(workspaceId, conversationId, messageId);
}

/**
 * Applies one already schema-validated Message projection envelope.
 *
 * The projector intentionally allow-lists persisted fields. In particular it
 * never stores signed event JSON, Message plaintext, topics, or public reasons.
 * Queue duplicates and older deliveries are harmless. Metadata, lifecycle,
 * counters, and search follow the greatest cursor. Version deltas are applied
 * independently so a late create can fill version 1 after edit version 2, but
 * no delta can recreate a version after an erasure, regardless of cursor.
 */
export async function projectMessageEnvelope(
  database: D1Database,
  envelope: ValidatedMessageProjectionEnvelope,
  projectedAt = new Date(),
): Promise<void> {
  assertConsistentScope(envelope);
  const { state } = envelope;
  const threadDeltas = aggregateThreadDeltas(envelope.threadDeltas);
  const scope = [
    envelope.workspaceId,
    envelope.conversationId,
    envelope.messageId,
  ] as const;
  const winner = [...scope, envelope.cursor, envelope.event.id] as const;
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO message_event_projection
          (workspace_id, conversation_id, message_id, event_id, cursor, kind,
           projected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, conversation_id, message_id, event_id)
         DO NOTHING`,
      )
      .bind(
        ...scope,
        envelope.event.id,
        envelope.cursor,
        envelope.event.kind,
        projectedAt.toISOString(),
      ),
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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                 ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, conversation_id, message_id) DO UPDATE SET
           actor_kind = excluded.actor_kind,
           actor_id = excluded.actor_id,
           message_type = excluded.message_type,
           status = excluded.status,
           mentioned_punk_ids_json = excluded.mentioned_punk_ids_json,
           media_ids_json = excluded.media_ids_json,
           parent_message_id = excluded.parent_message_id,
           thread_root_message_id = excluded.thread_root_message_id,
           thread_depth = excluded.thread_depth,
           broadcast = excluded.broadcast,
           reply_count = excluded.reply_count,
           descendant_count = excluded.descendant_count,
           reply_count_base = excluded.reply_count_base,
           descendant_count_base = excluded.descendant_count_base,
           last_reply_at = excluded.last_reply_at,
           topic_present = excluded.topic_present,
           original_content_commitment = excluded.original_content_commitment,
           current_version = excluded.current_version,
           revision = excluded.revision,
           state_cursor = excluded.state_cursor,
           last_cursor = excluded.last_cursor,
           state_event_id = excluded.state_event_id,
           last_event_id = excluded.last_event_id,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           edited_at = excluded.edited_at
         WHERE excluded.state_cursor > message_projection.state_cursor
           AND message_projection.status != 'erased'`,
      )
      .bind(
        ...scope,
        state.author.kind,
        actorId(state.author),
        state.messageType,
        state.status,
        JSON.stringify(state.mentionedPunkIds),
        JSON.stringify(state.mediaIds),
        state.parentMessageId,
        state.threadRootMessageId,
        state.threadDepth,
        state.broadcast ? 1 : 0,
        state.replyCount,
        state.descendantCount,
        state.replyCount,
        state.descendantCount,
        state.lastReplyAt,
        state.topicPresent ? 1 : 0,
        state.originalContentCommitment,
        state.currentVersion,
        state.revision,
        state.createdCursor,
        envelope.cursor,
        envelope.cursor,
        envelope.event.id,
        envelope.event.id,
        state.createdAt,
        state.updatedAt,
        state.editedAt,
      ),
    database
      .prepare(
        `DELETE FROM message_tombstone_projection
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
           AND ${winningStateEnvelopePredicate()}`,
      )
      .bind(...scope, ...winner),
    database
      .prepare(
        `DELETE FROM message_search_document
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
           AND ${winningStateEnvelopePredicate()}`,
      )
      .bind(...scope, ...winner),
  ];

  for (const delta of threadDeltas) {
    statements.push(
      database
        .prepare(
          `INSERT INTO message_thread_delta_projection
            (workspace_id, conversation_id, target_message_id,
             source_message_id, event_id, cursor, reply_count_delta,
             descendant_count_delta, target_last_reply_at, target_revision,
             target_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`,
        )
        .bind(
          envelope.workspaceId,
          envelope.conversationId,
          delta.messageId,
          envelope.messageId,
          envelope.event.id,
          envelope.cursor,
          delta.replyCountDelta,
          delta.descendantCountDelta,
          delta.lastReplyAt,
          delta.revision,
          delta.updatedAt,
        ),
    );
  }

  const counterTargets = new Set([
    envelope.messageId,
    ...threadDeltas.map(({ messageId }) => messageId),
  ]);
  for (const targetMessageId of counterTargets) {
    statements.push(
      reconcileThreadCounters(
        database,
        envelope.workspaceId,
        envelope.conversationId,
        targetMessageId,
      ),
    );
  }

  if (envelope.versionDelta.operation === "upsert") {
    const { version } = envelope.versionDelta;
    statements.push(
      database
        .prepare(
          `INSERT INTO message_version_projection
            (workspace_id, conversation_id, message_id, version,
             content_commitment, ciphertext_ref, content_key_id,
             topic_present, created_at, last_cursor, last_event_id)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE NOT EXISTS (
             SELECT 1 FROM message_projection
             WHERE workspace_id = ?
               AND conversation_id = ?
               AND message_id = ?
               AND status = 'erased'
           )
           ON CONFLICT(workspace_id, conversation_id, message_id, version)
           DO UPDATE SET
             content_commitment = excluded.content_commitment,
             ciphertext_ref = excluded.ciphertext_ref,
             content_key_id = excluded.content_key_id,
             topic_present = excluded.topic_present,
             created_at = excluded.created_at,
             last_cursor = excluded.last_cursor,
             last_event_id = excluded.last_event_id
           WHERE excluded.last_cursor > message_version_projection.last_cursor`,
        )
        .bind(
          ...scope,
          version.version,
          version.contentCommitment,
          version.ciphertextRef,
          version.contentKeyId,
          version.topicPresent ? 1 : 0,
          version.createdAt,
          envelope.cursor,
          envelope.event.id,
          ...scope,
        ),
    );
  } else if (envelope.versionDelta.operation === "erase-all") {
    statements.push(
      database
        .prepare(
          `DELETE FROM message_version_projection
           WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
             AND ${winningStateEnvelopePredicate()}`,
        )
        .bind(...scope, ...winner),
    );
  }

  if (state.status === "retracted" && state.retraction !== null) {
    statements.push(
      database
        .prepare(
          `INSERT INTO message_tombstone_projection
            (workspace_id, conversation_id, message_id, status,
             retraction_kind, retracted_at, erase_after, erased_at,
             destroyed_version_count, reason_code, last_cursor, last_event_id)
           SELECT ?, ?, ?, 'retracted', ?, ?, ?, NULL, NULL, ?, ?, ?
           WHERE ${winningStateEnvelopePredicate()}
           ON CONFLICT(workspace_id, conversation_id, message_id) DO UPDATE SET
             status = excluded.status,
             retraction_kind = excluded.retraction_kind,
             retracted_at = excluded.retracted_at,
             erase_after = excluded.erase_after,
             erased_at = NULL,
             destroyed_version_count = NULL,
             reason_code = excluded.reason_code,
             last_cursor = excluded.last_cursor,
             last_event_id = excluded.last_event_id
           WHERE excluded.last_cursor >= message_tombstone_projection.last_cursor`,
        )
        .bind(
          ...scope,
          state.retraction.kind,
          state.retraction.requestedAt,
          state.retraction.eraseAfter,
          state.retraction.reasonCode ?? null,
          envelope.cursor,
          envelope.event.id,
          ...winner,
        ),
    );
  } else if (state.status === "erased" && state.erasureMarker !== null) {
    statements.push(
      database
        .prepare(
          `INSERT INTO message_tombstone_projection
            (workspace_id, conversation_id, message_id, status,
             retraction_kind, retracted_at, erase_after, erased_at,
             destroyed_version_count, reason_code, last_cursor, last_event_id)
           SELECT ?, ?, ?, 'erased', ?, ?, NULL, ?, ?, NULL, ?, ?
           WHERE ${winningStateEnvelopePredicate()}
           ON CONFLICT(workspace_id, conversation_id, message_id) DO UPDATE SET
             status = excluded.status,
             retraction_kind = excluded.retraction_kind,
             retracted_at = excluded.retracted_at,
             erase_after = NULL,
             erased_at = excluded.erased_at,
             destroyed_version_count = excluded.destroyed_version_count,
             reason_code = NULL,
             last_cursor = excluded.last_cursor,
             last_event_id = excluded.last_event_id
           WHERE excluded.last_cursor >= message_tombstone_projection.last_cursor`,
        )
        .bind(
          ...scope,
          state.erasureMarker.retractionKind,
          state.erasureMarker.retractedAt,
          state.erasureMarker.erasedAt,
          state.erasureMarker.destroyedVersionCount,
          envelope.cursor,
          envelope.event.id,
          ...winner,
        ),
    );
  }

  if (state.status === "active" && envelope.search.tokens.length > 0) {
    statements.push(
      database
        .prepare(
          `INSERT INTO message_search_document
            (workspace_id, conversation_id, message_id, token_algorithm,
             opaque_tokens, last_cursor, last_event_id)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE ${winningStateEnvelopePredicate()}
           ON CONFLICT(workspace_id, conversation_id, message_id) DO UPDATE SET
             token_algorithm = excluded.token_algorithm,
             opaque_tokens = excluded.opaque_tokens,
             last_cursor = excluded.last_cursor,
             last_event_id = excluded.last_event_id
           WHERE excluded.last_cursor >= message_search_document.last_cursor`,
        )
        .bind(
          ...scope,
          envelope.search.algorithm,
          envelope.search.tokens.join(" "),
          envelope.cursor,
          envelope.event.id,
          ...winner,
        ),
    );
  }

  statements.push(...messageReactionLifecycleStatements(database, envelope));

  await database.batch(statements);
}
