import type { BotInstallationProjectionEnvelope } from "@punks/contracts";

type InstallationDelta = BotInstallationProjectionEnvelope["delta"];
type InstallationSummary = Extract<
  InstallationDelta,
  { installation: unknown }
>["installation"];

interface InstallationProjectionRow {
  workspace_id: string;
  installation_id: string;
  bot_id: string;
  status: "active" | "revoked";
  config_contract_id: string;
  config_digest: string;
  grant_count: number;
  open_admission_count: number;
  authority_generation: number;
  revision: number;
  last_cursor: number;
  last_event_id: string;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        jsonValuesEqual(Reflect.get(left, key), Reflect.get(right, key)),
    )
  );
}

function hasExactTag(
  envelope: BotInstallationProjectionEnvelope,
  name: string,
  expected: readonly string[],
): boolean {
  const tags = envelope.event.tags.filter(([tagName]) => tagName === name);
  return tags.length === 1 && jsonValuesEqual(tags[0], [name, ...expected]);
}

function isUuid(value: string | undefined): boolean {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function hasExactBaseTags(
  envelope: BotInstallationProjectionEnvelope,
  botId: string,
  contract: string,
  expectedLength: number,
): boolean {
  const tags = envelope.event.tags;
  const managementActor = envelope.event.kind <= 50312;
  return (
    tags.length === expectedLength &&
    jsonValuesEqual(tags[0], ["workspace", envelope.workspaceId]) &&
    jsonValuesEqual(tags[1], ["installation", envelope.installationId]) &&
    jsonValuesEqual(tags[2], ["bot", botId]) &&
    jsonValuesEqual(tags[3], ["cursor", String(envelope.cursor)]) &&
    tags[4]?.length === 2 &&
    tags[4]?.[0] === "command" &&
    isUuid(tags[4]?.[1]) &&
    jsonValuesEqual(tags[5], ["contract", contract]) &&
    tags[6]?.length === 3 &&
    tags[6]?.[0] === "actor" &&
    (managementActor
      ? tags[6]?.[1] === "punk" && isUuid(tags[6]?.[2])
      : jsonValuesEqual(tags[6], ["actor", "bot", envelope.installationId])) &&
    tags.at(-1)?.length === 2 &&
    tags.at(-1)?.[0] === "attestation" &&
    (tags.at(-1)?.[1]?.length ?? 0) > 0
  );
}

function hasExactSignedTags(
  envelope: BotInstallationProjectionEnvelope,
  botId: string,
  contract: string,
): boolean {
  const { delta, event } = envelope;
  if (
    delta.operation !== "action-admitted" &&
    delta.operation !== "action-completed"
  ) {
    return hasExactBaseTags(envelope, botId, contract, 8);
  }
  const { admission } = delta;
  if (delta.operation === "action-admitted") {
    return (
      hasExactBaseTags(envelope, botId, contract, 14) &&
      jsonValuesEqual(event.tags[7], ["admission", admission.id]) &&
      jsonValuesEqual(event.tags[8], [
        "action",
        admission.actionId,
        admission.actionDigest,
      ]) &&
      jsonValuesEqual(event.tags[9], [
        "action_contract",
        admission.actionContract,
      ]) &&
      jsonValuesEqual(event.tags[10], ["capability", admission.capability]) &&
      jsonValuesEqual(event.tags[11], [
        "conversation",
        admission.resource.conversationId,
      ]) &&
      jsonValuesEqual(event.tags[12], ["message", admission.resource.messageId])
    );
  }
  return (
    hasExactBaseTags(envelope, botId, contract, 11) &&
    jsonValuesEqual(event.tags[7], ["admission", admission.id]) &&
    jsonValuesEqual(event.tags[8], [
      "action",
      admission.actionId,
      admission.actionDigest,
    ]) &&
    jsonValuesEqual(event.tags[9], ["outcome", admission.outcome])
  );
}

function expectedEvent(delta: InstallationDelta): {
  kind: number;
  contract: string;
} {
  switch (delta.operation) {
    case "installed":
    case "reinstalled":
      return { kind: 50310, contract: "bot-installation.install@1" };
    case "configured":
    case "set-grant":
      return { kind: 50311, contract: "bot-installation.configure@1" };
    case "revoked":
      return { kind: 50312, contract: "bot-installation.revoke@1" };
    case "action-admitted":
      return { kind: 50320, contract: "bot-action.admit@1" };
    case "action-completed":
      return { kind: 50321, contract: "bot-action.complete@1" };
  }
}

function projectionSummary(
  delta: InstallationDelta,
): InstallationSummary | null {
  return delta.operation === "installed" ||
    delta.operation === "reinstalled" ||
    delta.operation === "configured" ||
    delta.operation === "revoked"
    ? delta.installation
    : null;
}

function exactInstallationKeys(value: Record<string, unknown>): boolean {
  return jsonValuesEqual(Object.keys(value).sort(), [
    "authorityGeneration",
    "botId",
    "configContractId",
    "configDigest",
    "createdAt",
    "cursor",
    "grantCount",
    "id",
    "openAdmissionCount",
    "revision",
    "revokedAt",
    "status",
    "updatedAt",
    "workspaceId",
  ]);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 1;
}

function isDateTime(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function isSignedInstallationSummary(
  value: unknown,
): value is InstallationSummary {
  if (!isRecord(value)) {
    return false;
  }
  const active = value.status === "active";
  const revoked = value.status === "revoked";
  return (
    exactInstallationKeys(value) &&
    typeof value.id === "string" &&
    isUuid(value.id) &&
    typeof value.workspaceId === "string" &&
    isUuid(value.workspaceId) &&
    typeof value.botId === "string" &&
    isUuid(value.botId) &&
    (active || revoked) &&
    value.configContractId === "punks://contracts/bot.config.empty@1" &&
    typeof value.configDigest === "string" &&
    /^[0-9a-f]{64}$/.test(value.configDigest) &&
    isNonnegativeInteger(value.grantCount) &&
    isNonnegativeInteger(value.openAdmissionCount) &&
    isPositiveInteger(value.authorityGeneration) &&
    isPositiveInteger(value.revision) &&
    isPositiveInteger(value.cursor) &&
    isDateTime(value.createdAt) &&
    isDateTime(value.updatedAt) &&
    ((active && value.revokedAt === null) ||
      (revoked && isDateTime(value.revokedAt)))
  );
}

function signedInstallation(
  envelope: BotInstallationProjectionEnvelope,
): Record<string, unknown> | null {
  try {
    const content = JSON.parse(envelope.event.content) as unknown;
    if (
      !isRecord(content) ||
      !jsonValuesEqual(Object.keys(content).sort(), [
        "delta",
        "installation",
        "schemaVersion",
      ]) ||
      content.schemaVersion !== 1 ||
      !isRecord(content.installation) ||
      !isSignedInstallationSummary(content.installation) ||
      !isRecord(content.delta)
    ) {
      return null;
    }
    return content;
  } catch {
    return null;
  }
}

function consistentManagementContent(
  envelope: BotInstallationProjectionEnvelope,
): boolean {
  const content = signedInstallation(envelope);
  if (content === null) {
    return false;
  }
  const installation = content.installation;
  const signedDelta = content.delta;
  if (!isRecord(installation) || !isRecord(signedDelta)) {
    return false;
  }
  const summary = projectionSummary(envelope.delta);
  if (summary !== null) {
    if (!jsonValuesEqual(installation, summary)) {
      return false;
    }
    if (envelope.delta.operation === "revoked") {
      return (
        installation.status === "revoked" &&
        installation.revokedAt !== null &&
        jsonValuesEqual(Object.keys(signedDelta).sort(), [
          "cause",
          "operation",
        ]) &&
        signedDelta.operation === "revoked" &&
        typeof signedDelta.cause === "string" &&
        signedDelta.cause.length >= 1 &&
        signedDelta.cause.length <= 255
      );
    }
    return (
      installation.status === "active" &&
      installation.revokedAt === null &&
      jsonValuesEqual(Object.keys(signedDelta).sort(), [
        "configContractId",
        "configDigest",
        "operation",
      ]) &&
      signedDelta.operation ===
        (envelope.delta.operation === "configured"
          ? "replace-config"
          : envelope.delta.operation) &&
      signedDelta.configContractId === summary.configContractId &&
      signedDelta.configDigest === summary.configDigest
    );
  }
  if (envelope.delta.operation !== "set-grant") {
    return false;
  }
  return (
    installation.id === envelope.installationId &&
    installation.workspaceId === envelope.workspaceId &&
    installation.status === "active" &&
    installation.authorityGeneration === envelope.delta.authorityGeneration &&
    installation.revision === envelope.delta.revision &&
    installation.cursor === envelope.delta.cursor &&
    jsonValuesEqual(Object.keys(signedDelta).sort(), ["grant", "operation"]) &&
    signedDelta.operation === "set-grant" &&
    jsonValuesEqual(signedDelta.grant, {
      capability: envelope.delta.capability,
      resource: envelope.delta.resource,
      enabled: envelope.delta.enabled,
    })
  );
}

async function assertInstallationTransition(
  database: D1Database,
  envelope: BotInstallationProjectionEnvelope,
  state: InstallationSummary,
): Promise<void> {
  const current = await database
    .prepare(
      `SELECT workspace_id, installation_id, bot_id, status,
              config_contract_id, config_digest, grant_count,
              open_admission_count, authority_generation, revision,
              last_cursor, last_event_id, created_at, updated_at, revoked_at
       FROM bot_installation_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
    .bind(envelope.workspaceId, envelope.installationId)
    .first<InstallationProjectionRow>();
  const operation = envelope.delta.operation;
  if (current === null) {
    if (operation === "revoked") {
      if (
        state.status !== "revoked" ||
        state.grantCount !== 0 ||
        state.revision !== envelope.cursor ||
        state.authorityGeneration > state.revision ||
        state.revokedAt !== state.updatedAt
      ) {
        throw new RangeError(
          "Bot Installation projection has no valid revocation tombstone",
        );
      }
      return;
    }
    if (operation !== "installed") {
      throw new RangeError(
        "Bot Installation projection has no valid initial transition",
      );
    }
    if (
      envelope.cursor !== 1 ||
      state.cursor !== 1 ||
      state.revision !== 1 ||
      state.authorityGeneration !== 1 ||
      state.status !== "active" ||
      state.grantCount !== 0 ||
      state.openAdmissionCount !== 0 ||
      state.createdAt !== state.updatedAt ||
      state.revokedAt !== null
    ) {
      throw new RangeError(
        "Bot Installation projection transition has no valid install",
      );
    }
    return;
  }
  if (envelope.cursor <= current.last_cursor) {
    return;
  }
  if (
    state.workspaceId !== current.workspace_id ||
    state.id !== current.installation_id ||
    state.botId !== current.bot_id ||
    state.createdAt !== current.created_at ||
    state.revision <= current.revision ||
    state.authorityGeneration <= current.authority_generation ||
    Date.parse(state.updatedAt) < Date.parse(current.updated_at) ||
    operation === "installed" ||
    (envelope.cursor === current.last_cursor + 1 &&
      current.status === "revoked" &&
      operation !== "reinstalled") ||
    (envelope.cursor === current.last_cursor + 1 &&
      current.status === "active" &&
      operation === "reinstalled")
  ) {
    throw new RangeError("Bot Installation projection transition is invalid");
  }
  const cursorDistance = envelope.cursor - current.last_cursor;
  const intervening = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM bot_installation_event_projection
       WHERE workspace_id = ? AND installation_id = ?
         AND cursor > ? AND cursor < ?`,
    )
    .bind(
      envelope.workspaceId,
      envelope.installationId,
      current.last_cursor,
      envelope.cursor,
    )
    .first<{ count: number }>();
  const hasMissingPredecessor =
    (intervening?.count ?? 0) !== cursorDistance - 1;
  const failClosedReduction =
    operation === "revoked" ||
    (operation === "set-grant" && envelope.delta.enabled === false);
  if (hasMissingPredecessor && !failClosedReduction) {
    throw new RangeError(
      "Bot Installation projection cursor is not contiguous",
    );
  }
  if (state.revision !== current.revision + cursorDistance) {
    throw new RangeError(
      "Bot Installation projection revision is not contiguous",
    );
  }
  if (
    (!hasMissingPredecessor &&
      state.authorityGeneration !== current.authority_generation + 1) ||
    (hasMissingPredecessor &&
      state.authorityGeneration > current.authority_generation + cursorDistance)
  ) {
    throw new RangeError(
      "Bot Installation authority generation is not contiguous",
    );
  }
  const unchangedConfig =
    state.configContractId === current.config_contract_id &&
    state.configDigest === current.config_digest;
  const unchangedAdmissions =
    state.openAdmissionCount === current.open_admission_count;
  const valid =
    (operation === "reinstalled" &&
      current.status === "revoked" &&
      state.status === "active" &&
      state.grantCount === 0 &&
      unchangedAdmissions &&
      state.revokedAt === null) ||
    (operation === "revoked" &&
      current.status === "active" &&
      state.status === "revoked" &&
      state.grantCount === 0 &&
      unchangedConfig &&
      unchangedAdmissions &&
      state.revokedAt === state.updatedAt) ||
    (operation === "configured" &&
      current.status === "active" &&
      state.status === "active" &&
      state.grantCount === current.grant_count &&
      unchangedAdmissions &&
      state.revokedAt === null &&
      !unchangedConfig) ||
    (operation === "set-grant" &&
      current.status === "active" &&
      state.status === "active" &&
      unchangedConfig &&
      unchangedAdmissions &&
      state.revokedAt === null &&
      (hasMissingPredecessor
        ? envelope.delta.enabled === false &&
          state.grantCount <= current.grant_count
        : state.grantCount - current.grant_count ===
          (envelope.delta.enabled ? 1 : -1)));
  if (!valid) {
    throw new RangeError(
      "Bot Installation projection transition changes forbidden fields",
    );
  }
}

function consistentActionContent(
  envelope: BotInstallationProjectionEnvelope,
): boolean {
  if (
    envelope.delta.operation !== "action-admitted" &&
    envelope.delta.operation !== "action-completed"
  ) {
    return false;
  }
  const { admission } = envelope.delta;
  try {
    const content = JSON.parse(envelope.event.content) as unknown;
    if (
      !isRecord(content) ||
      !jsonValuesEqual(Object.keys(content).sort(), [
        "admission",
        "schemaVersion",
      ]) ||
      content.schemaVersion !== 1 ||
      !jsonValuesEqual(content.admission, admission) ||
      !hasExactTag(envelope, "admission", [admission.id]) ||
      !hasExactTag(envelope, "action", [
        admission.actionId,
        admission.actionDigest,
      ])
    ) {
      return false;
    }
    if (envelope.delta.operation === "action-admitted") {
      return (
        admission.status === "admitted" &&
        hasExactTag(envelope, "action_contract", [admission.actionContract]) &&
        hasExactTag(envelope, "capability", [admission.capability]) &&
        hasExactTag(envelope, "conversation", [
          admission.resource.conversationId,
        ]) &&
        hasExactTag(envelope, "message", [admission.resource.messageId])
      );
    }
    return (
      admission.status === "completed" &&
      admission.outcome !== null &&
      hasExactTag(envelope, "outcome", [admission.outcome])
    );
  } catch {
    return false;
  }
}

function consistentScope(
  envelope: BotInstallationProjectionEnvelope,
): { botId: string } | null {
  const summary = projectionSummary(envelope.delta);
  if (summary !== null) {
    return summary.id === envelope.installationId &&
      summary.workspaceId === envelope.workspaceId &&
      summary.cursor === envelope.cursor
      ? { botId: summary.botId }
      : null;
  }
  if (
    envelope.delta.operation === "set-grant" &&
    envelope.delta.cursor !== envelope.cursor
  ) {
    return null;
  }
  if (
    envelope.delta.operation === "action-admitted" ||
    envelope.delta.operation === "action-completed"
  ) {
    const { admission } = envelope.delta;
    return admission.workspaceId === envelope.workspaceId &&
      admission.installationId === envelope.installationId &&
      (envelope.delta.operation !== "action-admitted" ||
        admission.admittedCursor === envelope.cursor) &&
      (envelope.delta.operation !== "action-completed" ||
        admission.completedCursor === envelope.cursor)
      ? { botId: admission.botId }
      : null;
  }
  const content = signedInstallation(envelope);
  const installation = content?.installation;
  return isRecord(installation) && typeof installation.botId === "string"
    ? { botId: installation.botId }
    : null;
}

/** Binds a schema-valid Installation delta to its exact signed event. */
export function isConsistentBotInstallationProjection(
  envelope: BotInstallationProjectionEnvelope,
): boolean {
  const expected = expectedEvent(envelope.delta);
  const scope = consistentScope(envelope);
  if (
    scope === null ||
    envelope.contract !== "bot-installation.projection@1" ||
    envelope.event.kind !== expected.kind ||
    !hasExactSignedTags(envelope, scope.botId, expected.contract)
  ) {
    return false;
  }
  if (
    envelope.delta.operation === "action-admitted" ||
    envelope.delta.operation === "action-completed"
  ) {
    return consistentActionContent(envelope);
  }
  return consistentManagementContent(envelope);
}

function installationFromEvent(
  envelope: BotInstallationProjectionEnvelope,
): InstallationSummary {
  const explicit = projectionSummary(envelope.delta);
  if (explicit !== null) {
    return explicit;
  }
  const content = signedInstallation(envelope);
  const installation = content?.installation;
  if (!isRecord(installation) || !isSignedInstallationSummary(installation)) {
    throw new RangeError("Installation projection has no signed summary");
  }
  return installation;
}

function installationUpsert(
  database: D1Database,
  envelope: BotInstallationProjectionEnvelope,
  state: InstallationSummary,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO bot_installation_projection
        (workspace_id, installation_id, bot_id, status, config_contract_id,
         config_digest, grant_count, open_admission_count,
         authority_generation, revision, last_cursor, last_event_id,
         created_at, updated_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, installation_id) DO UPDATE SET
         bot_id = excluded.bot_id,
         status = excluded.status,
         config_contract_id = excluded.config_contract_id,
         config_digest = excluded.config_digest,
         grant_count = excluded.grant_count,
         open_admission_count = excluded.open_admission_count,
         authority_generation = excluded.authority_generation,
         revision = excluded.revision,
         last_cursor = excluded.last_cursor,
         last_event_id = excluded.last_event_id,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         revoked_at = excluded.revoked_at
       WHERE excluded.bot_id = bot_installation_projection.bot_id
         AND excluded.last_cursor > bot_installation_projection.last_cursor`,
    )
    .bind(
      state.workspaceId,
      state.id,
      state.botId,
      state.status,
      state.configContractId,
      state.configDigest,
      state.grantCount,
      state.openAdmissionCount,
      state.authorityGeneration,
      state.revision,
      envelope.cursor,
      envelope.event.id,
      state.createdAt,
      state.updatedAt,
      state.revokedAt,
    );
}

function winningInstallationPredicate(): string {
  return `EXISTS (
    SELECT 1 FROM bot_installation_projection
    WHERE workspace_id = ? AND installation_id = ?
      AND last_cursor = ? AND last_event_id = ?
  )`;
}

/** Projects one validated Installation management delta on its Workspace shard. */
export async function projectBotInstallationEnvelope(
  database: D1Database,
  envelope: BotInstallationProjectionEnvelope,
  projectedAt = new Date(),
): Promise<void> {
  if (!isConsistentBotInstallationProjection(envelope)) {
    throw new RangeError("Bot Installation projection is inconsistent");
  }
  const scope = [envelope.workspaceId, envelope.installationId] as const;
  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO bot_installation_event_projection
          (workspace_id, installation_id, event_id, cursor, kind, projected_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, installation_id, event_id) DO NOTHING`,
      )
      .bind(
        ...scope,
        envelope.event.id,
        envelope.cursor,
        envelope.event.kind,
        projectedAt.toISOString(),
      ),
  ];

  if (
    envelope.delta.operation === "action-admitted" ||
    envelope.delta.operation === "action-completed"
  ) {
    const { admission } = envelope.delta;
    statements.push(
      database
        .prepare(
          `INSERT INTO bot_action_admission_projection
            (workspace_id, installation_id, admission_id, action_id,
             action_digest, bot_id, action_contract, capability, risk,
             resource_kind, conversation_id, message_id, status, outcome,
             installation_cursor, authority_generation, admitted_cursor,
             completed_cursor, admitted_at, completed_at, last_cursor,
             last_event_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?)
           ON CONFLICT(workspace_id, installation_id, admission_id)
           DO UPDATE SET
             action_id = CASE
               WHEN excluded.action_id =
                      bot_action_admission_projection.action_id
                 AND excluded.action_digest =
                      bot_action_admission_projection.action_digest
                 AND excluded.bot_id = bot_action_admission_projection.bot_id
                 AND excluded.action_contract =
                      bot_action_admission_projection.action_contract
                 AND excluded.capability =
                      bot_action_admission_projection.capability
                 AND excluded.risk = bot_action_admission_projection.risk
                 AND excluded.resource_kind =
                      bot_action_admission_projection.resource_kind
                 AND excluded.conversation_id =
                      bot_action_admission_projection.conversation_id
                 AND excluded.message_id =
                      bot_action_admission_projection.message_id
                 AND excluded.installation_cursor =
                      bot_action_admission_projection.installation_cursor
                 AND excluded.authority_generation =
                      bot_action_admission_projection.authority_generation
                 AND excluded.admitted_cursor =
                      bot_action_admission_projection.admitted_cursor
                 AND excluded.admitted_at =
                      bot_action_admission_projection.admitted_at
                 AND NOT (
                   bot_action_admission_projection.status = 'completed'
                   AND excluded.status = 'completed'
                   AND excluded.outcome !=
                     bot_action_admission_projection.outcome
                 )
               THEN bot_action_admission_projection.action_id
               ELSE NULL
             END,
             status = CASE
               WHEN bot_action_admission_projection.status = 'completed'
               THEN 'completed'
               ELSE excluded.status
             END,
             outcome = CASE
               WHEN bot_action_admission_projection.status = 'completed'
               THEN bot_action_admission_projection.outcome
               ELSE excluded.outcome
             END,
             completed_cursor = CASE
               WHEN bot_action_admission_projection.status = 'completed'
               THEN bot_action_admission_projection.completed_cursor
               ELSE excluded.completed_cursor
             END,
             completed_at = CASE
               WHEN bot_action_admission_projection.status = 'completed'
               THEN bot_action_admission_projection.completed_at
               ELSE excluded.completed_at
             END,
             last_cursor = MAX(
               bot_action_admission_projection.last_cursor,
               excluded.last_cursor
             ),
             last_event_id = CASE
               WHEN excluded.last_cursor >
                    bot_action_admission_projection.last_cursor
               THEN excluded.last_event_id
               ELSE bot_action_admission_projection.last_event_id
             END`,
        )
        .bind(
          ...scope,
          admission.id,
          admission.actionId,
          admission.actionDigest,
          admission.botId,
          admission.actionContract,
          admission.capability,
          admission.risk,
          admission.resource.kind,
          admission.resource.conversationId,
          admission.resource.messageId,
          admission.status,
          admission.outcome,
          admission.installationCursor,
          admission.authorityGeneration,
          admission.admittedCursor,
          admission.completedCursor,
          admission.admittedAt,
          admission.completedAt,
          envelope.cursor,
          envelope.event.id,
        ),
      database
        .prepare(
          `UPDATE bot_installation_projection
           SET open_admission_count = (
             SELECT COUNT(*) FROM bot_action_admission_projection AS receipt
             WHERE receipt.workspace_id =
                   bot_installation_projection.workspace_id
               AND receipt.installation_id =
                   bot_installation_projection.installation_id
               AND receipt.status = 'admitted'
           )
           WHERE workspace_id = ? AND installation_id = ?`,
        )
        .bind(...scope),
    );
    await database.batch(statements);
    return;
  }

  const state = installationFromEvent(envelope);
  await assertInstallationTransition(database, envelope, state);
  const winner = [...scope, envelope.cursor, envelope.event.id] as const;
  statements.push(installationUpsert(database, envelope, state));

  if (envelope.delta.operation === "set-grant") {
    const { delta } = envelope;
    statements.push(
      database
        .prepare(
          `INSERT INTO bot_installation_grant_projection
            (workspace_id, installation_id, capability, resource_kind,
             conversation_id, enabled, authority_generation, revision,
             last_cursor, last_event_id)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM bot_installation_projection
             WHERE workspace_id = ? AND installation_id = ?
               AND last_cursor = ? AND last_event_id = ?
               AND status = 'active' AND authority_generation = ?
           )
           ON CONFLICT(
             workspace_id, installation_id, capability, resource_kind,
             conversation_id
           ) DO UPDATE SET
             enabled = excluded.enabled,
             authority_generation = excluded.authority_generation,
             revision = excluded.revision,
             last_cursor = excluded.last_cursor,
             last_event_id = excluded.last_event_id
           WHERE excluded.last_cursor >
             bot_installation_grant_projection.last_cursor`,
        )
        .bind(
          ...scope,
          delta.capability,
          delta.resource.kind,
          delta.resource.conversationId,
          delta.enabled ? 1 : 0,
          delta.authorityGeneration,
          delta.revision,
          delta.cursor,
          envelope.event.id,
          ...scope,
          envelope.cursor,
          envelope.event.id,
          delta.authorityGeneration,
        ),
    );
  } else if (
    envelope.delta.operation === "reinstalled" ||
    envelope.delta.operation === "revoked"
  ) {
    statements.push(
      database
        .prepare(
          `UPDATE bot_installation_grant_projection
           SET enabled = 0,
               authority_generation = ?,
               revision = ?,
               last_cursor = ?,
               last_event_id = ?
           WHERE workspace_id = ? AND installation_id = ?
             AND last_cursor < ?
             AND ${winningInstallationPredicate()}`,
        )
        .bind(
          state.authorityGeneration,
          state.revision,
          envelope.cursor,
          envelope.event.id,
          ...scope,
          envelope.cursor,
          ...winner,
        ),
    );
  }

  statements.push(
    database
      .prepare(
        `UPDATE bot_installation_projection
         SET grant_count = (
           SELECT COUNT(*) FROM bot_installation_grant_projection AS grant_row
           WHERE grant_row.workspace_id = bot_installation_projection.workspace_id
             AND grant_row.installation_id =
               bot_installation_projection.installation_id
             AND grant_row.enabled = 1
         )
         WHERE workspace_id = ? AND installation_id = ?
           AND ${winningInstallationPredicate()}`,
      )
      .bind(...scope, ...winner),
    database
      .prepare(
        `UPDATE bot_installation_projection
         SET open_admission_count = (
           SELECT COUNT(*) FROM bot_action_admission_projection AS receipt
           WHERE receipt.workspace_id = bot_installation_projection.workspace_id
             AND receipt.installation_id =
               bot_installation_projection.installation_id
             AND receipt.status = 'admitted'
         )
         WHERE workspace_id = ? AND installation_id = ?
           AND ${winningInstallationPredicate()}`,
      )
      .bind(...scope, ...winner),
  );

  await database.batch(statements);
}
