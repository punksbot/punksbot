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

function invariant(condition, message) {
  if (!condition) throw new Error(message);
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

async function requestJson(fetchImpl, url, init, label, acceptedStatuses) {
  const response = await fetchImpl(url, { redirect: "error", ...init });
  if (!acceptedStatuses.includes(response.status)) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  invariant(contentType.includes("application/json"), `${label} returned non-JSON`);
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
  fetchImpl = fetch,
  historyCount = 52,
}) {
  invariant(SHA_RE.test(sourceSha), "exact 40-character source SHA required");
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
    typeof operatorToken === "string" &&
      operatorToken.length >= 32 &&
      operatorToken.length <= 4096 &&
      !/[\s\u0000-\u001f]/.test(operatorToken),
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
  invariant(UUID_RE.test(punkId ?? ""), "staging session returned no canonical Punk ID");

  const workspaceCommandId = deterministicUuid("workspace", sourceSha);
  const slug = `promotion-${sourceSha.slice(0, 12)}`;
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
  invariant(UUID_RE.test(workspaceId ?? ""), "workspace response has no canonical ID");

  const conversationCommandId = deterministicUuid("conversation", sourceSha);
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
    const commandId = deterministicUuid(`history-${index}`, sourceSha);
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
    invariant(UUID_RE.test(messageId ?? ""), "Message response has no canonical ID");
    seedMessageIds.push(messageId);
  }

  return {
    schema: "punks.staging-promotion-fixture.v1",
    sourceSha,
    origin: canonicalOrigin,
    punkId,
    workspaceId,
    workspaceSlug: slug,
    conversationId,
    topicRequired: true,
    seedMessageIds,
  };
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    invariant(flag?.startsWith("--") && value !== undefined, "invalid arguments");
    invariant(!values.has(flag.slice(2)), `duplicate argument ${flag}`);
    values.set(flag.slice(2), value);
  }
  return values;
}

function readSecret(path, label) {
  const absolute = resolve(path);
  const status = lstatSync(absolute);
  invariant(status.isFile() && !status.isSymbolicLink(), `${label} must be a regular file`);
  invariant(status.size > 0 && status.size <= 16 * 1024, `${label} has an invalid size`);
  return readFileSync(absolute, "utf8").trim();
}

export async function main(argv = process.argv.slice(2)) {
  const values = parseArguments(argv);
  const required = (name) => {
    const value = values.get(name);
    invariant(value !== undefined && value !== "", `--${name} is required`);
    return value;
  };
  const session = JSON.parse(readSecret(required("session-file"), "session file"));
  const fixture = await prepareStagingFixture({
    sourceSha: required("source-sha"),
    origin: required("origin"),
    cookie: session.cookie,
    operatorToken: readSecret(required("operator-token-file"), "operator token file"),
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
