import type {
  Bot,
  BotCommandReceiptArchive,
  SignedNostrEvent,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { canonicalJson } from "@punks/core";

import {
  CommandReceiptArchiveError,
  commandReceiptCoordinate,
  prepareCommandReceiptArchive,
  type PreparedCommandReceiptArchive,
} from "./command-receipt-archive";
import type { CommittedBotCommand } from "./rpc";

type VerifyBotReceiptEvent = (event: SignedNostrEvent) => Promise<boolean>;

export async function prepareBotCommandReceipt(input: {
  botId: string;
  commandId: string;
  payloadHash: string;
  value: CommittedBotCommand;
  verifyEvent: VerifyBotReceiptEvent;
}): Promise<PreparedCommandReceiptArchive> {
  const archive: BotCommandReceiptArchive = {
    schemaVersion: 1,
    aggregate: "bot",
    botId: input.botId,
    commandId: input.commandId,
    payloadHash: input.payloadHash,
    terminal: {
      kind: "committed",
      value:
        input.value as unknown as BotCommandReceiptArchive["terminal"]["value"],
    },
  };
  await parseBotCommandReceiptArchive({
    value: archive,
    expectedBotId: input.botId,
    expectedCommandId: input.commandId,
    metadataPayloadHash: input.payloadHash,
    verifyEvent: input.verifyEvent,
  });
  const coordinate = await commandReceiptCoordinate({
    aggregate: "bot",
    aggregateId: input.botId,
    commandId: input.commandId,
  });
  return prepareCommandReceiptArchive(coordinate, input.payloadHash, archive);
}

export async function parseBotCommandReceiptArchive(input: {
  value: unknown;
  expectedBotId: string;
  expectedCommandId: string;
  metadataPayloadHash: string;
  verifyEvent: VerifyBotReceiptEvent;
}): Promise<BotCommandReceiptArchive> {
  if (
    !validateContract(
      "punks://contracts/bot.command-receipt-archive@1",
      input.value,
    ).valid
  ) {
    throw corrupt("Bot command receipt violates its strict contract");
  }
  const archive = input.value as BotCommandReceiptArchive;
  if (
    archive.aggregate !== "bot" ||
    archive.botId !== input.expectedBotId ||
    archive.commandId !== input.expectedCommandId ||
    archive.payloadHash !== input.metadataPayloadHash ||
    archive.terminal.kind !== "committed"
  ) {
    throw corrupt("Bot command receipt coordinate or payload hash is invalid");
  }
  const response = archive.terminal.value;
  const state = response.state as Bot;
  const event = response.event as SignedNostrEvent;
  if (
    state.id !== archive.botId ||
    !validBotStateEvent(
      state,
      event,
      archive.commandId,
      response.previousSlug,
    ) ||
    !(await input.verifyEvent(event))
  ) {
    throw corrupt("Bot command receipt state-event proof is invalid");
  }
  return archive;
}

function validBotStateEvent(
  state: Bot,
  event: SignedNostrEvent,
  commandId: string,
  previousSlug: string | null,
): boolean {
  const contract = event.kind === 50300 ? "bot.publish@1" : "bot.update@1";
  const expectedTags = [
    ["bot", state.id],
    ["cursor", String(state.cursor)],
    ["command", commandId],
    ["contract", contract],
  ];
  if (
    event.tags.length !== 6 ||
    expectedTags.some(
      (tag, index) => canonicalJson(event.tags[index]) !== canonicalJson(tag),
    ) ||
    event.tags[4]?.[0] !== "actor" ||
    event.tags[4]?.[1] !== "punk" ||
    event.tags[4]?.length !== 3 ||
    !uuid(event.tags[4]?.[2]) ||
    event.tags[5]?.[0] !== "attestation" ||
    event.tags[5]?.length !== 2 ||
    event.tags[5]?.[1]?.length === 0 ||
    event.created_at !== Math.floor(new Date(state.updatedAt).getTime() / 1_000)
  ) {
    return false;
  }
  const content = parseJson(event.content);
  if (
    !isExactRecord(content, ["schemaVersion", "bot", "delta"]) ||
    content.schemaVersion !== 1 ||
    canonicalJson(content.bot) !== canonicalJson(state) ||
    canonicalJson(content) !== event.content
  ) {
    return false;
  }
  if (event.kind === 50300) {
    return (
      state.revision === 1 &&
      state.cursor === 1 &&
      state.createdAt === state.updatedAt &&
      previousSlug === null &&
      isExactRecord(content.delta, ["operation"]) &&
      content.delta.operation === "published"
    );
  }
  return validUpdateDelta(state, content.delta, previousSlug);
}

function validUpdateDelta(
  state: Bot,
  value: unknown,
  previousSlug: string | null,
): boolean {
  if (!isRecord(value) || typeof value.operation !== "string") {
    return false;
  }
  switch (value.operation) {
    case "set-slug":
      return (
        isExactRecord(value, ["operation", "slug"]) &&
        value.slug === state.slug &&
        previousSlug !== null &&
        previousSlug !== state.slug
      );
    case "set-metadata": {
      const keys = Object.keys(value).sort().join(",");
      return (
        (keys === "name,operation" ||
          keys === "description,operation" ||
          keys === "description,name,operation") &&
        (value.name === undefined || value.name === state.name) &&
        (value.description === undefined ||
          value.description === state.description) &&
        previousSlug === null
      );
    }
    case "set-actions":
      return (
        isExactRecord(value, ["operation", "supportedActionContracts"]) &&
        canonicalJson(value.supportedActionContracts) ===
          canonicalJson(state.supportedActionContracts) &&
        previousSlug === null
      );
    case "set-status":
      return (
        isExactRecord(value, ["operation", "status"]) &&
        value.status === state.status &&
        previousSlug === null
      );
    case "set-runtime-release":
      return (
        isExactRecord(value, ["operation", "runtimeRelease"]) &&
        state.runtimeRelease !== null &&
        state.runtimeRelease !== undefined &&
        canonicalJson(value.runtimeRelease) ===
          canonicalJson(state.runtimeRelease) &&
        previousSlug === null
      );
    default:
      return false;
  }
}

function corrupt(message: string): CommandReceiptArchiveError {
  return new CommandReceiptArchiveError("corrupt", message);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function uuid(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
