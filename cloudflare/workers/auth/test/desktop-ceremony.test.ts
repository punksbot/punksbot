import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv, AuthProvider } from "../src/env";
import type { ProviderFetch } from "../src/provider";
import { route } from "../src/router";

const authEnv = env as AuthEnv;
const origin = "https://auth.punks.test";

const INSTALLATION_ID = "8f1d6a52-9c3e-4b7d-a5f1-2e8b0c4d6a9b";
const OTHER_INSTALLATION_ID = "c2a9e741-5d08-4f3b-b6c2-9e7a1d5f8b34";

function sessionCookieValue(response: Response): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(/(?:__Host-)?punks_session[^;]*=([^;,]+)/);
  if (match?.[1] === undefined) {
    throw new Error(`Missing session cookie: ${value}`);
  }
  return match[1];
}

async function startDesktop(options: {
  provider?: AuthProvider;
  installationId?: string;
  environment?: string;
  originHeader?: string | null;
  env?: AuthEnv;
}): Promise<{
  response: Response;
  state: string;
  oauthCookie: string;
}> {
  const response = await route(
    new Request(`${origin}/api/auth/v1/desktop/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(options.originHeader === null
          ? {}
          : { origin: options.originHeader ?? origin }),
      },
      body: JSON.stringify({
        contract: "auth.desktop-start@1",
        provider: options.provider ?? "google",
        intent: "sign_in",
        installationId: options.installationId ?? INSTALLATION_ID,
        environment: options.environment ?? authEnv.ENVIRONMENT,
      }),
    }),
    options.env ?? authEnv,
  );
  if (response.status !== 201) {
    return { response, state: "", oauthCookie: "" };
  }
  const body = (await response.clone().json()) as {
    authorizationUrl: string;
  };
  const state = new URL(body.authorizationUrl).searchParams.get("state") ?? "";
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/(__Host-punks_oauth_[A-Za-z0-9_-]+)=([^;,]+)/);
  return {
    response,
    state,
    oauthCookie: match ? `${match[1]}=${match[2]}` : "",
  };
}

function googleProviderFixture(subject: string): ProviderFetch {
  return async (input, init) => {
    const url = String(input);
    if (url.includes("/token") || url.includes("access_token")) {
      expect(String(init?.body)).toContain("code_verifier=");
      return Response.json({
        access_token: "provider-access-token-for-workerd-tests",
        token_type: "bearer",
      });
    }
    return Response.json({
      sub: subject,
      email: `${subject}@example.com`,
      email_verified: true,
      name: `Punk ${subject}`,
      picture: "https://images.example/punk.png",
    });
  };
}

async function completeDesktopSignIn(
  suffix: string,
  installationId = INSTALLATION_ID,
): Promise<{ deliveryToken: string; deeplink: URL; response: Response }> {
  const started = await startDesktop({ installationId });
  expect(started.response.status).toBe(201);
  const response = await route(
    new Request(
      `${origin}/api/auth/v1/oauth/google/callback?state=${encodeURIComponent(started.state)}&code=fixture-code`,
      { headers: { cookie: started.oauthCookie } },
    ),
    authEnv,
    googleProviderFixture(suffix),
  );
  expect(response.status).toBe(303);
  const location = response.headers.get("location") ?? "";
  expect(location).toMatch(/^punks:\/\/session\?/);
  const deeplink = new URL(location);
  const deliveryToken = deeplink.searchParams.get("delivery") ?? "";
  expect(deliveryToken.length).toBeGreaterThanOrEqual(43);
  expect(deeplink.searchParams.get("environment")).toBe(authEnv.ENVIRONMENT);
  return { deliveryToken, deeplink, response };
}

async function deliver(
  deliveryToken: string,
  installationId = INSTALLATION_ID,
  originHeader: string | null = origin,
  envOverride?: AuthEnv,
): Promise<Response> {
  return route(
    new Request(`${origin}/api/auth/v1/desktop/deliver`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(originHeader === null ? {} : { origin: originHeader }),
      },
      body: JSON.stringify({
        contract: "auth.desktop-delivery@1",
        deliveryToken,
        installationId,
      }),
    }),
    envOverride ?? authEnv,
  );
}

async function renew(
  sessionCookie: string,
  envOverride?: AuthEnv,
  originHeader: string | null = origin,
): Promise<Response> {
  return route(
    new Request(`${origin}/api/auth/v1/desktop/session/renew`, {
      method: "POST",
      headers: {
        ...(originHeader === null ? {} : { origin: originHeader }),
        cookie: sessionCookie,
      },
    }),
    envOverride ?? authEnv,
  );
}

describe("Cérémonie de connexion desktop (issue #54)", () => {
  it("refuse un démarrage sans origine, hors contrat ou d'un autre environnement", async () => {
    const sansOrigine = await startDesktop({ originHeader: null });
    expect(sansOrigine.response.status).toBe(403);

    const mauvaiseOrigine = await startDesktop({
      originHeader: "https://evil.example",
    });
    expect(mauvaiseOrigine.response.status).toBe(403);

    const autreEnvironnement = await startDesktop({
      environment: authEnv.ENVIRONMENT === "local" ? "staging" : "local",
    });
    expect(autreEnvironnement.response.status).toBe(403);

    const invalide = await route(
      new Request(`${origin}/api/auth/v1/desktop/start`, {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ contract: "auth.desktop-start@1" }),
      }),
      authEnv,
    );
    expect(invalide.status).toBe(400);
  });

  it("délivre la session par deeplink sans jamais poser le cookie dans le navigateur", async () => {
    const { deliveryToken, response } =
      await completeDesktopSignIn("desktop-delivery");
    expect(response.headers.get("set-cookie") ?? "").not.toContain(
      "punks_session",
    );
    expect(deliveryToken).not.toBe("");
  });

  it("consomme la livraison exactement une fois pour l'installation attendue", async () => {
    const { deliveryToken } = await completeDesktopSignIn("desktop-consume");

    const mauvaiseInstallation = await deliver(
      deliveryToken,
      OTHER_INSTALLATION_ID,
    );
    expect(mauvaiseInstallation.status).toBe(400);

    const livree = await deliver(deliveryToken);
    expect(livree.status).toBe(200);
    const body = (await livree.json()) as {
      session: { punkId: string; expiresAt: string };
    };
    expect(body.session.punkId).toBeTruthy();
    const cookie = sessionCookieValue(livree);
    expect(cookie).not.toContain("deleted");

    const rejeu = await deliver(deliveryToken);
    expect(rejeu.status).toBe(409);

    const sessionResponse = await route(
      new Request(`${origin}/api/auth/v1/session`, {
        headers: { cookie: `__Host-punks_session=${cookie}` },
      }),
      authEnv,
    );
    expect(sessionResponse.status).toBe(200);
  });

  it("refuse une livraison inconnue, expirée ou sans origine", async () => {
    const inconnue = await deliver("a".repeat(64));
    expect(inconnue.status).toBe(400);

    const sansOrigine = await deliver("b".repeat(64), INSTALLATION_ID, null);
    expect(sansOrigine.status).toBe(403);
  });

  it("renouvelle la session glissante puis applique la limite de 24 heures", async () => {
    const { deliveryToken } = await completeDesktopSignIn("desktop-renew");
    const livree = await deliver(deliveryToken);
    const cookie = `__Host-punks_session=${sessionCookieValue(livree)}`;

    const renouvelee = await renew(cookie);
    expect(renouvelee.status).toBe(200);
    const body = (await renouvelee.json()) as {
      session: { expiresAt: string };
    };
    expect(Date.parse(body.session.expiresAt)).toBeGreaterThan(Date.now());

    const tropTot = await renew(cookie);
    expect(tropTot.status).toBe(429);

    const sansOrigine = await renew(cookie, undefined, null);
    expect(sansOrigine.status).toBe(403);

    const sansSession = await renew("");
    expect(sansSession.status).toBe(401);
  });

  it("refuse le renouvellement tant que l'expiration restante dépasse le seuil", async () => {
    const longTerme: AuthEnv = {
      ...authEnv,
      SESSION_TTL_SECONDS: "2592000",
    } as AuthEnv;
    const started = await startDesktop({ env: longTerme });
    expect(started.response.status).toBe(201);
    const response = await route(
      new Request(
        `${origin}/api/auth/v1/oauth/google/callback?state=${encodeURIComponent(started.state)}&code=fixture-code`,
        { headers: { cookie: started.oauthCookie } },
      ),
      longTerme,
      googleProviderFixture("desktop-not-due"),
    );
    expect(response.status).toBe(303);
    const deliveryToken =
      new URL(response.headers.get("location") ?? "").searchParams.get(
        "delivery",
      ) ?? "";
    const livree = await deliver(
      deliveryToken,
      INSTALLATION_ID,
      origin,
      longTerme,
    );
    expect(livree.status).toBe(200);
    const cookie = `__Host-punks_session=${sessionCookieValue(livree)}`;

    // La session vit 30 jours : au-dessus du seuil de 7 jours, le
    // renouvellement glissant est refusé jusqu'à ce qu'il soit dû.
    const pasDue = await renew(cookie, longTerme);
    expect(pasDue.status).toBe(409);
    const detail = (await pasDue.json()) as { title?: string };
    expect(detail.title).toContain("not_due");
  });
});
