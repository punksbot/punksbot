import type {
  ConversationFollowServerFrame,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  PresenceHoldServerFrame,
  RemoveWorkspaceMemberCommand,
  SetWorkspaceMemberRoleCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  evictDurableObject,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const operatorHeaders = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};

async function createWorkspace(): Promise<string> {
  const commandId = crypto.randomUUID();
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: `presence-${commandId}`,
      name: "Presence tests",
      visibility: "private",
    },
  };
  const response = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...operatorHeaders,
        "content-type": "application/json",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  const body = (await response.json()) as {
    workspace?: { id: string };
    detail?: string;
    code?: string;
  };
  expect(response.status, JSON.stringify(body)).toBe(201);
  if (body.workspace === undefined) {
    throw new Error("Workspace create response is missing its Workspace");
  }
  return body.workspace.id;
}

async function addOtherMember(
  workspaceId: string,
  role: "member" | "guest" = "member",
): Promise<void> {
  const commandId = crypto.randomUUID();
  const command: SetWorkspaceMemberRoleCommand = {
    contract: "workspace.member-set-role@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      targetPunkId: otherPunkId,
      role,
      expectedRevision: 1,
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function removeOtherMember(workspaceId: string): Promise<void> {
  const commandId = crypto.randomUUID();
  const command: RemoveWorkspaceMemberCommand = {
    contract: "workspace.member-remove@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { targetPunkId: otherPunkId, expectedRevision: 2 },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/members/${otherPunkId}`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(200);
}

async function createConversation(
  workspaceId: string,
): Promise<{ id: string; cursor: number }> {
  const commandId = crypto.randomUUID();
  const command: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      name: "presence",
      type: "stream",
      visibility: "open",
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status).toBe(201);
  const conversation = (
    (await response.json()) as {
      conversation: { id: string; cursor: number };
    }
  ).conversation;
  return { id: conversation.id, cursor: conversation.cursor };
}

function frameQueue(socket: WebSocket) {
  const queued: PresenceHoldServerFrame[] = [];
  const waiters: Array<{
    resolve(frame: PresenceHoldServerFrame): void;
    reject(error: unknown): void;
  }> = [];
  socket.addEventListener("message", (event) => {
    try {
      const frame: unknown = JSON.parse(String(event.data));
      expect(
        validateContract(
          "punks://contracts/presence.hold-server-frame@1",
          frame,
        ).valid,
      ).toBe(true);
      const waiter = waiters.shift();
      if (waiter === undefined) queued.push(frame as PresenceHoldServerFrame);
      else waiter.resolve(frame as PresenceHoldServerFrame);
    } catch (error) {
      waiters.shift()?.reject(error);
    }
  });
  return {
    next(): Promise<PresenceHoldServerFrame> {
      const frame = queued.shift();
      return frame === undefined
        ? new Promise((resolve, reject) => waiters.push({ resolve, reject }))
        : Promise.resolve(frame);
    },
  };
}

function followFrameQueue(socket: WebSocket) {
  const queued: ConversationFollowServerFrame[] = [];
  const waiters: Array<{
    resolve(frame: ConversationFollowServerFrame): void;
    reject(error: unknown): void;
  }> = [];
  socket.addEventListener("message", (event) => {
    try {
      const frame: unknown = JSON.parse(String(event.data));
      expect(
        validateContract(
          "punks://contracts/conversation.follow-server-frame@1",
          frame,
        ).valid,
      ).toBe(true);
      const waiter = waiters.shift();
      if (waiter === undefined) {
        queued.push(frame as ConversationFollowServerFrame);
      } else {
        waiter.resolve(frame as ConversationFollowServerFrame);
      }
    } catch (error) {
      waiters.shift()?.reject(error);
    }
  });
  return {
    next(): Promise<ConversationFollowServerFrame> {
      const frame = queued.shift();
      return frame === undefined
        ? new Promise((resolve, reject) => waiters.push({ resolve, reject }))
        : Promise.resolve(frame);
    },
  };
}

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve) =>
    socket.addEventListener("close", resolve, { once: true }),
  );
}

async function holdPresence(
  workspaceId: string,
  session = "session-owner",
  coordinates: {
    deviceId?: string;
    clientGeneration?: number;
    holdId?: string;
  } = {},
): Promise<Response> {
  const query = new URLSearchParams({
    deviceId: coordinates.deviceId ?? crypto.randomUUID(),
    clientGeneration: String(coordinates.clientGeneration ?? 1),
    holdId: coordinates.holdId ?? crypto.randomUUID(),
  });
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/presence/hold?${query}`,
    {
      headers: {
        cookie: `__Host-punks_session=${session}`,
        origin: "https://punks.bot",
        upgrade: "websocket",
        "sec-websocket-protocol": "punks.presence.v1",
      },
    },
  );
}

function followConversation(
  workspaceId: string,
  conversationId: string,
  session = "session-other",
  afterCursor = 0,
): Promise<Response> {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/follow?afterCursor=${afterCursor}`,
    {
      headers: {
        cookie: `__Host-punks_session=${session}`,
        origin: "https://punks.bot",
        upgrade: "websocket",
        "sec-websocket-protocol": "punks.follow.v1",
      },
    },
  );
}

describe("ephemeral Presence", () => {
  it("derives online then offline from one bounded lease", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
      const workspaceId = await createWorkspace();
      const response = await holdPresence(workspaceId);

      expect(response.status).toBe(101);
      expect(response.headers.get("sec-websocket-protocol")).toBe(
        "punks.presence.v1",
      );
      const socket = response.webSocket;
      expect(socket).not.toBeNull();
      if (socket === null) return;
      const frames = frameQueue(socket);
      socket.accept();

      const accepted = await frames.next();
      expect(accepted).toMatchObject({
        schemaVersion: 1,
        type: "accepted",
        clientGeneration: 1,
        heartbeatIntervalMs: 15_000,
        awayAfterMs: 30_000,
        expiresAfterMs: 60_000,
        presences: [
          {
            punkId: ownerPunkId,
            state: "online",
            status: null,
            leaseGeneration: 1,
            sequence: 1,
            expiresAt: "2032-01-01T00:01:00.000Z",
          },
        ],
      });
      expect(accepted.type === "accepted" ? accepted.leaseToken : "").toMatch(
        /^pls1\.[A-Za-z0-9_-]{43}$/u,
      );

      vi.setSystemTime(new Date("2032-01-01T00:01:01.000Z"));
      await expect(
        runDurableObjectAlarm(env.PRESENCE.getByName(workspaceId)),
      ).resolves.toBe(true);
      await expect(frames.next()).resolves.toMatchObject({
        type: "presence",
        presence: {
          punkId: ownerPunkId,
          state: "offline",
          status: null,
          leaseGeneration: 1,
          sequence: 2,
          expiresAt: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("renews away to online but ignores a duplicated heartbeat", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
      const workspaceId = await createWorkspace();
      const response = await holdPresence(workspaceId);
      const socket = response.webSocket;
      expect(socket).not.toBeNull();
      if (socket === null) return;
      const frames = frameQueue(socket);
      socket.accept();
      const accepted = await frames.next();
      if (accepted.type !== "accepted") {
        throw new Error("presence hold was not accepted");
      }

      vi.setSystemTime(new Date("2032-01-01T00:00:31.000Z"));
      await runDurableObjectAlarm(env.PRESENCE.getByName(workspaceId));
      await expect(frames.next()).resolves.toMatchObject({
        type: "presence",
        presence: { punkId: ownerPunkId, state: "away", sequence: 2 },
      });

      socket.send(
        JSON.stringify({
          contract: "presence.hold@1",
          type: "heartbeat",
          leaseToken: accepted.leaseToken,
          sequence: 2,
        }),
      );
      await expect(frames.next()).resolves.toMatchObject({
        type: "presence",
        presence: {
          punkId: ownerPunkId,
          state: "online",
          sequence: 3,
          expiresAt: "2032-01-01T00:01:31.000Z",
        },
      });

      vi.setSystemTime(new Date("2032-01-01T00:01:20.000Z"));
      socket.send(
        JSON.stringify({
          contract: "presence.hold@1",
          type: "heartbeat",
          leaseToken: accepted.leaseToken,
          sequence: 2,
        }),
      );
      vi.setSystemTime(new Date("2032-01-01T00:01:32.000Z"));
      await runDurableObjectAlarm(env.PRESENCE.getByName(workspaceId));
      await expect(frames.next()).resolves.toMatchObject({
        type: "presence",
        presence: {
          punkId: ownerPunkId,
          state: "offline",
          sequence: 4,
          expiresAt: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses one lease generation for a duplicated hold intention", async () => {
    const workspaceId = await createWorkspace();
    const coordinates = {
      deviceId: crypto.randomUUID(),
      clientGeneration: 7,
      holdId: crypto.randomUUID(),
    };
    const firstResponse = await holdPresence(
      workspaceId,
      "session-owner",
      coordinates,
    );
    const firstSocket = firstResponse.webSocket;
    expect(firstSocket).not.toBeNull();
    if (firstSocket === null) return;
    const firstFrames = frameQueue(firstSocket);
    firstSocket.accept();
    const first = await firstFrames.next();
    expect(first.type).toBe("accepted");
    if (first.type !== "accepted") return;
    firstSocket.send(
      JSON.stringify({
        contract: "presence.hold@1",
        type: "heartbeat",
        leaseToken: first.leaseToken,
        sequence: 4,
      }),
    );
    await expect(firstFrames.next()).resolves.toMatchObject({
      type: "presence",
      presence: { sequence: 2 },
    });

    const replayResponse = await holdPresence(
      workspaceId,
      "session-owner",
      coordinates,
    );
    const replaySocket = replayResponse.webSocket;
    expect(replaySocket).not.toBeNull();
    if (replaySocket === null) return;
    const replayFrames = frameQueue(replaySocket);
    replaySocket.accept();
    const replay = await replayFrames.next();
    expect(replay).toMatchObject({
      type: "accepted",
      clientGeneration: 7,
    });
    if (first.type === "accepted" && replay.type === "accepted") {
      expect(replay.leaseToken).toBe(first.leaseToken);
      expect(replay.leaseGeneration).toBe(first.leaseGeneration);
      replaySocket.send(
        JSON.stringify({
          contract: "presence.hold@1",
          type: "heartbeat",
          leaseToken: replay.leaseToken,
          sequence: 1,
        }),
      );
      await expect(replayFrames.next()).resolves.toMatchObject({
        type: "presence",
        presence: { sequence: 3 },
      });
    }
  });

  it("accepts a Presence hold after upgrading the pre-connection-fence schema", async () => {
    const workspaceId = await createWorkspace();
    const presence = env.PRESENCE.getByName(workspaceId);
    await runInDurableObject(presence, (_instance, state) => {
      state.storage.sql.exec(`
        DROP TABLE presence_lease;
        CREATE TABLE presence_lease (
          punk_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          client_generation INTEGER NOT NULL,
          hold_id TEXT NOT NULL,
          lease_token TEXT NOT NULL UNIQUE,
          lease_generation INTEGER NOT NULL,
          status TEXT,
          last_client_sequence INTEGER NOT NULL,
          patch_sequence INTEGER NOT NULL,
          away_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          away_emitted INTEGER NOT NULL CHECK (away_emitted IN (0, 1)),
          status_window_started_at INTEGER NOT NULL,
          status_updates_in_window INTEGER NOT NULL,
          typing_window_started_at INTEGER NOT NULL,
          typing_signals_in_window INTEGER NOT NULL
        );
        CREATE INDEX presence_lease_expiry ON presence_lease(expires_at);
        CREATE INDEX presence_lease_away
          ON presence_lease(away_at, away_emitted);
      `);
    });
    await evictDurableObject(presence);

    const response = await holdPresence(workspaceId);
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket?.accept();
    socket?.close(1000, "test complete");
  });

  it("keeps the previous lease usable when a replacement snapshot exceeds capacity", async () => {
    const workspaceId = await createWorkspace();
    const coordinates = {
      deviceId: crypto.randomUUID(),
      clientGeneration: 7,
      holdId: crypto.randomUUID(),
    };
    const firstResponse = await holdPresence(
      workspaceId,
      "session-owner",
      coordinates,
    );
    const firstSocket = firstResponse.webSocket;
    expect(firstSocket).not.toBeNull();
    if (firstSocket === null) return;
    const firstFrames = frameQueue(firstSocket);
    firstSocket.accept();
    const first = await firstFrames.next();
    if (first.type !== "accepted") {
      throw new Error("presence hold was not accepted");
    }

    await runInDurableObject(
      env.PRESENCE.getByName(workspaceId),
      (_instance, state) => {
        const now = Date.now();
        state.storage.sql.exec(
          `WITH RECURSIVE sequence(value) AS (
             SELECT 1
             UNION ALL
             SELECT value + 1 FROM sequence WHERE value < 10000
           )
           INSERT INTO presence_lease (
             punk_id, session_id, device_id, client_generation, hold_id,
             lease_token, connection_id, lease_generation, status,
             last_client_sequence, patch_sequence, away_at, expires_at,
             away_emitted, status_window_started_at, status_updates_in_window,
             typing_window_started_at, typing_signals_in_window
           )
           SELECT
             printf('overflow-%05d', value),
             'overflow-session',
             'overflow-device',
             1,
             printf('overflow-hold-%05d', value),
             printf('overflow-token-%05d', value),
             printf('overflow-connection-%05d', value),
             value + 1,
             NULL,
             0,
             1,
             ?,
             ?,
             0,
             ?,
             0,
             ?,
             0
           FROM sequence`,
          now + 30_000,
          now + 60_000,
          now,
          now,
        );
      },
    );

    const rejected = await holdPresence(workspaceId, "session-owner", {
      deviceId: crypto.randomUUID(),
      clientGeneration: 8,
      holdId: crypto.randomUUID(),
    });
    expect(rejected.status).toBe(503);

    await runInDurableObject(
      env.PRESENCE.getByName(workspaceId),
      (_instance, state) => {
        state.storage.sql.exec(
          "DELETE FROM presence_lease WHERE punk_id LIKE 'overflow-%'",
        );
      },
    );
    firstSocket.send(
      JSON.stringify({
        contract: "presence.hold@1",
        type: "heartbeat",
        leaseToken: first.leaseToken,
        sequence: 1,
      }),
    );
    const renewed = await Promise.race([
      firstFrames.next(),
      scheduler.wait(200).then(() => null),
    ]);
    expect(renewed).toMatchObject({
      type: "presence",
      presence: {
        punkId: ownerPunkId,
        state: "online",
        leaseGeneration: first.leaseGeneration,
        sequence: 2,
      },
    });
  });

  it("bounds status updates and silently omits excess signals", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
      const workspaceId = await createWorkspace();
      await addOtherMember(workspaceId);
      const ownerResponse = await holdPresence(workspaceId);
      const ownerSocket = ownerResponse.webSocket;
      expect(ownerSocket).not.toBeNull();
      if (ownerSocket === null) return;
      const ownerFrames = frameQueue(ownerSocket);
      ownerSocket.accept();
      const accepted = await ownerFrames.next();
      if (accepted.type !== "accepted") {
        throw new Error("presence hold was not accepted");
      }

      for (const [index, status] of [
        "Available",
        "Reviewing",
        "Testing",
        "Shipping",
      ].entries()) {
        ownerSocket.send(
          JSON.stringify({
            contract: "presence.status.set@1",
            leaseToken: accepted.leaseToken,
            sequence: index + 1,
            status,
          }),
        );
        await expect(ownerFrames.next()).resolves.toMatchObject({
          type: "presence",
          presence: {
            punkId: ownerPunkId,
            status,
            sequence: index + 2,
          },
        });
      }
      ownerSocket.send(
        JSON.stringify({
          contract: "presence.status.set@1",
          leaseToken: accepted.leaseToken,
          sequence: 5,
          status: "Must be omitted",
        }),
      );

      const observerResponse = await holdPresence(workspaceId, "session-other");
      const observerSocket = observerResponse.webSocket;
      expect(observerSocket).not.toBeNull();
      if (observerSocket === null) return;
      const observerFrames = frameQueue(observerSocket);
      observerSocket.accept();
      await expect(observerFrames.next()).resolves.toMatchObject({
        type: "accepted",
        presences: expect.arrayContaining([
          expect.objectContaining({
            punkId: ownerPunkId,
            state: "online",
            status: "Shipping",
            sequence: 5,
          }),
        ]),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers authorized typing on Conversation FOLLOW and expires it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2032-01-01T00:00:00.000Z"));
      const workspaceId = await createWorkspace();
      await addOtherMember(workspaceId);
      const conversation = await createConversation(workspaceId);
      const conversationId = conversation.id;

      const followResponse = await followConversation(
        workspaceId,
        conversationId,
        "session-other",
        conversation.cursor,
      );
      const followSocket = followResponse.webSocket;
      expect(followSocket).not.toBeNull();
      if (followSocket === null) return;
      const followFrames = followFrameQueue(followSocket);
      followSocket.accept();
      await expect(followFrames.next()).resolves.toMatchObject({
        type: "accepted",
      });
      await expect(followFrames.next()).resolves.toMatchObject({
        type: "ready",
      });

      const presenceResponse = await holdPresence(workspaceId);
      const presenceSocket = presenceResponse.webSocket;
      expect(presenceSocket).not.toBeNull();
      if (presenceSocket === null) return;
      const presenceFrames = frameQueue(presenceSocket);
      presenceSocket.accept();
      const accepted = await presenceFrames.next();
      if (accepted.type !== "accepted") {
        throw new Error("presence hold was not accepted");
      }

      const signal = {
        contract: "presence.typing.signal@1",
        leaseToken: accepted.leaseToken,
        sequence: 1,
        workspaceId,
        conversationId,
        active: true,
      };
      presenceSocket.send(JSON.stringify(signal));
      await scheduler.wait(50);
      await expect(
        runInDurableObject(
          env.PRESENCE.getByName(workspaceId),
          (_instance, state) =>
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM presence_typing",
              )
              .one().count,
        ),
      ).resolves.toBe(1);
      await expect(followFrames.next()).resolves.toEqual({
        schemaVersion: 1,
        type: "typing",
        patch: {
          workspaceId,
          conversationId,
          punkId: ownerPunkId,
          active: true,
          leaseGeneration: 1,
          sequence: 1,
          expiresAt: "2032-01-01T00:00:05.000Z",
        },
      });

      presenceSocket.send(JSON.stringify(signal));
      vi.setSystemTime(new Date("2032-01-01T00:00:06.000Z"));
      await runDurableObjectAlarm(env.PRESENCE.getByName(workspaceId));
      await expect(followFrames.next()).resolves.toEqual({
        schemaVersion: 1,
        type: "typing",
        patch: {
          workspaceId,
          conversationId,
          punkId: ownerPunkId,
          active: false,
          leaseGeneration: 1,
          sequence: 2,
          expiresAt: null,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("withdraws typing immediately when another lease supersedes its owner", async () => {
    const workspaceId = await createWorkspace();
    await addOtherMember(workspaceId);
    const conversation = await createConversation(workspaceId);

    const followResponse = await followConversation(
      workspaceId,
      conversation.id,
      "session-other",
      conversation.cursor,
    );
    const followSocket = followResponse.webSocket;
    expect(followSocket).not.toBeNull();
    if (followSocket === null) return;
    const followFrames = followFrameQueue(followSocket);
    followSocket.accept();
    await expect(followFrames.next()).resolves.toMatchObject({
      type: "accepted",
    });
    await expect(followFrames.next()).resolves.toMatchObject({ type: "ready" });

    const firstResponse = await holdPresence(workspaceId);
    const firstSocket = firstResponse.webSocket;
    expect(firstSocket).not.toBeNull();
    if (firstSocket === null) return;
    const firstFrames = frameQueue(firstSocket);
    firstSocket.accept();
    const accepted = await firstFrames.next();
    if (accepted.type !== "accepted") return;

    firstSocket.send(
      JSON.stringify({
        contract: "presence.typing.signal@1",
        leaseToken: accepted.leaseToken,
        sequence: 1,
        workspaceId,
        conversationId: conversation.id,
        active: true,
      }),
    );
    await expect(followFrames.next()).resolves.toMatchObject({
      type: "typing",
      patch: {
        punkId: ownerPunkId,
        active: true,
        leaseGeneration: accepted.leaseGeneration,
        sequence: 1,
      },
    });

    const replacementResponse = await holdPresence(workspaceId);
    expect(replacementResponse.status).toBe(101);
    await expect(followFrames.next()).resolves.toMatchObject({
      type: "typing",
      patch: {
        punkId: ownerPunkId,
        active: false,
        leaseGeneration: accepted.leaseGeneration,
        sequence: 2,
        expiresAt: null,
      },
    });
    await expect(
      runInDurableObject(
        env.PRESENCE.getByName(workspaceId),
        (_instance, state) =>
          state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM presence_typing",
            )
            .one().count,
      ),
    ).resolves.toBe(0);
  });

  it("revokes a removed participant before another Presence emission", async () => {
    const workspaceId = await createWorkspace();
    await addOtherMember(workspaceId);

    const ownerResponse = await holdPresence(workspaceId);
    const ownerSocket = ownerResponse.webSocket;
    expect(ownerSocket).not.toBeNull();
    if (ownerSocket === null) return;
    const ownerFrames = frameQueue(ownerSocket);
    ownerSocket.accept();
    await ownerFrames.next();

    const otherResponse = await holdPresence(workspaceId, "session-other");
    const otherSocket = otherResponse.webSocket;
    expect(otherSocket).not.toBeNull();
    if (otherSocket === null) return;
    const otherFrames = frameQueue(otherSocket);
    otherSocket.accept();
    await otherFrames.next();
    await expect(ownerFrames.next()).resolves.toMatchObject({
      type: "presence",
      presence: { punkId: otherPunkId, state: "online" },
    });

    await removeOtherMember(workspaceId);
    await expect(ownerFrames.next()).resolves.toMatchObject({
      type: "presence",
      presence: {
        punkId: otherPunkId,
        state: "offline",
        status: null,
        expiresAt: null,
      },
    });
  });

  it("reauthorizes a follower after awaiting the current typing snapshot", async () => {
    const workspaceId = await createWorkspace();
    await addOtherMember(workspaceId);
    const conversation = await createConversation(workspaceId);

    const presenceResponse = await holdPresence(workspaceId);
    const presenceSocket = presenceResponse.webSocket;
    expect(presenceSocket).not.toBeNull();
    if (presenceSocket === null) return;
    const presenceFrames = frameQueue(presenceSocket);
    presenceSocket.accept();
    const accepted = await presenceFrames.next();
    if (accepted.type !== "accepted") return;
    presenceSocket.send(
      JSON.stringify({
        contract: "presence.typing.signal@1",
        leaseToken: accepted.leaseToken,
        sequence: 1,
        workspaceId,
        conversationId: conversation.id,
        active: true,
      }),
    );
    await expect
      .poll(() =>
        runInDurableObject(
          env.PRESENCE.getByName(workspaceId),
          (_instance, state) =>
            state.storage.sql
              .exec<{ count: number }>(
                "SELECT COUNT(*) AS count FROM presence_typing",
              )
              .one().count,
        ),
      )
      .toBe(1);

    const revocableSessionId = "33333333-3333-8333-8333-333333333333";
    const auth = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      holdSessionResolution(
        sessionId: string,
        callNumber: number,
      ): Promise<void>;
      sessionResolutionHoldReached(sessionId: string): Promise<boolean>;
      releaseSessionResolution(sessionId: string): Promise<void>;
      setSessionRevoked(sessionId: string, revoked: boolean): Promise<void>;
    };
    await auth.holdSessionResolution(revocableSessionId, 2);
    try {
      const followResponsePromise = followConversation(
        workspaceId,
        conversation.id,
        "session-revocable",
        conversation.cursor,
      );
      await expect
        .poll(() => auth.sessionResolutionHoldReached(revocableSessionId))
        .toBe(true);
      await auth.setSessionRevoked(revocableSessionId, true);
      await auth.releaseSessionResolution(revocableSessionId);

      const followResponse = await followResponsePromise;
      expect(followResponse.status).toBe(101);
      const followSocket = followResponse.webSocket;
      expect(followSocket).not.toBeNull();
      if (followSocket === null) return;
      const followFrames = followFrameQueue(followSocket);
      const closed = nextClose(followSocket);
      followSocket.accept();
      await expect(followFrames.next()).resolves.toMatchObject({
        type: "accepted",
      });
      const terminal = await Promise.race([
        followFrames
          .next()
          .then((frame) => ({ kind: "frame" as const, frame })),
        closed.then((event) => ({ kind: "close" as const, event })),
      ]);
      expect(terminal).toMatchObject({
        kind: "close",
        event: { code: 1008 },
      });
    } finally {
      await auth.releaseSessionResolution(revocableSessionId);
      await auth.setSessionRevoked(revocableSessionId, false);
      presenceSocket.close(1000, "test complete");
    }
  });

  it("does not expose the Workspace presence roster to a guest", async () => {
    const workspaceId = await createWorkspace();
    await addOtherMember(workspaceId, "guest");
    const ownerResponse = await holdPresence(workspaceId);
    const ownerSocket = ownerResponse.webSocket;
    expect(ownerSocket).not.toBeNull();
    if (ownerSocket === null) return;
    ownerSocket.accept();

    const guestResponse = await holdPresence(workspaceId, "session-other");
    const guestSocket = guestResponse.webSocket;
    expect(guestSocket).not.toBeNull();
    if (guestSocket === null) return;
    const guestFrames = frameQueue(guestSocket);
    guestSocket.accept();
    const accepted = await guestFrames.next();
    expect(accepted).toMatchObject({
      type: "accepted",
      presences: [
        expect.objectContaining({ punkId: otherPunkId, state: "online" }),
      ],
    });
    if (accepted.type === "accepted") {
      expect(accepted.presences).toHaveLength(1);
      expect(accepted.presences[0]?.punkId).toBe(otherPunkId);
    }
  });

  it("purges a revoked Session when another signal revalidates its audience", async () => {
    const workspaceId = await createWorkspace();
    await addOtherMember(workspaceId);
    const ownerResponse = await holdPresence(workspaceId);
    const ownerSocket = ownerResponse.webSocket;
    expect(ownerSocket).not.toBeNull();
    if (ownerSocket === null) return;
    const ownerFrames = frameQueue(ownerSocket);
    ownerSocket.accept();
    const ownerAccepted = await ownerFrames.next();
    if (ownerAccepted.type !== "accepted") return;

    const otherResponse = await holdPresence(workspaceId, "session-other");
    const otherSocket = otherResponse.webSocket;
    expect(otherSocket).not.toBeNull();
    if (otherSocket === null) return;
    otherSocket.accept();
    await ownerFrames.next();

    const auth = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      setSessionRevoked(sessionId: string, revoked: boolean): Promise<void>;
    };
    await auth.setSessionRevoked("22222222-2222-8222-8222-222222222222", true);
    try {
      ownerSocket.send(
        JSON.stringify({
          contract: "presence.status.set@1",
          leaseToken: ownerAccepted.leaseToken,
          sequence: 1,
          status: "Revalidate audience",
        }),
      );
      await expect(ownerFrames.next()).resolves.toMatchObject({
        type: "presence",
        presence: { punkId: ownerPunkId, status: "Revalidate audience" },
      });
      await expect(ownerFrames.next()).resolves.toMatchObject({
        type: "presence",
        presence: { punkId: otherPunkId, state: "offline" },
      });
    } finally {
      await auth.setSessionRevoked(
        "22222222-2222-8222-8222-222222222222",
        false,
      );
    }
  });
});
