import type {
  BotWakeOffer,
  ClaimBotWakeCommand,
  ClaimBotWakeResult,
  CompleteBotWakeCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { canonicalJson, sha256Hex } from "@punks/core";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import type {
  OfferBotWakeResult,
  ReadBotWakeContextRequest,
  ReadBotWakeContextResult,
} from "./rpc";

type BotRuntimeProps = {
  role: "punks-bot-runtime";
  environment: "local" | "staging" | "production";
};

type BotWakeTriggerProps = {
  role: "punks-bot-wake-trigger";
  environment: "local" | "staging" | "production";
};

interface BotWakeTriggerRequest {
  installationId: string;
  conversationId: string;
  messageId: string;
}

type WakeContextFailureCode =
  | "invalid_request"
  | "forbidden"
  | "not_found"
  | "authority_revoked"
  | "content_unavailable"
  | "temporarily_unavailable"
  | "internal";

export type BotWakeContextResult =
  | { ok: true; content: string }
  | { ok: false; code: WakeContextFailureCode };

interface WakeContextRequest {
  installationId: string;
  wakeId: string;
  turnId: string;
}

type BotWakeContextProof = ReadBotWakeContextRequest;

type InstallationAuthorization =
  | { ok: true; proof: BotWakeContextProof }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "authority_revoked"
        | "temporarily_unavailable"
        | "internal";
    };

const opaqueUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hexDigestPattern = /^[0-9a-f]{64}$/;
const maximumWakeContextBytes = 8_192;
const authorizationFailureCodes = new Set<
  Extract<InstallationAuthorization, { ok: false }>["code"]
>([
  "invalid_request",
  "not_found",
  "authority_revoked",
  "temporarily_unavailable",
  "internal",
]);
type ConversationFailureCode = Extract<
  ReadBotWakeContextResult,
  { ok: false }
>["code"];
const conversationFailureCodes = new Set<ConversationFailureCode>([
  "invalid_request",
  "not_found",
  "authority_revoked",
  "content_unavailable",
  "temporarily_unavailable",
  "internal",
]);
const offerFailureCodes = new Set<
  Extract<OfferBotWakeResult, { ok: false }>["code"]
>([
  "invalid_request",
  "not_found",
  "forbidden",
  "conflict",
  "temporarily_unavailable",
  "internal",
]);

/** Private, statically-bound runtime seam for one opaque Bot Wake. */
export class BotHarnessService extends WorkerEntrypoint<
  ApiEnv,
  BotRuntimeProps
> {
  async claimWake(input: unknown): Promise<ClaimBotWakeResult> {
    if (!hasExactRuntimeProps(this.ctx.props, this.env.ENVIRONMENT)) {
      return claimFailure("authority_revoked");
    }
    if (!validateContract("punks://contracts/bot-wake.claim@1", input).valid) {
      return claimFailure("invalid_request");
    }
    const command = input as ClaimBotWakeCommand;
    try {
      const result: unknown = await this.env.BOT_INSTALLATIONS.getByName(
        command.installationId,
      ).claimBotWake(command);
      return validateContract(
        "punks://contracts/bot-wake.claim-result@1",
        result,
      ).valid
        ? (result as ClaimBotWakeResult)
        : claimFailure("temporarily_unavailable");
    } catch {
      return claimFailure("temporarily_unavailable");
    }
  }

  async completeWake(input: unknown): Promise<ClaimBotWakeResult> {
    if (!hasExactRuntimeProps(this.ctx.props, this.env.ENVIRONMENT)) {
      return claimFailure("authority_revoked");
    }
    if (
      !validateContract("punks://contracts/bot-wake.complete@1", input).valid
    ) {
      return claimFailure("invalid_request");
    }
    const command = input as CompleteBotWakeCommand;
    try {
      const result: unknown = await this.env.BOT_INSTALLATIONS.getByName(
        command.installationId,
      ).completeBotWake(command);
      return validateContract(
        "punks://contracts/bot-wake.claim-result@1",
        result,
      ).valid
        ? (result as ClaimBotWakeResult)
        : claimFailure("temporarily_unavailable");
    } catch {
      return claimFailure("temporarily_unavailable");
    }
  }

  async readWakeContext(input: unknown): Promise<BotWakeContextResult> {
    if (!hasExactRuntimeProps(this.ctx.props, this.env.ENVIRONMENT)) {
      return contextFailure("forbidden");
    }
    if (!isWakeContextRequest(input)) {
      return contextFailure("invalid_request");
    }
    try {
      const installation = this.env.BOT_INSTALLATIONS.getByName(
        input.installationId,
      );
      const initialAuthorization = await validateInstallationAuthorization(
        await installation.authorizeBotWakeContext(input),
        input,
      );
      if (!initialAuthorization.ok) {
        return contextFailure(initialAuthorization.code);
      }
      const conversation = this.env.CONVERSATIONS.getByName(
        initialAuthorization.proof.offer.conversationId,
      );
      const context = exactConversationContextResult(
        await conversation.readBotWakeContext(initialAuthorization.proof),
      );
      if (!context.ok) {
        return contextFailure(context.code);
      }
      const finalAuthorization = await validateInstallationAuthorization(
        await installation.authorizeBotWakeContext(input),
        input,
      );
      if (!finalAuthorization.ok) {
        return contextFailure(finalAuthorization.code);
      }
      if (
        canonicalJson(initialAuthorization.proof) !==
        canonicalJson(finalAuthorization.proof)
      ) {
        return contextFailure("authority_revoked");
      }
      if (
        new TextEncoder().encode(context.content).byteLength >
        maximumWakeContextBytes
      ) {
        return contextFailure("content_unavailable");
      }
      return { ok: true, content: context.content };
    } catch {
      return contextFailure("temporarily_unavailable");
    }
  }

  override fetch(): Response {
    return new Response(null, { status: 404 });
  }
}

/** Private known-Installation seam for offering one Message Wake. */
export class BotWakeTriggerService extends WorkerEntrypoint<
  ApiEnv,
  BotWakeTriggerProps
> {
  async offerWake(input: unknown): Promise<OfferBotWakeResult> {
    if (!hasExactTriggerProps(this.ctx.props, this.env.ENVIRONMENT)) {
      return { ok: false, code: "forbidden" };
    }
    if (!isBotWakeTriggerRequest(input)) {
      return { ok: false, code: "invalid_request" };
    }
    try {
      const result = exactOfferBotWakeResult(
        await this.env.CONVERSATIONS.getByName(
          input.conversationId,
        ).offerBotWake({
          installationId: input.installationId,
          messageId: input.messageId,
        }),
      );
      return result ?? { ok: false, code: "temporarily_unavailable" };
    } catch {
      return { ok: false, code: "temporarily_unavailable" };
    }
  }

  override fetch(): Response {
    return new Response(null, { status: 404 });
  }
}

function exactOfferBotWakeResult(value: unknown): OfferBotWakeResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return null;
  }
  if (value.ok) {
    return hasExactKeys(value, ["ok", "wakeId"]) &&
      typeof value.wakeId === "string" &&
      opaqueUuidPattern.test(value.wakeId)
      ? (value as Extract<OfferBotWakeResult, { ok: true }>)
      : null;
  }
  return hasExactKeys(value, ["code", "ok"]) &&
    typeof value.code === "string" &&
    offerFailureCodes.has(
      value.code as Extract<OfferBotWakeResult, { ok: false }>["code"],
    )
    ? (value as Extract<OfferBotWakeResult, { ok: false }>)
    : null;
}

async function validateInstallationAuthorization(
  value: unknown,
  request: WakeContextRequest,
): Promise<InstallationAuthorization> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return { ok: false, code: "temporarily_unavailable" };
  }
  if (!value.ok) {
    return hasExactKeys(value, ["code", "ok"]) &&
      typeof value.code === "string" &&
      authorizationFailureCodes.has(
        value.code as Extract<InstallationAuthorization, { ok: false }>["code"],
      )
      ? {
          ok: false,
          code: value.code as Extract<
            InstallationAuthorization,
            { ok: false }
          >["code"],
        }
      : { ok: false, code: "temporarily_unavailable" };
  }
  if (
    !hasExactKeys(value, [
      "authorityGeneration",
      "offer",
      "offerDigest",
      "ok",
      "turnId",
    ]) ||
    !validateContract("punks://contracts/bot-wake.offer@1", value.offer)
      .valid ||
    typeof value.turnId !== "string" ||
    !opaqueUuidPattern.test(value.turnId) ||
    !Number.isSafeInteger(value.authorityGeneration) ||
    Number(value.authorityGeneration) < 1 ||
    typeof value.offerDigest !== "string" ||
    !hexDigestPattern.test(value.offerDigest)
  ) {
    return { ok: false, code: "temporarily_unavailable" };
  }
  const offer = value.offer as BotWakeOffer;
  if (
    offer.installationId !== request.installationId ||
    offer.wakeId !== request.wakeId ||
    value.turnId !== request.turnId ||
    offer.subscriptionEpoch !== value.authorityGeneration ||
    value.offerDigest !== (await sha256Hex(canonicalJson(offer)))
  ) {
    return { ok: false, code: "authority_revoked" };
  }
  return {
    ok: true,
    proof: {
      installationId: request.installationId,
      wakeId: request.wakeId,
      turnId: request.turnId,
      authorityGeneration: value.authorityGeneration,
      offerDigest: value.offerDigest,
      offer,
    },
  };
}

function exactConversationContextResult(
  value: unknown,
): ReadBotWakeContextResult {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return conversationFailure("temporarily_unavailable");
  }
  if (value.ok) {
    return hasExactKeys(value, ["content", "ok"]) &&
      typeof value.content === "string"
      ? { ok: true, content: value.content }
      : conversationFailure("temporarily_unavailable");
  }
  return hasExactKeys(value, ["code", "ok"]) &&
    typeof value.code === "string" &&
    conversationFailureCodes.has(value.code as ConversationFailureCode)
    ? conversationFailure(value.code as ConversationFailureCode)
    : conversationFailure("temporarily_unavailable");
}

function isWakeContextRequest(value: unknown): value is WakeContextRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["installationId", "turnId", "wakeId"]) &&
    typeof value.installationId === "string" &&
    opaqueUuidPattern.test(value.installationId) &&
    typeof value.wakeId === "string" &&
    opaqueUuidPattern.test(value.wakeId) &&
    typeof value.turnId === "string" &&
    opaqueUuidPattern.test(value.turnId)
  );
}

function isBotWakeTriggerRequest(
  value: unknown,
): value is BotWakeTriggerRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["conversationId", "installationId", "messageId"]) &&
    typeof value.installationId === "string" &&
    opaqueUuidPattern.test(value.installationId) &&
    typeof value.conversationId === "string" &&
    opaqueUuidPattern.test(value.conversationId) &&
    typeof value.messageId === "string" &&
    opaqueUuidPattern.test(value.messageId)
  );
}

function hasExactRuntimeProps(
  props: unknown,
  environment: string,
): props is BotRuntimeProps {
  if (!isRecord(props) || !hasExactKeys(props, ["environment", "role"])) {
    return false;
  }
  return (
    props.role === "punks-bot-runtime" && props.environment === environment
  );
}

function hasExactTriggerProps(
  props: unknown,
  environment: string,
): props is BotWakeTriggerProps {
  if (!isRecord(props) || !hasExactKeys(props, ["environment", "role"])) {
    return false;
  }
  return (
    props.role === "punks-bot-wake-trigger" && props.environment === environment
  );
}

function claimFailure(
  code: Extract<ClaimBotWakeResult, { ok: false }>["code"],
): Extract<ClaimBotWakeResult, { ok: false }> {
  return { contract: "bot-wake.claim-result@1", ok: false, code };
}

function contextFailure(code: WakeContextFailureCode): BotWakeContextResult {
  return { ok: false, code };
}

function conversationFailure(
  code: ConversationFailureCode,
): Extract<ReadBotWakeContextResult, { ok: false }> {
  return { ok: false, code };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
