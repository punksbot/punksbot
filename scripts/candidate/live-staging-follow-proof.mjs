#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import WebSocket from "ws";

import {
  authAggregateUuid,
  deterministicUuid,
  prepareStagingFixture,
} from "./staging-fixture.mjs";

const SHA_RE = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_RE = /^sha256:[0-9a-f]{64}$/u;
const ORIGIN = "https://staging.punks.bot";
const PROTOCOL = "punks.follow.v1";

function fail(message) {
  throw new Error(`live staging FOLLOW rejected: ${message}`);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined)
      fail("invalid arguments");
    const name = flag.slice(2);
    if (values.has(name)) fail(`duplicate --${name}`);
    values.set(name, value);
  }
  const required = (name) => {
    const value = values.get(name);
    if (typeof value !== "string" || value.length === 0) {
      fail(`--${name} is required`);
    }
    return value;
  };
  return {
    sourceSha: required("source-sha"),
    stagingDeploymentId: required("staging-deployment-id"),
    output: required("output"),
  };
}

async function jsonRequest(fetchImpl, url, init, statuses) {
  const response = await fetchImpl(url, {
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    ...init,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text.length === 0 ? null : JSON.parse(text);
  } catch {
    fail(`non-JSON response from ${url}`);
  }
  if (!statuses.includes(response.status)) {
    fail(`HTTP ${response.status} from ${url}`);
  }
  return { response, body };
}

function followStream({ workspaceId, conversationId, afterCursor, cookie }) {
  const url =
    `wss://staging.punks.bot/api/v1/workspaces/${workspaceId}` +
    `/conversations/${conversationId}/follow?afterCursor=${afterCursor}`;
  const socket = new WebSocket(url, PROTOCOL, {
    headers: { Cookie: cookie },
    origin: ORIGIN,
    handshakeTimeout: 30_000,
  });
  const frames = [];
  const waiters = [];
  let ended = null;
  const deliver = (value) => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(value);
    else frames.push(value);
  };
  socket.on("message", (raw) => {
    const text = raw.toString("utf8");
    if (text === "ping") {
      socket.send("pong");
      return;
    }
    deliver(JSON.parse(text));
  });
  socket.on("close", (code, reason) => {
    ended = new Error(`FOLLOW closed ${code} ${reason.toString("utf8")}`);
    while (waiters.length > 0) waiters.shift().reject(ended);
  });
  socket.on("error", (error) => {
    ended = error;
    while (waiters.length > 0) waiters.shift().reject(error);
  });
  const opened = new Promise((resolveOpened, reject) => {
    socket.once("open", () => {
      if (socket.protocol !== PROTOCOL)
        reject(new Error("subprotocol mismatch"));
      else resolveOpened();
    });
    socket.once("error", reject);
    socket.once("unexpected-response", (_request, response) => {
      reject(new Error(`FOLLOW HTTP ${response.statusCode}`));
    });
  });
  const next = (timeoutMs = 30_000) => {
    if (frames.length > 0) return Promise.resolve(frames.shift());
    if (ended) return Promise.reject(ended);
    return new Promise((resolveNext, reject) => {
      const timer = setTimeout(
        () => reject(new Error("FOLLOW frame timeout")),
        timeoutMs,
      );
      waiters.push({
        resolve(value) {
          clearTimeout(timer);
          resolveNext(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  };
  return { socket, opened, next };
}

async function nextMaterial(stream) {
  for (;;) {
    const frame = await stream.next();
    if (frame?.type !== "typing") return frame;
  }
}

function acknowledge(stream, throughCursor) {
  stream.socket.send(
    JSON.stringify({
      schemaVersion: 1,
      type: "ack",
      throughCursor,
    }),
  );
}

async function catchUp(stream, expectedAfterCursor) {
  await stream.opened;
  const accepted = await nextMaterial(stream);
  if (
    accepted?.type !== "accepted" ||
    accepted.resumeAfterCursor !== expectedAfterCursor
  ) {
    fail("accepted frame diverged");
  }
  const changes = [];
  for (;;) {
    const frame = await nextMaterial(stream);
    if (frame?.type === "changes") {
      changes.push(frame);
      acknowledge(stream, frame.throughCursor);
      continue;
    }
    if (frame?.type === "ready") return { changes, ready: frame };
    if (frame?.type === "resync-required") fail("unexpected resync");
    fail(`unexpected frame ${String(frame?.type)}`);
  }
}

async function postMessage({
  fetchImpl,
  fixture,
  cookie,
  sourceSha,
  proofAttemptId,
  domain,
}) {
  const commandId = deterministicUuid(`${domain}:${proofAttemptId}`, sourceSha);
  const result = await jsonRequest(
    fetchImpl,
    `${ORIGIN}/api/v1/workspaces/${fixture.workspaceId}` +
      `/conversations/${fixture.conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: ORIGIN,
        "idempotency-key": commandId,
      },
      body: JSON.stringify({
        contract: "message.post@1",
        commandId,
        workspaceId: fixture.workspaceId,
        conversationId: fixture.conversationId,
        actor: { kind: "punk", punkId: fixture.punkId },
        payload: {
          content: `${domain} · ${sourceSha}`,
          topic: "FOLLOW live",
          replyToMessageId: null,
          broadcast: false,
          mentionedPunkIds: [],
          mediaIds: [],
        },
      }),
    },
    [200, 201],
  );
  const id = result.body?.message?.id;
  if (typeof id !== "string") fail("live Message ID missing");
  return id;
}

async function waitForMessage(stream, messageId, shouldAcknowledge) {
  for (;;) {
    const frame = await nextMaterial(stream);
    if (frame?.type !== "changes") continue;
    if (shouldAcknowledge) acknowledge(stream, frame.throughCursor);
    if (frame.messages?.some(({ id }) => id === messageId)) return frame;
  }
}

export async function proveLiveStagingFollow(
  { sourceSha, stagingDeploymentId, operatorToken, fetchImpl = fetch },
  {
    prepareFixture = prepareStagingFixture,
    openFollowStream = followStream,
  } = {},
) {
  if (!SHA_RE.test(sourceSha)) fail("exact source SHA required");
  if (!DEPLOYMENT_RE.test(stagingDeploymentId)) {
    fail("exact staging deployment ID required");
  }
  if (typeof operatorToken !== "string" || operatorToken.length < 32) {
    fail("operator token unavailable");
  }
  const issued = await jsonRequest(
    fetchImpl,
    `${ORIGIN}/api/internal/v1/promotion/session`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${operatorToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        contract: "promotion.session-issue@1",
        sourceSha,
      }),
    },
    [201],
  );
  const session = issued.body?.session;
  if (
    typeof session?.cookie !== "string" ||
    typeof session?.revoke_capability !== "string"
  ) {
    fail("promotion Session missing");
  }
  const proofAttemptId = authAggregateUuid(
    "follow-proof-attempt",
    session.revoke_capability,
  );
  let revoked = false;
  const revoke = async () => {
    if (revoked) return;
    const result = await jsonRequest(
      fetchImpl,
      `${ORIGIN}/api/auth/v1/desktop/session/revoke`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "sec-punks-desktop-environment": "staging",
        },
        body: JSON.stringify({
          contract: "desktop-session.revoke@1",
          message: "request",
          capability: session.revoke_capability,
        }),
      },
      [200],
    );
    if (result.body?.revoked !== true) fail("Session revocation failed");
    revoked = true;
  };
  const openedStreams = [];
  const openBoundFollowStream = (input) => {
    const stream = openFollowStream(input);
    openedStreams.push(stream);
    return stream;
  };
  try {
    const fixture = await prepareFixture({
      sourceSha,
      origin: ORIGIN,
      cookie: session.cookie,
      operatorToken,
      sessionRevocationId: authAggregateUuid(
        "session-revocation",
        session.revoke_capability,
      ),
      fetchImpl,
      historyCount: 52,
      fixtureScope: "follow",
    });
    const initial = openBoundFollowStream({
      workspaceId: fixture.workspaceId,
      conversationId: fixture.conversationId,
      afterCursor: 0,
      cookie: session.cookie,
    });
    const initialResult = await catchUp(initial, 0);
    const initialCursor = initialResult.ready.highWaterCursor;
    if (initialResult.changes.length === 0 || initialCursor < 53) {
      fail("seeded catch-up was not observed");
    }
    const liveId = await postMessage({
      fetchImpl,
      fixture,
      cookie: session.cookie,
      sourceSha,
      proofAttemptId,
      domain: "follow-live",
    });
    const liveFrame = await waitForMessage(initial, liveId, true);
    const liveCursor = liveFrame.throughCursor;
    initial.socket.close(1000, "nominal proof complete");

    const beforeCrash = openBoundFollowStream({
      workspaceId: fixture.workspaceId,
      conversationId: fixture.conversationId,
      afterCursor: liveCursor,
      cookie: session.cookie,
    });
    const beforeCrashResult = await catchUp(beforeCrash, liveCursor);
    if (beforeCrashResult.ready.highWaterCursor !== liveCursor) {
      fail("pre-crash high-water diverged");
    }
    const crashId = await postMessage({
      fetchImpl,
      fixture,
      cookie: session.cookie,
      sourceSha,
      proofAttemptId,
      domain: "follow-crash-before-ack",
    });
    const unacked = await waitForMessage(beforeCrash, crashId, false);
    beforeCrash.socket.terminate();

    const replay = openBoundFollowStream({
      workspaceId: fixture.workspaceId,
      conversationId: fixture.conversationId,
      afterCursor: liveCursor,
      cookie: session.cookie,
    });
    const replayResult = await catchUp(replay, liveCursor);
    if (
      !replayResult.changes.some((frame) =>
        frame.messages?.some(({ id }) => id === crashId),
      )
    ) {
      fail("unacknowledged Message was not replayed");
    }
    const replayCursor = replayResult.ready.highWaterCursor;
    if (replayCursor !== unacked.throughCursor) fail("replay cursor diverged");
    replay.socket.close(1000, "replay acknowledged");

    const afterAck = openBoundFollowStream({
      workspaceId: fixture.workspaceId,
      conversationId: fixture.conversationId,
      afterCursor: replayCursor,
      cookie: session.cookie,
    });
    const afterAckResult = await catchUp(afterAck, replayCursor);
    if (
      afterAckResult.changes.some((frame) =>
        frame.messages?.some(({ id }) => id === crashId),
      )
    ) {
      fail("acknowledged Message was replayed");
    }
    afterAck.socket.close(1000, "post-ack proof complete");

    await revoke();
    await jsonRequest(
      fetchImpl,
      `${ORIGIN}/api/auth/v1/session`,
      { headers: { cookie: session.cookie, origin: ORIGIN } },
      [401],
    );
    return {
      schema: "punks.live-staging-follow-proof.v1",
      result: "PASS",
      sourceSha,
      stagingDeploymentId,
      staging: ORIGIN,
      workspaceId: fixture.workspaceId,
      conversationId: fixture.conversationId,
      catchUpFrames: initialResult.changes.length,
      initialCursor,
      liveCursor,
      crashBeforeAckCursor: unacked.throughCursor,
      replayCursor,
      scenarios: {
        catchUpAckReady: "vert",
        liveChangeAck: "vert",
        crashBeforeAckReplay: "vert",
        afterAckNoReplay: "vert",
        revokedSessionRejected: "vert",
      },
      observedAt: new Date().toISOString(),
    };
  } finally {
    for (const stream of openedStreams) {
      try {
        stream.socket.terminate();
      } catch {}
    }
    await revoke().catch(() => {});
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { sourceSha, stagingDeploymentId, output } = parseArguments(argv);
  const proof = await proveLiveStagingFollow({
    sourceSha,
    stagingDeploymentId,
    operatorToken: process.env.PUNKS_OPERATOR_TOKEN,
  });
  writeFileSync(resolve(output), `${JSON.stringify(proof, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(
    `FOLLOW_RESULT ${proof.result} source=${proof.sourceSha} observedAt=${proof.observedAt}\n`,
  );
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
