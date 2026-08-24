import type {
  AdmitBotActionCommand,
  Bot,
  BotActionAdmission,
  BotInstallation,
  CompleteBotActionCommand,
  ConfigureBotInstallationCommand,
  GetBotInstallationQuery,
  InstallBotCommand,
  ReplayBotActionCommand,
  RevokeBotInstallationCommand,
  UnsignedNostrEvent,
} from "@punks/contracts";

import { canonicalJson, deriveOpaqueUuid, sha256Hex } from "./json";
import { isKnownBotRuntimeRelease } from "./bot-runtime-release";
import { PUNKS_EVENT_KINDS } from "./workspace";

export const BOT_INSTALLATION_EVENT_KINDS = {
  installationInstalled: PUNKS_EVENT_KINDS.botInstallationInstalled,
  installationConfigured: PUNKS_EVENT_KINDS.botInstallationConfigured,
  installationRevoked: PUNKS_EVENT_KINDS.botInstallationRevoked,
  botActionAdmitted: PUNKS_EVENT_KINDS.botActionAdmitted,
  botActionCompleted: PUNKS_EVENT_KINDS.botActionCompleted,
} as const;

export const BOT_CONFIG_MAX_BYTES = 32 * 1_024;

export const BOT_INSTALLATION_GRANT_CAPABILITIES = Object.freeze([
  "messages.react",
  "messages.read-context",
] as const);

export const BOT_ACTION_REGISTRY = {
  "message.reaction-add@1": {
    capability: "messages.react",
    risk: "routine",
  },
  "message.reaction-remove@1": {
    capability: "messages.react",
    risk: "routine",
  },
  "message.reaction-toggle@1": {
    capability: "messages.react",
    risk: "routine",
  },
} as const;

export type BotActionContract = keyof typeof BOT_ACTION_REGISTRY;
export type BotInstallationGrant = Extract<
  ConfigureBotInstallationCommand["payload"],
  { operation: "set-grant" }
>["grant"];

export type BotInstallationDomainErrorCode =
  | "already_exists"
  | "not_found"
  | "forbidden"
  | "invalid_transition"
  | "conflict";

export class BotInstallationDomainError extends Error {
  constructor(
    readonly code: BotInstallationDomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BotInstallationDomainError";
  }
}

export interface BotInstallationWorkspaceContext {
  id: string;
  status: "active" | "deleting" | "deleted";
  botsInstallAuthorized: boolean;
}

export interface BotInstallationExecutionContext {
  installationId: string;
  cursor: number;
  now: Date;
  workspace: BotInstallationWorkspaceContext;
  bot: Bot | null;
  currentGrant: BotInstallationGrant | null;
  existingAdmission: BotActionAdmission | null;
}

export type BotInstallationCommand =
  | InstallBotCommand
  | ConfigureBotInstallationCommand
  | RevokeBotInstallationCommand
  | AdmitBotActionCommand
  | ReplayBotActionCommand
  | CompleteBotActionCommand;

export interface BotInstallationDecision {
  nextState: BotInstallation;
  event: UnsignedNostrEvent | null;
  admission: BotActionAdmission | null;
  replayed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validates the release-owned configuration before it enters authoritative state. */
export function assertPunksBotConfig(config: unknown): void {
  if (!isRecord(config)) {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "Bot configuration must use a Punks contract",
    );
  }
  const keys = Object.keys(config).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== "contractId" ||
    keys[1] !== "value" ||
    config.contractId !== "punks://contracts/bot.config.empty@1" ||
    !isRecord(config.value) ||
    Object.keys(config.value).length !== 0
  ) {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "The first Bot release requires the strict empty configuration",
    );
  }
  if (
    new TextEncoder().encode(canonicalJson(config)).byteLength >
    BOT_CONFIG_MAX_BYTES
  ) {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "Bot configuration exceeds 32 KiB",
    );
  }
}

export function deriveBotInstallationId(
  workspaceId: string,
  botId: string,
): Promise<string> {
  return deriveOpaqueUuid(
    "punks.bot-installation.v1",
    `${workspaceId}\u0000${botId}`,
  );
}

export function deriveBotActionAdmissionId(
  installationId: string,
  actionId: string,
): Promise<string> {
  return deriveOpaqueUuid(
    "punks.bot-action-admission.v1",
    `${installationId}\u0000${actionId}`,
  );
}

async function configurationReference(
  config: BotInstallation["config"],
): Promise<{ configContractId: string; configDigest: string }> {
  return {
    configContractId: config.contractId,
    configDigest: await sha256Hex(canonicalJson(config)),
  };
}

function installationEventState(
  state: BotInstallation,
  reference: { configContractId: string; configDigest: string },
): Omit<BotInstallation, "config"> & {
  configContractId: string;
  configDigest: string;
} {
  const { config: _config, ...boundedState } = state;
  return { ...boundedState, ...reference };
}

export function deriveBotActionDigest(
  command: AdmitBotActionCommand,
): Promise<string> {
  return sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      actionId: command.actionId,
      workspaceId: command.workspaceId,
      installationId: command.installationId,
      action: command.action,
    }),
  );
}

function actorTag(command: BotInstallationCommand): [string, ...string[]] {
  return command.actor.kind === "punk"
    ? ["actor", "punk", command.actor.punkId]
    : ["actor", "bot", command.actor.installationId];
}

function event(
  current: BotInstallation,
  command: BotInstallationCommand,
  context: BotInstallationExecutionContext,
  kind: number,
  content: object,
  additionalTags: [string, ...string[]][] = [],
): UnsignedNostrEvent {
  return {
    created_at: Math.floor(context.now.getTime() / 1_000),
    kind,
    tags: [
      ["workspace", current.workspaceId],
      ["installation", current.id],
      ["bot", current.botId],
      ["cursor", String(context.cursor)],
      ["command", command.commandId],
      ["contract", command.contract],
      actorTag(command),
      ...additionalTags,
    ],
    content: canonicalJson({ schemaVersion: 1, ...content }),
  };
}

function result(
  nextState: BotInstallation,
  signedEvent: UnsignedNostrEvent | null,
  admission: BotActionAdmission | null = null,
  replayed = false,
): BotInstallationDecision {
  return { nextState, event: signedEvent, admission, replayed };
}

function requireWorkspace(
  workspaceId: string,
  context: BotInstallationExecutionContext,
  requireActive: boolean,
): void {
  if (context.workspace.id !== workspaceId) {
    throw new BotInstallationDomainError(
      "not_found",
      "Workspace does not exist",
    );
  }
  if (!context.workspace.botsInstallAuthorized) {
    throw new BotInstallationDomainError(
      "forbidden",
      "Actor does not have the bots.install permission",
    );
  }
  if (requireActive && context.workspace.status !== "active") {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "Workspace is not active",
    );
  }
}

function requireCurrent(
  current: BotInstallation | null,
  workspaceId: string,
  installationId: string,
  context: BotInstallationExecutionContext,
): BotInstallation {
  if (
    current === null ||
    current.id !== installationId ||
    current.id !== context.installationId ||
    current.workspaceId !== workspaceId
  ) {
    throw new BotInstallationDomainError(
      "not_found",
      "Bot Installation does not exist in this Workspace",
    );
  }
  return current;
}

function requirePublishedBot(bot: Bot | null, botId: string): Bot {
  if (bot === null || bot.id !== botId) {
    throw new BotInstallationDomainError("not_found", "Bot does not exist");
  }
  if (bot.status !== "published") {
    throw new BotInstallationDomainError("forbidden", "Bot is not published");
  }
  return bot;
}

async function install(
  current: BotInstallation | null,
  command: InstallBotCommand,
  context: BotInstallationExecutionContext,
): Promise<BotInstallationDecision> {
  requireWorkspace(command.workspaceId, context, true);
  const expectedId = await deriveBotInstallationId(
    command.workspaceId,
    command.botId,
  );
  if (context.installationId !== expectedId) {
    throw new BotInstallationDomainError(
      "conflict",
      "Installation identity must be derived from Workspace and Bot",
    );
  }
  if (current?.status === "active") {
    throw new BotInstallationDomainError(
      "already_exists",
      "Bot Installation already exists",
    );
  }
  const publishedBot = requirePublishedBot(context.bot, command.botId);
  assertPunksBotConfig(command.payload.config);
  if (command.payload.config.contractId !== publishedBot.configContractId) {
    throw new BotInstallationDomainError(
      "conflict",
      "Bot configuration contract does not match its global definition",
    );
  }

  const timestamp = context.now.toISOString();
  const nextState: BotInstallation = {
    id: expectedId,
    workspaceId: command.workspaceId,
    botId: command.botId,
    status: "active",
    runtimeRelease: isKnownBotRuntimeRelease(publishedBot.runtimeRelease)
      ? publishedBot.runtimeRelease
      : null,
    config: command.payload.config,
    grantCount: 0,
    openAdmissionCount: current?.openAdmissionCount ?? 0,
    authorityGeneration: (current?.authorityGeneration ?? 0) + 1,
    revision: current === null ? 1 : current.revision + 1,
    cursor: context.cursor,
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
    revokedAt: null,
  };
  const configReference = await configurationReference(nextState.config);
  return result(
    nextState,
    event(
      nextState,
      command,
      context,
      BOT_INSTALLATION_EVENT_KINDS.installationInstalled,
      {
        installation: installationEventState(nextState, configReference),
        delta: {
          operation: current === null ? "installed" : "reinstalled",
          ...configReference,
        },
      },
    ),
  );
}

function grantsEqual(
  left: BotInstallationGrant | null,
  right: BotInstallationGrant,
): boolean {
  return (
    left !== null &&
    left.capability === right.capability &&
    left.resource.kind === "conversation" &&
    left.resource.conversationId === right.resource.conversationId &&
    left.enabled === true
  );
}

async function configure(
  current: BotInstallation | null,
  command: ConfigureBotInstallationCommand,
  context: BotInstallationExecutionContext,
): Promise<BotInstallationDecision> {
  requireWorkspace(command.workspaceId, context, true);
  current = requireCurrent(
    current,
    command.workspaceId,
    command.installationId,
    context,
  );
  if (current.status !== "active") {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "Bot Installation is not active",
    );
  }

  const payload = command.payload;
  let grantCount = current.grantCount;
  let runtimeRelease = current.runtimeRelease ?? null;
  if (payload.operation === "replace-config") {
    assertPunksBotConfig(payload.config);
    if (canonicalJson(payload.config) === canonicalJson(current.config)) {
      throw new BotInstallationDomainError(
        "invalid_transition",
        "Bot Installation configuration is unchanged",
      );
    }
  } else if (payload.operation === "pin-runtime-release") {
    const publishedBot = requirePublishedBot(context.bot, current.botId);
    if (!isKnownBotRuntimeRelease(publishedBot.runtimeRelease)) {
      throw new BotInstallationDomainError(
        "forbidden",
        "Bot does not have a known runtime release",
      );
    }
    if (
      isKnownBotRuntimeRelease(runtimeRelease) &&
      runtimeRelease.releaseId === publishedBot.runtimeRelease.releaseId &&
      runtimeRelease.releaseDigest === publishedBot.runtimeRelease.releaseDigest
    ) {
      throw new BotInstallationDomainError(
        "invalid_transition",
        "Bot Installation is already pinned to this runtime release",
      );
    }
    runtimeRelease = publishedBot.runtimeRelease;
  } else {
    const existingEnabled = grantsEqual(context.currentGrant, payload.grant);
    if (payload.grant.enabled === existingEnabled) {
      throw new BotInstallationDomainError(
        "invalid_transition",
        "Bot capability grant is unchanged",
      );
    }
    if (payload.grant.enabled) {
      const publishedBot = requirePublishedBot(context.bot, current.botId);
      const supportsCapability =
        payload.grant.capability === "messages.read-context"
          ? isKnownBotRuntimeRelease(runtimeRelease) &&
            isKnownBotRuntimeRelease(publishedBot.runtimeRelease) &&
            runtimeRelease.releaseId ===
              publishedBot.runtimeRelease.releaseId &&
            runtimeRelease.releaseDigest ===
              publishedBot.runtimeRelease.releaseDigest
          : publishedBot.supportedActionContracts.some(
              (contract) =>
                BOT_ACTION_REGISTRY[contract].capability ===
                payload.grant.capability,
            );
      if (!supportsCapability) {
        throw new BotInstallationDomainError(
          "forbidden",
          payload.grant.capability === "messages.read-context"
            ? "Context reads require a matching known runtime release"
            : "Bot does not support this capability",
        );
      }
      grantCount += 1;
    } else {
      grantCount -= 1;
      if (grantCount < 0) {
        throw new BotInstallationDomainError(
          "conflict",
          "Bot grant count cannot regress below zero",
        );
      }
    }
  }

  const nextState: BotInstallation = {
    ...current,
    runtimeRelease,
    config:
      payload.operation === "replace-config" ? payload.config : current.config,
    grantCount,
    authorityGeneration: current.authorityGeneration + 1,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: context.now.toISOString(),
  };
  const configReference = await configurationReference(nextState.config);
  const delta =
    payload.operation === "replace-config"
      ? { operation: payload.operation, ...configReference }
      : payload.operation === "pin-runtime-release"
        ? { operation: payload.operation, runtimeRelease }
        : payload;
  return result(
    nextState,
    event(
      nextState,
      command,
      context,
      BOT_INSTALLATION_EVENT_KINDS.installationConfigured,
      {
        installation: installationEventState(nextState, configReference),
        delta,
      },
    ),
  );
}

async function revoke(
  current: BotInstallation | null,
  command: RevokeBotInstallationCommand,
  context: BotInstallationExecutionContext,
): Promise<BotInstallationDecision> {
  requireWorkspace(command.workspaceId, context, false);
  current = requireCurrent(
    current,
    command.workspaceId,
    command.installationId,
    context,
  );
  if (current.status !== "active") {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "Bot Installation is not active",
    );
  }
  const timestamp = context.now.toISOString();
  const nextState: BotInstallation = {
    ...current,
    runtimeRelease: current.runtimeRelease ?? null,
    status: "revoked",
    grantCount: 0,
    authorityGeneration: current.authorityGeneration + 1,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
    revokedAt: timestamp,
  };
  const configReference = await configurationReference(nextState.config);
  return result(
    nextState,
    event(
      nextState,
      command,
      context,
      BOT_INSTALLATION_EVENT_KINDS.installationRevoked,
      {
        installation: installationEventState(nextState, configReference),
        delta: { operation: "revoked", cause: command.payload.cause },
      },
    ),
  );
}

function requireBotActor(
  command:
    | AdmitBotActionCommand
    | ReplayBotActionCommand
    | CompleteBotActionCommand,
): void {
  if (command.actor.installationId !== command.installationId) {
    throw new BotInstallationDomainError(
      "forbidden",
      "Bot actor does not match the Installation",
    );
  }
}

function requireReceipt(
  command: ReplayBotActionCommand | CompleteBotActionCommand,
  current: BotInstallation,
  context: BotInstallationExecutionContext,
): BotActionAdmission {
  requireBotActor(command);
  const receipt = context.existingAdmission;
  if (
    receipt === null ||
    receipt.id !== command.admissionId ||
    receipt.actionId !== command.actionId ||
    receipt.actionDigest !== command.actionDigest ||
    receipt.workspaceId !== command.workspaceId ||
    receipt.workspaceId !== current.workspaceId ||
    receipt.installationId !== command.installationId ||
    receipt.installationId !== current.id ||
    receipt.botId !== current.botId
  ) {
    throw new BotInstallationDomainError(
      "conflict",
      "Command does not match the durable admission receipt",
    );
  }
  return receipt;
}

async function admit(
  current: BotInstallation | null,
  command: AdmitBotActionCommand,
  context: BotInstallationExecutionContext,
): Promise<BotInstallationDecision> {
  requireBotActor(command);
  current = requireCurrent(
    current,
    command.workspaceId,
    command.installationId,
    context,
  );
  const digest = await deriveBotActionDigest(command);
  if (context.existingAdmission !== null) {
    const existing = context.existingAdmission;
    if (
      existing.actionId !== command.actionId ||
      existing.actionDigest !== digest ||
      existing.workspaceId !== command.workspaceId ||
      existing.installationId !== command.installationId ||
      existing.botId !== current.botId
    ) {
      throw new BotInstallationDomainError(
        "conflict",
        "actionId is already bound to another Bot action",
      );
    }
    return result(current, null, existing, true);
  }
  if (context.workspace.id !== command.workspaceId) {
    throw new BotInstallationDomainError(
      "not_found",
      "Workspace does not exist",
    );
  }
  if (context.workspace.status !== "active") {
    throw new BotInstallationDomainError(
      "invalid_transition",
      "Workspace is not active",
    );
  }
  if (current.status !== "active") {
    throw new BotInstallationDomainError(
      "forbidden",
      "Bot Installation is not active",
    );
  }
  const publishedBot = requirePublishedBot(context.bot, current.botId);
  if (
    !publishedBot.supportedActionContracts.includes(command.action.contract)
  ) {
    throw new BotInstallationDomainError(
      "forbidden",
      "Bot does not support this exact action contract",
    );
  }
  const requirement = BOT_ACTION_REGISTRY[command.action.contract];
  const grant = context.currentGrant;
  if (
    grant === null ||
    grant.enabled !== true ||
    grant.capability !== requirement.capability ||
    grant.resource.kind !== "conversation" ||
    grant.resource.conversationId !== command.action.conversationId
  ) {
    throw new BotInstallationDomainError(
      "forbidden",
      "Bot Installation lacks the exact messages.react grant",
    );
  }

  const generatedAdmissionId = await deriveBotActionAdmissionId(
    current.id,
    command.actionId,
  );
  const timestamp = context.now.toISOString();
  const admission: BotActionAdmission = {
    id: generatedAdmissionId,
    actionId: command.actionId,
    actionDigest: digest,
    workspaceId: current.workspaceId,
    installationId: current.id,
    botId: current.botId,
    actionContract: command.action.contract,
    capability: requirement.capability,
    risk: requirement.risk,
    resource: {
      kind: "message",
      conversationId: command.action.conversationId,
      messageId: command.action.messageId,
    },
    status: "admitted",
    outcome: null,
    installationCursor: context.cursor,
    authorityGeneration: current.authorityGeneration,
    admittedCursor: context.cursor,
    completedCursor: null,
    admittedAt: timestamp,
    completedAt: null,
  };
  const nextState: BotInstallation = {
    ...current,
    runtimeRelease: current.runtimeRelease ?? null,
    openAdmissionCount: current.openAdmissionCount + 1,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
  };
  return result(
    nextState,
    event(
      nextState,
      command,
      context,
      BOT_INSTALLATION_EVENT_KINDS.botActionAdmitted,
      { admission },
      [
        ["admission", admission.id],
        ["action", admission.actionId, admission.actionDigest],
        ["action_contract", admission.actionContract],
        ["capability", admission.capability],
        ["conversation", admission.resource.conversationId],
        ["message", admission.resource.messageId],
      ],
    ),
    admission,
  );
}

function replay(
  current: BotInstallation | null,
  command: ReplayBotActionCommand,
  context: BotInstallationExecutionContext,
): BotInstallationDecision {
  current = requireCurrent(
    current,
    command.workspaceId,
    command.installationId,
    context,
  );
  return result(current, null, requireReceipt(command, current, context), true);
}

function complete(
  current: BotInstallation | null,
  command: CompleteBotActionCommand,
  context: BotInstallationExecutionContext,
): BotInstallationDecision {
  current = requireCurrent(
    current,
    command.workspaceId,
    command.installationId,
    context,
  );
  const receipt = requireReceipt(command, current, context);
  if (receipt.status === "completed") {
    if (receipt.outcome !== command.outcome) {
      throw new BotInstallationDomainError(
        "conflict",
        "Completed admission outcome cannot change",
      );
    }
    return result(current, null, receipt, true);
  }
  if (current.openAdmissionCount < 1) {
    throw new BotInstallationDomainError(
      "conflict",
      "Open admission count cannot regress below zero",
    );
  }
  const timestamp = context.now.toISOString();
  const tombstone: BotActionAdmission = {
    ...receipt,
    status: "completed",
    outcome: command.outcome,
    completedCursor: context.cursor,
    completedAt: timestamp,
  };
  const nextState: BotInstallation = {
    ...current,
    runtimeRelease: current.runtimeRelease ?? null,
    openAdmissionCount: current.openAdmissionCount - 1,
    revision: current.revision + 1,
    cursor: context.cursor,
    updatedAt: timestamp,
  };
  return result(
    nextState,
    event(
      nextState,
      command,
      context,
      BOT_INSTALLATION_EVENT_KINDS.botActionCompleted,
      { admission: tombstone },
      [
        ["admission", tombstone.id],
        ["action", tombstone.actionId, tombstone.actionDigest],
        ["outcome", command.outcome],
      ],
    ),
    tombstone,
  );
}

/** Executes management and action-admission commands through one deep write seam. */
export async function executeBotInstallation(
  current: BotInstallation | null,
  command: BotInstallationCommand,
  context: BotInstallationExecutionContext,
): Promise<BotInstallationDecision> {
  switch (command.contract) {
    case "bot-installation.install@1":
      return install(current, command, context);
    case "bot-installation.configure@1":
      return configure(current, command, context);
    case "bot-installation.revoke@1":
      return revoke(current, command, context);
    case "bot-action.admit@1":
      return admit(current, command, context);
    case "bot-action.replay@1":
      return replay(current, command, context);
    case "bot-action.complete@1":
      return complete(current, command, context);
  }
}

/** Reads one Installation by stable Workspace-local identity. */
export function queryBotInstallation(
  current: BotInstallation | null,
  query: GetBotInstallationQuery,
): BotInstallation {
  if (
    current === null ||
    current.id !== query.installationId ||
    current.workspaceId !== query.workspaceId
  ) {
    throw new BotInstallationDomainError(
      "not_found",
      "Bot Installation does not exist in this Workspace",
    );
  }
  return current;
}
