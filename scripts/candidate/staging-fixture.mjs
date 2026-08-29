import { createHash } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA_RE = /^[0-9a-f]{40}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COOKIE_RE = /^__Host-punks_session=[^;\s]{32,4096}$/;
const CAPABILITY_RE = /^[A-Za-z0-9_-]{43,128}$/;
export const INSTALLED_FIXTURE_PLATFORMS = Object.freeze([
  "macos-arm64",
  "macos-x64",
  "linux-x64",
  "windows-x64",
]);
const FIXTURE_SCOPES = new Set([
  "candidate",
  "follow",
  ...INSTALLED_FIXTURE_PLATFORMS.map((platform) => `candidate-${platform}`),
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function parsePromotionSessionBundle(raw, sourceSha) {
  invariant(SHA_RE.test(sourceSha), "exact 40-character source SHA required");
  let bundle;
  try {
    bundle = JSON.parse(raw);
  } catch {
    throw new Error("promotion Session bundle is invalid JSON");
  }
  invariant(
    bundle !== null &&
      typeof bundle === "object" &&
      !Array.isArray(bundle) &&
      JSON.stringify(Object.keys(bundle).sort()) ===
        JSON.stringify(
          [
            "source_sha",
            "cookie",
            "metadata",
            "revoke_capability",
            "revoke_expires_at_seconds",
          ].sort(),
        ),
    "promotion Session bundle has an unexpected shape",
  );
  invariant(
    bundle.source_sha === sourceSha,
    "promotion Session belongs to another source SHA",
  );
  invariant(
    COOKIE_RE.test(bundle.cookie),
    "valid staging session cookie required",
  );
  const metadata = bundle.metadata;
  invariant(
    metadata !== null &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      JSON.stringify(Object.keys(metadata).sort()) ===
        JSON.stringify(
          [
            "session_id",
            "punk_id",
            "expires_at_seconds",
            "last_renewed_at_seconds",
          ].sort(),
        ) &&
      UUID_RE.test(metadata.session_id ?? "") &&
      UUID_RE.test(metadata.punk_id ?? "") &&
      Number.isSafeInteger(metadata.expires_at_seconds) &&
      metadata.expires_at_seconds > Math.floor(Date.now() / 1_000) + 300 &&
      (metadata.last_renewed_at_seconds === null ||
        (Number.isSafeInteger(metadata.last_renewed_at_seconds) &&
          metadata.last_renewed_at_seconds <= metadata.expires_at_seconds)),
    "promotion Session metadata is invalid",
  );
  invariant(
    CAPABILITY_RE.test(bundle.revoke_capability ?? "") &&
      bundle.revoke_expires_at_seconds === metadata.expires_at_seconds,
    "promotion Session revoke capability is invalid",
  );
  return bundle;
}

/** Deterministic RFC 9562 UUIDv8 used only for replay-safe fixture commands. */
export function deterministicUuid(domain, source) {
  const bytes = createHash("sha256")
    .update("punks.promotion.fixture.v1\0")
    .update(domain)
    .update("\0")
    .update(source)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function authAggregateUuid(domain, value) {
  const bytes = createHash("sha256")
    .update(`punks.auth.${domain}.v1\0${value}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function requestJson(fetchImpl, url, init, label, acceptedStatuses) {
  const response = await fetchImpl(url, { redirect: "error", ...init });
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  invariant(
    contentType.includes("application/json"),
    `${label} returned non-JSON`,
  );
  return response.json();
}

function authenticatedHeaders(origin, cookie, commandId) {
  return {
    "content-type": "application/json",
    cookie,
    origin,
    "idempotency-key": commandId,
  };
}

function fixtureDomain(scope, domain) {
  return scope === "candidate" ? domain : `${scope}-${domain}`;
}

/**
 * Creates/replays one bounded fixture against the public staging contracts.
 * The returned record contains coordinates only; neither authority input can
 * cross into the proof artifact.
 */
export async function prepareStagingFixture({
  sourceSha,
  origin,
  cookie,
  operatorToken,
  sessionRevocationId,
  fetchImpl = fetch,
  historyCount = 52,
  fixtureScope = "candidate",
}) {
  invariant(SHA_RE.test(sourceSha), "exact 40-character source SHA required");
  invariant(
    FIXTURE_SCOPES.has(fixtureScope),
    "staging fixture scope is not one closed candidate/FOLLOW scope",
  );
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error("exact HTTPS staging origin required");
  }
  invariant(
    parsedOrigin.protocol === "https:" &&
      parsedOrigin.username === "" &&
      parsedOrigin.password === "" &&
      parsedOrigin.pathname === "/" &&
      parsedOrigin.search === "" &&
      parsedOrigin.hash === "",
    "exact HTTPS staging origin required",
  );
  const canonicalOrigin = parsedOrigin.origin;
  invariant(COOKIE_RE.test(cookie), "valid staging session cookie required");
  invariant(
    UUID_RE.test(sessionRevocationId ?? ""),
    "exact Session revocation authority ID required",
  );
  invariant(
    typeof operatorToken === "string" &&
      operatorToken.length >= 32 &&
      operatorToken.length <= 4096 &&
      ![...operatorToken].some(
        (character) =>
          /\s/u.test(character) || character.codePointAt(0) <= 0x1f,
      ),
    "bounded operator token required",
  );
  invariant(
    Number.isInteger(historyCount) && historyCount >= 51 && historyCount <= 100,
    "history fixture must contain between 51 and 100 Messages",
  );

  const sessionEnvelope = await requestJson(
    fetchImpl,
    `${canonicalOrigin}/api/auth/v1/session`,
    { headers: { cookie, origin: canonicalOrigin } },
    "session validation",
    [200],
  );
  const punkId = sessionEnvelope?.session?.punkId;
  const sessionId = sessionEnvelope?.session?.sessionId;
  invariant(
    UUID_RE.test(punkId ?? "") && UUID_RE.test(sessionId ?? ""),
    "staging session returned no canonical Session/Punk ID",
  );

  const workspaceCommandId = deterministicUuid(
    fixtureDomain(fixtureScope, "workspace"),
    sourceSha,
  );
  const slugScope = fixtureScope.startsWith("candidate-")
    ? fixtureScope.slice("candidate-".length)
    : fixtureScope;
  const slug =
    slugScope === "candidate"
      ? `promotion-${sourceSha.slice(0, 12)}`
      : `promotion-${slugScope}-${sourceSha.slice(0, 12)}`;
  const workspaceCommand = {
    contract: "workspace.create@1",
    commandId: workspaceCommandId,
    actor: { kind: "punk", punkId },
    payload: {
      slug,
      name: `Promotion ${sourceSha.slice(0, 12)}`,
      visibility: "private",
    },
  };
  const workspaceEnvelope = await requestJson(
    fetchImpl,
    `${canonicalOrigin}/api/internal/v1/workspaces`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${operatorToken}`,
        "idempotency-key": workspaceCommandId,
      },
      body: JSON.stringify(workspaceCommand),
    },
    "workspace provisioning",
    [200, 201],
  );
  const workspaceId = workspaceEnvelope?.workspace?.id;
  invariant(
    UUID_RE.test(workspaceId ?? ""),
    "workspace response has no canonical ID",
  );

  const conversationCommandId = deterministicUuid(
    fixtureDomain(fixtureScope, "conversation"),
    sourceSha,
  );
  const conversationCommand = {
    contract: "conversation.create@1",
    commandId: conversationCommandId,
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      name: "promotion",
      type: "stream",
      visibility: "open",
      description: `Exact signed candidate ${sourceSha}`,
      topicRequired: true,
    },
  };
  const conversationEnvelope = await requestJson(
    fetchImpl,
    `${canonicalOrigin}/api/v1/workspaces/${workspaceId}/conversations`,
    {
      method: "POST",
      headers: authenticatedHeaders(
        canonicalOrigin,
        cookie,
        conversationCommandId,
      ),
      body: JSON.stringify(conversationCommand),
    },
    "conversation provisioning",
    [200, 201],
  );
  const conversationId = conversationEnvelope?.conversation?.id;
  invariant(
    UUID_RE.test(conversationId ?? ""),
    "conversation response has no canonical ID",
  );

  const seedMessageIds = [];
  for (let index = 0; index < historyCount; index += 1) {
    const commandId = deterministicUuid(
      fixtureDomain(fixtureScope, `history-${index}`),
      sourceSha,
    );
    const command = {
      contract: "message.post@1",
      commandId,
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId },
      payload: {
        content: `Promotion history ${String(index + 1).padStart(3, "0")} · ${sourceSha}`,
        topic: `History ${String(index + 1).padStart(3, "0")}`,
        replyToMessageId: null,
        broadcast: false,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const messageEnvelope = await requestJson(
      fetchImpl,
      `${canonicalOrigin}/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
      {
        method: "POST",
        headers: authenticatedHeaders(canonicalOrigin, cookie, commandId),
        body: JSON.stringify(command),
      },
      `history Message ${index + 1}`,
      [200, 201],
    );
    const messageId = messageEnvelope?.message?.id;
    invariant(
      UUID_RE.test(messageId ?? ""),
      "Message response has no canonical ID",
    );
    seedMessageIds.push(messageId);
  }

  const replyCommandId = deterministicUuid(
    fixtureDomain(fixtureScope, "history-reply"),
    sourceSha,
  );
  const replyEnvelope = await requestJson(
    fetchImpl,
    `${canonicalOrigin}/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: authenticatedHeaders(canonicalOrigin, cookie, replyCommandId),
      body: JSON.stringify({
        contract: "message.post@1",
        commandId: replyCommandId,
        workspaceId,
        conversationId,
        actor: { kind: "punk", punkId },
        payload: {
          content: `Promotion seeded reply · ${sourceSha}`,
          topic: null,
          replyToMessageId: seedMessageIds.at(-1),
          broadcast: false,
          mentionedPunkIds: [],
          mediaIds: [],
        },
      }),
    },
    "history Reply",
    [200, 201],
  );
  const replyMessageId = replyEnvelope?.message?.id;
  invariant(
    UUID_RE.test(replyMessageId ?? ""),
    "Reply response has no canonical ID",
  );

  return {
    schema: "punks.staging-promotion-fixture.v1",
    sourceSha,
    origin: canonicalOrigin,
    sessionId,
    sessionRevocationId,
    punkId,
    workspaceId,
    workspaceSlug: slug,
    conversationId,
    topicRequired: true,
    seedMessageIds,
    replyMessageId,
  };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    invariant(
      flag?.startsWith("--") && value !== undefined,
      "invalid arguments",
    );
    invariant(!values.has(flag.slice(2)), `duplicate argument ${flag}`);
    values.set(flag.slice(2), value);
  }
  return values;
}

function readSecret(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  invariant(
    status.isFile() && !status.isSymbolicLink(),
    `${label} must be a regular file`,
  );
  invariant(
    status.size > 0 && status.size <= 16 * 1024,
    `${label} has an invalid size`,
  );
  return readFileSync(absolute, "utf8").trim();
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseArguments(argv);
  const required = (name) => {
    const value = values.get(name);
    invariant(value !== undefined && value !== "", `--${name} is required`);
    return value;
  };
  const sourceSha = required("source-sha");
  const session = parsePromotionSessionBundle(
    readSecret(required("session-file"), "session file"),
    sourceSha,
  );
  const fixture = await prepareStagingFixture({
    sourceSha,
    origin: required("origin"),
    cookie: session.cookie,
    operatorToken: readSecret(
      required("operator-token-file"),
      "operator token file",
    ),
    sessionRevocationId: authAggregateUuid(
      "session-revocation",
      session.revoke_capability,
    ),
    fixtureScope: values.get("fixture-scope") ?? "candidate",
  });
  const output = resolve(required("output"));
  const descriptor = openSync(output, "wx", 0o600);
  try {
    writeFileSync(descriptor, `${JSON.stringify(fixture, null, 2)}\n`);
  } finally {
    closeSync(descriptor);
  }
  console.log(`staging fixture prepared for ${fixture.sourceSha}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
