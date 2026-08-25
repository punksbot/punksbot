import type {
  AttestationResponse,
  AttestationRequest,
  ClaimWorkspaceInvitationCommand,
  ClaimWorkspaceInvitationResponse,
  CreateWorkspaceInvitationCommand,
  CreateWorkspaceInvitationResponse,
  CreateWorkspaceCommand,
  GetWorkspaceInvitationQuery,
  GetWorkspaceQuery,
  JournalSegmentArchive,
  MembershipJournalSegmentArchiveV2,
  RemoveWorkspaceMemberCommand,
  RevokeWorkspaceInvitationCommand,
  RevokeWorkspaceInvitationResponse,
  RenameWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
  SignedNostrEvent,
  UnsignedNostrEvent,
  Workspace,
  WorkspaceEventContentV2,
  WorkspaceInvitationView,
  WorkspaceProjectionMessage,
  WorkspaceProjectionMessageV2,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  decideClaimWorkspaceInvitation,
  decideClaimWorkspaceInvitationV2,
  decideCreateWorkspace,
  decideCreateWorkspaceV2,
  decideRemoveWorkspaceMember,
  decideRemoveWorkspaceMemberV2,
  decideRenameWorkspace,
  decideRenameWorkspaceV2,
  decideSetWorkspaceMemberRole,
  decideSetWorkspaceMemberRoleV2,
  encodeMembershipProjectionPayload,
  isStrictWorkspaceRoleReduction,
  prepareJournalSegment,
  prepareJournalSegmentV2,
  sha256Hex,
  verifyJournalSegmentHash,
  verifyJournalSegmentHashV2,
  roleHasPermission,
  workspacePermissions,
  type WorkspacePermission,
  type WorkspaceRole,
  type WorkspaceDecisionV2,
  WorkspaceDomainError,
} from "@punks/core";
import { DurableObject } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import { verifyAttestationResponse } from "./attestation-verification";
import type {
  CommittedWorkspaceCommand,
  WorkspaceCommand,
  WorkspaceExecuteResult,
  WorkspaceInvitationClaimResult,
  WorkspaceInvitationFailureCode,
  WorkspaceInvitationMutationResult,
  WorkspaceInvitationQueryResult,
  WorkspaceMutationAuthorization,
  WorkspaceAuthorizationRequest,
  WorkspaceAuthorizationResult,
  WorkspaceQuery,
  WorkspaceQueryResult,
} from "./rpc";

type StateRow = Record<"state_json", string>;
type ResultRow = Record<"payload_hash" | "response_json", string>;
type PendingRow = Record<
  | "command_id"
  | "payload_hash"
  | "command_json"
  | "unsigned_json"
  | "next_state_json"
  | "chunks_json"
  | "attempts"
  | "reduction_overlay"
  | "authorization_session_id"
  | "authorization_punk_id"
  | "invitation_json",
  string | number | null
>;
type InvitationRow = Record<
  | "invitation_id"
  | "code_hash"
  | "role"
  | "issuer_punk_id"
  | "issued_at"
  | "expires_at"
  | "revoked_at"
  | "status"
  | "max_uses"
  | "uses"
  | "version",
  string | number | null
>;
interface PendingInvitationClaim {
  invitationId: string;
  codeHash: string;
  role: "member" | "guest";
  expiresAt: string;
  maxUses: number;
  uses: number;
  version: number;
}
type OutboxRow = Record<
  | "event_id"
  | "chunk_index"
  | "chunk_count"
  | "cursor"
  | "payload_json"
  | "delivered_at"
  | "attempts",
  string | number | null
>;
type JournalRow = Record<
  "cursor" | "event_json" | "chunks_json",
  string | number | null
>;
type ArchiveHeadRow = Record<"segment_hash", string>;
type AccountMergeRightsOutboxRow = Record<
  "operation_id" | "change_json",
  string
>;
type PendingArchiveRow = Record<
  | "start_cursor"
  | "end_cursor"
  | "previous_segment_hash"
  | "segment_hash"
  | "object_key"
  | "events_json"
  | "unsigned_seal_json"
  | "schema_version"
  | "attempts",
  string | number | null
>;

const JOURNAL_ARCHIVE_MAX_BODY_BYTES = 4_500_000;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Cloudflare Queues measures decimal kilobytes and includes internal metadata
// in its 128,000-byte limit. Keep an explicit margin for that envelope.
const PROJECTION_QUEUE_MAX_PAYLOAD_BYTES = 126_000;
const MAXIMUM_NORMAL_COMMAND_RESULT_ROWS = 256;
const MAXIMUM_NORMAL_COMMAND_RESULT_BYTES = 4_194_304;
const MAXIMUM_COMMAND_RESULT_ROWS = 4_096;
const MAXIMUM_COMMAND_RESULT_BYTES = 1_073_741_824;
const MAXIMUM_COMMAND_RESULT_ROW_BYTES = 262_144;
const MAXIMUM_NORMAL_PROJECTION_STORAGE_ROWS = 1_024;
const MAXIMUM_NORMAL_PROJECTION_STORAGE_BYTES = 8_388_608;
const MAXIMUM_REDUCTION_PROJECTION_ROWS = 2;
const MAXIMUM_REDUCTION_PROJECTION_BYTES =
  PROJECTION_QUEUE_MAX_PAYLOAD_BYTES * 3 + 1_024;
const DEFAULT_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_INVITATION_MAX_USES = 1;
const MAXIMUM_ACTIVE_INVITATIONS = 100;
const MAXIMUM_INVITATION_ROWS = 4_096;
// The primary owner is immutable. Every other member consumes exactly one
// terminal receipt slot per strict role reduction still available before
// removal, so each real demotion or removal releases at least its own slot.
const WORKSPACE_ROLE_REDUCTION_LIABILITY = {
  owner: 4,
  moderator: 3,
  member: 2,
  guest: 1,
} satisfies Readonly<Record<WorkspaceRole, number>>;

interface AccountMergeWorkspaceMembershipChange {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly punkId: string;
  readonly membership: null | {
    readonly role: WorkspaceRole;
    readonly revision: number;
  };
}

function accountMergeWorkspaceMembershipChange(
  command: WorkspaceCommand,
  nextState: Workspace,
): AccountMergeWorkspaceMembershipChange | null {
  let punkId: string;
  let membership: AccountMergeWorkspaceMembershipChange["membership"];
  switch (command.contract) {
    case "workspace.create@1":
      punkId = command.actor.punkId;
      membership = { role: "owner", revision: nextState.revision };
      break;
    case "workspace.member-set-role@1":
      punkId = command.payload.targetPunkId;
      membership = {
        role: command.payload.role,
        revision: nextState.revision,
      };
      break;
    case "workspace.member-remove@1":
      punkId = command.payload.targetPunkId;
      membership = null;
      break;
    case "workspace.invite-claim@1": {
      punkId = command.actor.punkId;
      const claimed = nextState.members.find(
        (member) => member.punkId === punkId,
      );
      if (claimed === undefined) {
        throw new Error("Invitation claim did not create membership");
      }
      membership = {
        role: claimed.role as WorkspaceRole,
        revision: nextState.revision,
      };
      break;
    }
    case "workspace.rename@1":
      return null;
  }
  if (!UUID.test(punkId) || !UUID.test(nextState.id)) {
    throw new Error("Workspace membership change has invalid authority IDs");
  }
  return {
    operationId: command.commandId,
    workspaceId: nextState.id,
    punkId,
    membership,
  };
}

export class WorkspaceDO extends DurableObject<ApiEnv> {
  private alarmScheduling: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.initialize();
      await this.repairDurableAlarm();
    });
  }

  async execute(input: unknown): Promise<WorkspaceExecuteResult> {
    const command = parseDirectWorkspaceCommand(input);
    if (command === null) {
      return { ok: false, code: "invalid_contract" };
    }
    return this.executeWorkspaceCommand(command, null, null);
  }

  /** Executes a Punk-authenticated membership mutation with a pre-commit fence. */
  async executeAuthorized(
    input: unknown,
    authorization: WorkspaceMutationAuthorization,
  ): Promise<WorkspaceExecuteResult> {
    const command = parseDirectWorkspaceCommand(input);
    if (
      command === null ||
      (command.contract !== "workspace.member-set-role@1" &&
        command.contract !== "workspace.member-remove@1") ||
      !validWorkspaceMutationAuthorization(authorization, command.actor.punkId)
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    return this.executeWorkspaceCommand(command, authorization, null);
  }

  private async executeWorkspaceCommand(
    command: WorkspaceCommand,
    authorization: WorkspaceMutationAuthorization | null,
    invitation: PendingInvitationClaim | null,
  ): Promise<WorkspaceExecuteResult> {
    if (
      command.contract === "workspace.invite-claim@1" &&
      invitation === null
    ) {
      return { ok: false, code: "invalid_contract" };
    }

    if (!(await this.flushAccountMergeRightsOutbox())) {
      this.scheduleAlarm(1_000);
      return { ok: false, code: "internal" };
    }

    const payloadHash = await sha256Hex(canonicalJson(command));
    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      return {
        ok: true,
        value: JSON.parse(completed.response_json) as CommittedWorkspaceCommand,
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

    const current = this.state();
    try {
      const context = {
        workspaceId:
          command.contract === "workspace.create@1"
            ? (this.ctx.id.name ?? "")
            : command.workspaceId,
        cursor: (current?.cursor ?? 0) + 1,
        now: new Date(),
      };
      if (context.workspaceId.length === 0) {
        return { ok: false, code: "internal" };
      }
      const decision = await (async (): Promise<WorkspaceDecisionV2> => {
        switch (command.contract) {
          case "workspace.create@1":
            return decideCreateWorkspaceV2(
              current,
              command as CreateWorkspaceCommand,
              context,
            );
          case "workspace.rename@1":
            return decideRenameWorkspaceV2(
              current,
              command as RenameWorkspaceCommand,
              context,
            );
          case "workspace.member-set-role@1":
            return decideSetWorkspaceMemberRoleV2(
              current,
              command as SetWorkspaceMemberRoleCommand,
              context,
            );
          case "workspace.member-remove@1":
            return decideRemoveWorkspaceMemberV2(
              current,
              command as RemoveWorkspaceMemberCommand,
              context,
            );
          case "workspace.invite-claim@1":
            return decideClaimWorkspaceInvitationV2(
              current,
              command,
              invitation?.role ?? "member",
              context,
            );
        }
      })();
      if (
        !validateContract("punks://contracts/workspace@1", decision.nextState)
          .valid ||
        !validateContract(
          "punks://contracts/nostr.unsigned-event@1",
          decision.event,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }
      const commandJson = JSON.stringify(command);
      const placeholderEvent = placeholderSignedEvent(decision.event);
      const candidateProjections = workspaceProjectionChunks(
        decision,
        placeholderEvent,
      );
      const candidateResponseJson = JSON.stringify({
        state: decision.nextState,
        event: placeholderEvent,
      } satisfies CommittedWorkspaceCommand);
      if (!validWorkspaceProjectionChunks(candidateProjections)) {
        return { ok: false, code: "internal" };
      }
      const chunksJson = canonicalJson(candidateProjections);
      const projectionWrite = workspaceProjectionWriteCost({
        event: placeholderEvent,
        projections: candidateProjections,
        pending: {
          commandId: command.commandId,
          payloadHash,
          commandJson,
          unsignedJson: JSON.stringify(decision.event),
          nextStateJson: JSON.stringify(decision.nextState),
          chunksJson,
        },
      });

      const authorityReduction = isWorkspaceAuthorityReduction(
        current,
        command,
      );
      const invitationLiabilityDelta = claimLiabilityDelta(invitation);
      if (
        !this.hasCommandResultCommitCapacity(
          current,
          decision.nextState,
          workspaceResultByteLength({
            commandId: command.commandId,
            payloadHash,
            commandJson,
            responseJson: candidateResponseJson,
          }),
          authorityReduction,
          invitationLiabilityDelta,
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (
        !this.hasProjectionCommitCapacity(
          current,
          decision.nextState,
          projectionWrite,
          authorityReduction,
        )
      ) {
        return { ok: false, code: "internal" };
      }
      if (!authorityReduction && !(await this.ensureJournalCapacity())) {
        return { ok: false, code: "internal" };
      }
      if (
        this.pending() !== undefined ||
        !sameWorkspaceSnapshot(this.state(), current) ||
        !this.hasProjectionCommitCapacity(
          current,
          decision.nextState,
          projectionWrite,
          authorityReduction,
        )
      ) {
        return { ok: false, code: "command_in_progress" };
      }

      this.ctx.storage.sql.exec(
        `INSERT INTO pending_command
          (singleton, command_id, payload_hash, command_json, unsigned_json,
           next_state_json, chunks_json, reduction_overlay,
           authorization_session_id, authorization_punk_id, invitation_json,
           attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        command.commandId,
        payloadHash,
        commandJson,
        JSON.stringify(decision.event),
        JSON.stringify(decision.nextState),
        chunksJson,
        authorityReduction ? 1 : 0,
        authorization?.sessionId ?? null,
        authorization?.punkId ?? null,
        invitation === null ? null : canonicalJson(invitation),
        new Date().toISOString(),
      );
      pending = this.pending();
      if (pending === undefined) {
        return { ok: false, code: "internal" };
      }
      this.scheduleAlarm(1_000);
      return this.attestAndFinalize(pending, false);
    } catch (error) {
      if (error instanceof WorkspaceDomainError) {
        const code =
          error.code === "already_exists" ? "invalid_transition" : error.code;
        return { ok: false, code };
      }
      return { ok: false, code: "internal" };
    }
  }

  /** Creates one bounded, stateful invitation without journaling roster data. */
  async createInvitation(
    input: unknown,
    authorization: WorkspaceMutationAuthorization,
  ): Promise<WorkspaceInvitationMutationResult> {
    if (
      !validateContract("punks://contracts/workspace.invite@1", input).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const command = input as CreateWorkspaceInvitationCommand;
    if (
      !validWorkspaceMutationAuthorization(authorization, command.actor.punkId)
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const payloadHash = await sha256Hex(canonicalJson(command));
    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      const response = parseJson(completed.response_json);
      if (
        !validateContract(
          "punks://contracts/workspace.invite-response@1",
          response,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }
      return {
        ok: true,
        response: {
          ...(response as CreateWorkspaceInvitationResponse),
          replayed: true,
        },
      };
    }
    if (this.pending() !== undefined) {
      return { ok: false, code: "command_in_progress" };
    }

    const code = randomInvitationCode(this.ctx.id.name ?? "");
    const codeHash = await sha256Hex(code);
    if (!(await this.validMutationSession(authorization))) {
      return { ok: false, code: "forbidden" };
    }
    const now = new Date();
    const invitationId = crypto.randomUUID();
    const ttlSeconds =
      command.payload.ttlSeconds ?? DEFAULT_INVITATION_TTL_SECONDS;
    const maxUses = command.payload.maxUses ?? DEFAULT_INVITATION_MAX_USES;
    const row: InvitationRow = {
      invitation_id: invitationId,
      code_hash: codeHash,
      role: command.payload.role,
      issuer_punk_id: command.actor.punkId,
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
      revoked_at: null,
      status: "issued",
      max_uses: maxUses,
      uses: 0,
      version: 1,
    };
    let result: WorkspaceInvitationMutationResult = {
      ok: false,
      code: "command_in_progress",
    };
    this.ctx.storage.transactionSync(() => {
      const state = this.state();
      const actor = state?.members.find(
        (member) => member.punkId === command.actor.punkId,
      );
      if (state === null || state.id !== command.workspaceId) {
        result = { ok: false, code: "not_found" };
        return;
      }
      if (state.revision !== command.payload.expectedRevision) {
        result = { ok: false, code: "revision_conflict" };
        return;
      }
      if (
        state.status !== "active" ||
        actor === undefined ||
        !roleHasPermission(actor.role as WorkspaceRole, "members.manage")
      ) {
        result = { ok: false, code: "forbidden" };
        return;
      }
      if (
        this.pending() !== undefined ||
        this.result(command.commandId) !== undefined
      ) {
        return;
      }
      if (this.activeInvitationCount(now) >= MAXIMUM_ACTIVE_INVITATIONS) {
        result = { ok: false, code: "internal" };
        return;
      }
      if (this.invitationRowCount() >= MAXIMUM_INVITATION_ROWS) {
        result = { ok: false, code: "internal" };
        return;
      }
      const invitation = workspaceInvitationView(row, state, now);
      const response: CreateWorkspaceInvitationResponse = {
        contract: "workspace.invite-response@1",
        invitation,
        code,
        replayed: false,
      };
      const responseJson = JSON.stringify(response);
      if (
        !this.hasCommandResultCommitCapacity(
          state,
          state,
          workspaceResultByteLength({
            commandId: command.commandId,
            payloadHash,
            commandJson: JSON.stringify(command),
            responseJson,
          }),
          false,
          1,
        )
      ) {
        result = { ok: false, code: "internal" };
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace_invitations
          (invitation_id, code_hash, role, issuer_punk_id, issued_at,
           expires_at, revoked_at, status, max_uses, uses, version)
         VALUES (?, ?, ?, ?, ?, ?, NULL, 'issued', ?, 0, 1)`,
        invitationId,
        codeHash,
        command.payload.role,
        command.actor.punkId,
        row.issued_at,
        row.expires_at,
        maxUses,
      );
      this.insertCommandResult(
        command.commandId,
        payloadHash,
        JSON.stringify(command),
        responseJson,
        now,
      );
      result = { ok: true, response };
    });
    return result;
  }

  /** Revokes one invitation by its issuer or a current Workspace Owner. */
  async revokeInvitation(
    input: unknown,
    authorization: WorkspaceMutationAuthorization,
  ): Promise<WorkspaceInvitationMutationResult> {
    if (
      !validateContract("punks://contracts/workspace.invite-revoke@1", input)
        .valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const command = input as RevokeWorkspaceInvitationCommand;
    if (
      !validWorkspaceMutationAuthorization(authorization, command.actor.punkId)
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const payloadHash = await sha256Hex(canonicalJson(command));
    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      const response = parseJson(completed.response_json);
      if (
        !validateContract(
          "punks://contracts/workspace.invite-revoke-response@1",
          response,
        ).valid
      ) {
        return { ok: false, code: "internal" };
      }
      return {
        ok: true,
        response: {
          ...(response as RevokeWorkspaceInvitationResponse),
          replayed: true,
        },
      };
    }
    if (this.pending() !== undefined) {
      return { ok: false, code: "command_in_progress" };
    }
    if (!(await this.validMutationSession(authorization))) {
      return { ok: false, code: "forbidden" };
    }

    const now = new Date();
    let result: WorkspaceInvitationMutationResult = {
      ok: false,
      code: "command_in_progress",
    };
    this.ctx.storage.transactionSync(() => {
      const state = this.state();
      if (state === null || state.id !== command.workspaceId) {
        result = { ok: false, code: "not_found" };
        return;
      }
      if (state.revision !== command.payload.expectedRevision) {
        result = { ok: false, code: "revision_conflict" };
        return;
      }
      const actor = state.members.find(
        (member) => member.punkId === command.actor.punkId,
      );
      const row = this.invitationById(command.payload.invitationId);
      if (row === undefined) {
        result = { ok: false, code: "invite_invalid" };
        return;
      }
      if (
        actor === undefined ||
        (row.issuer_punk_id !== command.actor.punkId &&
          !roleHasPermission(actor.role as WorkspaceRole, "members.manage"))
      ) {
        result = { ok: false, code: "forbidden" };
        return;
      }
      if (row.status === "revoked") {
        result = { ok: false, code: "invite_revoked" };
        return;
      }
      if (
        this.pending() !== undefined ||
        this.result(command.commandId) !== undefined
      ) {
        return;
      }
      const updated: InvitationRow = {
        ...row,
        status: "revoked",
        revoked_at: now.toISOString(),
        version: Number(row.version) + 1,
      };
      const response: RevokeWorkspaceInvitationResponse = {
        contract: "workspace.invite-revoke-response@1",
        invitation: workspaceInvitationView(updated, state, now),
        replayed: false,
      };
      const commandJson = JSON.stringify(command);
      const responseJson = JSON.stringify(response);
      if (
        !this.hasCommandResultCommitCapacity(
          state,
          state,
          workspaceResultByteLength({
            commandId: command.commandId,
            payloadHash,
            commandJson,
            responseJson,
          }),
          true,
          invitationStatus(row, now) === "issued" ? -1 : 0,
        )
      ) {
        result = { ok: false, code: "internal" };
        return;
      }
      this.ctx.storage.sql.exec(
        `UPDATE workspace_invitations
         SET status = 'revoked', revoked_at = ?, version = version + 1
         WHERE invitation_id = ? AND status = 'issued' AND version = ?`,
        now.toISOString(),
        row.invitation_id,
        row.version,
      );
      const committed = this.invitationById(command.payload.invitationId);
      if (
        committed === undefined ||
        canonicalJson(committed) !== canonicalJson(updated)
      ) {
        result = { ok: false, code: "internal" };
        return;
      }
      this.insertCommandResult(
        command.commandId,
        payloadHash,
        commandJson,
        responseJson,
        now,
      );
      result = { ok: true, response };
    });
    return result;
  }

  /** Resolves one opaque invitation code without exposing a Workspace roster. */
  async getInvitation(input: unknown): Promise<WorkspaceInvitationQueryResult> {
    if (
      !validateContract("punks://contracts/workspace.invite-get@1", input).valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const query = input as GetWorkspaceInvitationQuery;
    const row = this.invitationByCodeHash(await sha256Hex(query.code));
    if (row === undefined) {
      return { ok: false, code: "invite_invalid" };
    }
    const state = this.state();
    if (state === null || state.status !== "active") {
      return { ok: false, code: "not_found" };
    }
    const invitation = workspaceInvitationView(row, state, new Date());
    return validateContract(
      "punks://contracts/workspace.invitation@1",
      invitation,
    ).valid
      ? { ok: true, invitation }
      : { ok: false, code: "invite_invalid" };
  }

  /** Claims one invitation and atomically commits its membership usage. */
  async claimInvitation(
    input: unknown,
    authorization: WorkspaceMutationAuthorization,
  ): Promise<WorkspaceInvitationClaimResult> {
    if (
      !validateContract("punks://contracts/workspace.invite-claim@1", input)
        .valid
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const command = input as ClaimWorkspaceInvitationCommand;
    if (
      !validWorkspaceMutationAuthorization(authorization, command.actor.punkId)
    ) {
      return { ok: false, code: "invalid_contract" };
    }
    const payloadHash = await sha256Hex(canonicalJson(command));
    const completed = this.result(command.commandId);
    if (completed !== undefined) {
      if (completed.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      const response = claimResponseFromStored(
        completed.response_json,
        command.actor.punkId,
        true,
      );
      return response === null
        ? { ok: false, code: "internal" }
        : { ok: true, response };
    }

    const pending = this.pending();
    if (pending !== undefined) {
      if (pending.command_id !== command.commandId) {
        return { ok: false, code: "command_in_progress" };
      }
      if (pending.payload_hash !== payloadHash) {
        return { ok: false, code: "idempotency_conflict" };
      }
      const invitation = parsePendingInvitation(pending.invitation_json);
      if (invitation === null) {
        return { ok: false, code: "internal" };
      }
      const execution = await this.executeWorkspaceCommand(
        command,
        authorization,
        invitation,
      );
      return invitationClaimExecutionResult(execution, command.actor.punkId);
    }

    const state = this.state();
    if (state === null || state.id !== command.workspaceId) {
      return { ok: false, code: "not_found" };
    }
    if (state.revision !== command.payload.expectedRevision) {
      return { ok: false, code: "revision_conflict" };
    }
    const row = this.invitationByCodeHash(
      await sha256Hex(command.payload.code),
    );
    if (row === undefined) {
      return { ok: false, code: "invite_invalid" };
    }
    const existing = state.members.find(
      (member) => member.punkId === command.actor.punkId,
    );
    if (existing !== undefined) {
      if (!(await this.validMutationSession(authorization))) {
        return { ok: false, code: "forbidden" };
      }
      const response = workspaceInvitationClaimResponse(
        state,
        existing.role as WorkspaceRole,
        "already_member",
        false,
      );
      const now = new Date();
      const responseJson = JSON.stringify(response);
      let recorded = false;
      this.ctx.storage.transactionSync(() => {
        if (
          sameWorkspaceSnapshot(this.state(), state) &&
          this.pending() === undefined &&
          this.result(command.commandId) === undefined &&
          this.hasCommandResultCommitCapacity(
            state,
            state,
            workspaceResultByteLength({
              commandId: command.commandId,
              payloadHash,
              commandJson: JSON.stringify(command),
              responseJson,
            }),
            false,
          )
        ) {
          this.insertCommandResult(
            command.commandId,
            payloadHash,
            JSON.stringify(command),
            responseJson,
            now,
          );
          recorded = true;
        }
      });
      return recorded
        ? { ok: true, response }
        : { ok: false, code: "command_in_progress" };
    }

    const status = invitationStatus(row, new Date());
    if (status !== "issued") {
      return {
        ok: false,
        code:
          status === "expired"
            ? "invite_expired"
            : status === "revoked"
              ? "invite_revoked"
              : "invite_exhausted",
      };
    }
    const invitation = pendingInvitationClaim(row);
    if (invitation === null) {
      return { ok: false, code: "invite_role_forbidden" };
    }
    const execution = await this.executeWorkspaceCommand(
      command,
      authorization,
      invitation,
    );
    return invitationClaimExecutionResult(execution, command.actor.punkId);
  }

  query(input: unknown): WorkspaceQueryResult {
    if (!validateContract("punks://contracts/workspace.get@1", input).valid) {
      return { ok: false, code: "invalid_contract" };
    }
    const query = input as GetWorkspaceQuery & WorkspaceQuery;
    const state = this.effectiveState();
    if (state === null || state.id !== query.workspaceId) {
      return { ok: false, code: "not_found" };
    }
    return { ok: true, state };
  }

  authorize(input: unknown): WorkspaceAuthorizationResult {
    if (
      typeof input !== "object" ||
      input === null ||
      !("workspaceId" in input) ||
      !("punkId" in input) ||
      !("permission" in input)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const request = input as WorkspaceAuthorizationRequest;
    if (
      typeof request.workspaceId !== "string" ||
      request.workspaceId !== this.ctx.id.name ||
      typeof request.punkId !== "string" ||
      request.punkId.length === 0 ||
      typeof request.permission !== "string" ||
      !workspacePermissions.includes(request.permission as WorkspacePermission)
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const state = this.effectiveState();
    const committed = this.state();
    if (
      state === null ||
      committed === null ||
      state.status !== "active" ||
      committed.id !== state.id
    ) {
      return { ok: false, code: "not_found" };
    }
    const member = state.members.find(
      (candidate) => candidate.punkId === request.punkId,
    );
    if (
      member === undefined ||
      !roleHasPermission(
        member.role as WorkspaceRole,
        request.permission as WorkspacePermission,
      )
    ) {
      return { ok: false, code: "forbidden" };
    }
    return {
      ok: true,
      workspaceCursor: committed.cursor,
      role: member.role as WorkspaceRole,
      visibility: state.visibility,
    };
  }

  follow(): { ok: false; code: "invalid_contract" } {
    return { ok: false, code: "invalid_contract" };
  }

  override async alarm(): Promise<void> {
    const pending = this.pending();
    if (pending !== undefined) {
      await this.attestAndFinalize(pending, true, false);
    }
    await this.flushAccountMergeRightsOutbox();
    await this.flushOutbox();
    await this.archiveJournalIfNeeded();
  }

  private initialize(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS workspace_state (
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

      CREATE TABLE IF NOT EXISTS pending_command (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        command_id TEXT NOT NULL UNIQUE,
        payload_hash TEXT NOT NULL,
        command_json TEXT NOT NULL,
        unsigned_json TEXT NOT NULL,
        next_state_json TEXT NOT NULL,
        chunks_json TEXT NOT NULL DEFAULT '[]',
        reduction_overlay INTEGER NOT NULL DEFAULT 0
          CHECK (reduction_overlay IN (0, 1)),
        authorization_session_id TEXT,
        authorization_punk_id TEXT,
        invitation_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS workspace_invitations (
        invitation_id TEXT PRIMARY KEY NOT NULL,
        code_hash TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL CHECK (role IN ('member', 'guest')),
        issuer_punk_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('issued', 'revoked')),
        max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
        uses INTEGER NOT NULL DEFAULT 0 CHECK (
          uses >= 0 AND uses <= max_uses
        ),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS journal (
        cursor INTEGER PRIMARY KEY NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_kind INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        chunks_json TEXT,
        committed_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0 CHECK (chunk_index >= 0),
        chunk_count INTEGER NOT NULL DEFAULT 1 CHECK (chunk_count >= 1),
        cursor INTEGER NOT NULL,
        payload_json TEXT NOT NULL,
        delivered_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, chunk_index),
        UNIQUE (cursor, chunk_index),
        CHECK (chunk_index < chunk_count)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS account_merge_rights_outbox (
        operation_id TEXT PRIMARY KEY NOT NULL,
        change_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS projection_delivery_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        enqueued_through_cursor INTEGER NOT NULL CHECK (
          enqueued_through_cursor >= 0
        )
      ) STRICT;

      CREATE TABLE IF NOT EXISTS archive_segments (
        start_cursor INTEGER PRIMARY KEY NOT NULL,
        end_cursor INTEGER NOT NULL UNIQUE,
        previous_segment_hash TEXT,
        segment_hash TEXT NOT NULL UNIQUE,
        object_key TEXT NOT NULL UNIQUE,
        seal_json TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
          schema_version IN (1, 2)
        ),
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
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK (
          schema_version IN (1, 2)
        ),
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
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
    if (!pendingColumns.some((column) => column.name === "reduction_overlay")) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE pending_command
         ADD COLUMN reduction_overlay INTEGER NOT NULL DEFAULT 0
         CHECK (reduction_overlay IN (0, 1))`,
      );
    }
    if (!pendingColumns.some((column) => column.name === "chunks_json")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN chunks_json TEXT NOT NULL DEFAULT '[]'",
      );
    }
    if (
      !pendingColumns.some(
        (column) => column.name === "authorization_session_id",
      )
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN authorization_session_id TEXT",
      );
    }
    if (
      !pendingColumns.some((column) => column.name === "authorization_punk_id")
    ) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN authorization_punk_id TEXT",
      );
    }
    if (!pendingColumns.some((column) => column.name === "invitation_json")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE pending_command ADD COLUMN invitation_json TEXT",
      );
    }
    const journalColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(journal)")
      .toArray();
    if (!journalColumns.some((column) => column.name === "chunks_json")) {
      this.ctx.storage.sql.exec(
        "ALTER TABLE journal ADD COLUMN chunks_json TEXT",
      );
    }
    const outboxColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(outbox)")
      .toArray();
    if (!outboxColumns.some((column) => column.name === "chunk_index")) {
      this.ctx.storage.sql.exec(`
        ALTER TABLE outbox RENAME TO legacy_outbox_v1;
        CREATE TABLE outbox (
          event_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL DEFAULT 0 CHECK (chunk_index >= 0),
          chunk_count INTEGER NOT NULL DEFAULT 1 CHECK (chunk_count >= 1),
          cursor INTEGER NOT NULL,
          payload_json TEXT NOT NULL,
          delivered_at TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (event_id, chunk_index),
          UNIQUE (cursor, chunk_index),
          CHECK (chunk_index < chunk_count)
        ) STRICT;
        INSERT INTO outbox
          (event_id, chunk_index, chunk_count, cursor, payload_json,
           delivered_at, attempts)
        SELECT event_id, 0, 1, cursor, payload_json, delivered_at, attempts
        FROM legacy_outbox_v1;
        DROP TABLE legacy_outbox_v1;
      `);
    }
    const archiveColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(archive_segments)")
      .toArray();
    if (!archiveColumns.some((column) => column.name === "schema_version")) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE archive_segments ADD COLUMN schema_version INTEGER
         NOT NULL DEFAULT 1 CHECK (schema_version IN (1, 2))`,
      );
    }
    const pendingArchiveColumns = this.ctx.storage.sql
      .exec<{ name: string }>("PRAGMA table_info(pending_archive)")
      .toArray();
    if (
      !pendingArchiveColumns.some((column) => column.name === "schema_version")
    ) {
      this.ctx.storage.sql.exec(
        `ALTER TABLE pending_archive ADD COLUMN schema_version INTEGER
         NOT NULL DEFAULT 1 CHECK (schema_version IN (1, 2))`,
      );
    }
    // Queue acceptance is the durable hand-off boundary. Preserve the highest
    // cursor accepted by older revisions before removing their delivered rows.
    this.ctx.storage.sql.exec(
      `INSERT INTO projection_delivery_state
        (singleton, enqueued_through_cursor)
       VALUES (1, 0)
       ON CONFLICT(singleton) DO NOTHING`,
    );
    this.ctx.storage.sql.exec(
      `WITH RECURSIVE contiguous(cursor) AS (
         SELECT enqueued_through_cursor FROM projection_delivery_state
         WHERE singleton = 1
         UNION ALL
         SELECT cursor + 1 FROM contiguous
         WHERE EXISTS (
           SELECT 1 FROM outbox AS candidate
           WHERE candidate.cursor = contiguous.cursor + 1
         )
         AND NOT EXISTS (
           SELECT 1 FROM outbox AS incomplete
           WHERE incomplete.cursor = contiguous.cursor + 1
             AND incomplete.delivered_at IS NULL
         )
         AND (
           SELECT COUNT(*) FROM outbox AS sibling
           WHERE sibling.cursor = contiguous.cursor + 1
         ) = (
           SELECT MAX(chunk_count) FROM outbox AS sibling
           WHERE sibling.cursor = contiguous.cursor + 1
         )
       )
       UPDATE projection_delivery_state
       SET enqueued_through_cursor = (SELECT MAX(cursor) FROM contiguous)
       WHERE singleton = 1`,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM outbox
       WHERE cursor <= (
         SELECT enqueued_through_cursor FROM projection_delivery_state
         WHERE singleton = 1
       )
       AND NOT EXISTS (
         SELECT 1 FROM outbox AS incomplete
         WHERE incomplete.cursor = outbox.cursor
           AND incomplete.delivered_at IS NULL
       )`,
    );
  }

  private state(): Workspace | null {
    const row = this.ctx.storage.sql
      .exec<StateRow>(
        "SELECT state_json FROM workspace_state WHERE singleton = 1",
      )
      .toArray()[0];
    if (row === undefined) {
      return null;
    }
    const parsed = parseJson(row.state_json);
    return validateContract("punks://contracts/workspace@1", parsed).valid
      ? (parsed as Workspace)
      : null;
  }

  private effectiveState(): Workspace | null {
    const pending = this.pending();
    if (pending === undefined || Number(pending.reduction_overlay) !== 1) {
      return this.state();
    }
    const committed = this.state();
    const command = parseWorkspaceCommand(String(pending.command_json));
    const overlay = parseJson(String(pending.next_state_json));
    const unsigned = parseJson(String(pending.unsigned_json));
    const chunks = parseWorkspaceProjectionChunks(String(pending.chunks_json));
    if (
      committed === null ||
      command === null ||
      !isWorkspaceAuthorityReduction(committed, command) ||
      !validateContract("punks://contracts/workspace@1", overlay).valid ||
      !validateContract("punks://contracts/nostr.unsigned-event@1", unsigned)
        .valid
    ) {
      return null;
    }
    let expected: { nextState: Workspace; event: UnsignedNostrEvent };
    try {
      expected = decideWorkspaceReduction(committed, command, {
        workspaceId: committed.id,
        cursor: (overlay as Workspace).cursor,
        now: new Date((overlay as Workspace).updatedAt),
      });
    } catch {
      return null;
    }
    if (canonicalJson(expected.nextState) !== canonicalJson(overlay)) {
      return null;
    }
    const validPendingEvent =
      chunks.length === 0
        ? canonicalJson(expected.event) === canonicalJson(unsigned)
        : validPendingWorkspaceReductionV2(
            committed,
            command,
            overlay as Workspace,
            unsigned as UnsignedNostrEvent,
            chunks,
            expected.event,
          );
    return validPendingEvent ? (overlay as Workspace) : null;
  }

  private result(commandId: string): ResultRow | undefined {
    return this.ctx.storage.sql
      .exec<ResultRow>(
        "SELECT payload_hash, response_json FROM command_results WHERE command_id = ?",
        commandId,
      )
      .toArray()[0];
  }

  private invitationByCodeHash(codeHash: string): InvitationRow | undefined {
    return this.ctx.storage.sql
      .exec<InvitationRow>(
        `SELECT invitation_id, code_hash, role, issuer_punk_id, issued_at,
                expires_at, revoked_at, status, max_uses, uses, version
         FROM workspace_invitations WHERE code_hash = ?`,
        codeHash,
      )
      .toArray()[0];
  }

  private invitationById(invitationId: string): InvitationRow | undefined {
    return this.ctx.storage.sql
      .exec<InvitationRow>(
        `SELECT invitation_id, code_hash, role, issuer_punk_id, issued_at,
                expires_at, revoked_at, status, max_uses, uses, version
         FROM workspace_invitations WHERE invitation_id = ?`,
        invitationId,
      )
      .toArray()[0];
  }

  private activeInvitationCount(now: Date): number {
    return this.ctx.storage.sql
      .exec<{ count: number }>(
        `SELECT COUNT(*) AS count FROM workspace_invitations
         WHERE status = 'issued' AND expires_at > ? AND uses < max_uses`,
        now.toISOString(),
      )
      .one().count;
  }

  private invitationRowCount(): number {
    return this.ctx.storage.sql
      .exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM workspace_invitations",
      )
      .one().count;
  }

  private async validMutationSession(
    authorization: WorkspaceMutationAuthorization,
  ): Promise<boolean> {
    try {
      const session = await this.env.AUTH_SERVICE.resolveSessionId(
        authorization.sessionId,
      );
      return (
        session !== null &&
        validateContract("punks://contracts/auth.session@1", session).valid &&
        session.sessionId === authorization.sessionId &&
        session.punkId === authorization.punkId &&
        Date.parse(session.expiresAt) > Date.now()
      );
    } catch {
      return false;
    }
  }

  private async abandonPreparedWorkspaceMutation(
    rightsChange: AccountMergeWorkspaceMembershipChange | null,
    commandId: string,
    payloadHash: string,
  ): Promise<void> {
    if (rightsChange !== null) {
      try {
        await this.env.ACCOUNT_MERGE_RIGHTS_INDEX.abortWorkspaceMembershipChange(
          rightsChange,
        );
      } catch {
        // The local authority remains fail-closed until a new human intent.
      }
    }
    this.ctx.storage.sql.exec(
      `DELETE FROM pending_command
       WHERE singleton = 1 AND command_id = ? AND payload_hash = ?`,
      commandId,
      payloadHash,
    );
  }

  private insertCommandResult(
    commandId: string,
    payloadHash: string,
    commandJson: string,
    responseJson: string,
    now: Date,
  ): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO command_results
        (command_id, payload_hash, command_json, response_json, committed_at)
       VALUES (?, ?, ?, ?, ?)`,
      commandId,
      payloadHash,
      commandJson,
      responseJson,
      now.toISOString(),
    );
  }

  private pending(): PendingRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingRow>(
        `SELECT command_id, payload_hash, command_json, unsigned_json,
                next_state_json, chunks_json, reduction_overlay,
                authorization_session_id, authorization_punk_id,
                invitation_json, attempts
         FROM pending_command WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private commandResultStorageUsage(): { rows: number; bytes: number } {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COUNT(*) AS rows,
                COALESCE(SUM(
                  length(CAST(command_id AS BLOB)) +
                  length(CAST(payload_hash AS BLOB)) +
                  length(CAST(command_json AS BLOB)) +
                  length(CAST(response_json AS BLOB)) +
                  length(CAST(committed_at AS BLOB))
                ), 0) AS bytes
         FROM command_results`,
      )
      .one();
    return { rows: Number(usage.rows), bytes: Number(usage.bytes) };
  }

  private projectionStorageUsage(): { rows: number; bytes: number } {
    const usage = this.ctx.storage.sql
      .exec<{ rows: number; bytes: number }>(
        `SELECT COALESCE(SUM(rows), 0) AS rows,
                COALESCE(SUM(bytes), 0) AS bytes
         FROM (
           SELECT COUNT(*) AS rows,
                  COALESCE(SUM(
                    length(CAST(event_id AS BLOB)) +
                    length(CAST(event_json AS BLOB)) +
                    COALESCE(length(CAST(chunks_json AS BLOB)), 0) +
                    length(CAST(committed_at AS BLOB))
                  ), 0) AS bytes
           FROM journal
           UNION ALL
           SELECT COUNT(*) AS rows,
                  COALESCE(SUM(
                    length(CAST(event_id AS BLOB)) +
                    length(CAST(payload_json AS BLOB)) +
                    COALESCE(length(CAST(delivered_at AS BLOB)), 0)
                  ), 0) AS bytes
           FROM outbox
           UNION ALL
           SELECT COUNT(*) AS rows,
                  COALESCE(SUM(
                    length(CAST(segment_hash AS BLOB)) +
                    length(CAST(object_key AS BLOB)) +
                    length(CAST(events_json AS BLOB)) +
                    length(CAST(unsigned_seal_json AS BLOB)) +
                    length(CAST(created_at AS BLOB))
                  ), 0) AS bytes
           FROM pending_archive
           UNION ALL
           SELECT COUNT(*) AS rows,
                  COALESCE(SUM(
                    length(CAST(segment_hash AS BLOB)) +
                    length(CAST(object_key AS BLOB)) +
                    length(CAST(seal_json AS BLOB)) +
                    length(CAST(archived_at AS BLOB))
                  ), 0) AS bytes
           FROM archive_segments
         )`,
      )
      .one();
    return { rows: Number(usage.rows), bytes: Number(usage.bytes) };
  }

  private hasProjectionCommitCapacity(
    current: Workspace | null,
    next: Workspace,
    write: { rows: number; bytes: number },
    safetyReduction: boolean,
  ): boolean {
    if (
      !Number.isSafeInteger(write.rows) ||
      write.rows < 1 ||
      !Number.isSafeInteger(write.bytes) ||
      write.bytes < 1
    ) {
      return false;
    }
    const usage = this.projectionStorageUsage();
    const liabilities = workspaceTerminalLiability(current);
    const liabilitiesAfter = workspaceTerminalLiability(next);
    if (
      usage.rows + write.rows <= MAXIMUM_NORMAL_PROJECTION_STORAGE_ROWS &&
      usage.bytes + write.bytes <= MAXIMUM_NORMAL_PROJECTION_STORAGE_BYTES
    ) {
      return true;
    }
    if (!safetyReduction || liabilitiesAfter >= liabilities) {
      return false;
    }
    return (
      usage.rows +
        write.rows +
        liabilitiesAfter * MAXIMUM_REDUCTION_PROJECTION_ROWS <=
        usage.rows + liabilities * MAXIMUM_REDUCTION_PROJECTION_ROWS &&
      usage.bytes +
        write.bytes +
        liabilitiesAfter * MAXIMUM_REDUCTION_PROJECTION_BYTES <=
        usage.bytes + liabilities * MAXIMUM_REDUCTION_PROJECTION_BYTES
    );
  }

  private hasCommandResultCommitCapacity(
    current: Workspace | null,
    next: Workspace,
    resultBytes: number,
    safetyReduction: boolean,
    invitationLiabilityDelta = 0,
  ): boolean {
    if (
      !Number.isSafeInteger(resultBytes) ||
      resultBytes < 1 ||
      resultBytes > MAXIMUM_COMMAND_RESULT_ROW_BYTES
    ) {
      return false;
    }
    const usage = this.commandResultStorageUsage();
    const activeInvitations = this.activeInvitationCount(new Date());
    const liabilities = workspaceTerminalLiability(current) + activeInvitations;
    const liabilitiesAfter =
      workspaceTerminalLiability(next) +
      activeInvitations +
      invitationLiabilityDelta;
    const normalCapacity =
      usage.rows + 1 <= MAXIMUM_NORMAL_COMMAND_RESULT_ROWS &&
      usage.bytes + resultBytes <= MAXIMUM_NORMAL_COMMAND_RESULT_BYTES;
    const hardCapacity =
      usage.rows + 1 + liabilitiesAfter <= MAXIMUM_COMMAND_RESULT_ROWS &&
      usage.bytes +
        resultBytes +
        liabilitiesAfter * MAXIMUM_COMMAND_RESULT_ROW_BYTES <=
        MAXIMUM_COMMAND_RESULT_BYTES;
    if (normalCapacity && hardCapacity) {
      return true;
    }
    if (!safetyReduction || liabilitiesAfter >= liabilities) {
      return false;
    }
    return (
      usage.rows + 1 + liabilitiesAfter <= usage.rows + liabilities &&
      usage.bytes +
        resultBytes +
        liabilitiesAfter * MAXIMUM_COMMAND_RESULT_ROW_BYTES <=
        usage.bytes + liabilities * MAXIMUM_COMMAND_RESULT_ROW_BYTES
    );
  }

  private async attestAndFinalize(
    pending: PendingRow,
    replayed: boolean,
    flushInBackground = true,
  ): Promise<WorkspaceExecuteResult> {
    const pendingInvitation = parsePendingInvitation(pending.invitation_json);
    if (
      !(await validPendingWorkspaceCommand(
        pending,
        this.state(),
        this.ctx.id.name ?? "",
        pendingInvitation,
      ))
    ) {
      this.markPendingFailure();
      return { ok: false, code: "internal" };
    }
    let signedEvent: SignedNostrEvent;
    try {
      signedEvent = await this.attest(
        JSON.parse(String(pending.unsigned_json)) as UnsignedNostrEvent,
      );
    } catch {
      this.markPendingFailure();
      return { ok: false, code: "attestation_failed" };
    }

    const commandId = String(pending.command_id);
    const payloadHash = String(pending.payload_hash);
    const nextState = JSON.parse(String(pending.next_state_json)) as Workspace;
    const pendingChunks = parseWorkspaceProjectionChunks(
      String(pending.chunks_json),
    );
    const projections:
      | readonly WorkspaceProjectionMessageV2[]
      | readonly WorkspaceProjectionMessage[] =
      pendingChunks.length > 0
        ? pendingChunks.map((chunk) => ({ ...chunk, event: signedEvent }))
        : [workspaceProjection(nextState, signedEvent)];
    const validProjection =
      pendingChunks.length > 0
        ? validWorkspaceProjectionChunks(
            projections as readonly WorkspaceProjectionMessageV2[],
          ) &&
          pendingChunks.every(
            (chunk) =>
              canonicalJson(chunk.event) ===
              canonicalJson(
                placeholderSignedEvent(
                  JSON.parse(
                    String(pending.unsigned_json),
                  ) as UnsignedNostrEvent,
                ),
              ),
          )
        : validateContract(
            "punks://contracts/workspace.projection@1",
            projections[0],
          ).valid &&
          utf8ByteLength(canonicalJson(projections[0])) <=
            PROJECTION_QUEUE_MAX_PAYLOAD_BYTES;
    if (!validProjection) {
      this.markPendingFailure();
      return { ok: false, code: "internal" };
    }
    const command = JSON.parse(
      String(pending.command_json),
    ) as WorkspaceCommand;
    let rightsChange: AccountMergeWorkspaceMembershipChange | null;
    try {
      rightsChange = accountMergeWorkspaceMembershipChange(command, nextState);
      if (
        rightsChange !== null &&
        !(await this.env.ACCOUNT_MERGE_RIGHTS_INDEX.prepareWorkspaceMembershipChange(
          rightsChange,
        ))
      ) {
        this.markPendingFailure();
        return { ok: false, code: "internal" };
      }
    } catch {
      this.markPendingFailure();
      return { ok: false, code: "internal" };
    }
    const authorization = parsePendingAuthorization(pending);
    if (
      authorization === undefined ||
      (authorization !== null &&
        !(await this.validMutationSession(authorization)))
    ) {
      await this.abandonPreparedWorkspaceMutation(
        rightsChange,
        commandId,
        payloadHash,
      );
      return { ok: false, code: "forbidden" };
    }
    if (command.contract === "workspace.invite-claim@1") {
      if (pendingInvitation === null) {
        await this.abandonPreparedWorkspaceMutation(
          rightsChange,
          commandId,
          payloadHash,
        );
        return { ok: false, code: "internal" };
      }
      const currentInvitation = this.invitationByCodeHash(
        pendingInvitation.codeHash,
      );
      const status =
        currentInvitation === undefined
          ? "invalid"
          : invitationStatus(currentInvitation, new Date());
      if (
        currentInvitation === undefined ||
        !invitationMatchesPending(currentInvitation, pendingInvitation)
      ) {
        await this.abandonPreparedWorkspaceMutation(
          rightsChange,
          commandId,
          payloadHash,
        );
        return { ok: false, code: "invite_invalid" };
      }
      if (status !== "issued") {
        await this.abandonPreparedWorkspaceMutation(
          rightsChange,
          commandId,
          payloadHash,
        );
        return {
          ok: false,
          code:
            status === "expired"
              ? "invite_expired"
              : status === "revoked"
                ? "invite_revoked"
                : "invite_exhausted",
        };
      }
    }
    const response: CommittedWorkspaceCommand = {
      state: nextState,
      event: signedEvent,
    };
    const responseJson = JSON.stringify(response);
    const resultBytes = workspaceResultByteLength({
      commandId,
      payloadHash,
      commandJson: String(pending.command_json),
      responseJson,
    });
    const projectionWrite = workspaceProjectionWriteCost({
      event: signedEvent,
      projections,
    });
    let finalized: CommittedWorkspaceCommand | undefined;

    this.ctx.storage.transactionSync(() => {
      const currentPending = this.pending();
      if (currentPending === undefined) {
        const existing = this.result(commandId);
        if (existing !== undefined && existing.payload_hash === payloadHash) {
          finalized = JSON.parse(
            existing.response_json,
          ) as CommittedWorkspaceCommand;
        }
        return;
      }
      if (
        currentPending.command_id !== commandId ||
        currentPending.payload_hash !== payloadHash ||
        currentPending.command_json !== pending.command_json ||
        currentPending.unsigned_json !== pending.unsigned_json ||
        currentPending.next_state_json !== pending.next_state_json ||
        currentPending.chunks_json !== pending.chunks_json ||
        currentPending.reduction_overlay !== pending.reduction_overlay ||
        currentPending.authorization_session_id !==
          pending.authorization_session_id ||
        currentPending.authorization_punk_id !==
          pending.authorization_punk_id ||
        currentPending.invitation_json !== pending.invitation_json
      ) {
        return;
      }
      // A retained archive head must dominate a restored pre-commit snapshot.
      // A full PITR that also removes this local index still needs operator
      // reconciliation against R2; this DO cannot infer an unknown segment key.
      const occupiedCursor = this.ctx.storage.sql
        .exec<{ occupied: number }>(
          `SELECT (
             EXISTS(SELECT 1 FROM journal WHERE cursor = ?) OR
             EXISTS(
               SELECT 1 FROM archive_segments
               WHERE start_cursor <= ? AND end_cursor >= ?
             )
           ) AS occupied`,
          nextState.cursor,
          nextState.cursor,
          nextState.cursor,
        )
        .one().occupied;
      if (occupiedCursor === 1) {
        return;
      }
      const committed = this.state();
      const safetyReduction = Number(pending.reduction_overlay) === 1;
      const invitationLiabilityDelta = claimLiabilityDelta(pendingInvitation);
      if (
        !this.hasCommandResultCommitCapacity(
          committed,
          nextState,
          resultBytes,
          safetyReduction,
          invitationLiabilityDelta,
        )
      ) {
        if (!safetyReduction) {
          this.ctx.storage.sql.exec(
            "DELETE FROM pending_command WHERE singleton = 1",
          );
        }
        return;
      }
      if (
        !this.hasProjectionCommitCapacity(
          committed,
          nextState,
          projectionWrite,
          safetyReduction,
        )
      ) {
        if (!safetyReduction) {
          this.ctx.storage.sql.exec(
            "DELETE FROM pending_command WHERE singleton = 1",
          );
        }
        return;
      }
      const now = new Date().toISOString();
      if (pendingInvitation !== null) {
        const currentInvitation = this.invitationByCodeHash(
          pendingInvitation.codeHash,
        );
        if (
          currentInvitation === undefined ||
          invitationStatus(currentInvitation, new Date(now)) !== "issued" ||
          !invitationMatchesPending(currentInvitation, pendingInvitation)
        ) {
          return;
        }
        this.ctx.storage.sql.exec(
          `UPDATE workspace_invitations
           SET uses = uses + 1, version = version + 1
           WHERE invitation_id = ? AND code_hash = ? AND status = 'issued'
             AND uses = ? AND max_uses = ? AND version = ?`,
          pendingInvitation.invitationId,
          pendingInvitation.codeHash,
          pendingInvitation.uses,
          pendingInvitation.maxUses,
          pendingInvitation.version,
        );
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO workspace_state (singleton, state_json) VALUES (1, ?)
         ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json`,
        JSON.stringify(nextState),
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO journal
          (cursor, event_id, event_kind, event_json, chunks_json, committed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        nextState.cursor,
        signedEvent.id,
        signedEvent.kind,
        JSON.stringify(signedEvent),
        pendingChunks.length > 0 ? canonicalJson(projections) : null,
        now,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO command_results
          (command_id, payload_hash, command_json, response_json, committed_at)
         VALUES (?, ?, ?, ?, ?)`,
        commandId,
        payloadHash,
        String(pending.command_json),
        responseJson,
        now,
      );
      if (rightsChange !== null) {
        this.ctx.storage.sql.exec(
          `INSERT INTO account_merge_rights_outbox
            (operation_id, change_json, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT(operation_id) DO UPDATE SET
             change_json = excluded.change_json`,
          rightsChange.operationId,
          canonicalJson(rightsChange),
          now,
        );
      }
      for (const [chunkIndex, projection] of projections.entries()) {
        this.ctx.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, chunk_index, chunk_count, cursor, payload_json,
             delivered_at, attempts)
           VALUES (?, ?, ?, ?, ?, NULL, 0)`,
          signedEvent.id,
          chunkIndex,
          projections.length,
          nextState.cursor,
          canonicalJson(projection),
        );
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_command WHERE singleton = 1",
      );
      finalized = response;
    });

    if (finalized === undefined) {
      if (rightsChange !== null) {
        try {
          await this.env.ACCOUNT_MERGE_RIGHTS_INDEX.abortWorkspaceMembershipChange(
            rightsChange,
          );
        } catch {
          // A remote pending marker is deliberately fail-closed.
        }
      }
      return { ok: false, code: "internal" };
    }
    this.scheduleAlarm(0);
    if (!(await this.flushAccountMergeRightsOutbox())) {
      return { ok: false, code: "internal" };
    }
    if (flushInBackground) {
      this.ctx.waitUntil(this.flushOutbox());
    }
    return { ok: true, value: finalized, replayed };
  }

  private async attest(
    event: UnsignedNostrEvent,
    purpose: AttestationRequest["purpose"] = "workspace-journal",
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
    if (!(await verifyAttestationResponse(attestation, event, this.env))) {
      throw new Error(
        "Attestation signature is not trusted in this environment",
      );
    }
    return attestation.event;
  }

  private markPendingFailure(): void {
    const current = this.pending();
    const attempts = Math.min(63, Number(current?.attempts ?? 0) + 1);
    this.ctx.storage.sql.exec(
      "UPDATE pending_command SET attempts = ? WHERE singleton = 1",
      attempts,
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private async flushOutbox(): Promise<void> {
    const nextCursor = this.ctx.storage.sql
      .exec<{ cursor: number }>(
        "SELECT cursor FROM outbox ORDER BY cursor LIMIT 1",
      )
      .toArray()[0]?.cursor;
    if (nextCursor === undefined) {
      return;
    }
    const rows = this.ctx.storage.sql
      .exec<OutboxRow>(
        `SELECT event_id, chunk_index, chunk_count, cursor, payload_json,
                delivered_at, attempts
         FROM outbox WHERE cursor = ? ORDER BY chunk_index LIMIT 65`,
        nextCursor,
      )
      .toArray();
    const first = rows[0];
    const validBatch =
      first !== undefined &&
      rows.length <= 64 &&
      rows.length === Number(first.chunk_count) &&
      rows.every(
        (row, index) =>
          row.event_id === first.event_id &&
          Number(row.cursor) === Number(nextCursor) &&
          Number(row.chunk_index) === index &&
          Number(row.chunk_count) === rows.length,
      );
    if (!validBatch) {
      this.deferOutboxBatch(rows);
      return;
    }
    for (const row of rows) {
      if (row.delivered_at !== null) {
        continue;
      }
      try {
        await this.env.PROJECTION_QUEUE.send(
          JSON.parse(String(row.payload_json)),
        );
        let substituted = false;
        const deliveredAt = new Date().toISOString();
        this.ctx.storage.transactionSync(() => {
          const current = this.ctx.storage.sql
            .exec<OutboxRow>(
              `SELECT event_id, chunk_index, chunk_count, cursor, payload_json,
                      delivered_at, attempts
               FROM outbox WHERE event_id = ? AND chunk_index = ?`,
              row.event_id,
              row.chunk_index,
            )
            .toArray()[0];
          if (current === undefined) {
            substituted = true;
            return;
          }
          if (
            current.cursor !== row.cursor ||
            current.chunk_index !== row.chunk_index ||
            current.chunk_count !== row.chunk_count ||
            current.payload_json !== row.payload_json ||
            current.attempts !== row.attempts ||
            current.delivered_at !== null
          ) {
            substituted = true;
            return;
          }
          this.ctx.storage.sql.exec(
            `UPDATE outbox SET delivered_at = ?
             WHERE event_id = ? AND chunk_index = ? AND cursor = ?
               AND payload_json = ? AND attempts = ? AND delivered_at IS NULL`,
            deliveredAt,
            row.event_id,
            row.chunk_index,
            row.cursor,
            row.payload_json,
            row.attempts,
          );
        });
        if (substituted) {
          this.scheduleAlarm(0);
          return;
        }
        row.delivered_at = deliveredAt;
      } catch {
        const attempts = Math.min(63, Number(row.attempts) + 1);
        this.ctx.storage.sql.exec(
          `UPDATE outbox SET attempts = ?
           WHERE event_id = ? AND chunk_index = ? AND attempts = ?
             AND delivered_at IS NULL`,
          attempts,
          row.event_id,
          row.chunk_index,
          row.attempts,
        );
        this.scheduleAlarm(
          Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000),
        );
        return;
      }
    }
    let finalized = false;
    this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql
        .exec<OutboxRow>(
          `SELECT event_id, chunk_index, chunk_count, cursor, payload_json,
                  delivered_at, attempts
           FROM outbox WHERE cursor = ? ORDER BY chunk_index`,
          nextCursor,
        )
        .toArray();
      if (
        current.length !== rows.length ||
        current.some(
          (row, index) =>
            row.event_id !== rows[index]?.event_id ||
            row.chunk_index !== rows[index]?.chunk_index ||
            row.chunk_count !== rows[index]?.chunk_count ||
            row.cursor !== rows[index]?.cursor ||
            row.payload_json !== rows[index]?.payload_json ||
            row.attempts !== rows[index]?.attempts ||
            row.delivered_at === null,
        )
      ) {
        return;
      }
      const deliveredThrough = this.enqueuedThroughCursor();
      const cursor = Number(nextCursor);
      if (cursor > deliveredThrough + 1) {
        return;
      }
      if (cursor === deliveredThrough + 1) {
        this.ctx.storage.sql.exec(
          `UPDATE projection_delivery_state
           SET enqueued_through_cursor = ?
           WHERE singleton = 1 AND enqueued_through_cursor = ?`,
          cursor,
          deliveredThrough,
        );
      }
      this.ctx.storage.sql.exec("DELETE FROM outbox WHERE cursor = ?", cursor);
      finalized = true;
    });
    if (finalized) {
      this.scheduleAlarm(0);
    } else {
      this.deferOutboxBatch(rows);
    }
  }

  private async flushAccountMergeRightsOutbox(): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<AccountMergeRightsOutboxRow>(
        `SELECT operation_id, change_json
         FROM account_merge_rights_outbox ORDER BY created_at LIMIT 1`,
      )
      .toArray()[0];
    if (row === undefined) return true;
    let change: AccountMergeWorkspaceMembershipChange;
    try {
      change = JSON.parse(
        row.change_json,
      ) as AccountMergeWorkspaceMembershipChange;
      if (
        change.operationId !== row.operation_id ||
        !(await this.env.ACCOUNT_MERGE_RIGHTS_INDEX.commitWorkspaceMembershipChange(
          change,
        ))
      ) {
        return false;
      }
    } catch {
      return false;
    }
    this.ctx.storage.sql.exec(
      `DELETE FROM account_merge_rights_outbox
       WHERE operation_id = ? AND change_json = ?`,
      row.operation_id,
      row.change_json,
    );
    return true;
  }

  private deferOutboxBatch(rows: readonly OutboxRow[]): void {
    const first = rows[0];
    if (first === undefined) {
      this.scheduleAlarm(1_000);
      return;
    }
    const attempts = Math.min(
      63,
      Math.max(...rows.map((row) => Number(row.attempts))) + 1,
    );
    this.ctx.storage.sql.exec(
      "UPDATE outbox SET attempts = ? WHERE cursor = ?",
      attempts,
      first.cursor,
    );
    this.scheduleAlarm(Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000));
  }

  private pendingArchive(): PendingArchiveRow | undefined {
    return this.ctx.storage.sql
      .exec<PendingArchiveRow>(
        `SELECT start_cursor, end_cursor, previous_segment_hash, segment_hash,
                object_key, events_json, unsigned_seal_json, schema_version,
                attempts
         FROM pending_archive WHERE singleton = 1`,
      )
      .toArray()[0];
  }

  private enqueuedThroughCursor(): number {
    return this.ctx.storage.sql
      .exec<{ enqueued_through_cursor: number }>(
        `SELECT enqueued_through_cursor FROM projection_delivery_state
         WHERE singleton = 1`,
      )
      .one().enqueued_through_cursor;
  }

  private archiveLimits(): { hotEvents: number; segmentEvents: number } {
    return {
      hotEvents: this.positiveInteger(
        this.env.JOURNAL_HOT_EVENTS,
        1_000,
        1,
        100_000,
      ),
      segmentEvents: this.positiveInteger(
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
        // Corrupt/unsealable hot input has no durable retry row to count.
        // Poll it at the bounded ceiling instead of creating a 1-second loop.
        this.scheduleAlarm(60_000);
        return;
      }
      const attempts = Math.min(63, Number(pending.attempts) + 1);
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
    const count =
      this.ctx.storage.sql
        .exec<Record<"count", number>>("SELECT COUNT(*) AS count FROM journal")
        .toArray()[0]?.count ?? 0;
    if (count < hotEvents + segmentEvents) {
      return undefined;
    }

    const enqueuedThrough = this.enqueuedThroughCursor();
    const rows = this.ctx.storage.sql
      .exec<JournalRow>(
        `SELECT cursor, event_json, chunks_json FROM journal
         WHERE cursor <= ? ORDER BY cursor LIMIT ?`,
        enqueuedThrough,
        Math.min(segmentEvents, 64),
      )
      .toArray();
    const useV2 = rows[0]?.chunks_json !== null;
    const maxBytes = useV2 ? 850_000 : 4_000_000;
    const selected: JournalRow[] = [];
    let selectedBytes = 0;
    for (const row of rows) {
      if ((row.chunks_json !== null) !== useV2) {
        break;
      }
      const rowBytes = new TextEncoder().encode(
        `${String(row.event_json)}${String(row.chunks_json ?? "")}`,
      ).byteLength;
      if (selected.length > 0 && selectedBytes + rowBytes > maxBytes) {
        break;
      }
      selected.push(row);
      selectedBytes += rowBytes;
    }
    if (selected.length === 0) {
      return undefined;
    }

    const state = this.state();
    if (state === null) {
      throw new Error("Cannot archive a journal without Workspace state");
    }
    const previousSegmentHash =
      this.ctx.storage.sql
        .exec<ArchiveHeadRow>(
          "SELECT segment_hash FROM archive_segments ORDER BY end_cursor DESC LIMIT 1",
        )
        .toArray()[0]?.segment_hash ?? null;
    const draft = useV2
      ? await prepareJournalSegmentV2(
          state.id,
          selected.map((row) => ({
            cursor: Number(row.cursor),
            event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
            chunks: JSON.parse(
              String(row.chunks_json),
            ) as WorkspaceProjectionMessageV2[],
          })),
          previousSegmentHash,
          new Date(),
        )
      : await prepareJournalSegment(
          state.id,
          selected.map((row) => ({
            cursor: Number(row.cursor),
            event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
          })),
          previousSegmentHash,
          new Date(),
        );

    const objectKey = `workspaces/${state.id}/journal/${draft.startCursor}-${draft.endCursor}-${draft.segmentHash}.json`;
    const eventsJson = JSON.stringify(
      useV2
        ? (draft as Awaited<ReturnType<typeof prepareJournalSegmentV2>>).entries
        : (draft as Awaited<ReturnType<typeof prepareJournalSegment>>).events,
    );
    this.ctx.storage.transactionSync(() => {
      if (this.pendingArchive() !== undefined) {
        return;
      }
      const currentHead =
        this.ctx.storage.sql
          .exec<ArchiveHeadRow>(
            "SELECT segment_hash FROM archive_segments ORDER BY end_cursor DESC LIMIT 1",
          )
          .toArray()[0]?.segment_hash ?? null;
      const currentRows = this.ctx.storage.sql
        .exec<JournalRow>(
          `SELECT cursor, event_json, chunks_json FROM journal
           WHERE cursor >= ? AND cursor <= ? ORDER BY cursor`,
          draft.startCursor,
          draft.endCursor,
        )
        .toArray();
      if (
        currentHead !== previousSegmentHash ||
        canonicalJson(currentRows) !== canonicalJson(selected)
      ) {
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO pending_archive
          (singleton, start_cursor, end_cursor, previous_segment_hash,
           segment_hash, object_key, events_json, unsigned_seal_json,
           schema_version, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        draft.startCursor,
        draft.endCursor,
        draft.previousSegmentHash,
        draft.segmentHash,
        objectKey,
        eventsJson,
        JSON.stringify(draft.unsignedSeal),
        useV2 ? 2 : 1,
        new Date().toISOString(),
      );
    });
    return this.pendingArchive();
  }

  private async writePendingArchive(pending: PendingArchiveRow): Promise<void> {
    if (Number(pending.end_cursor) > this.enqueuedThroughCursor()) {
      throw new Error(
        "Journal archive cannot advance beyond the Projection Queue cursor",
      );
    }
    const state = this.state();
    if (state === null) {
      throw new Error("Cannot archive a journal without Workspace state");
    }
    const unsignedSeal = JSON.parse(
      String(pending.unsigned_seal_json),
    ) as UnsignedNostrEvent;
    const seal = await this.attest(unsignedSeal, "workspace-journal-segment");
    if (seal.kind !== 50002) {
      throw new Error("Journal archive seal used an unexpected event kind");
    }
    const schemaVersion = Number(pending.schema_version);
    const common = {
      workspaceId: state.id,
      startCursor: Number(pending.start_cursor),
      endCursor: Number(pending.end_cursor),
      previousSegmentHash:
        pending.previous_segment_hash === null
          ? null
          : String(pending.previous_segment_hash),
      segmentHash: String(pending.segment_hash),
      seal: { ...seal, kind: 50002 as const },
    };
    let archive: JournalSegmentArchive | MembershipJournalSegmentArchiveV2 =
      schemaVersion === 2
        ? {
            schemaVersion: 2,
            ...common,
            entries: JSON.parse(
              String(pending.events_json),
            ) as MembershipJournalSegmentArchiveV2["entries"],
          }
        : {
            schemaVersion: 1,
            ...common,
            events: JSON.parse(
              String(pending.events_json),
            ) as JournalSegmentArchive["events"],
          };
    if (!(await validWorkspaceJournalArchive(archive))) {
      throw new Error("Journal archive violated its canonical contract");
    }

    const objectKey = String(pending.object_key);
    const metadata = {
      workspaceId: state.id,
      segmentHash: archive.segmentHash,
      startCursor: String(archive.startCursor),
      endCursor: String(archive.endCursor),
    };
    const archiveBody = canonicalJson(archive);
    if (
      new TextEncoder().encode(archiveBody).byteLength >
      JOURNAL_ARCHIVE_MAX_BODY_BYTES
    ) {
      throw new Error("Journal archive exceeds its bounded body size");
    }
    const stored = await this.env.JOURNAL_ARCHIVE_BUCKET.put(
      objectKey,
      archiveBody,
      {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType: "application/json" },
        customMetadata: metadata,
      },
    );
    if (stored === null) {
      const existing = await this.env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
      if (existing === null) {
        throw new Error(
          "Journal archive precondition failed without an existing object",
        );
      }
      if (
        existing.key !== objectKey ||
        existing.size > JOURNAL_ARCHIVE_MAX_BODY_BYTES ||
        existing.httpMetadata?.contentType !== "application/json" ||
        canonicalJson(existing.customMetadata ?? {}) !== canonicalJson(metadata)
      ) {
        throw new Error(
          "Existing journal archive metadata failed integrity verification",
        );
      }
      const existingText = await existing.text();
      const existingBody: unknown = JSON.parse(existingText);
      const existingContract =
        schemaVersion === 2
          ? "punks://contracts/journal.segment@2"
          : "punks://contracts/journal.segment@1";
      if (!validateContract(existingContract, existingBody).valid) {
        throw new Error(
          "Existing journal archive violated its canonical contract",
        );
      }
      const existingArchive = existingBody as
        | JournalSegmentArchive
        | MembershipJournalSegmentArchiveV2;
      if (existingText !== canonicalJson(existingArchive)) {
        throw new Error("Existing journal archive body is not canonical");
      }
      const expectedPreviousSegmentHash =
        pending.previous_segment_hash === null
          ? null
          : String(pending.previous_segment_hash);
      const attestation = existingArchive.seal.tags.at(-1);
      const trustedSeal =
        attestation?.length === 2 &&
        attestation[0] === "attestation" &&
        typeof attestation[1] === "string" &&
        (await verifyAttestationResponse(
          { keyVersion: attestation[1], event: existingArchive.seal },
          unsignedSeal,
          this.env,
        ));
      if (
        existingArchive.workspaceId !== state.id ||
        existingArchive.startCursor !== Number(pending.start_cursor) ||
        existingArchive.endCursor !== Number(pending.end_cursor) ||
        existingArchive.previousSegmentHash !== expectedPreviousSegmentHash ||
        existingArchive.segmentHash !== pending.segment_hash ||
        canonicalJson(
          existingArchive.schemaVersion === 2
            ? existingArchive.entries
            : existingArchive.events,
        ) !== canonicalJson(JSON.parse(String(pending.events_json))) ||
        !trustedSeal ||
        !(await validWorkspaceJournalArchive(existingArchive))
      ) {
        throw new Error(
          "Existing journal archive failed integrity verification",
        );
      }
      archive = existingArchive;
    }

    this.ctx.storage.transactionSync(() => {
      const current = this.pendingArchive();
      if (
        current === undefined ||
        current.start_cursor !== pending.start_cursor ||
        current.end_cursor !== pending.end_cursor ||
        current.previous_segment_hash !== pending.previous_segment_hash ||
        current.segment_hash !== archive.segmentHash ||
        current.schema_version !== pending.schema_version ||
        current.object_key !== pending.object_key ||
        current.events_json !== pending.events_json ||
        current.unsigned_seal_json !== pending.unsigned_seal_json
      ) {
        return;
      }
      const hotRows = this.ctx.storage.sql
        .exec<JournalRow>(
          `SELECT cursor, event_json, chunks_json FROM journal
           WHERE cursor >= ? AND cursor <= ? ORDER BY cursor`,
          archive.startCursor,
          archive.endCursor,
        )
        .toArray();
      if (!archiveMatchesHotWorkspaceJournal(archive, hotRows)) {
        return;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO archive_segments
          (start_cursor, end_cursor, previous_segment_hash, segment_hash,
           object_key, seal_json, schema_version, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        archive.startCursor,
        archive.endCursor,
        archive.previousSegmentHash,
        archive.segmentHash,
        objectKey,
        JSON.stringify(archive.seal),
        archive.schemaVersion,
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
    });
    this.scheduleAlarm(0);
  }

  private positiveInteger(
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

  private scheduleAlarm(delayMs: number): void {
    void this.ensureAlarmAt(Date.now() + delayMs);
  }

  private async repairDurableAlarm(): Promise<void> {
    const hasWork = this.ctx.storage.sql
      .exec<{ has_work: number }>(
        `SELECT (
          EXISTS(SELECT 1 FROM pending_command) OR
          EXISTS(SELECT 1 FROM outbox) OR
          EXISTS(SELECT 1 FROM pending_archive)
        ) AS has_work`,
      )
      .one().has_work;
    if (
      (hasWork === 1 || !this.hasJournalCapacity()) &&
      (await this.ctx.storage.getAlarm()) === null
    ) {
      await this.ctx.storage.setAlarm(Date.now() + 1_000);
    }
  }
}

async function validWorkspaceJournalArchive(
  archive: JournalSegmentArchive | MembershipJournalSegmentArchiveV2,
): Promise<boolean> {
  if (archive.schemaVersion === 2) {
    return (
      validateContract("punks://contracts/journal.segment@2", archive).valid &&
      (await verifyJournalSegmentHashV2(archive))
    );
  }
  return (
    validateContract("punks://contracts/journal.segment@1", archive).valid &&
    (await verifyJournalSegmentHash(archive))
  );
}

function archiveMatchesHotWorkspaceJournal(
  archive: JournalSegmentArchive | MembershipJournalSegmentArchiveV2,
  rows: readonly JournalRow[],
): boolean {
  try {
    if (archive.schemaVersion === 2) {
      return (
        rows.length === archive.entries.length &&
        canonicalJson(
          rows.map((row) => ({
            cursor: Number(row.cursor),
            event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
            chunks: JSON.parse(
              String(row.chunks_json),
            ) as WorkspaceProjectionMessageV2[],
          })),
        ) === canonicalJson(archive.entries)
      );
    }
    return (
      rows.length === archive.events.length &&
      canonicalJson(
        rows.map(
          (row) => JSON.parse(String(row.event_json)) as SignedNostrEvent,
        ),
      ) === canonicalJson(archive.events)
    );
  } catch {
    return false;
  }
}

function isWorkspaceAuthorityReduction(
  current: Workspace | null,
  command: WorkspaceCommand,
): boolean {
  if (current === null) {
    return false;
  }
  if (command.contract === "workspace.member-remove@1") {
    return current.members.some(
      (member) => member.punkId === command.payload.targetPunkId,
    );
  }
  if (command.contract !== "workspace.member-set-role@1") {
    return false;
  }
  const existing = current.members.find(
    (member) => member.punkId === command.payload.targetPunkId,
  );
  return (
    existing !== undefined &&
    isStrictWorkspaceRoleReduction(
      existing.role as WorkspaceRole,
      command.payload.role as WorkspaceRole,
    )
  );
}

function sameWorkspaceSnapshot(
  current: Workspace | null,
  expected: Workspace | null,
): boolean {
  return canonicalJson(current) === canonicalJson(expected);
}

function placeholderSignedEvent(event: UnsignedNostrEvent): SignedNostrEvent {
  return {
    ...event,
    tags: [...event.tags, ["attestation", "x".repeat(64)]],
    id: "0".repeat(64),
    pubkey: "0".repeat(64),
    sig: "0".repeat(128),
  };
}

function workspaceProjection(
  state: Workspace,
  event: SignedNostrEvent,
): WorkspaceProjectionMessage {
  return {
    schemaVersion: 1,
    workspaceId: state.id,
    cursor: state.cursor,
    event,
    state,
  };
}

function workspaceProjectionChunks(
  decision: WorkspaceDecisionV2,
  event: SignedNostrEvent,
): WorkspaceProjectionMessageV2[] {
  return decision.membershipProjection.chunks.map((chunk) => ({
    schemaVersion: 2,
    workspaceId: decision.nextState.id,
    cursor: decision.nextState.cursor,
    chunkIndex: chunk.chunkIndex,
    chunkCount: decision.membershipProjection.commitment.chunkCount,
    chunkDigest: chunk.chunkDigest,
    memberDeltas: [...chunk.memberDeltas],
    event,
  }));
}

function validWorkspaceProjectionChunks(
  chunks: readonly WorkspaceProjectionMessageV2[],
): boolean {
  if (
    chunks.length === 0 ||
    chunks.some(
      (chunk, index) =>
        chunk.chunkIndex !== index ||
        chunk.chunkCount !== chunks.length ||
        !validateContract("punks://contracts/workspace.projection@2", chunk)
          .valid,
    )
  ) {
    return false;
  }
  try {
    for (const chunk of chunks) {
      encodeMembershipProjectionPayload(chunk);
    }
    return true;
  } catch {
    return false;
  }
}

function parseWorkspaceProjectionChunks(
  value: string,
): WorkspaceProjectionMessageV2[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed as WorkspaceProjectionMessageV2[];
}

function validPendingWorkspaceReductionV2(
  current: Workspace,
  command: WorkspaceCommand,
  nextState: Workspace,
  unsigned: UnsignedNostrEvent,
  chunks: readonly WorkspaceProjectionMessageV2[],
  legacyExpectedEvent: UnsignedNostrEvent,
): boolean {
  const parsedContent = parseJson(unsigned.content);
  if (
    !validWorkspaceProjectionChunks(chunks) ||
    !validateContract("punks://contracts/workspace.event@2", parsedContent)
      .valid ||
    canonicalJson(parsedContent) !== unsigned.content ||
    canonicalJson(unsigned.tags.slice(0, -1)) !==
      canonicalJson(legacyExpectedEvent.tags) ||
    unsigned.tags.at(-1)?.[0] !== "delta"
  ) {
    return false;
  }
  const content = parsedContent as WorkspaceEventContentV2;
  const { members, ...workspaceWithoutMembers } = nextState;
  const expectedWorkspace = {
    ...workspaceWithoutMembers,
    memberCount: members.length,
  };
  const existing =
    command.contract === "workspace.member-set-role@1" ||
    command.contract === "workspace.member-remove@1"
      ? current.members.find(
          (member) => member.punkId === command.payload.targetPunkId,
        )
      : undefined;
  const expectedTransition =
    command.contract === "workspace.member-set-role@1"
      ? {
          type: "member-upserted" as const,
          targetPunkId: command.payload.targetPunkId,
          previousRole: existing?.role ?? null,
          role: command.payload.role,
        }
      : command.contract === "workspace.member-remove@1" &&
          existing !== undefined
        ? {
            type: "member-removed" as const,
            targetPunkId: command.payload.targetPunkId,
            previousRole: existing.role,
          }
        : command.contract === "workspace.invite-claim@1"
          ? {
              type: "member-upserted" as const,
              targetPunkId: command.actor.punkId,
              previousRole: null,
              role: nextState.members.find(
                (member) => member.punkId === command.actor.punkId,
              )?.role,
            }
          : null;
  const expectedDeltas =
    command.contract === "workspace.member-set-role@1"
      ? [
          {
            punkId: command.payload.targetPunkId,
            present: true,
            role: command.payload.role,
          },
        ]
      : command.contract === "workspace.member-remove@1" &&
          existing !== undefined
        ? [
            {
              punkId: command.payload.targetPunkId,
              present: false,
              role: existing.role,
            },
          ]
        : command.contract === "workspace.invite-claim@1"
          ? [
              {
                punkId: command.actor.punkId,
                present: true,
                role: nextState.members.find(
                  (member) => member.punkId === command.actor.punkId,
                )?.role,
              },
            ]
          : [];
  const placeholder = placeholderSignedEvent(unsigned);
  return (
    expectedTransition !== null &&
    canonicalJson(content.workspace) === canonicalJson(expectedWorkspace) &&
    canonicalJson(content.transition) === canonicalJson(expectedTransition) &&
    canonicalJson(chunks.flatMap((chunk) => chunk.memberDeltas)) ===
      canonicalJson(expectedDeltas) &&
    chunks.every(
      (chunk) => canonicalJson(chunk.event) === canonicalJson(placeholder),
    )
  );
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function workspaceTerminalLiability(state: Workspace | null): number {
  if (state === null) {
    return 0;
  }
  return state.members.reduce((liabilities, member) => {
    if (member.punkId === state.ownerPunkId) {
      return liabilities;
    }
    return (
      liabilities +
      WORKSPACE_ROLE_REDUCTION_LIABILITY[member.role as WorkspaceRole]
    );
  }, 0);
}

function workspaceResultByteLength(input: {
  commandId: string;
  payloadHash: string;
  commandJson: string;
  responseJson: string;
}): number {
  return [
    input.commandId,
    input.payloadHash,
    input.commandJson,
    input.responseJson,
    // ISO-8601 committed_at is always 24 ASCII bytes.
    "0000-00-00T00:00:00.000Z",
  ].reduce((total, value) => total + utf8ByteLength(value), 0);
}

function workspaceProjectionWriteCost(input: {
  event: SignedNostrEvent;
  projections:
    | readonly WorkspaceProjectionMessage[]
    | readonly WorkspaceProjectionMessageV2[];
  pending?: {
    commandId: string;
    payloadHash: string;
    commandJson: string;
    unsignedJson: string;
    nextStateJson: string;
    chunksJson: string;
  };
}): { rows: number; bytes: number } {
  const eventJson = canonicalJson(input.event);
  const projectionJson = input.projections.map((projection) =>
    canonicalJson(projection),
  );
  const chunksJson =
    input.projections[0]?.schemaVersion === 2
      ? canonicalJson(input.projections)
      : "";
  const finalizedBytes =
    utf8ByteLength(input.event.id) +
    utf8ByteLength(eventJson) +
    utf8ByteLength(chunksJson) +
    utf8ByteLength("0000-00-00T00:00:00.000Z") +
    projectionJson.reduce(
      (total, projection) =>
        total + utf8ByteLength(input.event.id) + utf8ByteLength(projection),
      0,
    );
  const pendingBytes =
    input.pending === undefined
      ? 0
      : [
          input.pending.commandId,
          input.pending.payloadHash,
          input.pending.commandJson,
          input.pending.unsignedJson,
          input.pending.nextStateJson,
          input.pending.chunksJson,
          "0000-00-00T00:00:00.000Z",
        ].reduce((total, value) => total + utf8ByteLength(value), 0);
  return {
    rows: Math.max(1, input.projections.length + 1),
    bytes: Math.max(finalizedBytes, pendingBytes),
  };
}

function parseDirectWorkspaceCommand(value: unknown): WorkspaceCommand | null {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null;
  }
  if (serialized === undefined) return null;
  const command = parseWorkspaceCommand(serialized);
  return command?.contract === "workspace.invite-claim@1" ? null : command;
}

function parseWorkspaceCommand(value: string): WorkspaceCommand | null {
  const parsed = parseJson(value);
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }
  const contract = Reflect.get(parsed, "contract");
  const contractId =
    contract === "workspace.create@1"
      ? "punks://contracts/workspace.create@1"
      : contract === "workspace.rename@1"
        ? "punks://contracts/workspace.rename@1"
        : contract === "workspace.member-set-role@1"
          ? "punks://contracts/workspace.member-set-role@1"
          : contract === "workspace.member-remove@1"
            ? "punks://contracts/workspace.member-remove@1"
            : contract === "workspace.invite-claim@1"
              ? "punks://contracts/workspace.invite-claim@1"
              : null;
  return contractId !== null && validateContract(contractId, parsed).valid
    ? (parsed as WorkspaceCommand)
    : null;
}

async function validPendingWorkspaceCommand(
  pending: PendingRow,
  current: Workspace | null,
  durableObjectName: string,
  invitation: PendingInvitationClaim | null,
): Promise<boolean> {
  const command = parseWorkspaceCommand(String(pending.command_json));
  const nextState = parseJson(String(pending.next_state_json));
  const unsigned = parseJson(String(pending.unsigned_json));
  if (
    command === null ||
    command.commandId !== pending.command_id ||
    (await sha256Hex(canonicalJson(command))) !== pending.payload_hash ||
    !validateContract("punks://contracts/workspace@1", nextState).valid ||
    !validateContract("punks://contracts/nostr.unsigned-event@1", unsigned)
      .valid
  ) {
    return false;
  }
  const workspace = nextState as Workspace;
  const context = {
    workspaceId:
      command.contract === "workspace.create@1"
        ? durableObjectName
        : command.workspaceId,
    cursor: workspace.cursor,
    now: new Date(workspace.updatedAt),
  };
  if (
    context.workspaceId.length === 0 ||
    !Number.isFinite(context.now.getTime())
  ) {
    return false;
  }
  try {
    const chunksJson = String(pending.chunks_json);
    const chunks = parseWorkspaceProjectionChunks(chunksJson);
    if (canonicalJson(chunks) !== chunksJson) {
      return false;
    }
    if (chunks.length === 0) {
      const legacy = decideWorkspaceCommand(
        current,
        command,
        context,
        invitation,
      );
      return (
        canonicalJson(legacy.nextState) === canonicalJson(workspace) &&
        canonicalJson(legacy.event) === canonicalJson(unsigned)
      );
    }
    const decision = await decideWorkspaceCommandV2(
      current,
      command,
      context,
      invitation,
    );
    const expectedChunks = workspaceProjectionChunks(
      decision,
      placeholderSignedEvent(decision.event),
    );
    return (
      canonicalJson(decision.nextState) === canonicalJson(workspace) &&
      canonicalJson(decision.event) === canonicalJson(unsigned) &&
      canonicalJson(expectedChunks) === canonicalJson(chunks) &&
      validWorkspaceProjectionChunks(chunks)
    );
  } catch {
    return false;
  }
}

function decideWorkspaceCommand(
  current: Workspace | null,
  command: WorkspaceCommand,
  context: { workspaceId: string; cursor: number; now: Date },
  invitation: PendingInvitationClaim | null = null,
): { nextState: Workspace; event: UnsignedNostrEvent } {
  switch (command.contract) {
    case "workspace.create@1":
      return decideCreateWorkspace(current, command, context);
    case "workspace.rename@1":
      return decideRenameWorkspace(current, command, context);
    case "workspace.member-set-role@1":
      return decideSetWorkspaceMemberRole(current, command, context);
    case "workspace.member-remove@1":
      return decideRemoveWorkspaceMember(current, command, context);
    case "workspace.invite-claim@1":
      if (invitation === null) {
        throw new Error("Invitation claim is missing its authority snapshot");
      }
      return decideClaimWorkspaceInvitation(
        current,
        command,
        invitation.role,
        context,
      );
  }
}

async function decideWorkspaceCommandV2(
  current: Workspace | null,
  command: WorkspaceCommand,
  context: { workspaceId: string; cursor: number; now: Date },
  invitation: PendingInvitationClaim | null = null,
): Promise<WorkspaceDecisionV2> {
  switch (command.contract) {
    case "workspace.create@1":
      return decideCreateWorkspaceV2(current, command, context);
    case "workspace.rename@1":
      return decideRenameWorkspaceV2(current, command, context);
    case "workspace.member-set-role@1":
      return decideSetWorkspaceMemberRoleV2(current, command, context);
    case "workspace.member-remove@1":
      return decideRemoveWorkspaceMemberV2(current, command, context);
    case "workspace.invite-claim@1":
      if (invitation === null) {
        throw new Error("Invitation claim is missing its authority snapshot");
      }
      return decideClaimWorkspaceInvitationV2(
        current,
        command,
        invitation.role,
        context,
      );
  }
}

function decideWorkspaceReduction(
  current: Workspace,
  command: WorkspaceCommand,
  context: { workspaceId: string; cursor: number; now: Date },
): { nextState: Workspace; event: UnsignedNostrEvent } {
  switch (command.contract) {
    case "workspace.member-set-role@1":
      return decideSetWorkspaceMemberRole(current, command, context);
    case "workspace.member-remove@1":
      return decideRemoveWorkspaceMember(current, command, context);
    default:
      throw new Error("Workspace pending overlay is not a reduction");
  }
}

function validWorkspaceMutationAuthorization(
  authorization: WorkspaceMutationAuthorization,
  actorPunkId: string,
): boolean {
  return (
    typeof authorization === "object" &&
    authorization !== null &&
    Object.keys(authorization).sort().join(",") === "punkId,sessionId" &&
    UUID.test(authorization.sessionId) &&
    UUID.test(authorization.punkId) &&
    authorization.punkId === actorPunkId
  );
}

function parsePendingAuthorization(
  pending: PendingRow,
): WorkspaceMutationAuthorization | null | undefined {
  if (
    pending.authorization_session_id === null &&
    pending.authorization_punk_id === null
  ) {
    return null;
  }
  if (
    typeof pending.authorization_session_id !== "string" ||
    typeof pending.authorization_punk_id !== "string"
  ) {
    return undefined;
  }
  const authorization = {
    sessionId: pending.authorization_session_id,
    punkId: pending.authorization_punk_id,
  };
  return validWorkspaceMutationAuthorization(
    authorization,
    authorization.punkId,
  )
    ? authorization
    : undefined;
}

function randomInvitationCode(workspaceId: string): string {
  if (!UUID.test(workspaceId)) {
    throw new Error("Invitation authority requires a Workspace UUID");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const secret = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return `${workspaceId}.${secret}`;
}

function invitationStatus(
  row: InvitationRow,
  now: Date,
): WorkspaceInvitationView["status"] {
  if (row.status === "revoked") return "revoked";
  if (Date.parse(String(row.expires_at)) <= now.getTime()) return "expired";
  if (Number(row.uses) >= Number(row.max_uses)) return "exhausted";
  return "issued";
}

function workspaceInvitationView(
  row: InvitationRow,
  workspace: Workspace,
  now: Date,
): WorkspaceInvitationView {
  return {
    contract: "workspace.invitation@1",
    invitationId: String(row.invitation_id),
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
    },
    workspaceRevision: workspace.revision,
    role: row.role as "member" | "guest",
    status: invitationStatus(row, now),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
    maxUses: Number(row.max_uses),
    uses: Number(row.uses),
    usesRemaining: Math.max(0, Number(row.max_uses) - Number(row.uses)),
  };
}

function pendingInvitationClaim(
  row: InvitationRow,
): PendingInvitationClaim | null {
  if (
    typeof row.invitation_id !== "string" ||
    !UUID.test(row.invitation_id) ||
    typeof row.code_hash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(row.code_hash) ||
    (row.role !== "member" && row.role !== "guest") ||
    typeof row.expires_at !== "string" ||
    Number.isNaN(Date.parse(row.expires_at)) ||
    !Number.isSafeInteger(Number(row.max_uses)) ||
    !Number.isSafeInteger(Number(row.uses)) ||
    !Number.isSafeInteger(Number(row.version))
  ) {
    return null;
  }
  return {
    invitationId: row.invitation_id,
    codeHash: row.code_hash,
    role: row.role,
    expiresAt: row.expires_at,
    maxUses: Number(row.max_uses),
    uses: Number(row.uses),
    version: Number(row.version),
  };
}

function parsePendingInvitation(
  value: string | number | null,
): PendingInvitationClaim | null {
  if (typeof value !== "string") return null;
  const parsed = parseJson(value);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.keys(parsed).sort().join(",") !==
      "codeHash,expiresAt,invitationId,maxUses,role,uses,version"
  ) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  return pendingInvitationClaim({
    invitation_id: record.invitationId as string,
    code_hash: record.codeHash as string,
    role: record.role as string,
    issuer_punk_id: "",
    issued_at: "",
    expires_at: record.expiresAt as string,
    revoked_at: null,
    status: "issued",
    max_uses: record.maxUses as number,
    uses: record.uses as number,
    version: record.version as number,
  });
}

function invitationMatchesPending(
  row: InvitationRow,
  pending: PendingInvitationClaim,
): boolean {
  return (
    row.invitation_id === pending.invitationId &&
    row.code_hash === pending.codeHash &&
    row.role === pending.role &&
    row.expires_at === pending.expiresAt &&
    Number(row.max_uses) === pending.maxUses &&
    Number(row.uses) === pending.uses &&
    Number(row.version) === pending.version
  );
}

function claimLiabilityDelta(pending: PendingInvitationClaim | null): number {
  return pending !== null && pending.uses + 1 >= pending.maxUses ? -1 : 0;
}

function workspaceInvitationClaimResponse(
  workspace: Workspace,
  role: WorkspaceRole,
  result: ClaimWorkspaceInvitationResponse["result"],
  replayed: boolean,
): ClaimWorkspaceInvitationResponse {
  return {
    contract: "workspace.invite-claim-response@1",
    result,
    workspace: {
      id: workspace.id,
      slug: workspace.slug,
      name: workspace.name,
      visibility: workspace.visibility,
      role,
      revision: workspace.revision,
    },
    replayed,
  };
}

function claimResponseFromStored(
  responseJson: string,
  punkId: string,
  replayed: boolean,
): ClaimWorkspaceInvitationResponse | null {
  const parsed = parseJson(responseJson);
  if (
    validateContract(
      "punks://contracts/workspace.invite-claim-response@1",
      parsed,
    ).valid
  ) {
    return {
      ...(parsed as ClaimWorkspaceInvitationResponse),
      replayed,
    };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("state" in parsed) ||
    !validateContract(
      "punks://contracts/workspace@1",
      Reflect.get(parsed, "state"),
    ).valid
  ) {
    return null;
  }
  const workspace = Reflect.get(parsed, "state") as Workspace;
  const membership = workspace.members.find(
    (member) => member.punkId === punkId,
  );
  return membership === undefined
    ? null
    : workspaceInvitationClaimResponse(
        workspace,
        membership.role as WorkspaceRole,
        "joined",
        replayed,
      );
}

function isWorkspaceInvitationFailureCode(
  code: Exclude<WorkspaceExecuteResult, { ok: true }>["code"],
): code is WorkspaceInvitationFailureCode {
  return code !== "invalid_transition";
}

function invitationClaimExecutionResult(
  execution: WorkspaceExecuteResult,
  punkId: string,
): WorkspaceInvitationClaimResult {
  if (!execution.ok) {
    return isWorkspaceInvitationFailureCode(execution.code)
      ? { ok: false, code: execution.code }
      : { ok: false, code: "revision_conflict" };
  }
  const response = claimResponseFromStored(
    JSON.stringify(execution.value),
    punkId,
    execution.replayed,
  );
  return response === null
    ? { ok: false, code: "internal" }
    : { ok: true, response };
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}
