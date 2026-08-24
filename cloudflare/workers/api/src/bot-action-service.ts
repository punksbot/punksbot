import type {
  AdmitBotActionCommand,
  BotActionAdmission,
  ExecuteBotActionCommand,
  ExecuteBotActionResult,
  SignedNostrEvent,
  VerifyBotInvocationCredentialResult,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  deriveBotActionAdmissionId,
  deriveBotActionDigest,
  deriveOpaqueUuid,
} from "@punks/core";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import { verifyAttestation } from "./attestation-verification";
import type {
  BotActionAdmissionResult,
  ExecuteAdmittedBotReactionResult,
} from "./rpc";

type BotRuntimeProps = {
  role: "punks-bot-runtime";
  environment: "local" | "staging" | "production";
};
type ActionFailureCode = Extract<ExecuteBotActionResult, { ok: false }>["code"];

const opaqueUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const actionFailureCodes = new Set<ActionFailureCode>([
  "invalid_request",
  "invalid_credential",
  "idempotency_conflict",
  "command_in_progress",
  "not_found",
  "forbidden",
  "invalid_transition",
  "conflict",
  "admission_limit",
  "attestation_failed",
  "temporarily_unavailable",
  "internal",
]);
/** Private, statically-bound Punks runtime seam for admitted Bot actions. */
export class BotActionService extends WorkerEntrypoint<
  ApiEnv,
  BotRuntimeProps
> {
  async executeBotAction(input: unknown): Promise<ExecuteBotActionResult> {
    if (!this.hasExactRuntimeProps()) {
      return { ok: false, code: "forbidden" };
    }
    if (
      !validateContract("punks://contracts/bot-action.execute@1", input).valid
    ) {
      return { ok: false, code: "invalid_request" };
    }
    const command = input as ExecuteBotActionCommand;
    let verified: unknown;
    try {
      verified = await this.env.BOT_INVOCATION_VERIFIER.verifyBotInvocation({
        contract: "bot-invocation.verify@1",
        credential: command.credential,
        invocationId: command.invocationId,
        workspaceId: command.workspaceId,
        installationId: command.installationId,
        botId: command.botId,
        authorityGeneration: command.authorityGeneration,
      });
    } catch {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (
      !validateContract(
        "punks://contracts/bot-invocation.verify-result@1",
        verified,
      ).valid
    ) {
      return { ok: false, code: "invalid_credential" };
    }
    const verification = verified as VerifyBotInvocationCredentialResult;
    if (!verification.ok) {
      return { ok: false, code: "invalid_credential" };
    }
    const principal = verification.principal;
    if (
      principal.environment !== this.env.ENVIRONMENT ||
      principal.environment !== this.ctx.props.environment ||
      principal.invocationId !== command.invocationId ||
      principal.workspaceId !== command.workspaceId ||
      principal.installationId !== command.installationId ||
      principal.botId !== command.botId ||
      principal.authorityGeneration !== command.authorityGeneration
    ) {
      return { ok: false, code: "invalid_credential" };
    }
    const now = Math.floor(Date.now() / 1_000);
    if (
      principal.notBefore > principal.issuedAt ||
      principal.issuedAt > principal.expiresAt ||
      principal.expiresAt - principal.issuedAt > 60 ||
      now < principal.notBefore ||
      now >= principal.expiresAt
    ) {
      return { ok: false, code: "invalid_credential" };
    }

    const admissionCommandId = await deriveOpaqueUuid(
      "punks.bot-action-admit-command.v1",
      `${command.installationId}\u0000${command.actionId}`,
    );
    let result: BotActionAdmissionResult;
    try {
      const rawResult: unknown = await this.env.BOT_INSTALLATIONS.getByName(
        command.installationId,
      ).admitBotAction({
        command,
        credential: {
          jti: principal.jti,
          issuedAt: principal.issuedAt,
          notBefore: principal.notBefore,
          expiresAt: principal.expiresAt,
        },
        admissionCommandId,
      });
      const validated = await validateAdmissionRpcResult(
        rawResult,
        command,
        admissionCommandId,
        this.env,
      );
      if (validated === null) {
        return { ok: false, code: "temporarily_unavailable" };
      }
      result = validated;
    } catch {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (result.ok === false) {
      return result;
    }
    if (
      result.admission.status === "completed" &&
      result.admission.outcome === "failed"
    ) {
      return { ok: false, code: "forbidden" };
    }
    if (
      result.admission.status !== "completed" ||
      result.admission.outcome === "succeeded"
    ) {
      const reactionCommandId = await deriveOpaqueUuid(
        "punks.bot-reaction-command.v1",
        `${result.admissionId}\u0000${command.actionId}`,
      );
      const completionCommandId = await deriveOpaqueUuid(
        "punks.bot-action-completion-command.v1",
        `${result.admissionId}\u0000succeeded`,
      );
      const failureCompletionCommandId = await deriveOpaqueUuid(
        "punks.bot-action-completion-command.v1",
        `${result.admissionId}\u0000failed`,
      );
      let reaction: ExecuteAdmittedBotReactionResult;
      try {
        const rawReaction: unknown = await this.env.CONVERSATIONS.getByName(
          command.action.conversationId,
        ).executeBotReaction({
          contract: "bot-action.delivery@1",
          workspaceId: command.workspaceId,
          installationId: command.installationId,
          botId: command.botId,
          actionId: command.actionId,
          actionDigest: result.admission.actionDigest,
          authorityGeneration: command.authorityGeneration,
          admissionId: result.admissionId,
          proof: result.proof,
          action: command.action,
          reactionCommandId,
          completionCommandId,
          failureCompletionCommandId,
        });
        const validated = validateReactionRpcResult(rawReaction);
        if (validated === null) {
          return { ok: false, code: "temporarily_unavailable" };
        }
        reaction = validated;
      } catch {
        return { ok: false, code: "temporarily_unavailable" };
      }
      if (reaction.ok === false) {
        return { ok: false, code: reaction.code };
      }
    }
    return {
      ok: true,
      admissionId: result.admissionId,
      replayed: result.replayed,
    };
  }

  private hasExactRuntimeProps(): boolean {
    const props: unknown = this.ctx.props;
    if (props === null || typeof props !== "object" || Array.isArray(props)) {
      return false;
    }
    const record = props as Record<string, unknown>;
    return (
      Object.keys(record).sort().join(",") === "environment,role" &&
      record.role === "punks-bot-runtime" &&
      record.environment === this.env.ENVIRONMENT
    );
  }
}

async function validateAdmissionRpcResult(
  value: unknown,
  command: ExecuteBotActionCommand,
  admissionCommandId: string,
  env: ApiEnv,
): Promise<BotActionAdmissionResult | null> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  if (!value.ok) {
    return hasExactKeys(value, ["code", "ok"]) &&
      typeof value.code === "string" &&
      actionFailureCodes.has(value.code as ActionFailureCode)
      ? (value as Extract<BotActionAdmissionResult, { ok: false }>)
      : null;
  }
  if (
    !hasExactKeys(value, [
      "admission",
      "admissionId",
      "ok",
      "proof",
      "replayed",
    ]) ||
    typeof value.admissionId !== "string" ||
    !opaqueUuidPattern.test(value.admissionId) ||
    typeof value.replayed !== "boolean" ||
    !isExactAdmission(value.admission) ||
    !isExactSignedEvent(value.proof)
  ) {
    return null;
  }
  const admission = value.admission;
  const proof = value.proof;
  const proofAdmission = admissionFromProof(proof);
  const admittedCommand: AdmitBotActionCommand = {
    contract: "bot-action.admit@1",
    commandId: admissionCommandId,
    actionId: command.actionId,
    workspaceId: command.workspaceId,
    installationId: command.installationId,
    actor: { kind: "bot", installationId: command.installationId },
    action: command.action,
  };
  const exactDigest = await deriveBotActionDigest(admittedCommand);
  const exactAdmissionId = await deriveBotActionAdmissionId(
    command.installationId,
    command.actionId,
  );
  if (
    proofAdmission === null ||
    admission.id !== value.admissionId ||
    value.admissionId !== exactAdmissionId ||
    admission.actionDigest !== exactDigest ||
    proofAdmission.actionDigest !== exactDigest ||
    !admissionMatchesCommand(admission, command) ||
    !admissionMatchesCommand(proofAdmission, command) ||
    !admissionTransitionMatchesProof(admission, proofAdmission) ||
    proofAdmission.status !== "admitted" ||
    proofAdmission.risk !== "routine" ||
    proofAdmission.installationCursor !== proofAdmission.admittedCursor ||
    proofAdmission.outcome !== null ||
    proofAdmission.completedCursor !== null ||
    proofAdmission.completedAt !== null ||
    !Number.isFinite(Date.parse(proofAdmission.admittedAt)) ||
    Math.floor(Date.parse(proofAdmission.admittedAt) / 1_000) !==
      proof.created_at ||
    proof.kind !== 50320 ||
    proof.content !==
      canonicalJson({ schemaVersion: 1, admission: proofAdmission }) ||
    !proofTagsMatch(
      proof,
      proofAdmission,
      command,
      admissionCommandId,
      value.admissionId,
    ) ||
    !(await verifyAttestation(proof, env))
  ) {
    return null;
  }
  return value as unknown as Extract<BotActionAdmissionResult, { ok: true }>;
}

function admissionTransitionMatchesProof(
  admission: BotActionAdmission,
  proofAdmission: BotActionAdmission,
): boolean {
  const {
    status: _proofStatus,
    outcome: _proofOutcome,
    completedCursor: _proofCompletedCursor,
    completedAt: _proofCompletedAt,
    ...proofImmutable
  } = proofAdmission;
  const {
    status: _status,
    outcome: _outcome,
    completedCursor: _completedCursor,
    completedAt: _completedAt,
    ...immutable
  } = admission;
  if (canonicalJson(immutable) !== canonicalJson(proofImmutable)) {
    return false;
  }
  return admission.status === "admitted"
    ? canonicalJson(admission) === canonicalJson(proofAdmission)
    : admission.status === "completed" &&
        (admission.outcome === "succeeded" || admission.outcome === "failed") &&
        admission.completedCursor !== null &&
        admission.completedAt !== null;
}

function validateReactionRpcResult(
  value: unknown,
): ExecuteAdmittedBotReactionResult | null {
  return validateContract(
    "punks://contracts/bot-action.delivery-result@1",
    value,
  ).valid
    ? (value as ExecuteAdmittedBotReactionResult)
    : null;
}

function admissionFromProof(
  event: SignedNostrEvent,
): BotActionAdmission | null {
  let content: unknown;
  try {
    content = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (
    !isRecord(content) ||
    !hasExactKeys(content, ["admission", "schemaVersion"]) ||
    content.schemaVersion !== 1 ||
    !isExactAdmission(content.admission)
  ) {
    return null;
  }
  return content.admission;
}

function isExactAdmission(value: unknown): value is BotActionAdmission {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "actionContract",
      "actionDigest",
      "actionId",
      "admittedAt",
      "admittedCursor",
      "authorityGeneration",
      "botId",
      "capability",
      "completedAt",
      "completedCursor",
      "id",
      "installationCursor",
      "installationId",
      "outcome",
      "resource",
      "risk",
      "status",
      "workspaceId",
    ]) &&
    validateContract("punks://contracts/bot-action.admission@1", value).valid &&
    opaqueUuidPattern.test(String(value.id)) &&
    opaqueUuidPattern.test(String(value.actionId)) &&
    opaqueUuidPattern.test(String(value.workspaceId)) &&
    opaqueUuidPattern.test(String(value.installationId)) &&
    opaqueUuidPattern.test(String(value.botId)) &&
    /^[0-9a-f]{64}$/.test(String(value.actionDigest)) &&
    isRecord(value.resource) &&
    hasExactKeys(value.resource, ["conversationId", "kind", "messageId"]) &&
    opaqueUuidPattern.test(String(value.resource.conversationId)) &&
    opaqueUuidPattern.test(String(value.resource.messageId))
  );
}

function admissionMatchesCommand(
  admission: BotActionAdmission,
  command: ExecuteBotActionCommand,
): boolean {
  return (
    admission.actionId === command.actionId &&
    admission.workspaceId === command.workspaceId &&
    admission.installationId === command.installationId &&
    admission.botId === command.botId &&
    admission.authorityGeneration === command.authorityGeneration &&
    admission.actionContract === command.action.contract &&
    admission.capability === "messages.react" &&
    admission.resource.kind === "message" &&
    admission.resource.conversationId === command.action.conversationId &&
    admission.resource.messageId === command.action.messageId
  );
}

function proofTagsMatch(
  proof: SignedNostrEvent,
  admission: BotActionAdmission,
  command: ExecuteBotActionCommand,
  admissionCommandId: string,
  admissionId: string,
): boolean {
  const expectedTags = [
    ["workspace", command.workspaceId],
    ["installation", command.installationId],
    ["bot", command.botId],
    ["cursor", String(admission.admittedCursor)],
    ["command", admissionCommandId],
    ["contract", "bot-action.admit@1"],
    ["actor", "bot", command.installationId],
    ["admission", admissionId],
    ["action", command.actionId, admission.actionDigest],
    ["action_contract", command.action.contract],
    ["capability", "messages.react"],
    ["conversation", command.action.conversationId],
    ["message", command.action.messageId],
  ];
  return (
    proof.tags.length === expectedTags.length + 1 &&
    expectedTags.every(
      (tag, index) => canonicalJson(proof.tags[index]) === canonicalJson(tag),
    ) &&
    proof.tags.at(-1)?.length === 2 &&
    proof.tags.at(-1)?.[0] === "attestation"
  );
}

function isExactSignedEvent(value: unknown): value is SignedNostrEvent {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "content",
      "created_at",
      "id",
      "kind",
      "pubkey",
      "sig",
      "tags",
    ]) &&
    validateContract("punks://contracts/nostr.signed-event@1", value).valid
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
