import assert from "node:assert/strict";
import test from "node:test";

import { proveLiveStagingFollow } from "./live-staging-follow-proof.mjs";
import { authAggregateUuid } from "./staging-fixture.mjs";

const SOURCE_SHA = "84".repeat(20);
const DEPLOYMENT_ID = `sha256:${"ab".repeat(32)}`;
const FOLLOW_FIXTURE = Object.freeze({
  punkId: "80000000-0000-8000-8000-000000000058",
  workspaceId: "80000000-0000-8000-8000-000000000059",
  conversationId: "80000000-0000-8000-8000-000000000060",
});

test("refuse une identité non exacte avant toute frontière distante", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("frontière distante appelée");
  };

  await assert.rejects(
    proveLiveStagingFollow({
      sourceSha: "bad",
      stagingDeploymentId: DEPLOYMENT_ID,
      operatorToken: "x".repeat(64),
      fetchImpl,
    }),
    /exact source SHA/i,
  );
  await assert.rejects(
    proveLiveStagingFollow({
      sourceSha: SOURCE_SHA,
      stagingDeploymentId: "sha256:bad",
      operatorToken: "x".repeat(64),
      fetchImpl,
    }),
    /exact staging deployment ID/i,
  );
  await assert.rejects(
    proveLiveStagingFollow({
      sourceSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      operatorToken: "short",
      fetchImpl,
    }),
    /operator token unavailable/i,
  );
  assert.equal(calls, 0);
});

test("lie la fixture à l'autorité de révocation de la Session émise", async () => {
  const capability = "r".repeat(43);
  let fixtureInput;
  let calls = 0;
  const fetchImpl = async (url) => {
    calls += 1;
    if (String(url).endsWith("/api/internal/v1/promotion/session")) {
      return Response.json(
        {
          session: {
            cookie: `__Host-punks_session=${"s".repeat(64)}`,
            revoke_capability: capability,
          },
        },
        { status: 201 },
      );
    }
    if (String(url).endsWith("/api/auth/v1/desktop/session/revoke")) {
      return Response.json({ revoked: true }, { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  await assert.rejects(
    proveLiveStagingFollow(
      {
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        operatorToken: "x".repeat(64),
        fetchImpl,
      },
      {
        async prepareFixture(input) {
          fixtureInput = input;
          throw new Error("stop after fixture identity");
        },
      },
    ),
    /stop after fixture identity/u,
  );
  assert.equal(
    fixtureInput.sessionRevocationId,
    authAggregateUuid("session-revocation", capability),
  );
  assert.equal(fixtureInput.fixtureScope, "follow");
  assert.equal(calls, 2);
});

test("réexécute la preuve avec de nouvelles commandes sans attendre un Message idempotent déjà observé", async () => {
  const messagesByCommand = new Map();
  const commandIds = [];
  let issuedSessions = 0;
  let latestPost;
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/internal/v1/promotion/session") {
      issuedSessions += 1;
      return Response.json(
        {
          session: {
            cookie: `__Host-punks_session=${String(issuedSessions).padStart(64, "0")}`,
            revoke_capability: `${"r".repeat(42)}${issuedSessions}`,
          },
        },
        { status: 201 },
      );
    }
    if (path === "/api/auth/v1/desktop/session/revoke") {
      return Response.json({ revoked: true }, { status: 200 });
    }
    if (path === "/api/auth/v1/session") {
      return Response.json({ error: "revoked" }, { status: 401 });
    }
    if (path.endsWith("/messages") && init.method === "POST") {
      const command = JSON.parse(String(init.body));
      commandIds.push(command.commandId);
      const existing = messagesByCommand.get(command.commandId);
      latestPost = {
        fresh: existing === undefined,
        id:
          existing ??
          `90000000-0000-8000-8000-${String(messagesByCommand.size + 1).padStart(12, "0")}`,
      };
      messagesByCommand.set(command.commandId, latestPost.id);
      return Response.json({ message: { id: latestPost.id } }, { status: 201 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const seededCursor = 53;
  const liveCursor = 54;
  const crashCursor = 55;
  const accepted = (afterCursor) => ({
    type: "accepted",
    resumeAfterCursor: afterCursor,
  });
  const ready = (highWaterCursor) => ({
    type: "ready",
    highWaterCursor,
  });
  const changes = (throughCursor, messageId) => ({
    type: "changes",
    throughCursor,
    messages: [{ id: messageId }],
  });
  const requireFreshPost = (throughCursor) => {
    if (latestPost?.fresh !== true) {
      throw new Error("FOLLOW frame timeout");
    }
    return changes(throughCursor, latestPost.id);
  };
  const proofStreamPlans = () => [
    {
      name: "initial catch-up and live Message",
      steps: (afterCursor) => [
        () => accepted(afterCursor),
        () => changes(seededCursor, "seed"),
        () => ready(seededCursor),
        () => requireFreshPost(liveCursor),
      ],
    },
    {
      name: "crash before acknowledgement",
      steps: (afterCursor) => [
        () => accepted(afterCursor),
        () => ready(liveCursor),
        () => requireFreshPost(crashCursor),
      ],
    },
    {
      name: "replay unacknowledged Message",
      steps: (afterCursor) => [
        () => accepted(afterCursor),
        () => changes(crashCursor, latestPost.id),
        () => ready(crashCursor),
      ],
    },
    {
      name: "no replay after acknowledgement",
      steps: (afterCursor) => [
        () => accepted(afterCursor),
        () => ready(crashCursor),
      ],
    },
  ];
  const streamPlans = [...proofStreamPlans(), ...proofStreamPlans()];
  const openFollowStream = ({ afterCursor }) => {
    const plan = streamPlans.shift();
    assert.ok(plan, "unexpected extra FOLLOW stream");
    const steps = plan.steps(afterCursor);
    let nextIndex = 0;
    const socket = {
      close() {},
      send() {},
      terminate() {},
    };
    return {
      socket,
      opened: Promise.resolve(),
      async next() {
        const step = steps[nextIndex];
        nextIndex += 1;
        if (step === undefined) {
          throw new Error(`unexpected frame request for ${plan.name}`);
        }
        return step();
      },
    };
  };

  const input = {
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    operatorToken: "x".repeat(64),
    fetchImpl,
  };
  const dependencies = {
    async prepareFixture() {
      return FOLLOW_FIXTURE;
    },
    openFollowStream,
  };
  await proveLiveStagingFollow(input, dependencies);
  await proveLiveStagingFollow(input, dependencies);

  assert.equal(commandIds.length, 4);
  assert.equal(new Set(commandIds).size, 4);
  assert.equal(streamPlans.length, 0);
});

test("termine le transport FOLLOW quand la preuve échoue en attente d'un frame", async () => {
  let terminated = 0;
  const fetchImpl = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/internal/v1/promotion/session") {
      return Response.json(
        {
          session: {
            cookie: `__Host-punks_session=${"s".repeat(64)}`,
            revoke_capability: "r".repeat(43),
          },
        },
        { status: 201 },
      );
    }
    if (path === "/api/auth/v1/desktop/session/revoke") {
      return Response.json({ revoked: true }, { status: 200 });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  let nextCalls = 0;
  await assert.rejects(
    proveLiveStagingFollow(
      {
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        operatorToken: "x".repeat(64),
        fetchImpl,
      },
      {
        async prepareFixture() {
          return FOLLOW_FIXTURE;
        },
        openFollowStream() {
          return {
            opened: Promise.resolve(),
            socket: {
              send() {},
              terminate() {
                terminated += 1;
              },
            },
            async next() {
              nextCalls += 1;
              if (nextCalls === 1) {
                return { type: "accepted", resumeAfterCursor: 0 };
              }
              throw new Error("FOLLOW frame timeout");
            },
          };
        },
      },
    ),
    /FOLLOW frame timeout/u,
  );
  assert.equal(terminated, 1);
});
