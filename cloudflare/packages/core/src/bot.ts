import type {
  Bot,
  GetBotQuery,
  PublishBotCommand,
  UnsignedNostrEvent,
  UpdateBotCommand,
} from "@punks/contracts";

import { canonicalJson } from "./json";
import { isKnownBotRuntimeRelease } from "./bot-runtime-release";
import { PUNKS_EVENT_KINDS } from "./workspace";

export const BOT_EVENT_KINDS = {
  botPublished: PUNKS_EVENT_KINDS.botPublished,
  botUpdated: PUNKS_EVENT_KINDS.botUpdated,
} as const;

export type BotDomainErrorCode =
  | "already_exists"
  | "not_found"
  | "forbidden"
  | "invalid_transition";

export class BotDomainError extends Error {
  constructor(
    readonly code: BotDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotDomainError";
  }
}

export interface BotExecutionContext {
  botId: string;
  cursor: number;
  now: Date;
  operatorAuthorized: boolean;
}

export interface BotDecision {
  event: UnsignedNostrEvent;
  nextState: Bot;
}

export type BotCommand = PublishBotCommand | UpdateBotCommand;

function requireOperator(context: BotExecutionContext): void {
  if (!context.operatorAuthorized) {
    throw new BotDomainError(
      "forbidden",
      "Actor is not an authorized Punks Operator",
    );
  }
}

function eventTags(
  command: BotCommand,
  context: BotExecutionContext,
): [string, ...string[]][] {
  return [
    ["bot", context.botId],
    ["cursor", String(context.cursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", "punk", command.actor.punkId],
  ];
}

function event(
  command: BotCommand,
  context: BotExecutionContext,
  kind: number,
  nextState: Bot,
  delta: object,
): BotDecision {
  return {
    nextState,
    event: {
      created_at: Math.floor(context.now.getTime() / 1_000),
      kind,
      tags: eventTags(command, context),
      content: canonicalJson({
        schemaVersion: 1,
        bot: nextState,
        delta,
      }),
    },
  };
}

function publish(
  current: Bot | null,
  command: PublishBotCommand,
  context: BotExecutionContext,
): BotDecision {
  if (current !== null) {
    throw new BotDomainError("already_exists", "Bot already exists");
  }
  if (!isKnownBotRuntimeRelease(command.payload.runtimeRelease)) {
    throw new BotDomainError(
      "invalid_transition",
      "Bot publication requires a known runtime release",
    );
  }
  const timestamp = context.now.toISOString();
  const nextState: Bot = {
    id: context.botId,
    slug: command.payload.slug,
    name: command.payload.name,
    description: command.payload.description,
    status: "published",
    configContractId: command.payload.configContractId,
    runtimeRelease: command.payload.runtimeRelease,
    supportedActionContracts: command.payload.supportedActionContracts,
    revision: 1,
    cursor: context.cursor,
    createdAt: timestamp,
    updatedAt: timestamp,
    suspendedAt: null,
    withdrawnAt: null,
  };
  return event(command, context, BOT_EVENT_KINDS.botPublished, nextState, {
    operation: "published",
  });
}

function update(
  current: Bot | null,
  command: UpdateBotCommand,
  context: BotExecutionContext,
): BotDecision {
  if (
    current === null ||
    current.id !== context.botId ||
    command.botId !== context.botId
  ) {
    throw new BotDomainError("not_found", "Bot does not exist");
  }
  if (current.status === "withdrawn") {
    throw new BotDomainError(
      "invalid_transition",
      "A withdrawn Bot is terminal",
    );
  }

  const timestamp = context.now.toISOString();
  const payload = command.payload;
  let patch: Partial<Bot>;
  switch (payload.operation) {
    case "set-slug":
      patch = { slug: payload.slug };
      break;
    case "set-metadata":
      patch = {
        ...(payload.name === undefined ? {} : { name: payload.name }),
        ...(payload.description === undefined
          ? {}
          : { description: payload.description }),
      };
      break;
    case "set-actions":
      if (
        new Set(payload.supportedActionContracts).size !==
        payload.supportedActionContracts.length
      ) {
        throw new BotDomainError(
          "invalid_transition",
          "Bot action contracts must be unique",
        );
      }
      patch = { supportedActionContracts: payload.supportedActionContracts };
      break;
    case "set-runtime-release":
      if (current.runtimeRelease != null) {
        throw new BotDomainError(
          "invalid_transition",
          "Bot runtime release is immutable once set",
        );
      }
      if (!isKnownBotRuntimeRelease(payload.runtimeRelease)) {
        throw new BotDomainError(
          "invalid_transition",
          "Bot runtime release is not known",
        );
      }
      patch = { runtimeRelease: payload.runtimeRelease };
      break;
    case "set-status":
      patch = {
        status: payload.status,
        suspendedAt: payload.status === "suspended" ? timestamp : null,
        withdrawnAt: payload.status === "withdrawn" ? timestamp : null,
      };
      break;
  }

  const changed = Object.entries(patch).some(
    ([key, value]) => current[key as keyof Bot] !== value,
  );
  if (!changed) {
    throw new BotDomainError(
      "invalid_transition",
      "Bot update does not change state",
    );
  }
  const nextState: Bot = {
    ...current,
    runtimeRelease: current.runtimeRelease ?? null,
    ...patch,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
  };
  return event(
    command,
    context,
    BOT_EVENT_KINDS.botUpdated,
    nextState,
    payload,
  );
}

/** Executes one exact global Bot command through the module's sole write seam. */
export function executeBot(
  current: Bot | null,
  command: BotCommand,
  context: BotExecutionContext,
): BotDecision {
  requireOperator(context);
  return command.contract === "bot.publish@1"
    ? publish(current, command, context)
    : update(current, command, context);
}

/** Reads one global Bot by stable identity; mutable slugs are resolved elsewhere. */
export function queryBot(current: Bot | null, query: GetBotQuery): Bot {
  if (current === null || current.id !== query.botId) {
    throw new BotDomainError("not_found", "Bot does not exist");
  }
  return current;
}
