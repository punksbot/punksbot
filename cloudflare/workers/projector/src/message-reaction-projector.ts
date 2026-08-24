import type {
  MessageReaction,
  MessageReactionProjectionEnvelope,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

const MAX_REACTION_COUNT = 2_147_483_647;

type ReactionActor = MessageReaction["actor"];
type ReactionDelta = MessageReactionProjectionEnvelope["delta"];

interface MessageLifecycleProjection {
  workspaceId: string;
  conversationId: string;
  messageId: string;
  cursor: number;
  event: { id: string };
  state: { status: "active" | "retracted" | "erased" };
}

function actorId(actor: ReactionActor): string {
  return actor.kind === "punk" ? actor.punkId : actor.installationId;
}

function actorsEqual(left: ReactionActor, right: ReactionActor): boolean {
  return left.kind === right.kind && actorId(left) === actorId(right);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]))
    );
  }
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        jsonValuesEqual(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
}

function singleTag(
  envelope: MessageReactionProjectionEnvelope,
  name: string,
): readonly string[] | null {
  const tags = envelope.event.tags.filter(([tagName]) => tagName === name);
  return tags.length === 1 ? (tags[0] ?? null) : null;
}

function exactValueTag(
  envelope: MessageReactionProjectionEnvelope,
  name: string,
  expected: string,
): boolean {
  const tag = singleTag(envelope, name);
  return tag?.length === 2 && tag[1] === expected;
}

function exactActorAuthorityTags(
  envelope: MessageReactionProjectionEnvelope,
  actor: ReactionActor,
): boolean {
  const tags = envelope.event.tags;
  const attestation = tags.at(-1);
  if (
    attestation?.length !== 2 ||
    attestation[0] !== "attestation" ||
    (attestation[1] ?? "").length === 0
  ) {
    return false;
  }
  if (actor.kind === "punk") {
    const workspaceCursor = tags[5];
    return (
      tags.length === 11 &&
      workspaceCursor?.length === 2 &&
      workspaceCursor[0] === "workspace_cursor" &&
      /^[1-9][0-9]*$/.test(workspaceCursor[1] ?? "")
    );
  }
  const installationCursor = tags[5];
  const admission = tags[6];
  const action = tags[7];
  const opaqueUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  return (
    tags.length === 13 &&
    installationCursor?.length === 2 &&
    installationCursor[0] === "installation_cursor" &&
    /^[1-9][0-9]*$/.test(installationCursor[1] ?? "") &&
    admission?.length === 2 &&
    admission[0] === "admission" &&
    opaqueUuid.test(admission[1] ?? "") &&
    action?.length === 3 &&
    action[0] === "action" &&
    opaqueUuid.test(action[1] ?? "") &&
    /^[0-9a-f]{64}$/.test(action[2] ?? "")
  );
}

function deltaCoordinate(delta: ReactionDelta): {
  reactionId: string;
  messageId: string;
  actor: ReactionActor;
  reaction: string;
  reactedAt: string | null;
} {
  if (delta.operation === "upsert") {
    return {
      reactionId: delta.reaction.id,
      messageId: delta.reaction.messageId,
      actor: delta.reaction.actor,
      reaction: delta.reaction.reaction,
      reactedAt: delta.reaction.reactedAt,
    };
  }
  return {
    reactionId: delta.reactionId,
    messageId: delta.messageId,
    actor: delta.actor,
    reaction: delta.reaction,
    reactedAt: null,
  };
}

function expectedCommandContract(
  kind: number,
  delta: ReactionDelta,
): readonly string[] | null {
  if (kind === 50210 && delta.operation === "upsert") {
    return ["message.reaction-add@1", "message.reaction-toggle@1"];
  }
  if (kind === 50211 && delta.operation === "remove") {
    return ["message.reaction-remove@1", "message.reaction-toggle@1"];
  }
  return null;
}

function consistentSignedContent(
  envelope: MessageReactionProjectionEnvelope,
  coordinate: ReturnType<typeof deltaCoordinate>,
): boolean {
  try {
    const content = JSON.parse(envelope.event.content) as unknown;
    if (
      typeof content !== "object" ||
      content === null ||
      !jsonValuesEqual(Object.keys(content).sort(), [
        "projectionDelta",
        "reaction",
        "schemaVersion",
      ]) ||
      Reflect.get(content, "schemaVersion") !== 1 ||
      !jsonValuesEqual(Reflect.get(content, "projectionDelta"), envelope.delta)
    ) {
      return false;
    }
    const reactionValue = Reflect.get(content, "reaction");
    if (
      !validateContract("punks://contracts/message-reaction@1", reactionValue)
        .valid
    ) {
      return false;
    }
    const reaction = reactionValue as MessageReaction;
    return (
      reaction.id === coordinate.reactionId &&
      reaction.workspaceId === envelope.workspaceId &&
      reaction.conversationId === envelope.conversationId &&
      reaction.messageId === envelope.messageId &&
      reaction.cursor === envelope.cursor &&
      actorsEqual(reaction.actor, coordinate.actor) &&
      reaction.reaction === coordinate.reaction &&
      (envelope.delta.operation === "upsert"
        ? reaction.status === "active" &&
          reaction.reactedAt === coordinate.reactedAt &&
          reaction.removedAt === null
        : reaction.status === "removed" &&
          reaction.reactedAt === null &&
          reaction.removedAt !== null)
    );
  } catch {
    return false;
  }
}

/**
 * Binds a schema-valid Reaction projection to the exact signed Conversation
 * event that produced it. Cryptographic attestation remains the producer's
 * responsibility; this boundary rejects every cross-field substitution.
 */
export function isConsistentMessageReactionProjection(
  envelope: MessageReactionProjectionEnvelope,
): boolean {
  const coordinate = deltaCoordinate(envelope.delta);
  const actorTag = singleTag(envelope, "actor");
  const contractTag = singleTag(envelope, "contract");
  const allowedContracts = expectedCommandContract(
    envelope.event.kind,
    envelope.delta,
  );
  return (
    envelope.contract === "message-reaction.projection@1" &&
    coordinate.messageId === envelope.messageId &&
    exactValueTag(envelope, "workspace", envelope.workspaceId) &&
    exactValueTag(envelope, "conversation", envelope.conversationId) &&
    exactValueTag(envelope, "message", envelope.messageId) &&
    exactValueTag(envelope, "reaction_entity", coordinate.reactionId) &&
    exactValueTag(envelope, "cursor", String(envelope.cursor)) &&
    exactValueTag(envelope, "conversation_cursor", String(envelope.cursor)) &&
    exactActorAuthorityTags(envelope, coordinate.actor) &&
    actorTag?.length === 3 &&
    actorTag[1] === coordinate.actor.kind &&
    actorTag[2] === actorId(coordinate.actor) &&
    contractTag?.length === 2 &&
    allowedContracts?.includes(contractTag[1] ?? "") === true &&
    consistentSignedContent(envelope, coordinate)
  );
}

function presenceStatement(
  database: D1Database,
  envelope: MessageReactionProjectionEnvelope,
): D1PreparedStatement {
  const coordinate = deltaCoordinate(envelope.delta);
  const status = envelope.delta.operation === "upsert" ? "active" : "removed";
  return database
    .prepare(
      `INSERT INTO message_reaction_presence_projection
        (workspace_id, conversation_id, message_id, reaction_entity_id,
         actor_kind, actor_id, reaction, status, reacted_at, last_cursor,
         last_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(
         workspace_id, conversation_id, message_id, actor_kind, actor_id,
         reaction
       ) DO UPDATE SET
         reaction_entity_id = CASE
           WHEN excluded.reaction_entity_id =
                message_reaction_presence_projection.reaction_entity_id
           THEN message_reaction_presence_projection.reaction_entity_id
           ELSE NULL
         END,
         status = CASE
           WHEN excluded.last_cursor >
                message_reaction_presence_projection.last_cursor
           THEN excluded.status
           ELSE message_reaction_presence_projection.status
         END,
         reacted_at = CASE
           WHEN excluded.last_cursor >
                message_reaction_presence_projection.last_cursor
           THEN excluded.reacted_at
           ELSE message_reaction_presence_projection.reacted_at
         END,
         last_cursor = MAX(
           excluded.last_cursor,
           message_reaction_presence_projection.last_cursor
         ),
         last_event_id = CASE
           WHEN excluded.last_cursor >
                message_reaction_presence_projection.last_cursor
           THEN excluded.last_event_id
           ELSE message_reaction_presence_projection.last_event_id
         END`,
    )
    .bind(
      envelope.workspaceId,
      envelope.conversationId,
      envelope.messageId,
      coordinate.reactionId,
      coordinate.actor.kind,
      actorId(coordinate.actor),
      coordinate.reaction,
      status,
      coordinate.reactedAt,
      envelope.cursor,
      envelope.event.id,
    );
}

function reconcileAbsoluteCountStatement(
  database: D1Database,
  envelope: MessageReactionProjectionEnvelope,
): D1PreparedStatement {
  const { reaction } = deltaCoordinate(envelope.delta);
  return database
    .prepare(
      `INSERT INTO message_reaction_count_projection
        (workspace_id, conversation_id, message_id, reaction, active_count,
         visible_count, last_cursor)
       SELECT ?, ?, ?, ?,
         MIN(COUNT(*), ?),
         CASE COALESCE((
           SELECT visibility
           FROM message_reaction_visibility_projection
           WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
         ), 'visible')
           WHEN 'visible' THEN MIN(COUNT(*), ?)
           ELSE 0
         END,
         MAX(COALESCE(MAX(last_cursor), 0), ?)
       FROM message_reaction_presence_projection
       WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
         AND reaction = ? AND status = 'active'
       ON CONFLICT(workspace_id, conversation_id, message_id, reaction)
       DO UPDATE SET
         active_count = excluded.active_count,
         visible_count = excluded.visible_count,
         last_cursor = MAX(
           excluded.last_cursor,
           message_reaction_count_projection.last_cursor
         )`,
    )
    .bind(
      envelope.workspaceId,
      envelope.conversationId,
      envelope.messageId,
      reaction,
      MAX_REACTION_COUNT,
      envelope.workspaceId,
      envelope.conversationId,
      envelope.messageId,
      MAX_REACTION_COUNT,
      envelope.cursor,
      envelope.workspaceId,
      envelope.conversationId,
      envelope.messageId,
      reaction,
    );
}

/** Applies one validated Reaction presence delta atomically and idempotently. */
export async function projectMessageReactionEnvelope(
  database: D1Database,
  envelope: MessageReactionProjectionEnvelope,
  projectedAt = new Date(),
): Promise<void> {
  if (!isConsistentMessageReactionProjection(envelope)) {
    throw new RangeError(
      "Message Reaction projection invariants are inconsistent",
    );
  }
  const coordinate = deltaCoordinate(envelope.delta);
  await database.batch([
    database
      .prepare(
        `INSERT INTO message_reaction_event_projection
          (workspace_id, conversation_id, message_id, reaction_entity_id,
           event_id, cursor, kind, projected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, conversation_id, event_id) DO NOTHING`,
      )
      .bind(
        envelope.workspaceId,
        envelope.conversationId,
        envelope.messageId,
        coordinate.reactionId,
        envelope.event.id,
        envelope.cursor,
        envelope.event.kind,
        projectedAt.toISOString(),
      ),
    presenceStatement(database, envelope),
    reconcileAbsoluteCountStatement(database, envelope),
  ]);
}

/**
 * Returns the bounded Reaction visibility statements that must join the
 * Message projection's D1 batch. No Reaction event or actor roster is needed.
 */
export function messageReactionLifecycleStatements(
  database: D1Database,
  envelope: MessageLifecycleProjection,
): readonly D1PreparedStatement[] {
  const visibility =
    envelope.state.status === "active"
      ? "visible"
      : envelope.state.status === "retracted"
        ? "temporarily-hidden"
        : "permanently-hidden";
  const scope = [
    envelope.workspaceId,
    envelope.conversationId,
    envelope.messageId,
  ] as const;
  const winningMessage = `EXISTS (
    SELECT 1 FROM message_projection
    WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
      AND state_cursor = ? AND state_event_id = ?
  )`;
  return [
    database
      .prepare(
        `INSERT INTO message_reaction_visibility_projection
          (workspace_id, conversation_id, message_id, visibility, last_cursor,
           last_event_id)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE ${winningMessage}
         ON CONFLICT(workspace_id, conversation_id, message_id) DO UPDATE SET
           visibility = excluded.visibility,
           last_cursor = excluded.last_cursor,
           last_event_id = excluded.last_event_id
         WHERE message_reaction_visibility_projection.visibility !=
                 'permanently-hidden'
           AND excluded.last_cursor >
                 message_reaction_visibility_projection.last_cursor`,
      )
      .bind(
        ...scope,
        visibility,
        envelope.cursor,
        envelope.event.id,
        ...scope,
        envelope.cursor,
        envelope.event.id,
      ),
    database
      .prepare(
        `UPDATE message_reaction_count_projection
         SET visible_count = CASE ?
               WHEN 'visible' THEN active_count
               ELSE 0
             END,
             last_cursor = MAX(last_cursor, ?)
         WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
           AND EXISTS (
             SELECT 1 FROM message_reaction_visibility_projection
             WHERE workspace_id = ? AND conversation_id = ? AND message_id = ?
               AND last_cursor = ? AND last_event_id = ?
           )`,
      )
      .bind(
        visibility,
        envelope.cursor,
        ...scope,
        ...scope,
        envelope.cursor,
        envelope.event.id,
      ),
  ];
}
