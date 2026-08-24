import type { BotProjectionEnvelope } from "@punks/contracts";

interface BotProjectionRow {
  bot_id: string;
  slug: string;
  name: string;
  description: string;
  status: "published" | "suspended" | "withdrawn";
  config_contract_id: string;
  supported_action_contracts_json: string;
  revision: number;
  last_cursor: number;
  last_event_id: string;
  created_at: string;
  updated_at: string;
  suspended_at: string | null;
  withdrawn_at: string | null;
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

function isUuid(value: string | undefined): boolean {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function hasExactSignedTags(
  envelope: BotProjectionEnvelope,
  contract: string,
): boolean {
  const tags = envelope.event.tags;
  return (
    tags.length === 6 &&
    jsonValuesEqual(tags[0], ["bot", envelope.botId]) &&
    tags[1]?.length === 2 &&
    jsonValuesEqual(tags[1], ["cursor", String(envelope.cursor)]) &&
    tags[2]?.length === 2 &&
    tags[2]?.[0] === "command" &&
    isUuid(tags[2]?.[1]) &&
    jsonValuesEqual(tags[3], ["contract", contract]) &&
    tags[4]?.length === 3 &&
    tags[4]?.[0] === "actor" &&
    tags[4]?.[1] === "punk" &&
    isUuid(tags[4]?.[2]) &&
    tags[5]?.length === 2 &&
    tags[5]?.[0] === "attestation" &&
    (tags[5]?.[1]?.length ?? 0) > 0
  );
}

function hasConsistentDelta(
  envelope: BotProjectionEnvelope,
  value: object,
): boolean {
  const operation = Reflect.get(value, "operation");
  if (envelope.event.kind === 50300) {
    return jsonValuesEqual(value, { operation: "published" });
  }
  if (operation === "set-slug") {
    return (
      jsonValuesEqual(Object.keys(value).sort(), ["operation", "slug"]) &&
      Reflect.get(value, "slug") === envelope.state.slug
    );
  }
  if (operation === "set-metadata") {
    const name = Reflect.get(value, "name");
    const description = Reflect.get(value, "description");
    const keys = Object.keys(value).sort();
    return (
      (jsonValuesEqual(keys, ["name", "operation"]) ||
        jsonValuesEqual(keys, ["description", "operation"]) ||
        jsonValuesEqual(keys, ["description", "name", "operation"])) &&
      (name === undefined || name === envelope.state.name) &&
      (description === undefined || description === envelope.state.description)
    );
  }
  if (operation === "set-actions") {
    return (
      jsonValuesEqual(Object.keys(value).sort(), [
        "operation",
        "supportedActionContracts",
      ]) &&
      jsonValuesEqual(
        Reflect.get(value, "supportedActionContracts"),
        envelope.state.supportedActionContracts,
      )
    );
  }
  return (
    operation === "set-status" &&
    jsonValuesEqual(Object.keys(value).sort(), ["operation", "status"]) &&
    Reflect.get(value, "status") === envelope.state.status
  );
}

function parsedDelta(envelope: BotProjectionEnvelope): Record<string, unknown> {
  const content = JSON.parse(envelope.event.content) as {
    delta: Record<string, unknown>;
  };
  return content.delta;
}

function sameJson(left: unknown, right: unknown): boolean {
  return jsonValuesEqual(left, right);
}

function assertBotTransition(
  current: BotProjectionRow | null,
  envelope: BotProjectionEnvelope,
): void {
  const { state } = envelope;
  if (current === null) {
    if (
      envelope.event.kind !== 50300 ||
      envelope.cursor !== 1 ||
      state.revision !== 1 ||
      state.status !== "published" ||
      state.createdAt !== state.updatedAt ||
      state.suspendedAt !== null ||
      state.withdrawnAt !== null
    ) {
      throw new RangeError("Bot projection transition has no valid publish");
    }
    return;
  }
  if (envelope.cursor <= current.last_cursor) {
    return;
  }
  if (
    current.status === "withdrawn" ||
    envelope.event.kind !== 50301 ||
    state.id !== current.bot_id ||
    state.configContractId !== current.config_contract_id ||
    state.createdAt !== current.created_at ||
    state.revision <= current.revision ||
    Date.parse(state.updatedAt) < Date.parse(current.updated_at)
  ) {
    throw new RangeError("Bot projection transition is invalid");
  }
  if (
    envelope.cursor !== current.last_cursor + 1 ||
    state.revision !== current.revision + 1
  ) {
    throw new RangeError("Bot projection cursor or revision is not contiguous");
  }
  const delta = parsedDelta(envelope);
  const operation = delta.operation;
  const actions = JSON.parse(
    current.supported_action_contracts_json,
  ) as unknown;
  const baseUnchanged =
    state.createdAt === current.created_at &&
    state.configContractId === current.config_contract_id;
  const metadataUnchanged =
    state.name === current.name && state.description === current.description;
  const lifecycleUnchanged =
    state.status === current.status &&
    state.suspendedAt === current.suspended_at &&
    state.withdrawnAt === current.withdrawn_at;
  const slugUnchanged = state.slug === current.slug;
  const actionsUnchanged = sameJson(state.supportedActionContracts, actions);
  const valid =
    baseUnchanged &&
    ((operation === "set-slug" &&
      state.slug !== current.slug &&
      metadataUnchanged &&
      lifecycleUnchanged &&
      actionsUnchanged) ||
      (operation === "set-metadata" &&
        slugUnchanged &&
        lifecycleUnchanged &&
        actionsUnchanged &&
        (state.name !== current.name ||
          state.description !== current.description)) ||
      (operation === "set-actions" &&
        slugUnchanged &&
        metadataUnchanged &&
        lifecycleUnchanged &&
        !actionsUnchanged) ||
      (operation === "set-status" &&
        slugUnchanged &&
        metadataUnchanged &&
        actionsUnchanged &&
        state.status !== current.status));
  if (!valid) {
    throw new RangeError("Bot projection transition changes forbidden fields");
  }
}

/** Binds a schema-valid global Bot projection to its exact signed event. */
export function isConsistentBotProjection(
  envelope: BotProjectionEnvelope,
): boolean {
  const expectedContract =
    envelope.event.kind === 50300
      ? "bot.publish@1"
      : envelope.event.kind === 50301
        ? "bot.update@1"
        : null;
  if (
    expectedContract === null ||
    envelope.contract !== "bot.projection@1" ||
    envelope.botId !== envelope.state.id ||
    envelope.cursor !== envelope.state.cursor ||
    !hasExactSignedTags(envelope, expectedContract)
  ) {
    return false;
  }

  try {
    const content = JSON.parse(envelope.event.content) as unknown;
    if (
      typeof content !== "object" ||
      content === null ||
      !jsonValuesEqual(Object.keys(content).sort(), [
        "bot",
        "delta",
        "schemaVersion",
      ]) ||
      Reflect.get(content, "schemaVersion") !== 1 ||
      !jsonValuesEqual(Reflect.get(content, "bot"), envelope.state)
    ) {
      return false;
    }
    const delta = Reflect.get(content, "delta");
    return (
      typeof delta === "object" &&
      delta !== null &&
      !Array.isArray(delta) &&
      hasConsistentDelta(envelope, delta)
    );
  } catch {
    return false;
  }
}

/** Projects one validated Bot envelope into the global shard-0 catalogue. */
export async function projectBotEnvelope(
  database: D1Database,
  envelope: BotProjectionEnvelope,
  projectedAt = new Date(),
): Promise<void> {
  if (!isConsistentBotProjection(envelope)) {
    throw new RangeError("Bot projection is inconsistent");
  }
  const current = await database
    .prepare(
      `SELECT bot_id, slug, name, description, status, config_contract_id,
              supported_action_contracts_json, revision, last_cursor,
              last_event_id, created_at, updated_at, suspended_at, withdrawn_at
       FROM bot_projection WHERE bot_id = ?`,
    )
    .bind(envelope.botId)
    .first<BotProjectionRow>();
  assertBotTransition(current, envelope);
  const { state } = envelope;
  await database.batch([
    database
      .prepare(
        `INSERT INTO bot_event_projection
          (bot_id, event_id, cursor, kind, projected_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(bot_id, event_id) DO NOTHING`,
      )
      .bind(
        envelope.botId,
        envelope.event.id,
        envelope.cursor,
        envelope.event.kind,
        projectedAt.toISOString(),
      ),
    database
      .prepare(
        `INSERT INTO bot_projection
          (bot_id, slug, name, description, status, config_contract_id,
           supported_action_contracts_json, revision, last_cursor,
           last_event_id, created_at, updated_at, suspended_at, withdrawn_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(bot_id) DO UPDATE SET
           slug = excluded.slug,
           name = excluded.name,
           description = excluded.description,
           status = excluded.status,
           config_contract_id = excluded.config_contract_id,
           supported_action_contracts_json =
             excluded.supported_action_contracts_json,
           revision = excluded.revision,
           last_cursor = excluded.last_cursor,
           last_event_id = excluded.last_event_id,
           created_at = excluded.created_at,
           updated_at = excluded.updated_at,
           suspended_at = excluded.suspended_at,
           withdrawn_at = excluded.withdrawn_at
         WHERE excluded.last_cursor > bot_projection.last_cursor
           AND bot_projection.status != 'withdrawn'`,
      )
      .bind(
        state.id,
        state.slug,
        state.name,
        state.description,
        state.status,
        state.configContractId,
        JSON.stringify(state.supportedActionContracts),
        state.revision,
        envelope.cursor,
        envelope.event.id,
        state.createdAt,
        state.updatedAt,
        state.suspendedAt,
        state.withdrawnAt,
      ),
  ]);
}
