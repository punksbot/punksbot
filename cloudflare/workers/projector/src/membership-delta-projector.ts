import type {
  ConversationEventContentV2,
  ConversationMemberDeltaV2,
  ConversationProjectionMessageV2,
  SignedNostrEvent,
  WorkspaceEventContentV2,
  WorkspaceMemberDeltaV2,
  WorkspaceProjectionMessageV2,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

const STAGING_TTL_MS = 15 * 24 * 60 * 60 * 1_000;
const STAGING_CLEANUP_BATCH_SIZE = 100;

type MembershipProjectionType = "workspace" | "conversation";
type MembershipDelta = WorkspaceMemberDeltaV2 | ConversationMemberDeltaV2;

interface MembershipScope {
  workspaceId: string;
  conversationId?: string;
  cursor: number;
}

interface StagedBatchRow {
  projection_type: MembershipProjectionType;
  aggregate_id: string;
  cursor: number;
  workspace_id: string;
  conversation_id: string | null;
  event_id: string;
  event_json: string;
  delta_digest: string;
  delta_count: number;
  chunk_count: number;
}

interface StagedChunkRow {
  chunk_index: number;
  chunk_digest: string;
  chunk_json: string;
}

export interface ValidatedWorkspaceMembershipProjection {
  message: WorkspaceProjectionMessageV2;
  content: WorkspaceEventContentV2;
}

export interface ValidatedConversationMembershipProjection {
  message: ConversationProjectionMessageV2;
  content: ConversationEventContentV2;
}

export type MembershipProjectionResult = "staged" | "projected" | "duplicate";

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON rejects non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value !== "object") {
    throw new TypeError("Canonical JSON rejects unsupported values");
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
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

function singleTag(
  event: SignedNostrEvent,
  name: string,
): [string, ...string[]] | null {
  const tags = event.tags.filter(([tagName]) => tagName === name);
  return tags.length === 1 ? (tags[0] ?? null) : null;
}

function exactTag(
  event: SignedNostrEvent,
  name: string,
  expected: readonly string[],
): boolean {
  const tag = singleTag(event, name);
  return (
    tag !== null &&
    tag.length === expected.length + 1 &&
    tag.every((value, index) =>
      index === 0 ? value === name : value === expected[index - 1],
    )
  );
}

function workspaceContractMatches(
  message: WorkspaceProjectionMessageV2,
  content: WorkspaceEventContentV2,
): boolean {
  const contract = singleTag(message.event, "contract");
  if (contract?.length !== 2) return false;
  if (message.event.kind === 50000) {
    return contract[1] === "workspace.create@1";
  }
  if (message.event.kind === 50001) {
    return contract[1] === "workspace.rename@1";
  }
  if (message.event.kind === 50003) {
    return (
      contract[1] ===
      (content.transition.type === "ownership-transferred"
        ? "workspace.transfer-ownership@1"
        : "workspace.member-set-role@1")
    );
  }
  if (message.event.kind !== 50004) return false;
  if (contract[1] === "workspace.member-remove@1") return true;
  const target = singleTag(message.event, "target");
  const actor = singleTag(message.event, "actor");
  return (
    contract[1] === "workspace.leave@1" &&
    target?.length === 3 &&
    actor?.length === 3 &&
    target[1] === "punk" &&
    actor[1] === "punk" &&
    target[2] === actor[2]
  );
}

function expectedConversationContract(kind: number): string | null {
  return kind === 50100
    ? "conversation.create@1"
    : kind === 50101
      ? "conversation.join@1"
      : kind === 50102
        ? "conversation.member-set-access@1"
        : kind === 50103
          ? "conversation.member-remove@1"
          : kind === 50105
            ? "conversation.update@1"
            : kind === 50106
              ? "conversation.archive@1"
              : kind === 50107
                ? "conversation.restore@1"
                : null;
}

function parseCanonicalEventContent(event: SignedNostrEvent): unknown | null {
  try {
    const content = JSON.parse(event.content) as unknown;
    return canonicalJson(content) === event.content ? content : null;
  } catch {
    return null;
  }
}

function chunkHashInput(
  scope: MembershipScope,
  chunkIndex: number,
  memberDeltas: readonly MembershipDelta[],
): Record<string, unknown> {
  const input: Record<string, unknown> = {
    schemaVersion: 2,
    workspaceId: scope.workspaceId,
    cursor: scope.cursor,
    chunkIndex,
    memberDeltas,
  };
  if (scope.conversationId !== undefined) {
    input.conversationId = scope.conversationId;
  }
  return input;
}

async function hasValidChunkBinding(
  message: WorkspaceProjectionMessageV2 | ConversationProjectionMessageV2,
  content: WorkspaceEventContentV2 | ConversationEventContentV2,
): Promise<boolean> {
  const commitment = content.membershipCommitment;
  if (
    message.chunkIndex >= message.chunkCount ||
    message.chunkCount !== commitment.chunkCount ||
    commitment.chunkDigests.length !== commitment.chunkCount ||
    message.chunkDigest !== commitment.chunkDigests[message.chunkIndex] ||
    commitment.deltaCount < message.memberDeltas.length
  ) {
    return false;
  }
  const scope: MembershipScope = {
    workspaceId: message.workspaceId,
    cursor: message.cursor,
  };
  if ("conversationId" in message) {
    scope.conversationId = message.conversationId;
  }
  return (
    (await sha256Hex(
      canonicalJson(
        chunkHashInput(scope, message.chunkIndex, message.memberDeltas),
      ),
    )) === message.chunkDigest
  );
}

function workspaceTransitionMatches(
  message: WorkspaceProjectionMessageV2,
  content: WorkspaceEventContentV2,
): boolean {
  const transition = content.transition;
  if (message.event.kind === 50000) {
    return (
      transition.type === "created" &&
      singleTag(message.event, "target") === null &&
      message.memberDeltas.every((delta) => delta.present)
    );
  }
  if (message.event.kind === 50001) {
    return (
      transition.type === "renamed" &&
      singleTag(message.event, "target") === null &&
      message.memberDeltas.length === 0 &&
      content.membershipCommitment.deltaCount === 0 &&
      content.membershipCommitment.chunkCount === 1
    );
  }
  if (transition.type === "ownership-transferred") {
    const previousOwner = singleTag(message.event, "previous_owner");
    const target = singleTag(message.event, "target");
    const previousOwnerTransition = transition.memberTransitions[0];
    const targetTransition = transition.memberTransitions[1];
    const previousOwnerDelta = message.memberDeltas[0];
    const targetDelta = message.memberDeltas[1];
    return (
      message.event.kind === 50003 &&
      previousOwner?.length === 3 &&
      previousOwner[1] === "punk" &&
      target?.length === 3 &&
      target[1] === "punk" &&
      previousOwner[2] !== target[2] &&
      message.memberDeltas.length === 2 &&
      content.membershipCommitment.deltaCount === 2 &&
      content.membershipCommitment.chunkCount === 1 &&
      previousOwnerTransition.type === "member-upserted" &&
      previousOwnerTransition.targetPunkId === previousOwner[2] &&
      previousOwnerTransition.previousRole === "owner" &&
      previousOwnerTransition.role === "member" &&
      previousOwnerDelta?.punkId === previousOwnerTransition.targetPunkId &&
      previousOwnerDelta.present &&
      previousOwnerDelta.role === previousOwnerTransition.role &&
      targetTransition.type === "member-upserted" &&
      targetTransition.targetPunkId === target[2] &&
      targetTransition.previousRole !== null &&
      targetTransition.role === "owner" &&
      targetDelta?.punkId === targetTransition.targetPunkId &&
      targetDelta.present &&
      targetDelta.role === targetTransition.role &&
      content.workspace.ownerPunkId === targetTransition.targetPunkId
    );
  }
  const target = singleTag(message.event, "target");
  if (
    target?.length !== 3 ||
    target[1] !== "punk" ||
    message.memberDeltas.length !== 1 ||
    content.membershipCommitment.deltaCount !== 1 ||
    content.membershipCommitment.chunkCount !== 1
  ) {
    return false;
  }
  const delta = message.memberDeltas[0];
  if (delta === undefined || delta.punkId !== target[2]) {
    return false;
  }
  if (message.event.kind === 50003) {
    return (
      transition.type === "member-upserted" &&
      transition.targetPunkId === delta.punkId &&
      transition.role === delta.role &&
      delta.present
    );
  }
  return (
    message.event.kind === 50004 &&
    transition.type === "member-removed" &&
    transition.targetPunkId === delta.punkId &&
    transition.previousRole === delta.role &&
    !delta.present
  );
}

function conversationTransitionMatches(
  message: ConversationProjectionMessageV2,
  content: ConversationEventContentV2,
): boolean {
  const transition = content.transition;
  if (message.event.kind === 50100) {
    return (
      transition.type === "created" &&
      singleTag(message.event, "target") === null &&
      message.memberDeltas.every((delta) => delta.present)
    );
  }
  if (
    message.event.kind === 50105 ||
    message.event.kind === 50106 ||
    message.event.kind === 50107
  ) {
    const expectedTransition =
      message.event.kind === 50105
        ? "metadata-updated"
        : message.event.kind === 50106
          ? "archived"
          : "restored";
    return (
      transition.type === expectedTransition &&
      singleTag(message.event, "target") === null &&
      message.memberDeltas.length === 0 &&
      content.membershipCommitment.deltaCount === 0 &&
      content.membershipCommitment.chunkCount === 1
    );
  }
  const target = singleTag(message.event, "target");
  if (
    target?.length !== 3 ||
    target[1] !== "punk" ||
    message.memberDeltas.length !== 1 ||
    content.membershipCommitment.deltaCount !== 1 ||
    content.membershipCommitment.chunkCount !== 1
  ) {
    return false;
  }
  const delta = message.memberDeltas[0];
  if (delta === undefined || delta.punkId !== target[2]) {
    return false;
  }
  if (message.event.kind === 50101) {
    return (
      transition.type === "member-joined" &&
      transition.targetPunkId === delta.punkId &&
      transition.access === delta.access &&
      delta.present
    );
  }
  if (message.event.kind === 50102) {
    return (
      transition.type === "member-access-set" &&
      transition.targetPunkId === delta.punkId &&
      transition.access === delta.access &&
      delta.present
    );
  }
  return (
    message.event.kind === 50103 &&
    transition.type === "member-removed" &&
    transition.targetPunkId === delta.punkId &&
    transition.previousAccess === delta.access &&
    !delta.present
  );
}

export async function validateWorkspaceMembershipProjection(
  message: WorkspaceProjectionMessageV2,
): Promise<ValidatedWorkspaceMembershipProjection | null> {
  const parsed = parseCanonicalEventContent(message.event);
  if (
    parsed === null ||
    !validateContract("punks://contracts/workspace.event@2", parsed).valid
  ) {
    return null;
  }
  const content = parsed as WorkspaceEventContentV2;
  const commitment = content.membershipCommitment;
  if (
    content.workspace.id !== message.workspaceId ||
    content.workspace.cursor !== message.cursor ||
    !exactTag(message.event, "workspace", [message.workspaceId]) ||
    !exactTag(message.event, "cursor", [String(message.cursor)]) ||
    !workspaceContractMatches(message, content) ||
    !exactTag(message.event, "delta", [
      "sha256",
      commitment.deltaDigest,
      String(commitment.deltaCount),
      String(commitment.chunkCount),
    ]) ||
    !workspaceTransitionMatches(message, content) ||
    !(await hasValidChunkBinding(message, content))
  ) {
    return null;
  }
  return { message, content };
}

export async function validateConversationMembershipProjection(
  message: ConversationProjectionMessageV2,
): Promise<ValidatedConversationMembershipProjection | null> {
  const expectedContract = expectedConversationContract(message.event.kind);
  const parsed = parseCanonicalEventContent(message.event);
  if (
    expectedContract === null ||
    parsed === null ||
    !validateContract("punks://contracts/conversation.event@2", parsed).valid
  ) {
    return null;
  }
  const content = parsed as ConversationEventContentV2;
  const commitment = content.membershipCommitment;
  if (
    content.conversation.id !== message.conversationId ||
    content.conversation.workspaceId !== message.workspaceId ||
    content.conversation.cursor !== message.cursor ||
    !exactTag(message.event, "workspace", [message.workspaceId]) ||
    !exactTag(message.event, "conversation", [message.conversationId]) ||
    !exactTag(message.event, "cursor", [String(message.cursor)]) ||
    !exactTag(message.event, "contract", [expectedContract]) ||
    !exactTag(message.event, "delta", [
      "sha256",
      commitment.deltaDigest,
      String(commitment.deltaCount),
      String(commitment.chunkCount),
    ]) ||
    !conversationTransitionMatches(message, content) ||
    !(await hasValidChunkBinding(message, content))
  ) {
    return null;
  }
  return { message, content };
}

async function cleanupExpiredStaging(
  database: D1Database,
  now: Date,
): Promise<void> {
  await database
    .prepare(
      `DELETE FROM membership_delta_batch
       WHERE rowid IN (
         SELECT rowid FROM membership_delta_batch
         WHERE expires_at <= ?
         ORDER BY expires_at
         LIMIT ?
       )`,
    )
    .bind(now.toISOString(), STAGING_CLEANUP_BATCH_SIZE)
    .run();
}

function eventsEqual(
  storedEventJson: string,
  event: SignedNostrEvent,
): boolean {
  try {
    return canonicalJson(JSON.parse(storedEventJson)) === canonicalJson(event);
  } catch {
    return false;
  }
}

async function existingProjectedEvent(
  database: D1Database,
  projectionType: MembershipProjectionType,
  workspaceId: string,
  aggregateId: string,
  cursor: number,
): Promise<{ event_id: string; event_json: string } | null> {
  if (projectionType === "workspace") {
    return database
      .prepare(
        `SELECT event_id, event_json FROM workspace_event_projection
         WHERE workspace_id = ? AND cursor = ?`,
      )
      .bind(workspaceId, cursor)
      .first<{ event_id: string; event_json: string }>();
  }
  return database
    .prepare(
      `SELECT event_id, event_json FROM conversation_event_projection
       WHERE workspace_id = ? AND conversation_id = ? AND cursor = ?`,
    )
    .bind(workspaceId, aggregateId, cursor)
    .first<{ event_id: string; event_json: string }>();
}

function batchMatches(
  batch: StagedBatchRow,
  projectionType: MembershipProjectionType,
  aggregateId: string,
  conversationId: string | null,
  message: WorkspaceProjectionMessageV2 | ConversationProjectionMessageV2,
  eventJson: string,
): boolean {
  const commitment = JSON.parse(message.event.content) as {
    membershipCommitment: {
      deltaDigest: string;
      deltaCount: number;
      chunkCount: number;
    };
  };
  return (
    batch.projection_type === projectionType &&
    batch.aggregate_id === aggregateId &&
    batch.cursor === message.cursor &&
    batch.workspace_id === message.workspaceId &&
    batch.conversation_id === conversationId &&
    batch.event_id === message.event.id &&
    batch.event_json === eventJson &&
    batch.delta_digest === commitment.membershipCommitment.deltaDigest &&
    batch.delta_count === commitment.membershipCommitment.deltaCount &&
    batch.chunk_count === commitment.membershipCommitment.chunkCount
  );
}

async function stageAndReadCompleteDelta(
  database: D1Database,
  projectionType: MembershipProjectionType,
  aggregateId: string,
  conversationId: string | null,
  message: WorkspaceProjectionMessageV2 | ConversationProjectionMessageV2,
  projectedAt: Date,
): Promise<readonly MembershipDelta[] | null> {
  const eventJson = canonicalJson(message.event);
  const content = JSON.parse(message.event.content) as {
    membershipCommitment: {
      deltaDigest: string;
      deltaCount: number;
      chunkCount: number;
    };
  };
  const commitment = content.membershipCommitment;
  await database
    .prepare(
      `INSERT INTO membership_delta_batch
        (projection_type, aggregate_id, cursor, workspace_id, conversation_id,
         event_id, event_json, delta_digest, delta_count, chunk_count,
         expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      projectionType,
      aggregateId,
      message.cursor,
      message.workspaceId,
      conversationId,
      message.event.id,
      eventJson,
      commitment.deltaDigest,
      commitment.deltaCount,
      commitment.chunkCount,
      new Date(projectedAt.getTime() + STAGING_TTL_MS).toISOString(),
      projectedAt.toISOString(),
    )
    .run();
  const batch = await database
    .prepare(
      `SELECT projection_type, aggregate_id, cursor, workspace_id,
              conversation_id, event_id, event_json, delta_digest,
              delta_count, chunk_count
       FROM membership_delta_batch
       WHERE projection_type = ? AND aggregate_id = ? AND cursor = ?`,
    )
    .bind(projectionType, aggregateId, message.cursor)
    .first<StagedBatchRow>();
  if (
    batch === null ||
    !batchMatches(
      batch,
      projectionType,
      aggregateId,
      conversationId,
      message,
      eventJson,
    )
  ) {
    throw new Error("membership_delta_batch_conflict");
  }

  const chunkJson = canonicalJson(message.memberDeltas);
  await database
    .prepare(
      `INSERT INTO membership_delta_chunk
        (projection_type, aggregate_id, cursor, chunk_index, chunk_digest,
         chunk_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(
      projectionType,
      aggregateId,
      message.cursor,
      message.chunkIndex,
      message.chunkDigest,
      chunkJson,
      projectedAt.toISOString(),
    )
    .run();
  const storedChunk = await database
    .prepare(
      `SELECT chunk_index, chunk_digest, chunk_json
       FROM membership_delta_chunk
       WHERE projection_type = ? AND aggregate_id = ? AND cursor = ?
         AND chunk_index = ?`,
    )
    .bind(projectionType, aggregateId, message.cursor, message.chunkIndex)
    .first<StagedChunkRow>();
  if (
    storedChunk === null ||
    storedChunk.chunk_digest !== message.chunkDigest ||
    storedChunk.chunk_json !== chunkJson
  ) {
    throw new Error("membership_delta_chunk_conflict");
  }

  const storedChunks = await database
    .prepare(
      `SELECT chunk_index, chunk_digest, chunk_json
       FROM membership_delta_chunk
       WHERE projection_type = ? AND aggregate_id = ? AND cursor = ?
       ORDER BY chunk_index`,
    )
    .bind(projectionType, aggregateId, message.cursor)
    .all<StagedChunkRow>();
  if (storedChunks.results.length < commitment.chunkCount) {
    return null;
  }
  if (storedChunks.results.length !== commitment.chunkCount) {
    throw new Error("membership_delta_chunk_count_conflict");
  }

  const scope: MembershipScope = {
    workspaceId: message.workspaceId,
    cursor: message.cursor,
  };
  if (conversationId !== null) {
    scope.conversationId = conversationId;
  }
  const deltas: MembershipDelta[] = [];
  for (let index = 0; index < storedChunks.results.length; index += 1) {
    const chunk = storedChunks.results[index];
    if (chunk === undefined || chunk.chunk_index !== index) {
      throw new Error("membership_delta_chunk_index_conflict");
    }
    const parsed = JSON.parse(chunk.chunk_json) as MembershipDelta[];
    const digest = await sha256Hex(
      canonicalJson(chunkHashInput(scope, index, parsed)),
    );
    if (
      digest !== chunk.chunk_digest ||
      digest !==
        (
          JSON.parse(message.event.content) as {
            membershipCommitment: { chunkDigests: string[] };
          }
        ).membershipCommitment.chunkDigests[index]
    ) {
      throw new Error("membership_delta_chunk_digest_conflict");
    }
    deltas.push(...parsed);
  }
  if (
    deltas.length !== commitment.deltaCount ||
    (await sha256Hex(
      canonicalJson({ schemaVersion: 2, memberDeltas: deltas }),
    )) !== commitment.deltaDigest ||
    new Set(deltas.map((delta) => delta.punkId)).size !== deltas.length
  ) {
    throw new Error("membership_delta_global_digest_conflict");
  }
  return deltas;
}

function workspaceProjectionStatements(
  database: D1Database,
  validated: ValidatedWorkspaceMembershipProjection,
  memberDeltas: readonly WorkspaceMemberDeltaV2[],
  projectedAt: Date,
): D1PreparedStatement[] {
  const { message, content } = validated;
  const state = content.workspace;
  return [
    database
      .prepare(
        `INSERT INTO workspace_event_projection
          (event_id, workspace_id, cursor, event_json, projected_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        message.event.id,
        message.workspaceId,
        message.cursor,
        canonicalJson(message.event),
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
        state.memberCount,
      ),
    database
      .prepare(
        `INSERT INTO workspace_member_projection
          (workspace_id, punk_id, role, last_cursor, updated_at, present)
         SELECT ?,
                json_extract(delta.value, '$.punkId'),
                json_extract(delta.value, '$.role'),
                ?, ?,
                CASE json_extract(delta.value, '$.present') WHEN 1 THEN 1 ELSE 0 END
         FROM json_each(?) AS delta
         WHERE ? > COALESCE((
           SELECT roster_floor_cursor FROM workspace_projection
           WHERE workspace_id = ?
         ), 0)
         ON CONFLICT(workspace_id, punk_id) DO UPDATE SET
           role = excluded.role,
           last_cursor = excluded.last_cursor,
           updated_at = excluded.updated_at,
           present = excluded.present
         WHERE excluded.last_cursor > workspace_member_projection.last_cursor`,
      )
      .bind(
        message.workspaceId,
        message.cursor,
        projectedAt.toISOString(),
        canonicalJson(memberDeltas),
        message.cursor,
        message.workspaceId,
      ),
    database
      .prepare(
        `DELETE FROM membership_delta_batch
         WHERE projection_type = 'workspace' AND aggregate_id = ? AND cursor = ?`,
      )
      .bind(message.workspaceId, message.cursor),
  ];
}

function conversationProjectionStatements(
  database: D1Database,
  validated: ValidatedConversationMembershipProjection,
  memberDeltas: readonly ConversationMemberDeltaV2[],
  projectedAt: Date,
): D1PreparedStatement[] {
  const { message, content } = validated;
  const state = content.conversation;
  return [
    database
      .prepare(
        `INSERT INTO conversation_event_projection
          (event_id, workspace_id, conversation_id, cursor, event_json, projected_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        message.event.id,
        message.workspaceId,
        message.conversationId,
        message.cursor,
        canonicalJson(message.event),
        projectedAt.toISOString(),
      ),
    database
      .prepare(
        `INSERT INTO conversation_projection
          (conversation_id, workspace_id, name, conversation_type, visibility,
           description, topic, purpose, topic_required, max_members, ttl_seconds,
           ttl_deadline, status, owner_punk_id, revision, last_cursor, created_at,
           updated_at, archived_at, member_count, roster_floor_cursor)
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
        state.memberCount,
      ),
    database
      .prepare(
        `INSERT INTO conversation_member_projection
          (workspace_id, conversation_id, punk_id, access, joined_at,
           invited_by_punk_id, last_cursor, updated_at, present)
         SELECT ?, ?,
                json_extract(delta.value, '$.punkId'),
                json_extract(delta.value, '$.access'),
                json_extract(delta.value, '$.joinedAt'),
                json_extract(delta.value, '$.invitedByPunkId'),
                ?, ?,
                CASE json_extract(delta.value, '$.present') WHEN 1 THEN 1 ELSE 0 END
         FROM json_each(?) AS delta
         WHERE ? > COALESCE((
           SELECT roster_floor_cursor FROM conversation_projection
           WHERE conversation_id = ? AND workspace_id = ?
         ), 0)
         ON CONFLICT(conversation_id, punk_id) DO UPDATE SET
           access = excluded.access,
           joined_at = excluded.joined_at,
           invited_by_punk_id = excluded.invited_by_punk_id,
           last_cursor = excluded.last_cursor,
           updated_at = excluded.updated_at,
           present = excluded.present
         WHERE excluded.workspace_id = conversation_member_projection.workspace_id
           AND excluded.last_cursor > conversation_member_projection.last_cursor`,
      )
      .bind(
        message.workspaceId,
        message.conversationId,
        message.cursor,
        projectedAt.toISOString(),
        canonicalJson(memberDeltas),
        message.cursor,
        message.conversationId,
        message.workspaceId,
      ),
    database
      .prepare(
        `DELETE FROM membership_delta_batch
         WHERE projection_type = 'conversation' AND aggregate_id = ? AND cursor = ?`,
      )
      .bind(message.conversationId, message.cursor),
  ];
}

async function projectedDuplicateOrConflict(
  database: D1Database,
  projectionType: MembershipProjectionType,
  workspaceId: string,
  aggregateId: string,
  cursor: number,
  event: SignedNostrEvent,
): Promise<"duplicate" | "absent"> {
  const existing = await existingProjectedEvent(
    database,
    projectionType,
    workspaceId,
    aggregateId,
    cursor,
  );
  if (existing === null) {
    return "absent";
  }
  if (
    existing.event_id === event.id &&
    eventsEqual(existing.event_json, event)
  ) {
    return "duplicate";
  }
  throw new Error("membership_delta_event_cursor_conflict");
}

export async function projectWorkspaceMembershipProjection(
  database: D1Database,
  validated: ValidatedWorkspaceMembershipProjection,
  projectedAt = new Date(),
): Promise<MembershipProjectionResult> {
  const { message, content } = validated;
  await cleanupExpiredStaging(database, projectedAt);
  if (
    (await projectedDuplicateOrConflict(
      database,
      "workspace",
      message.workspaceId,
      message.workspaceId,
      message.cursor,
      message.event,
    )) === "duplicate"
  ) {
    return "duplicate";
  }
  const memberDeltas = await stageAndReadCompleteDelta(
    database,
    "workspace",
    message.workspaceId,
    null,
    message,
    projectedAt,
  );
  if (memberDeltas === null) {
    return "staged";
  }
  if (
    content.transition.type === "created" &&
    (memberDeltas.some((delta) => !("role" in delta) || !delta.present) ||
      content.workspace.memberCount !== memberDeltas.length ||
      !memberDeltas.some(
        (delta) =>
          "role" in delta &&
          delta.punkId === content.workspace.ownerPunkId &&
          delta.present &&
          delta.role === "owner",
      ))
  ) {
    throw new Error("workspace_membership_create_delta_conflict");
  }
  try {
    await database.batch(
      workspaceProjectionStatements(
        database,
        validated,
        memberDeltas as readonly WorkspaceMemberDeltaV2[],
        projectedAt,
      ),
    );
    return "projected";
  } catch (error) {
    if (
      (await projectedDuplicateOrConflict(
        database,
        "workspace",
        message.workspaceId,
        message.workspaceId,
        message.cursor,
        message.event,
      )) === "duplicate"
    ) {
      return "duplicate";
    }
    throw error;
  }
}

export async function projectConversationMembershipProjection(
  database: D1Database,
  validated: ValidatedConversationMembershipProjection,
  projectedAt = new Date(),
): Promise<MembershipProjectionResult> {
  const { message, content } = validated;
  await cleanupExpiredStaging(database, projectedAt);
  if (
    (await projectedDuplicateOrConflict(
      database,
      "conversation",
      message.workspaceId,
      message.conversationId,
      message.cursor,
      message.event,
    )) === "duplicate"
  ) {
    return "duplicate";
  }
  const memberDeltas = await stageAndReadCompleteDelta(
    database,
    "conversation",
    message.conversationId,
    message.conversationId,
    message,
    projectedAt,
  );
  if (memberDeltas === null) {
    return "staged";
  }
  if (
    content.transition.type === "created" &&
    (memberDeltas.some((delta) => !("access" in delta) || !delta.present) ||
      content.conversation.memberCount !== memberDeltas.length ||
      !memberDeltas.some(
        (delta) =>
          "access" in delta &&
          delta.punkId === content.conversation.ownerPunkId &&
          delta.present,
      ))
  ) {
    throw new Error("conversation_membership_create_delta_conflict");
  }
  try {
    await database.batch(
      conversationProjectionStatements(
        database,
        validated,
        memberDeltas as readonly ConversationMemberDeltaV2[],
        projectedAt,
      ),
    );
    return "projected";
  } catch (error) {
    if (
      (await projectedDuplicateOrConflict(
        database,
        "conversation",
        message.workspaceId,
        message.conversationId,
        message.cursor,
        message.event,
      )) === "duplicate"
    ) {
      return "duplicate";
    }
    throw error;
  }
}
