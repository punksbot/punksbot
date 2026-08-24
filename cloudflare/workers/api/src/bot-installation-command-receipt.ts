import type {
  BotInstallation,
  BotInstallationCommandReceiptArchive,
  SignedNostrEvent,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { canonicalJson, sha256Hex } from "@punks/core";

import {
  CommandReceiptArchiveError,
  commandReceiptCoordinate,
  prepareCommandReceiptArchive,
  type PreparedCommandReceiptArchive,
} from "./command-receipt-archive";
import type { CommittedBotInstallationCommand } from "./rpc";

export type BotInstallationCommandTerminal =
  | { kind: "committed"; value: CommittedBotInstallationCommand }
  | {
      kind: "rejected";
      code: "not_found" | "forbidden" | "invalid_transition" | "conflict";
    };

type VerifyInstallationReceiptEvent = (
  event: SignedNostrEvent,
) => Promise<boolean>;

export async function prepareBotInstallationCommandReceipt(input: {
  installationId: string;
  commandId: string;
  payloadHash: string;
  terminal: BotInstallationCommandTerminal;
  verifyEvent: VerifyInstallationReceiptEvent;
}): Promise<PreparedCommandReceiptArchive> {
  const archive = {
    schemaVersion: 1,
    aggregate: "bot-installation",
    installationId: input.installationId,
    commandId: input.commandId,
    payloadHash: input.payloadHash,
    terminal: input.terminal,
  } as unknown as BotInstallationCommandReceiptArchive;
  await parseBotInstallationCommandReceiptArchive({
    value: archive,
    expectedInstallationId: input.installationId,
    expectedCommandId: input.commandId,
    metadataPayloadHash: input.payloadHash,
    metadataTerminal: input.terminal.kind,
    verifyEvent: input.verifyEvent,
  });
  const coordinate = await commandReceiptCoordinate({
    aggregate: "bot-installation",
    aggregateId: input.installationId,
    commandId: input.commandId,
  });
  return prepareCommandReceiptArchive(
    coordinate,
    input.payloadHash,
    archive,
    input.terminal.kind,
  );
}

export async function parseBotInstallationCommandReceiptArchive(input: {
  value: unknown;
  expectedInstallationId: string;
  expectedCommandId: string;
  metadataPayloadHash: string;
  metadataTerminal: "committed" | "rejected";
  verifyEvent: VerifyInstallationReceiptEvent;
}): Promise<BotInstallationCommandReceiptArchive> {
  if (
    !validateContract(
      "punks://contracts/bot-installation.command-receipt-archive@1",
      input.value,
    ).valid
  ) {
    throw corrupt("Bot Installation command receipt violates its contract");
  }
  const archive = input.value as BotInstallationCommandReceiptArchive;
  if (
    archive.aggregate !== "bot-installation" ||
    archive.installationId !== input.expectedInstallationId ||
    archive.commandId !== input.expectedCommandId ||
    archive.payloadHash !== input.metadataPayloadHash ||
    archive.terminal.kind !== input.metadataTerminal
  ) {
    throw corrupt(
      "Bot Installation command receipt coordinate or metadata is invalid",
    );
  }
  if (archive.terminal.kind === "rejected") {
    return archive;
  }
  const state = archive.terminal.value.state as BotInstallation;
  const event = archive.terminal.value.event as SignedNostrEvent;
  if (
    state.id !== archive.installationId ||
    !(await validInstallationStateEvent(state, event, archive.commandId)) ||
    !(await input.verifyEvent(event))
  ) {
    throw corrupt(
      "Bot Installation command receipt state-event proof is invalid",
    );
  }
  return archive;
}

async function validInstallationStateEvent(
  state: BotInstallation,
  event: SignedNostrEvent,
  commandId: string,
): Promise<boolean> {
  const contract =
    event.kind === 50310
      ? "bot-installation.install@1"
      : event.kind === 50311
        ? "bot-installation.configure@1"
        : event.kind === 50312
          ? "bot-installation.revoke@1"
          : null;
  if (contract === null) {
    return false;
  }
  const expectedTags = [
    ["workspace", state.workspaceId],
    ["installation", state.id],
    ["bot", state.botId],
    ["cursor", String(state.cursor)],
    ["command", commandId],
    ["contract", contract],
  ];
  if (
    event.tags.length !== 8 ||
    expectedTags.some(
      (tag, index) => canonicalJson(event.tags[index]) !== canonicalJson(tag),
    ) ||
    event.tags[6]?.[0] !== "actor" ||
    event.tags[6]?.[1] !== "punk" ||
    event.tags[6]?.length !== 3 ||
    !uuid(event.tags[6]?.[2]) ||
    event.tags[7]?.[0] !== "attestation" ||
    event.tags[7]?.length !== 2 ||
    !attestationKeyVersion(event.tags[7]?.[1]) ||
    event.created_at !== Math.floor(Date.parse(state.updatedAt) / 1_000)
  ) {
    return false;
  }
  const content = parseJson(event.content);
  if (
    !isExactRecord(content, ["schemaVersion", "installation", "delta"]) ||
    content.schemaVersion !== 1 ||
    canonicalJson(content) !== event.content
  ) {
    return false;
  }
  const installation = content.installation;
  if (!isRecord(installation)) {
    return false;
  }
  const configDigest = await sha256Hex(canonicalJson(state.config));
  const { config: _config, ...stateWithoutConfig } = state;
  const expectedInstallation = {
    ...stateWithoutConfig,
    configContractId: state.config.contractId,
    configDigest,
  };
  if (canonicalJson(installation) !== canonicalJson(expectedInstallation)) {
    return false;
  }
  return validInstallationDelta(state, event.kind, content.delta, configDigest);
}

function validInstallationDelta(
  state: BotInstallation,
  kind: number,
  value: unknown,
  configDigest: string,
): boolean {
  if (kind === 50310) {
    return (
      state.status === "active" &&
      state.grantCount === 0 &&
      state.revokedAt === null &&
      canonicalJson(value) ===
        canonicalJson({
          operation: state.revision === 1 ? "installed" : "reinstalled",
          configContractId: state.config.contractId,
          configDigest,
        })
    );
  }
  if (kind === 50312) {
    return (
      state.status === "revoked" &&
      state.grantCount === 0 &&
      state.revokedAt === state.updatedAt &&
      isExactRecord(value, ["operation", "cause"]) &&
      value.operation === "revoked" &&
      typeof value.cause === "string" &&
      value.cause.length >= 1 &&
      value.cause.length <= 255
    );
  }
  if (!isRecord(value)) {
    return false;
  }
  if (state.status !== "active" || state.revokedAt !== null) {
    return false;
  }
  if (value.operation === "replace-config") {
    return (
      canonicalJson(value) ===
      canonicalJson({
        operation: "replace-config",
        configContractId: state.config.contractId,
        configDigest,
      })
    );
  }
  if (value.operation === "pin-runtime-release") {
    return (
      isExactRecord(value, ["operation", "runtimeRelease"]) &&
      canonicalJson(value.runtimeRelease) ===
        canonicalJson(state.runtimeRelease)
    );
  }
  return (
    isExactRecord(value, ["operation", "grant"]) &&
    value.operation === "set-grant" &&
    validGrant(value.grant)
  );
}

function validGrant(value: unknown): boolean {
  return (
    isExactRecord(value, ["capability", "resource", "enabled"]) &&
    (value.capability === "messages.react" ||
      value.capability === "messages.read-context") &&
    typeof value.enabled === "boolean" &&
    isExactRecord(value.resource, ["kind", "conversationId"]) &&
    value.resource.kind === "conversation" &&
    uuid(value.resource.conversationId as string | undefined)
  );
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

function attestationKeyVersion(value: string | undefined): value is string {
  return value !== undefined && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value);
}
