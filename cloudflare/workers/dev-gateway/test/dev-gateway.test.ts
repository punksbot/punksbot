import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const INSTALLATION_ID = "019913d8-1254-811e-8c0f-43aac49f3b11";
const CONVERSATION_ID = "019913d8-1254-811e-8c0f-43aac49f3b12";
const MESSAGE_ID = "019913d8-1254-811e-8c0f-43aac49f3b13";
const LOCAL_ORIGIN = "http://localhost:1420";
const LOCAL_SESSION = {
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
};
const LOCAL_COORDINATES = {
  workspaceSlug: "local",
  workspaceId: "019913d8-1254-811e-8c0f-43aac49f3b22",
  conversationId: "019913d8-1254-811e-8c0f-43aac49f3b23",
};

describe("local development gateway", () => {
  it("serves an honest local diagnostic page at the root", async () => {
    const response = await SELF.fetch("http://local.test/");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );

    const body = await response.text();
    expect(body).toContain("Punks Bot local");
    expect(body).toContain("page de diagnostic locale");
    expect(body).toContain("pas la Punks UI produit");
    expect(body).toContain('href="/api/health"');
    expect(body).toContain('action="/__dev/bot-wakes"');
    expect(body).toContain('name="installationId"');
    expect(body).toContain('name="conversationId"');
    expect(body).toContain('name="messageId"');
  });

  it("proxies ordinary API requests", async () => {
    const response = await SELF.fetch("http://local.test/api/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "punks-api-fixture",
      environment: "local",
      status: "ok",
    });
  });

  it("routes Auth requests to the Auth Worker", async () => {
    const response = await SELF.fetch("http://local.test/api/auth/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "punks-auth-fixture",
      environment: "local",
      status: "ok",
    });
  });

  it("bootstraps one deterministic local Punk session and dataset", async () => {
    const request = () =>
      SELF.fetch("http://local.test/__dev/bootstrap", {
        method: "POST",
        headers: { origin: LOCAL_ORIGIN },
      });

    const first = await request();
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBeNull();
    expect(first.headers.get("set-cookie")).toMatch(
      /^punks_session_dev=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/,
    );
    await expect(first.json()).resolves.toEqual({
      session: LOCAL_SESSION,
      coordinates: LOCAL_COORDINATES,
    });

    const replay = await request();
    expect(replay.status).toBe(200);
    const replayText = await replay.text();
    expect(JSON.parse(replayText)).toEqual({
      session: LOCAL_SESSION,
      coordinates: LOCAL_COORDINATES,
    });
    expect(replayText).not.toContain("fixture-session-token");
    expect(replayText).not.toContain("operator");
  });

  it("rejects local bootstrap requests outside the configured Punks UI origin", async () => {
    for (const origin of [
      undefined,
      "http://127.0.0.1:1420",
      "https://evil.test",
    ]) {
      const response = await SELF.fetch("http://local.test/__dev/bootstrap", {
        method: "POST",
        headers: origin === undefined ? {} : { origin },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        type: "https://punks.bot/problems/forbidden",
        title: "The configured Punks UI origin is required",
        status: 403,
        code: "forbidden",
        retry: "never",
      });
    }
  });

  it("returns a retryable Punks problem when local bootstrap authority is unavailable", async () => {
    const auth = env.AUTH_DEV_BOOTSTRAP as unknown as {
      failNext(code: "temporarily_unavailable"): Promise<void>;
    };
    await auth.failNext("temporarily_unavailable");

    const response = await SELF.fetch("http://local.test/__dev/bootstrap", {
      method: "POST",
      headers: { origin: LOCAL_ORIGIN },
    });

    expect(response.status).toBe(503);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: "https://punks.bot/problems/temporarily-unavailable",
      title: "Local bootstrap authority is temporarily unavailable",
      status: 503,
      code: "temporarily_unavailable",
      retry: "later",
      retryAfterMs: 1_000,
    });
    expect(body.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Object.keys(body).sort()).toEqual(
      [
        "type",
        "title",
        "status",
        "code",
        "correlationId",
        "retry",
        "retryAfterMs",
      ].sort(),
    );
  });

  it("offers one exact known-Installation Wake", async () => {
    const response = await SELF.fetch("http://local.test/__dev/bot-wakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      wakeId: "019913d8-1254-811e-8c0f-43aac49f3b14",
    });
  });

  it("rejects extra fields before the private RPC", async () => {
    const response = await SELF.fetch("http://local.test/__dev/bot-wakes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        installationId: INSTALLATION_ID,
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        discover: true,
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      code: "invalid_request",
    });
  });
});
