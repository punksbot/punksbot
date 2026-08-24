import type {
  AdmitBotActionCommand,
  AttestationResponse,
  Bot,
  BotInstallation,
  BotInstallationJournalSegmentArchive,
  BotInstallationProjectionEnvelope,
  GetBotInstallationQuery,
  SignedNostrEvent,
  UnsignedNostrEvent,
  BotActionAdmission,
  BotWakeOffer,
  BotWakeTerminalReceiptArchive,
  ClaimBotWakeCommand,
  ClaimBotWakeResult,
  CompleteBotWakeCommand,
  CompleteBotActionCommand,
  ExecuteBotActionCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  BotInstallationDomainError,
  botWakeQueueBody,
  canonicalJson,
  deriveBotActionDigest,
  deriveBotWakeId,
  deriveBotWakeReceiptDigest,
  deriveBotWakeTurnId,
  deriveOpaqueUuid,
  executeBotInstallation,
  isKnownBotRuntimeRelease,
  prepareBotInstallationJournalSegment,
  prepareBotWakeOffer,
  prepareBotWakeTerminalReceipt,
  queryBotInstallation,
  sha256Hex,
  validateBotWakeOffer,
  validateBotWakeTerminalReceipt,
  verifyBotInstallationJournalSegmentHash,
  type BotInstallationExecutionContext,
  type BotInstallationGrant,
} from "@punks/core";
import { DurableObject } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import { verifyAttestation } from "./attestation-verification";
import {
  type BotInstallationCommandTerminal,
  parseBotInstallationCommandReceiptArchive,
  prepareBotInstallationCommandReceipt,
} from "./bot-installation-command-receipt";
import {
  CommandReceiptArchiveError,
  commandReceiptCoordinate,
  readCommandReceiptArchive,
  writeCommandReceiptArchive,
  type PreparedCommandReceiptArchive,
} from "./command-receipt-archive";
import type {
  BotInstallationExecuteResult,
  BotInstallationManagementCommand,
  BotInstallationQueryResult,
  BotQueryResult,
  CommittedBotInstallationCommand,
  WorkspaceAuthorizationResult,
  AdmitBotActionRequest,
  BotActionAdmissionResult,
  CompleteBotActionRequest,
  CompleteBotActionResult,
  ValidateBotActionAdmissionRequest,
  ValidateBotActionAdmissionResult,
  AuthorizeBotGrantResult,
  AcceptBotWakeCandidateResult,
  BotWakeCandidate,
  BotWakeSubscriptionMutationResult,
  ExecuteAdmittedBotReactionRequest,
  ExecuteAdmittedBotReactionResult,
} from "./rpc";

type StateRow = Record<"state_json", string>;
type ResultRow = Record<"payload_hash" | "response_json", string>;
type RejectedRow = Record<"payload_hash" | "code", string>;
type PendingRow = Record<
  | "command_id"
  | "payload_hash"
  | "command_json"
  | "unsigned_json"
  | "next_state_json"
  | "grant_json"
  | "wake_subscription_json"
  | "reduction_overlay"
  | "attempts",
  string | number | null
>;
type GrantRow = Record<
  | "capability"
  | "resource_kind"
  | "resource_id"
  | "enabled"
  | "updated_cursor"
  | "tombstoned_at",
  string | number | null
>;
type BotWakeSubscriptionTransition =
  | {
      operation: "prepare";
      workspaceId: string;
      conversationId: string;
      botId: string;
      installationId: string;
      epoch: number;
      preparationId: string;
    }
  | {
      operation: "activate";
      workspaceId: string;
      conversationId: string;
      botId: string;
      installationId: string;
      epoch: number;
      preparationId: string;
      highWaterCursor: number;
    }
  | {
      operation: "deactivate";
      workspaceId: string;
      conversationId: string;
      botId: string;
      installationId: string;
      epoch: number;
    };
type WakeSubscriptionOutboxRow = {
  conversation_id: string;
  transition_json: string;
  attempts: number;
};
type BotWakeRow = {
  wake_id: string;
  offer_json: string;
  offer_digest: string;
  status: "offered" | "claimed" | "terminal";
  turn_id: string | null;
  claimed_at: string | null;
  terminal_json: string | null;
  completed_at: string | null;
  updated_at: string;
};
type WakeReceiptArchiveOutboxRow = {
  wake_id: string;
  object_key: string;
  archive_json: string;
  body_hash: string;
  attempts: number;
  next_attempt_at: number;
};
type WakeQueueOutboxRow = {
  wake_id: string;
  attempts: number;
  next_attempt_at: number;
};
type ColdBotWakeReceiptLookup =
  | { status: "found"; receipt: BotWakeTerminalReceiptArchive }
  | { status: "absent" }
  | { status: "unavailable" };
type OutboxRow = Record<
  "event_id" | "cursor" | "payload_json" | "attempts",
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
type ActionReceiptRow = {
  admission_id: string;
  action_id: string;
  action_digest: string;
  admission_json: string;
  proof_json: string;
  status: "admitted" | "completed";
  outcome: "succeeded" | "failed" | null;
};
type UsedJtiRow = {
  action_id: string;
  action_digest: string;
  expires_at: number;
};
type PendingActionRow = {
  operation: "admit" | "complete";
  command_id: string;
  action_id: string;
  action_digest: string;
  jti: string | null;
  command_json: string;
  unsigned_json: string;
  next_state_json: string;
  admission_json: string;
  attempts: number;
};
type ActionDeliveryRow = {
  action_id: string;
  request_json: string;
  attempts: number;
};
type ReceiptArchiveOutboxRow = {
  action_id: string;
  admission_id: string;
  action_digest: string;
  object_key: string;
  archive_json: string;
  attempts: number;
};
type CommandReceiptArchiveOutboxRow = Record<
  | "command_id"
  | "payload_hash"
  | "terminal_kind"
  | "object_key"
  | "archive_json"
  | "body_hash"
  | "attempts",
  string | number
>;
type LegacyCommandTerminalRow = Record<
  | "command_id"
  | "payload_hash"
  | "terminal_kind"
  | "terminal_json"
  | "command_json"
  | "terminal_at",
  string
>;
type ResolvedActionReceipt = {
  admission: BotActionAdmission;
  admissionProof: SignedNostrEvent;
  completionProof: SignedNostrEvent | null;
  source: "local" | "archive";
};
type CanonicalReceiptArchive = {
  schemaVersion: 1;
  terminalAdmission: BotActionAdmission;
  admissionProof50320: SignedNostrEvent;
  completionProof50321: SignedNostrEvent;
};
type ActionReceiptLookup =
  | { status: "found"; receipt: ResolvedActionReceipt }
  | { status: "absent" }
  | { status: "unavailable" };

const maximumArchiveBodyBytes = 4_500_000;
const maximumArchiveEventBytes = 4_000_000;
const maximumReceiptArchiveBodyBytes = 32_768;
const maximumHotActionReceipts = 1_024;
const receiptArchiveBatchSize = 20;
const commandReceiptArchiveBatchSize = 20;
const maximumActiveGrantsPerInstallation = 128;
const maximumLiveUsedJtis = 4_096;
const maximumNormalProjectionOutboxRows = 1_024;
const maximumNormalProjectionOutboxBytes = 32 * 1_024 * 1_024;
const maximumProjectionPayloadBytes = 126_000;
const maximumCompletionLiabilities = maximumHotActionReceipts;
const maximumGrantReductionLiabilities = maximumActiveGrantsPerInstallation;
const maximumRevokeLiabilities = 1;
const maximumProjectionLiabilities =
  maximumCompletionLiabilities +
  maximumGrantReductionLiabilities +
  maximumRevokeLiabilities;
const maximumProjectionOutboxRows =
  maximumNormalProjectionOutboxRows + maximumProjectionLiabilities;
const maximumProjectionOutboxBytes =
  maximumNormalProjectionOutboxBytes +
  maximumProjectionLiabilities * maximumProjectionPayloadBytes;
const maximumNormalManagementLedgerRows = 1_024;
const maximumNormalManagementLedgerBytes = 32 * 1_024 * 1_024;
const maximumManagementLedgerRowBytes = 256 * 1_024;
const maximumManagementReductionLiabilities =
  maximumActiveGrantsPerInstallation + maximumRevokeLiabilities;
const maximumManagementLedgerRows =
  maximumNormalManagementLedgerRows + maximumManagementReductionLiabilities;
const maximumManagementLedgerBytes =
  maximumNormalManagementLedgerBytes +
  maximumManagementReductionLiabilities * maximumManagementLedgerRowBytes;
const maximumNormalWakeSubscriptionOutboxRows = 256;
const maximumNormalWakeSubscriptionOutboxBytes = 1 * 1_024 * 1_024;
const maximumWakeSubscriptionTransitionBytes = 4 * 1_024;
const maximumHotBotWakes = 1_024;
const maximumOpenBotWakes = 64;
const maximumDailyBotWakeClaims = 256;
const maximumBotWakeOfferBytes = 2_048;
const botWakeQueueWatchdogMs = 60_000;
const maximumRetryAttempts = 63;

const opaqueUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const lowercaseHexDigestPattern = /^[0-9a-f]{64}$/;

const managementContracts = {
  "bot-installation.install@1": "punks://contracts/bot-installation.install@1",
  "bot-installation.configure@1":
    "punks://contracts/bot-installation.configure@1",
  "bot-installation.revoke@1": "punks://contracts/bot-installation.revoke@1",
} as const;

/** Strong Workspace-local authority for one Installation de Bot. */
export class BotInstallationDO extends DurableObject<ApiEnv> {
  private alarmScheduling: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.initialize();
      await this.repairDurableAlarm();
    });
  }

  async execute(input: unknown): Promise<BotInstallationExecuteResult> {
    return this.executeManagement(input, 2);
  }

  private async executeManagement(
    input: unknown,
    remainingPreemptionRetries: number,
  ): Promise<BotInstallationExecuteResult> {
    const command = parseManagementCommand(input);
    if (command === null) {
      return { ok: false, code: "invalid_contract" };
    }
    const installationId = this.ctx.id.name ?? "";
    if (installationId.length === 0) {
      return { ok: false, code: "internal" };
    }
    if (
      command.contract !== "bot-installation.install@1" &&
      command.installationId !== installationId
    ) {
      return { ok: false, code: "not_found" };
    }
    const payloadHash = await sha256Hex(canonicalJson(command));
    const cold = await this.coldManagementResult(
      installationId,
      command.commandId,
    );
    if (cold.status === "unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (cold.status === "found") {
      if (cold.payloadHash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (
        !(await this.reconcileColdManagementResult(
          command.commandId,
          cold.payloadHash,
          cold.terminal,
        ))
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      return cold.terminal.kind === "committed"
        ? { ok: true, value: cold.terminal.value, replayed: true }
        : { ok: false, code: cold.terminal.code };
    }

    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (isAuthorityReduction(command)) {
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_action_command WHERE singleton = 1",
        );
      }
      return {
        ok: true,
        value: JSON.parse(
          completed.response_json,
        ) as CommittedBotInstallationCommand,
        replayed: true,
      };
    }
    const rejected = this.rejected(command.commandId);
    if (rejected !== undefined) {
      if (rejected.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: false,
        code: rejected.code as
          | "not_found"
          | "forbidden"
          | "invalid_transition"
          | "conflict",
      };
    }

    let preemptedWakeConversationIds: string[] = [];
    let preemptedPending: PendingRow | undefined;
    let pending = this.pending();
    if (pending !== undefined) {
      if (pending.command_id !== command.commandId) {
        if (!isAuthorityReduction(command)) {
          return { ok: false, code: "command_in_progress" };
        }
        const pendingCommand = parseManagementCommand(
          parseJson(String(pending.command_json)),
        );
        const pendingWakeSubscriptions =
          pending.wake_subscription_json === null
            ? []
            : parseWakeSubscriptionTransitions(
                String(pending.wake_subscription_json),
              );
        if (
          pendingCommand === null ||
          isAuthorityReduction(pendingCommand) ||
          pendingWakeSubscriptions === null
        ) {
          return { ok: false, code: "command_in_progress" };
        }
        preemptedWakeConversationIds = pendingWakeSubscriptions.map(
          ({ conversationId }) => conversationId,
        );
        preemptedPending = pending;
        pending = undefined;
      }
      if (pending !== undefined && pending.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
    }

    const pendingAction = this.pendingAction();
    if (pendingAction !== undefined) {
      if (isAuthorityReduction(command)) {
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_action_command WHERE singleton = 1",
        );
      } else {
        return { ok: false, code: "command_in_progress" };
      }
    }

    if (pending !== undefined) {
      return this.attestRecheckAndFinalize(pending, true);
    }

    const current = this.committedState();
    if (this.wouldExceedActiveGrantLimit(command)) {
      return { ok: false, code: "invalid_transition" };
    }
    try {
      const context = await this.executionContext(command, current, new Date());
      const decision = await executeBotInstallation(current, command, context);
      if (
        decision.event === null ||
        decision.admission !== null ||
        decision.replayed ||
        !validateContract(
          "punks://contracts/bot-installation@1",
          decision.nextState,
        ).valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }
      const grant = grantMutation(command);
      const reductionOverlay = isAuthorityReduction(command);
      if (this.wouldExceedActiveGrantLimit(command)) {
        return { ok: false, code: "invalid_transition" };
      }
      if (
        !this.hasProjectionOutboxCapacity(
          reductionOverlay,
          decision.nextState,
          maximumProjectionPayloadBytes,
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        !(await this.ensureManagementLedgerCapacity(
          reductionOverlay,
          decision.nextState,
          maximumManagementLedgerRowBytes,
        ))
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (!reductionOverlay && !(await this.ensureJournalCapacity())) {
        return { ok: false, code: "internal" };
      }
      if (
        !this.hasProjectionOutboxCapacity(
          reductionOverlay,
          decision.nextState,
          maximumProjectionPayloadBytes,
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        !this.hasManagementLedgerCapacity(
          reductionOverlay,
          decision.nextState,
          maximumManagementLedgerRowBytes,
        )
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      const wakeSubscriptions = this.wakeSubscriptionIntents(
        command,
        decision.nextState,
        preemptedWakeConversationIds,
      );
      if (
        grant?.enabled === true &&
        !this.hasWakeSubscriptionGrantLiability(grant.resource.conversationId)
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (
        !reductionOverlay &&
        !this.hasWakeSubscriptionOutboxSlots(wakeSubscriptions)
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (preemptedPending !== undefined) {
        const preempted = await this.rejectPendingCommand(
          preemptedPending,
          new BotInstallationDomainError(
            "conflict",
            "A later authority reduction preempted this command",
          ),
          true,
        );
        if (preempted.ok || preempted.code !== "conflict") {
          const currentPending = this.pending();
          const preemptedTerminal =
            this.result(String(preemptedPending.command_id)) ??
            this.rejected(String(preemptedPending.command_id));
          if (
            remainingPreemptionRetries > 0 &&
            (preemptedTerminal !== undefined ||
              samePendingManagementIdentity(currentPending, preemptedPending))
          ) {
            return this.executeManagement(
              command,
              remainingPreemptionRetries - 1,
            );
          }
          return { ok: false, code: "internal" };
        }
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
           next_state_json, grant_json, wake_subscription_json,
           reduction_overlay, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        JSON.stringify(decision.event),
        JSON.stringify(decision.nextState),
        grant === null ? null : JSON.stringify(grant),
        wakeSubscriptions.length === 0
          ? null
          : JSON.stringify(wakeSubscriptions),
        reductionOverlay ? 1 : 0,
        new Date().toISOString(),
      );
      pending = this.pending();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      await this.ensureAlarmAt(Date.now() + 1_000);
      return this.attestRecheckAndFinalize(pending, false);
    } catch (error) {
      return this.domainFailure(error);
    }
  }

  async admitBotAction(input: unknown): Promise<BotActionAdmissionResult> {
    if (!isAdmitBotActionRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    const { command, credential, admissionCommandId } = input;
    if (this.ctx.id.name !== command.installationId) {
      return { ok: false, code: "not_found" };
    }
    const nowSeconds = Math.floor(Date.now() / 1_000);
    if (
      credential.notBefore > credential.issuedAt ||
      credential.issuedAt > credential.expiresAt ||
      credential.expiresAt - credential.issuedAt > 60 ||
      nowSeconds < credential.notBefore ||
      nowSeconds >= credential.expiresAt
    ) {
      return { ok: false, code: "invalid_credential" };
    }
    this.gcExpiredJtis();
    const admitCommand: AdmitBotActionCommand = {
      contract: "bot-action.admit@1",
      commandId: admissionCommandId,
      actionId: command.actionId,
      workspaceId: command.workspaceId,
      installationId: command.installationId,
      actor: { kind: "bot", installationId: command.installationId },
      action: command.action,
    };
    const actionDigest = await deriveBotActionDigest(admitCommand);
    const jti = this.usedJti(credential.jti);
    if (
      jti !== undefined &&
      (jti.action_id !== command.actionId ||
        jti.action_digest !== actionDigest ||
        jti.expires_at !== credential.expiresAt)
    ) {
      return { ok: false, code: "idempotency_conflict" };
    }
    const existing = await this.lookupActionReceipt(command.actionId);
    if (existing.status === "unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (existing.status === "found") {
      const exact = this.exactAdmissionResult(
        existing.receipt,
        command,
        actionDigest,
        true,
      );
      if (exact === null) {
        return { ok: false, code: "idempotency_conflict" };
      }
      if (jti === undefined) {
        if (!this.hasUsedJtiCapacity(nowSeconds)) {
          return { ok: false, code: "temporarily_unavailable" };
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO used_jti (jti, action_id, action_digest, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, ?)`,
          credential.jti,
          command.actionId,
          actionDigest,
          credential.expiresAt,
          new Date().toISOString(),
        );
        await this.scheduleNextJtiGc();
      }
      return exact;
    }
    if (jti !== undefined) {
      return { ok: false, code: "invalid_credential" };
    }
    if (!this.hasUsedJtiCapacity(nowSeconds)) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (this.hotActionReceiptCount() >= maximumHotActionReceipts) {
      this.scheduleAlarm(0);
      return { ok: false, code: "admission_limit" };
    }
    const pendingAction = this.pendingAction();
    if (pendingAction !== undefined) {
      if (
        pendingAction.operation !== "admit" ||
        pendingAction.action_id !== command.actionId ||
        pendingAction.action_digest !== actionDigest ||
        pendingAction.jti !== credential.jti
      ) {
        return { ok: false, code: "command_in_progress" };
      }
      return this.attestAndFinalizeAction(pendingAction, command, true);
    }
    if (
      !this.hasProjectionOutboxCapacity(
        false,
        this.effectiveState(),
        maximumProjectionPayloadBytes,
      )
    ) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    const pendingManagement = this.pending();
    if (
      pendingManagement !== undefined &&
      Number(pendingManagement.reduction_overlay) !== 1
    ) {
      return { ok: false, code: "command_in_progress" };
    }
    if (!(await this.ensureJournalCapacity())) {
      return { ok: false, code: "internal" };
    }
    const current = this.effectiveState();
    if (
      current === null ||
      current.id !== command.installationId ||
      current.workspaceId !== command.workspaceId ||
      current.botId !== command.botId
    ) {
      return { ok: false, code: "not_found" };
    }
    if (current.authorityGeneration !== command.authorityGeneration) {
      return { ok: false, code: "forbidden" };
    }
    if (current.openAdmissionCount >= maximumHotActionReceipts) {
      return { ok: false, code: "admission_limit" };
    }
    try {
      const context = await this.actionExecutionContext(
        admitCommand,
        current,
        null,
        new Date(),
      );
      const decision = await executeBotInstallation(
        current,
        admitCommand,
        context,
      );
      if (
        decision.event === null ||
        decision.admission === null ||
        decision.replayed ||
        decision.event.kind !== 50320
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        !this.hasUsedJtiCapacity(nowSeconds) ||
        !this.hasProjectionOutboxCapacity(
          false,
          decision.nextState,
          maximumProjectionPayloadBytes,
        )
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (this.pending() !== undefined) {
        return { ok: false, code: "command_in_progress" };
      }
      this.ctx.storage.transactionSync(() => {
        if (
          this.pending() !== undefined ||
          this.pendingAction() !== undefined ||
          canonicalJson(this.effectiveState()) !== canonicalJson(current)
        ) {
          throw new Error("Installation aggregate became busy");
        }
        if (
          !this.hasUsedJtiCapacity(nowSeconds) ||
          !this.hasProjectionOutboxCapacity(
            false,
            decision.nextState,
            maximumProjectionPayloadBytes,
          )
        ) {
          throw new Error("Installation admission capacity changed");
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO used_jti (jti, action_id, action_digest, expires_at, consumed_at)
           VALUES (?, ?, ?, ?, ?)`,
          credential.jti,
          command.actionId,
          actionDigest,
          credential.expiresAt,
          new Date().toISOString(),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO pending_action_command
            (singleton, operation, command_id, action_id, action_digest, jti,
             command_json, unsigned_json, next_state_json, admission_json,
             attempts, created_at)
           VALUES (1, 'admit', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          admissionCommandId,
          command.actionId,
          actionDigest,
          credential.jti,
          JSON.stringify(admitCommand),
          JSON.stringify(decision.event),
          JSON.stringify(decision.nextState),
          JSON.stringify(decision.admission),
          new Date().toISOString(),
        );
      });
      const pending = this.pendingAction();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      await this.ensureAlarmAt(Date.now() + 1_000);
      return this.attestAndFinalizeAction(pending, command, false);
    } catch (error) {
      return this.actionDomainFailure(error);
    }
  }

  async validateBotActionAdmission(
    input: unknown,
  ): Promise<ValidateBotActionAdmissionResult> {
    if (!isValidateAdmissionRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    if (this.ctx.id.name !== input.installationId) {
      return { ok: false, code: "not_found" };
    }
    const lookup = await this.lookupActionReceipt(input.actionId);
    if (lookup.status === "unavailable") {
      return { ok: false, code: "forbidden" };
    }
    if (lookup.status === "absent") {
      return { ok: false, code: "not_found" };
    }
    const { admission, admissionProof: proof } = lookup.receipt;
    if (
      admission.id !== input.admissionId ||
      admission.workspaceId !== input.workspaceId ||
      admission.installationId !== input.installationId ||
      admission.botId !== input.botId ||
      admission.actionDigest !== input.actionDigest ||
      admission.authorityGeneration !== input.authorityGeneration ||
      canonicalJson(proof) !== canonicalJson(input.proof)
    ) {
      return { ok: false, code: "forbidden" };
    }
    return { ok: true, admission };
  }

  async completeBotAction(input: unknown): Promise<CompleteBotActionResult> {
    if (!isCompleteBotActionRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    if (this.ctx.id.name !== input.installationId) {
      return { ok: false, code: "not_found" };
    }
    const lookup = await this.lookupActionReceipt(input.actionId);
    if (lookup.status === "unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (lookup.status === "absent") {
      return { ok: false, code: "not_found" };
    }
    const receipt = lookup.receipt.admission;
    if (
      receipt.id !== input.admissionId ||
      receipt.actionDigest !== input.actionDigest ||
      receipt.workspaceId !== input.workspaceId ||
      receipt.installationId !== input.installationId
    ) {
      return { ok: false, code: "conflict" };
    }
    if (receipt.status === "completed") {
      if (receipt.outcome !== input.outcome) {
        return { ok: false, code: "conflict" };
      }
      if (lookup.receipt.source === "local") {
        this.ctx.storage.sql.exec(
          "DELETE FROM action_deliveries WHERE action_id = ?",
          input.actionId,
        );
      }
      return { ok: true, replayed: true };
    }
    const capacityState = this.committedState();
    if (capacityState === null) {
      return { ok: false, code: "not_found" };
    }
    if (
      !this.hasProjectionOutboxCapacity(
        true,
        {
          ...capacityState,
          openAdmissionCount: Math.max(0, capacityState.openAdmissionCount - 1),
        },
        maximumProjectionPayloadBytes,
      )
    ) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    let pending = this.pendingAction();
    if (pending !== undefined) {
      if (
        pending.operation !== "complete" ||
        pending.command_id !== input.completionCommandId ||
        pending.action_id !== input.actionId ||
        pending.action_digest !== input.actionDigest
      ) {
        return { ok: false, code: "command_in_progress" };
      }
      return this.attestAndFinalizeCompletion(pending, input, true);
    }
    if (this.pending() !== undefined) {
      return { ok: false, code: "command_in_progress" };
    }
    const current = this.committedState();
    if (current === null) {
      return { ok: false, code: "not_found" };
    }
    const command: CompleteBotActionCommand = {
      contract: "bot-action.complete@1",
      commandId: input.completionCommandId,
      admissionId: input.admissionId,
      actionId: input.actionId,
      actionDigest: input.actionDigest,
      workspaceId: input.workspaceId,
      installationId: input.installationId,
      actor: { kind: "bot", installationId: input.installationId },
      outcome: input.outcome,
    };
    try {
      const context = await this.actionExecutionContext(
        command,
        current,
        receipt,
        new Date(),
      );
      const decision = await executeBotInstallation(current, command, context);
      if (
        decision.event === null ||
        decision.admission === null ||
        decision.event.kind !== 50321
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        !this.hasProjectionOutboxCapacity(
          true,
          decision.nextState,
          maximumProjectionPayloadBytes,
        )
      ) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_action_command
          (singleton, operation, command_id, action_id, action_digest, jti,
           command_json, unsigned_json, next_state_json, admission_json,
           attempts, created_at)
         VALUES (1, 'complete', ?, ?, ?, NULL, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        command.actionId,
        command.actionDigest,
        JSON.stringify(command),
        JSON.stringify(decision.event),
        JSON.stringify(decision.nextState),
        JSON.stringify(decision.admission),
        new Date().toISOString(),
      );
      pending = this.pendingAction();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      await this.ensureAlarmAt(Date.now() + 1_000);
      return this.attestAndFinalizeCompletion(pending, input, false);
    } catch (error) {
      const result = this.actionDomainFailure(error);
      if (result.ok) {
        return { ok: false, code: "internal" };
      }
      return {
        ok: false,
        code:
          result.code === "not_found" || result.code === "conflict"
            ? result.code
            : "internal",
      };
    }
  }

  query(input: unknown): BotInstallationQueryResult {
    if (
      !validateContract("punks://contracts/bot-installation.get@1", input).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    try {
      const state = queryBotInstallation(
        this.effectiveState(),
        input as GetBotInstallationQuery,
      );
      if (
        !validateContract("punks://contracts/bot-installation@1", state).valid
      ) {
        return { ok: false, code: "internal" };
      }
      return { ok: true, state };
    } catch (error) {
      if (
        error instanceof BotInstallationDomainError &&
        error.code === "not_found"
      ) {
        return { ok: false, code: "not_found" };
      }
      return { ok: false, code: "internal" };
    }
  }

  async acceptBotWakeCandidate(
    input: unknown,
  ): Promise<AcceptBotWakeCandidateResult> {
    const candidate = parseBotWakeCandidate(input);
    if (candidate === null || this.ctx.id.name !== candidate.installationId) {
      return { ok: false, code: "invalid_request" };
    }
    if (
      candidate.wakeId !==
      (await deriveBotWakeId({
        installationId: candidate.installationId,
        subscriptionEpoch: candidate.subscriptionEpoch,
        messageId: candidate.messageId,
        messageCursor: candidate.messageCursor,
      }))
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const cold = await this.readColdBotWakeReceipt(
      candidate.installationId,
      candidate.wakeId,
    );
    if (cold.status === "unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (cold.status === "found") {
      if (!botWakeCandidateMatchesOffer(candidate, cold.receipt.offer)) {
        return { ok: false, code: "conflict" };
      }
      if (!this.reconcileColdBotWakeReceipt(cold.receipt)) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      return {
        ok: true,
        wakeId: candidate.wakeId,
        replayed: true,
        terminal: true,
      };
    }
    const existing = this.botWake(candidate.wakeId);
    if (existing !== undefined) {
      const offer = await parseBotWakeOffer(existing.offer_json);
      if (offer === null || !botWakeCandidateMatchesOffer(candidate, offer)) {
        return { ok: false, code: "conflict" };
      }
      await this.scheduleNextBotWakeWork();
      return {
        ok: true,
        wakeId: candidate.wakeId,
        replayed: true,
        terminal: existing.status === "terminal",
      };
    }
    const state = this.effectiveState();
    if (!this.botWakeAuthorityMatches(state, candidate)) {
      return { ok: false, code: "authority_revoked" };
    }
    const usage = this.ctx.storage.sql
      .exec<{ total: number; open: number }>(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status != 'terminal' THEN 1 ELSE 0 END), 0)
                  AS open
         FROM bot_wakes`,
      )
      .one();
    if (
      Number(usage.total) >= maximumHotBotWakes ||
      Number(usage.open) >= maximumOpenBotWakes
    ) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (state === null || !isKnownBotRuntimeRelease(state.runtimeRelease)) {
      return { ok: false, code: "authority_revoked" };
    }
    let offer: BotWakeOffer;
    try {
      offer = await prepareBotWakeOffer({
        workspaceId: candidate.workspaceId,
        installationId: candidate.installationId,
        botId: candidate.botId,
        conversationId: candidate.conversationId,
        messageId: candidate.messageId,
        messageCursor: candidate.messageCursor,
        subscriptionEpoch: candidate.subscriptionEpoch,
        runtimeRelease: state.runtimeRelease,
        sourceEventId: candidate.sourceEventId,
        sourceEventDigest: candidate.sourceEventDigest,
        createdAt: new Date(candidate.createdAt),
      });
    } catch {
      return { ok: false, code: "invalid_request" };
    }
    const offerJson = canonicalJson(offer);
    if (utf8ByteLength(offerJson) > maximumBotWakeOfferBytes) {
      return { ok: false, code: "invalid_request" };
    }
    const offerDigest = await sha256Hex(offerJson);
    const now = new Date().toISOString();
    let accepted = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.botWake(candidate.wakeId);
      if (current !== undefined) {
        accepted =
          current.offer_json === offerJson &&
          current.offer_digest === offerDigest;
        return;
      }
      if (!this.botWakeAuthorityMatches(this.effectiveState(), candidate)) {
        return;
      }
      const currentUsage = this.ctx.storage.sql
        .exec<{ total: number; open: number }>(
          `SELECT COUNT(*) AS total,
                  COALESCE(SUM(CASE WHEN status != 'terminal' THEN 1 ELSE 0 END), 0)
                    AS open
           FROM bot_wakes`,
        )
        .one();
      if (
        Number(currentUsage.total) >= maximumHotBotWakes ||
        Number(currentUsage.open) >= maximumOpenBotWakes
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO bot_wakes
          (wake_id, offer_json, offer_digest, status, turn_id, claimed_at,
           terminal_json, completed_at, updated_at)
         VALUES (?, ?, ?, 'offered', NULL, NULL, NULL, NULL, ?)`,
        candidate.wakeId,
        offerJson,
        offerDigest,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO wake_queue_outbox
          (wake_id, attempts, next_attempt_at, created_at)
         VALUES (?, 0, 0, ?)`,
        candidate.wakeId,
        now,
      );
      accepted = true;
    });
    if (!accepted) {
      return { ok: false, code: "temporarily_unavailable" };
    }
    this.scheduleAlarm(0);
    return {
      ok: true,
      wakeId: candidate.wakeId,
      replayed: false,
      terminal: false,
    };
  }

  async claimBotWake(input: unknown): Promise<ClaimBotWakeResult> {
    if (!validateContract("punks://contracts/bot-wake.claim@1", input).valid) {
      return botWakeClaimFailure("invalid_request");
    }
    const command = input as ClaimBotWakeCommand;
    if (this.ctx.id.name !== command.installationId) {
      return botWakeClaimFailure("invalid_request");
    }
    const cold = await this.readColdBotWakeReceipt(
      command.installationId,
      command.wakeId,
    );
    if (cold.status === "unavailable") {
      return botWakeClaimFailure("temporarily_unavailable");
    }
    if (cold.status === "found") {
      if (!this.reconcileColdBotWakeReceipt(cold.receipt)) {
        return botWakeClaimFailure("temporarily_unavailable");
      }
      return {
        contract: "bot-wake.claim-result@1",
        ok: true,
        status: "terminal",
        receipt: cold.receipt,
        replayed: true,
      };
    }
    const row = this.botWake(command.wakeId);
    if (row === undefined) {
      return botWakeClaimFailure("not_found");
    }
    const offer = await parseBotWakeOffer(row.offer_json);
    if (offer === null || offer.installationId !== command.installationId) {
      return botWakeClaimFailure("internal");
    }
    if (row.status === "terminal") {
      const receipt = await parseBotWakeTerminalReceipt(row.terminal_json);
      return receipt === null
        ? botWakeClaimFailure("internal")
        : {
            contract: "bot-wake.claim-result@1",
            ok: true,
            status: "terminal",
            receipt,
            replayed: true,
          };
    }
    const turnId = await deriveBotWakeTurnId(command.wakeId);
    if (row.status === "claimed") {
      if (row.turn_id !== turnId || row.claimed_at === null) {
        return botWakeClaimFailure("internal");
      }
      return {
        contract: "bot-wake.claim-result@1",
        ok: true,
        status: "claimed",
        offer,
        turnId,
        claimedAt: row.claimed_at,
        replayed: true,
      };
    }
    if (!this.botWakeOfferAuthorityMatches(this.effectiveState(), offer)) {
      return this.terminalizeOfferedBotWake(row, offer, "revoked");
    }
    const budgetDay = new Date().toISOString().slice(0, 10);
    const budgetUsed =
      this.ctx.storage.sql
        .exec<{ claimed_count: number }>(
          `SELECT claimed_count FROM bot_wake_daily_budget
           WHERE budget_day = ?`,
          budgetDay,
        )
        .toArray()[0]?.claimed_count ?? 0;
    if (budgetUsed >= maximumDailyBotWakeClaims) {
      return this.terminalizeOfferedBotWake(row, offer, "budget_exhausted");
    }
    const claimedAt = new Date().toISOString();
    let claimed = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.botWake(command.wakeId);
      if (
        current === undefined ||
        current.status !== "offered" ||
        current.offer_json !== row.offer_json ||
        current.offer_digest !== row.offer_digest ||
        !this.botWakeOfferAuthorityMatches(this.effectiveState(), offer)
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM bot_wake_daily_budget WHERE budget_day <> ?",
        budgetDay,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO bot_wake_daily_budget (budget_day, claimed_count)
         VALUES (?, 1)
         ON CONFLICT(budget_day) DO UPDATE SET
           claimed_count = claimed_count + 1
         WHERE claimed_count < ?`,
        budgetDay,
        maximumDailyBotWakeClaims,
      );
      this.ctx.storage.sql.exec(
        `UPDATE bot_wakes
         SET status = 'claimed', turn_id = ?, claimed_at = ?, updated_at = ?
         WHERE wake_id = ? AND status = 'offered' AND offer_digest = ?`,
        turnId,
        claimedAt,
        claimedAt,
        command.wakeId,
        row.offer_digest,
      );
      claimed = this.botWake(command.wakeId)?.status === "claimed";
    });
    return claimed
      ? {
          contract: "bot-wake.claim-result@1",
          ok: true,
          status: "claimed",
          offer,
          turnId,
          claimedAt,
          replayed: false,
        }
      : botWakeClaimFailure("temporarily_unavailable");
  }

  async completeBotWake(input: unknown): Promise<ClaimBotWakeResult> {
    if (
      !validateContract("punks://contracts/bot-wake.complete@1", input).valid
    ) {
      return botWakeClaimFailure("invalid_request");
    }
    const completion = input as CompleteBotWakeCommand;
    if (this.ctx.id.name !== completion.installationId) {
      return botWakeClaimFailure("invalid_request");
    }
    const cold = await this.readColdBotWakeReceipt(
      completion.installationId,
      completion.wakeId,
    );
    if (cold.status === "unavailable") {
      return botWakeClaimFailure("temporarily_unavailable");
    }
    if (cold.status === "found") {
      if (!this.reconcileColdBotWakeReceipt(cold.receipt)) {
        return botWakeClaimFailure("temporarily_unavailable");
      }
      return cold.receipt.turnId === completion.turnId &&
        canonicalJson(cold.receipt.terminal) ===
          canonicalJson(completion.terminal)
        ? {
            contract: "bot-wake.claim-result@1",
            ok: true,
            status: "terminal",
            receipt: cold.receipt,
            replayed: true,
          }
        : botWakeClaimFailure("conflict");
    }
    const row = this.botWake(completion.wakeId);
    if (row === undefined) {
      return botWakeClaimFailure("not_found");
    }
    const offer = await parseBotWakeOffer(row.offer_json);
    if (offer === null || offer.installationId !== completion.installationId) {
      return botWakeClaimFailure("internal");
    }
    if (row.status === "terminal") {
      const receipt = await parseBotWakeTerminalReceipt(row.terminal_json);
      if (
        receipt === null ||
        receipt.turnId !== completion.turnId ||
        canonicalJson(receipt.terminal) !== canonicalJson(completion.terminal)
      ) {
        return botWakeClaimFailure("conflict");
      }
      return {
        contract: "bot-wake.claim-result@1",
        ok: true,
        status: "terminal",
        receipt,
        replayed: true,
      };
    }
    if (
      row.status !== "claimed" ||
      row.turn_id !== completion.turnId ||
      row.claimed_at === null
    ) {
      return botWakeClaimFailure("conflict");
    }
    let receipt: BotWakeTerminalReceiptArchive;
    try {
      receipt = await prepareBotWakeTerminalReceipt({
        offer,
        completion,
        claimedAt: new Date(row.claimed_at),
        completedAt: new Date(),
      });
    } catch {
      return botWakeClaimFailure("invalid_request");
    }
    if (!(await this.botWakeReactionTerminalMatchesReceipt(receipt))) {
      return botWakeClaimFailure("conflict");
    }
    const archiveJson = canonicalJson(receipt);
    const bodyHash = await deriveBotWakeReceiptDigest(receipt);
    const coordinateHash = await sha256Hex(
      `punks.bot-wake.receipt-coordinate.v1\u0000${completion.installationId}\u0000${completion.wakeId}`,
    );
    const objectKey = `bot-wake-receipts/v1/${coordinateHash.slice(0, 2)}/${coordinateHash}.json`;
    let terminal = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.botWake(completion.wakeId);
      if (
        current === undefined ||
        current.status !== "claimed" ||
        current.turn_id !== completion.turnId ||
        current.claimed_at !== row.claimed_at ||
        current.offer_digest !== row.offer_digest
      ) {
        return;
      }
      const completedAt = receipt.completedAt;
      this.ctx.storage.sql.exec(
        `UPDATE bot_wakes
         SET status = 'terminal', terminal_json = ?, completed_at = ?,
             updated_at = ?
         WHERE wake_id = ? AND status = 'claimed' AND turn_id = ?`,
        archiveJson,
        completedAt,
        completedAt,
        completion.wakeId,
        completion.turnId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO wake_receipt_archive_outbox
          (wake_id, object_key, archive_json, body_hash, attempts,
           next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)`,
        completion.wakeId,
        objectKey,
        archiveJson,
        bodyHash,
        completedAt,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM wake_queue_outbox WHERE wake_id = ?",
        completion.wakeId,
      );
      terminal = true;
    });
    if (!terminal) {
      return botWakeClaimFailure("temporarily_unavailable");
    }
    this.scheduleAlarm(0);
    return {
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      receipt,
      replayed: true,
    };
  }

  async authorizeBotWakeContext(input: unknown): Promise<
    | {
        ok: true;
        offer: BotWakeOffer;
        turnId: string;
        authorityGeneration: number;
        offerDigest: string;
      }
    | {
        ok: false;
        code:
          | "invalid_request"
          | "not_found"
          | "authority_revoked"
          | "temporarily_unavailable"
          | "internal";
      }
  > {
    if (
      !isRecord(input) ||
      !hasExactKeys(input, ["installationId", "wakeId", "turnId"]) ||
      typeof input.installationId !== "string" ||
      !opaqueUuidPattern.test(input.installationId) ||
      typeof input.wakeId !== "string" ||
      !opaqueUuidPattern.test(input.wakeId) ||
      typeof input.turnId !== "string" ||
      !opaqueUuidPattern.test(input.turnId) ||
      this.ctx.id.name !== input.installationId
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const cold = await this.readColdBotWakeReceipt(
      input.installationId,
      input.wakeId,
    );
    if (cold.status === "unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (cold.status === "found") {
      if (!this.reconcileColdBotWakeReceipt(cold.receipt)) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      return { ok: false, code: "not_found" };
    }
    const row = this.botWake(input.wakeId);
    if (row === undefined) {
      return { ok: false, code: "not_found" };
    }
    if (
      row.status !== "claimed" ||
      row.turn_id !== input.turnId ||
      row.claimed_at === null
    ) {
      return { ok: false, code: "authority_revoked" };
    }
    const offer = await parseBotWakeOffer(row.offer_json);
    if (
      offer === null ||
      row.offer_digest !== (await sha256Hex(row.offer_json))
    ) {
      return { ok: false, code: "internal" };
    }
    const state = this.effectiveState();
    if (!this.botWakeOfferAuthorityMatches(state, offer) || state === null) {
      return { ok: false, code: "authority_revoked" };
    }
    return {
      ok: true,
      offer,
      turnId: input.turnId,
      authorityGeneration: state.authorityGeneration,
      offerDigest: row.offer_digest,
    };
  }

  private async terminalizeOfferedBotWake(
    row: BotWakeRow,
    offer: BotWakeOffer,
    code: "revoked" | "budget_exhausted",
  ): Promise<ClaimBotWakeResult> {
    if (row.status !== "offered") {
      return botWakeClaimFailure("authority_revoked");
    }
    const turnId = await deriveBotWakeTurnId(offer.wakeId);
    const terminalAt = new Date();
    const completion: CompleteBotWakeCommand = {
      contract: "bot-wake.complete@1",
      installationId: offer.installationId,
      wakeId: offer.wakeId,
      turnId,
      terminal: { outcome: "failed", code },
    };
    let receipt: BotWakeTerminalReceiptArchive;
    try {
      receipt = await prepareBotWakeTerminalReceipt({
        offer,
        completion,
        claimedAt: terminalAt,
        completedAt: terminalAt,
      });
    } catch {
      return botWakeClaimFailure("internal");
    }
    const archiveJson = canonicalJson(receipt);
    const bodyHash = await deriveBotWakeReceiptDigest(receipt);
    const objectKey = await botWakeReceiptObjectKey(
      offer.installationId,
      offer.wakeId,
    );
    let terminal = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.botWake(offer.wakeId);
      if (
        current === undefined ||
        current.status !== "offered" ||
        current.offer_json !== row.offer_json ||
        current.offer_digest !== row.offer_digest
      ) {
        return;
      }
      if (code === "revoked") {
        if (this.botWakeOfferAuthorityMatches(this.effectiveState(), offer)) {
          return;
        }
      } else {
        const used =
          this.ctx.storage.sql
            .exec<{ claimed_count: number }>(
              `SELECT claimed_count FROM bot_wake_daily_budget
               WHERE budget_day = ?`,
              terminalAt.toISOString().slice(0, 10),
            )
            .toArray()[0]?.claimed_count ?? 0;
        if (used < maximumDailyBotWakeClaims) {
          return;
        }
      }
      const timestamp = terminalAt.toISOString();
      this.ctx.storage.sql.exec(
        `UPDATE bot_wakes
         SET status = 'terminal', turn_id = ?, claimed_at = ?,
             terminal_json = ?, completed_at = ?, updated_at = ?
         WHERE wake_id = ? AND status = 'offered' AND offer_digest = ?`,
        turnId,
        timestamp,
        archiveJson,
        timestamp,
        timestamp,
        offer.wakeId,
        row.offer_digest,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO wake_receipt_archive_outbox
          (wake_id, object_key, archive_json, body_hash, attempts,
           next_attempt_at, created_at)
         VALUES (?, ?, ?, ?, 0, 0, ?)`,
        offer.wakeId,
        objectKey,
        archiveJson,
        bodyHash,
        timestamp,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM wake_queue_outbox WHERE wake_id = ?",
        offer.wakeId,
      );
      terminal = true;
    });
    if (!terminal) {
      return botWakeClaimFailure("temporarily_unavailable");
    }
    this.scheduleAlarm(0);
    return {
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      receipt,
      replayed: true,
    };
  }

  private async botWakeReactionTerminalMatchesReceipt(
    receipt: BotWakeTerminalReceiptArchive,
  ): Promise<boolean> {
    if (
      receipt.terminal.outcome !== "succeeded" ||
      receipt.terminal.decision !== "react"
    ) {
      return true;
    }
    const lookup = await this.lookupActionReceipt(receipt.terminal.actionId);
    if (lookup.status !== "found") {
      return false;
    }
    const admission = lookup.receipt.admission;
    return (
      admission.status === "completed" &&
      admission.outcome === "succeeded" &&
      admission.id === receipt.terminal.admissionId &&
      admission.actionDigest === receipt.terminal.actionDigest
    );
  }

  private async readColdBotWakeReceipt(
    installationId: string,
    wakeId: string,
  ): Promise<ColdBotWakeReceiptLookup> {
    const objectKey = await botWakeReceiptObjectKey(installationId, wakeId);
    try {
      const object = await this.env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
      if (object === null) {
        return { status: "absent" };
      }
      if (object.size > 4_096) {
        return { status: "unavailable" };
      }
      const body = await object.text();
      const receipt = await parseBotWakeTerminalReceipt(body);
      if (
        receipt === null ||
        body !== canonicalJson(receipt) ||
        receipt.offer.installationId !== installationId ||
        receipt.offer.wakeId !== wakeId
      ) {
        return { status: "unavailable" };
      }
      const bodyHash = await deriveBotWakeReceiptDigest(receipt);
      const metadata = botWakeReceiptMetadata(objectKey, bodyHash);
      if (
        object.httpMetadata?.contentType !== "application/json" ||
        canonicalJson(object.customMetadata) !== canonicalJson(metadata)
      ) {
        return { status: "unavailable" };
      }
      return { status: "found", receipt };
    } catch {
      return { status: "unavailable" };
    }
  }

  private async archiveTerminalBotWakeReceipts(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<WakeReceiptArchiveOutboxRow>(
        `SELECT wake_id, object_key, archive_json, body_hash, attempts,
                next_attempt_at
         FROM wake_receipt_archive_outbox
         WHERE next_attempt_at <= ?
         ORDER BY next_attempt_at, wake_id LIMIT 20`,
        Date.now(),
      )
      .toArray();
    for (const row of rows) {
      try {
        const receipt = await parseBotWakeTerminalReceipt(row.archive_json);
        if (
          receipt === null ||
          row.archive_json !== canonicalJson(receipt) ||
          row.body_hash !== (await deriveBotWakeReceiptDigest(receipt)) ||
          row.object_key !==
            (await botWakeReceiptObjectKey(
              receipt.offer.installationId,
              receipt.offer.wakeId,
            )) ||
          receipt.offer.wakeId !== row.wake_id
        ) {
          throw new Error("invalid Bot Wake receipt archive outbox");
        }
        const metadata = botWakeReceiptMetadata(row.object_key, row.body_hash);
        await this.env.JOURNAL_ARCHIVE_BUCKET.put(
          row.object_key,
          row.archive_json,
          {
            onlyIf: { etagDoesNotMatch: "*" },
            httpMetadata: { contentType: "application/json" },
            customMetadata: metadata,
          },
        );
        const object = await this.env.JOURNAL_ARCHIVE_BUCKET.get(
          row.object_key,
        );
        if (object === null || object.size > 4_096) {
          throw new Error("Bot Wake receipt archive is unavailable");
        }
        const body = await object.text();
        if (
          body !== row.archive_json ||
          object.httpMetadata?.contentType !== "application/json" ||
          canonicalJson(object.customMetadata) !== canonicalJson(metadata)
        ) {
          throw new Error("Bot Wake receipt archive conflicts");
        }
        this.ctx.storage.transactionSync(() => {
          const current = this.ctx.storage.sql
            .exec<WakeReceiptArchiveOutboxRow>(
              `SELECT wake_id, object_key, archive_json, body_hash, attempts,
                      next_attempt_at
               FROM wake_receipt_archive_outbox WHERE wake_id = ?`,
              row.wake_id,
            )
            .toArray()[0];
          const wake = this.botWake(row.wake_id);
          if (
            current === undefined ||
            !sameWakeReceiptArchiveOutbox(current, row) ||
            wake === undefined ||
            wake.status !== "terminal" ||
            wake.terminal_json !== row.archive_json
          ) {
            return;
          }
          this.ctx.storage.sql.exec(
            "DELETE FROM wake_receipt_archive_outbox WHERE wake_id = ?",
            row.wake_id,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM bot_wakes WHERE wake_id = ? AND status = 'terminal'",
            row.wake_id,
          );
        });
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
        this.ctx.storage.sql.exec(
          `UPDATE wake_receipt_archive_outbox
           SET attempts = ?, next_attempt_at = ?
           WHERE wake_id = ? AND object_key = ? AND archive_json = ?
             AND body_hash = ? AND attempts = ?`,
          attempts,
          Date.now() + delay,
          row.wake_id,
          row.object_key,
          row.archive_json,
          row.body_hash,
          row.attempts,
        );
        this.scheduleAlarm(delay);
      }
    }
    if (rows.length === 20) {
      this.scheduleAlarm(0);
    }
    await this.scheduleNextBotWakeWork();
  }

  private async flushBotWakeQueueOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<WakeQueueOutboxRow>(
        `SELECT wake_id, attempts, next_attempt_at
         FROM wake_queue_outbox
         WHERE next_attempt_at <= ?
         ORDER BY next_attempt_at, wake_id LIMIT 20`,
        Date.now(),
      )
      .toArray();
    for (const row of rows) {
      try {
        const cold = await this.readColdBotWakeReceipt(
          this.ctx.id.name ?? "",
          row.wake_id,
        );
        if (cold.status === "unavailable") {
          throw new Error("Bot Wake cold receipt lookup is unavailable");
        }
        if (cold.status === "found") {
          if (!this.reconcileColdBotWakeReceipt(cold.receipt)) {
            throw new Error("Bot Wake cold receipt conflicts with hot state");
          }
          continue;
        }
        const wake = this.botWake(row.wake_id);
        if (wake === undefined || wake.status === "terminal") {
          throw new Error("Bot Wake Queue outbox has no live Wake");
        }
        const offer = await parseBotWakeOffer(wake.offer_json);
        if (
          offer === null ||
          wake.offer_digest !== (await sha256Hex(wake.offer_json))
        ) {
          throw new Error("Bot Wake Queue outbox offer is invalid");
        }
        if (!this.botWakeOfferAuthorityMatches(this.effectiveState(), offer)) {
          if (wake.status === "offered") {
            const terminal = await this.terminalizeOfferedBotWake(
              wake,
              offer,
              "revoked",
            );
            if (terminal.ok && terminal.status === "terminal") {
              continue;
            }
          } else if (wake.status !== "claimed") {
            throw new Error("Bot Wake Queue outbox authority is unavailable");
          }
        }
        await this.env.BOT_WAKE_QUEUE.send(botWakeQueueBody(offer));
        const nextAttemptAt = Date.now() + botWakeQueueWatchdogMs;
        let leased = false;
        this.ctx.storage.transactionSync(() => {
          const current = this.ctx.storage.sql
            .exec<WakeQueueOutboxRow>(
              `SELECT wake_id, attempts, next_attempt_at
               FROM wake_queue_outbox WHERE wake_id = ?`,
              row.wake_id,
            )
            .toArray()[0];
          const currentWake = this.botWake(row.wake_id);
          if (
            current === undefined ||
            current.attempts !== row.attempts ||
            current.next_attempt_at !== row.next_attempt_at ||
            currentWake === undefined ||
            currentWake.offer_json !== wake.offer_json ||
            currentWake.offer_digest !== wake.offer_digest
          ) {
            return;
          }
          this.ctx.storage.sql.exec(
            `UPDATE wake_queue_outbox
             SET attempts = 0, next_attempt_at = ?
             WHERE wake_id = ? AND attempts = ? AND next_attempt_at = ?`,
            nextAttemptAt,
            row.wake_id,
            row.attempts,
            row.next_attempt_at,
          );
          const refreshed = this.ctx.storage.sql
            .exec<WakeQueueOutboxRow>(
              `SELECT wake_id, attempts, next_attempt_at
               FROM wake_queue_outbox WHERE wake_id = ?`,
              row.wake_id,
            )
            .toArray()[0];
          leased =
            refreshed?.attempts === 0 &&
            refreshed.next_attempt_at === nextAttemptAt;
        });
        if (!leased) {
          this.scheduleAlarm(0);
        }
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
        this.ctx.storage.sql.exec(
          `UPDATE wake_queue_outbox
           SET attempts = ?, next_attempt_at = ?
           WHERE wake_id = ? AND attempts = ? AND next_attempt_at = ?`,
          attempts,
          Date.now() + delay,
          row.wake_id,
          row.attempts,
          row.next_attempt_at,
        );
        this.scheduleAlarm(delay);
      }
    }
    if (rows.length === 20) {
      this.scheduleAlarm(0);
    }
    await this.scheduleNextBotWakeWork();
  }

  private botWake(wakeId: string): BotWakeRow | undefined {
    return this.ctx.storage.sql
      .exec<BotWakeRow>(
        `SELECT wake_id, offer_json, offer_digest, status, turn_id, claimed_at,
                terminal_json, completed_at, updated_at
         FROM bot_wakes WHERE wake_id = ?`,
        wakeId,
      )
      .toArray()[0];
  }

  private reconcileColdBotWakeReceipt(
    receipt: BotWakeTerminalReceiptArchive,
  ): boolean {
    const offerJson = canonicalJson(receipt.offer);
    const archiveJson = canonicalJson(receipt);
    let reconciled = false;
    this.ctx.storage.transactionSync(() => {
      const wake = this.botWake(receipt.offer.wakeId);
      const archive = this.ctx.storage.sql
        .exec<{ archive_json: string }>(
          `SELECT archive_json FROM wake_receipt_archive_outbox
           WHERE wake_id = ?`,
          receipt.offer.wakeId,
        )
        .toArray()[0];
      if (
        (wake !== undefined && wake.offer_json !== offerJson) ||
        (archive !== undefined && archive.archive_json !== archiveJson)
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM wake_queue_outbox WHERE wake_id = ?",
        receipt.offer.wakeId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM wake_receipt_archive_outbox WHERE wake_id = ?",
        receipt.offer.wakeId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM bot_wakes WHERE wake_id = ?",
        receipt.offer.wakeId,
      );
      reconciled = true;
    });
    return reconciled;
  }

  private botWakeAuthorityMatches(
    state: BotInstallation | null,
    candidate: BotWakeCandidate,
  ): boolean {
    return (
      state !== null &&
      state.id === candidate.installationId &&
      state.workspaceId === candidate.workspaceId &&
      state.botId === candidate.botId &&
      state.status === "active" &&
      state.authorityGeneration === candidate.subscriptionEpoch &&
      isKnownBotRuntimeRelease(state.runtimeRelease) &&
      this.currentWakeGrantEnabled(
        "messages.react",
        candidate.conversationId,
      ) &&
      this.currentWakeGrantEnabled(
        "messages.read-context",
        candidate.conversationId,
      )
    );
  }

  private botWakeOfferAuthorityMatches(
    state: BotInstallation | null,
    offer: BotWakeOffer,
  ): boolean {
    return (
      this.botWakeAuthorityMatches(state, {
        schemaVersion: 1,
        wakeId: offer.wakeId,
        workspaceId: offer.workspaceId,
        installationId: offer.installationId,
        botId: offer.botId,
        conversationId: offer.conversationId,
        messageId: offer.messageId,
        messageCursor: offer.messageCursor,
        subscriptionEpoch: offer.subscriptionEpoch,
        sourceEventId: offer.sourceEventId,
        sourceEventDigest: offer.sourceEventDigest,
        createdAt: offer.createdAt,
      }) &&
      state !== null &&
      canonicalJson(state.runtimeRelease) ===
        canonicalJson(offer.runtimeRelease)
    );
  }

  private currentWakeGrantEnabled(
    capability: "messages.react" | "messages.read-context",
    conversationId: string,
  ): boolean {
    const pending = this.pending();
    if (pending !== undefined && Number(pending.reduction_overlay) === 1) {
      const command = parseManagementCommand(
        parseJson(String(pending.command_json)),
      );
      if (
        command === null ||
        command.contract === "bot-installation.revoke@1"
      ) {
        return false;
      }
      if (
        command.contract === "bot-installation.configure@1" &&
        command.payload.operation === "set-grant" &&
        command.payload.grant.capability === capability &&
        command.payload.grant.enabled === false &&
        command.payload.grant.resource.conversationId === conversationId
      ) {
        return false;
      }
    }
    return (
      this.ctx.storage.sql
        .exec<{ enabled: number }>(
          `SELECT enabled FROM grants
           WHERE capability = ? AND resource_kind = 'conversation'
             AND resource_id = ?`,
          capability,
          conversationId,
        )
        .toArray()[0]?.enabled === 1
    );
  }

  override async alarm(): Promise<void> {
    this.gcExpiredJtis();
    await this.scheduleNextJtiGc();
    await this.flushWakeSubscriptionOutbox();
    await this.archiveTerminalBotWakeReceipts();
    await this.flushBotWakeQueueOutbox();
    const pending = this.pending();
    if (pending !== undefined) {
      const cold = await this.coldManagementResult(
        this.ctx.id.name ?? "",
        String(pending.command_id),
      );
      if (cold.status === "found") {
        if (
          cold.payloadHash !== pending.payload_hash ||
          !(await this.reconcileColdManagementResult(
            String(pending.command_id),
            cold.payloadHash,
            cold.terminal,
          ))
        ) {
          this.scheduleAlarm(1_000);
        }
      } else if (cold.status === "missing") {
        await this.attestRecheckAndFinalize(pending, true);
      } else {
        this.scheduleAlarm(1_000);
      }
      if (this.pending() !== undefined) {
        await this.archiveCommandReceipts();
        return;
      }
    }
    const pendingAction = this.pendingAction();
    if (pendingAction !== undefined) {
      const archived = await this.readArchivedActionReceipt(
        pendingAction.action_id,
      );
      if (archived.status === "unavailable") {
        this.failPendingAction("internal");
        return;
      }
      if (archived.status === "found") {
        if (!this.reconcileColdTerminalReceipt(archived.receipt)) {
          this.failPendingAction("internal");
          return;
        }
      } else if (pendingAction.operation === "admit") {
        const actionCommand = parseAdmitCommand(pendingAction.command_json);
        if (actionCommand !== null) {
          await this.resumePendingAdmission(pendingAction, actionCommand);
        }
      } else {
        const completion = parseCompleteCommand(pendingAction.command_json);
        if (completion !== null) {
          await this.attestAndFinalizeCompletion(
            pendingAction,
            {
              workspaceId: completion.workspaceId,
              installationId: completion.installationId,
              admissionId: completion.admissionId,
              actionId: completion.actionId,
              actionDigest: completion.actionDigest,
              outcome: completion.outcome,
              completionCommandId: completion.commandId,
            },
            true,
          );
        }
      }
      if (this.pendingAction() !== undefined) {
        return;
      }
      this.gcExpiredJtis();
      await this.scheduleNextJtiGc();
    }
    await this.reconcileDeliveredBotActions();
    await this.deliverBotActions();
    await this.flushOutbox();
    await this.archiveTerminalActionReceipts();
    await this.archiveJournalIfNeeded();
    await this.archiveCommandReceipts();
  }

  private initialize(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS installation_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS grants (
        capability TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_cursor INTEGER NOT NULL,
        enabled_at TEXT,
        tombstoned_at TEXT,
        PRIMARY KEY (capability, resource_kind, resource_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS command_results (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL,
        command_json TEXT NOT NULL DEFAULT '{}',
        response_json TEXT NOT NULL,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS rejected_commands (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL,
        code TEXT NOT NULL CHECK (
          code IN ('not_found', 'forbidden', 'invalid_transition', 'conflict')
        ),
        rejected_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS command_receipt_archive_outbox (
        command_id TEXT PRIMARY KEY NOT NULL,
        payload_hash TEXT NOT NULL CHECK (length(payload_hash) = 64),
        terminal_kind TEXT NOT NULL
          CHECK (terminal_kind IN ('committed', 'rejected')),
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
        command_json TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_state_json TEXT NOT NULL,
        grant_json TEXT,
        wake_subscription_json TEXT,
        reduction_overlay INTEGER NOT NULL CHECK (reduction_overlay IN (0, 1)),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS action_receipts (
        action_id TEXT PRIMARY KEY NOT NULL,
        admission_id TEXT NOT NULL UNIQUE,
        action_digest TEXT NOT NULL CHECK (length(action_digest) = 64),
        admission_json TEXT NOT NULL,
        proof_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('admitted', 'completed')),
        outcome TEXT CHECK (outcome IN ('succeeded', 'failed')),
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'admitted' AND outcome IS NULL) OR
          (status = 'completed' AND outcome IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS wake_subscription_outbox (
        conversation_id TEXT PRIMARY KEY NOT NULL,
        transition_json TEXT NOT NULL CHECK (
          length(CAST(transition_json AS BLOB)) <= 4096
        ),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 63),
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS used_jti (
        jti TEXT PRIMARY KEY NOT NULL,
        action_id TEXT NOT NULL,
        action_digest TEXT NOT NULL CHECK (length(action_digest) = 64),
        expires_at INTEGER NOT NULL,
        consumed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS pending_action_command (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        operation TEXT NOT NULL CHECK (operation IN ('admit', 'complete')),
        command_id TEXT NOT NULL UNIQUE,
        action_id TEXT NOT NULL,
        action_digest TEXT NOT NULL CHECK (length(action_digest) = 64),
        jti TEXT,
        command_json TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_state_json TEXT NOT NULL,
        admission_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS action_deliveries (
        action_id TEXT PRIMARY KEY NOT NULL,
        admission_id TEXT NOT NULL UNIQUE,
        request_json TEXT NOT NULL CHECK (length(request_json) <= 16384),
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS receipt_archive_outbox (
        action_id TEXT PRIMARY KEY NOT NULL,
        admission_id TEXT NOT NULL UNIQUE,
        action_digest TEXT NOT NULL CHECK (length(action_digest) = 64),
        object_key TEXT NOT NULL UNIQUE,
        archive_json TEXT NOT NULL CHECK (length(archive_json) <= 32768),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        next_attempt_at INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bot_wakes (
        wake_id TEXT PRIMARY KEY NOT NULL,
        offer_json TEXT NOT NULL CHECK (
          length(CAST(offer_json AS BLOB)) <= 2048
        ),
        offer_digest TEXT NOT NULL CHECK (
          length(offer_digest) = 64 AND offer_digest GLOB '[0-9a-f]*'
        ),
        status TEXT NOT NULL CHECK (
          status IN ('offered', 'claimed', 'terminal')
        ),
        turn_id TEXT UNIQUE,
        claimed_at TEXT,
        terminal_json TEXT CHECK (
          terminal_json IS NULL OR length(CAST(terminal_json AS BLOB)) <= 4096
        ),
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'offered' AND turn_id IS NULL AND claimed_at IS NULL
            AND terminal_json IS NULL AND completed_at IS NULL) OR
          (status = 'claimed' AND turn_id IS NOT NULL AND claimed_at IS NOT NULL
            AND terminal_json IS NULL AND completed_at IS NULL) OR
          (status = 'terminal' AND turn_id IS NOT NULL AND claimed_at IS NOT NULL
            AND terminal_json IS NOT NULL AND completed_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS wake_queue_outbox (
        wake_id TEXT PRIMARY KEY NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 63),
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (wake_id) REFERENCES bot_wakes(wake_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS wake_receipt_archive_outbox (
        wake_id TEXT PRIMARY KEY NOT NULL,
        object_key TEXT NOT NULL UNIQUE,
        archive_json TEXT NOT NULL CHECK (
          length(CAST(archive_json AS BLOB)) <= 4096
        ),
        body_hash TEXT NOT NULL CHECK (length(body_hash) = 64),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 63),
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (wake_id) REFERENCES bot_wakes(wake_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS bot_wake_daily_budget (
        budget_day TEXT PRIMARY KEY NOT NULL CHECK (length(budget_day) = 10),
        claimed_count INTEGER NOT NULL CHECK (
          claimed_count BETWEEN 0 AND 256
        )
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
    this.ctx.storage.sql.exec(
      "DELETE FROM outbox WHERE delivered_at IS NOT NULL",
    );
    this.ctx.storage.sql.exec("DELETE FROM grants WHERE enabled = 0");
    this.ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS used_jti_expires_at_idx ON used_jti(expires_at)",
    );
    const resultColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(command_results)")
      .toArray();
    if (!resultColumns.some(({ name }) => name === "command_json")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE command_results ADD COLUMN command_json TEXT NOT NULL DEFAULT '{}'",
      );
    }
    const pendingColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_command)")
      .toArray();
    if (!pendingColumns.some(({ name }) => name === "wake_subscription_json")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN wake_subscription_json TEXT",
      );
    }
  }

  private committedState(): BotInstallation | null {
    const row = this.ctx.storage.sql
      .exec<StateRow>(
        "SELECT state_json FROM installation_state WHERE singleton = 1",
      )
      .toArray()[0];
    return row === undefined
      ? null
      : (JSON.parse(row.state_json) as BotInstallation);
  }

  private effectiveState(): BotInstallation | null {
    const committed = this.committedState();
    const pending = this.pending();
    if (pending === undefined || Number(pending.reduction_overlay) !== 1) {
      return committed;
    }
    const command = parseManagementCommand(
      parseJson(String(pending.command_json)),
    );
    const nextState = parseInstallation(String(pending.next_state_json));
    const event = parseUnsignedEvent(String(pending.unsigned_json));
    const grant =
      pending.grant_json === null
        ? null
        : parseGrant(String(pending.grant_json));
    return committed !== null &&
      command !== null &&
      nextState !== null &&
      event !== null &&
      validInstallationReductionOverlay(
        committed,
        command,
        nextState,
        event,
        grant,
      )
      ? nextState
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

  private rejected(commandId: string): RejectedRow | undefined {
    return this.ctx.storage.sql
      .exec<RejectedRow>(
        "SELECT payload_hash, code FROM rejected_commands WHERE command_id = ?",
        commandId,
      )
      .toArray()[0];
  }

  private commandReceiptArchiveOutbox(
    commandId: string,
  ): CommandReceiptArchiveOutboxRow | undefined {
    return this.ctx.storage.sql
      .exec<CommandReceiptArchiveOutboxRow>(
        `SELECT command_id, payload_hash, terminal_kind, object_key,
                archive_json, body_hash, attempts
         FROM command_receipt_archive_outbox WHERE command_id = ?`,
        commandId,
      )
      .toArray()[0];
  }

  private async coldManagementResult(
    installationId: string,
    commandId: string,
  ): Promise<
    | { status: "missing" }
    | {
        status: "found";
        payloadHash: string;
        terminal: BotInstallationCommandTerminal;
      }
    | { status: "unavailable" }
  > {
    try {
      const coordinate = await commandReceiptCoordinate({
        aggregate: "bot-installation",
        aggregateId: installationId,
        commandId,
      });
      const stored = await readCommandReceiptArchive(
        this.env.JOURNAL_ARCHIVE_BUCKET,
        coordinate,
      );
      if (stored.status === "missing") {
        return stored;
      }
      const archive = await parseBotInstallationCommandReceiptArchive({
        value: stored.value,
        expectedInstallationId: installationId,
        expectedCommandId: commandId,
        metadataPayloadHash: stored.metadata.payloadHash,
        metadataTerminal: stored.metadata.terminal,
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
      return {
        status: "found",
        payloadHash: archive.payloadHash,
        terminal: archive.terminal as BotInstallationCommandTerminal,
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  private async reconcileColdManagementResult(
    commandId: string,
    payloadHash: string,
    terminal: BotInstallationCommandTerminal,
  ): Promise<boolean> {
    const localCommitted = this.result(commandId);
    const localRejected = this.rejected(commandId);
    const localOutbox = this.commandReceiptArchiveOutbox(commandId);
    if (
      (terminal.kind === "committed" && localRejected !== undefined) ||
      (terminal.kind === "rejected" && localCommitted !== undefined) ||
      (localCommitted !== undefined &&
        (localCommitted.payload_hash !== payloadHash ||
          terminal.kind !== "committed" ||
          canonicalJson(parseJson(localCommitted.response_json)) !==
            canonicalJson(terminal.value))) ||
      (localRejected !== undefined &&
        (localRejected.payload_hash !== payloadHash ||
          terminal.kind !== "rejected" ||
          localRejected.code !== terminal.code)) ||
      (localOutbox !== undefined &&
        (String(localOutbox.payload_hash) !== payloadHash ||
          String(localOutbox.terminal_kind) !== terminal.kind))
    ) {
      return false;
    }

    let restoredPending = this.pending();
    if (
      restoredPending !== undefined &&
      restoredPending.command_id === commandId &&
      (restoredPending.payload_hash !== payloadHash ||
        (terminal.kind === "committed" &&
          !pendingMatchesCommittedTerminal(restoredPending, terminal.value)))
    ) {
      return false;
    }
    if (
      terminal.kind === "committed" &&
      restoredPending !== undefined &&
      restoredPending.command_id === commandId &&
      restoredPending.wake_subscription_json !== null
    ) {
      const wakeSubscriptions = parseWakeSubscriptionTransitions(
        String(restoredPending.wake_subscription_json),
      );
      if (
        wakeSubscriptions?.some(
          (transition) => transition.operation === "prepare",
        )
      ) {
        const prepared = await this.preparePendingWakeSubscription(
          restoredPending,
          false,
        );
        if (prepared === null) {
          return false;
        }
        restoredPending = prepared;
      }
    }
    if (terminal.kind === "rejected") {
      try {
        this.ctx.storage.transactionSync(() => {
          const checkedPending = this.pending();
          if (
            restoredPending !== undefined &&
            !samePendingManagementCommand(checkedPending, restoredPending)
          ) {
            throw new Error("PITR pending rejection changed");
          }
          this.ctx.storage.sql.exec(
            "DELETE FROM command_results WHERE command_id = ?",
            commandId,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM rejected_commands WHERE command_id = ?",
            commandId,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM command_receipt_archive_outbox WHERE command_id = ?",
            commandId,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM pending_command WHERE command_id = ? AND payload_hash = ?",
            commandId,
            payloadHash,
          );
        });
        return true;
      } catch {
        return false;
      }
    }

    const archived = terminal.value;
    const current = this.committedState();
    if (
      current !== null &&
      current.cursor === archived.state.cursor &&
      canonicalJson(current) !== canonicalJson(archived.state)
    ) {
      return false;
    }
    const needsStateRecovery =
      current === null || current.cursor < archived.state.cursor;
    let recovery:
      | {
          pending: PendingRow;
          command: BotInstallationManagementCommand;
          projection: BotInstallationProjectionEnvelope;
          projectionJson: string;
          reduction: boolean;
          wakeSubscriptions: BotWakeSubscriptionTransition[];
        }
      | undefined;
    if (needsStateRecovery) {
      const command =
        restoredPending === undefined
          ? null
          : parseManagementCommand(
              parseJson(String(restoredPending.command_json)),
            );
      const unsigned =
        restoredPending === undefined
          ? null
          : parseUnsignedEvent(String(restoredPending.unsigned_json));
      const reduction = Number(restoredPending?.reduction_overlay) === 1;
      const wakeSubscriptions =
        restoredPending?.wake_subscription_json === null
          ? []
          : restoredPending === undefined
            ? null
            : parseWakeSubscriptionTransitions(
                String(restoredPending.wake_subscription_json),
              );
      const content = parseJson(archived.event.content);
      const installation = isRecord(content)
        ? Reflect.get(content, "installation")
        : null;
      const configDigest = isRecord(installation)
        ? Reflect.get(installation, "configDigest")
        : null;
      const projection =
        command === null || typeof configDigest !== "string"
          ? null
          : installationProjection(
              command,
              archived.state,
              archived.event,
              configDigest,
            );
      const projectionJson =
        projection === null ? "" : JSON.stringify(projection);
      const restoredGrant = command === null ? null : grantMutation(command);
      if (
        restoredPending === undefined ||
        restoredPending.command_id !== commandId ||
        restoredPending.payload_hash !== payloadHash ||
        archived.state.cursor !== (current?.cursor ?? 0) + 1 ||
        command === null ||
        unsigned === null ||
        wakeSubscriptions === null ||
        projection === null ||
        !signedEventPreservesUnsigned(unsigned, archived.event) ||
        !validRestoredInstallationTransition(
          current,
          command,
          archived.state,
          restoredPending,
          reduction,
        ) ||
        !this.wakeSubscriptionsMatchCurrentAuthority(
          wakeSubscriptions,
          command,
          archived.state,
        ) ||
        !this.hasWakeSubscriptionOutboxCapacity(reduction, wakeSubscriptions) ||
        (restoredGrant?.enabled === true &&
          !this.hasWakeSubscriptionGrantLiability(
            restoredGrant.resource.conversationId,
          )) ||
        !validateContract(
          "punks://contracts/bot-installation.projection@1",
          projection,
        ).valid ||
        utf8ByteLength(projectionJson) > maximumProjectionPayloadBytes ||
        !this.hasProjectionOutboxCapacity(
          reduction,
          archived.state,
          utf8ByteLength(projectionJson),
        )
      ) {
        return false;
      }
      recovery = {
        pending: restoredPending,
        command,
        projection,
        projectionJson,
        reduction,
        wakeSubscriptions,
      };
    }

    try {
      this.ctx.storage.transactionSync(() => {
        if (canonicalJson(this.committedState()) !== canonicalJson(current)) {
          throw new Error("Installation changed during cold reconciliation");
        }
        if (recovery !== undefined) {
          if (!samePendingManagementCommand(this.pending(), recovery.pending)) {
            throw new Error("PITR pending commit changed");
          }
          if (
            !this.hasWakeSubscriptionOutboxCapacity(
              recovery.reduction,
              recovery.wakeSubscriptions,
            )
          ) {
            throw new Error("PITR Wake subscription outbox is saturated");
          }
          const recoveryGrant = grantMutation(recovery.command);
          if (
            recoveryGrant?.enabled === true &&
            !this.hasWakeSubscriptionGrantLiability(
              recoveryGrant.resource.conversationId,
            )
          ) {
            throw new Error("PITR Wake subscription liability is saturated");
          }
          const journal = this.ctx.storage.sql
            .exec<{ event_id: string; event_json: string }>(
              "SELECT event_id, event_json FROM journal WHERE cursor = ?",
              archived.state.cursor,
            )
            .toArray()[0];
          const projection = this.ctx.storage.sql
            .exec<{ event_id: string; payload_json: string }>(
              "SELECT event_id, payload_json FROM outbox WHERE cursor = ?",
              archived.state.cursor,
            )
            .toArray()[0];
          if (
            (journal !== undefined &&
              (journal.event_id !== archived.event.id ||
                canonicalJson(parseJson(journal.event_json)) !==
                  canonicalJson(archived.event))) ||
            (projection !== undefined &&
              (projection.event_id !== archived.event.id ||
                canonicalJson(parseJson(projection.payload_json)) !==
                  canonicalJson(recovery.projection)))
          ) {
            throw new Error("PITR journal or projection conflicts");
          }
          this.applyGrantMutation(recovery.command, archived.state);
          const enabledGrantCount = this.ctx.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM grants WHERE enabled = 1",
            )
            .one().count;
          if (enabledGrantCount !== archived.state.grantCount) {
            throw new Error("PITR normalized grants conflict");
          }
          this.ctx.storage.sql.exec(
            `INSERT INTO installation_state (singleton, state_json) VALUES (1, ?)
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
          for (const wakeSubscription of recovery.wakeSubscriptions) {
            this.ctx.storage.sql.exec(
              `INSERT INTO wake_subscription_outbox
                (conversation_id, transition_json, attempts, next_attempt_at,
                 created_at)
               VALUES (?, ?, 0, 0, ?)
               ON CONFLICT(conversation_id) DO UPDATE SET
                 transition_json = excluded.transition_json,
                 attempts = 0,
                 next_attempt_at = 0,
                 created_at = excluded.created_at
               WHERE CAST(json_extract(excluded.transition_json, '$.epoch') AS INTEGER)
                 >= CAST(json_extract(wake_subscription_outbox.transition_json, '$.epoch') AS INTEGER)`,
              wakeSubscription.conversationId,
              canonicalJson(wakeSubscription),
              archived.state.updatedAt,
            );
          }
        }
        if (current === null || current.cursor <= archived.state.cursor) {
          const content = parseJson(archived.event.content);
          if (
            archivedManagementEventIsReduction(content, archived.event.kind)
          ) {
            this.ctx.storage.sql.exec(
              "DELETE FROM pending_action_command WHERE singleton = 1",
            );
          }
        }
        this.ctx.storage.sql.exec(
          "DELETE FROM command_results WHERE command_id = ?",
          commandId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM rejected_commands WHERE command_id = ?",
          commandId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM command_receipt_archive_outbox WHERE command_id = ?",
          commandId,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_command WHERE command_id = ? AND payload_hash = ?",
          commandId,
          payloadHash,
        );
      });
      if (recovery !== undefined) {
        this.scheduleAlarm(0);
        this.ctx.waitUntil(this.flushWakeSubscriptionOutbox());
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
        `SELECT command_id, payload_hash, command_json, unsigned_json,
                next_state_json, grant_json, wake_subscription_json,
                reduction_overlay, attempts
         FROM pending_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private currentGrant(
    command: BotInstallationManagementCommand,
  ): BotInstallationGrant | null {
    const grant = grantMutation(command);
    if (grant === null) {
      return null;
    }
    const row = this.ctx.storage.sql
      .exec<GrantRow>(
        `SELECT capability, resource_kind, resource_id, enabled,
                updated_cursor, tombstoned_at
         FROM grants
         WHERE capability = ? AND resource_kind = ? AND resource_id = ?`,
        grant.capability,
        grant.resource.kind,
        grant.resource.conversationId,
      )
      .toArray()[0];
    if (row === undefined || Number(row.enabled) !== 1) {
      return null;
    }
    return {
      capability: grant.capability,
      resource: {
        kind: "conversation",
        conversationId: String(row.resource_id),
      },
      enabled: true,
    };
  }

  private wakeSubscriptionIntents(
    command: BotInstallationManagementCommand,
    nextState: BotInstallation,
    preemptedWakeConversationIds: string[] = [],
  ): BotWakeSubscriptionTransition[] {
    const previous = this.activeWakeConversationIds();
    const desired = this.desiredWakeConversationIds(command);
    const desiredSet = new Set(desired);
    const deactivated = [
      ...new Set([...previous, ...preemptedWakeConversationIds]),
    ]
      .filter((conversationId) => !desiredSet.has(conversationId))
      .sort();
    return [
      ...deactivated.map((conversationId) => ({
        operation: "deactivate" as const,
        workspaceId: nextState.workspaceId,
        conversationId,
        botId: nextState.botId,
        installationId: nextState.id,
        epoch: nextState.authorityGeneration,
      })),
      ...desired.map((conversationId) => ({
        operation: "prepare" as const,
        workspaceId: nextState.workspaceId,
        conversationId,
        botId: nextState.botId,
        installationId: nextState.id,
        epoch: nextState.authorityGeneration,
        preparationId: command.commandId,
      })),
    ];
  }

  private desiredWakeConversationIds(
    command: BotInstallationManagementCommand,
  ): string[] {
    if (
      command.contract === "bot-installation.install@1" ||
      command.contract === "bot-installation.revoke@1"
    ) {
      return [];
    }
    const capabilities = new Map<string, Set<string>>();
    for (const row of this.ctx.storage.sql
      .exec<{ capability: string; conversation_id: string }>(
        `SELECT capability, resource_id AS conversation_id
         FROM grants
         WHERE resource_kind = 'conversation' AND enabled = 1
           AND capability IN ('messages.react', 'messages.read-context')
         ORDER BY resource_id, capability
         LIMIT ?`,
        maximumActiveGrantsPerInstallation,
      )
      .toArray()) {
      const existing = capabilities.get(row.conversation_id) ?? new Set();
      existing.add(row.capability);
      capabilities.set(row.conversation_id, existing);
    }
    const grant = grantMutation(command);
    if (grant !== null) {
      const conversationId = grant.resource.conversationId;
      const existing = capabilities.get(conversationId) ?? new Set<string>();
      if (grant.enabled) {
        existing.add(grant.capability);
      } else {
        existing.delete(grant.capability);
      }
      capabilities.set(conversationId, existing);
    }
    return [...capabilities.entries()]
      .filter(
        ([, values]) =>
          values.has("messages.react") && values.has("messages.read-context"),
      )
      .map(([conversationId]) => conversationId)
      .sort();
  }

  private async preparePendingWakeSubscription(
    pending: PendingRow,
    rejectDeterministic = true,
  ): Promise<PendingRow | null> {
    if (pending.wake_subscription_json === null) {
      return pending;
    }
    const transitions = parseWakeSubscriptionTransitions(
      String(pending.wake_subscription_json),
    );
    if (transitions === null) {
      await this.markPendingFailure(pending);
      return null;
    }
    const pendingCommand = parseManagementCommand(
      parseJson(String(pending.command_json)),
    );
    if (pendingCommand === null) {
      await this.markPendingFailure(pending);
      return null;
    }
    if (isAuthorityReduction(pendingCommand)) {
      return pending;
    }
    if (!transitions.some((transition) => transition.operation === "prepare")) {
      return pending;
    }
    const preparedTransitions: BotWakeSubscriptionTransition[] = [];
    for (const transition of transitions) {
      if (transition.operation === "deactivate") {
        preparedTransitions.push(transition);
        continue;
      }
      const preparation = transition;
      let result: BotWakeSubscriptionMutationResult | null = null;
      try {
        result = validateWakeSubscriptionMutationResult(
          await this.env.CONVERSATIONS.getByName(
            preparation.conversationId,
          ).executeBotWakeSubscription(preparation),
        );
      } catch {
        result = null;
      }
      if (
        rejectDeterministic &&
        result?.ok === false &&
        result.code !== "temporarily_unavailable"
      ) {
        await this.rejectPendingCommand(
          pending,
          new BotInstallationDomainError(
            result.code === "not_found" || result.code === "forbidden"
              ? result.code
              : "conflict",
            "Conversation rejected the Wake preparation",
          ),
        );
        return null;
      }
      if (
        result === null ||
        !result.ok ||
        (result.status !== "prepared" && result.status !== "active") ||
        result.epoch !== preparation.epoch
      ) {
        await this.markPendingFailure(pending);
        return null;
      }
      preparedTransitions.push({
        ...preparation,
        operation: "activate",
        highWaterCursor: result.highWaterCursor,
      });
    }
    const preparedJson = canonicalJson(preparedTransitions);
    this.ctx.storage.sql.exec(
      `UPDATE pending_command SET wake_subscription_json = ?
       WHERE singleton = 1 AND command_id = ? AND payload_hash = ?
         AND wake_subscription_json = ?`,
      preparedJson,
      pending.command_id,
      pending.payload_hash,
      pending.wake_subscription_json,
    );
    const prepared = this.pending();
    if (
      prepared === undefined ||
      prepared.command_id !== pending.command_id ||
      prepared.payload_hash !== pending.payload_hash ||
      prepared.wake_subscription_json !== preparedJson
    ) {
      await this.markPendingFailure(pending);
      return null;
    }
    return prepared;
  }

  private wakeSubscriptionsMatchCurrentAuthority(
    transitions: BotWakeSubscriptionTransition[],
    command: BotInstallationManagementCommand,
    state: BotInstallation,
  ): boolean {
    const expected = this.wakeSubscriptionIntents(command, state);
    const expectedByConversation = new Map(
      expected.map((intent) => [intent.conversationId, intent]),
    );
    const actualByConversation = new Map(
      transitions.map((transition) => [transition.conversationId, transition]),
    );
    const reduction = isAuthorityReduction(command);
    for (const intent of expected) {
      const transition = actualByConversation.get(intent.conversationId);
      if (transition === undefined) {
        return false;
      }
      if (intent.operation === "deactivate") {
        if (canonicalJson(transition) !== canonicalJson(intent)) {
          return false;
        }
        continue;
      }
      if (
        reduction
          ? canonicalJson(transition) !== canonicalJson(intent)
          : transition.operation !== "activate" ||
            transition.workspaceId !== intent.workspaceId ||
            transition.conversationId !== intent.conversationId ||
            transition.botId !== intent.botId ||
            transition.installationId !== intent.installationId ||
            transition.epoch !== intent.epoch ||
            transition.preparationId !== intent.preparationId
      ) {
        return false;
      }
    }
    if (!reduction && transitions.length !== expected.length) {
      return false;
    }
    const desired = new Set(this.desiredWakeConversationIds(command));
    return transitions.every((transition) => {
      if (expectedByConversation.has(transition.conversationId)) {
        return true;
      }
      return (
        reduction &&
        transition.operation === "deactivate" &&
        !desired.has(transition.conversationId) &&
        transition.workspaceId === state.workspaceId &&
        transition.botId === state.botId &&
        transition.installationId === state.id &&
        transition.epoch === state.authorityGeneration
      );
    });
  }

  private activeWakeConversationIds(): string[] {
    return this.ctx.storage.sql
      .exec<{ conversation_id: string }>(
        `SELECT resource_id AS conversation_id
         FROM grants
         WHERE resource_kind = 'conversation' AND enabled = 1
           AND capability IN ('messages.react', 'messages.read-context')
         GROUP BY resource_id
         HAVING COUNT(DISTINCT capability) = 2
         ORDER BY resource_id LIMIT ?`,
        Math.floor(maximumActiveGrantsPerInstallation / 2),
      )
      .toArray()
      .map(({ conversation_id }) => conversation_id);
  }

  private hasWakeSubscriptionOutboxSlots(
    transitions: BotWakeSubscriptionTransition[],
  ): boolean {
    const expansions = transitions.filter(
      (transition) => transition.operation !== "deactivate",
    );
    if (expansions.length === 0) {
      return true;
    }
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(conversation_id AS BLOB)) +
                  length(CAST(transition_json AS BLOB))
                ), 0) AS bytes
         FROM wake_subscription_outbox`,
      )
      .one();
    let rows = usage.rows;
    let bytes = usage.bytes;
    for (const transition of expansions) {
      const current = this.ctx.storage.sql
        .exec<{ bytes: number }>(
          `SELECT length(CAST(conversation_id AS BLOB)) +
                  length(CAST(transition_json AS BLOB)) AS bytes
           FROM wake_subscription_outbox WHERE conversation_id = ?`,
          transition.conversationId,
        )
        .toArray()[0];
      if (current === undefined) {
        rows += 1;
      } else {
        bytes -= current.bytes;
      }
      bytes +=
        utf8ByteLength(transition.conversationId) +
        maximumWakeSubscriptionTransitionBytes;
    }
    return (
      rows <= maximumNormalWakeSubscriptionOutboxRows &&
      bytes <= maximumNormalWakeSubscriptionOutboxBytes
    );
  }

  private hasWakeSubscriptionGrantLiability(conversationId: string): boolean {
    const existingGrant = this.ctx.storage.sql
      .exec<{ present: number }>(
        `SELECT EXISTS(
           SELECT 1 FROM grants
           WHERE resource_kind = 'conversation' AND resource_id = ?
             AND enabled = 1
         ) AS present`,
        conversationId,
      )
      .one().present;
    const existingOutbox = this.ctx.storage.sql
      .exec<{ present: number }>(
        `SELECT EXISTS(
           SELECT 1 FROM wake_subscription_outbox WHERE conversation_id = ?
         ) AS present`,
        conversationId,
      )
      .one().present;
    if (existingGrant === 1 || existingOutbox === 1) {
      return true;
    }
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT
           (SELECT COUNT(*) FROM wake_subscription_outbox) +
           (SELECT COUNT(DISTINCT resource_id) FROM grants g
            WHERE g.resource_kind = 'conversation' AND g.enabled = 1
              AND NOT EXISTS(
                SELECT 1 FROM wake_subscription_outbox w
                WHERE w.conversation_id = g.resource_id
              )) AS rows,
           COALESCE((SELECT SUM(
             length(CAST(conversation_id AS BLOB)) +
             length(CAST(transition_json AS BLOB))
           ) FROM wake_subscription_outbox), 0) +
           COALESCE((SELECT SUM(
             length(CAST(resource_id AS BLOB)) + ?
           ) FROM (
             SELECT DISTINCT resource_id FROM grants g
             WHERE g.resource_kind = 'conversation' AND g.enabled = 1
               AND NOT EXISTS(
                 SELECT 1 FROM wake_subscription_outbox w
                 WHERE w.conversation_id = g.resource_id
               )
           )), 0) AS bytes`,
        maximumWakeSubscriptionTransitionBytes,
      )
      .one();
    return (
      usage.rows + 1 <= maximumNormalWakeSubscriptionOutboxRows &&
      usage.bytes +
        utf8ByteLength(conversationId) +
        maximumWakeSubscriptionTransitionBytes <=
        maximumNormalWakeSubscriptionOutboxBytes
    );
  }

  private hasWakeSubscriptionOutboxCapacity(
    reduction: boolean,
    transitions: BotWakeSubscriptionTransition[],
  ): boolean {
    if (reduction || transitions.length === 0) {
      return true;
    }
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(conversation_id AS BLOB)) +
                  length(CAST(transition_json AS BLOB))
                ), 0) AS bytes
         FROM wake_subscription_outbox`,
      )
      .one();
    let rows = usage.rows;
    let bytes = usage.bytes;
    for (const transition of transitions) {
      if (transition.operation !== "activate") {
        return false;
      }
      const transitionJson = canonicalJson(transition);
      const transitionBytes = utf8ByteLength(transitionJson);
      if (transitionBytes > maximumWakeSubscriptionTransitionBytes) {
        return false;
      }
      const current = this.ctx.storage.sql
        .exec<{ bytes: number }>(
          `SELECT length(CAST(conversation_id AS BLOB)) +
                  length(CAST(transition_json AS BLOB)) AS bytes
           FROM wake_subscription_outbox WHERE conversation_id = ?`,
          transition.conversationId,
        )
        .toArray()[0];
      if (current === undefined) {
        rows += 1;
      } else {
        bytes -= current.bytes;
      }
      bytes += utf8ByteLength(transition.conversationId) + transitionBytes;
    }
    return (
      rows <= maximumNormalWakeSubscriptionOutboxRows &&
      bytes <= maximumNormalWakeSubscriptionOutboxBytes
    );
  }

  private wouldExceedActiveGrantLimit(
    command: BotInstallationManagementCommand,
  ): boolean {
    const grant = grantMutation(command);
    if (grant?.enabled !== true || this.currentGrant(command) !== null) {
      return false;
    }
    return (
      this.ctx.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM grants WHERE enabled = 1",
        )
        .one().count >= maximumActiveGrantsPerInstallation
    );
  }

  private async executionContext(
    command: BotInstallationManagementCommand,
    current: BotInstallation | null,
    now: Date,
  ): Promise<BotInstallationExecutionContext> {
    const workspaceResult: unknown = await this.env.WORKSPACES.getByName(
      command.workspaceId,
    ).authorize({
      workspaceId: command.workspaceId,
      punkId: command.actor.punkId,
      permission: "bots.install",
    });
    const workspaceAuthorized = validateWorkspaceAuthorizationResult(
      workspaceResult,
      command.workspaceId,
    );
    if (workspaceAuthorized === null) {
      throw new Error("Workspace authority returned a malformed response");
    }
    if (!workspaceAuthorized.ok) {
      if (workspaceAuthorized.code === "invalid_request") {
        throw new Error("Workspace authority rejected an exact request");
      }
      throw new BotInstallationDomainError(
        workspaceAuthorized.code === "forbidden" ? "forbidden" : "not_found",
        "Workspace does not authorize Bot Installation management",
      );
    }
    if (
      command.contract === "bot-installation.configure@1" &&
      command.payload.operation === "set-grant" &&
      command.payload.grant.enabled
    ) {
      let grantAuthority: unknown;
      try {
        grantAuthority = await this.env.CONVERSATIONS.getByName(
          command.payload.grant.resource.conversationId,
        ).authorizeBotGrant({
          workspaceId: command.workspaceId,
          conversationId: command.payload.grant.resource.conversationId,
          punkId: command.actor.punkId,
        });
      } catch {
        throw new BotInstallationDomainError(
          "forbidden",
          "Conversation manager authority is unavailable",
        );
      }
      const validatedGrantAuthority = validateBotGrantAuthority(grantAuthority);
      if (validatedGrantAuthority === null || !validatedGrantAuthority.ok) {
        throw new BotInstallationDomainError(
          validatedGrantAuthority?.ok === false &&
            validatedGrantAuthority.code === "not_found"
            ? "not_found"
            : "forbidden",
          "Only a current Conversation manager can enable this Bot grant",
        );
      }
    }

    const botId =
      command.contract === "bot-installation.install@1"
        ? command.botId
        : current?.botId;
    if (botId === undefined) {
      throw new BotInstallationDomainError(
        "not_found",
        "Bot Installation does not exist",
      );
    }
    const needsBotAuthority =
      command.contract === "bot-installation.install@1" ||
      (command.contract === "bot-installation.configure@1" &&
        ((command.payload.operation === "set-grant" &&
          command.payload.grant.enabled) ||
          command.payload.operation === "pin-runtime-release"));
    let bot: Bot | null = null;
    if (needsBotAuthority) {
      const botResult: unknown = await this.env.BOTS.getByName(botId).query({
        contract: "bot.get@1",
        botId,
      });
      const botRead = validateBotQueryResult(botResult, botId);
      if (botRead === null) {
        throw new Error("Bot authority returned a malformed response");
      }
      if (!botRead.ok) {
        if (botRead.code !== "not_found") {
          throw new Error("Bot authority rejected an exact query");
        }
        throw new BotInstallationDomainError("not_found", "Bot does not exist");
      }
      bot = botRead.state;
    }

    return {
      installationId: this.ctx.id.name ?? "",
      cursor: (current?.cursor ?? 0) + 1,
      now,
      workspace: {
        id: command.workspaceId,
        status: "active",
        botsInstallAuthorized: true,
      },
      bot,
      currentGrant: this.currentGrant(command),
      existingAdmission: null,
    };
  }

  private pendingAction(): PendingActionRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingActionRow>(
        `SELECT operation, command_id, action_id, action_digest, jti,
                command_json, unsigned_json, next_state_json, admission_json,
                attempts
         FROM pending_action_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private pendingActionDeliveries(): ActionDeliveryRow[] {
    return this.ctx.storage.sql
      .exec<ActionDeliveryRow>(
        `SELECT action_id, request_json, attempts FROM action_deliveries
         WHERE delivered_at IS NULL AND next_attempt_at <= ?
         ORDER BY next_attempt_at, created_at LIMIT 20`,
        Date.now(),
      )
      .toArray();
  }

  private usedJti(jti: string): UsedJtiRow | undefined {
    return this.ctx.storage.sql
      .exec<UsedJtiRow>(
        `SELECT action_id, action_digest, expires_at
         FROM used_jti WHERE jti = ?`,
        jti,
      )
      .toArray()[0];
  }

  private hasUsedJtiCapacity(nowSeconds: number): boolean {
    return (
      this.ctx.storage.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM used_jti
           WHERE expires_at > ?
             AND jti NOT IN (
               SELECT jti FROM pending_action_command
               WHERE operation = 'admit' AND jti IS NOT NULL
             )`,
          nowSeconds,
        )
        .one().count < maximumLiveUsedJtis
    );
  }

  private actionReceiptByAction(
    actionId: string,
  ): ActionReceiptRow | undefined {
    return this.ctx.storage.sql
      .exec<ActionReceiptRow>(
        `SELECT admission_id, action_id, action_digest, admission_json,
                proof_json, status, outcome
         FROM action_receipts WHERE action_id = ?`,
        actionId,
      )
      .toArray()[0];
  }

  private hotActionReceiptCount(): number {
    return this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM action_receipts")
      .one().count;
  }

  private projectionOutboxUsage(): { bytes: number; count: number } {
    return this.ctx.storage.sql
      .exec<{ bytes: number; count: number }>(
        `SELECT COUNT(*) AS count,
                COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) AS bytes
         FROM outbox`,
      )
      .one();
  }

  private projectionLiabilities(state: BotInstallation | null): number {
    if (state === null) {
      return maximumRevokeLiabilities;
    }
    const openAdmissions = Math.min(
      maximumCompletionLiabilities,
      Math.max(0, state.openAdmissionCount),
    );
    const activeGrants = Math.min(
      maximumGrantReductionLiabilities,
      Math.max(0, state.grantCount),
    );
    return (
      openAdmissions +
      activeGrants +
      (state.status === "active" ? maximumRevokeLiabilities : 0)
    );
  }

  private hasProjectionOutboxCapacity(
    reduction: boolean,
    stateAfterWrite: BotInstallation | null,
    writeBytes: number,
  ): boolean {
    if (
      !Number.isSafeInteger(writeBytes) ||
      writeBytes < 0 ||
      writeBytes > maximumProjectionPayloadBytes
    ) {
      return false;
    }
    const usage = this.projectionOutboxUsage();
    const liabilities = this.projectionLiabilities(stateAfterWrite);
    const inheritedLiabilities = this.projectionLiabilities(
      this.committedState(),
    );
    const withinHardReserve =
      usage.count + 1 + liabilities <= maximumProjectionOutboxRows &&
      usage.bytes + writeBytes + liabilities * maximumProjectionPayloadBytes <=
        maximumProjectionOutboxBytes;
    const nonExpandingInheritedPressure =
      usage.count + 1 + liabilities <= usage.count + inheritedLiabilities &&
      usage.bytes + writeBytes + liabilities * maximumProjectionPayloadBytes <=
        usage.bytes + inheritedLiabilities * maximumProjectionPayloadBytes;
    return reduction
      ? withinHardReserve || nonExpandingInheritedPressure
      : withinHardReserve &&
          usage.count + 1 <= maximumNormalProjectionOutboxRows &&
          usage.bytes + writeBytes <= maximumNormalProjectionOutboxBytes;
  }

  private managementLedgerUsage(): { bytes: number; count: number } {
    return this.ctx.storage.sql
      .exec<{ bytes: number; count: number }>(
        `SELECT
          (SELECT COUNT(*) FROM command_results) +
          (SELECT COUNT(*) FROM rejected_commands) AS count,
          COALESCE((SELECT SUM(
            length(CAST(command_id AS BLOB)) +
            length(CAST(payload_hash AS BLOB)) +
            length(CAST(command_json AS BLOB)) +
            length(CAST(response_json AS BLOB)) +
            length(CAST(committed_at AS BLOB))
          ) FROM command_results), 0) +
          COALESCE((SELECT SUM(
            length(CAST(command_id AS BLOB)) +
            length(CAST(payload_hash AS BLOB)) +
            length(CAST(code AS BLOB)) +
            length(CAST(rejected_at AS BLOB))
          ) FROM rejected_commands), 0) AS bytes`,
      )
      .one();
  }

  private managementLiabilities(state: BotInstallation | null): number {
    return state?.status === "active"
      ? Math.min(
          maximumActiveGrantsPerInstallation,
          Math.max(0, state.grantCount),
        ) + maximumRevokeLiabilities
      : 0;
  }

  private hasManagementLedgerCapacity(
    reduction: boolean,
    stateAfterWrite: BotInstallation | null,
    writeBytes: number,
  ): boolean {
    if (
      !Number.isSafeInteger(writeBytes) ||
      writeBytes < 0 ||
      writeBytes > maximumManagementLedgerRowBytes
    ) {
      return false;
    }
    const usage = this.managementLedgerUsage();
    const liabilities = this.managementLiabilities(stateAfterWrite);
    const inheritedLiabilities = this.managementLiabilities(
      this.committedState(),
    );
    const withinHardReserve =
      usage.count + 1 + liabilities <= maximumManagementLedgerRows &&
      usage.bytes +
        writeBytes +
        liabilities * maximumManagementLedgerRowBytes <=
        maximumManagementLedgerBytes;
    const nonExpandingInheritedPressure =
      usage.count + 1 + liabilities <= usage.count + inheritedLiabilities &&
      usage.bytes +
        writeBytes +
        liabilities * maximumManagementLedgerRowBytes <=
        usage.bytes + inheritedLiabilities * maximumManagementLedgerRowBytes;
    return reduction
      ? withinHardReserve || nonExpandingInheritedPressure
      : withinHardReserve &&
          usage.count + 1 <= maximumNormalManagementLedgerRows &&
          usage.bytes + writeBytes <= maximumNormalManagementLedgerBytes;
  }

  private receiptArchiveOutboxByAction(
    actionId: string,
  ): ReceiptArchiveOutboxRow | undefined {
    return this.ctx.storage.sql
      .exec<ReceiptArchiveOutboxRow>(
        `SELECT action_id, admission_id, action_digest, object_key,
                archive_json, attempts
         FROM receipt_archive_outbox WHERE action_id = ?`,
        actionId,
      )
      .toArray()[0];
  }

  private async lookupActionReceipt(
    actionId: string,
  ): Promise<ActionReceiptLookup> {
    const archived = await this.readArchivedActionReceipt(actionId);
    if (archived.status !== "absent") {
      return archived;
    }
    const local = this.actionReceiptByAction(actionId);
    if (local === undefined) {
      return { status: "absent" };
    }
    const admission = parseAdmission(local.admission_json);
    const admissionProof = parseSignedEvent(local.proof_json);
    if (
      admission === null ||
      admissionProof === null ||
      admission.actionId !== actionId ||
      admission.id !== local.admission_id ||
      admission.actionDigest !== local.action_digest ||
      admission.status !== local.status ||
      admission.outcome !== local.outcome ||
      !(await validAdmissionProof(admission, admissionProof, this.env))
    ) {
      return { status: "unavailable" };
    }

    if (admission.status === "completed") {
      const pendingArchive = this.receiptArchiveOutboxByAction(actionId);
      if (pendingArchive !== undefined) {
        const archive = parseReceiptArchive(pendingArchive.archive_json);
        if (
          archive === null ||
          pendingArchive.action_id !== actionId ||
          pendingArchive.admission_id !== admission.id ||
          pendingArchive.action_digest !== admission.actionDigest ||
          canonicalJson(archive.terminalAdmission) !==
            canonicalJson(admission) ||
          canonicalJson(archive.admissionProof50320) !==
            canonicalJson(admissionProof) ||
          !(await validReceiptArchive(
            archive,
            admission.installationId,
            actionId,
            this.env,
          ))
        ) {
          return { status: "unavailable" };
        }
        return {
          status: "found",
          receipt: {
            admission,
            admissionProof,
            completionProof: archive.completionProof50321,
            source: "local",
          },
        };
      }
      // A terminal hot receipt without its atomically-created archive outbox
      // predates or violates this storage protocol. Serving it would leave an
      // uncompactable authority row, so fail closed until operator repair.
      return { status: "unavailable" };
    }
    return {
      status: "found",
      receipt: {
        admission,
        admissionProof,
        completionProof: null,
        source: "local",
      },
    };
  }

  private async readArchivedActionReceipt(
    actionId: string,
  ): Promise<ActionReceiptLookup> {
    const installationId = this.ctx.id.name ?? "";
    if (!isOpaqueUuid(installationId) || !isOpaqueUuid(actionId)) {
      return { status: "unavailable" };
    }
    try {
      const coordinate = await receiptArchiveCoordinate(
        installationId,
        actionId,
      );
      const object = await this.env.JOURNAL_ARCHIVE_BUCKET.get(
        coordinate.objectKey,
      );
      if (object === null) {
        return { status: "absent" };
      }
      if (object.size > maximumReceiptArchiveBodyBytes) {
        return { status: "unavailable" };
      }
      const body = await object.text();
      const archive = parseReceiptArchive(body);
      const metadata =
        archive === null
          ? null
          : receiptArchiveMetadata(coordinate, archive.terminalAdmission);
      if (
        archive === null ||
        body !== canonicalJson(archive) ||
        new TextEncoder().encode(body).byteLength >
          maximumReceiptArchiveBodyBytes ||
        object.httpMetadata?.contentType !== "application/json" ||
        metadata === null ||
        canonicalJson(object.customMetadata) !== canonicalJson(metadata) ||
        !(await validReceiptArchive(
          archive,
          installationId,
          actionId,
          this.env,
        ))
      ) {
        return { status: "unavailable" };
      }
      return {
        status: "found",
        receipt: {
          admission: archive.terminalAdmission,
          admissionProof: archive.admissionProof50320,
          completionProof: archive.completionProof50321,
          source: "archive",
        },
      };
    } catch {
      return { status: "unavailable" };
    }
  }

  private currentActionGrant(
    conversationId: string,
  ): BotInstallationGrant | null {
    const pending = this.pending();
    if (pending !== undefined && Number(pending.reduction_overlay) === 1) {
      if (this.effectiveState() === null) {
        return null;
      }
      const command = parseManagementCommand(
        parseJson(String(pending.command_json)),
      );
      if (
        command === null ||
        command.contract === "bot-installation.revoke@1"
      ) {
        return null;
      }
      if (
        command.contract === "bot-installation.configure@1" &&
        command.payload.operation === "set-grant" &&
        command.payload.grant.capability === "messages.react" &&
        command.payload.grant.enabled === false &&
        command.payload.grant.resource.kind === "conversation" &&
        command.payload.grant.resource.conversationId === conversationId
      ) {
        return null;
      }
    }
    const row = this.ctx.storage.sql
      .exec<GrantRow>(
        `SELECT capability, resource_kind, resource_id, enabled,
                updated_cursor, tombstoned_at
         FROM grants
         WHERE capability = 'messages.react'
           AND resource_kind = 'conversation'
           AND resource_id = ?`,
        conversationId,
      )
      .toArray()[0];
    return row !== undefined && Number(row.enabled) === 1
      ? {
          capability: "messages.react",
          resource: { kind: "conversation", conversationId },
          enabled: true,
        }
      : null;
  }

  private async actionExecutionContext(
    command: AdmitBotActionCommand | CompleteBotActionCommand,
    current: BotInstallation,
    receipt: BotActionAdmission | null,
    now: Date,
  ): Promise<BotInstallationExecutionContext> {
    if (command.contract === "bot-action.complete@1") {
      return {
        installationId: current.id,
        cursor: current.cursor + 1,
        now,
        workspace: {
          id: current.workspaceId,
          status: "active",
          botsInstallAuthorized: false,
        },
        bot: null,
        currentGrant: null,
        existingAdmission: receipt,
      };
    }
    const workspaceResult: unknown = await this.env.WORKSPACES.getByName(
      command.workspaceId,
    ).query({ contract: "workspace.get@1", workspaceId: command.workspaceId });
    if (!isActiveWorkspaceQueryResult(workspaceResult, command.workspaceId)) {
      throw new BotInstallationDomainError(
        workspaceResultHasNotFound(workspaceResult) ? "not_found" : "forbidden",
        "Workspace is not active for Bot action admission",
      );
    }
    const botResult: unknown = await this.env.BOTS.getByName(
      current.botId,
    ).query({
      contract: "bot.get@1",
      botId: current.botId,
    });
    const bot = validateBotQueryResult(botResult, current.botId);
    if (bot === null || !bot.ok) {
      throw new BotInstallationDomainError(
        bot?.ok === false && bot.code === "not_found"
          ? "not_found"
          : "forbidden",
        "Bot is unavailable for action admission",
      );
    }
    return {
      installationId: current.id,
      cursor: current.cursor + 1,
      now,
      workspace: {
        id: command.workspaceId,
        status: "active",
        botsInstallAuthorized: false,
      },
      bot: bot.state,
      currentGrant: this.currentActionGrant(command.action.conversationId),
      existingAdmission: receipt,
    };
  }

  private exactAdmissionResult(
    receipt: ResolvedActionReceipt,
    command: ExecuteBotActionCommand,
    actionDigest: string,
    replayed: boolean,
  ): BotActionAdmissionResult | null {
    const { admission, admissionProof: proof } = receipt;
    if (
      admission.actionId !== command.actionId ||
      admission.actionDigest !== actionDigest ||
      admission.workspaceId !== command.workspaceId ||
      admission.installationId !== command.installationId ||
      admission.botId !== command.botId ||
      admission.actionContract !== command.action.contract ||
      admission.resource.conversationId !== command.action.conversationId ||
      admission.resource.messageId !== command.action.messageId ||
      admission.authorityGeneration !== command.authorityGeneration
    ) {
      return null;
    }
    return {
      ok: true,
      admissionId: admission.id,
      admission,
      proof,
      replayed,
    };
  }

  private async resumePendingAdmission(
    pending: PendingActionRow,
    command: AdmitBotActionCommand,
  ): Promise<BotActionAdmissionResult> {
    const current = this.committedState();
    if (current === null) {
      return { ok: false, code: "not_found" };
    }
    const executeCommand = {
      contract: "bot-action.execute@1",
      credential: "pbi1.internal.a.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      invocationId: command.actionId,
      actionId: command.actionId,
      workspaceId: command.workspaceId,
      installationId: command.installationId,
      botId: current.botId,
      authorityGeneration: current.authorityGeneration,
      action: command.action,
    } as ExecuteBotActionCommand;
    return this.attestAndFinalizeAction(pending, executeCommand, true);
  }

  private async attestAndFinalizeAction(
    pending: PendingActionRow,
    executeCommand: ExecuteBotActionCommand,
    replayed: boolean,
  ): Promise<BotActionAdmissionResult> {
    const command = parseAdmitCommand(pending.command_json);
    const unsignedEvent = parseUnsignedEvent(pending.unsigned_json);
    const nextState = parseInstallation(pending.next_state_json);
    const admission = parseAdmission(pending.admission_json);
    if (
      command === null ||
      unsignedEvent === null ||
      nextState === null ||
      admission === null
    ) {
      return this.failPendingAction("internal");
    }
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent);
    } catch {
      return this.failPendingAction("attestation_failed");
    }
    try {
      const currentPending = this.pendingAction();
      if (!samePendingAction(currentPending, pending)) {
        return { ok: false, code: "forbidden" };
      }
      const current = this.committedState();
      if (
        current === null ||
        current.authorityGeneration !== admission.authorityGeneration ||
        current.status !== "active"
      ) {
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_action_command WHERE singleton = 1",
        );
        return { ok: false, code: "forbidden" };
      }
      const context = await this.actionExecutionContext(
        command,
        current,
        null,
        new Date(admission.admittedAt),
      );
      const rechecked = await executeBotInstallation(current, command, {
        ...context,
        cursor: nextState.cursor,
      });
      if (
        rechecked.event === null ||
        rechecked.admission === null ||
        canonicalJson(rechecked.event) !== canonicalJson(unsignedEvent) ||
        canonicalJson(rechecked.nextState) !== canonicalJson(nextState) ||
        canonicalJson(rechecked.admission) !== canonicalJson(admission)
      ) {
        throw new BotInstallationDomainError(
          "conflict",
          "Admission authority changed before commit",
        );
      }
    } catch (error) {
      if (error instanceof BotInstallationDomainError) {
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_action_command WHERE singleton = 1",
        );
        return this.actionDomainFailure(error);
      }
      return this.failPendingAction("internal");
    }
    const delivery: ExecuteAdmittedBotReactionRequest = {
      contract: "bot-action.delivery@1",
      workspaceId: admission.workspaceId,
      installationId: admission.installationId,
      botId: admission.botId,
      actionId: admission.actionId,
      actionDigest: admission.actionDigest,
      authorityGeneration: admission.authorityGeneration,
      admissionId: admission.id,
      proof: signedEvent as ExecuteAdmittedBotReactionRequest["proof"],
      action: executeCommand.action,
      reactionCommandId: await deriveOpaqueUuid(
        "punks.bot-reaction-command.v1",
        `${admission.id}\u0000${admission.actionId}`,
      ),
      completionCommandId: await deriveOpaqueUuid(
        "punks.bot-action-completion-command.v1",
        `${admission.id}\u0000succeeded`,
      ),
      failureCompletionCommandId: await deriveOpaqueUuid(
        "punks.bot-action-completion-command.v1",
        `${admission.id}\u0000failed`,
      ),
    };
    const deliveryJson = JSON.stringify(delivery);
    if (
      new TextEncoder().encode(deliveryJson).byteLength > 16_384 ||
      !isActionDeliveryRequest(delivery)
    ) {
      return this.failPendingAction("internal");
    }
    const projection = actionProjection(
      nextState,
      signedEvent,
      admission,
      false,
    );
    if (
      !validateContract(
        "punks://contracts/bot-installation.projection@1",
        projection,
      ).valid
    ) {
      return this.failPendingAction("internal");
    }
    const projectionJson = JSON.stringify(projection);
    if (
      !this.hasProjectionOutboxCapacity(
        false,
        nextState,
        utf8ByteLength(projectionJson),
      )
    ) {
      return this.failPendingAction("internal");
    }
    let committed = false;
    try {
      this.ctx.storage.transactionSync(() => {
        if (!samePendingAction(this.pendingAction(), pending)) {
          return;
        }
        const current = this.committedState();
        if (
          current === null ||
          current.cursor + 1 !== nextState.cursor ||
          current.authorityGeneration !== nextState.authorityGeneration
        ) {
          throw new Error("Installation changed before admission commit");
        }
        if (
          !this.hasProjectionOutboxCapacity(
            false,
            nextState,
            utf8ByteLength(projectionJson),
          )
        ) {
          throw new Error("Installation projection outbox is full");
        }
        const now = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO installation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextState),
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO action_receipts
            (action_id, admission_id, action_digest, admission_json, proof_json,
             status, outcome, updated_at)
           VALUES (?, ?, ?, ?, ?, 'admitted', NULL, ?)`,
          admission.actionId,
          admission.id,
          admission.actionDigest,
          JSON.stringify(admission),
          JSON.stringify(signedEvent),
          now,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO action_deliveries
            (action_id, admission_id, request_json, delivered_at, attempts,
             next_attempt_at, created_at)
           VALUES (?, ?, ?, NULL, 0, ?, ?)`,
          admission.actionId,
          admission.id,
          deliveryJson,
          Date.now(),
          now,
        );
        this.writeActionJournalAndOutbox(
          nextState,
          signedEvent,
          projection,
          now,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_action_command WHERE singleton = 1",
        );
        committed = true;
      });
    } catch {
      return this.failPendingAction("internal");
    }
    if (!committed) {
      const existing = await this.lookupActionReceipt(admission.actionId);
      const exact =
        existing.status !== "found"
          ? null
          : this.exactAdmissionResult(
              existing.receipt,
              executeCommand,
              admission.actionDigest,
              true,
            );
      return exact ?? { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    return {
      ok: true,
      admissionId: admission.id,
      admission,
      proof: signedEvent,
      replayed,
    };
  }

  private async attestAndFinalizeCompletion(
    pending: PendingActionRow,
    input: CompleteBotActionRequest,
    replayed: boolean,
  ): Promise<CompleteBotActionResult> {
    const command = parseCompleteCommand(pending.command_json);
    const unsignedEvent = parseUnsignedEvent(pending.unsigned_json);
    const nextState = parseInstallation(pending.next_state_json);
    const tombstone = parseAdmission(pending.admission_json);
    if (
      command === null ||
      unsignedEvent === null ||
      nextState === null ||
      tombstone === null
    ) {
      return completionFailure(this.failPendingAction("internal"));
    }
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent);
    } catch {
      return completionFailure(this.failPendingAction("attestation_failed"));
    }
    const projection = actionProjection(
      nextState,
      signedEvent,
      tombstone,
      true,
    );
    if (
      !validateContract(
        "punks://contracts/bot-installation.projection@1",
        projection,
      ).valid
    ) {
      return completionFailure(this.failPendingAction("internal"));
    }
    const hotReceipt = this.actionReceiptByAction(input.actionId);
    const admissionProof =
      hotReceipt === undefined ? null : parseSignedEvent(hotReceipt.proof_json);
    if (
      hotReceipt === undefined ||
      admissionProof === null ||
      tombstone.status !== "completed" ||
      tombstone.outcome === null
    ) {
      return completionFailure(this.failPendingAction("internal"));
    }
    const coordinate = await receiptArchiveCoordinate(
      input.installationId,
      input.actionId,
    );
    const receiptArchive: CanonicalReceiptArchive = {
      schemaVersion: 1,
      terminalAdmission: tombstone,
      admissionProof50320: admissionProof,
      completionProof50321: signedEvent,
    };
    const receiptArchiveJson = canonicalJson(receiptArchive);
    const projectionJson = JSON.stringify(projection);
    if (
      hotReceipt.status !== "admitted" ||
      hotReceipt.admission_id !== tombstone.id ||
      hotReceipt.action_digest !== tombstone.actionDigest ||
      new TextEncoder().encode(receiptArchiveJson).byteLength >
        maximumReceiptArchiveBodyBytes ||
      !this.hasProjectionOutboxCapacity(
        true,
        nextState,
        utf8ByteLength(projectionJson),
      ) ||
      !(await validReceiptArchive(
        receiptArchive,
        input.installationId,
        input.actionId,
        this.env,
      ))
    ) {
      return completionFailure(this.failPendingAction("internal"));
    }
    let committed = false;
    try {
      this.ctx.storage.transactionSync(() => {
        if (!samePendingAction(this.pendingAction(), pending)) {
          return;
        }
        const current = this.committedState();
        const row = this.actionReceiptByAction(input.actionId);
        const receipt =
          row === undefined ? null : parseAdmission(row.admission_json);
        if (
          current === null ||
          receipt === null ||
          receipt.status !== "admitted" ||
          current.cursor + 1 !== nextState.cursor ||
          receipt.id !== input.admissionId ||
          receipt.actionDigest !== input.actionDigest
        ) {
          throw new Error("Admission changed before completion commit");
        }
        if (
          !this.hasProjectionOutboxCapacity(
            true,
            nextState,
            utf8ByteLength(projectionJson),
          )
        ) {
          throw new Error("Installation projection reserve is exhausted");
        }
        const now = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO installation_state (singleton, state_json) VALUES (1, ?)
           ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
          JSON.stringify(nextState),
        );
        this.ctx.storage.sql.exec(
          `UPDATE action_receipts
           SET admission_json = ?, status = 'completed',
               outcome = ?, updated_at = ?
           WHERE action_id = ?`,
          JSON.stringify(tombstone),
          input.outcome,
          now,
          input.actionId,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO receipt_archive_outbox
            (action_id, admission_id, action_digest, object_key, archive_json,
             attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          tombstone.actionId,
          tombstone.id,
          tombstone.actionDigest,
          coordinate.objectKey,
          receiptArchiveJson,
          Date.now() + 1_000,
          now,
        );
        this.writeActionJournalAndOutbox(
          nextState,
          signedEvent,
          projection,
          now,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_action_command WHERE singleton = 1",
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM action_deliveries WHERE action_id = ?",
          input.actionId,
        );
        committed = true;
      });
    } catch {
      return completionFailure(this.failPendingAction("internal"));
    }
    if (!committed) {
      const existing = await this.lookupActionReceipt(input.actionId);
      return existing.status === "found" &&
        existing.receipt.admission.status === "completed" &&
        existing.receipt.admission.outcome === input.outcome
        ? { ok: true, replayed: true }
        : { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    this.ctx.waitUntil(this.flushOutbox());
    return { ok: true, replayed };
  }

  private writeActionJournalAndOutbox(
    state: BotInstallation,
    event: SignedNostrEvent,
    projection: BotInstallationProjectionEnvelope,
    committedAt: string,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO journal (cursor, event_id, event_kind, event_json, committed_at)
       VALUES (?, ?, ?, ?, ?)`,
      state.cursor,
      event.id,
      event.kind,
      JSON.stringify(event),
      committedAt,
    );
    this.ctx.storage.sql.exec(
      `INSERT INTO outbox (event_id, cursor, payload_json, delivered_at, attempts)
       VALUES (?, ?, ?, NULL, 0)`,
      event.id,
      state.cursor,
      JSON.stringify(projection),
    );
  }

  private failPendingAction(
    code: "attestation_failed" | "internal",
  ): Extract<BotActionAdmissionResult, { ok: false }> {
    const pending = this.pendingAction();
    if (pending !== undefined) {
      const attempts = nextRetryAttempt(pending.attempts);
      this.ctx.storage.sql.exec(
        "UPDATE pending_action_command SET attempts = ? WHERE singleton = 1",
        attempts,
      );
      this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
    }
    return { ok: false, code };
  }

  private async deliverBotActions(): Promise<void> {
    for (const row of this.pendingActionDeliveries()) {
      const request = parseActionDeliveryRequest(row.request_json);
      if (request === null || !(await validActionDeliveryIds(request))) {
        this.deferActionDelivery(row);
        continue;
      }
      const receiptLookup = await this.lookupActionReceipt(row.action_id);
      if (receiptLookup.status !== "found") {
        this.deferActionDelivery(row);
        continue;
      }
      if (receiptLookup.receipt.admission.status === "completed") {
        if (
          receiptLookup.receipt.source === "archive" &&
          !this.reconcileColdTerminalReceipt(receiptLookup.receipt)
        ) {
          this.deferActionDelivery(row);
        } else {
          this.ctx.storage.sql.exec(
            "DELETE FROM action_deliveries WHERE action_id = ?",
            row.action_id,
          );
        }
        continue;
      }
      if (
        receiptLookup.receipt.admission.id !== request.admissionId ||
        receiptLookup.receipt.admission.actionDigest !== request.actionDigest ||
        canonicalJson(receiptLookup.receipt.admissionProof) !==
          canonicalJson(request.proof)
      ) {
        this.deferActionDelivery(row);
        continue;
      }
      let result: ExecuteAdmittedBotReactionResult | null = null;
      try {
        const raw: unknown = await this.env.CONVERSATIONS.getByName(
          request.action.conversationId,
        ).executeBotReaction(request);
        result = validateActionDeliveryResult(raw);
      } catch {
        result = null;
      }
      if (result?.ok === true) {
        this.ctx.storage.sql.exec(
          `UPDATE action_deliveries SET delivered_at = ?, next_attempt_at = ?
           WHERE action_id = ? AND delivered_at IS NULL`,
          new Date().toISOString(),
          Date.now(),
          row.action_id,
        );
        continue;
      }
      this.deferActionDelivery(row);
    }
    await this.scheduleNextActionDelivery();
  }

  private async reconcileDeliveredBotActions(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<ActionDeliveryRow>(
        `SELECT action_id, request_json, attempts FROM action_deliveries
         WHERE delivered_at IS NOT NULL AND next_attempt_at <= ?
         ORDER BY next_attempt_at, created_at LIMIT 20`,
        Date.now(),
      )
      .toArray();
    for (const row of rows) {
      const archived = await this.readArchivedActionReceipt(row.action_id);
      if (archived.status === "found") {
        if (!this.reconcileColdTerminalReceipt(archived.receipt)) {
          this.deferActionDelivery(row);
        }
        continue;
      }
      if (archived.status === "unavailable") {
        this.deferActionDelivery(row);
        await this.ensureAlarmAt(
          Date.now() +
            Math.min(
              60_000,
              2 ** Math.min(nextRetryAttempt(row.attempts), 6) * 1_000,
            ),
        );
        continue;
      }
      // A delivered action normally waits for ConversationDO to submit its
      // durable completion. Cold absence is not work to poll in a hot loop;
      // constructor repair or any later aggregate alarm will check again.
      this.ctx.storage.sql.exec(
        `UPDATE action_deliveries SET next_attempt_at = ?
         WHERE action_id = ? AND delivered_at IS NOT NULL`,
        Date.now() + 60_000,
        row.action_id,
      );
    }
  }

  private reconcileColdTerminalReceipt(
    receipt: ResolvedActionReceipt,
  ): boolean {
    if (
      receipt.source !== "archive" ||
      receipt.admission.status !== "completed"
    ) {
      return false;
    }
    let reconciled = false;
    this.ctx.storage.transactionSync(() => {
      const terminal = receipt.admission;
      const local = this.actionReceiptByAction(terminal.actionId);
      const pending = this.pendingAction();
      const delivery = this.ctx.storage.sql
        .exec<{ admission_id: string; request_json: string }>(
          `SELECT admission_id, request_json FROM action_deliveries
           WHERE action_id = ?`,
          terminal.actionId,
        )
        .toArray()[0];
      const request =
        delivery === undefined
          ? null
          : parseActionDeliveryRequest(delivery.request_json);
      const outbox = this.receiptArchiveOutboxByAction(terminal.actionId);
      if (
        (local !== undefined &&
          (local.admission_id !== terminal.id ||
            local.action_digest !== terminal.actionDigest)) ||
        (pending !== undefined &&
          (pending.action_id !== terminal.actionId ||
            pending.action_digest !== terminal.actionDigest)) ||
        (delivery !== undefined &&
          (delivery.admission_id !== terminal.id ||
            request === null ||
            request.actionId !== terminal.actionId ||
            request.actionDigest !== terminal.actionDigest)) ||
        (outbox !== undefined &&
          (outbox.admission_id !== terminal.id ||
            outbox.action_digest !== terminal.actionDigest))
      ) {
        return;
      }
      if (local?.status === "admitted") {
        const state = this.committedState();
        if (
          state === null ||
          state.id !== terminal.installationId ||
          state.workspaceId !== terminal.workspaceId ||
          state.botId !== terminal.botId ||
          state.openAdmissionCount < 1
        ) {
          return;
        }
        this.ctx.storage.sql.exec(
          "UPDATE installation_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify({
            ...state,
            openAdmissionCount: state.openAdmissionCount - 1,
          }),
        );
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM action_deliveries WHERE action_id = ?",
        terminal.actionId,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_action_command WHERE action_id = ? AND action_digest = ?",
        terminal.actionId,
        terminal.actionDigest,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM receipt_archive_outbox WHERE action_id = ? AND action_digest = ?",
        terminal.actionId,
        terminal.actionDigest,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM action_receipts WHERE action_id = ? AND action_digest = ?",
        terminal.actionId,
        terminal.actionDigest,
      );
      reconciled = true;
    });
    return reconciled;
  }

  private deferActionDelivery(row: ActionDeliveryRow): void {
    const attempts = nextRetryAttempt(row.attempts);
    const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
    this.ctx.storage.sql.exec(
      `UPDATE action_deliveries SET attempts = ?, next_attempt_at = ?
       WHERE action_id = ?`,
      attempts,
      Date.now() + delay,
      row.action_id,
    );
  }

  private pendingReceiptArchives(): ReceiptArchiveOutboxRow[] {
    return this.ctx.storage.sql
      .exec<ReceiptArchiveOutboxRow>(
        `SELECT action_id, admission_id, action_digest, object_key,
                archive_json, attempts
         FROM receipt_archive_outbox
         WHERE next_attempt_at <= ?
         ORDER BY next_attempt_at, created_at
         LIMIT ?`,
        Date.now(),
        receiptArchiveBatchSize,
      )
      .toArray();
  }

  private async archiveTerminalActionReceipts(): Promise<void> {
    const rows = this.pendingReceiptArchives();
    for (const row of rows) {
      try {
        await this.writeTerminalActionReceipt(row);
      } catch {
        const current = this.receiptArchiveOutboxByAction(row.action_id);
        if (
          current === undefined ||
          current.object_key !== row.object_key ||
          current.archive_json !== row.archive_json
        ) {
          continue;
        }
        const attempts = nextRetryAttempt(current.attempts);
        const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
        this.ctx.storage.sql.exec(
          `UPDATE receipt_archive_outbox
           SET attempts = ?, next_attempt_at = ?
           WHERE action_id = ? AND object_key = ? AND archive_json = ?`,
          attempts,
          Date.now() + delay,
          row.action_id,
          row.object_key,
          row.archive_json,
        );
      }
    }
    await this.scheduleNextReceiptArchive();
  }

  private async writeTerminalActionReceipt(
    pending: ReceiptArchiveOutboxRow,
  ): Promise<void> {
    const archive = parseReceiptArchive(pending.archive_json);
    if (
      archive === null ||
      pending.archive_json !== canonicalJson(archive) ||
      new TextEncoder().encode(pending.archive_json).byteLength >
        maximumReceiptArchiveBodyBytes ||
      archive.terminalAdmission.id !== pending.admission_id ||
      archive.terminalAdmission.actionDigest !== pending.action_digest ||
      archive.terminalAdmission.actionId !== pending.action_id
    ) {
      throw new Error("Pending Bot action receipt archive is corrupt");
    }
    const coordinate = await receiptArchiveCoordinate(
      archive.terminalAdmission.installationId,
      archive.terminalAdmission.actionId,
    );
    if (
      coordinate.objectKey !== pending.object_key ||
      !(await validReceiptArchive(
        archive,
        archive.terminalAdmission.installationId,
        pending.action_id,
        this.env,
      ))
    ) {
      throw new Error("Pending Bot action receipt archive is not canonical");
    }
    const metadata = receiptArchiveMetadata(
      coordinate,
      archive.terminalAdmission,
    );
    const stored = await this.env.JOURNAL_ARCHIVE_BUCKET.put(
      coordinate.objectKey,
      pending.archive_json,
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: metadata,
      },
    );
    if (stored === null) {
      const existing = await this.env.JOURNAL_ARCHIVE_BUCKET.get(
        coordinate.objectKey,
      );
      if (
        existing === null ||
        existing.size > maximumReceiptArchiveBodyBytes ||
        existing.httpMetadata?.contentType !== "application/json" ||
        canonicalJson(existing.customMetadata) !== canonicalJson(metadata)
      ) {
        throw new Error("Existing Bot action receipt archive is unavailable");
      }
      const existingBody = await existing.text();
      const existingArchive = parseReceiptArchive(existingBody);
      if (
        existingArchive === null ||
        existingBody !== pending.archive_json ||
        existingBody !== canonicalJson(existingArchive) ||
        !(await validReceiptArchive(
          existingArchive,
          archive.terminalAdmission.installationId,
          pending.action_id,
          this.env,
        ))
      ) {
        throw new Error(
          "Existing Bot action receipt archive failed exact validation",
        );
      }
    }

    this.ctx.storage.transactionSync(() => {
      const currentOutbox = this.receiptArchiveOutboxByAction(
        pending.action_id,
      );
      const currentReceipt = this.actionReceiptByAction(pending.action_id);
      if (
        currentOutbox === undefined ||
        currentReceipt === undefined ||
        currentOutbox.admission_id !== pending.admission_id ||
        currentOutbox.action_digest !== pending.action_digest ||
        currentOutbox.object_key !== pending.object_key ||
        currentOutbox.archive_json !== pending.archive_json ||
        currentReceipt.admission_id !== pending.admission_id ||
        currentReceipt.action_digest !== pending.action_digest ||
        currentReceipt.status !== "completed" ||
        currentReceipt.outcome !== archive.terminalAdmission.outcome ||
        canonicalJson(parseJson(currentReceipt.admission_json)) !==
          canonicalJson(archive.terminalAdmission) ||
        canonicalJson(parseJson(currentReceipt.proof_json)) !==
          canonicalJson(archive.admissionProof50320)
      ) {
        throw new Error("Bot action receipt changed before archive commit");
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM action_receipts WHERE action_id = ?",
        pending.action_id,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM receipt_archive_outbox WHERE action_id = ?",
        pending.action_id,
      );
    });
  }

  private async scheduleNextReceiptArchive(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        "SELECT MIN(next_attempt_at) AS next_attempt_at FROM receipt_archive_outbox",
      )
      .one().next_attempt_at;
    if (next !== null) {
      await this.ensureAlarmAt(Math.max(Date.now() + 1, next));
    }
  }

  private async scheduleNextActionDelivery(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at FROM action_deliveries
         WHERE delivered_at IS NULL`,
      )
      .one().next_attempt_at;
    if (next !== null) {
      await this.ensureAlarmAt(Math.max(Date.now() + 1, next));
    }
  }

  private actionDomainFailure(error: unknown): BotActionAdmissionResult {
    if (!(error instanceof BotInstallationDomainError)) {
      return { ok: false, code: "internal" };
    }
    return {
      ok: false,
      code: error.code === "already_exists" ? "invalid_transition" : error.code,
    };
  }

  private async attestRecheckAndFinalize(
    pending: PendingRow,
    replayed: boolean,
  ): Promise<BotInstallationExecuteResult> {
    const preparedPending = await this.preparePendingWakeSubscription(pending);
    if (preparedPending === null) {
      const rejected = this.rejected(String(pending.command_id));
      if (rejected?.payload_hash === pending.payload_hash) {
        return {
          ok: false,
          code: rejected.code as
            | "not_found"
            | "forbidden"
            | "invalid_transition"
            | "conflict",
        };
      }
      return { ok: false, code: "internal" };
    }
    pending = preparedPending;
    const unsignedEvent = JSON.parse(
      String(pending.unsigned_json),
    ) as UnsignedNostrEvent;
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(unsignedEvent);
    } catch {
      await this.markPendingFailure(pending);
      return { ok: false, code: "attestation_failed" };
    }

    const command = JSON.parse(
      String(pending.command_json),
    ) as BotInstallationManagementCommand;
    const nextState = JSON.parse(
      String(pending.next_state_json),
    ) as BotInstallation;
    try {
      const current = this.committedState();
      if (this.wouldExceedActiveGrantLimit(command)) {
        throw new BotInstallationDomainError(
          "invalid_transition",
          "A Bot Installation cannot enable more than 128 active grants",
        );
      }
      const context = await this.executionContext(
        command,
        current,
        new Date(nextState.updatedAt),
      );
      const rechecked = await executeBotInstallation(current, command, {
        ...context,
        cursor: nextState.cursor,
      });
      if (
        rechecked.event === null ||
        rechecked.admission !== null ||
        canonicalJson(rechecked.nextState) !== canonicalJson(nextState) ||
        canonicalJson(rechecked.event) !== canonicalJson(unsignedEvent)
      ) {
        throw new BotInstallationDomainError(
          "conflict",
          "Authority changed before Installation commit",
        );
      }
    } catch (error) {
      if (error instanceof BotInstallationDomainError) {
        if (!isAuthorityReduction(command)) {
          return this.rejectPendingCommand(pending, error);
        }
        // A reduction was authorized before attestation and cannot expand
        // authority. Commit it even when a later authoritative check denies.
      } else {
        await this.markPendingFailure(pending);
        return { ok: false, code: "internal" };
      }
    }

    const configDigest = await sha256Hex(canonicalJson(nextState.config));
    const projection = installationProjection(
      command,
      nextState,
      signedEvent,
      configDigest,
    );
    if (
      !validateContract(
        "punks://contracts/bot-installation.projection@1",
        projection,
      ).valid
    ) {
      await this.markPendingFailure(pending);
      return { ok: false, code: "internal" };
    }
    const reductionOverlay = isAuthorityReduction(command);
    const grant = grantMutation(command);
    const wakeSubscriptions =
      pending.wake_subscription_json === null
        ? []
        : parseWakeSubscriptionTransitions(
            String(pending.wake_subscription_json),
          );
    if (
      wakeSubscriptions === null ||
      !this.wakeSubscriptionsMatchCurrentAuthority(
        wakeSubscriptions,
        command,
        nextState,
      )
    ) {
      await this.markPendingFailure(pending);
      return { ok: false, code: "internal" };
    }
    const projectionJson = JSON.stringify(projection);
    const response: CommittedBotInstallationCommand = {
      state: nextState,
      event: signedEvent,
    };
    const responseJson = JSON.stringify(response);
    let commandReceipt: PreparedCommandReceiptArchive;
    try {
      commandReceipt = await prepareBotInstallationCommandReceipt({
        installationId: nextState.id,
        commandId: String(pending.command_id),
        payloadHash: String(pending.payload_hash),
        terminal: { kind: "committed", value: response },
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
    } catch {
      await this.markPendingFailure(pending);
      return { ok: false, code: "internal" };
    }
    const commandResultBytes =
      utf8ByteLength(String(pending.command_id)) +
      utf8ByteLength(String(pending.payload_hash)) +
      utf8ByteLength("{}") +
      utf8ByteLength(responseJson) +
      utf8ByteLength(new Date().toISOString());
    if (
      Number(pending.reduction_overlay) !== (reductionOverlay ? 1 : 0) ||
      !this.hasProjectionOutboxCapacity(
        reductionOverlay,
        nextState,
        utf8ByteLength(projectionJson),
      ) ||
      !this.hasManagementLedgerCapacity(
        reductionOverlay,
        nextState,
        commandResultBytes,
      ) ||
      !this.hasWakeSubscriptionOutboxCapacity(
        reductionOverlay,
        wakeSubscriptions,
      ) ||
      (grant?.enabled === true &&
        !this.hasWakeSubscriptionGrantLiability(grant.resource.conversationId))
    ) {
      await this.markPendingFailure(pending);
      return { ok: false, code: "internal" };
    }
    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    let finalized: CommittedBotInstallationCommand | undefined;
    try {
      this.ctx.storage.transactionSync(() => {
        const currentPending = this.pending();
        if (currentPending === undefined) {
          const existing = this.result(commandId);
          if (existing?.payload_hash === payloadHash) {
            finalized = JSON.parse(
              existing.response_json,
            ) as CommittedBotInstallationCommand;
          }
          return;
        }
        if (
          currentPending.command_id !== commandId ||
          currentPending.payload_hash !== payloadHash ||
          currentPending.command_json !== pending.command_json ||
          currentPending.unsigned_json !== pending.unsigned_json ||
          currentPending.next_state_json !== pending.next_state_json ||
          currentPending.grant_json !== pending.grant_json ||
          currentPending.wake_subscription_json !==
            pending.wake_subscription_json ||
          currentPending.reduction_overlay !== pending.reduction_overlay ||
          !this.hasProjectionOutboxCapacity(
            reductionOverlay,
            nextState,
            utf8ByteLength(projectionJson),
          ) ||
          !this.hasManagementLedgerCapacity(
            reductionOverlay,
            nextState,
            commandResultBytes,
          ) ||
          !this.hasWakeSubscriptionOutboxCapacity(
            reductionOverlay,
            wakeSubscriptions,
          ) ||
          (grant?.enabled === true &&
            !this.hasWakeSubscriptionGrantLiability(
              grant.resource.conversationId,
            ))
        ) {
          return;
        }
        this.applyGrantMutation(command, nextState);
        const enabledGrantCount = this.ctx.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM grants WHERE enabled = 1",
          )
          .one().count;
        if (enabledGrantCount !== nextState.grantCount) {
          throw new Error("Normalized Bot grant count diverged from state");
        }
        const now = new Date().toISOString();
        this.ctx.storage.sql.exec(
          `INSERT INTO installation_state (singleton, state_json) VALUES (1, ?)
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
            (command_id, payload_hash, terminal_kind, object_key, archive_json,
             body_hash, attempts, next_attempt_at, created_at)
           VALUES (?, ?, 'committed', ?, ?, ?, 0, 0, ?)`,
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
        for (const wakeSubscription of wakeSubscriptions) {
          this.ctx.storage.sql.exec(
            `INSERT INTO wake_subscription_outbox
              (conversation_id, transition_json, attempts, next_attempt_at,
               created_at)
             VALUES (?, ?, 0, 0, ?)
             ON CONFLICT(conversation_id) DO UPDATE SET
               transition_json = excluded.transition_json,
               attempts = 0,
               next_attempt_at = 0,
               created_at = excluded.created_at
             WHERE CAST(json_extract(excluded.transition_json, '$.epoch') AS INTEGER)
               >= CAST(json_extract(wake_subscription_outbox.transition_json, '$.epoch') AS INTEGER)`,
            wakeSubscription.conversationId,
            canonicalJson(wakeSubscription),
            now,
          );
        }
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_command WHERE singleton = 1",
        );
        finalized = response;
      });
    } catch {
      await this.markPendingFailure(pending);
      return { ok: false, code: "internal" };
    }
    if (finalized === undefined) {
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    await this.flushWakeSubscriptionOutbox();
    this.ctx.waitUntil(this.flushOutbox());
    return { ok: true, value: finalized, replayed };
  }

  private async flushWakeSubscriptionOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<WakeSubscriptionOutboxRow>(
        `SELECT conversation_id, transition_json, attempts
         FROM wake_subscription_outbox
         WHERE next_attempt_at <= ?
         ORDER BY next_attempt_at, conversation_id LIMIT 20`,
        Date.now(),
      )
      .toArray();
    for (const row of rows) {
      const transition = parseWakeSubscriptionTransition(row.transition_json);
      let result: BotWakeSubscriptionMutationResult | null = null;
      if (transition !== null) {
        try {
          result = validateWakeSubscriptionMutationResult(
            await this.env.CONVERSATIONS.getByName(
              transition.conversationId,
            ).executeBotWakeSubscription(transition),
          );
        } catch {
          result = null;
        }
      }
      if (
        transition?.operation === "prepare" &&
        result?.ok === true &&
        (result.status === "prepared" || result.status === "active") &&
        result.epoch === transition.epoch
      ) {
        if (result.status === "active") {
          this.ctx.storage.sql.exec(
            `DELETE FROM wake_subscription_outbox
             WHERE conversation_id = ? AND transition_json = ? AND attempts = ?`,
            row.conversation_id,
            row.transition_json,
            row.attempts,
          );
        } else {
          const activation: BotWakeSubscriptionTransition = {
            ...transition,
            operation: "activate",
            highWaterCursor: result.highWaterCursor,
          };
          this.ctx.storage.sql.exec(
            `UPDATE wake_subscription_outbox
             SET transition_json = ?, attempts = 0, next_attempt_at = 0
             WHERE conversation_id = ? AND transition_json = ? AND attempts = ?`,
            canonicalJson(activation),
            row.conversation_id,
            row.transition_json,
            row.attempts,
          );
        }
        continue;
      }
      const expectedStatus =
        transition?.operation === "activate" ? "active" : "disabled";
      if (
        transition !== null &&
        result?.ok === true &&
        result.status === expectedStatus &&
        result.epoch === transition.epoch
      ) {
        this.ctx.storage.sql.exec(
          `DELETE FROM wake_subscription_outbox
           WHERE conversation_id = ? AND transition_json = ? AND attempts = ?`,
          row.conversation_id,
          row.transition_json,
          row.attempts,
        );
        continue;
      }
      const attempts = nextRetryAttempt(row.attempts);
      this.ctx.storage.sql.exec(
        `UPDATE wake_subscription_outbox
         SET attempts = ?, next_attempt_at = ?
         WHERE conversation_id = ? AND transition_json = ? AND attempts = ?`,
        attempts,
        Date.now() + Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
        row.conversation_id,
        row.transition_json,
        row.attempts,
      );
    }
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at
         FROM wake_subscription_outbox`,
      )
      .one().next_attempt_at;
    if (next !== null) {
      await this.ensureAlarmAt(Math.max(Date.now() + 1_000, next));
    }
  }

  private applyGrantMutation(
    command: BotInstallationManagementCommand,
    state: BotInstallation,
  ): void {
    const now = state.updatedAt;
    if (command.contract === "bot-installation.revoke@1") {
      this.ctx.storage.sql.exec("DELETE FROM grants");
      return;
    }
    const grant = grantMutation(command);
    if (grant === null) {
      return;
    }
    if (!grant.enabled) {
      this.ctx.storage.sql.exec(
        `DELETE FROM grants
         WHERE capability = ? AND resource_kind = ? AND resource_id = ?`,
        grant.capability,
        grant.resource.kind,
        grant.resource.conversationId,
      );
      return;
    }
    this.ctx.storage.sql.exec(
      `INSERT INTO grants
        (capability, resource_kind, resource_id, enabled, updated_cursor,
         enabled_at, tombstoned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(capability, resource_kind, resource_id) DO UPDATE SET
         enabled = excluded.enabled,
         updated_cursor = excluded.updated_cursor,
         enabled_at = CASE
           WHEN excluded.enabled = 1 THEN excluded.enabled_at
           ELSE grants.enabled_at
         END,
         tombstoned_at = excluded.tombstoned_at`,
      grant.capability,
      grant.resource.kind,
      grant.resource.conversationId,
      1,
      state.cursor,
      now,
      null,
    );
  }

  private async attest(
    event: UnsignedNostrEvent,
    purpose:
      | "bot-installation-journal"
      | "bot-installation-journal-segment" = "bot-installation-journal",
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
      signed.tags.length !== event.tags.length + 1 ||
      !event.tags.every(
        (tag, index) =>
          canonicalJson(tag) === canonicalJson(signed.tags[index]),
      ) ||
      canonicalJson(signed.tags.at(-1)) !==
        canonicalJson(["attestation", attestation.keyVersion]) ||
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

  private domainFailure(error: unknown): BotInstallationExecuteResult {
    if (error instanceof BotInstallationDomainError) {
      return {
        ok: false,
        code:
          error.code === "already_exists" ? "invalid_transition" : error.code,
      };
    }
    return { ok: false, code: "internal" };
  }

  private async rejectPendingCommand(
    pending: PendingRow,
    error: BotInstallationDomainError,
    authorityReduction = false,
  ): Promise<BotInstallationExecuteResult> {
    const code =
      error.code === "already_exists"
        ? "invalid_transition"
        : error.code === "not_found" ||
            error.code === "forbidden" ||
            error.code === "invalid_transition" ||
            error.code === "conflict"
          ? error.code
          : "conflict";
    const rejectedAt = new Date().toISOString();
    let commandReceipt: PreparedCommandReceiptArchive;
    try {
      commandReceipt = await prepareBotInstallationCommandReceipt({
        installationId: this.ctx.id.name ?? "",
        commandId: String(pending.command_id),
        payloadHash: String(pending.payload_hash),
        terminal: { kind: "rejected", code },
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
    } catch {
      await this.markPendingFailure(pending);
      return { ok: false, code: "internal" };
    }
    const rejectedBytes =
      utf8ByteLength(String(pending.command_id)) +
      utf8ByteLength(String(pending.payload_hash)) +
      utf8ByteLength(code) +
      utf8ByteLength(rejectedAt);
    if (
      !this.hasManagementLedgerCapacity(
        authorityReduction,
        this.committedState(),
        rejectedBytes,
      )
    ) {
      return { ok: false, code: "internal" };
    }
    let rejected = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.pending();
      if (
        current === undefined ||
        current.command_id !== pending.command_id ||
        current.payload_hash !== pending.payload_hash ||
        current.command_json !== pending.command_json ||
        current.unsigned_json !== pending.unsigned_json ||
        current.next_state_json !== pending.next_state_json ||
        current.grant_json !== pending.grant_json ||
        current.wake_subscription_json !== pending.wake_subscription_json ||
        current.reduction_overlay !== pending.reduction_overlay ||
        !this.hasManagementLedgerCapacity(
          authorityReduction,
          this.committedState(),
          rejectedBytes,
        )
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO rejected_commands
          (command_id, payload_hash, code, rejected_at)
         VALUES (?, ?, ?, ?)`,
        pending.command_id,
        pending.payload_hash,
        code,
        rejectedAt,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO command_receipt_archive_outbox
          (command_id, payload_hash, terminal_kind, object_key, archive_json,
           body_hash, attempts, next_attempt_at, created_at)
         VALUES (?, ?, 'rejected', ?, ?, ?, 0, 0, ?)`,
        pending.command_id,
        pending.payload_hash,
        commandReceipt.coordinate.key,
        commandReceipt.body,
        commandReceipt.metadata.bodyHash,
        rejectedAt,
      );
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_command WHERE singleton = 1",
      );
      rejected = true;
    });
    if (!rejected) {
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    return { ok: false, code };
  }

  private async markPendingFailure(pending: PendingRow): Promise<void> {
    const attempts = nextRetryAttempt(pending.attempts);
    let marked = false;
    this.ctx.storage.transactionSync(() => {
      if (!samePendingManagementCommand(this.pending(), pending)) {
        return;
      }
      this.ctx.storage.sql.exec(
        "UPDATE pending_command SET attempts = ? WHERE singleton = 1",
        attempts,
      );
      marked = true;
    });
    if (marked) {
      await this.replaceAlarmAt(
        Date.now() + Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
      );
    }
  }

  private async flushOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<OutboxRow>(
        `SELECT event_id, cursor, payload_json, attempts FROM outbox
         WHERE delivered_at IS NULL ORDER BY cursor LIMIT 20`,
      )
      .toArray();
    for (const row of rows) {
      try {
        await this.env.PROJECTION_QUEUE.send(
          JSON.parse(String(row.payload_json)),
        );
        this.ctx.storage.sql.exec(
          `DELETE FROM outbox
           WHERE event_id = ? AND cursor = ? AND payload_json = ?`,
          row.event_id,
          row.cursor,
          row.payload_json,
        );
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        this.ctx.storage.sql.exec(
          `UPDATE outbox SET attempts = ?
           WHERE event_id = ? AND cursor = ? AND payload_json = ? AND attempts = ?`,
          attempts,
          row.event_id,
          row.cursor,
          row.payload_json,
          row.attempts,
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

  private async ensureManagementLedgerCapacity(
    reduction: boolean,
    stateAfterWrite: BotInstallation | null,
    writeBytes: number,
  ): Promise<boolean> {
    if (
      this.hasManagementLedgerCapacity(reduction, stateAfterWrite, writeBytes)
    ) {
      return true;
    }
    await this.archiveCommandReceipts();
    return this.hasManagementLedgerCapacity(
      reduction,
      stateAfterWrite,
      writeBytes,
    );
  }

  private async archiveCommandReceipts(): Promise<void> {
    try {
      await this.migrateLegacyCommandTerminals();
      await this.flushCommandReceiptArchiveOutbox();
      await this.scheduleNextCommandReceiptArchive();
    } catch {
      this.scheduleAlarm(1_000);
    }
  }

  private async migrateLegacyCommandTerminals(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<LegacyCommandTerminalRow>(
        `SELECT command_id, payload_hash, terminal_kind, terminal_json,
                command_json, terminal_at
         FROM (
           SELECT result.command_id AS command_id,
                  result.payload_hash AS payload_hash,
                  'committed' AS terminal_kind,
                  result.response_json AS terminal_json,
                  result.command_json AS command_json,
                  result.committed_at AS terminal_at
           FROM command_results AS result
           LEFT JOIN command_receipt_archive_outbox AS receipt
             ON receipt.command_id = result.command_id
           WHERE receipt.command_id IS NULL
           UNION ALL
           SELECT rejected.command_id AS command_id,
                  rejected.payload_hash AS payload_hash,
                  'rejected' AS terminal_kind,
                  rejected.code AS terminal_json,
                  '{}' AS command_json,
                  rejected.rejected_at AS terminal_at
           FROM rejected_commands AS rejected
           LEFT JOIN command_receipt_archive_outbox AS receipt
             ON receipt.command_id = rejected.command_id
           WHERE receipt.command_id IS NULL
         )
         ORDER BY terminal_at, command_id
         LIMIT ?`,
        commandReceiptArchiveBatchSize,
      )
      .toArray();
    for (const row of rows) {
      if (row.command_json !== "{}") {
        const command = parseManagementCommand(parseJson(row.command_json));
        if (
          command === null ||
          (await sha256Hex(canonicalJson(command))) !== row.payload_hash
        ) {
          throw new CommandReceiptArchiveError(
            "corrupt",
            "Legacy Installation command payload hash is invalid",
          );
        }
      }
      let terminal: BotInstallationCommandTerminal;
      if (row.terminal_kind === "committed") {
        const response = parseCommittedInstallationCommand(row.terminal_json);
        if (response === null) {
          throw new CommandReceiptArchiveError(
            "corrupt",
            "Legacy Installation committed result is invalid",
          );
        }
        terminal = { kind: "committed", value: response };
      } else if (isTerminalRejectionCode(row.terminal_json)) {
        terminal = { kind: "rejected", code: row.terminal_json };
      } else {
        throw new CommandReceiptArchiveError(
          "corrupt",
          "Legacy Installation rejection is invalid",
        );
      }
      const prepared = await prepareBotInstallationCommandReceipt({
        installationId: this.ctx.id.name ?? "",
        commandId: row.command_id,
        payloadHash: row.payload_hash,
        terminal,
        verifyEvent: (event) => verifyAttestation(event, this.env),
      });
      this.ctx.storage.transactionSync(() => {
        const current =
          terminal.kind === "committed"
            ? this.result(row.command_id)
            : this.rejected(row.command_id);
        if (
          current?.payload_hash !== row.payload_hash ||
          (terminal.kind === "committed"
            ? !(
                "response_json" in current &&
                current.response_json === row.terminal_json
              )
            : !("code" in current && current.code === row.terminal_json))
        ) {
          return;
        }
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO command_receipt_archive_outbox
            (command_id, payload_hash, terminal_kind, object_key, archive_json,
             body_hash, attempts, next_attempt_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
          row.command_id,
          row.payload_hash,
          terminal.kind,
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

  private async scheduleNextCommandReceiptArchive(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        "SELECT MIN(next_attempt_at) AS next_attempt_at FROM command_receipt_archive_outbox",
      )
      .one().next_attempt_at;
    if (next !== null) {
      await this.ensureAlarmAt(Math.max(Date.now() + 1, next));
    }
  }

  private async flushCommandReceiptArchiveOutbox(): Promise<void> {
    const rows = this.ctx.storage.sql
      .exec<CommandReceiptArchiveOutboxRow>(
        `SELECT command_id, payload_hash, terminal_kind, object_key,
                archive_json, body_hash, attempts
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
            "Installation command receipt outbox JSON is invalid",
          );
        }
        const terminalKind = String(row.terminal_kind);
        if (terminalKind !== "committed" && terminalKind !== "rejected") {
          throw new CommandReceiptArchiveError(
            "corrupt",
            "Installation command receipt terminal kind is invalid",
          );
        }
        const archive = await parseBotInstallationCommandReceiptArchive({
          value,
          expectedInstallationId: this.ctx.id.name ?? "",
          expectedCommandId: String(row.command_id),
          metadataPayloadHash: String(row.payload_hash),
          metadataTerminal: terminalKind,
          verifyEvent: (event) => verifyAttestation(event, this.env),
        });
        const terminal = archive.terminal as BotInstallationCommandTerminal;
        const prepared = await prepareBotInstallationCommandReceipt({
          installationId: archive.installationId,
          commandId: archive.commandId,
          payloadHash: archive.payloadHash,
          terminal,
          verifyEvent: (event) => verifyAttestation(event, this.env),
        });
        if (
          prepared.coordinate.key !== row.object_key ||
          prepared.body !== row.archive_json ||
          prepared.metadata.bodyHash !== row.body_hash
        ) {
          throw new CommandReceiptArchiveError(
            "corrupt",
            "Installation command receipt outbox is not canonical",
          );
        }
        await writeCommandReceiptArchive(
          this.env.JOURNAL_ARCHIVE_BUCKET,
          prepared,
        );
        this.ctx.storage.transactionSync(() => {
          const currentOutbox = this.commandReceiptArchiveOutbox(
            String(row.command_id),
          );
          if (!sameCommandReceiptArchiveOutbox(currentOutbox, row)) {
            return;
          }
          const committed = this.result(String(row.command_id));
          const rejected = this.rejected(String(row.command_id));
          if (
            (terminal.kind === "committed" &&
              (rejected !== undefined ||
                (committed !== undefined &&
                  (committed.payload_hash !== row.payload_hash ||
                    canonicalJson(parseJson(committed.response_json)) !==
                      canonicalJson(terminal.value))))) ||
            (terminal.kind === "rejected" &&
              (committed !== undefined ||
                (rejected !== undefined &&
                  (rejected.payload_hash !== row.payload_hash ||
                    rejected.code !== terminal.code))))
          ) {
            throw new Error(
              "Installation command terminal changed before archive commit",
            );
          }
          this.ctx.storage.sql.exec(
            "DELETE FROM command_results WHERE command_id = ?",
            row.command_id,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM rejected_commands WHERE command_id = ?",
            row.command_id,
          );
          this.ctx.storage.sql.exec(
            "DELETE FROM command_receipt_archive_outbox WHERE command_id = ?",
            row.command_id,
          );
        });
      } catch {
        const attempts = nextRetryAttempt(row.attempts);
        const delay = Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000);
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
      throw new Error(
        "Cannot archive a journal without Bot Installation state",
      );
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
      throw new Error(
        "Bot Installation journal archive cursor is not contiguous",
      );
    }
    const draft = await prepareBotInstallationJournalSegment(
      state.workspaceId,
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
      canonicalJson({
        schemaVersion: 1,
        aggregate: "bot-installation",
        workspaceId: state.workspaceId,
        installationId: state.id,
      }),
    );
    const objectKey = `journal/v1/bot-installation/${coordinateHash}/${draft.startCursor}-${draft.endCursor}-${draft.segmentHash}.json`;
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
      throw new Error(
        "Cannot archive a journal without Bot Installation state",
      );
    }
    const unsignedSeal = JSON.parse(
      String(pending.unsigned_seal_json),
    ) as UnsignedNostrEvent;
    const seal = await this.persistedArchiveSeal(
      String(pending.segment_hash),
      unsignedSeal,
    );
    if (seal.kind !== 50313) {
      throw new Error(
        "Bot Installation journal archive seal used an unexpected event kind",
      );
    }
    const expectedArchive: BotInstallationJournalSegmentArchive = {
      schemaVersion: 1,
      workspaceId: state.workspaceId,
      installationId: state.id,
      startCursor: Number(pending.start_cursor),
      endCursor: Number(pending.end_cursor),
      previousSegmentHash:
        pending.previous_segment_hash === null
          ? null
          : String(pending.previous_segment_hash),
      segmentHash: String(pending.segment_hash),
      events: JSON.parse(
        String(pending.events_json),
      ) as BotInstallationJournalSegmentArchive["events"],
      seal: {
        ...seal,
        kind: 50313,
      } as BotInstallationJournalSegmentArchive["seal"],
    };
    if (
      !(await validBotInstallationArchive(
        expectedArchive,
        pending,
        unsignedSeal,
        this.env,
      ))
    ) {
      throw new Error(
        "Bot Installation journal archive violated its canonical contract",
      );
    }
    const body = canonicalJson(expectedArchive);
    if (new TextEncoder().encode(body).byteLength > maximumArchiveBodyBytes) {
      throw new Error(
        "Bot Installation journal archive exceeds its bounded body size",
      );
    }

    const coordinateHash = await sha256Hex(
      canonicalJson({
        schemaVersion: 1,
        aggregate: "bot-installation",
        workspaceId: state.workspaceId,
        installationId: state.id,
      }),
    );
    const objectKey = `journal/v1/bot-installation/${coordinateHash}/${expectedArchive.startCursor}-${expectedArchive.endCursor}-${expectedArchive.segmentHash}.json`;
    if (objectKey !== pending.object_key) {
      throw new Error(
        "Bot Installation journal archive object key is not canonical",
      );
    }
    const metadata = archiveMetadata(
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
        throw new Error(
          "Bot Installation journal archive existing object is unavailable",
        );
      }
      const existingText = await existing.text();
      const existingArchive = parseJson(
        existingText,
      ) as BotInstallationJournalSegmentArchive | null;
      if (
        existingArchive === null ||
        existingText !== canonicalJson(existingArchive) ||
        existing.httpMetadata?.contentType !== "application/json" ||
        canonicalJson(existing.customMetadata) !== canonicalJson(metadata) ||
        !(await validBotInstallationArchive(
          existingArchive,
          pending,
          unsignedSeal,
          this.env,
        ))
      ) {
        throw new Error(
          "Existing Bot Installation journal archive failed exact validation",
        );
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
        archive.workspaceId !== state.workspaceId ||
        archive.installationId !== state.id ||
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
        throw new Error(
          "Bot Installation journal changed before archive commit",
        );
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
      const signed = await this.attest(
        unsigned,
        "bot-installation-journal-segment",
      );
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
      throw new Error("Persisted Installation journal archive seal is invalid");
    }
    return seal as SignedNostrEvent;
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

  private scheduleAlarm(delayMs: number): void {
    void this.ensureAlarmAt(Date.now() + delayMs);
  }

  private gcExpiredJtis(): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM used_jti
       WHERE expires_at <= ?
         AND jti NOT IN (
           SELECT jti FROM pending_action_command
           WHERE operation = 'admit' AND jti IS NOT NULL
         )`,
      Math.floor(Date.now() / 1_000),
    );
  }

  private async scheduleNextJtiGc(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ expires_at: number | null }>(
        `SELECT MIN(expires_at) AS expires_at FROM used_jti
         WHERE jti NOT IN (
           SELECT jti FROM pending_action_command
           WHERE operation = 'admit' AND jti IS NOT NULL
         )`,
      )
      .one().expires_at;
    if (next !== null) {
      await this.ensureAlarmAt(Math.max(Date.now() + 1, next * 1_000));
    }
  }

  private async scheduleNextBotWakeWork(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ next_attempt_at: number | null }>(
        `SELECT MIN(next_attempt_at) AS next_attempt_at
         FROM (
           SELECT next_attempt_at FROM wake_queue_outbox
           UNION ALL
           SELECT next_attempt_at FROM wake_receipt_archive_outbox
         )`,
      )
      .one().next_attempt_at;
    if (next !== null) {
      await this.ensureAlarmAt(Math.max(Date.now() + 1, next));
    }
  }

  private async repairDurableAlarm(): Promise<void> {
    this.gcExpiredJtis();
    await this.scheduleNextJtiGc();
    await this.scheduleNextBotWakeWork();
    const hasWork = this.ctx.storage.sql
      .exec<{ has_work: number }>(
        `SELECT (
          EXISTS(SELECT 1 FROM pending_command) OR
          EXISTS(SELECT 1 FROM pending_action_command) OR
          EXISTS(SELECT 1 FROM action_deliveries) OR
          EXISTS(SELECT 1 FROM wake_subscription_outbox) OR
          EXISTS(SELECT 1 FROM wake_queue_outbox) OR
          EXISTS(SELECT 1 FROM wake_receipt_archive_outbox) OR
          EXISTS(SELECT 1 FROM receipt_archive_outbox) OR
          EXISTS(SELECT 1 FROM command_receipt_archive_outbox) OR
          EXISTS(
            SELECT 1 FROM command_results AS result
            LEFT JOIN command_receipt_archive_outbox AS receipt
              ON receipt.command_id = result.command_id
            WHERE receipt.command_id IS NULL
          ) OR
          EXISTS(
            SELECT 1 FROM rejected_commands AS rejected
            LEFT JOIN command_receipt_archive_outbox AS receipt
              ON receipt.command_id = rejected.command_id
            WHERE receipt.command_id IS NULL
          ) OR
          EXISTS(SELECT 1 FROM outbox WHERE delivered_at IS NULL) OR
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
    await this.scheduleNextActionDelivery();
    await this.scheduleNextReceiptArchive();
    await this.scheduleNextCommandReceiptArchive();
  }
}

type ReceiptArchiveCoordinate = {
  installationHash: string;
  actionHash: string;
  objectKey: string;
};

async function receiptArchiveCoordinate(
  installationId: string,
  actionId: string,
): Promise<ReceiptArchiveCoordinate> {
  const installationHash = await sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      domain: "punks.bot-action-receipt-installation.v1",
      installationId,
    }),
  );
  const actionHash = await sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      domain: "punks.bot-action-receipt-action.v1",
      installationId,
      actionId,
    }),
  );
  return {
    installationHash,
    actionHash,
    objectKey: `bot-action-receipts/v1/${installationHash}/${actionHash}.json`,
  };
}

function receiptArchiveMetadata(
  coordinate: ReceiptArchiveCoordinate,
  admission: BotActionAdmission,
): Record<string, string> {
  return {
    aggregate: "bot-action-receipt",
    schemaVersion: "1",
    installationHash: coordinate.installationHash,
    actionHash: coordinate.actionHash,
    admissionId: admission.id,
    actionDigest: admission.actionDigest,
    outcome: admission.outcome ?? "",
  };
}

function parseReceiptArchive(value: string): CanonicalReceiptArchive | null {
  const parsed = parseJson(value);
  if (
    !validateContract("punks://contracts/bot-action.receipt-archive@1", parsed)
      .valid ||
    !isRecord(parsed)
  ) {
    return null;
  }
  const terminalAdmission = parseAdmission(
    canonicalJson(parsed.terminalAdmission),
  );
  const admissionProof50320 = parseSignedEvent(
    canonicalJson(parsed.admissionProof50320),
  );
  const completionProof50321 = parseSignedEvent(
    canonicalJson(parsed.completionProof50321),
  );
  return terminalAdmission !== null &&
    terminalAdmission.status === "completed" &&
    admissionProof50320 !== null &&
    completionProof50321 !== null
    ? {
        schemaVersion: 1,
        terminalAdmission,
        admissionProof50320,
        completionProof50321,
      }
    : null;
}

function admittedVersion(admission: BotActionAdmission): BotActionAdmission {
  return admission.status === "admitted"
    ? admission
    : {
        ...admission,
        status: "admitted",
        outcome: null,
        completedCursor: null,
        completedAt: null,
      };
}

async function validAdmissionProof(
  admission: BotActionAdmission,
  proof: SignedNostrEvent,
  env: ApiEnv,
): Promise<boolean> {
  const admitted = admittedVersion(admission);
  if (
    admitted.installationCursor !== admitted.admittedCursor ||
    proof.kind !== 50320 ||
    proof.created_at !== Math.floor(Date.parse(admitted.admittedAt) / 1_000) ||
    proof.content !== canonicalJson({ schemaVersion: 1, admission: admitted })
  ) {
    return false;
  }
  const commandId = proof.tags[4]?.[1];
  const attestation = proof.tags[13];
  if (
    commandId === undefined ||
    !isOpaqueUuid(commandId) ||
    attestation === undefined ||
    attestation.length !== 2 ||
    attestation[0] !== "attestation" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(attestation[1] ?? "")
  ) {
    return false;
  }
  const expectedTags: SignedNostrEvent["tags"] = [
    ["workspace", admitted.workspaceId],
    ["installation", admitted.installationId],
    ["bot", admitted.botId],
    ["cursor", String(admitted.admittedCursor)],
    ["command", commandId ?? ""],
    ["contract", "bot-action.admit@1"],
    ["actor", "bot", admitted.installationId],
    ["admission", admitted.id],
    ["action", admitted.actionId, admitted.actionDigest],
    ["action_contract", admitted.actionContract],
    ["capability", admitted.capability],
    ["conversation", admitted.resource.conversationId],
    ["message", admitted.resource.messageId],
    attestation,
  ];
  return (
    canonicalJson(proof.tags) === canonicalJson(expectedTags) &&
    proof.id ===
      (await sha256Hex(
        JSON.stringify([
          0,
          proof.pubkey,
          proof.created_at,
          proof.kind,
          proof.tags,
          proof.content,
        ]),
      )) &&
    (await verifyAttestation(proof, env))
  );
}

async function validCompletionProof(
  admission: BotActionAdmission,
  proof: SignedNostrEvent,
  env: ApiEnv,
): Promise<boolean> {
  if (
    admission.status !== "completed" ||
    admission.outcome === null ||
    admission.completedCursor === null ||
    admission.completedAt === null ||
    proof.kind !== 50321 ||
    proof.created_at !==
      Math.floor(Date.parse(admission.completedAt) / 1_000) ||
    proof.content !== canonicalJson({ schemaVersion: 1, admission })
  ) {
    return false;
  }
  const commandId = proof.tags[4]?.[1];
  const attestation = proof.tags[10];
  if (
    commandId === undefined ||
    !isOpaqueUuid(commandId) ||
    attestation === undefined ||
    attestation.length !== 2 ||
    attestation[0] !== "attestation" ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(attestation[1] ?? "")
  ) {
    return false;
  }
  const expectedTags: SignedNostrEvent["tags"] = [
    ["workspace", admission.workspaceId],
    ["installation", admission.installationId],
    ["bot", admission.botId],
    ["cursor", String(admission.completedCursor)],
    ["command", commandId ?? ""],
    ["contract", "bot-action.complete@1"],
    ["actor", "bot", admission.installationId],
    ["admission", admission.id],
    ["action", admission.actionId, admission.actionDigest],
    ["outcome", admission.outcome],
    attestation,
  ];
  return (
    canonicalJson(proof.tags) === canonicalJson(expectedTags) &&
    proof.id ===
      (await sha256Hex(
        JSON.stringify([
          0,
          proof.pubkey,
          proof.created_at,
          proof.kind,
          proof.tags,
          proof.content,
        ]),
      )) &&
    (await verifyAttestation(proof, env))
  );
}

async function validReceiptArchive(
  archive: CanonicalReceiptArchive,
  installationId: string,
  actionId: string,
  env: ApiEnv,
): Promise<boolean> {
  const terminal = archive.terminalAdmission;
  return (
    validateContract("punks://contracts/bot-action.receipt-archive@1", archive)
      .valid &&
    terminal.status === "completed" &&
    terminal.installationId === installationId &&
    terminal.actionId === actionId &&
    terminal.completedCursor !== null &&
    terminal.completedAt !== null &&
    terminal.completedCursor > terminal.admittedCursor &&
    (await validAdmissionProof(terminal, archive.admissionProof50320, env)) &&
    (await validCompletionProof(terminal, archive.completionProof50321, env))
  );
}

async function validBotInstallationArchive(
  archive: BotInstallationJournalSegmentArchive,
  pending: PendingArchiveRow,
  unsignedSeal: UnsignedNostrEvent,
  env: ApiEnv,
): Promise<boolean> {
  return (
    validateContract(
      "punks://contracts/bot-installation.journal-segment@1",
      archive,
    ).valid &&
    archive.startCursor === Number(pending.start_cursor) &&
    archive.endCursor === Number(pending.end_cursor) &&
    archive.previousSegmentHash === pending.previous_segment_hash &&
    archive.segmentHash === String(pending.segment_hash) &&
    canonicalJson(archive.events) ===
      canonicalJson(parseJson(String(pending.events_json))) &&
    signedEventPreservesUnsigned(unsignedSeal, archive.seal) &&
    (await verifyAttestation(archive.seal, env)) &&
    (await verifyBotInstallationJournalSegmentHash(archive))
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
  objectKey: string,
  startCursor: number,
  endCursor: number,
  segmentHash: string,
): Record<string, string> {
  const coordinateHash = objectKey.split("/")[3] ?? "";
  return {
    aggregate: "bot-installation",
    coordinateHash,
    segmentHash,
    startCursor: String(startCursor),
    endCursor: String(endCursor),
  };
}

async function botWakeReceiptObjectKey(
  installationId: string,
  wakeId: string,
): Promise<string> {
  const coordinateHash = await sha256Hex(
    `punks.bot-wake.receipt-coordinate.v1\u0000${installationId}\u0000${wakeId}`,
  );
  return `bot-wake-receipts/v1/${coordinateHash.slice(0, 2)}/${coordinateHash}.json`;
}

function botWakeReceiptMetadata(
  objectKey: string,
  bodyHash: string,
): Record<string, string> {
  return {
    aggregate: "bot-wake-receipt",
    coordinateHash: objectKey.split("/")[3]?.replace(/\.json$/, "") ?? "",
    bodyHash,
  };
}

function sameWakeReceiptArchiveOutbox(
  current: WakeReceiptArchiveOutboxRow,
  expected: WakeReceiptArchiveOutboxRow,
): boolean {
  return (
    current.wake_id === expected.wake_id &&
    current.object_key === expected.object_key &&
    current.archive_json === expected.archive_json &&
    current.body_hash === expected.body_hash &&
    current.attempts === expected.attempts &&
    current.next_attempt_at === expected.next_attempt_at
  );
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
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

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function parseBotWakeCandidate(value: unknown): BotWakeCandidate | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "wakeId",
      "workspaceId",
      "installationId",
      "botId",
      "conversationId",
      "messageId",
      "messageCursor",
      "subscriptionEpoch",
      "sourceEventId",
      "sourceEventDigest",
      "createdAt",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.wakeId !== "string" ||
    !opaqueUuidPattern.test(value.wakeId) ||
    typeof value.workspaceId !== "string" ||
    !opaqueUuidPattern.test(value.workspaceId) ||
    typeof value.installationId !== "string" ||
    !opaqueUuidPattern.test(value.installationId) ||
    typeof value.botId !== "string" ||
    !opaqueUuidPattern.test(value.botId) ||
    typeof value.conversationId !== "string" ||
    !opaqueUuidPattern.test(value.conversationId) ||
    typeof value.messageId !== "string" ||
    !opaqueUuidPattern.test(value.messageId) ||
    !Number.isSafeInteger(value.messageCursor) ||
    Number(value.messageCursor) < 1 ||
    !Number.isSafeInteger(value.subscriptionEpoch) ||
    Number(value.subscriptionEpoch) < 1 ||
    typeof value.sourceEventId !== "string" ||
    !lowercaseHexDigestPattern.test(value.sourceEventId) ||
    typeof value.sourceEventDigest !== "string" ||
    !lowercaseHexDigestPattern.test(value.sourceEventDigest) ||
    !isCanonicalBotWakeTimestamp(value.createdAt) ||
    utf8ByteLength(canonicalJson(value)) > maximumBotWakeOfferBytes
  ) {
    return null;
  }
  return value as unknown as BotWakeCandidate;
}

function isCanonicalBotWakeTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

async function parseBotWakeOffer(value: string): Promise<BotWakeOffer | null> {
  const parsed = parseJson(value);
  return (await validateBotWakeOffer(parsed)) ? (parsed as BotWakeOffer) : null;
}

async function parseBotWakeTerminalReceipt(
  value: string | null,
): Promise<BotWakeTerminalReceiptArchive | null> {
  if (value === null) {
    return null;
  }
  const parsed = parseJson(value);
  return (await validateBotWakeTerminalReceipt(parsed))
    ? (parsed as BotWakeTerminalReceiptArchive)
    : null;
}

function botWakeCandidateMatchesOffer(
  candidate: BotWakeCandidate,
  offer: BotWakeOffer,
): boolean {
  return (
    candidate.wakeId === offer.wakeId &&
    candidate.workspaceId === offer.workspaceId &&
    candidate.installationId === offer.installationId &&
    candidate.botId === offer.botId &&
    candidate.conversationId === offer.conversationId &&
    candidate.messageId === offer.messageId &&
    candidate.messageCursor === offer.messageCursor &&
    candidate.subscriptionEpoch === offer.subscriptionEpoch &&
    candidate.sourceEventId === offer.sourceEventId &&
    candidate.sourceEventDigest === offer.sourceEventDigest &&
    candidate.createdAt === offer.createdAt
  );
}

function botWakeClaimFailure(
  code: Extract<ClaimBotWakeResult, { ok: false }>["code"],
): Extract<ClaimBotWakeResult, { ok: false }> {
  return {
    contract: "bot-wake.claim-result@1",
    ok: false,
    code,
  };
}

function nextRetryAttempt(value: string | number | null | undefined): number {
  const attempts = Number(value ?? 0);
  return Number.isSafeInteger(attempts) && attempts >= 0
    ? Math.min(maximumRetryAttempts, attempts + 1)
    : maximumRetryAttempts;
}

function validateWakeSubscriptionMutationResult(
  value: unknown,
): BotWakeSubscriptionMutationResult | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value.ok === false) {
    return hasExactKeys(value, ["ok", "code"]) &&
      (value.code === "invalid_request" ||
        value.code === "not_found" ||
        value.code === "forbidden" ||
        value.code === "conflict" ||
        value.code === "temporarily_unavailable")
      ? (value as Extract<BotWakeSubscriptionMutationResult, { ok: false }>)
      : null;
  }
  return value.ok === true &&
    hasExactKeys(value, [
      "ok",
      "status",
      "epoch",
      "highWaterCursor",
      "replayed",
    ]) &&
    (value.status === "prepared" ||
      value.status === "active" ||
      value.status === "disabled") &&
    Number.isSafeInteger(value.epoch) &&
    Number(value.epoch) >= 1 &&
    Number.isSafeInteger(value.highWaterCursor) &&
    Number(value.highWaterCursor) >= 1 &&
    typeof value.replayed === "boolean"
    ? (value as Extract<BotWakeSubscriptionMutationResult, { ok: true }>)
    : null;
}

function parseWakeSubscriptionTransition(
  value: string,
): BotWakeSubscriptionTransition | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) {
    return null;
  }
  const sharedKeys = [
    "operation",
    "workspaceId",
    "conversationId",
    "botId",
    "installationId",
    "epoch",
  ];
  if (
    !isUuid(parsed.workspaceId) ||
    !isUuid(parsed.conversationId) ||
    !isUuid(parsed.botId) ||
    !isUuid(parsed.installationId) ||
    !Number.isSafeInteger(parsed.epoch) ||
    Number(parsed.epoch) < 1
  ) {
    return null;
  }
  if (parsed.operation === "deactivate" && hasExactKeys(parsed, sharedKeys)) {
    return parsed as BotWakeSubscriptionTransition;
  }
  if (
    parsed.operation === "prepare" &&
    hasExactKeys(parsed, [...sharedKeys, "preparationId"]) &&
    isUuid(parsed.preparationId)
  ) {
    return parsed as BotWakeSubscriptionTransition;
  }
  if (
    parsed.operation === "activate" &&
    hasExactKeys(parsed, [...sharedKeys, "preparationId", "highWaterCursor"]) &&
    isUuid(parsed.preparationId) &&
    Number.isSafeInteger(parsed.highWaterCursor) &&
    Number(parsed.highWaterCursor) >= 1
  ) {
    return parsed as BotWakeSubscriptionTransition;
  }
  return null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(
      value,
    )
  );
}

function parseWakeSubscriptionTransitions(
  value: string,
): BotWakeSubscriptionTransition[] | null {
  const parsed = parseJson(value);
  if (
    !Array.isArray(parsed) ||
    parsed.length < 1 ||
    parsed.length > maximumActiveGrantsPerInstallation
  ) {
    return null;
  }
  const transitions: BotWakeSubscriptionTransition[] = [];
  const conversations = new Set<string>();
  for (const candidate of parsed) {
    const transition = parseWakeSubscriptionTransition(
      canonicalJson(candidate),
    );
    if (transition === null || conversations.has(transition.conversationId)) {
      return null;
    }
    conversations.add(transition.conversationId);
    transitions.push(transition);
  }
  return transitions;
}

function parseManagementCommand(
  input: unknown,
): BotInstallationManagementCommand | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return null;
  }
  const contract = Reflect.get(input, "contract") as
    | keyof typeof managementContracts
    | undefined;
  const contractId =
    contract === undefined ? undefined : managementContracts[contract];
  if (contractId === undefined || !validateContract(contractId, input).valid) {
    return null;
  }
  return input as BotInstallationManagementCommand;
}

function grantMutation(
  command: BotInstallationManagementCommand,
): BotInstallationGrant | null {
  return command.contract === "bot-installation.configure@1" &&
    command.payload.operation === "set-grant"
    ? command.payload.grant
    : null;
}

function isAuthorityReduction(
  command: BotInstallationManagementCommand,
): boolean {
  return (
    command.contract === "bot-installation.revoke@1" ||
    (command.contract === "bot-installation.configure@1" &&
      command.payload.operation === "set-grant" &&
      command.payload.grant.enabled === false)
  );
}

function validateWorkspaceAuthorizationResult(
  result: unknown,
  workspaceId: string,
): WorkspaceAuthorizationResult | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (record.ok === true) {
    return Object.keys(record).sort().join(",") ===
      "ok,role,visibility,workspaceCursor" &&
      Number.isSafeInteger(record.workspaceCursor) &&
      Number(record.workspaceCursor) > 0 &&
      (record.role === "owner" ||
        record.role === "moderator" ||
        record.role === "member" ||
        record.role === "guest") &&
      (record.visibility === "private" ||
        record.visibility === "punks" ||
        record.visibility === "public") &&
      workspaceId.length > 0
      ? (record as Extract<WorkspaceAuthorizationResult, { ok: true }>)
      : null;
  }
  return record.ok === false &&
    Object.keys(record).sort().join(",") === "code,ok" &&
    (record.code === "invalid_request" ||
      record.code === "not_found" ||
      record.code === "forbidden")
    ? (record as Extract<WorkspaceAuthorizationResult, { ok: false }>)
    : null;
}

function validateBotQueryResult(
  result: unknown,
  botId: string,
): BotQueryResult | null {
  if (typeof result !== "object" || result === null || Array.isArray(result)) {
    return null;
  }
  const record = result as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "not_found" ||
        record.code === "internal")
      ? (record as Extract<BotQueryResult, { ok: false }>)
      : null;
  }
  return record.ok === true &&
    Object.keys(record).sort().join(",") === "ok,state" &&
    validateContract("punks://contracts/bot@1", record.state).valid &&
    (record.state as Bot).id === botId
    ? (record as Extract<BotQueryResult, { ok: true }>)
    : null;
}

function validateBotGrantAuthority(
  input: unknown,
): AuthorizeBotGrantResult | null {
  if (!isRecord(input)) {
    return null;
  }
  if (
    input.ok === true &&
    hasExactKeys(input, ["ok", "conversationCursor"]) &&
    Number.isSafeInteger(input.conversationCursor) &&
    Number(input.conversationCursor) > 0
  ) {
    return input as unknown as Extract<AuthorizeBotGrantResult, { ok: true }>;
  }
  if (
    input.ok === false &&
    hasExactKeys(input, ["ok", "code"]) &&
    (input.code === "invalid_request" ||
      input.code === "not_found" ||
      input.code === "forbidden")
  ) {
    return input as unknown as Extract<AuthorizeBotGrantResult, { ok: false }>;
  }
  return null;
}

function installationProjection(
  command: BotInstallationManagementCommand,
  state: BotInstallation,
  event: SignedNostrEvent,
  configDigest: string,
): BotInstallationProjectionEnvelope {
  const { config: _config, ...bounded } = state;
  const summary = {
    ...bounded,
    configContractId: state.config.contractId,
    configDigest,
  };
  const delta: BotInstallationProjectionEnvelope["delta"] = (() => {
    if (command.contract === "bot-installation.install@1") {
      return {
        operation: state.revision === 1 ? "installed" : "reinstalled",
        installation: summary,
      };
    }
    if (command.contract === "bot-installation.revoke@1") {
      return { operation: "revoked", installation: summary };
    }
    if (command.payload.operation === "set-grant") {
      return {
        operation: "set-grant",
        capability: command.payload.grant.capability,
        resource: command.payload.grant.resource,
        enabled: command.payload.grant.enabled,
        authorityGeneration: state.authorityGeneration,
        revision: state.revision,
        cursor: state.cursor,
      };
    }
    return { operation: "configured", installation: summary };
  })();
  return {
    contract: "bot-installation.projection@1",
    workspaceId: state.workspaceId,
    installationId: state.id,
    cursor: state.cursor,
    event,
    delta,
  };
}

function actionProjection(
  state: BotInstallation,
  event: SignedNostrEvent,
  admission: BotActionAdmission,
  completed: boolean,
): BotInstallationProjectionEnvelope {
  return {
    contract: "bot-installation.projection@1",
    workspaceId: state.workspaceId,
    installationId: state.id,
    cursor: state.cursor,
    event,
    delta: {
      operation: completed ? "action-completed" : "action-admitted",
      admission,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function isOpaqueUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function isActionDeliveryRequest(
  value: unknown,
): value is ExecuteAdmittedBotReactionRequest {
  return validateContract("punks://contracts/bot-action.delivery@1", value)
    .valid;
}

function parseActionDeliveryRequest(
  value: string,
): ExecuteAdmittedBotReactionRequest | null {
  const parsed = parseJson(value);
  return isActionDeliveryRequest(parsed) ? parsed : null;
}

async function validActionDeliveryIds(
  request: ExecuteAdmittedBotReactionRequest,
): Promise<boolean> {
  return (
    request.reactionCommandId ===
      (await deriveOpaqueUuid(
        "punks.bot-reaction-command.v1",
        `${request.admissionId}\u0000${request.actionId}`,
      )) &&
    request.completionCommandId ===
      (await deriveOpaqueUuid(
        "punks.bot-action-completion-command.v1",
        `${request.admissionId}\u0000succeeded`,
      )) &&
    request.failureCompletionCommandId ===
      (await deriveOpaqueUuid(
        "punks.bot-action-completion-command.v1",
        `${request.admissionId}\u0000failed`,
      ))
  );
}

function validateActionDeliveryResult(
  value: unknown,
): ExecuteAdmittedBotReactionResult | null {
  return validateContract(
    "punks://contracts/bot-action.delivery-result@1",
    value,
  ).valid
    ? (value as ExecuteAdmittedBotReactionResult)
    : null;
}

function isAdmitBotActionRequest(
  input: unknown,
): input is AdmitBotActionRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["command", "credential", "admissionCommandId"])
  ) {
    return false;
  }
  if (
    !validateContract("punks://contracts/bot-action.execute@1", input.command)
      .valid ||
    !isOpaqueUuid(input.admissionCommandId) ||
    !isRecord(input.credential) ||
    !hasExactKeys(input.credential, [
      "jti",
      "issuedAt",
      "notBefore",
      "expiresAt",
    ])
  ) {
    return false;
  }
  return (
    isOpaqueUuid(input.credential.jti) &&
    Number.isSafeInteger(input.credential.issuedAt) &&
    Number.isSafeInteger(input.credential.notBefore) &&
    Number.isSafeInteger(input.credential.expiresAt)
  );
}

function isValidateAdmissionRequest(
  input: unknown,
): input is ValidateBotActionAdmissionRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      "workspaceId",
      "installationId",
      "botId",
      "actionId",
      "admissionId",
      "actionDigest",
      "authorityGeneration",
      "proof",
    ])
  ) {
    return false;
  }
  return (
    isOpaqueUuid(input.workspaceId) &&
    isOpaqueUuid(input.installationId) &&
    isOpaqueUuid(input.botId) &&
    isOpaqueUuid(input.actionId) &&
    isOpaqueUuid(input.admissionId) &&
    typeof input.actionDigest === "string" &&
    /^[0-9a-f]{64}$/.test(input.actionDigest) &&
    Number.isSafeInteger(input.authorityGeneration) &&
    Number(input.authorityGeneration) > 0 &&
    validateContract("punks://contracts/nostr.signed-event@1", input.proof)
      .valid
  );
}

function isCompleteBotActionRequest(
  input: unknown,
): input is CompleteBotActionRequest {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      "workspaceId",
      "installationId",
      "admissionId",
      "actionId",
      "actionDigest",
      "outcome",
      "completionCommandId",
    ])
  ) {
    return false;
  }
  return (
    isOpaqueUuid(input.workspaceId) &&
    isOpaqueUuid(input.installationId) &&
    isOpaqueUuid(input.admissionId) &&
    isOpaqueUuid(input.actionId) &&
    isOpaqueUuid(input.completionCommandId) &&
    typeof input.actionDigest === "string" &&
    /^[0-9a-f]{64}$/.test(input.actionDigest) &&
    (input.outcome === "succeeded" || input.outcome === "failed")
  );
}

function parseAdmission(value: string): BotActionAdmission | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/bot-action.admission@1", parsed)
    .valid
    ? (parsed as BotActionAdmission)
    : null;
}

function parseSignedEvent(value: string): SignedNostrEvent | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/nostr.signed-event@1", parsed)
    .valid
    ? (parsed as SignedNostrEvent)
    : null;
}

function parseUnsignedEvent(value: string): UnsignedNostrEvent | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/nostr.unsigned-event@1", parsed)
    .valid
    ? (parsed as UnsignedNostrEvent)
    : null;
}

function parseInstallation(value: string): BotInstallation | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/bot-installation@1", parsed).valid
    ? (parsed as BotInstallation)
    : null;
}

function parseGrant(value: string): BotInstallationGrant | null {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const grant = parsed as BotInstallationGrant;
  return Object.keys(parsed).sort().join(",") ===
    "capability,enabled,resource" &&
    (grant.capability === "messages.react" ||
      grant.capability === "messages.read-context") &&
    typeof grant.enabled === "boolean" &&
    grant.resource?.kind === "conversation" &&
    typeof grant.resource.conversationId === "string"
    ? grant
    : null;
}

function validInstallationReductionOverlay(
  committed: BotInstallation,
  command: BotInstallationManagementCommand,
  nextState: BotInstallation,
  event: UnsignedNostrEvent,
  grant: BotInstallationGrant | null,
): boolean {
  let expectedState: BotInstallation;
  let expectedKind: 50311 | 50312;
  let expectedDelta: object;
  if (command.contract === "bot-installation.revoke@1") {
    if (grant !== null || committed.status !== "active") {
      return false;
    }
    expectedState = {
      ...committed,
      status: "revoked",
      grantCount: 0,
      authorityGeneration: committed.authorityGeneration + 1,
      revision: committed.revision + 1,
      cursor: committed.cursor + 1,
      updatedAt: nextState.updatedAt,
      revokedAt: nextState.updatedAt,
    };
    expectedKind = 50312;
    expectedDelta = { operation: "revoked", cause: command.payload.cause };
  } else if (
    command.contract === "bot-installation.configure@1" &&
    command.payload.operation === "set-grant" &&
    command.payload.grant.enabled === false &&
    grant !== null &&
    canonicalJson(grant) === canonicalJson(command.payload.grant) &&
    committed.status === "active" &&
    committed.grantCount > 0
  ) {
    expectedState = {
      ...committed,
      grantCount: committed.grantCount - 1,
      authorityGeneration: committed.authorityGeneration + 1,
      revision: committed.revision + 1,
      cursor: committed.cursor + 1,
      updatedAt: nextState.updatedAt,
    };
    expectedKind = 50311;
    expectedDelta = command.payload;
  } else {
    return false;
  }
  if (canonicalJson(expectedState) !== canonicalJson(nextState)) {
    return false;
  }
  const content = parseJson(event.content);
  if (
    typeof content !== "object" ||
    content === null ||
    Array.isArray(content)
  ) {
    return false;
  }
  const installation = Reflect.get(content, "installation");
  if (
    typeof installation !== "object" ||
    installation === null ||
    Array.isArray(installation)
  ) {
    return false;
  }
  const configDigest = Reflect.get(installation, "configDigest");
  const { config: _config, ...redactedState } = nextState;
  const expectedContent = {
    schemaVersion: 1,
    installation: {
      ...redactedState,
      configContractId: nextState.config.contractId,
      configDigest,
    },
    delta: expectedDelta,
  };
  const expectedTags: UnsignedNostrEvent["tags"] = [
    ["workspace", nextState.workspaceId],
    ["installation", nextState.id],
    ["bot", nextState.botId],
    ["cursor", String(nextState.cursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", "punk", command.actor.punkId],
  ];
  return (
    typeof configDigest === "string" &&
    /^[0-9a-f]{64}$/.test(configDigest) &&
    event.created_at === Math.floor(Date.parse(nextState.updatedAt) / 1_000) &&
    event.kind === expectedKind &&
    canonicalJson(event.tags) === canonicalJson(expectedTags) &&
    canonicalJson(content) === canonicalJson(expectedContent)
  );
}

function parseAdmitCommand(value: string): AdmitBotActionCommand | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/bot-action.admit@1", parsed).valid
    ? (parsed as AdmitBotActionCommand)
    : null;
}

function parseCompleteCommand(value: string): CompleteBotActionCommand | null {
  const parsed = parseJson(value);
  return validateContract("punks://contracts/bot-action.complete@1", parsed)
    .valid
    ? (parsed as CompleteBotActionCommand)
    : null;
}

function samePendingAction(
  current: PendingActionRow | undefined,
  expected: PendingActionRow,
): boolean {
  return (
    current !== undefined &&
    current.operation === expected.operation &&
    current.command_id === expected.command_id &&
    current.action_id === expected.action_id &&
    current.action_digest === expected.action_digest &&
    current.jti === expected.jti &&
    current.command_json === expected.command_json &&
    current.unsigned_json === expected.unsigned_json &&
    current.next_state_json === expected.next_state_json &&
    current.admission_json === expected.admission_json
  );
}

function samePendingManagementCommand(
  current: PendingRow | undefined,
  expected: PendingRow,
): boolean {
  return (
    samePendingManagementIdentity(current, expected) &&
    current.wake_subscription_json === expected.wake_subscription_json &&
    current.attempts === expected.attempts
  );
}

function samePendingManagementIdentity(
  current: PendingRow | undefined,
  expected: PendingRow,
): current is PendingRow {
  return (
    current !== undefined &&
    current.command_id === expected.command_id &&
    current.payload_hash === expected.payload_hash &&
    current.command_json === expected.command_json &&
    current.unsigned_json === expected.unsigned_json &&
    current.next_state_json === expected.next_state_json &&
    current.grant_json === expected.grant_json &&
    current.reduction_overlay === expected.reduction_overlay
  );
}

function pendingMatchesCommittedTerminal(
  pending: PendingRow,
  committed: CommittedBotInstallationCommand,
): boolean {
  const command = parseManagementCommand(
    parseJson(String(pending.command_json)),
  );
  const unsigned = parseUnsignedEvent(String(pending.unsigned_json));
  const nextState = parseInstallation(String(pending.next_state_json));
  const grant =
    pending.grant_json === null ? null : parseGrant(String(pending.grant_json));
  return (
    command !== null &&
    unsigned !== null &&
    nextState !== null &&
    command.commandId === pending.command_id &&
    command.workspaceId === committed.state.workspaceId &&
    (command.contract === "bot-installation.install@1"
      ? command.botId === committed.state.botId
      : command.installationId === committed.state.id) &&
    canonicalJson(nextState) === canonicalJson(committed.state) &&
    signedEventPreservesUnsigned(unsigned, committed.event) &&
    canonicalJson(grant) === canonicalJson(grantMutation(command))
  );
}

function validRestoredInstallationTransition(
  current: BotInstallation | null,
  command: BotInstallationManagementCommand,
  next: BotInstallation,
  pending: PendingRow,
  reduction: boolean,
): boolean {
  if (
    reduction !== isAuthorityReduction(command) ||
    next.workspaceId !== command.workspaceId ||
    next.cursor !== (current?.cursor ?? 0) + 1 ||
    Number(pending.reduction_overlay) !== (reduction ? 1 : 0)
  ) {
    return false;
  }
  if (command.contract === "bot-installation.install@1") {
    return (
      current?.status !== "active" &&
      next.botId === command.botId &&
      next.status === "active" &&
      canonicalJson(next.config) === canonicalJson(command.payload.config) &&
      next.grantCount === 0 &&
      next.openAdmissionCount === (current?.openAdmissionCount ?? 0) &&
      next.authorityGeneration === (current?.authorityGeneration ?? 0) + 1 &&
      next.revision === (current?.revision ?? 0) + 1 &&
      next.createdAt === (current?.createdAt ?? next.updatedAt) &&
      next.revokedAt === null
    );
  }
  if (
    current === null ||
    current.status !== "active" ||
    current.id !== next.id ||
    current.workspaceId !== next.workspaceId ||
    current.botId !== next.botId ||
    current.openAdmissionCount !== next.openAdmissionCount ||
    current.createdAt !== next.createdAt ||
    next.authorityGeneration !== current.authorityGeneration + 1 ||
    next.revision !== current.revision + 1
  ) {
    return false;
  }
  if (command.contract === "bot-installation.revoke@1") {
    return (
      next.status === "revoked" &&
      next.grantCount === 0 &&
      canonicalJson(next.config) === canonicalJson(current.config) &&
      next.revokedAt === next.updatedAt
    );
  }
  if (command.payload.operation === "replace-config") {
    return (
      next.status === "active" &&
      next.grantCount === current.grantCount &&
      next.revokedAt === current.revokedAt &&
      canonicalJson(next.config) === canonicalJson(command.payload.config)
    );
  }
  if (command.payload.operation === "pin-runtime-release") {
    return (
      next.status === "active" &&
      next.grantCount === current.grantCount &&
      next.revokedAt === current.revokedAt &&
      canonicalJson(next.config) === canonicalJson(current.config) &&
      !isKnownBotRuntimeRelease(current.runtimeRelease) &&
      isKnownBotRuntimeRelease(next.runtimeRelease)
    );
  }
  const grantDelta = command.payload.grant.enabled ? 1 : -1;
  return (
    next.status === "active" &&
    next.grantCount === current.grantCount + grantDelta &&
    next.revokedAt === current.revokedAt &&
    canonicalJson(next.config) === canonicalJson(current.config)
  );
}

function archivedManagementEventIsReduction(
  content: unknown,
  kind: number,
): boolean {
  if (kind === 50312) {
    return true;
  }
  if (kind !== 50311 || !isRecord(content)) {
    return false;
  }
  const delta = Reflect.get(content, "delta");
  return (
    isRecord(delta) &&
    delta.operation === "set-grant" &&
    isRecord(delta.grant) &&
    delta.grant.enabled === false
  );
}

function sameCommandReceiptArchiveOutbox(
  current: CommandReceiptArchiveOutboxRow | undefined,
  expected: CommandReceiptArchiveOutboxRow,
): boolean {
  return (
    current !== undefined &&
    current.command_id === expected.command_id &&
    current.payload_hash === expected.payload_hash &&
    current.terminal_kind === expected.terminal_kind &&
    current.object_key === expected.object_key &&
    current.archive_json === expected.archive_json &&
    current.body_hash === expected.body_hash
  );
}

function parseCommittedInstallationCommand(
  value: string,
): CommittedBotInstallationCommand | null {
  const parsed = parseJson(value);
  if (!isRecord(parsed) || !hasExactKeys(parsed, ["state", "event"])) {
    return null;
  }
  return validateContract("punks://contracts/bot-installation@1", parsed.state)
    .valid &&
    validateContract("punks://contracts/nostr.signed-event@1", parsed.event)
      .valid
    ? (parsed as unknown as CommittedBotInstallationCommand)
    : null;
}

function isTerminalRejectionCode(
  value: string,
): value is "not_found" | "forbidden" | "invalid_transition" | "conflict" {
  return (
    value === "not_found" ||
    value === "forbidden" ||
    value === "invalid_transition" ||
    value === "conflict"
  );
}

function isActiveWorkspaceQueryResult(
  input: unknown,
  workspaceId: string,
): boolean {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ["ok", "state"]) ||
    input.ok !== true
  ) {
    return false;
  }
  return (
    validateContract("punks://contracts/workspace@1", input.state).valid &&
    isRecord(input.state) &&
    input.state.id === workspaceId &&
    input.state.status === "active"
  );
}

function workspaceResultHasNotFound(input: unknown): boolean {
  return (
    isRecord(input) &&
    hasExactKeys(input, ["ok", "code"]) &&
    input.ok === false &&
    input.code === "not_found"
  );
}

function completionFailure(
  result: Extract<BotActionAdmissionResult, { ok: false }>,
): CompleteBotActionResult {
  return {
    ok: false,
    code:
      result.code === "attestation_failed" || result.code === "internal"
        ? result.code
        : "internal",
  };
}
