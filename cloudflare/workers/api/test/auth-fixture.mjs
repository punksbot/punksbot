import { WorkerEntrypoint } from "cloudflare:workers";

export class RuntimeIdentityService extends WorkerEntrypoint {
  async runtimeVersion() {
    return { versionId: "00000000-0000-4000-8000-000000000001" };
  }
}

export class RuntimeIdentityFailureService extends WorkerEntrypoint {
  async runtimeVersion() {
    throw new Error("runtime identity unavailable");
  }
}

export class RuntimeIdentityInvalidService extends WorkerEntrypoint {
  async runtimeVersion() {
    return { versionId: "version-forgee" };
  }
}

const ownerSessionId = "11111111-1111-8111-8111-111111111111";
const otherSessionId = "22222222-2222-8222-8222-222222222222";
const thirdSessionId = "44444444-4444-8444-8444-444444444444";
const revocableSessionId = "33333333-3333-8333-8333-333333333333";
const revokedSessionIds = new Set();
const sessionResolutionHolds = new Map();
const invocationTimes = new Map();
const accountMergeRightsIndexCalls = [];
const accountMergeRightsIndexAvailability = {
  prepare: true,
  commit: true,
  abort: true,
};
const fixtureProfiles = new Map([
  [
    "00000000-0000-8000-8000-000000000001",
    {
      id: "00000000-0000-8000-8000-000000000001",
      status: "active",
      displayName: "Fixture Punk",
      avatarUrl: null,
      identities: [
        {
          provider: "github",
          subjectHash: "a".repeat(64),
          emailHash: "b".repeat(64),
          verifiedEmail: null,
          username: "fixture-punk",
          credentialId: null,
          linkedAt: "2026-08-20T18:00:00.000Z",
        },
      ],
      mergedInto: null,
      revision: 1,
      createdAt: "2026-08-20T18:00:00.000Z",
      updatedAt: "2026-08-20T18:00:00.000Z",
    },
  ],
  [
    "00000000-0000-8000-8000-000000000002",
    {
      id: "00000000-0000-8000-8000-000000000002",
      status: "active",
      displayName: "Fixture Punk",
      avatarUrl: null,
      identities: [
        {
          provider: "github",
          subjectHash: "c".repeat(64),
          emailHash: "d".repeat(64),
          verifiedEmail: null,
          username: "fixture-other",
          credentialId: null,
          linkedAt: "2026-08-20T18:00:00.000Z",
        },
      ],
      mergedInto: null,
      revision: 1,
      createdAt: "2026-08-20T18:00:00.000Z",
      updatedAt: "2026-08-20T18:00:00.000Z",
    },
  ],
]);

const session = (punkId) => ({
  sessionId: punkId.endsWith("1")
    ? ownerSessionId
    : punkId.endsWith("2")
      ? otherSessionId
      : thirdSessionId,
  punkId,
  authenticatedAt: "2026-08-20T18:00:00.000Z",
  expiresAt: "2099-08-20T19:00:00.000Z",
  recentReauthUntil: null,
  punk: { id: punkId, displayName: "Fixture Punk", avatarUrl: null },
});

const revocableSession = () => ({
  ...session("00000000-0000-8000-8000-000000000002"),
  sessionId: revocableSessionId,
});

export class PunkSessionService extends WorkerEntrypoint {
  holdSessionResolution(sessionId, callNumber) {
    sessionResolutionHolds.set(sessionId, {
      remaining: callNumber,
      reached: false,
    });
  }

  sessionResolutionHoldReached(sessionId) {
    return sessionResolutionHolds.get(sessionId)?.reached ?? false;
  }

  releaseSessionResolution(sessionId) {
    sessionResolutionHolds.delete(sessionId);
  }

  setSessionRevoked(sessionId, revoked) {
    if (revoked) {
      revokedSessionIds.add(sessionId);
    } else {
      revokedSessionIds.delete(sessionId);
    }
  }

  resolveSessionCookie(cookie) {
    if (cookie.includes("session-owner")) {
      return session("00000000-0000-8000-8000-000000000001");
    }
    if (cookie.includes("session-other")) {
      return session("00000000-0000-8000-8000-000000000002");
    }
    if (cookie.includes("session-third")) {
      return session("00000000-0000-8000-8000-000000000003");
    }
    if (cookie.includes("session-revocable")) {
      return revocableSession();
    }
    return null;
  }

  async resolveSessionId(sessionId) {
    const hold = sessionResolutionHolds.get(sessionId);
    if (hold !== undefined) {
      hold.remaining -= 1;
      if (hold.remaining === 0) {
        hold.reached = true;
        await scheduler.wait(3_000);
      }
    }
    if (revokedSessionIds.has(sessionId)) {
      return null;
    }
    if (sessionId === ownerSessionId) {
      return session("00000000-0000-8000-8000-000000000001");
    }
    if (sessionId === otherSessionId) {
      return session("00000000-0000-8000-8000-000000000002");
    }
    if (sessionId === thirdSessionId) {
      return session("00000000-0000-8000-8000-000000000003");
    }
    if (sessionId === revocableSessionId) {
      return revocableSession();
    }
    return null;
  }

  punkExists(punkId) {
    return (
      punkId === "00000000-0000-8000-8000-000000000001" ||
      punkId === "00000000-0000-8000-8000-000000000002" ||
      punkId === "00000000-0000-8000-8000-000000000003"
    );
  }

  resolvePunkSummary(punkId) {
    const profile = fixtureProfiles.get(punkId);
    return profile === undefined
      ? null
      : {
          id: profile.id,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          revision: profile.revision,
          updatedAt: profile.updatedAt,
        };
  }

  getPunkProfile(punkId) {
    return structuredClone(fixtureProfiles.get(punkId) ?? null);
  }

  updatePunkProfile(punkId, command) {
    const current = fixtureProfiles.get(punkId);
    if (current === undefined) return { ok: false, code: "not_found" };
    if (current.revision !== command.expectedRevision) {
      return {
        ok: false,
        code: "revision_conflict",
        currentRevision: current.revision,
      };
    }
    const next = {
      ...current,
      displayName: command.displayName,
      avatarUrl: command.avatarUrl,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    fixtureProfiles.set(punkId, next);
    return { ok: true, state: structuredClone(next), replayed: false };
  }
}

export class AccountMergePlanningService extends WorkerEntrypoint {
  recordAccountMergeFreshProof() {
    return null;
  }

  revokeAccountMergeFreshProof() {
    return false;
  }

  prepareAccountMergePlan() {
    return {
      contract: "account-merge.plan-response@1",
      ok: false,
      code: "plan_unavailable",
      correlationId: "account-merge",
    };
  }

  readAccountMergePlan() {
    return null;
  }
}

export class AccountMergeRightsIndexService extends WorkerEntrypoint {
  setAvailable(available) {
    for (const phase of Object.keys(accountMergeRightsIndexAvailability)) {
      accountMergeRightsIndexAvailability[phase] = available;
    }
  }

  setPhaseAvailable(phase, available) {
    if (Object.hasOwn(accountMergeRightsIndexAvailability, phase)) {
      accountMergeRightsIndexAvailability[phase] = available;
    }
  }

  resetCalls() {
    accountMergeRightsIndexCalls.length = 0;
    this.setAvailable(true);
  }

  calls() {
    return structuredClone(accountMergeRightsIndexCalls);
  }

  prepareWorkspaceMembershipChange(input) {
    accountMergeRightsIndexCalls.push({ phase: "prepare", input });
    return accountMergeRightsIndexAvailability.prepare;
  }

  commitWorkspaceMembershipChange(input) {
    accountMergeRightsIndexCalls.push({ phase: "commit", input });
    return accountMergeRightsIndexAvailability.commit;
  }

  abortWorkspaceMembershipChange(input) {
    accountMergeRightsIndexCalls.push({ phase: "abort", input });
    return accountMergeRightsIndexAvailability.abort;
  }
}

export class BotInvocationVerifier extends WorkerEntrypoint {
  verifyBotInvocation(input) {
    if (input.credential.includes("malformed-verifier")) {
      return { ok: true };
    }
    const now = Math.floor(Date.now() / 1000);
    const times = invocationTimes.get(input.credential) ?? {
      issuedAt: now,
      notBefore: now - 1,
      expiresAt: now + 60,
    };
    invocationTimes.set(input.credential, times);
    return {
      ok: true,
      principal: {
        schemaVersion: 1,
        environment: "local",
        audience: "punks-bot-action",
        kid: "test",
        jti: "10000000-0000-8000-8000-000000000008",
        invocationId: input.invocationId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        botId: input.credential.includes("mismatched-bot")
          ? "f0000000-0000-8000-8000-000000000099"
          : input.botId,
        authorityGeneration: input.authorityGeneration,
        issuedAt: times.issuedAt,
        notBefore: times.notBefore,
        expiresAt: times.expiresAt,
      },
    };
  }
}

export class BotInvocationIssuer extends WorkerEntrypoint {
  mintBotInvocation(input) {
    const now = Math.floor(Date.now() / 1_000);
    return {
      ok: true,
      credential: `pbi1.test-v1.${input.invocationId}.${"A".repeat(43)}`,
      principal: {
        schemaVersion: 1,
        environment: "local",
        audience: "punks-bot-action",
        kid: "test-v1",
        jti: input.invocationId,
        invocationId: input.invocationId,
        workspaceId: input.workspaceId,
        installationId: input.installationId,
        botId: input.botId,
        authorityGeneration: input.authorityGeneration,
        issuedAt: now,
        notBefore: now,
        expiresAt: now + 30,
      },
    };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__test/session-revocation") {
      const body = await request.json();
      if (request.method === "POST") {
        revokedSessionIds.add(body.sessionId);
      } else if (request.method === "DELETE") {
        revokedSessionIds.delete(body.sessionId);
      }
      return Response.json({ ok: true });
    }
    const cookie = request.headers.get("cookie") ?? "";
    if (cookie.includes("session-owner")) {
      return Response.json({
        session: session("00000000-0000-8000-8000-000000000001"),
      });
    }
    if (cookie.includes("session-other")) {
      return Response.json({
        session: session("00000000-0000-8000-8000-000000000002"),
      });
    }
    if (cookie.includes("session-revocable")) {
      return Response.json({ session: revocableSession() });
    }
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  },
};
