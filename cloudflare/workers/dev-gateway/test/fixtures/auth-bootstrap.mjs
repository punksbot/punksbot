import { WorkerEntrypoint } from "cloudflare:workers";

let nextFailure = null;

export class LocalDevAuthBootstrapService extends WorkerEntrypoint {
  failNext(code) {
    nextFailure = code;
  }

  bootstrap() {
    if (nextFailure !== null) {
      const code = nextFailure;
      nextFailure = null;
      return { ok: false, code };
    }
    return {
      ok: true,
      session: {
        sessionId: "019913d8-1254-811e-8c0f-43aac49f3b20",
        punkId: "019913d8-1254-811e-8c0f-43aac49f3b21",
        authenticatedAt: "2026-08-21T12:00:00.000Z",
        expiresAt: "2099-08-21T12:00:00.000Z",
        recentReauthUntil: null,
        punk: {
          id: "019913d8-1254-811e-8c0f-43aac49f3b21",
          displayName: "Punk local",
          avatarUrl: null,
        },
      },
      cookie:
        "punks_session_dev=fixture-session-token; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax",
    };
  }
}
