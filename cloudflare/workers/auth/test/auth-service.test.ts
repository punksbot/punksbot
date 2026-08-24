import { exports as workerExports } from "cloudflare:workers";
import { env, listDurableObjectIds, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../src/env";
import type { SessionRecord } from "../src/rpc";

const authEnv = env as AuthEnv;

const sessionId = "a0000000-0000-8000-8000-00000000000a";
const punkId = "b0000000-0000-8000-8000-00000000000b";

async function provisionActivePunk(
  aggregateId: string,
  stateId = aggregateId,
): Promise<void> {
  const now = new Date().toISOString();
  const result = await authEnv.PUNKS.getByName(aggregateId).provision({
    punkId: stateId,
    identity: {
      profile: {
        provider: "google",
        subject: `subject-${stateId}`,
        verifiedEmail: `${stateId}@example.com`,
        displayName: "Realtime Punk",
        avatarUrl: null,
        username: null,
      },
      subjectHash: "a".repeat(64),
      emailHash: "b".repeat(64),
    },
    now,
  });
  expect(result.ok).toBe(true);
}

async function createActiveSession(
  id: string,
  ownerPunkId: string,
  overrides: Partial<SessionRecord> = {},
): Promise<SessionRecord> {
  const now = new Date();
  const record: SessionRecord = {
    sessionId: id,
    punkId: ownerPunkId,
    authenticatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    recentReauthUntil: null,
    ...overrides,
  };
  expect(await authEnv.SESSIONS.getByName(id).create(record)).toBe(true);
  return record;
}

describe("PunkSessionService session-id reauthentication", () => {
  it("returns the canonical active Punk session without a cookie", async () => {
    await provisionActivePunk(punkId);
    const record = await createActiveSession(sessionId, punkId);

    await expect(
      workerExports.PunkSessionService.resolveSessionId(sessionId),
    ).resolves.toEqual({
      ...record,
      punk: {
        id: punkId,
        displayName: "Realtime Punk",
        avatarUrl: null,
      },
    });
  });

  it("rejects non-canonical or non-opaque session identifiers", async () => {
    const durableObjectCountBefore = (
      await listDurableObjectIds(authEnv.SESSIONS)
    ).length;
    const invalidSessionIds = [
      "",
      "not-a-session-id",
      "10000000-0000-4000-8000-000000000001",
      sessionId.toUpperCase(),
      `${sessionId} `,
    ];

    for (const invalidSessionId of invalidSessionIds) {
      await expect(
        workerExports.PunkSessionService.resolveSessionId(invalidSessionId),
      ).resolves.toBeNull();
    }
    await expect(listDurableObjectIds(authEnv.SESSIONS)).resolves.toHaveLength(
      durableObjectCountBefore,
    );
  });

  it("rejects expired and revoked sessions", async () => {
    const expiredSessionId = "a0000000-0000-8000-8000-00000000000c";
    const revokedSessionId = "a0000000-0000-8000-8000-00000000000d";
    await provisionActivePunk(punkId);
    await createActiveSession(expiredSessionId, punkId);
    await createActiveSession(revokedSessionId, punkId);

    const expiredSession = authEnv.SESSIONS.getByName(expiredSessionId);
    await runInDurableObject(expiredSession, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE auth_session SET expires_at = ? WHERE singleton = 1",
        new Date(Date.now() - 1_000).toISOString(),
      );
    });
    expect(await authEnv.SESSIONS.getByName(revokedSessionId).revoke()).toBe(
      true,
    );

    await expect(
      workerExports.PunkSessionService.resolveSessionId(expiredSessionId),
    ).resolves.toBeNull();
    await expect(
      workerExports.PunkSessionService.resolveSessionId(revokedSessionId),
    ).resolves.toBeNull();
  });

  it("rejects a session record stored under a different aggregate scope", async () => {
    const scopedSessionId = "a0000000-0000-8000-8000-00000000000e";
    const foreignSessionId = "a0000000-0000-8000-8000-00000000000f";
    await provisionActivePunk(punkId);
    await createActiveSession(scopedSessionId, punkId, {
      sessionId: foreignSessionId,
    });

    await expect(
      workerExports.PunkSessionService.resolveSessionId(scopedSessionId),
    ).resolves.toBeNull();
  });

  it("rejects an active session record that violates the canonical contract", async () => {
    const corruptSessionId = "a0000000-0000-8000-8000-000000000010";
    await provisionActivePunk(punkId);
    await createActiveSession(corruptSessionId, punkId, {
      authenticatedAt: "not-a-date-time",
    });

    await expect(
      workerExports.PunkSessionService.resolveSessionId(corruptSessionId),
    ).resolves.toBeNull();
  });

  it("rejects an active Punk stored under a different aggregate scope", async () => {
    const scopedPunkId = "b0000000-0000-8000-8000-000000000011";
    const foreignPunkId = "b0000000-0000-8000-8000-000000000012";
    const scopedSessionId = "a0000000-0000-8000-8000-000000000011";
    await provisionActivePunk(scopedPunkId, foreignPunkId);
    await createActiveSession(scopedSessionId, scopedPunkId);

    await expect(
      workerExports.PunkSessionService.resolveSessionId(scopedSessionId),
    ).resolves.toBeNull();
  });

  it("rejects a session whose Punk is no longer active", async () => {
    const inactivePunkId = "b0000000-0000-8000-8000-000000000013";
    const inactiveSessionId = "a0000000-0000-8000-8000-000000000013";
    await provisionActivePunk(inactivePunkId);
    await createActiveSession(inactiveSessionId, inactivePunkId);
    const punk = authEnv.PUNKS.getByName(inactivePunkId);
    const current = await punk.query();
    expect(current.ok).toBe(true);
    if (!current.ok) {
      throw new Error("Active Punk fixture was not provisioned");
    }
    await runInDurableObject(punk, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify({ ...current.state, status: "deleted" }),
      );
    });

    await expect(
      workerExports.PunkSessionService.resolveSessionId(inactiveSessionId),
    ).resolves.toBeNull();
  });

  it("fails closed when the Session Durable Object cannot be read", async () => {
    const unavailableSessionId = "a0000000-0000-8000-8000-000000000014";
    await provisionActivePunk(punkId);
    await createActiveSession(unavailableSessionId, punkId);
    const session = authEnv.SESSIONS.getByName(unavailableSessionId);
    await runInDurableObject(session, async (_instance, state) => {
      state.storage.sql.exec("DROP TABLE auth_session");
    });

    await expect(
      runInDurableObject(session, async (instance) => instance.get()),
    ).resolves.toBeNull();

    await expect(
      workerExports.PunkSessionService.resolveSessionId(unavailableSessionId),
    ).resolves.toBeNull();
  });

  it("keeps the public HTTP surface unchanged", async () => {
    const health = await workerExports.default.fetch(
      new Request("https://auth.punks.test/api/auth/health"),
    );
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({
      service: "punks-auth",
      environment: "local",
      status: "ok",
    });

    const privateRpcAsHttp = await workerExports.default.fetch(
      new Request(`https://auth.punks.test/api/auth/v1/sessions/${sessionId}`),
    );
    expect(privateRpcAsHttp.status).toBe(404);
    await expect(privateRpcAsHttp.json()).resolves.toMatchObject({
      code: "not_found",
    });
  });
});
