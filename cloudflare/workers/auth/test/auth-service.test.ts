import { exports as workerExports } from "cloudflare:workers";
import {
  env,
  evictDurableObject,
  listDurableObjectIds,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../src/env";
import type { SessionRecord } from "../src/rpc";
import type { SessionDO } from "../src/session-do";

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
  it("migrates a local Session schema that predates client_kind and prepared", async () => {
    const legacySessionId = "a0000000-0000-8000-8000-000000000099";
    const legacyPunkId = "b0000000-0000-8000-8000-000000000099";
    const session = authEnv.SESSIONS.getByName(legacySessionId);
    const authenticatedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await runInDurableObject(session, async (_instance, state) => {
      state.storage.sql.exec("DROP TABLE auth_session");
      state.storage.sql.exec(`
        CREATE TABLE auth_session (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          session_id TEXT NOT NULL,
          punk_id TEXT NOT NULL,
          authenticated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          recent_reauth_until TEXT,
          status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
          updated_at TEXT NOT NULL
        ) STRICT
      `);
      state.storage.sql.exec(
        `INSERT INTO auth_session
          (singleton, session_id, punk_id, authenticated_at, expires_at,
           recent_reauth_until, status, updated_at)
         VALUES (1, ?, ?, ?, ?, NULL, 'active', ?)`,
        legacySessionId,
        legacyPunkId,
        authenticatedAt,
        expiresAt,
        authenticatedAt,
      );
    });
    await evictDurableObject(session);

    await expect(
      authEnv.SESSIONS.getByName(legacySessionId).get(),
    ).resolves.toMatchObject({
      sessionId: legacySessionId,
      punkId: legacyPunkId,
    });
    await runInDurableObject(
      authEnv.SESSIONS.getByName(legacySessionId),
      async (_instance, state) => {
        const columns = state.storage.sql
          .exec<{ name: string }>("PRAGMA table_info(auth_session)")
          .toArray()
          .map((column) => column.name);
        expect(columns).toContain("client_kind");
        const schema = state.storage.sql
          .exec<{ sql: string }>(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_session'",
          )
          .toArray()[0]?.sql;
        expect(schema).toContain("'prepared'");
      },
    );
  });

  it("revokes rather than restores a Session after authority-loss recovery", async () => {
    const recoverySessionId = "a0000000-0000-8000-8000-000000000090";
    const recoveryPunkId = "b0000000-0000-8000-8000-000000000091";
    await provisionActivePunk(recoveryPunkId);
    await createActiveSession(recoverySessionId, recoveryPunkId);
    const session = authEnv.SESSIONS.getByName(recoverySessionId);
    const identity = {
      executionId: "919191919191:linux-x64:perte-autorite:auth-session",
      candidateSha: "91".repeat(20),
      stagingDeploymentId: `sha256:${"92".repeat(32)}`,
      type: "perte-autorite" as const,
      authority: "auth-session",
      target: {
        kind: "aggregate" as const,
        id: recoverySessionId,
        probe: {
          punkId: recoveryPunkId,
          workspaceId: "00000000-0000-8000-8000-000000000059",
          workspaceSlug: "promotion-fixture",
          conversationId: "00000000-0000-8000-8000-000000000060",
          messageId: "00000000-0000-8000-8000-000000000058",
        },
      },
    };
    await expect(session.injectPromotionFault(identity)).resolves.toMatchObject(
      {
        phase: "injected",
      },
    );
    for (const proof of [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
      "recu-resistant-pitr",
    ] as const) {
      await expect(
        session.recoverPromotionFault({ ...identity, proof }),
      ).resolves.toMatchObject({ proof });
    }
    await expect(session.get()).resolves.toBeNull();
    await expect(
      workerExports.PunkSessionService.resolveSessionId(recoverySessionId),
    ).resolves.toBeNull();
  });

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
      runInDurableObject(session, async (instance) =>
        (instance as SessionDO).get(),
      ),
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
