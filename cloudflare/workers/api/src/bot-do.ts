import type {
  AttestationResponse,
  Bot,
  BotJournalSegmentArchive,
  BotProjectionEnvelope,
  GetBotQuery,
  SignedNostrEvent,
  UnsignedNostrEvent,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  BotDomainError,
  canonicalJson,
  executeBot,
  prepareBotJournalSegment,
  queryBot,
  sha256Hex,
  verifyBotJournalSegmentHash,
} from "@punks/core";
import { DurableObject } from "cloudflare:workers";

import {
  parseBotCommandReceiptArchive,
  prepareBotCommandReceipt,
} from "./bot-command-receipt";
import {
  CommandReceiptArchiveError,
  commandReceiptCoordinate,
  readCommandReceiptArchive,
  type PreparedCommandReceiptArchive,
  writeCommandReceiptArchive,
} from "./command-receipt-archive";
import type { ApiEnv } from "./env";
import { verifyAttestation } from "./attestation-verification";
import type {
  BotExecuteRequest,
  BotExecuteResult,
  BotQueryResult,
  CommittedBotCommand,
} from "./rpc";

type StateRow = Record<"state_json", string>;
type ResultRow = Record<"payload_hash" | "response_json", string>;
type LegacyResultRow = Record<
  "command_id" | "payload_hash" | "response_json",
  string
>;
type PendingRow = Record<
  | "command_id"
  | "payload_hash"
  | "command_json"
  | "unsigned_json"
  | "next_state_json"
  | "previous_slug"
  | "reduction_overlay"
  | "attempts",
  string | number | null
>;
type OutboxRow = Record<
  "event_id" | "payload_json" | "attempts",
  string | number
>;
type JournalRow = Record<"cursor" | "event_json", string | number>;
type ArchiveHeadRow = Record<"end_cursor" | "segment_hash", string | number>;
type PendingArchiveRow = Record<
  | "start_cursor"
  | "end_cursor"
  | "previous_segment_hash"
  | "segment_hash"
  | "object_key"
  | "events_json"
  | "unsigned_seal_json"
  | "attempts",
  string | number | null
>;
type CommandReceiptArchiveOutboxRow = Record<
  | "command_id"
  | "payload_hash"
  | "object_key"
  | "archive_json"
  | "body_hash"
  | "attempts",
  string | number
>;

const maximumArchiveBodyBytes = 4_500_000;
const maximumArchiveEventBytes = 4_000_000;
// JSON Schema bounds keep one projection below 64 KiB and one complete
// idempotency row below 128 KiB. Usage is measured as UTF-8 BLOB bytes so
// multibyte text cannot consume the terminal reserve invisibly.
const maximumNormalUndeliveredOutboxRows = 256;
const maximumNormalUndeliveredOutboxBytes = 524_288;
const maximumProjectionPayloadBytes = 65_536;
const maximumNormalCommandResultRows = 256;
const maximumNormalCommandResultBytes = 16_777_216;
const maximumCommandResultRowBytes = 131_072;
// With three supported actions, at most two strict-subset commands remain.
// A published Bot then has at most two monotonic status reductions remaining.
const maximumActionReductionCommands = 2;
const maximumStatusReductionCommands = 2;
const maximumTerminalReductionCommands =
  maximumActionReductionCommands + maximumStatusReductionCommands;
// The pending_command singleton is the separately bounded +1 transient row;
// these four slots are exclusively for terminal outbox/result commits.
const maximumUndeliveredOutboxRows =
  maximumNormalUndeliveredOutboxRows + maximumTerminalReductionCommands;
const maximumUndeliveredOutboxBytes =
  maximumNormalUndeliveredOutboxBytes +
  maximumTerminalReductionCommands * maximumProjectionPayloadBytes;
const maximumCommandResultRows =
  maximumNormalCommandResultRows + maximumTerminalReductionCommands;
const maximumCommandResultBytes =
  maximumNormalCommandResultBytes +
  maximumTerminalReductionCommands * maximumCommandResultRowBytes;
const maximumRetryAttempts = 63;
const commandReceiptArchiveBatchSize = 20;

const statusRank: Readonly<Record<Bot["status"], number>> = {
  published: 0,
  suspended: 1,
  withdrawn: 2,
};

/** Strong global authority for one Punks-operated Bot definition. */
export class BotDO extends DurableObject<ApiEnv> {
  private alarmScheduling: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initialize();
      await this.repairDurableAlarm();
    });
  }

  async execute(input: unknown): Promise<BotExecuteResult> {
    if (!isBotExecuteRequest(input)) {
      return { ok: false, code: "invalid_contract" };
    }
    const command = input.command;
    const contractId =
      command.contract === "bot.publish@1"
        ? "punks://contracts/bot.publish@1"
        : command.contract === "bot.update@1"
          ? "punks://contracts/bot.update@1"
          : null;
    if (contractId === null || !validateContract(contractId, command).valid) {
      return { ok: false, code: "invalid_contract" };
    }
    if (!input.operatorAuthorized) {
      return { ok: false, code: "forbidden" };
    }

    const botId = this.ctx.id.name ?? "";
    if (botId.length === 0) {
      return { ok: false, code: "internal" };
    }
    if (command.contract === "bot.update@1" && command.botId !== botId) {
      return { ok: false, code: "not_found" };
    }

    const payloadHash = await sha256Hex(canonicalJson(command));
    const cold = await this.coldResult(botId, command.commandId);
    if (cold.status === "unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (cold.status === "found") {
      if (cold.payloadHash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (
        !this.reconcileColdResult(
          command.commandId,
          cold.payloadHash,
          cold.value,
        )
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      return { ok: true, value: cold.value, replayed: true };
    }
    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: true,
        value: canonicalCommittedBotCommand(
          JSON.parse(completed.response_json) as CommittedBotCommand,
        ),
        replayed: true,
      };
    }

    let pending = this.pending();
    if (pending !== undefined) {
      if (pending.command_id !== command.commandId) {
        return { ok: false, code: "command_in_progress" };
      }
      if (pending.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return this.attestAndFinalize(pending, true);
    }

    const current = this.committedState();
    try {
      const decision = executeBot(current, command, {
        botId,
        cursor: (current?.cursor ?? 0) + 1,
        now: new Date(),
        operatorAuthorized: input.operatorAuthorized,
      });
      if (
        !validateContract("punks://contracts/bot@1", decision.nextState)
          .valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }
      const actionDelta = classifyActionDelta(current, decision.nextState);
      if (actionDelta === "mixed") {
        return { ok: false, code: "invalid_transition" };
      }
      const reductionOverlay =
        current !== null &&
        (statusRank[decision.nextState.status] > statusRank[current.status] ||
          actionDelta === "reduction");
      if (
        !this.hasCommandResultCapacity(reductionOverlay) &&
        !(await this.ensureCommandResultCapacity(reductionOverlay))
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (!this.hasOutboxCapacity(reductionOverlay)) {
        return { ok: false, code: "internal" };
      }
      if (!reductionOverlay && !(await this.ensureJournalCapacity())) {
        return { ok: false, code: "internal" };
      }
      if (
        !this.hasOutboxCapacity(reductionOverlay) ||
        !this.hasCommandResultCapacity(reductionOverlay)
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (
        this.pending() !== undefined ||
        canonicalJson(this.committedState()) !== canonicalJson(current)
      ) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_command
          (singleton, command_id, payload_hash, command_json, unsigned_json,
           next_state_json, previous_slug, reduction_overlay, attempts,
           created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(decision.event),
        JSON.stringify(decision.nextState),
        command.contract === "bot.update@1" &&
          command.payload.operation === "set-slug"
          ? (current?.slug ?? null)
          : null,
        reductionOverlay ? 1 : 0,
        new Date().toISOString(),
      );
      pending = this.pending();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      await this.ensureAlarmAt(Date.now() + 1_000);
      return this.attestAndFinalize(pending, false);
    } catch (error) {
      if (error instanceof BotDomainError) {
        return {
          ok: false,
          code:
            error.code === "already_exists" ? "invalid_transition" : error.code,
        };
      }
      return { ok: false, code: "internal" };
    }
  }

  query(input: unknown): BotQueryResult {
    if (!validateContract("punks://contracts/bot.get@1", input).valid) {
      return { ok: false, code: "invalid_contract" };
    }
    try {
      const state = queryBot(this.effectiveState(), input as GetBotQuery);
      if (!validateContract("punks://contracts/bot@1", state).valid) {
        return { ok: false, code: "internal" };
      }
      return { ok: true, state };
    } catch (error) {
      if (error instanceof BotDomainError && error.code === "not_found") {
        return { ok: false, code: "not_found" };
      }
      return { ok: false, code: "internal" };
    }
  }

  override async alarm(): Promise<void> {
    const pending = this.pending();
    if (pending !== undefined) {
      await this.attestAndFinalize(pending, true);
      if (this.pending() !== undefined) {
        return;
      }
    }
    await this.flushOutbox();
    await this.archiveCommandReceipts();
    await this.archiveJournalIfNeeded();
  }

  private initialize(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS bot_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS command_results (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL,
        command_json TEXT NOT NULL,
        response_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS command_receipt_archive_outbox (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        object_key TEXT NOT NULL UNIQUE,
        archive_json TEXT NOT NULL
          CHECK (length(CAST(archive_json AS BLOB)) <= 131072),
        body_hash TEXT NOT NULL CHECK (length(body_hash) = 64),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 63),
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_command (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_state_json TEXT NOT NULL,
        previous_slug TEXT,
        reduction_overlay INTEGER NOT NULL CHECK (reduction_overlay IN (0, 1)),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS journal (
        cursor INTEGER PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_kind INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY NOT NULL,
        cursor INTEGER NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE IF NOT EXISTS archive_segments (
        start_cursor INTEGER PRIMARY KEY NOT NULL,
        end_cursor INTEGER NOT NULL UNIQUE,
        previous_segment_hash TEXT,
        segment_hash TEXT NOT NULL UNIQUE,
        object_key TEXT NOT NULL UNIQUE,
        seal_json TEXT NOT NULL,
        archived_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_archive (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        start_cursor INTEGER NOT NULL,
        end_cursor INTEGER NOT NULL,
        previous_segment_hash TEXT,
        segment_hash TEXT NOT NULL,
        object_key TEXT NOT NULL,
        events_json TEXT NOT NULL,
        unsigned_seal_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_archive_seals (
        segment_hash TEXT PRIMARY KEY NOT NULL,
        seal_json TEXT NOT NULL,
        persisted_at TEXT NOT NULL
      ) STRICT;
    `);
    const pendingColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_command)")
      .toArray();
    if (!pendingColumns.some((column) => column.name === "command_json")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN command_json TEXT NOT NULL DEFAULT '{}'",
      );
    }
    this.ctx.storage.sql.exec(
      "DELETE FROM outbox WHERE delivered_at IS NOT NULL",
    );
  }

  private committedState(): Bot | null {
    const row = this.ctx.storage.sql
      .exec<StateRow>("SELECT state_json FROM bot_state WHERE singleton = 1")
      .toArray()[0];
    return row === undefined ? null : (JSON.parse(row.state_json) as Bot);
  }

  private effectiveState(): Bot | null {
    const committed = this.committedState();
    const pending = this.pending();
    if (pending === undefined || Number(pending.reduction_overlay) !== 1) {
      return committed;
    }
    const reduced = parseBot(String(pending.next_state_json));
    const event = parseUnsignedEvent(String(pending.unsigned_json));
    const command = parseBotCommand(String(pending.command_json));
    return committed !== null &&
      reduced !== null &&
      event !== null &&
      command !== null &&
      validBotPendingDecision(committed, command, reduced, event, true)
      ? reduced
      : null;
  }

  private result(commandId: string): ResultRow | undefined {
    return this.ctx.storage.sql
      .exec<ResultRow>(
        "SELECT payload_hash, response_json FROM command_results WHERE command_id = ?",
        commandId,
      )
      .toArray()[0];
  }

  private async coldResult(
    botId: string,
    commandId: string,
  ): Promise<
    | { status: "missing" }
    | {
        status: "found";
        payloadHash: string;
        value: CommittedBotCommand;
      }
    | { status: "unavailable" }
  > {
    try {
      const coordinate = await commandReceiptCoordinate({
        aggregate: "bot",
        aggregateId: botId,
        commandId,
      });
      const stored = await readCommandReceiptArchive(
        this.env.JOURNAL_ARCHIVE_BUCKET,
        coordinate,
      );
      if (stored.status === "missing") {
        return stored;
      }
      const archive = await parseBotCommandReceiptArchive({
        value: stored.value,
        expectedBotId: botId,
        expectedCommandId: commandId,
        metadataPayloadHash: stored.metadata.payloadHash,
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
      return {
        status: "found",
        payloadHash: archive.payloadHash,
        value: canonicalCommittedBotCommand(
          archive.terminal.value as CommittedBotCommand,
        ),
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  private reconcileColdResult(
    commandId: string,
    payloadHash: string,
    archived: CommittedBotCommand,
  ): boolean {
    const current = this.committedState();
    if (
      current !== null &&
      current.cursor === archived.state.cursor &&
      canonicalJson(current) !== canonicalJson(archived.state)
    ) {
      return false;
    }
    const restoredPending = this.pending();
    const needsStateRecovery =
      current === null || current.cursor < archived.state.cursor;
    let recovery:
      | {
          pending: PendingRow;
          projection: BotProjectionEnvelope;
          projectionJson: string;
          reduction: boolean;
        }
      | undefined;
    if (needsStateRecovery) {
      const command =
        restoredPending === undefined
          ? null
          : parseBotCommand(String(restoredPending.command_json));
      const unsigned =
        restoredPending === undefined
          ? null
          : parseUnsignedEvent(String(restoredPending.unsigned_json));
      const reduction = Number(restoredPending?.reduction_overlay) === 1;
      const projection: BotProjectionEnvelope = {
        contract: "bot.projection@1",
        botId: archived.state.id,
        cursor: archived.state.cursor,
        event: archived.event,
        state: archived.state,
      };
      const projectionJson = JSON.stringify(projection);
      if (
        restoredPending === undefined ||
        restoredPending.command_id !== commandId ||
        restoredPending.payload_hash !== payloadHash ||
        archived.state.cursor !== (current?.cursor ?? 0) + 1 ||
        canonicalJson(parseJson(String(restoredPending.next_state_json))) !==
          canonicalJson(archived.state) ||
        command === null ||
        unsigned === null ||
        !signedEventPreservesUnsigned(unsigned, archived.event) ||
        !validBotPendingDecision(
          current,
          command,
          archived.state,
          unsigned,
          reduction,
        ) ||
        !validateContract("punks://contracts/bot.projection@1", projection)
          .valid ||
        utf8ByteLength(projectionJson) > maximumProjectionPayloadBytes ||
        !this.hasOutboxCapacity(reduction)
      ) {
        return false;
      }
      recovery = {
        pending: restoredPending,
        projection,
        projectionJson,
        reduction,
      };
    }
    try {
      this.ctx.storage.transactionSync(() => {
        const checked = this.committedState();
        if (canonicalJson(checked) !== canonicalJson(current)) {
          throw new Error(
            "Bot state changed during cold receipt reconciliation",
          );
        }
        if (recovery !== undefined) {
          const checkedPending = this.pending();
          if (!samePendingCommand(checkedPending, recovery.pending)) {
            throw new Error(
              "PITR pending command changed during cold reconciliation",
            );
          }
          const journal = this.ctx.storage.sql
            .exec<{ event_id: string; event_json: string }>(
              "SELECT event_id, event_json FROM journal WHERE cursor = ?",
              archived.state.cursor,
            )
            .toArray()[0];
          if (
            journal !== undefined &&
            (journal.event_id !== archived.event.id ||
              canonicalJson(parseJson(journal.event_json)) !==
                canonicalJson(archived.event))
          ) {
            throw new Error("PITR journal conflicts with the cold terminal");
          }
          const projection = this.ctx.storage.sql
            .exec<{ event_id: string; payload_json: string }>(
              "SELECT event_id, payload_json FROM outbox WHERE cursor = ?",
              archived.state.cursor,
            )
            .toArray()[0];
          if (
            projection !== undefined &&
            (projection.event_id !== archived.event.id ||
              canonicalJson(parseJson(projection.payload_json)) !==
                canonicalJson(recovery.projection))
          ) {
            throw new Error("PITR projection conflicts with the cold terminal");
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)
             ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
            JSON.stringify(archived.state),
          );
          if (journal === undefined) {
            this.ctx.storage.sql.exec(
              `INSERT INTO journal
                (cursor, event_id, event_kind, event_json, committed_at)
               VALUES (?, ?, ?, ?, ?)`,
              archived.state.cursor,
              archived.event.id,
              archived.event.kind,
              JSON.stringify(archived.event),
              archived.state.updatedAt,
            );
          }
          if (projection === undefined) {
            this.ctx.storage.sql.exec(
              `INSERT INTO outbox
                (event_id, cursor, payload_json, delivered_at, attempts)
               VALUES (?, ?, ?, NULL, 0)`,
              archived.event.id,
              archived.state.cursor,
              recovery.projectionJson,
            );
          }
        }
        this.ctx.storage.sql.exec(
          "DELETE FROM command_results WHERE command_id = ?",
          commandId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM command_receipt_archive_outbox WHERE command_id = ?",
          commandId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_command WHERE command_id = ?",
          commandId,
        );
      });
      if (recovery !== undefined) {
        this.scheduleAlarm(0);
        this.ctx.waitUntil(this.flushOutbox());
      }
      return true;
    } catch {
      return false;
    }
  }

  private pending(): PendingRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingRow>(
        `SELECT command_id, payload_hash, command_json, unsigned_json, next_state_json,
                previous_slug, reduction_overlay, attempts
         FROM pending_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private hasOutboxCapacity(reduction: boolean): boolean {
    const usage = this.ctx.storage.sql
      .exec<{ bytes: number; count: number }>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) AS bytes
         FROM outbox WHERE delivered_at IS NULL`,
      )
      .one();
    return (
      usage.count <
        (reduction
          ? maximumUndeliveredOutboxRows
          : maximumNormalUndeliveredOutboxRows) &&
      usage.bytes + maximumProjectionPayloadBytes <=
        (reduction
          ? maximumUndeliveredOutboxBytes
          : maximumNormalUndeliveredOutboxBytes)
    );
  }

  private hasCommandResultCapacity(reduction: boolean): boolean {
    const usage = this.ctx.storage.sql
      .exec<{ bytes: number; count: number }>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(
                  length(CAST(command_id AS BLOB)) +
                  length(CAST(payload_hash AS BLOB)) +
                  length(CAST(command_json AS BLOB)) +
                  length(CAST(response_json AS BLOB))
                ), 0) AS bytes
         FROM command_results`,
      )
      .one();
    return (
      usage.count <
        (reduction
          ? maximumCommandResultRows
          : maximumNormalCommandResultRows) &&
      usage.bytes + maximumCommandResultRowBytes <=
        (reduction
          ? maximumCommandResultBytes
          : maximumNormalCommandResultBytes)
    );
  }

  private async attestAndFinalize(
    pending: PendingRow,
    replayed: boolean,
  ): Promise<BotExecuteResult> {
    const unsignedEvent = JSON.parse(
      String(pending.unsigned_json),
    ) as UnsignedNostrEvent;
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent);
    } catch {
      await this.markPendingFailure();
      return { ok: false, code: "attestation_failed" };
    }

    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    const nextState = JSON.parse(String(pending.next_state_json)) as Bot;
    const projection: BotProjectionEnvelope = {
      contract: "bot.projection@1",
      botId: nextState.id,
      cursor: nextState.cursor,
      event: signedEvent,
      state: nextState,
    };
    if (
      !validateContract("punks://contracts/bot.projection@1", projection).valid
    ) {
      await this.markPendingFailure();
      return { ok: false, code: "internal" };
    }
    const response = canonicalCommittedBotCommand({
      state: nextState,
      event: signedEvent,
      previousSlug:
        pending.previous_slug === null ? null : String(pending.previous_slug),
    });
    const projectionJson = JSON.stringify(projection);
    const responseJson = JSON.stringify(response);
    let commandReceipt: PreparedCommandReceiptArchive;
    try {
      commandReceipt = await prepareBotCommandReceipt({
        botId: nextState.id,
        commandId,
        payloadHash,
        value: response,
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
    } catch {
      await this.markPendingFailure();
      return { ok: false, code: "internal" };
    }
    const commandResultRowBytes =
      utf8ByteLength(commandId) +
      utf8ByteLength(payloadHash) +
      utf8ByteLength("{}") +
      utf8ByteLength(responseJson);
    if (
      utf8ByteLength(projectionJson) > maximumProjectionPayloadBytes ||
      commandResultRowBytes > maximumCommandResultRowBytes
    ) {
      await this.markPendingFailure();
      return { ok: false, code: "internal" };
    }
    let finalized: CommittedBotCommand | undefined;
    this.ctx.storage.transactionSync(() => {
      const currentPending = this.pending();
      if (currentPending === undefined) {
        const existing = this.result(commandId);
        if (existing?.payload_hash === payloadHash) {
          finalized = canonicalCommittedBotCommand(
            JSON.parse(existing.response_json) as CommittedBotCommand,
          );
        }
        return;
      }
      if (
        currentPending.command_id !== commandId ||
        currentPending.payload_hash !== payloadHash ||
        currentPending.command_json !== pending.command_json ||
        currentPending.unsigned_json !== pending.unsigned_json ||
        currentPending.next_state_json !== pending.next_state_json ||
        currentPending.reduction_overlay !== pending.reduction_overlay
      ) {
        return;
      }
      const committed = this.committedState();
      const command = parseBotCommand(String(pending.command_json));
      if (
        command === null ||
        !validBotPendingDecision(
          committed,
          command,
          nextState,
          unsignedEvent,
          Number(pending.reduction_overlay) === 1,
        )
      ) {
        return;
      }
      const now = new Date().toISOString();
      this.ctx.storage.sql.exec(
        `INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
        JSON.stringify(nextState),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO journal (cursor, event_id, event_kind, event_json, committed_at)
         VALUES (?, ?, ?, ?, ?)`,
        nextState.cursor,
        signedEvent.id,
        signedEvent.kind,
        JSON.stringify(signedEvent),
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO command_results
          (command_id, payload_hash, command_json, response_json, committed_at)
         VALUES (?, ?, ?, ?, ?)`,
        commandId,
        payloadHash,
        "{}",
        responseJson,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO command_receipt_archive_outbox
          (command_id, payload_hash, object_key, archive_json, body_hash,
           attempts, next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
        commandId,
        payloadHash,
        commandReceipt.coordinate.key,
        commandReceipt.body,
        commandReceipt.metadata.bodyHash,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO outbox (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, ?, NULL, 0)`,
        signedEvent.id,
        nextState.cursor,
        projectionJson,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_command WHERE singleton = 1",
      );
      finalized = response;
    });
    if (finalized === undefined) {
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    return { ok: true, value: finalized, replayed };
  }

  private async attest(
    event: UnsignedNostrEvent,
    purpose: "bot-journal" | "bot-journal-segment" = "bot-journal",
  ): Promise<SignedNostrEvent> {
    const response = await this.env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/internal/v1/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose, event }),
      }),
    );
    if (!response.ok) {
      throw new Error(`Attestation service returned ${response.status}`);
    }
    const body: unknown = await response.json();
    if (
      !validateContract("punks://contracts/attestation.response@1", body).valid
    ) {
      throw new Error("Attestation service violated its contract");
    }
    const attestation = body as AttestationResponse;
    const signed = attestation.event;
    if (
      signed.created_at !== event.created_at ||
      signed.kind !== event.kind ||
      signed.content !== event.content ||
      !tagsPreserveUnsignedEvent(
        event.tags,
        signed.tags,
        attestation.keyVersion,
      ) ||
      attestation.keyVersion.length === 0 ||
      signed.id !==
        (await sha256Hex(
          JSON.stringify([
            0,
            signed.pubkey,
            signed.created_at,
            signed.kind,
            signed.tags,
            signed.content,
          ]),
        ))
    ) {
      throw new Error("Attestation service changed authoritative event fields");
    }
    if (!(await verifyAttestation(signed, this.env))) {
      throw new Error(
        "Attestation signature is not trusted in this environment",
      );
    }
    return signed;
  }

  private async markPendingFailure(): Promise<void> {
    const attempts = nextRetryAttempt(this.pending()?.attempts);
    this.ctx.storage.sql.exec(
      "UPDATE pending_command SET attempts = ? WHERE singleton = 1",
      attempts,
    );
    await this.replaceAlarmAt(
      Date.now() + Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
    );
  }

  private async flushOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<OutboxRow>(
        `SELECT event_id, payload_json, attempts FROM outbox
         WHERE delivered_at IS NULL ORDER BY cursor LIMIT 20`,
      )
      .toArray();
    for (const row of rows) {
      try {
        await this.env.PROJECTION_QUEUE.send(
          JSON.parse(String(row.payload_json)),
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM outbox WHERE event_id = ?",
          row.event_id,
        );
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        this.ctx.storage.sql.exec(
          "UPDATE outbox SET attempts = ? WHERE event_id = ?",
          attempts,
          row.event_id,
        );
        this.scheduleAlarm(
          Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
        );
        return;
      }
    }
    if (rows.length === 20) {
      this.scheduleAlarm(0);
    }
  }

  private async ensureCommandResultCapacity(
    reduction: boolean,
  ): Promise<boolean> {
    if (this.hasCommandResultCapacity(reduction)) {
      return true;
    }
    await this.archiveCommandReceipts();
    return this.hasCommandResultCapacity(reduction);
  }

  private async archiveCommandReceipts(): Promise<void> {
    try {
      await this.migrateLegacyCommandResults();
      await this.flushCommandReceiptArchiveOutbox();
    } catch {
      this.scheduleAlarm(1_000);
    }
  }

  private async migrateLegacyCommandResults(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<LegacyResultRow>(
        `SELECT result.command_id, result.payload_hash, result.response_json
         FROM command_results AS result
         LEFT JOIN command_receipt_archive_outbox AS receipt
           ON receipt.command_id = result.command_id
         WHERE receipt.command_id IS NULL
         ORDER BY result.committed_at, result.command_id
         LIMIT ?`,
        commandReceiptArchiveBatchSize,
      )
      .toArray();
    for (const row of rows) {
      const response = parseCommittedBotCommand(row.response_json);
      if (response === null) {
        throw new CommandReceiptArchiveError(
          "corrupt",
          "Legacy Bot command result is invalid",
        );
      }
      const prepared = await prepareBotCommandReceipt({
        botId: response.state.id,
        commandId: row.command_id,
        payloadHash: row.payload_hash,
        value: response,
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
      this.ctx.storage.transactionSync(() => {
        const current = this.ctx.storage.sql
          .exec<ResultRow>(
            `SELECT payload_hash, response_json FROM command_results
             WHERE command_id = ?`,
            row.command_id,
          )
          .toArray()[0];
        if (
          current?.payload_hash !== row.payload_hash ||
          current.response_json !== row.response_json
        ) {
          return;
        }
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO command_receipt_archive_outbox
            (command_id, payload_hash, object_key, archive_json, body_hash,
             attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
          row.command_id,
          row.payload_hash,
          prepared.coordinate.key,
          prepared.body,
          prepared.metadata.bodyHash,
          new Date().toISOString(),
        );
      });
    }
    if (rows.length === commandReceiptArchiveBatchSize) {
      this.scheduleAlarm(0);
    }
  }

  private async flushCommandReceiptArchiveOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<CommandReceiptArchiveOutboxRow>(
        `SELECT command_id, payload_hash, object_key, archive_json, body_hash,
                attempts
         FROM command_receipt_archive_outbox
         WHERE next_attempt_at <= ?
         ORDER BY created_at, command_id
         LIMIT ?`,
        Date.now(),
        commandReceiptArchiveBatchSize,
      )
      .toArray();
    for (const row of rows) {
      try {
        const value = parseJson(String(row.archive_json));
        if (value === null) {
          throw new CommandReceiptArchiveError(
            "corrupt",
            "Bot command receipt outbox JSON is invalid",
          );
        }
        const archive = await parseBotCommandReceiptArchive({
          value,
          expectedBotId: this.ctx.id.name ?? "",
          expectedCommandId: String(row.command_id),
          metadataPayloadHash: String(row.payload_hash),
          verifyEvent: (event) => verifyAttestation(event, this.env),
        });
        const prepared = await prepareBotCommandReceipt({
          botId: archive.botId,
          commandId: archive.commandId,
          payloadHash: archive.payloadHash,
          value: archive.terminal.value as CommittedBotCommand,
          verifyEvent: (event) => verifyAttestation(event, this.env),
        });
        if (
          prepared.coordinate.key !== row.object_key ||
          prepared.body !== row.archive_json ||
          prepared.metadata.bodyHash !== row.body_hash
        ) {
          throw new CommandReceiptArchiveError(
            "corrupt",
            "Bot command receipt outbox is not canonical",
          );
        }
        await writeCommandReceiptArchive(
          this.env.JOURNAL_ARCHIVE_BUCKET,
          prepared,
        );
        this.ctx.storage.transactionSync(() => {
          const currentOutbox = this.ctx.storage.sql
            .exec<CommandReceiptArchiveOutboxRow>(
              `SELECT command_id, payload_hash, object_key, archive_json,
                      body_hash, attempts
               FROM command_receipt_archive_outbox WHERE command_id = ?`,
              row.command_id,
            )
            .toArray()[0];
          if (!sameCommandReceiptArchiveOutbox(currentOutbox, row)) {
            return;
          }
          const result = this.result(String(row.command_id));
          if (
            result !== undefined &&
            (result.payload_hash !== row.payload_hash ||
              canonicalJson(parseJson(result.response_json)) !==
                canonicalJson(archive.terminal.value))
          ) {
            throw new Error("Bot command result changed before archive commit");
          }
          this.ctx.storage.sql.exec(
            "DELETE FROM command_results WHERE command_id = ?",
            row.command_id,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM command_receipt_archive_outbox WHERE command_id = ?",
            row.command_id,
          );
        });
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        const delay = retryDelay(attempts);
        this.ctx.storage.sql.exec(
          `UPDATE command_receipt_archive_outbox
           SET attempts = ?, next_attempt_at = ? WHERE command_id = ?`,
          attempts,
          Date.now() + delay,
          row.command_id,
        );
        this.scheduleAlarm(delay);
        return;
      }
    }
    if (rows.length === commandReceiptArchiveBatchSize) {
      this.scheduleAlarm(0);
    }
  }

  private pendingArchive(): PendingArchiveRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingArchiveRow>(
        `SELECT start_cursor, end_cursor, previous_segment_hash, segment_hash,
                object_key, events_json, unsigned_seal_json, attempts
         FROM pending_archive WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private archiveLimits(): { hotEvents: number; segmentEvents: number } {
    return {
      hotEvents: positiveInteger(
        this.env.JOURNAL_HOT_EVENTS,
        1_000,
        1,
        100_000,
      ),
      segmentEvents: positiveInteger(
        this.env.JOURNAL_SEGMENT_EVENTS,
        250,
        1,
        500,
      ),
    };
  }

  private hasJournalCapacity(): boolean {
    const { hotEvents, segmentEvents } = this.archiveLimits();
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
      .one().count;
    return count < hotEvents + segmentEvents;
  }

  private async ensureJournalCapacity(): Promise<boolean> {
    if (this.hasJournalCapacity()) {
      return true;
    }
    await this.archiveJournalIfNeeded();
    return this.hasJournalCapacity();
  }

  private async archiveJournalIfNeeded(): Promise<void> {
    try {
      let pending = this.pendingArchive();
      if (pending === undefined) {
        pending = await this.preparePendingArchive();
      }
      if (pending !== undefined) {
        await this.writePendingArchive(pending);
      }
    } catch {
      const pending = this.pendingArchive();
      if (pending === undefined) {
        this.scheduleAlarm(1_000);
        return;
      }
      const attempts = nextRetryAttempt(pending.attempts);
      this.ctx.storage.sql.exec(
        "UPDATE pending_archive SET attempts = ? WHERE singleton = 1",
        attempts,
      );
      this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
    }
  }

  private async preparePendingArchive(): Promise<
    PendingArchiveRow | undefined
  > {
    const { hotEvents, segmentEvents } = this.archiveLimits();
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
      .one().count;
    if (count < hotEvents + segmentEvents) {
      return undefined;
    }

    const rows = this.ctx.storage.sql
      .exec<JournalRow>(
        "SELECT cursor, event_json FROM journal ORDER BY cursor LIMIT ?",
        segmentEvents,
      )
      .toArray();
    const selected: JournalRow[] = [];
    let selectedBytes = 0;
    for (const row of rows) {
      const rowBytes = new TextEncoder().encode(
        String(row.event_json),
      ).byteLength;
      if (
        selected.length > 0 &&
        selectedBytes + rowBytes > maximumArchiveEventBytes
      ) {
        break;
      }
      selected.push(row);
      selectedBytes += rowBytes;
    }
    if (selected.length === 0) {
      return undefined;
    }

    const state = this.committedState();
    if (state === null) {
      throw new Error("Cannot archive a journal without Bot state");
    }
    const archiveHead = this.ctx.storage.sql
      .exec<ArchiveHeadRow>(
        `SELECT end_cursor, segment_hash FROM archive_segments
         ORDER BY end_cursor DESC LIMIT 1`,
      )
      .toArray()[0];
    const expectedStartCursor =
      archiveHead === undefined ? 1 : Number(archiveHead.end_cursor) + 1;
    if (Number(selected[0]?.cursor) !== expectedStartCursor) {
      throw new Error("Bot journal archive cursor is not contiguous");
    }
    const draft = await prepareBotJournalSegment(
      state.id,
      selected.map((row) => ({
        cursor: Number(row.cursor),
        event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
      })),
      archiveHead === undefined ? null : String(archiveHead.segment_hash),
      new Date(),
    );

    const raced = this.pendingArchive();
    if (raced !== undefined) {
      return raced;
    }
    const coordinateHash = await sha256Hex(
      canonicalJson({ schemaVersion: 1, aggregate: "bot", botId: state.id }),
    );
    const objectKey = `journal/v1/bot/${coordinateHash}/${draft.startCursor}-${draft.endCursor}-${draft.segmentHash}.json`;
    this.ctx.storage.sql.exec(
      `INSERT INTO pending_archive
        (singleton, start_cursor, end_cursor, previous_segment_hash, segment_hash,
         object_key, events_json, unsigned_seal_json, attempts, created_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      draft.startCursor,
      draft.endCursor,
      draft.previousSegmentHash,
      draft.segmentHash,
      objectKey,
      JSON.stringify(draft.events),
      JSON.stringify(draft.unsignedSeal),
      new Date().toISOString(),
    );
    await this.ctx.storage.sync();
    return this.pendingArchive();
  }

  private async writePendingArchive(pending: PendingArchiveRow): Promise<void> {
    const state = this.committedState();
    if (state === null) {
      throw new Error("Cannot archive a journal without Bot state");
    }
    const unsignedSeal = JSON.parse(
      String(pending.unsigned_seal_json),
    ) as UnsignedNostrEvent;
    const seal = await this.persistedArchiveSeal(
      String(pending.segment_hash),
      unsignedSeal,
    );
    if (seal.kind !== 50302) {
      throw new Error("Bot journal archive seal used an unexpected event kind");
    }
    const expectedArchive: BotJournalSegmentArchive = {
      schemaVersion: 1,
      botId: state.id,
      startCursor: Number(pending.start_cursor),
      endCursor: Number(pending.end_cursor),
      previousSegmentHash:
        pending.previous_segment_hash === null
          ? null
          : String(pending.previous_segment_hash),
      segmentHash: String(pending.segment_hash),
      events: JSON.parse(
        String(pending.events_json),
      ) as BotJournalSegmentArchive["events"],
      seal: { ...seal, kind: 50302 } as BotJournalSegmentArchive["seal"],
    };
    if (
      !(await validBotArchive(expectedArchive, pending, unsignedSeal, this.env))
    ) {
      throw new Error("Bot journal archive violated its canonical contract");
    }
    const body = canonicalJson(expectedArchive);
    if (new TextEncoder().encode(body).byteLength > maximumArchiveBodyBytes) {
      throw new Error("Bot journal archive exceeds its bounded body size");
    }

    const coordinateHash = await sha256Hex(
      canonicalJson({ schemaVersion: 1, aggregate: "bot", botId: state.id }),
    );
    const objectKey = `journal/v1/bot/${coordinateHash}/${expectedArchive.startCursor}-${expectedArchive.endCursor}-${expectedArchive.segmentHash}.json`;
    if (objectKey !== pending.object_key) {
      throw new Error("Bot journal archive object key is not canonical");
    }
    const metadata = archiveMetadata(
      "bot",
      objectKey,
      expectedArchive.startCursor,
      expectedArchive.endCursor,
      expectedArchive.segmentHash,
    );
    const stored = await this.env.JOURNAL_ARCHIVE_BUCKET.put(objectKey, body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: metadata,
    });
    let archive = expectedArchive;
    if (stored === null) {
      const existing = await this.env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
      if (existing === null || existing.size > maximumArchiveBodyBytes) {
        throw new Error("Bot journal archive existing object is unavailable");
      }
      const existingText = await existing.text();
      const existingArchive = parseJson(
        existingText,
      ) as BotJournalSegmentArchive | null;
      if (
        existingArchive === null ||
        existingText !== canonicalJson(existingArchive) ||
        existing.httpMetadata?.contentType !== "application/json" ||
        canonicalJson(existing.customMetadata) !== canonicalJson(metadata) ||
        !(await validBotArchive(
          existingArchive,
          pending,
          unsignedSeal,
          this.env,
        ))
      ) {
        throw new Error("Existing Bot journal archive failed exact validation");
      }
      archive = existingArchive;
    }

    this.ctx.storage.transactionSync(() => {
      const current = this.pendingArchive();
      if (!samePendingArchive(current, pending)) {
        return;
      }
      const currentHead = this.ctx.storage.sql
        .exec<ArchiveHeadRow>(
          `SELECT end_cursor, segment_hash FROM archive_segments
           ORDER BY end_cursor DESC LIMIT 1`,
        )
        .toArray()[0];
      const expectedPrevious =
        currentHead === undefined ? null : String(currentHead.segment_hash);
      const expectedStart =
        currentHead === undefined ? 1 : Number(currentHead.end_cursor) + 1;
      const localEvents = this.ctx.storage.sql
        .exec<JournalRow>(
          `SELECT cursor, event_json FROM journal
           WHERE cursor >= ? AND cursor <= ? ORDER BY cursor`,
          archive.startCursor,
          archive.endCursor,
        )
        .toArray();
      if (
        archive.startCursor !== expectedStart ||
        archive.previousSegmentHash !== expectedPrevious ||
        localEvents.length !== archive.events.length ||
        localEvents.some(
          (row, index) =>
            Number(row.cursor) !== archive.startCursor + index ||
            canonicalJson(JSON.parse(String(row.event_json))) !==
              canonicalJson(archive.events[index]),
        )
      ) {
        throw new Error("Bot journal changed before archive commit");
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO archive_segments
          (start_cursor, end_cursor, previous_segment_hash, segment_hash,
           object_key, seal_json, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        archive.startCursor,
        archive.endCursor,
        archive.previousSegmentHash,
        archive.segmentHash,
        objectKey,
        JSON.stringify(archive.seal),
        new Date().toISOString(),
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM journal WHERE cursor >= ? AND cursor <= ?",
        archive.startCursor,
        archive.endCursor,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_archive WHERE singleton = 1",
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_archive_seals WHERE segment_hash = ?",
        archive.segmentHash,
      );
    });
    this.scheduleAlarm(0);
  }

  private async persistedArchiveSeal(
    segmentHash: string,
    unsigned: UnsignedNostrEvent,
  ): Promise<SignedNostrEvent> {
    let row = this.ctx.storage.sql
      .exec<{ seal_json: string }>(
        "SELECT seal_json FROM pending_archive_seals WHERE segment_hash = ?",
        segmentHash,
      )
      .toArray()[0];
    if (row === undefined) {
      const signed = await this.attest(unsigned, "bot-journal-segment");
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO pending_archive_seals
          (segment_hash, seal_json, persisted_at) VALUES (?, ?, ?)`,
        segmentHash,
        JSON.stringify(signed),
        new Date().toISOString(),
      );
      await this.ctx.storage.sync();
      row = this.ctx.storage.sql
        .exec<{ seal_json: string }>(
          "SELECT seal_json FROM pending_archive_seals WHERE segment_hash = ?",
          segmentHash,
        )
        .toArray()[0];
    }
    const seal = row === undefined ? null : parseJson(row.seal_json);
    if (
      seal === null ||
      !validateContract("punks://contracts/nostr.signed-event@1", seal).valid ||
      !signedEventPreservesUnsigned(unsigned, seal as SignedNostrEvent) ||
      !(await verifyAttestation(seal as SignedNostrEvent, this.env))
    ) {
      throw new Error("Persisted Bot journal archive seal is invalid");
    }
    return seal as SignedNostrEvent;
  }

  private scheduleAlarm(delayMs: number): void {
    void this.ensureAlarmAt(Date.now() + delayMs);
  }

  private ensureAlarmAt(scheduledAt: number): Promise<void> {
    this.alarmScheduling = this.alarmScheduling
      .catch(() => undefined)
      .then(async () => {
        const existing = await this.ctx.storage.getAlarm();
        if (existing === null || scheduledAt < existing) {
          await this.ctx.storage.setAlarm(scheduledAt);
        }
      });
    this.ctx.waitUntil(this.alarmScheduling);
    return this.alarmScheduling;
  }

  private replaceAlarmAt(scheduledAt: number): Promise<void> {
    this.alarmScheduling = this.alarmScheduling
      .catch(() => undefined)
      .then(() => this.ctx.storage.setAlarm(scheduledAt));
    this.ctx.waitUntil(this.alarmScheduling);
    return this.alarmScheduling;
  }

  private async repairDurableAlarm(): Promise<void> {
    const hasWork = this.ctx.storage.sql
      .exec<{ has_work: number }>(
        `SELECT (
          EXISTS(SELECT 1 FROM pending_command) OR
          EXISTS(SELECT 1 FROM outbox WHERE delivered_at IS NULL) OR
          EXISTS(SELECT 1 FROM command_receipt_archive_outbox) OR
          EXISTS(
            SELECT 1 FROM command_results AS result
            LEFT JOIN command_receipt_archive_outbox AS receipt
              ON receipt.command_id = result.command_id
            WHERE receipt.command_id IS NULL
          ) OR
          EXISTS(SELECT 1 FROM pending_archive)
        ) AS has_work`,
      )
      .one().has_work;
    const archiveReady = !this.hasJournalCapacity();
    if (
      (hasWork === 1 || archiveReady) &&
      (await this.ctx.storage.getAlarm()) === null
    ) {
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
    }
  }
}

async function validBotArchive(
  archive: BotJournalSegmentArchive,
  pending: PendingArchiveRow,
  unsignedSeal: UnsignedNostrEvent,
  env: ApiEnv,
): Promise<boolean> {
  return (
    validateContract("punks://contracts/bot.journal-segment@1", archive)
      .valid &&
    archive.startCursor === Number(pending.start_cursor) &&
    archive.endCursor === Number(pending.end_cursor) &&
    archive.previousSegmentHash === pending.previous_segment_hash &&
    archive.segmentHash === String(pending.segment_hash) &&
    canonicalJson(archive.events) ===
      canonicalJson(parseJson(String(pending.events_json))) &&
    signedEventPreservesUnsigned(unsignedSeal, archive.seal) &&
    (await verifyAttestation(archive.seal, env)) &&
    (await verifyBotJournalSegmentHash(archive))
  );
}

function signedEventPreservesUnsigned(
  unsigned: UnsignedNostrEvent,
  signed: SignedNostrEvent,
): boolean {
  return (
    signed.created_at === unsigned.created_at &&
    signed.kind === unsigned.kind &&
    signed.content === unsigned.content &&
    signed.tags.length === unsigned.tags.length + 1 &&
    unsigned.tags.every(
      (tag, index) => canonicalJson(tag) === canonicalJson(signed.tags[index]),
    ) &&
    signed.tags.at(-1)?.[0] === "attestation"
  );
}

function samePendingArchive(
  current: PendingArchiveRow | undefined,
  expected: PendingArchiveRow,
): boolean {
  return (
    current !== undefined &&
    current.start_cursor === expected.start_cursor &&
    current.end_cursor === expected.end_cursor &&
    current.previous_segment_hash === expected.previous_segment_hash &&
    current.segment_hash === expected.segment_hash &&
    current.object_key === expected.object_key &&
    current.events_json === expected.events_json &&
    current.unsigned_seal_json === expected.unsigned_seal_json
  );
}

function archiveMetadata(
  aggregate: "bot" | "bot-installation",
  objectKey: string,
  startCursor: number,
  endCursor: number,
  segmentHash: string,
): Record<string, string> {
  const coordinateHash = objectKey.split("/")[3] ?? "";
  return {
    aggregate,
    coordinateHash,
    segmentHash,
    startCursor: String(startCursor),
    endCursor: String(endCursor),
  };
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseBot(value: string): Bot | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/bot@1", parsed).valid
    ? (parsed as Bot)
    : null;
}

function parseUnsignedEvent(value: string): UnsignedNostrEvent | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/nostr.unsigned-event@1", parsed)
    .valid
    ? (parsed as UnsignedNostrEvent)
    : null;
}

function parseBotCommand(value: string): BotExecuteRequest["command"] | null {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const contract = Reflect.get(parsed, "contract");
  const contractId =
    contract === "bot.publish@1"
      ? "punks://contracts/bot.publish@1"
      : contract === "bot.update@1"
        ? "punks://contracts/bot.update@1"
        : null;
  return contractId !== null && validateContract(contractId, parsed).valid
    ? (parsed as BotExecuteRequest["command"])
    : null;
}

function validBotPendingDecision(
  committed: Bot | null,
  command: BotExecuteRequest["command"],
  nextState: Bot,
  event: UnsignedNostrEvent,
  reductionOverlay: boolean,
): boolean {
  let expected: ReturnType<typeof executeBot>;
  try {
    expected = executeBot(committed, command, {
      botId: nextState.id,
      cursor: nextState.cursor,
      now: new Date(nextState.updatedAt),
      operatorAuthorized: true,
    });
  } catch {
    return false;
  }
  const actionDelta = classifyActionDelta(committed, nextState);
  const expectedReduction =
    committed !== null &&
    (statusRank[nextState.status] > statusRank[committed.status] ||
      actionDelta === "reduction");
  return (
    reductionOverlay === expectedReduction &&
    canonicalJson(expected.nextState) === canonicalJson(nextState) &&
    canonicalJson(expected.event) === canonicalJson(event)
  );
}

function positiveInteger(
  configured: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = Number.parseInt(configured, 10);
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function nextRetryAttempt(value: string | number | null | undefined): number {
  const attempts = Number(value ?? 0);
  return Number.isSafeInteger(attempts) && attempts >= 0
    ? Math.min(maximumRetryAttempts, attempts + 1)
    : maximumRetryAttempts;
}

function retryDelay(attempts: number): number {
  return Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
}

function parseCommittedBotCommand(value: string): CommittedBotCommand | null {
  const parsed = parseJson(value);
  if (!isExactRecord(parsed, ["state", "event", "previousSlug"])) {
    return null;
  }
  return validateContract("punks://contracts/bot@1", parsed.state).valid &&
    validateContract("punks://contracts/nostr.signed-event@1", parsed.event)
      .valid &&
    (parsed.previousSlug === null || typeof parsed.previousSlug === "string")
    ? canonicalCommittedBotCommand(parsed as unknown as CommittedBotCommand)
    : null;
}

function canonicalCommittedBotCommand(
  value: CommittedBotCommand,
): CommittedBotCommand {
  return JSON.parse(canonicalJson(value)) as CommittedBotCommand;
}

function sameCommandReceiptArchiveOutbox(
  current: CommandReceiptArchiveOutboxRow | undefined,
  expected: CommandReceiptArchiveOutboxRow,
): boolean {
  return (
    current !== undefined &&
    current.command_id === expected.command_id &&
    current.payload_hash === expected.payload_hash &&
    current.object_key === expected.object_key &&
    current.archive_json === expected.archive_json &&
    current.body_hash === expected.body_hash &&
    current.attempts === expected.attempts
  );
}

function samePendingCommand(
  current: PendingRow | undefined,
  expected: PendingRow,
): boolean {
  return (
    current !== undefined &&
    current.command_id === expected.command_id &&
    current.payload_hash === expected.payload_hash &&
    current.command_json === expected.command_json &&
    current.unsigned_json === expected.unsigned_json &&
    current.next_state_json === expected.next_state_json &&
    current.previous_slug === expected.previous_slug &&
    current.reduction_overlay === expected.reduction_overlay
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isBotExecuteRequest(input: unknown): input is BotExecuteRequest {
  if (!isExactRecord(input, ["command", "operatorAuthorized"])) {
    return false;
  }
  if (typeof input.operatorAuthorized !== "boolean") {
    return false;
  }
  const command = input.command;
  return (
    typeof command === "object" &&
    command !== null &&
    !Array.isArray(command) &&
    (Reflect.get(command, "contract") === "bot.publish@1" ||
      Reflect.get(command, "contract") === "bot.update@1")
  );
}

function isExactRecord(
  input: unknown,
  keys: readonly string[],
): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Object.keys(input).sort().join(",") === [...keys].sort().join(",")
  );
}

function tagsPreserveUnsignedEvent(
  unsigned: UnsignedNostrEvent["tags"],
  signed: SignedNostrEvent["tags"],
  keyVersion: string,
): boolean {
  if (signed.length !== unsigned.length + 1) {
    return false;
  }
  return (
    unsigned.every(
      (tag, index) => JSON.stringify(tag) === JSON.stringify(signed[index]),
    ) &&
    JSON.stringify(signed.at(-1)) ===
      JSON.stringify(["attestation", keyVersion])
  );
}

function classifyActionDelta(
  current: Bot | null,
  next: Bot,
): "none" | "reduction" | "extension" | "mixed" {
  if (current === null) {
    return "none";
  }
  const currentActions = new Set(current.supportedActionContracts);
  const nextActions = new Set(next.supportedActionContracts);
  const removed = [...currentActions].some(
    (action) => !nextActions.has(action),
  );
  const added = [...nextActions].some((action) => !currentActions.has(action));
  if (removed && added) {
    return "mixed";
  }
  if (removed) {
    return "reduction";
  }
  if (added) {
    return "extension";
  }
  return "none";
}
