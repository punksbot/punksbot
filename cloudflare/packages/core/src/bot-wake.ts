import type {
  BotWakeOffer,
  BotWakeQueueBody,
  BotWakeTerminalReceiptArchive,
  CompleteBotWakeCommand,
  RuntimeReleaseRef,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import { isKnownBotRuntimeRelease } from "./bot-runtime-release";
import { deriveBotActionAdmissionId } from "./bot-installation";
import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "./json";

/** Maximum canonical UTF-8 size accepted for one terminal completion. */
export const BOT_WAKE_COMPLETE_MAX_BYTES = 512;
/** Maximum canonical UTF-8 size accepted for one authoritative offer. */
export const BOT_WAKE_OFFER_MAX_BYTES = 2_048;
/** Maximum canonical UTF-8 size accepted for the opaque Queue body. */
export const BOT_WAKE_QUEUE_BODY_MAX_BYTES = 256;
/** Maximum canonical UTF-8 size accepted for one terminal cold receipt. */
export const BOT_WAKE_RECEIPT_MAX_BYTES = 4_096;

const WAKE_ID_NAMESPACE = "punks.bot-wake.id.v1";
const WORKFLOW_ID_NAMESPACE = "punks.bot-wake.workflow-id.v1";
const TURN_ID_NAMESPACE = "punks.bot-wake.turn-id.v1";
const ACTION_ID_NAMESPACE = "punks.bot-wake.action-id.v1";

/** Coordinates that uniquely identify one Message Wake for an Installation. */
export interface BotWakeIdentityCoordinates {
  installationId: string;
  subscriptionEpoch: number;
  messageId: string;
  messageCursor: number;
}

/** Authority-owned fields used to prepare an immutable Wake offer. */
export interface BotWakeOfferInput extends BotWakeIdentityCoordinates {
  workspaceId: string;
  botId: string;
  conversationId: string;
  runtimeRelease: RuntimeReleaseRef;
  sourceEventId: string;
  sourceEventDigest: string;
  createdAt: Date;
}

/** Authority timestamps and inputs used to seal one terminal Wake receipt. */
export interface BotWakeTerminalReceiptInput {
  offer: BotWakeOffer;
  completion: CompleteBotWakeCommand;
  claimedAt: Date;
  completedAt: Date;
}

function canonicalUtf8Length(value: unknown): number {
  return new TextEncoder().encode(canonicalJson(value)).byteLength;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

/** Derives the stable UUIDv8 Wake identity from only its required coordinates. */
export function deriveBotWakeId(
  coordinates: BotWakeIdentityCoordinates,
): Promise<string> {
  return deriveOpaqueUuid(
    WAKE_ID_NAMESPACE,
    canonicalJson({
      installationId: coordinates.installationId,
      messageCursor: coordinates.messageCursor,
      messageId: coordinates.messageId,
      subscriptionEpoch: coordinates.subscriptionEpoch,
    }),
  );
}

/** Derives the stable UUIDv8 Cloudflare Workflow identity for one Wake. */
export function deriveBotWakeWorkflowId(wakeId: string): Promise<string> {
  return deriveOpaqueUuid(WORKFLOW_ID_NAMESPACE, wakeId);
}

/** Derives the stable UUIDv8 Turn identity for one Wake. */
export function deriveBotWakeTurnId(wakeId: string): Promise<string> {
  return deriveOpaqueUuid(TURN_ID_NAMESPACE, wakeId);
}

/** Derives the stable UUIDv8 Bot Action identity for one Wake. */
export function deriveBotWakeActionId(wakeId: string): Promise<string> {
  return deriveOpaqueUuid(ACTION_ID_NAMESPACE, wakeId);
}

/** Prepares one canonical offer and rejects unknown releases or coordinates. */
export async function prepareBotWakeOffer(
  input: BotWakeOfferInput,
): Promise<BotWakeOffer> {
  if (
    !(input.createdAt instanceof Date) ||
    !Number.isFinite(input.createdAt.getTime()) ||
    !isKnownBotRuntimeRelease(input.runtimeRelease)
  ) {
    throw new TypeError("Bot Wake offer input is not canonical");
  }
  const wakeId = await deriveBotWakeId(input);
  const offer: BotWakeOffer = {
    contract: "bot-wake.offer@1",
    wakeId,
    workspaceId: input.workspaceId,
    installationId: input.installationId,
    botId: input.botId,
    conversationId: input.conversationId,
    messageId: input.messageId,
    messageCursor: input.messageCursor,
    subscriptionEpoch: input.subscriptionEpoch,
    runtimeRelease: { ...input.runtimeRelease },
    sourceEventId: input.sourceEventId,
    sourceEventDigest: input.sourceEventDigest,
    createdAt: input.createdAt.toISOString(),
  };
  if (!(await validateBotWakeOffer(offer))) {
    throw new TypeError("Bot Wake offer input is invalid");
  }
  return offer;
}

/** Checks structural and semantic integrity of an untrusted Wake offer. */
export async function validateBotWakeOffer(value: unknown): Promise<boolean> {
  if (
    !validateContract("punks://contracts/bot-wake.offer@1", value).valid ||
    value === null ||
    typeof value !== "object"
  ) {
    return false;
  }
  const offer = value as BotWakeOffer;
  if (
    !isKnownBotRuntimeRelease(offer.runtimeRelease) ||
    !isCanonicalTimestamp(offer.createdAt) ||
    canonicalUtf8Length(offer) > BOT_WAKE_OFFER_MAX_BYTES
  ) {
    return false;
  }
  const expectedWakeId = await deriveBotWakeId({
    installationId: offer.installationId,
    subscriptionEpoch: offer.subscriptionEpoch,
    messageId: offer.messageId,
    messageCursor: offer.messageCursor,
  });
  return offer.wakeId === expectedWakeId;
}

/** Narrows a validated offer to the exact opaque two-field Queue body. */
export function botWakeQueueBody(offer: BotWakeOffer): BotWakeQueueBody {
  const body: BotWakeQueueBody = {
    installationId: offer.installationId,
    wakeId: offer.wakeId,
  };
  if (canonicalUtf8Length(body) > BOT_WAKE_QUEUE_BODY_MAX_BYTES) {
    throw new TypeError("Bot Wake Queue body exceeds its UTF-8 bound");
  }
  return body;
}

/** Hashes the canonical JSON encoding of an authoritative Wake offer. */
export function deriveBotWakeOfferDigest(offer: BotWakeOffer): Promise<string> {
  return sha256Hex(canonicalJson(offer));
}

/** Checks a terminal completion against the offer's stable identities. */
export async function validateBotWakeCompletion(
  offer: BotWakeOffer,
  value: unknown,
): Promise<boolean> {
  if (
    !(await validateBotWakeOffer(offer)) ||
    !validateContract("punks://contracts/bot-wake.complete@1", value).valid ||
    value === null ||
    typeof value !== "object" ||
    canonicalUtf8Length(value) > BOT_WAKE_COMPLETE_MAX_BYTES
  ) {
    return false;
  }
  const completion = value as CompleteBotWakeCommand;
  if (
    completion.installationId !== offer.installationId ||
    completion.wakeId !== offer.wakeId ||
    completion.turnId !== (await deriveBotWakeTurnId(offer.wakeId))
  ) {
    return false;
  }
  if (
    completion.terminal.outcome !== "succeeded" ||
    completion.terminal.decision !== "react"
  ) {
    return true;
  }
  const expectedActionId = await deriveBotWakeActionId(offer.wakeId);
  if (completion.terminal.actionId !== expectedActionId) {
    return false;
  }
  return (
    completion.terminal.admissionId ===
    (await deriveBotActionAdmissionId(offer.installationId, expectedActionId))
  );
}

/** Seals a validated terminal transition into a self-contained cold receipt. */
export async function prepareBotWakeTerminalReceipt(
  input: BotWakeTerminalReceiptInput,
): Promise<BotWakeTerminalReceiptArchive> {
  if (
    !(input.claimedAt instanceof Date) ||
    !Number.isFinite(input.claimedAt.getTime()) ||
    !(input.completedAt instanceof Date) ||
    !Number.isFinite(input.completedAt.getTime()) ||
    input.claimedAt.getTime() < new Date(input.offer.createdAt).getTime() ||
    input.completedAt.getTime() < input.claimedAt.getTime() ||
    !(await validateBotWakeCompletion(input.offer, input.completion))
  ) {
    throw new TypeError("Bot Wake terminal transition is invalid");
  }
  const receipt: BotWakeTerminalReceiptArchive = {
    schemaVersion: 1,
    offer: input.offer,
    turnId: input.completion.turnId,
    claimedAt: input.claimedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
    terminal: { ...input.completion.terminal },
  };
  if (!(await validateBotWakeTerminalReceipt(receipt))) {
    throw new TypeError("Bot Wake terminal receipt is invalid");
  }
  return receipt;
}

/** Checks structural, identity, release, time, and UTF-8 receipt invariants. */
export async function validateBotWakeTerminalReceipt(
  value: unknown,
): Promise<boolean> {
  if (
    !validateContract("punks://contracts/bot-wake.receipt-archive@1", value)
      .valid ||
    value === null ||
    typeof value !== "object" ||
    canonicalUtf8Length(value) > BOT_WAKE_RECEIPT_MAX_BYTES
  ) {
    return false;
  }
  const receipt = value as BotWakeTerminalReceiptArchive;
  if (
    !isCanonicalTimestamp(receipt.claimedAt) ||
    !isCanonicalTimestamp(receipt.completedAt) ||
    new Date(receipt.claimedAt).getTime() <
      new Date(receipt.offer.createdAt).getTime() ||
    new Date(receipt.completedAt).getTime() <
      new Date(receipt.claimedAt).getTime()
  ) {
    return false;
  }
  return validateBotWakeCompletion(receipt.offer as BotWakeOffer, {
    contract: "bot-wake.complete@1",
    installationId: receipt.offer.installationId,
    wakeId: receipt.offer.wakeId,
    turnId: receipt.turnId,
    terminal: receipt.terminal,
  });
}

/** Hashes the canonical JSON encoding of a terminal Wake receipt. */
export function deriveBotWakeReceiptDigest(
  receipt: BotWakeTerminalReceiptArchive,
): Promise<string> {
  return sha256Hex(canonicalJson(receipt));
}
