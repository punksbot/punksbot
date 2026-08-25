import type {
  ArchiveConversationCommand,
  AddMessageReactionCommand,
  Bot,
  BotInstallation,
  ConfigureBotInstallationCommand,
  Conversation,
  ConversationView,
  DesktopCompatibilityQuery,
  DesktopCompatibilityResponse,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  EditMessageCommand,
  JoinConversationCommand,
  InstallBotCommand,
  MessageHistoryQuery,
  MessageHistoryResponse,
  MessageSearchQuery,
  MessageSearchResponse,
  MessageView,
  MessageMutationResponse,
  MessageReactionMutationResponse,
  PostMessageResponse,
  PostMessageCommand,
  PublishBotCommand,
  PunksWorkspaceView,
  ListConversationsResponse,
  ListWorkspacesResponse,
  PublicWorkspaceView,
  ResolveAuthorsQuery,
  ResolveAuthorsResponse,
  RemoveConversationMemberCommand,
  RemoveMessageReactionCommand,
  RemoveWorkspaceMemberCommand,
  RenameWorkspaceCommand,
  RetractMessageCommand,
  RestoreConversationCommand,
  RevokeBotInstallationCommand,
  RestoreMessageCommand,
  SetConversationMemberAccessCommand,
  SetWorkspaceMemberRoleCommand,
  SignedNostrEvent,
  ToggleMessageReactionCommand,
  UpdateBotCommand,
  UpdateConversationCommand,
  Workspace,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  DESKTOP_SOCIAL_LOOP_CAPABILITIES,
  DESKTOP_SOCIAL_LOOP_PROFILE_ID,
  DESKTOP_SOCIAL_LOOP_REGISTRY_VERSION,
} from "@punks/contracts/desktop-profile";
import {
  canonicalJson,
  canonicalMessageReaction,
  decodeDirectoryCursor,
  deriveOpaqueUuid,
  deriveBotInstallationId,
  encodeDirectoryCursor,
  messageContentEnvelopeFits,
  sha256Hex,
} from "@punks/core";

import type { ApiEnv } from "./env";
import {
  authenticatedPunkId,
  authenticatedPunkSession,
  isOperator,
  json,
  problem,
  readJson,
} from "./http";
import type { WorkspaceExecuteResult } from "./rpc";
import type {
  BotExecuteResult,
  BotInstallationExecuteResult,
  BotInstallationQueryResult,
  BotQueryResult,
  WorkspaceAuthorizationResult,
} from "./rpc";
import type { ConversationExecuteResult } from "./rpc";
import type { MessagePostResult } from "./rpc";
import type { MessageMutationResult } from "./rpc";
import type { MessageReactionMutationResult } from "./rpc";
import type {
  MessageHistoryResult,
  MessageReadResult,
  MessageSearchResult,
} from "./rpc";
import { backendContractAccepted } from "./semantic-observer";

const workspaceSlugPattern = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/;
const botSlugPattern = workspaceSlugPattern;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FOLLOW_PROTOCOL = "punks.follow.v1";
const DESKTOP_PROFILE = DESKTOP_SOCIAL_LOOP_PROFILE_ID;
const DESKTOP_MINIMUM_CLIENT_VERSION = "0.6.0";
const WORKER_VERSION_HEADER = "x-punks-worker-version-id";
const WORKER_VERSIONS_HEADER = "x-punks-worker-versions";
const STAGING_RUNTIME_PROBES = [
  ["punks-auth-staging", "AUTH_RUNTIME_IDENTITY"],
  ["punks-attestation-staging", "ATTESTATION_RUNTIME_IDENTITY"],
  ["punks-erasure-staging", "ERASURE_RUNTIME_IDENTITY"],
  ["punks-projector-staging", "PROJECTOR_RUNTIME_IDENTITY"],
  ["punks-search-staging", "SEARCH_RUNTIME_IDENTITY"],
  ["punks-api-staging", null],
  ["punks-bot-runtime-staging", "BOT_RUNTIME_IDENTITY"],
] as const;
const DESKTOP_CAPABILITIES = DESKTOP_SOCIAL_LOOP_CAPABILITIES;

function semanticVersionAtLeast(candidate: string, minimum: string): boolean {
  const parse = (value: string): readonly number[] | null => {
    const core = value.split("-", 1)[0];
    if (core === undefined) return null;
    const parts = core.split(".").map(Number);
    return parts.length === 3 && parts.every(Number.isSafeInteger)
      ? parts
      : null;
  };
  const candidateParts = parse(candidate);
  const minimumParts = parse(minimum);
  if (candidateParts === null || minimumParts === null) return false;
  for (let index = 0; index < 3; index += 1) {
    const candidatePart = candidateParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (candidatePart !== minimumPart) return candidatePart > minimumPart;
  }
  return true;
}

async function stagingRuntimeVersions(
  env: ApiEnv,
): Promise<{ name: string; versionId: string }[]> {
  const apiVersionId = env.CF_VERSION_METADATA?.id;
  if (!uuidPattern.test(apiVersionId ?? "")) {
    throw new Error("API Worker version unavailable");
  }
  return Promise.all(
    STAGING_RUNTIME_PROBES.map(async ([name, binding]) => {
      if (binding === null) return { name, versionId: apiVersionId };
      const result = await env[binding].runtimeVersion();
      if (
        result === null ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        Object.keys(result).length !== 1 ||
        !uuidPattern.test(result.versionId ?? "")
      ) {
        throw new Error(`Worker version unavailable for ${name}`);
      }
      return { name, versionId: result.versionId };
    }),
  );
}

function base64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

async function desktopCompatibility(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Desktop Compatibility query must be valid JSON under 64 KB",
    );
  }
  if (
    !backendContractAccepted("punks://contracts/desktop.compatibility@1", body)
  ) {
    return problem(
      400,
      "invalid_input",
      "Desktop Compatibility query is invalid",
    );
  }
  const query = body as DesktopCompatibilityQuery;
  const environment = String(env.ENVIRONMENT);
  const expectedDistribution =
    environment === "local"
      ? "development"
      : environment === "staging"
        ? "staging"
        : "production";
  const profileEnabled = String(env.DESKTOP_SOCIAL_LOOP_ENABLED) === "true";
  const compatible =
    profileEnabled &&
    query.profile === DESKTOP_PROFILE &&
    query.distribution === expectedDistribution &&
    semanticVersionAtLeast(query.clientVersion, DESKTOP_MINIMUM_CLIENT_VERSION);
  const response: DesktopCompatibilityResponse = {
    contract: "desktop.compatibility-response@1",
    compatible,
    profile: DESKTOP_PROFILE,
    registryVersion: DESKTOP_SOCIAL_LOOP_REGISTRY_VERSION,
    minimumClientVersion: DESKTOP_MINIMUM_CLIENT_VERSION,
    environment:
      environment === "staging"
        ? "staging"
        : environment === "production"
          ? "production"
          : "local",
    origin: new URL(request.url).origin,
    capabilities: compatible ? [...DESKTOP_CAPABILITIES] : [],
  };
  if (
    !backendContractAccepted(
      "punks://contracts/desktop.compatibility-response@1",
      response,
    )
  ) {
    return problem(
      500,
      "internal",
      "Desktop Compatibility response violated its contract",
    );
  }
  if (compatible && environment === "staging") {
    try {
      const versions = await stagingRuntimeVersions(env);
      const apiVersionId = versions.find(
        ({ name }) => name === "punks-api-staging",
      )?.versionId;
      return json(response, 200, {
        "cache-control": "no-store",
        [WORKER_VERSION_HEADER]: apiVersionId ?? "",
        [WORKER_VERSIONS_HEADER]: base64UrlJson(versions),
      });
    } catch {
      return problem(
        500,
        "internal",
        "Desktop Compatibility cannot identify every executing Worker version",
      );
    }
  }
  return json(response, 200, { "cache-control": "no-store" });
}

function listQuery(
  request: Request,
): { limit: number; cursor: string | null } | Response {
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some(
      (key) =>
        (key !== "limit" && key !== "cursor") ||
        params.getAll(key).length !== 1,
    ) ||
    params.getAll("limit").length !== 1 ||
    params.getAll("cursor").length > 1
  ) {
    return problem(400, "invalid_input", "Directory query is invalid");
  }
  const limitValue = params.get("limit") ?? "";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    return problem(400, "invalid_input", "Directory limit is invalid");
  }
  const cursor = params.get("cursor");
  if (
    cursor !== null &&
    (!/^[A-Za-z0-9._~-]+$/u.test(cursor) || cursor.length > 1_024)
  ) {
    return problem(400, "invalid_input", "Directory cursor is invalid");
  }
  return { limit: Number(limitValue), cursor };
}

function directoryCursorKey(env: ApiEnv): Uint8Array | null {
  if (typeof env.DIRECTORY_CURSOR_KEY !== "string") return null;
  const key = new TextEncoder().encode(env.DIRECTORY_CURSOR_KEY);
  return key.byteLength >= 32 ? key : null;
}

async function listWorkspaces(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  const parsed = listQuery(request);
  if (parsed instanceof Response) return parsed;
  const query = {
    contract: "workspace.list@1" as const,
    limit: parsed.limit,
    cursor: parsed.cursor,
  };
  if (!validateContract("punks://contracts/workspace.list@1", query).valid) {
    return problem(400, "invalid_input", "Workspace list query is invalid");
  }
  const cursorKey = directoryCursorKey(env);
  if (cursorKey === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace directory is unavailable",
    );
  }
  let afterId: string | undefined;
  if (parsed.cursor !== null) {
    try {
      afterId = (
        await decodeDirectoryCursor(
          parsed.cursor,
          { kind: "workspaces", punkId: session.punkId },
          cursorKey,
        )
      ).positionId;
    } catch {
      return problem(400, "invalid_input", "Directory cursor is invalid");
    }
  }
  let candidates: Awaited<
    ReturnType<ApiEnv["PROJECTION_DIRECTORY"]["listWorkspaceCandidates"]>
  >;
  try {
    candidates = await env.PROJECTION_DIRECTORY.listWorkspaceCandidates({
      punkId: session.punkId,
      limit: parsed.limit + 1,
      ...(afterId === undefined ? {} : { afterId }),
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace directory is unavailable",
      { retry: "later" },
    );
  }
  const normalizedCandidates: typeof candidates = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof candidate.workspaceId === "string" &&
      uuidPattern.test(candidate.workspaceId)
    ) {
      normalizedCandidates.push(candidate);
    }
  }
  normalizedCandidates.sort((left, right) =>
    left.workspaceId.localeCompare(right.workspaceId),
  );
  const authorized: Array<{
    positionId: string;
    view: ListWorkspacesResponse["items"][number];
  }> = [];
  const seen = new Set<string>();
  for (const candidate of normalizedCandidates) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.workspaceId !== "string" ||
      !uuidPattern.test(candidate.workspaceId) ||
      seen.has(candidate.workspaceId)
    ) {
      continue;
    }
    seen.add(candidate.workspaceId);
    let current: Awaited<
      ReturnType<ReturnType<ApiEnv["WORKSPACES"]["getByName"]>["query"]>
    >;
    try {
      current = await env.WORKSPACES.getByName(candidate.workspaceId).query({
        contract: "workspace.get@1",
        workspaceId: candidate.workspaceId,
      });
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Workspace authority is unavailable",
        { retry: "later" },
      );
    }
    if (!current.ok || current.state.status !== "active") continue;
    const membership = current.state.members.find(
      (member) => member.punkId === session.punkId,
    );
    if (membership === undefined) continue;
    authorized.push({
      positionId: candidate.workspaceId,
      view: {
        id: current.state.id,
        slug: current.state.slug,
        name: current.state.name,
        visibility: current.state.visibility,
        role: membership.role,
        revision: current.state.revision,
      },
    });
  }
  const page = authorized.slice(0, parsed.limit);
  const items = page.map(({ view }) => view);
  items.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  let nextPosition: string | null = null;
  if (normalizedCandidates.length > parsed.limit) {
    nextPosition =
      authorized.length > parsed.limit
        ? (page.at(-1)?.positionId ?? null)
        : (normalizedCandidates.at(-1)?.workspaceId ?? null);
  }
  let nextCursor: string | null = null;
  if (nextPosition !== null) {
    try {
      nextCursor = await encodeDirectoryCursor(
        {
          version: 1,
          kind: "workspaces",
          punkId: session.punkId,
          positionId: nextPosition,
        },
        cursorKey,
      );
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Workspace directory is unavailable",
      );
    }
  }
  const response: ListWorkspacesResponse = {
    contract: "workspace.list-response@1",
    items,
    nextCursor,
  };
  if (
    !validateContract("punks://contracts/workspace.list-response@1", response)
      .valid
  ) {
    return problem(500, "internal", "Workspace list violated its contract");
  }
  return json(response, 200, { "cache-control": "no-store" });
}

type ConversationSummarySource = Pick<
  Conversation,
  | "id"
  | "workspaceId"
  | "name"
  | "visibility"
  | "description"
  | "topic"
  | "purpose"
  | "topicRequired"
  | "ttlSeconds"
  | "ttlDeadline"
  | "revision"
  | "cursor"
  | "updatedAt"
>;

function conversationSummary(
  state: ConversationSummarySource,
): ListConversationsResponse["items"][number] {
  return {
    id: state.id,
    workspaceId: state.workspaceId,
    name: state.name,
    type: "stream",
    visibility: state.visibility,
    description: state.description,
    topic: state.topic,
    purpose: state.purpose,
    topicRequired: state.topicRequired,
    ttlSeconds: state.ttlSeconds,
    ttlDeadline: state.ttlDeadline,
    revision: state.revision,
    cursor: state.cursor,
    updatedAt: state.updatedAt,
  };
}

async function listStreams(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  const parsed = listQuery(request);
  if (parsed instanceof Response) return parsed;
  const query = {
    contract: "conversation.list@1" as const,
    workspaceId,
    type: "stream" as const,
    status: "active" as const,
    limit: parsed.limit,
    cursor: parsed.cursor,
  };
  if (!validateContract("punks://contracts/conversation.list@1", query).valid) {
    return problem(400, "invalid_input", "Stream list query is invalid");
  }
  const cursorKey = directoryCursorKey(env);
  if (cursorKey === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Stream directory is unavailable",
    );
  }
  let afterId: string | undefined;
  if (parsed.cursor !== null) {
    try {
      afterId = (
        await decodeDirectoryCursor(
          parsed.cursor,
          { kind: "streams", punkId: session.punkId, workspaceId },
          cursorKey,
        )
      ).positionId;
    } catch {
      return problem(400, "invalid_input", "Directory cursor is invalid");
    }
  }
  let workspace: Awaited<
    ReturnType<ReturnType<ApiEnv["WORKSPACES"]["getByName"]>["query"]>
  >;
  try {
    workspace = await env.WORKSPACES.getByName(workspaceId).query({
      contract: "workspace.get@1",
      workspaceId,
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace authority is unavailable",
      { retry: "later" },
    );
  }
  if (!workspace.ok) return problem(404, "not_found", "Workspace not found");
  const workspaceMember = workspace.state.members.some(
    (member) => member.punkId === session.punkId,
  );
  if (workspace.state.visibility === "private" && !workspaceMember) {
    return problem(403, "forbidden", "Workspace membership is required");
  }
  let candidates: Awaited<
    ReturnType<ApiEnv["PROJECTION_DIRECTORY"]["listConversationCandidates"]>
  >;
  try {
    candidates = await env.PROJECTION_DIRECTORY.listConversationCandidates({
      workspaceId,
      punkId: session.punkId,
      limit: parsed.limit + 1,
      ...(afterId === undefined ? {} : { afterId }),
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Stream directory is unavailable",
      { retry: "later" },
    );
  }
  const normalizedCandidates: typeof candidates = [];
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (
      candidate !== null &&
      typeof candidate === "object" &&
      typeof candidate.id === "string" &&
      uuidPattern.test(candidate.id)
    ) {
      normalizedCandidates.push(candidate);
    }
  }
  normalizedCandidates.sort((left, right) => left.id.localeCompare(right.id));
  const authorized: Array<{
    positionId: string;
    view: ListConversationsResponse["items"][number];
  }> = [];
  const seen = new Set<string>();
  for (const candidate of normalizedCandidates) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      typeof candidate.id !== "string" ||
      !uuidPattern.test(candidate.id) ||
      seen.has(candidate.id)
    ) {
      continue;
    }
    seen.add(candidate.id);
    let current: Awaited<
      ReturnType<ReturnType<ApiEnv["CONVERSATIONS"]["getByName"]>["query"]>
    >;
    try {
      current = await env.CONVERSATIONS.getByName(candidate.id).query({
        contract: "conversation.get@1",
        workspaceId,
        conversationId: candidate.id,
      });
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Conversation authority is unavailable",
        { retry: "later" },
      );
    }
    if (
      !current.ok ||
      current.state.workspaceId !== workspaceId ||
      current.state.status !== "active" ||
      current.state.type !== "stream"
    ) {
      continue;
    }
    if (
      current.state.visibility === "private" &&
      !current.state.members.some((member) => member.punkId === session.punkId)
    ) {
      continue;
    }
    authorized.push({
      positionId: candidate.id,
      view: conversationSummary(current.state),
    });
  }
  const page = authorized.slice(0, parsed.limit);
  const items = page.map(({ view }) => view);
  items.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
  let nextPosition: string | null = null;
  if (normalizedCandidates.length > parsed.limit) {
    nextPosition =
      authorized.length > parsed.limit
        ? (page.at(-1)?.positionId ?? null)
        : (normalizedCandidates.at(-1)?.id ?? null);
  }
  let nextCursor: string | null = null;
  if (nextPosition !== null) {
    try {
      nextCursor = await encodeDirectoryCursor(
        {
          version: 1,
          kind: "streams",
          punkId: session.punkId,
          workspaceId,
          positionId: nextPosition,
        },
        cursorKey,
      );
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Stream directory is unavailable",
      );
    }
  }
  const response: ListConversationsResponse = {
    contract: "conversation.list-response@1",
    workspaceId,
    items,
    nextCursor,
  };
  if (
    !validateContract(
      "punks://contracts/conversation.list-response@1",
      response,
    ).valid
  ) {
    return problem(500, "internal", "Stream list violated its contract");
  }
  return json(response, 200, { "cache-control": "no-store" });
}

async function resolveAuthors(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(400, "invalid_input", "Author query must be valid JSON");
  }
  if (
    !validateContract("punks://contracts/author.resolve@1", body).valid ||
    (body as ResolveAuthorsQuery).workspaceId !== workspaceId
  ) {
    return problem(400, "invalid_input", "Author query is invalid");
  }
  let rawAccess: unknown;
  try {
    rawAccess = await env.WORKSPACES.getByName(workspaceId).authorize({
      workspaceId,
      punkId: session.punkId,
      permission: "workspace.read",
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace authority is unavailable",
      { retry: "later" },
    );
  }
  const access = validateWorkspaceAuthorizationRpcResult(rawAccess);
  if (access === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace authority response is invalid",
      { retry: "later" },
    );
  }
  if (!access.ok) {
    return access.code === "not_found"
      ? problem(404, "not_found", "Workspace not found")
      : problem(403, "forbidden", "Workspace access is required");
  }

  const query = body as ResolveAuthorsQuery;
  const authors: ResolveAuthorsResponse["authors"] = [];
  for (const author of query.authors) {
    if (author.kind === "punk") {
      let summary: Awaited<
        ReturnType<ApiEnv["AUTH_SERVICE"]["resolvePunkSummary"]>
      >;
      try {
        summary = await env.AUTH_SERVICE.resolvePunkSummary(author.punkId);
      } catch {
        return problem(
          503,
          "temporarily_unavailable",
          "Punk author authority is unavailable",
          { retry: "later" },
        );
      }
      if (summary !== null && summary.id === author.punkId) {
        authors.push({
          kind: "punk",
          punkId: summary.id,
          displayName: summary.displayName,
          avatarUrl: summary.avatarUrl,
        });
      }
      continue;
    }

    let rawInstallation: unknown;
    try {
      rawInstallation = await env.BOT_INSTALLATIONS.getByName(
        author.installationId,
      ).query({
        contract: "bot-installation.get@1",
        workspaceId,
        installationId: author.installationId,
      });
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Bot author authority is unavailable",
        { retry: "later" },
      );
    }
    const installation = validateBotInstallationQueryRpcResult(
      rawInstallation,
      workspaceId,
      author.installationId,
    );
    if (!installation?.ok || installation.state.status !== "active") continue;
    let rawBot: unknown;
    try {
      rawBot = await env.BOTS.getByName(installation.state.botId).query({
        contract: "bot.get@1",
        botId: installation.state.botId,
      });
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Bot author authority is unavailable",
        { retry: "later" },
      );
    }
    const bot = validateBotQueryRpcResult(rawBot, installation.state.botId);
    if (bot?.ok && bot.state.status === "published") {
      authors.push({
        kind: "bot",
        installationId: installation.state.id,
        displayName: bot.state.name,
        avatarUrl: null,
      });
    }
  }
  const response: ResolveAuthorsResponse = {
    contract: "author.resolve-response@1",
    workspaceId,
    authors,
  };
  if (
    !validateContract("punks://contracts/author.resolve-response@1", response)
      .valid
  ) {
    return problem(500, "internal", "Author response violated its contract");
  }
  return json(response, 200, { "cache-control": "no-store" });
}

async function followConversation(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
): Promise<Response> {
  if (
    request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
    request.headers.get("sec-websocket-protocol") !== FOLLOW_PROTOCOL
  ) {
    return problem(
      426,
      "invalid_input",
      "Conversation follow requires the punks.follow.v1 WebSocket protocol",
    );
  }
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return problem(403, "forbidden", "WebSocket origin is not allowed");
  }
  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some(
      (key) => key !== "afterCursor" || params.getAll(key).length !== 1,
    ) ||
    params.getAll("afterCursor").length !== 1
  ) {
    return problem(
      400,
      "invalid_input",
      "Conversation follow query is invalid",
    );
  }
  const afterCursorValue = params.get("afterCursor") ?? "";
  if (!/^(?:0|[1-9][0-9]*)$/u.test(afterCursorValue)) {
    return problem(
      400,
      "invalid_input",
      "Conversation follow cursor is invalid",
    );
  }
  const afterCursor = Number(afterCursorValue);
  if (!Number.isSafeInteger(afterCursor)) {
    return problem(
      400,
      "invalid_input",
      "Conversation follow cursor is invalid",
    );
  }
  const query = {
    contract: "conversation.follow@1" as const,
    workspaceId,
    conversationId,
    afterCursor,
  };
  if (
    !validateContract("punks://contracts/conversation.follow@1", query).valid
  ) {
    return problem(
      400,
      "invalid_input",
      "Conversation follow query is invalid",
    );
  }
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  const sanitizedHeaders = new Headers({
    upgrade: "websocket",
    "sec-websocket-protocol": FOLLOW_PROTOCOL,
    "x-punks-follow-workspace-id": workspaceId,
    "x-punks-follow-conversation-id": conversationId,
    "x-punks-follow-after-cursor": String(afterCursor),
    "x-punks-follow-punk-id": session.punkId,
    "x-punks-follow-session-id": session.sessionId,
    "x-punks-follow-session-expires-at": session.expiresAt,
  });
  return env.CONVERSATIONS.getByName(conversationId).fetch(
    new Request("https://punks-api.invalid/internal/follow", {
      headers: sanitizedHeaders,
    }),
  );
}

function executeFailure(
  result: Exclude<WorkspaceExecuteResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(
        400,
        "invalid_input",
        "Command does not match its contract",
      );
    case "idempotency_conflict":
      return problem(
        409,
        "idempotency_conflict",
        "Command id was reused with another payload",
      );
    case "command_in_progress":
      return problem(
        409,
        "command_in_progress",
        "Another Workspace command is in progress",
        {
          retry: "later",
          retryAfterMs: 1_000,
        },
      );
    case "not_found":
      return problem(404, "not_found", "Workspace not found");
    case "forbidden":
      return problem(
        403,
        "forbidden",
        "Actor cannot perform this Workspace command",
      );
    case "invalid_transition":
      return problem(
        409,
        "invalid_input",
        "Workspace transition is not allowed",
      );
    case "attestation_failed":
      return problem(
        503,
        "attestation_failed",
        "Workspace event could not be attested",
        {
          retry: "same_command",
          retryAfterMs: 1_000,
        },
      );
    case "internal":
      return problem(500, "internal", "Workspace command failed");
  }
}

function botExecuteFailure(
  result: Exclude<BotExecuteResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(400, "invalid_input", "Bot command is invalid");
    case "idempotency_conflict":
      return problem(
        409,
        "idempotency_conflict",
        "Command id was reused with another Bot payload",
      );
    case "command_in_progress":
      return problem(
        409,
        "command_in_progress",
        "Another Bot command is in progress",
        {
          retry: "later",
          retryAfterMs: 1_000,
        },
      );
    case "not_found":
      return problem(404, "not_found", "Bot not found");
    case "forbidden":
      return problem(403, "forbidden", "Punks Operator authority is required");
    case "invalid_transition":
      return problem(409, "invalid_input", "Bot transition is not allowed");
    case "attestation_failed":
      return problem(
        503,
        "attestation_failed",
        "Bot event could not be attested",
        {
          retry: "same_command",
          retryAfterMs: 1_000,
        },
      );
    case "temporarily_unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Bot command receipt archive is temporarily unavailable",
        {
          retry: "same_command",
          retryAfterMs: 1_000,
        },
      );
    case "internal":
      return problem(500, "internal", "Bot command failed");
  }
}

async function validateBotExecuteRpcResult(
  value: unknown,
  command: PublishBotCommand | UpdateBotCommand,
  expectedBotId: string,
): Promise<BotExecuteResult | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "idempotency_conflict" ||
        record.code === "command_in_progress" ||
        record.code === "not_found" ||
        record.code === "forbidden" ||
        record.code === "invalid_transition" ||
        record.code === "attestation_failed" ||
        record.code === "temporarily_unavailable" ||
        record.code === "internal")
      ? (record as Extract<BotExecuteResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !== "ok,replayed,value" ||
    typeof record.replayed !== "boolean" ||
    typeof record.value !== "object" ||
    record.value === null ||
    Array.isArray(record.value)
  ) {
    return null;
  }
  const committed = record.value as Record<string, unknown>;
  if (
    Object.keys(committed).sort().join(",") !== "event,previousSlug,state" ||
    !validateContract("punks://contracts/bot@1", committed.state).valid ||
    !validateContract("punks://contracts/nostr.signed-event@1", committed.event)
      .valid ||
    (committed.previousSlug !== null &&
      typeof committed.previousSlug !== "string")
  ) {
    return null;
  }
  const state = committed.state as Bot;
  const event = committed.event as SignedNostrEvent;
  const isSlugUpdate =
    command.contract === "bot.update@1" &&
    command.payload.operation === "set-slug";
  const expectedTags: SignedNostrEvent["tags"] = [
    ["bot", expectedBotId],
    ["cursor", String(state.cursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", "punk", command.actor.punkId],
  ];
  let content: unknown;
  try {
    content = JSON.parse(event.content) as unknown;
  } catch {
    return null;
  }
  const expectedDelta =
    command.contract === "bot.publish@1"
      ? { operation: "published" }
      : command.payload;
  const contentValid =
    typeof content === "object" &&
    content !== null &&
    !Array.isArray(content) &&
    Object.keys(content).sort().join(",") === "bot,delta,schemaVersion" &&
    Reflect.get(content, "schemaVersion") === 1 &&
    canonicalJson(Reflect.get(content, "bot")) === canonicalJson(state) &&
    canonicalJson(Reflect.get(content, "delta")) ===
      canonicalJson(expectedDelta) &&
    canonicalJson(content) === event.content;
  const expectedEventId = await sha256Hex(
    JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]),
  );
  if (
    state.id !== expectedBotId ||
    event.kind !== (command.contract === "bot.publish@1" ? 50300 : 50301) ||
    event.id !== expectedEventId ||
    event.created_at !== Math.floor(Date.parse(state.updatedAt) / 1_000) ||
    event.tags.length !== expectedTags.length + 1 ||
    !expectedTags.every(
      (tag, index) => canonicalJson(event.tags[index]) === canonicalJson(tag),
    ) ||
    !Array.isArray(event.tags.at(-1)) ||
    event.tags.at(-1)?.[0] !== "attestation" ||
    event.tags.at(-1)?.length !== 2 ||
    event.tags.at(-1)?.[1]?.length === 0 ||
    !contentValid ||
    (isSlugUpdate
      ? typeof committed.previousSlug !== "string"
      : committed.previousSlug !== null)
  ) {
    return null;
  }
  return record as Extract<BotExecuteResult, { ok: true }>;
}

function validateBotQueryRpcResult(
  value: unknown,
  expectedBotId: string,
): BotQueryResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "not_found" ||
        record.code === "internal")
      ? (record as Extract<BotQueryResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !== "ok,state" ||
    !validateContract("punks://contracts/bot@1", record.state).valid ||
    (record.state as Bot).id !== expectedBotId
  ) {
    return null;
  }
  return record as Extract<BotQueryResult, { ok: true }>;
}

type ValidatedBotSlugClaim =
  | { ok: true; botId: string; replayed: boolean }
  | { ok: false; code: "invalid_request" | "slug_claimed" };

function validateBotSlugClaim(
  value: unknown,
  expectedBotId: string,
): ValidatedBotSlugClaim | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_request" || record.code === "slug_claimed")
      ? (record as Extract<ValidatedBotSlugClaim, { ok: false }>)
      : null;
  }
  return record.ok === true &&
    Object.keys(record).sort().join(",") === "botId,ok,replayed" &&
    record.botId === expectedBotId &&
    uuidPattern.test(expectedBotId) &&
    typeof record.replayed === "boolean"
    ? (record as Extract<ValidatedBotSlugClaim, { ok: true }>)
    : null;
}

type ValidatedBotSlugResolution =
  | { status: "missing" }
  | { status: "pending" }
  | { status: "active"; botId: string }
  | { status: "redirect"; botId: string; slug: string };

function validateBotSlugResolution(
  value: unknown,
): ValidatedBotSlugResolution | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.status === "missing" || record.status === "pending") {
    return Object.keys(record).join(",") === "status"
      ? (record as { status: "missing" | "pending" })
      : null;
  }
  if (
    record.status === "active" &&
    Object.keys(record).sort().join(",") === "botId,status" &&
    typeof record.botId === "string" &&
    uuidPattern.test(record.botId)
  ) {
    return record as Extract<ValidatedBotSlugResolution, { status: "active" }>;
  }
  if (
    record.status === "redirect" &&
    Object.keys(record).sort().join(",") === "botId,slug,status" &&
    typeof record.botId === "string" &&
    uuidPattern.test(record.botId) &&
    typeof record.slug === "string" &&
    botSlugPattern.test(record.slug)
  ) {
    return record as Extract<
      ValidatedBotSlugResolution,
      { status: "redirect" }
    >;
  }
  return null;
}

function botInstallationFailure(
  result: Exclude<BotInstallationExecuteResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(
        400,
        "invalid_input",
        "Bot Installation command is invalid",
      );
    case "idempotency_conflict":
      return problem(
        409,
        "idempotency_conflict",
        "Command id was reused with another Bot Installation payload",
      );
    case "command_in_progress":
      return problem(
        409,
        "command_in_progress",
        "Another Bot Installation command is in progress",
        { retry: "later", retryAfterMs: 1_000 },
      );
    case "not_found":
      return problem(
        404,
        "not_found",
        "Bot, Installation, or Workspace not found",
      );
    case "forbidden":
      return problem(
        403,
        "forbidden",
        "Punk cannot manage this Bot Installation",
      );
    case "invalid_transition":
    case "conflict":
      return problem(
        409,
        "invalid_input",
        "Bot Installation transition is not allowed",
      );
    case "attestation_failed":
      return problem(
        503,
        "attestation_failed",
        "Bot Installation event could not be attested",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "temporarily_unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Bot Installation command receipt archive is unavailable",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "internal":
      return problem(500, "internal", "Bot Installation command failed");
  }
}

async function validateBotInstallationExecuteRpcResult(
  value: unknown,
  command:
    | InstallBotCommand
    | ConfigureBotInstallationCommand
    | RevokeBotInstallationCommand,
  expectedInstallationId: string,
): Promise<BotInstallationExecuteResult | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "idempotency_conflict" ||
        record.code === "command_in_progress" ||
        record.code === "not_found" ||
        record.code === "forbidden" ||
        record.code === "invalid_transition" ||
        record.code === "conflict" ||
        record.code === "attestation_failed" ||
        record.code === "temporarily_unavailable" ||
        record.code === "internal")
      ? (record as Extract<BotInstallationExecuteResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !== "ok,replayed,value" ||
    typeof record.replayed !== "boolean" ||
    typeof record.value !== "object" ||
    record.value === null ||
    Array.isArray(record.value)
  ) {
    return null;
  }
  const committed = record.value as Record<string, unknown>;
  if (
    Object.keys(committed).sort().join(",") !== "event,state" ||
    !validateContract("punks://contracts/bot-installation@1", committed.state)
      .valid ||
    !validateContract("punks://contracts/nostr.signed-event@1", committed.event)
      .valid
  ) {
    return null;
  }
  const state = committed.state as BotInstallation;
  const event = committed.event as SignedNostrEvent;
  const expectedKind =
    command.contract === "bot-installation.install@1"
      ? 50310
      : command.contract === "bot-installation.configure@1"
        ? 50311
        : 50312;
  const expectedTags: SignedNostrEvent["tags"] = [
    ["workspace", command.workspaceId],
    ["installation", expectedInstallationId],
    ["bot", state.botId],
    ["cursor", String(state.cursor)],
    ["command", command.commandId],
    ["contract", command.contract],
    ["actor", "punk", command.actor.punkId],
  ];
  let content: unknown;
  try {
    content = JSON.parse(event.content) as unknown;
  } catch {
    return null;
  }
  const expectedEventId = await sha256Hex(
    JSON.stringify([
      0,
      event.pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]),
  );
  const contentRecord =
    typeof content === "object" && content !== null && !Array.isArray(content)
      ? (content as Record<string, unknown>)
      : null;
  const expectedConfigDigest = await sha256Hex(canonicalJson(state.config));
  if (
    state.id !== expectedInstallationId ||
    state.workspaceId !== command.workspaceId ||
    (command.contract === "bot-installation.install@1" &&
      state.botId !== command.botId) ||
    event.kind !== expectedKind ||
    event.id !== expectedEventId ||
    event.created_at !== Math.floor(Date.parse(state.updatedAt) / 1_000) ||
    event.tags.length !== expectedTags.length + 1 ||
    !expectedTags.every(
      (tag, index) => canonicalJson(event.tags[index]) === canonicalJson(tag),
    ) ||
    event.tags.at(-1)?.[0] !== "attestation" ||
    event.tags.at(-1)?.length !== 2 ||
    !contentRecord ||
    contentRecord.schemaVersion !== 1 ||
    canonicalJson(contentRecord) !== event.content ||
    !installationEventContentMatches(
      contentRecord,
      state,
      command,
      expectedConfigDigest,
    )
  ) {
    return null;
  }
  return record as Extract<BotInstallationExecuteResult, { ok: true }>;
}

function installationEventContentMatches(
  content: Record<string, unknown>,
  state: BotInstallation,
  command:
    | InstallBotCommand
    | ConfigureBotInstallationCommand
    | RevokeBotInstallationCommand,
  expectedConfigDigest: string,
): boolean {
  if (
    Object.keys(content).sort().join(",") !== "delta,installation,schemaVersion"
  ) {
    return false;
  }
  const installation = content.installation;
  if (typeof installation !== "object" || installation === null) {
    return false;
  }
  const bounded = installation as Record<string, unknown>;
  const { config: _config, ...stateWithoutConfig } = state;
  if (
    bounded.configContractId !== state.config.contractId ||
    bounded.configDigest !== expectedConfigDigest ||
    canonicalJson(bounded) !==
      canonicalJson({
        ...stateWithoutConfig,
        configContractId: bounded.configContractId,
        configDigest: bounded.configDigest,
      })
  ) {
    return false;
  }
  if (command.contract === "bot-installation.install@1") {
    return (
      canonicalJson(content.delta) ===
      canonicalJson({
        operation: state.revision === 1 ? "installed" : "reinstalled",
        configContractId: bounded.configContractId,
        configDigest: bounded.configDigest,
      })
    );
  }
  if (command.contract === "bot-installation.revoke@1") {
    return (
      canonicalJson(content.delta) ===
      canonicalJson({ operation: "revoked", cause: command.payload.cause })
    );
  }
  const expectedDelta =
    command.payload.operation === "replace-config"
      ? {
          operation: "replace-config",
          configContractId: bounded.configContractId,
          configDigest: bounded.configDigest,
        }
      : command.payload.operation === "pin-runtime-release"
        ? {
            operation: "pin-runtime-release",
            runtimeRelease: state.runtimeRelease,
          }
        : command.payload;
  return canonicalJson(content.delta) === canonicalJson(expectedDelta);
}

function validateBotInstallationQueryRpcResult(
  value: unknown,
  workspaceId: string,
  installationId: string,
): BotInstallationQueryResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "not_found" ||
        record.code === "internal")
      ? (record as Extract<BotInstallationQueryResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !== "ok,state" ||
    !validateContract("punks://contracts/bot-installation@1", record.state)
      .valid ||
    (record.state as BotInstallation).workspaceId !== workspaceId ||
    (record.state as BotInstallation).id !== installationId
  ) {
    return null;
  }
  return record as Extract<BotInstallationQueryResult, { ok: true }>;
}

function validateWorkspaceAuthorizationRpcResult(
  value: unknown,
): WorkspaceAuthorizationResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_request" ||
        record.code === "not_found" ||
        record.code === "forbidden")
      ? (record as Extract<WorkspaceAuthorizationResult, { ok: false }>)
      : null;
  }
  return record.ok === true &&
    Object.keys(record).sort().join(",") ===
      "ok,role,visibility,workspaceCursor" &&
    Number.isSafeInteger(record.workspaceCursor) &&
    Number(record.workspaceCursor) > 0 &&
    (record.role === "owner" ||
      record.role === "moderator" ||
      record.role === "member" ||
      record.role === "guest") &&
    (record.visibility === "private" ||
      record.visibility === "punks" ||
      record.visibility === "public")
    ? (record as Extract<WorkspaceAuthorizationResult, { ok: true }>)
    : null;
}

function conversationExecuteFailure(
  result: Exclude<ConversationExecuteResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(
        400,
        "invalid_input",
        "Command does not match its Conversation contract",
      );
    case "idempotency_conflict":
      return problem(
        409,
        "idempotency_conflict",
        "Command id was reused with another payload",
      );
    case "command_in_progress":
      return problem(
        409,
        "command_in_progress",
        "Another Conversation command is in progress",
        { retry: "later", retryAfterMs: 1_000 },
      );
    case "not_found":
      return problem(404, "not_found", "Conversation or Workspace not found");
    case "forbidden":
      return problem(
        403,
        "forbidden",
        "Actor cannot perform this Conversation command",
      );
    case "invalid_transition":
      return problem(
        409,
        "invalid_input",
        "Conversation transition is not allowed",
      );
    case "attestation_failed":
      return problem(
        503,
        "attestation_failed",
        "Conversation event could not be attested",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "internal":
      return problem(500, "internal", "Conversation command failed");
  }
}

function messagePostFailure(
  result: Exclude<MessagePostResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(400, "invalid_input", "Message post command is invalid");
    case "idempotency_conflict":
      return problem(
        409,
        "idempotency_conflict",
        "Command id was reused with another Message payload",
      );
    case "command_in_progress":
      return problem(
        409,
        "command_in_progress",
        "Another Conversation command is in progress",
        { retry: "later", retryAfterMs: 1_000 },
      );
    case "not_found":
      return problem(
        404,
        "not_found",
        "Conversation, Workspace, or parent Message not found",
      );
    case "forbidden":
      return problem(403, "forbidden", "Actor cannot post this Message");
    case "invalid_transition":
      return problem(409, "invalid_input", "Message post is not allowed");
    case "content_unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Encrypted Message content could not be staged",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "content_finalize_failed":
      return problem(
        503,
        "temporarily_unavailable",
        "Message committed but encrypted content finalization is pending",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "search_unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Message search token derivation is unavailable",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "attestation_failed":
      return problem(
        503,
        "attestation_failed",
        "Message event could not be attested",
        { retry: "same_command", retryAfterMs: 1_000 },
      );
    case "internal":
      return problem(500, "internal", "Message post failed");
  }
}

function messageMutationFailure(
  result: Exclude<MessageMutationResult, { ok: true }>,
): Response {
  return messagePostFailure(result);
}

function messageReadFailure(
  result: Exclude<MessageReadResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(400, "invalid_input", "Message read request is invalid");
    case "not_found":
      return problem(
        404,
        "not_found",
        "Message, Conversation or Workspace not found",
      );
    case "forbidden":
      return problem(403, "forbidden", "Punk cannot read this Message");
    case "content_unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Encrypted Message content is unavailable",
        { retry: "later", retryAfterMs: 1_000 },
      );
    case "internal":
      return problem(500, "internal", "Message read failed");
  }
}

function messageHistoryFailure(
  result: Exclude<MessageHistoryResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
    case "cursor_invalid":
      return problem(400, "invalid_input", "Message history query is invalid");
    case "not_found":
      return problem(404, "not_found", "Conversation or Workspace not found");
    case "forbidden":
      return problem(403, "forbidden", "Punk cannot read Message history");
    case "content_unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Authorized Message content is temporarily unavailable",
        { retry: "later", retryAfterMs: 1_000 },
      );
    case "internal":
      return problem(500, "internal", "Message history query failed");
  }
}

function messageSearchFailure(
  result: Exclude<MessageSearchResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
    case "cursor_invalid":
      return problem(400, "invalid_input", "Message search query is invalid");
    case "not_found":
      return problem(404, "not_found", "Conversation or Workspace not found");
    case "forbidden":
      return problem(403, "forbidden", "Punk cannot search this Conversation");
    case "content_unavailable":
    case "search_unavailable":
    case "internal":
      return problem(
        503,
        "temporarily_unavailable",
        "Message search is temporarily unavailable",
        { retry: "later", retryAfterMs: 1_000 },
      );
  }
}

function messageReactionFailure(
  result: Exclude<MessageReactionMutationResult, { ok: true }>,
): Response {
  switch (result.code) {
    case "invalid_contract":
      return problem(400, "invalid_input", "Reaction command is invalid");
    case "idempotency_conflict":
      return problem(
        409,
        "idempotency_conflict",
        "Command id was reused with another Reaction",
      );
    case "command_in_progress":
      return problem(
        409,
        "command_in_progress",
        "Another Conversation mutation is in progress",
        { retry: "later", retryAfterMs: 1_000 },
      );
    case "not_found":
      return problem(
        404,
        "not_found",
        "Message, Conversation or Workspace not found",
      );
    case "forbidden":
      return problem(403, "forbidden", "Punk cannot mutate this Reaction");
    case "invalid_transition":
      return problem(409, "invalid_input", "Reaction transition is invalid");
    case "attestation_failed":
      return problem(503, "attestation_failed", "Reaction attestation failed", {
        retry: "same_command",
        retryAfterMs: 1_000,
      });
    case "internal":
      return problem(500, "internal", "Reaction mutation failed");
  }
}

async function validateMessageReactionMutationRpcResult(
  value: unknown,
  command:
    | AddMessageReactionCommand
    | RemoveMessageReactionCommand
    | ToggleMessageReactionCommand,
  operation: "add" | "remove" | "toggle",
  punkId: string,
): Promise<MessageReactionMutationResult | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === false) {
    return Object.keys(record).sort().join(",") === "code,ok" &&
      (record.code === "invalid_contract" ||
        record.code === "idempotency_conflict" ||
        record.code === "command_in_progress" ||
        record.code === "not_found" ||
        record.code === "forbidden" ||
        record.code === "invalid_transition" ||
        record.code === "attestation_failed" ||
        record.code === "internal")
      ? (record as Extract<MessageReactionMutationResult, { ok: false }>)
      : null;
  }
  if (
    record.ok !== true ||
    Object.keys(record).sort().join(",") !== "ok,response" ||
    !validateContract(
      "punks://contracts/message.reaction-mutation-response@1",
      record.response,
    ).valid
  ) {
    return null;
  }
  const response = record.response as MessageReactionMutationResponse;
  const effectAllowed =
    (operation === "add" &&
      (response.effect === "added" || response.effect === "unchanged")) ||
    (operation === "remove" &&
      (response.effect === "removed" || response.effect === "unchanged")) ||
    (operation === "toggle" &&
      (response.effect === "added" || response.effect === "removed"));
  if (!effectAllowed) {
    return null;
  }
  if (
    !response.replayed &&
    ((response.effect === "added" && response.reaction === null) ||
      (response.effect === "removed" && response.reaction !== null) ||
      (response.effect === "unchanged" &&
        ((operation === "add" && response.reaction === null) ||
          (operation === "remove" && response.reaction !== null))))
  ) {
    return null;
  }
  let canonicalReaction: string;
  try {
    canonicalReaction = canonicalMessageReaction(command.payload.reaction);
  } catch {
    return null;
  }
  const expectedReactionId = await deriveOpaqueUuid(
    "punks.message-reaction.v1",
    canonicalJson({
      workspaceId: command.workspaceId,
      conversationId: command.conversationId,
      messageId: command.messageId,
      actor: command.actor,
      reaction: canonicalReaction,
    }),
  );
  if (
    response.reaction !== null &&
    (response.reaction.id !== expectedReactionId ||
      response.reaction.workspaceId !== command.workspaceId ||
      response.reaction.conversationId !== command.conversationId ||
      response.reaction.messageId !== command.messageId ||
      response.reaction.actor.kind !== "punk" ||
      response.reaction.actor.punkId !== punkId ||
      response.reaction.reaction !== canonicalReaction)
  ) {
    return null;
  }
  return record as Extract<MessageReactionMutationResult, { ok: true }>;
}

function validateMessageSearchRpcResult(
  value: unknown,
): MessageSearchResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    return Object.keys(record).sort().join(",") === "ok,responseJson" &&
      typeof record.responseJson === "string"
      ? (record as Extract<MessageSearchResult, { ok: true }>)
      : null;
  }
  if (
    record.ok !== false ||
    Object.keys(record).sort().join(",") !== "code,ok" ||
    (record.code !== "invalid_contract" &&
      record.code !== "cursor_invalid" &&
      record.code !== "not_found" &&
      record.code !== "forbidden" &&
      record.code !== "content_unavailable" &&
      record.code !== "search_unavailable" &&
      record.code !== "internal")
  ) {
    return null;
  }
  return record as Extract<MessageSearchResult, { ok: false }>;
}

function requireMatchingIdempotencyKey(
  request: Request,
  commandId: string,
): Response | null {
  const key = request.headers.get("idempotency-key");
  if (key === null || key !== commandId) {
    return problem(
      400,
      "invalid_input",
      "Idempotency-Key must be present and equal commandId",
    );
  }
  return null;
}

async function createWorkspace(
  request: Request,
  env: ApiEnv,
): Promise<Response> {
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(
      401,
      "unauthenticated",
      "Operator authentication is required",
    );
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Request body must be valid JSON under 64 KB",
    );
  }
  if (!validateContract("punks://contracts/workspace.create@1", body).valid) {
    return problem(400, "invalid_input", "Workspace create command is invalid");
  }
  const command = body as CreateWorkspaceCommand;
  let ownerExists: boolean;
  try {
    ownerExists = await env.AUTH_SERVICE.punkExists(command.actor.punkId);
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Punk identity service is unavailable",
    );
  }
  if (!ownerExists) {
    return problem(
      400,
      "invalid_input",
      "Initial Workspace owner does not exist",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }

  const requestedWorkspaceId = await deriveOpaqueUuid(
    "punks.workspace.v1",
    command.commandId,
  );
  const slug = env.WORKSPACE_SLUGS.getByName(command.payload.slug);
  const claim = await slug.claim({
    slug: command.payload.slug,
    workspaceId: requestedWorkspaceId,
    commandId: command.commandId,
  });
  if (!claim.ok) {
    return problem(409, "slug_claimed", "Workspace slug is already claimed");
  }

  const workspace = env.WORKSPACES.getByName(claim.workspaceId);
  const result = await workspace.execute(command);
  if (!result.ok) {
    if (
      result.code !== "attestation_failed" &&
      result.code !== "command_in_progress" &&
      result.code !== "internal"
    ) {
      await slug.release({
        workspaceId: claim.workspaceId,
        commandId: command.commandId,
      });
    }
    return executeFailure(result);
  }

  const activated = await slug.activate({
    slug: command.payload.slug,
    workspaceId: claim.workspaceId,
    commandId: command.commandId,
  });
  if (!activated) {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace slug activation is incomplete",
      {
        retry: "same_command",
      },
    );
  }

  return json(
    {
      workspace: result.value.state,
      event: result.value.event,
      replayed: claim.replayed || result.replayed,
      canonicalPath: `/w/${result.value.state.slug}`,
    },
    claim.replayed || result.replayed ? 200 : 201,
    { "cache-control": "no-store", location: `/w/${result.value.state.slug}` },
  );
}

async function createConversation(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
): Promise<Response> {
  const actorPunkId = await authenticatedPunkId(request, env);
  if (actorPunkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Conversation command must be valid JSON under 64 KB",
    );
  }
  if (
    !validateContract("punks://contracts/conversation.create@1", body).valid
  ) {
    return problem(
      400,
      "invalid_input",
      "Conversation create command is invalid",
    );
  }
  const command = body as CreateConversationCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.actor.punkId !== actorPunkId
  ) {
    return problem(
      403,
      "forbidden",
      "Conversation command actor and path must match the authenticated request",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const conversationId = await deriveOpaqueUuid(
    "punks.conversation.v1",
    canonicalJson({ commandId: command.commandId, workspaceId }),
  );
  const identityClaim =
    command.payload.type === "dm"
      ? {
          workspaceId,
          participantSetHash: await sha256Hex(
            canonicalJson(
              [
                ...new Set([
                  command.actor.punkId,
                  ...(command.payload.participantPunkIds ?? []),
                ]),
              ].sort(),
            ),
          ),
          conversationId,
          commandId: command.commandId,
        }
      : null;
  const identity =
    identityClaim === null
      ? null
      : env.CONVERSATION_IDENTITIES.getByName(
          `${workspaceId}:dm:${identityClaim.participantSetHash}`,
        );
  if (identity !== null && identityClaim !== null) {
    const claimed = await identity.claim(identityClaim);
    if (!claimed.ok) {
      return problem(
        409,
        "command_in_progress",
        "Another direct Conversation creation is in progress",
        { retry: "later", retryAfterMs: 1_000 },
      );
    }
    if (
      claimed.status === "active" &&
      (!claimed.sameCommand || claimed.conversationId !== conversationId)
    ) {
      const access = await env.WORKSPACES.getByName(workspaceId).authorize({
        workspaceId,
        punkId: actorPunkId,
        permission: "workspace.read",
      });
      if (!access.ok) {
        return problem(
          access.code === "not_found" ? 404 : 403,
          access.code === "not_found" ? "not_found" : "forbidden",
          "Current Workspace membership is required",
        );
      }
      const existing = await env.CONVERSATIONS.getByName(
        claimed.conversationId,
      ).query({
        contract: "conversation.get@1",
        workspaceId,
        conversationId: claimed.conversationId,
      });
      if (!existing.ok) {
        return problem(
          503,
          "temporarily_unavailable",
          "Direct Conversation identity is active but its aggregate is unavailable",
          { retry: "later", retryAfterMs: 1_000 },
        );
      }
      return json(
        {
          conversation: existing.state,
          existing: true,
          replayed: false,
          canonicalPath: `/w/${workspaceId}/conversations/${claimed.conversationId}`,
        },
        200,
        {
          "cache-control": "no-store",
          location: `/w/${workspaceId}/conversations/${claimed.conversationId}`,
        },
      );
    }
  }
  const result =
    await env.CONVERSATIONS.getByName(conversationId).execute(command);
  if (!result.ok) {
    if (
      identity !== null &&
      identityClaim !== null &&
      result.code !== "attestation_failed" &&
      result.code !== "command_in_progress" &&
      result.code !== "internal"
    ) {
      await identity.release(identityClaim);
    }
    return conversationExecuteFailure(result);
  }
  if (
    identity !== null &&
    identityClaim !== null &&
    !(await identity.activate(identityClaim))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Direct Conversation identity activation is incomplete",
      { retry: "same_command", retryAfterMs: 1_000 },
    );
  }
  return json(
    {
      conversation: result.value.state,
      replayed: result.replayed,
      canonicalPath: `/w/${workspaceId}/conversations/${conversationId}`,
    },
    result.replayed ? 200 : 201,
    {
      "cache-control": "no-store",
      location: `/w/${workspaceId}/conversations/${conversationId}`,
    },
  );
}

async function mutateConversation(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
  operation:
    | "join"
    | "set-access"
    | "remove-member"
    | "update"
    | "archive"
    | "restore",
  targetPunkId?: string,
): Promise<Response> {
  const actorPunkId = await authenticatedPunkId(request, env);
  if (actorPunkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Conversation command must be valid JSON under 64 KB",
    );
  }
  const contractId = (() => {
    switch (operation) {
      case "join":
        return "punks://contracts/conversation.join@1";
      case "set-access":
        return "punks://contracts/conversation.member-set-access@1";
      case "remove-member":
        return "punks://contracts/conversation.member-remove@1";
      case "update":
        return "punks://contracts/conversation.update@1";
      case "archive":
        return "punks://contracts/conversation.archive@1";
      case "restore":
        return "punks://contracts/conversation.restore@1";
    }
  })();
  if (!validateContract(contractId, body).valid) {
    return problem(400, "invalid_input", "Conversation command is invalid");
  }
  const command = body as
    | JoinConversationCommand
    | SetConversationMemberAccessCommand
    | RemoveConversationMemberCommand
    | UpdateConversationCommand
    | ArchiveConversationCommand
    | RestoreConversationCommand;
  const commandTarget =
    command.contract === "conversation.join@1" ||
    command.contract === "conversation.update@1" ||
    command.contract === "conversation.archive@1" ||
    command.contract === "conversation.restore@1"
      ? undefined
      : command.payload.targetPunkId;
  if (
    command.workspaceId !== workspaceId ||
    command.conversationId !== conversationId ||
    command.actor.punkId !== actorPunkId ||
    commandTarget !== targetPunkId
  ) {
    return problem(
      403,
      "forbidden",
      "Conversation command actor and path must match the authenticated request",
    );
  }
  if (
    command.contract === "conversation.archive@1" &&
    command.payload.cause !== "manual"
  ) {
    return problem(
      403,
      "forbidden",
      "Only the Conversation authority can submit TTL expiration",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const result =
    await env.CONVERSATIONS.getByName(conversationId).execute(command);
  if (!result.ok) {
    return conversationExecuteFailure(result);
  }
  return json(
    {
      conversation: result.value.state,
      replayed: result.replayed,
    },
    200,
    { "cache-control": "no-store" },
  );
}

function conversationView(state: Conversation): ConversationView {
  return {
    id: state.id,
    workspaceId: state.workspaceId,
    name: state.name,
    type: state.type,
    visibility: state.visibility,
    description: state.description,
    topic: state.topic,
    purpose: state.purpose,
    topicRequired: state.topicRequired,
    maxMembers: state.maxMembers,
    ttlSeconds: state.ttlSeconds,
    ttlDeadline: state.ttlDeadline,
    status: state.status,
    revision: state.revision,
    cursor: state.cursor,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    archivedAt: state.archivedAt,
  };
}

async function getConversation(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
): Promise<Response> {
  const result = await env.CONVERSATIONS.getByName(conversationId).query({
    contract: "conversation.get@1",
    workspaceId,
    conversationId,
  });
  if (!result.ok) {
    return problem(404, "not_found", "Conversation not found");
  }
  const state = result.state as unknown as Conversation;
  const workspaceResult = await env.WORKSPACES.getByName(workspaceId).query({
    contract: "workspace.get@1",
    workspaceId,
  });
  if (!workspaceResult.ok) {
    return problem(404, "not_found", "Workspace not found");
  }
  const operator = isOperator(request, env.OPERATOR_PROVISIONING_TOKEN);
  const punkId = operator ? null : await authenticatedPunkId(request, env);
  const workspaceMember =
    punkId === null
      ? null
      : (workspaceResult.state.members.find(
          (member) => member.punkId === punkId,
        ) ?? null);
  if (
    workspaceResult.state.visibility !== "public" &&
    !operator &&
    punkId === null
  ) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  if (
    workspaceResult.state.visibility === "private" &&
    !operator &&
    workspaceMember === null
  ) {
    return problem(403, "forbidden", "Workspace membership is required");
  }
  const member =
    punkId === null
      ? null
      : (state.members.find((candidate) => candidate.punkId === punkId) ??
        null);
  if (
    state.visibility === "private" &&
    !operator &&
    (workspaceMember === null || member === null)
  ) {
    return problem(
      403,
      "forbidden",
      "Private Conversation membership is required",
    );
  }
  const full = operator || member !== null;
  const responseConversation = full ? state : conversationView(state);
  if (
    !full &&
    !validateContract(
      "punks://contracts/conversation.view@1",
      responseConversation,
    ).valid
  ) {
    return problem(500, "internal", "Conversation view violated its contract");
  }
  return json(
    {
      conversation: responseConversation,
      canonicalPath: `/w/${workspaceId}/conversations/${conversationId}`,
    },
    200,
    {
      "cache-control":
        workspaceResult.state.visibility === "public" && !full
          ? "public, max-age=30"
          : "no-store",
      etag: `"${conversationId}:${state.cursor}"`,
    },
  );
}

async function mutateMember(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  targetPunkId: string,
  operation: "set-role" | "remove",
): Promise<Response> {
  const actorPunkId = await authenticatedPunkId(request, env);
  if (actorPunkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Membership command must be valid JSON under 64 KB",
    );
  }
  const contractId =
    operation === "set-role"
      ? "punks://contracts/workspace.member-set-role@1"
      : "punks://contracts/workspace.member-remove@1";
  if (!validateContract(contractId, body).valid) {
    return problem(400, "invalid_input", "Membership command is invalid");
  }
  const command = body as
    | SetWorkspaceMemberRoleCommand
    | RemoveWorkspaceMemberCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.payload.targetPunkId !== targetPunkId ||
    command.actor.punkId !== actorPunkId
  ) {
    return problem(
      403,
      "forbidden",
      "Membership command actor and path must match the authenticated request",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  if (operation === "set-role") {
    let targetExists: boolean;
    try {
      targetExists = await env.AUTH_SERVICE.punkExists(targetPunkId);
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Punk identity service is unavailable",
      );
    }
    if (!targetExists) {
      return problem(400, "invalid_input", "Target Punk does not exist");
    }
  }
  const result = await env.WORKSPACES.getByName(workspaceId).execute(command);
  if (!result.ok) {
    return executeFailure(result);
  }
  return json(
    {
      workspace: result.value.state,
      replayed: result.replayed,
    },
    200,
    { "cache-control": "no-store" },
  );
}

async function renameWorkspace(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
): Promise<Response> {
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(
      401,
      "unauthenticated",
      "Operator authentication is required",
    );
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Request body must be valid JSON under 64 KB",
    );
  }
  if (!validateContract("punks://contracts/workspace.rename@1", body).valid) {
    return problem(400, "invalid_input", "Workspace rename command is invalid");
  }
  const command = body as RenameWorkspaceCommand;
  if (command.workspaceId !== workspaceId) {
    return problem(
      400,
      "invalid_input",
      "Path Workspace id must equal command Workspace id",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }

  const workspace = env.WORKSPACES.getByName(workspaceId);
  const current = await workspace.query({
    contract: "workspace.get@1",
    workspaceId,
  });
  if (!current.ok) {
    return problem(404, "not_found", "Workspace not found");
  }
  let previousSlug = current.state.slug;

  const nextSlug = env.WORKSPACE_SLUGS.getByName(command.payload.slug);
  const claim = await nextSlug.claim({
    slug: command.payload.slug,
    workspaceId,
    commandId: command.commandId,
  });
  if (!claim.ok || claim.workspaceId !== workspaceId) {
    return problem(409, "slug_claimed", "Workspace slug is already claimed");
  }

  const result = await workspace.execute(command);
  if (!result.ok) {
    if (
      result.code !== "attestation_failed" &&
      result.code !== "command_in_progress" &&
      result.code !== "internal"
    ) {
      await nextSlug.release({ workspaceId, commandId: command.commandId });
    }
    return executeFailure(result);
  }

  try {
    const eventContent = JSON.parse(result.value.event.content) as unknown;
    if (
      typeof eventContent === "object" &&
      eventContent !== null &&
      "previousSlug" in eventContent
    ) {
      const recordedPreviousSlug = Reflect.get(eventContent, "previousSlug");
      if (
        typeof recordedPreviousSlug === "string" &&
        workspaceSlugPattern.test(recordedPreviousSlug)
      ) {
        previousSlug = recordedPreviousSlug;
      }
    }
  } catch {
    return problem(500, "internal", "Committed rename event is unreadable");
  }

  const activated = await nextSlug.activate({
    slug: command.payload.slug,
    workspaceId,
    commandId: command.commandId,
  });
  const oldSlug = env.WORKSPACE_SLUGS.getByName(previousSlug);
  const redirected = await oldSlug.redirect({
    workspaceId,
    slug: command.payload.slug,
  });
  if (!activated || !redirected) {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace slug transition is incomplete",
      {
        retry: "same_command",
      },
    );
  }

  return json(
    {
      workspace: result.value.state,
      replayed: result.replayed,
      canonicalPath: `/w/${result.value.state.slug}`,
    },
    200,
    { "cache-control": "no-store", location: `/w/${result.value.state.slug}` },
  );
}

async function getWorkspace(
  request: Request,
  env: ApiEnv,
  slugValue: string,
): Promise<Response> {
  if (!workspaceSlugPattern.test(slugValue)) {
    return problem(404, "not_found", "Workspace not found");
  }
  const slug = env.WORKSPACE_SLUGS.getByName(slugValue);
  const resolution = await slug.resolve();
  if (resolution.status === "missing") {
    return problem(404, "not_found", "Workspace not found");
  }
  if (resolution.status === "pending") {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace is being provisioned",
      {
        retry: "later",
        retryAfterMs: 1_000,
      },
    );
  }
  if (resolution.status === "redirect") {
    return json(
      {
        workspaceId: resolution.workspaceId,
        canonicalPath: `/w/${resolution.slug}`,
      },
      308,
      {
        "cache-control": "public, max-age=60",
        location: `/api/v1/workspaces/${resolution.slug}`,
      },
    );
  }

  const workspace = env.WORKSPACES.getByName(resolution.workspaceId);
  const result = await workspace.query({
    contract: "workspace.get@1",
    workspaceId: resolution.workspaceId,
  });
  if (!result.ok) {
    return problem(404, "not_found", "Workspace not found");
  }

  const state = result.state as unknown as Workspace;
  if (state.slug !== slugValue) {
    await slug.redirect({ workspaceId: state.id, slug: state.slug });
    return json(
      { workspaceId: state.id, canonicalPath: `/w/${state.slug}` },
      308,
      {
        "cache-control": "public, max-age=60",
        location: `/api/v1/workspaces/${state.slug}`,
      },
    );
  }
  const operator = isOperator(request, env.OPERATOR_PROVISIONING_TOKEN);
  const punkId = operator ? null : await authenticatedPunkId(request, env);
  const member =
    punkId === null
      ? false
      : state.members.some((candidate) => candidate.punkId === punkId);
  if (state.visibility !== "public" && !operator && punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  if (state.visibility === "private" && !operator && !member) {
    return problem(403, "forbidden", "Workspace membership is required");
  }
  const publicView: PublicWorkspaceView | null =
    state.visibility === "public"
      ? {
          id: state.id,
          slug: state.slug,
          name: state.name,
          visibility: "public",
          status: state.status,
          revision: state.revision,
          cursor: state.cursor,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        }
      : null;
  const punksView: PunksWorkspaceView | null =
    state.visibility === "punks" && !member && !operator
      ? {
          id: state.id,
          slug: state.slug,
          name: state.name,
          visibility: "punks",
          status: state.status,
          revision: state.revision,
          cursor: state.cursor,
          createdAt: state.createdAt,
          updatedAt: state.updatedAt,
        }
      : null;
  if (
    publicView !== null &&
    !validateContract("punks://contracts/workspace.public-view@1", publicView)
      .valid
  ) {
    return problem(
      500,
      "internal",
      "Public Workspace view violated its contract",
    );
  }
  if (
    punksView !== null &&
    !validateContract("punks://contracts/workspace.punks-view@1", punksView)
      .valid
  ) {
    return problem(
      500,
      "internal",
      "Punks Workspace view violated its contract",
    );
  }
  return json(
    {
      workspace: operator || member ? state : (publicView ?? punksView),
      canonicalPath: `/w/${state.slug}`,
    },
    200,
    {
      "cache-control":
        state.visibility === "public" ? "public, max-age=30" : "no-store",
      etag: `"${state.id}:${state.cursor}"`,
    },
  );
}

async function postMessage(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 70 * 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Message post command must be valid JSON under 70 KiB",
    );
  }
  if (!validateContract("punks://contracts/message.post@1", body).valid) {
    return problem(400, "invalid_input", "Message post command is invalid");
  }
  const command = body as PostMessageCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.conversationId !== conversationId
  ) {
    return problem(404, "not_found", "Conversation or Workspace not found");
  }
  if (command.actor.kind !== "punk") {
    return problem(
      403,
      "forbidden",
      "Public Bot Message posting is not enabled",
    );
  }
  if (command.actor.punkId !== punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  if (
    !messageContentEnvelopeFits(command.payload.content, command.payload.topic)
  ) {
    return problem(
      413,
      "payload_too_large",
      "Canonical Message content and topic exceed 64 KiB",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const messageId = await deriveOpaqueUuid(
    "punks.message.v1",
    canonicalJson({
      workspaceId,
      conversationId,
      commandId: command.commandId,
    }),
  );
  const result = await env.CONVERSATIONS.getByName(conversationId).postMessage({
    messageId,
    command,
  });
  if (!result.ok) {
    return messagePostFailure(result);
  }
  const read = await env.CONVERSATIONS.getByName(conversationId).readMessage({
    workspaceId,
    conversationId,
    messageId,
    punkId,
  });
  if (read.ok !== true) {
    return messageReadFailure(read);
  }
  const messageView = parseMessageView(read.messageJson);
  if (messageView === null) {
    return problem(500, "internal", "Message view violated its contract");
  }
  const responseBody: PostMessageResponse = {
    message: messageView,
    replayed: result.replayed,
  };
  if (
    !validateContract("punks://contracts/message.post-response@1", responseBody)
      .valid
  ) {
    return problem(500, "internal", "Message response violated its contract");
  }
  return json(responseBody, result.replayed ? 200 : 201, {
    "cache-control": "no-store",
    location: `/w/${workspaceId}/conversations/${conversationId}/messages/${messageId}`,
  });
}

async function editMessage(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
  messageId: string,
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 70 * 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Message edit command must be valid JSON under 70 KiB",
    );
  }
  if (!validateContract("punks://contracts/message.edit@1", body).valid) {
    return problem(400, "invalid_input", "Message edit command is invalid");
  }
  const command = body as EditMessageCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.conversationId !== conversationId ||
    command.messageId !== messageId
  ) {
    return problem(
      404,
      "not_found",
      "Message, Conversation or Workspace not found",
    );
  }
  if (command.actor.kind !== "punk") {
    return problem(
      403,
      "forbidden",
      "Public Bot Message editing is not enabled",
    );
  }
  if (command.actor.punkId !== punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  if (
    !messageContentEnvelopeFits(command.payload.content, command.payload.topic)
  ) {
    return problem(
      413,
      "payload_too_large",
      "Canonical Message content and topic exceed 64 KiB",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const result = await env.CONVERSATIONS.getByName(
    conversationId,
  ).mutateMessage({
    messageId,
    command,
  });
  if (!result.ok) {
    return messageMutationFailure(result);
  }
  const read = await env.CONVERSATIONS.getByName(conversationId).readMessage({
    workspaceId,
    conversationId,
    messageId,
    punkId,
  });
  if (read.ok !== true) {
    return messageReadFailure(read);
  }
  const messageView = parseMessageView(read.messageJson);
  if (messageView === null) {
    return problem(500, "internal", "Message view violated its contract");
  }
  const responseBody: MessageMutationResponse = {
    message: messageView,
    replayed: result.replayed,
  };
  if (
    !validateContract(
      "punks://contracts/message.mutation-response@1",
      responseBody,
    ).valid
  ) {
    return problem(500, "internal", "Message response violated its contract");
  }
  return json(responseBody, 200, {
    "cache-control": "no-store",
    location: `/w/${workspaceId}/conversations/${conversationId}/messages/${messageId}`,
  });
}

async function mutateMessageState(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  operation: "retract" | "restore",
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 16 * 1_024);
  } catch {
    return problem(400, "invalid_input", "Message mutation must be valid JSON");
  }
  const contractId =
    operation === "retract"
      ? "punks://contracts/message.retract@1"
      : "punks://contracts/message.restore@1";
  if (!validateContract(contractId, body).valid) {
    return problem(
      400,
      "invalid_input",
      `Message ${operation} command is invalid`,
    );
  }
  const command = body as RetractMessageCommand | RestoreMessageCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.conversationId !== conversationId ||
    command.messageId !== messageId
  ) {
    return problem(
      404,
      "not_found",
      "Message, Conversation or Workspace not found",
    );
  }
  if (command.actor.kind !== "punk") {
    return problem(
      403,
      "forbidden",
      "Public Bot Message mutation is not enabled",
    );
  }
  if (command.actor.punkId !== punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const result = await env.CONVERSATIONS.getByName(
    conversationId,
  ).mutateMessage({
    messageId,
    command,
  });
  if (!result.ok) {
    return messageMutationFailure(result);
  }
  const read = await env.CONVERSATIONS.getByName(conversationId).readMessage({
    workspaceId,
    conversationId,
    messageId,
    punkId,
  });
  if (read.ok !== true) {
    return messageReadFailure(read);
  }
  const messageView = parseMessageView(read.messageJson);
  if (messageView === null) {
    return problem(500, "internal", "Message view violated its contract");
  }
  const responseBody: MessageMutationResponse = {
    message: messageView,
    replayed: result.replayed,
  };
  if (
    !validateContract(
      "punks://contracts/message.mutation-response@1",
      responseBody,
    ).valid
  ) {
    return problem(500, "internal", "Message response violated its contract");
  }
  return json(responseBody, 200, {
    "cache-control": "no-store",
    location: `/w/${workspaceId}/conversations/${conversationId}/messages/${messageId}`,
  });
}

async function mutateMessageReaction(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
  messageId: string,
  operation: "add" | "remove" | "toggle",
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 8 * 1_024);
  } catch {
    return problem(400, "invalid_input", "Reaction command must be valid JSON");
  }
  const contractId =
    operation === "add"
      ? "punks://contracts/message.reaction-add@1"
      : operation === "remove"
        ? "punks://contracts/message.reaction-remove@1"
        : "punks://contracts/message.reaction-toggle@1";
  if (!validateContract(contractId, body).valid) {
    return problem(400, "invalid_input", "Reaction command is invalid");
  }
  const command = body as
    | AddMessageReactionCommand
    | RemoveMessageReactionCommand
    | ToggleMessageReactionCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.conversationId !== conversationId ||
    command.messageId !== messageId
  ) {
    return problem(
      404,
      "not_found",
      "Message, Conversation or Workspace not found",
    );
  }
  if (command.actor.kind !== "punk") {
    return problem(
      403,
      "forbidden",
      "Public Bot Reaction mutation is not enabled",
    );
  }
  if (command.actor.punkId !== punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  let rawResult: unknown;
  try {
    rawResult = await env.CONVERSATIONS.getByName(
      conversationId,
    ).mutateMessageReaction({ command });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Reaction mutation is temporarily unavailable",
      { retry: "same_command", retryAfterMs: 1_000 },
    );
  }
  const result = await validateMessageReactionMutationRpcResult(
    rawResult,
    command,
    operation,
    punkId,
  );
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Reaction mutation is temporarily unavailable",
      { retry: "same_command", retryAfterMs: 1_000 },
    );
  }
  if (result.ok !== true) {
    return messageReactionFailure(result);
  }
  const responseBody: MessageReactionMutationResponse = result.response;
  if (
    !validateContract(
      "punks://contracts/message.reaction-mutation-response@1",
      responseBody,
    ).valid
  ) {
    return problem(500, "internal", "Reaction response violated its contract");
  }
  return json(
    responseBody,
    operation === "add" &&
      responseBody.effect === "added" &&
      !responseBody.replayed
      ? 201
      : 200,
    { "cache-control": "no-store" },
  );
}

function parseMessageView(value: string): MessageView | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return validateContract("punks://contracts/message.view@1", parsed).valid
      ? (parsed as MessageView)
      : null;
  } catch {
    return null;
  }
}

async function messageHistory(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  const params = new URL(request.url).searchParams;
  const allowed = new Set([
    "cursor",
    "direction",
    "limit",
    "threadRootMessageId",
  ]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) {
      return problem(400, "invalid_input", "Message history query is invalid");
    }
  }
  const limitValue = params.get("limit") ?? "50";
  if (!/^(?:[1-9]|[1-9][0-9]|100)$/u.test(limitValue)) {
    return problem(400, "invalid_input", "Message history limit is invalid");
  }
  const cursor = params.get("cursor");
  if (params.has("cursor") && (cursor === null || cursor.length === 0)) {
    return problem(400, "invalid_input", "Message history cursor is invalid");
  }
  const directionValue = params.get("direction");
  if (
    directionValue !== null &&
    directionValue !== "older" &&
    directionValue !== "newer"
  ) {
    return problem(
      400,
      "invalid_input",
      "Message history direction is invalid",
    );
  }
  const threadRootMessageId = params.get("threadRootMessageId");
  const query = {
    contract: "message.history@1",
    workspaceId,
    conversationId,
    cursor,
    limit: Number(limitValue),
    ...(cursor === null
      ? { direction: directionValue ?? "older" }
      : directionValue === null
        ? {}
        : { direction: directionValue }),
    ...(threadRootMessageId === null ? {} : { threadRootMessageId }),
  } as MessageHistoryQuery;
  if (!validateContract("punks://contracts/message.history@1", query).valid) {
    return problem(400, "invalid_input", "Message history query is invalid");
  }
  const result = await env.CONVERSATIONS.getByName(conversationId).history({
    query,
    punkId,
  });
  if (!result.ok) {
    return messageHistoryFailure(result);
  }
  let response: MessageHistoryResponse;
  try {
    response = JSON.parse(result.responseJson) as MessageHistoryResponse;
  } catch {
    return problem(500, "internal", "Message history response is invalid");
  }
  if (
    !validateContract("punks://contracts/message.history-response@1", response)
      .valid
  ) {
    return problem(500, "internal", "Message history response is invalid");
  }
  return json(response, 200, {
    "cache-control": "no-store",
    etag: `"${conversationId}:history:${response.highWaterCursor}:${response.nextCursor ?? "end"}"`,
  });
}

async function searchMessages(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  conversationId: string,
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 4 * 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Message search query must be valid JSON under 4 KiB",
    );
  }
  if (!validateContract("punks://contracts/message.search@1", body).valid) {
    return problem(400, "invalid_input", "Message search query is invalid");
  }
  const query = body as MessageSearchQuery;
  if (
    query.workspaceId !== workspaceId ||
    query.conversationId !== conversationId
  ) {
    return problem(404, "not_found", "Conversation or Workspace not found");
  }
  let rawResult: unknown;
  try {
    rawResult = await env.CONVERSATIONS.getByName(
      conversationId,
    ).searchMessages({ query, punkId });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Message search is temporarily unavailable",
      { retry: "later", retryAfterMs: 1_000 },
    );
  }
  const result = validateMessageSearchRpcResult(rawResult);
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Message search is temporarily unavailable",
      { retry: "later", retryAfterMs: 1_000 },
    );
  }
  if (result.ok !== true) {
    return messageSearchFailure(result);
  }
  if (new TextEncoder().encode(result.responseJson).byteLength > 1_048_576) {
    return problem(
      503,
      "temporarily_unavailable",
      "Message search is temporarily unavailable",
      { retry: "later", retryAfterMs: 1_000 },
    );
  }
  let response: MessageSearchResponse;
  try {
    response = JSON.parse(result.responseJson) as MessageSearchResponse;
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Message search is temporarily unavailable",
      { retry: "later", retryAfterMs: 1_000 },
    );
  }
  if (
    !validateContract("punks://contracts/message.search-response@1", response)
      .valid
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Message search is temporarily unavailable",
      { retry: "later", retryAfterMs: 1_000 },
    );
  }
  return json(response, 200, { "cache-control": "no-store" });
}

async function publishBot(request: Request, env: ApiEnv): Promise<Response> {
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(
      401,
      "unauthenticated",
      "Operator authentication is required",
    );
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Bot command must be valid JSON under 64 KB",
    );
  }
  if (!validateContract("punks://contracts/bot.publish@1", body).valid) {
    return problem(400, "invalid_input", "Bot publish command is invalid");
  }
  const command = body as PublishBotCommand;
  let actorExists: boolean;
  try {
    actorExists = await env.AUTH_SERVICE.punkExists(command.actor.punkId);
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Punk identity service is unavailable",
    );
  }
  if (!actorExists) {
    return problem(400, "invalid_input", "Punks Operator actor does not exist");
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const botId = await deriveOpaqueUuid("punks.bot.v1", command.commandId);
  const slug = env.BOT_SLUGS.getByName(command.payload.slug);
  let rawClaim: unknown;
  try {
    rawClaim = await slug.claim({
      slug: command.payload.slug,
      botId,
      commandId: command.commandId,
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot slug authority is unavailable",
    );
  }
  const claim = validateBotSlugClaim(rawClaim, botId);
  if (claim === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot slug response is invalid",
    );
  }
  if (!claim.ok) {
    return claim.code === "slug_claimed"
      ? problem(409, "slug_claimed", "Bot slug is already claimed")
      : problem(500, "internal", "Bot slug claim was rejected");
  }
  let rawResult: unknown;
  try {
    rawResult = await env.BOTS.getByName(botId).execute({
      command,
      operatorAuthorized: true,
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot authority is unavailable",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  const result = await validateBotExecuteRpcResult(rawResult, command, botId);
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot authority response is invalid",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  if (!result.ok) {
    if (
      result.code !== "attestation_failed" &&
      result.code !== "command_in_progress" &&
      result.code !== "temporarily_unavailable" &&
      result.code !== "internal"
    ) {
      let released = false;
      try {
        released =
          (await slug.release({
            botId,
            commandId: command.commandId,
          })) === true;
      } catch {
        released = false;
      }
      if (!released) {
        return problem(
          503,
          "temporarily_unavailable",
          "Bot slug release is incomplete",
          {
            retry: "same_command",
            retryAfterMs: 1_000,
          },
        );
      }
    }
    return botExecuteFailure(result);
  }
  let activated = false;
  try {
    activated =
      (await slug.activate({
        slug: command.payload.slug,
        botId,
        commandId: command.commandId,
      })) === true;
  } catch {
    activated = false;
  }
  if (!activated) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot slug activation is incomplete",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  return json(
    {
      bot: result.value.state,
      event: result.value.event,
      replayed: claim.replayed || result.replayed,
      canonicalPath: `/bots/${result.value.state.slug}`,
    },
    claim.replayed || result.replayed ? 200 : 201,
    {
      "cache-control": "no-store",
      location: `/bots/${result.value.state.slug}`,
    },
  );
}

async function updateBot(
  request: Request,
  env: ApiEnv,
  botId: string,
): Promise<Response> {
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(
      401,
      "unauthenticated",
      "Operator authentication is required",
    );
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Bot command must be valid JSON under 64 KB",
    );
  }
  if (!validateContract("punks://contracts/bot.update@1", body).valid) {
    return problem(400, "invalid_input", "Bot update command is invalid");
  }
  const command = body as UpdateBotCommand;
  let actorExists: boolean;
  try {
    actorExists = await env.AUTH_SERVICE.punkExists(command.actor.punkId);
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Punk identity service is unavailable",
    );
  }
  if (!actorExists) {
    return problem(400, "invalid_input", "Punks Operator actor does not exist");
  }
  if (command.botId !== botId) {
    return problem(404, "not_found", "Bot not found");
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }

  const bot = env.BOTS.getByName(botId);
  let nextSlug: ReturnType<ApiEnv["BOT_SLUGS"]["getByName"]> | null = null;
  let claimReplayed = false;
  if (command.payload.operation === "set-slug") {
    const requestedSlug = command.payload.slug;
    nextSlug = env.BOT_SLUGS.getByName(requestedSlug);
    let rawClaim: unknown;
    try {
      rawClaim = await nextSlug.claim({
        slug: requestedSlug,
        botId,
        commandId: command.commandId,
      });
    } catch {
      return problem(
        503,
        "temporarily_unavailable",
        "Bot slug authority is unavailable",
      );
    }
    const claim = validateBotSlugClaim(rawClaim, botId);
    if (claim === null) {
      return problem(
        503,
        "temporarily_unavailable",
        "Bot slug response is invalid",
      );
    }
    if (!claim.ok) {
      return claim.code === "slug_claimed"
        ? problem(409, "slug_claimed", "Bot slug is already claimed")
        : problem(500, "internal", "Bot slug claim was rejected");
    }
    claimReplayed = claim.replayed;
  }

  let rawResult: unknown;
  try {
    rawResult = await bot.execute({ command, operatorAuthorized: true });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot authority is unavailable",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  const result = await validateBotExecuteRpcResult(rawResult, command, botId);
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot authority response is invalid",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  if (!result.ok) {
    if (
      nextSlug !== null &&
      result.code !== "attestation_failed" &&
      result.code !== "command_in_progress" &&
      result.code !== "temporarily_unavailable" &&
      result.code !== "internal"
    ) {
      let released = false;
      try {
        released =
          (await nextSlug.release({
            botId,
            commandId: command.commandId,
          })) === true;
      } catch {
        released = false;
      }
      if (!released) {
        return problem(
          503,
          "temporarily_unavailable",
          "Bot slug release is incomplete",
          {
            retry: "same_command",
            retryAfterMs: 1_000,
          },
        );
      }
    }
    return botExecuteFailure(result);
  }

  if (nextSlug !== null && command.payload.operation === "set-slug") {
    const previousSlug = result.value.previousSlug;
    if (previousSlug === null || !botSlugPattern.test(previousSlug)) {
      return problem(
        500,
        "internal",
        "Committed Bot rename lacks its previous slug",
      );
    }
    let activated = false;
    let redirected = false;
    try {
      activated =
        (await nextSlug.activate({
          slug: command.payload.slug,
          botId,
          commandId: command.commandId,
        })) === true;
      redirected =
        (await env.BOT_SLUGS.getByName(previousSlug).redirect({
          botId,
          slug: command.payload.slug,
        })) === true;
    } catch {
      activated = false;
      redirected = false;
    }
    if (!activated || !redirected) {
      return problem(
        503,
        "temporarily_unavailable",
        "Bot slug transition is incomplete",
        {
          retry: "same_command",
          retryAfterMs: 1_000,
        },
      );
    }
  }

  return json(
    {
      bot: result.value.state,
      event: result.value.event,
      replayed: claimReplayed || result.replayed,
      canonicalPath: `/bots/${result.value.state.slug}`,
    },
    200,
    {
      "cache-control": "no-store",
      location: `/bots/${result.value.state.slug}`,
    },
  );
}

async function getBot(env: ApiEnv, slugValue: string): Promise<Response> {
  if (!botSlugPattern.test(slugValue)) {
    return problem(404, "not_found", "Bot not found");
  }
  const slug = env.BOT_SLUGS.getByName(slugValue);
  let rawResolution: unknown;
  try {
    rawResolution = await slug.resolve();
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot slug authority is unavailable",
    );
  }
  const resolution = validateBotSlugResolution(rawResolution);
  if (resolution === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot slug response is invalid",
    );
  }
  if (resolution.status === "missing") {
    return problem(404, "not_found", "Bot not found");
  }
  if (resolution.status === "pending") {
    return problem(503, "temporarily_unavailable", "Bot is being published", {
      retry: "later",
      retryAfterMs: 1_000,
    });
  }
  if (resolution.status === "redirect") {
    return json(
      { botId: resolution.botId, canonicalPath: `/bots/${resolution.slug}` },
      308,
      {
        "cache-control": "public, max-age=60",
        location: `/api/v1/bots/${resolution.slug}`,
      },
    );
  }
  let rawResult: unknown;
  try {
    rawResult = await env.BOTS.getByName(resolution.botId).query({
      contract: "bot.get@1",
      botId: resolution.botId,
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot authority is unavailable",
      {
        retry: "later",
        retryAfterMs: 1_000,
      },
    );
  }
  const result = validateBotQueryRpcResult(rawResult, resolution.botId);
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot slug repair is pending",
      {
        retry: "later",
        retryAfterMs: 1_000,
      },
    );
  }
  if (!result.ok) {
    return result.code === "not_found"
      ? problem(404, "not_found", "Bot not found")
      : problem(
          503,
          "temporarily_unavailable",
          "Bot authority is unavailable",
          {
            retry: "later",
            retryAfterMs: 1_000,
          },
        );
  }
  if (result.state.slug !== slugValue) {
    let repaired = false;
    try {
      repaired =
        (await slug.redirect({
          botId: result.state.id,
          slug: result.state.slug,
        })) === true;
    } catch {
      repaired = false;
    }
    if (!repaired) {
      return problem(
        503,
        "temporarily_unavailable",
        "Bot slug repair is pending",
        {
          retry: "later",
          retryAfterMs: 1_000,
        },
      );
    }
    return json(
      { botId: result.state.id, canonicalPath: `/bots/${result.state.slug}` },
      308,
      {
        "cache-control": "public, max-age=60",
        location: `/api/v1/bots/${result.state.slug}`,
      },
    );
  }
  return json(
    { bot: result.state, canonicalPath: `/bots/${result.state.slug}` },
    200,
    {
      "cache-control": "public, max-age=30",
      etag: `"${result.state.id}:${result.state.cursor}"`,
    },
  );
}

async function installBotInWorkspace(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Bot Installation command must be valid JSON",
    );
  }
  if (
    !validateContract("punks://contracts/bot-installation.install@1", body)
      .valid
  ) {
    return problem(400, "invalid_input", "Bot Installation command is invalid");
  }
  const command = body as InstallBotCommand;
  if (command.workspaceId !== workspaceId || command.actor.punkId !== punkId) {
    return problem(
      403,
      "forbidden",
      "Installation path and Punk actor must match",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  const installationId = await deriveBotInstallationId(
    workspaceId,
    command.botId,
  );
  let rawResult: unknown;
  try {
    rawResult =
      await env.BOT_INSTALLATIONS.getByName(installationId).execute(command);
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot Installation authority is unavailable",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  const result = await validateBotInstallationExecuteRpcResult(
    rawResult,
    command,
    installationId,
  );
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot Installation response is invalid",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  if (!result.ok) {
    return botInstallationFailure(result);
  }
  return json(
    { installation: result.value.state, replayed: result.replayed },
    result.replayed ? 200 : 201,
    {
      "cache-control": "no-store",
      location: `/w/${workspaceId}/bot-installations/${installationId}`,
    },
  );
}

async function mutateBotInstallation(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  installationId: string,
  operation: "configure" | "revoke",
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Bot Installation command must be valid JSON",
    );
  }
  const contractId =
    operation === "configure"
      ? "punks://contracts/bot-installation.configure@1"
      : "punks://contracts/bot-installation.revoke@1";
  if (!validateContract(contractId, body).valid) {
    return problem(400, "invalid_input", "Bot Installation command is invalid");
  }
  const command = body as
    | ConfigureBotInstallationCommand
    | RevokeBotInstallationCommand;
  if (
    command.workspaceId !== workspaceId ||
    command.installationId !== installationId ||
    command.actor.punkId !== punkId
  ) {
    return problem(
      403,
      "forbidden",
      "Installation path and Punk actor must match",
    );
  }
  const idempotencyFailure = requireMatchingIdempotencyKey(
    request,
    command.commandId,
  );
  if (idempotencyFailure !== null) {
    return idempotencyFailure;
  }
  let rawResult: unknown;
  try {
    rawResult =
      await env.BOT_INSTALLATIONS.getByName(installationId).execute(command);
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot Installation authority is unavailable",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  const result = await validateBotInstallationExecuteRpcResult(
    rawResult,
    command,
    installationId,
  );
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot Installation response is invalid",
      {
        retry: "same_command",
        retryAfterMs: 1_000,
      },
    );
  }
  if (!result.ok) {
    return botInstallationFailure(result);
  }
  return json(
    { installation: result.value.state, replayed: result.replayed },
    200,
    { "cache-control": "no-store" },
  );
}

async function getBotInstallation(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  installationId: string,
): Promise<Response> {
  const punkId = await authenticatedPunkId(request, env);
  if (punkId === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let access: unknown;
  try {
    access = await env.WORKSPACES.getByName(workspaceId).authorize({
      workspaceId,
      punkId,
      permission: "bots.install",
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace authority is unavailable",
    );
  }
  const authorized = validateWorkspaceAuthorizationRpcResult(access);
  if (
    authorized === null ||
    (!authorized.ok && authorized.code === "invalid_request")
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Workspace authority response is invalid",
    );
  }
  if (!authorized.ok) {
    return authorized.code === "not_found"
      ? problem(404, "not_found", "Workspace not found")
      : problem(403, "forbidden", "Punk cannot read this Bot Installation");
  }
  let rawResult: unknown;
  try {
    rawResult = await env.BOT_INSTALLATIONS.getByName(installationId).query({
      contract: "bot-installation.get@1",
      workspaceId,
      installationId,
    });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot Installation authority is unavailable",
    );
  }
  const result = validateBotInstallationQueryRpcResult(
    rawResult,
    workspaceId,
    installationId,
  );
  if (result === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Bot Installation response is invalid",
    );
  }
  if (!result.ok) {
    return result.code === "not_found"
      ? problem(404, "not_found", "Bot Installation not found")
      : problem(
          503,
          "temporarily_unavailable",
          "Bot Installation authority is unavailable",
        );
  }
  return json({ installation: result.state }, 200, {
    "cache-control": "no-store",
    etag: `"${installationId}:${result.state.cursor}"`,
  });
}

export async function route(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "GET" && path === "/api/health") {
    return json({
      service: "punks-api",
      environment: env.ENVIRONMENT,
      status: "ok",
    });
  }
  if (request.method === "POST" && path === "/api/v1/desktop/compatibility") {
    return desktopCompatibility(request, env);
  }
  if (request.method === "GET" && path === "/api/v1/workspaces") {
    return listWorkspaces(request, env);
  }
  if (request.method === "POST" && path === "/api/internal/v1/workspaces") {
    return createWorkspace(request, env);
  }
  if (request.method === "POST" && path === "/api/internal/v1/bots") {
    return publishBot(request, env);
  }

  const botUpdate = path.match(/^\/api\/internal\/v1\/bots\/([^/]+)$/);
  if (request.method === "PATCH" && botUpdate?.[1] !== undefined) {
    return updateBot(request, env, decodeURIComponent(botUpdate[1]));
  }

  const botGet = path.match(/^\/api\/v1\/bots\/([^/]+)$/);
  if (request.method === "GET" && botGet?.[1] !== undefined) {
    return getBot(env, decodeURIComponent(botGet[1]));
  }

  const installationCollection = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/bot-installations$/,
  );
  if (request.method === "POST" && installationCollection?.[1] !== undefined) {
    return installBotInWorkspace(
      request,
      env,
      decodeURIComponent(installationCollection[1]),
    );
  }

  const installationRevoke = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/bot-installations\/([^/]+)\/revoke$/,
  );
  if (
    request.method === "POST" &&
    installationRevoke?.[1] !== undefined &&
    installationRevoke[2] !== undefined
  ) {
    return mutateBotInstallation(
      request,
      env,
      decodeURIComponent(installationRevoke[1]),
      decodeURIComponent(installationRevoke[2]),
      "revoke",
    );
  }

  const installation = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/bot-installations\/([^/]+)$/,
  );
  if (installation?.[1] !== undefined && installation[2] !== undefined) {
    const workspaceId = decodeURIComponent(installation[1]);
    const installationId = decodeURIComponent(installation[2]);
    if (request.method === "GET") {
      return getBotInstallation(request, env, workspaceId, installationId);
    }
    if (request.method === "PATCH") {
      return mutateBotInstallation(
        request,
        env,
        workspaceId,
        installationId,
        "configure",
      );
    }
  }

  const conversationCollection = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations$/,
  );
  if (request.method === "GET" && conversationCollection?.[1] !== undefined) {
    return listStreams(
      request,
      env,
      decodeURIComponent(conversationCollection[1]),
    );
  }
  if (request.method === "POST" && conversationCollection?.[1] !== undefined) {
    return createConversation(
      request,
      env,
      decodeURIComponent(conversationCollection[1]),
    );
  }

  const authorResolution = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/authors\/resolve$/,
  );
  if (request.method === "POST" && authorResolution?.[1] !== undefined) {
    return resolveAuthors(
      request,
      env,
      decodeURIComponent(authorResolution[1]),
    );
  }

  const conversationFollow = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/follow$/,
  );
  if (
    request.method === "GET" &&
    conversationFollow?.[1] !== undefined &&
    conversationFollow[2] !== undefined
  ) {
    return followConversation(
      request,
      env,
      decodeURIComponent(conversationFollow[1]),
      decodeURIComponent(conversationFollow[2]),
    );
  }

  const messageOperation = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)\/(retract|restore)$/,
  );
  if (
    request.method === "POST" &&
    messageOperation?.[1] !== undefined &&
    messageOperation[2] !== undefined &&
    messageOperation[3] !== undefined &&
    (messageOperation[4] === "retract" || messageOperation[4] === "restore")
  ) {
    return mutateMessageState(
      request,
      env,
      decodeURIComponent(messageOperation[1]),
      decodeURIComponent(messageOperation[2]),
      decodeURIComponent(messageOperation[3]),
      messageOperation[4],
    );
  }

  const messageReaction = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)\/reactions\/(add|remove|toggle)$/,
  );
  if (
    request.method === "POST" &&
    messageReaction?.[1] !== undefined &&
    messageReaction[2] !== undefined &&
    messageReaction[3] !== undefined &&
    (messageReaction[4] === "add" ||
      messageReaction[4] === "remove" ||
      messageReaction[4] === "toggle")
  ) {
    return mutateMessageReaction(
      request,
      env,
      decodeURIComponent(messageReaction[1]),
      decodeURIComponent(messageReaction[2]),
      decodeURIComponent(messageReaction[3]),
      messageReaction[4],
    );
  }

  const messageSearch = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages\/search$/,
  );
  if (
    request.method === "POST" &&
    messageSearch?.[1] !== undefined &&
    messageSearch[2] !== undefined
  ) {
    return searchMessages(
      request,
      env,
      decodeURIComponent(messageSearch[1]),
      decodeURIComponent(messageSearch[2]),
    );
  }

  const message = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages\/([^/]+)$/,
  );
  if (
    request.method === "PATCH" &&
    message?.[1] !== undefined &&
    message[2] !== undefined &&
    message[3] !== undefined
  ) {
    return editMessage(
      request,
      env,
      decodeURIComponent(message[1]),
      decodeURIComponent(message[2]),
      decodeURIComponent(message[3]),
    );
  }

  const messageCollection = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/messages$/,
  );
  if (
    request.method === "POST" &&
    messageCollection?.[1] !== undefined &&
    messageCollection[2] !== undefined
  ) {
    return postMessage(
      request,
      env,
      decodeURIComponent(messageCollection[1]),
      decodeURIComponent(messageCollection[2]),
    );
  }
  if (
    request.method === "GET" &&
    messageCollection?.[1] !== undefined &&
    messageCollection[2] !== undefined
  ) {
    return messageHistory(
      request,
      env,
      decodeURIComponent(messageCollection[1]),
      decodeURIComponent(messageCollection[2]),
    );
  }

  const conversation = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)$/,
  );
  if (
    request.method === "GET" &&
    conversation?.[1] !== undefined &&
    conversation[2] !== undefined
  ) {
    return getConversation(
      request,
      env,
      decodeURIComponent(conversation[1]),
      decodeURIComponent(conversation[2]),
    );
  }
  if (
    request.method === "PATCH" &&
    conversation?.[1] !== undefined &&
    conversation[2] !== undefined
  ) {
    return mutateConversation(
      request,
      env,
      decodeURIComponent(conversation[1]),
      decodeURIComponent(conversation[2]),
      "update",
    );
  }

  const conversationLifecycle = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/(archive|restore)$/,
  );
  if (
    request.method === "POST" &&
    conversationLifecycle?.[1] !== undefined &&
    conversationLifecycle[2] !== undefined &&
    conversationLifecycle[3] !== undefined
  ) {
    return mutateConversation(
      request,
      env,
      decodeURIComponent(conversationLifecycle[1]),
      decodeURIComponent(conversationLifecycle[2]),
      conversationLifecycle[3] as "archive" | "restore",
    );
  }

  const conversationJoin = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/join$/,
  );
  if (
    request.method === "POST" &&
    conversationJoin?.[1] !== undefined &&
    conversationJoin[2] !== undefined
  ) {
    return mutateConversation(
      request,
      env,
      decodeURIComponent(conversationJoin[1]),
      decodeURIComponent(conversationJoin[2]),
      "join",
    );
  }

  const conversationMember = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/conversations\/([^/]+)\/members\/([^/]+)$/,
  );
  if (
    conversationMember?.[1] !== undefined &&
    conversationMember[2] !== undefined &&
    conversationMember[3] !== undefined
  ) {
    const workspaceId = decodeURIComponent(conversationMember[1]);
    const conversationId = decodeURIComponent(conversationMember[2]);
    const targetPunkId = decodeURIComponent(conversationMember[3]);
    if (request.method === "PUT") {
      return mutateConversation(
        request,
        env,
        workspaceId,
        conversationId,
        "set-access",
        targetPunkId,
      );
    }
    if (request.method === "DELETE") {
      return mutateConversation(
        request,
        env,
        workspaceId,
        conversationId,
        "remove-member",
        targetPunkId,
      );
    }
  }

  const rename = path.match(/^\/api\/internal\/v1\/workspaces\/([^/]+)\/slug$/);
  if (request.method === "PATCH" && rename?.[1] !== undefined) {
    return renameWorkspace(request, env, decodeURIComponent(rename[1]));
  }

  const get = path.match(/^\/api\/v1\/workspaces\/([^/]+)$/);
  if (request.method === "GET" && get?.[1] !== undefined) {
    return getWorkspace(request, env, get[1]);
  }

  const member = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/members\/([^/]+)$/,
  );
  if (member?.[1] !== undefined && member[2] !== undefined) {
    const workspaceId = decodeURIComponent(member[1]);
    const targetPunkId = decodeURIComponent(member[2]);
    if (request.method === "PUT") {
      return mutateMember(request, env, workspaceId, targetPunkId, "set-role");
    }
    if (request.method === "DELETE") {
      return mutateMember(request, env, workspaceId, targetPunkId, "remove");
    }
  }

  return problem(404, "not_found", "API endpoint not found");
}
