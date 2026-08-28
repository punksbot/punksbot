import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv, AuthIntent, AuthProvider } from "../src/env";
import type { ProviderFetch } from "../src/provider";
import { route } from "../src/router";

const authEnv = env as AuthEnv;
const origin = "https://auth.punks.test";

interface FixtureProfile {
  subject: string;
  email: string;
  name: string;
  login?: string;
}

interface StartedAuth {
  state: string;
  oauthCookie: string;
  authorizationUrl: URL;
}

function firstCookie(response: Response, name: string): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(new RegExp(`${name}=([^;,]+)`));
  if (match?.[1] === undefined) {
    throw new Error(`Missing cookie ${name}: ${value}`);
  }
  return `${name}=${match[1]}`;
}

function oauthCookie(response: Response): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(/(__Host-punks_oauth_[A-Za-z0-9_-]+)=([^;,]+)/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Missing OAuth cookie: ${value}`);
  }
  return `${match[1]}=${match[2]}`;
}

async function start(
  provider: AuthProvider,
  intent: AuthIntent = "sign_in",
  session?: string,
): Promise<StartedAuth & { response: Response }> {
  const response = await route(
    new Request(`${origin}/api/auth/v1/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(session === undefined ? {} : { cookie: session }),
      },
      body: JSON.stringify({
        contract: "auth.start@1",
        provider,
        intent,
        returnTo: "/inbox",
      }),
    }),
    authEnv,
  );
  const body = (await response.clone().json()) as { authorizationUrl: string };
  const authorizationUrl = new URL(body.authorizationUrl);
  const state = authorizationUrl.searchParams.get("state");
  if (state === null) throw new Error("Authorization URL has no state");
  return {
    response,
    authorizationUrl,
    state,
    oauthCookie: oauthCookie(response),
  };
}

function providerFixture(
  provider: AuthProvider,
  profile: FixtureProfile,
  options: { githubScope?: string } = {},
): { fetch: ProviderFetch; calls: string[] } {
  const calls: string[] = [];
  const fixtureFetch: ProviderFetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/token") || url.includes("access_token")) {
      const body = String(init?.body);
      expect(body).toContain("code_verifier=");
      return Response.json({
        access_token: "provider-access-token-for-workerd-tests",
        token_type: "bearer",
        ...(provider === "github"
          ? { scope: options.githubScope ?? "read:user,user:email" }
          : {}),
      });
    }
    if (provider === "google" && url.includes("userinfo")) {
      return Response.json({
        sub: profile.subject,
        email: profile.email,
        email_verified: true,
        name: profile.name,
        picture: "https://images.example/punk.png",
      });
    }
    if (provider === "github" && url.endsWith("/user")) {
      return Response.json({
        id: Number(profile.subject),
        login: profile.login ?? "octopunk",
        name: profile.name,
        avatar_url: "https://images.example/punk.png",
      });
    }
    if (provider === "github" && url.endsWith("/user/emails")) {
      return Response.json([
        { email: profile.email, verified: true, primary: true },
      ]);
    }
    return new Response("unexpected fixture request", { status: 500 });
  };
  return { fetch: fixtureFetch, calls };
}

async function callback(
  started: StartedAuth,
  provider: AuthProvider,
  providerFetch: ProviderFetch,
  extraCookie?: string,
): Promise<Response> {
  return route(
    new Request(
      `${origin}/api/auth/v1/oauth/${provider}/callback?state=${encodeURIComponent(started.state)}&code=fixture-code`,
      {
        headers: {
          cookie: [started.oauthCookie, extraCookie]
            .filter((value): value is string => value !== undefined)
            .join("; "),
        },
      },
    ),
    authEnv,
    providerFetch,
  );
}

async function signInGoogle(suffix: string): Promise<{
  sessionCookie: string;
  punkId: string;
}> {
  const started = await start("google");
  const fixture = providerFixture("google", {
    subject: `google-${suffix}`,
    email: `${suffix}@example.com`,
    name: `Punk ${suffix}`,
  });
  const response = await callback(started, "google", fixture.fetch);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toContain("auth=signed_in");
  const session = firstCookie(response, "__Host-punks_session");
  const sessionResponse = await route(
    new Request(`${origin}/api/auth/v1/session`, {
      headers: { cookie: session },
    }),
    authEnv,
  );
  expect(sessionResponse.status).toBe(200);
  const body = (await sessionResponse.json()) as {
    session: { punkId: string };
  };
  return { sessionCookie: session, punkId: body.session.punkId };
}

async function reauthenticateGoogle(
  suffix: string,
  session: string,
): Promise<void> {
  const reauth = await start("google", "reauthenticate", session);
  const google = providerFixture("google", {
    subject: `google-${suffix}`,
    email: `${suffix}@example.com`,
    name: `Punk ${suffix}`,
  });
  const response = await callback(reauth, "google", google.fetch, session);
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toContain("auth=reauthenticated");
}

describe("Punks Auth Worker", () => {
  it("starts GitHub OAuth with browser-bound state and only identity scopes", async () => {
    const started = await start("github");
    expect(started.response.status).toBe(201);
    expect(started.authorizationUrl.origin).toBe("https://github.com");
    expect(started.authorizationUrl.searchParams.get("scope")).toBe(
      "read:user user:email",
    );
    expect(started.authorizationUrl.searchParams.get("scope")).not.toContain(
      "repo",
    );
    expect(
      started.authorizationUrl.searchParams.get("code_challenge_method"),
    ).toBe("S256");
    expect(started.authorizationUrl.searchParams.get("code_challenge")).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(started.response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(started.response.headers.get("set-cookie")).toContain("Secure");
  });

  it("creates one global Punk, an opaque session, and consumes state once", async () => {
    const started = await start("google");
    const fixture = providerFixture("google", {
      subject: "google-new-punk",
      email: "new-punk@example.com",
      name: "New Punk",
    });
    const signedIn = await callback(started, "google", fixture.fetch);
    expect(signedIn.status).toBe(303);
    expect(signedIn.headers.get("location")).toContain("auth=signed_in");
    const session = firstCookie(signedIn, "__Host-punks_session");
    expect(session).not.toContain("google-new-punk");
    expect(session).not.toContain("new-punk@example.com");

    const current = await route(
      new Request(`${origin}/api/auth/v1/session`, {
        headers: { cookie: session },
      }),
      authEnv,
    );
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      session: { punk: { displayName: "New Punk" } },
    });

    const replay = await callback(started, "google", fixture.fetch);
    expect(replay.status).toBe(400);
  });

  it("detects a verified-email collision without automatic linking or merging", async () => {
    await signInGoogle("collision");
    const started = await start("github");
    const fixture = providerFixture("github", {
      subject: "424242",
      email: "collision@example.com",
      name: "Collision Punk",
      login: "collision-punk",
    });
    const response = await callback(started, "github", fixture.fetch);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("auth=link_required");
    expect(response.headers.get("set-cookie")).not.toContain(
      "__Host-punks_session=",
    );
  });

  it("requires reauthentication before explicitly linking another identity", async () => {
    const signedIn = await signInGoogle("link-source");
    const denied = await route(
      new Request(`${origin}/api/auth/v1/start`, {
        method: "POST",
        headers: {
          cookie: signedIn.sessionCookie,
          "content-type": "application/json",
          origin,
        },
        body: JSON.stringify({
          contract: "auth.start@1",
          provider: "github",
          intent: "link",
          returnTo: "/settings/identity",
        }),
      }),
      authEnv,
    );
    expect(denied.status).toBe(403);

    await reauthenticateGoogle("link-source", signedIn.sessionCookie);

    const linking = await start("github", "link", signedIn.sessionCookie);
    expect(linking.response.status).toBe(201);
    const github = providerFixture("github", {
      subject: "989898",
      email: "linked-github@example.com",
      name: "Linked GitHub",
      login: "linked-github",
    });
    const linked = await callback(
      linking,
      "github",
      github.fetch,
      signedIn.sessionCookie,
    );
    expect(linked.headers.get("location")).toContain("auth=linked");
    const punk = await authEnv.PUNKS.getByName(signedIn.punkId).query();
    expect(punk.ok).toBe(true);
    if (punk.ok) {
      expect(
        punk.state.identities.map(({ provider }) => provider).sort(),
      ).toEqual(["github", "google"]);
    }
  });

  it("rejects a GitHub token carrying repository scope", async () => {
    const started = await start("github");
    const fixture = providerFixture(
      "github",
      {
        subject: "777777",
        email: "repo-scope@example.com",
        name: "Wrong Scope",
      },
      { githubScope: "read:user,user:email,repo" },
    );
    const response = await callback(started, "github", fixture.fetch);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("auth=provider_error");
    expect(fixture.calls).toHaveLength(1);
  });

  it("rejects a callback not bound to the browser that started it", async () => {
    const started = await start("google");
    const fixture = providerFixture("google", {
      subject: "wrong-browser",
      email: "wrong-browser@example.com",
      name: "Wrong Browser",
    });
    const missing = await route(
      new Request(
        `${origin}/api/auth/v1/oauth/google/callback?state=${started.state}&code=fixture-code`,
      ),
      authEnv,
      fixture.fetch,
    );
    expect(missing.status).toBe(400);
    expect(fixture.calls).toHaveLength(0);
    const response = await route(
      new Request(
        `${origin}/api/auth/v1/oauth/google/callback?state=${started.state}&code=fixture-code`,
        {
          headers: {
            cookie: started.oauthCookie.replace(
              /=.*/,
              "=wrong-browser-binding",
            ),
          },
        },
      ),
      authEnv,
      fixture.fetch,
    );
    expect(response.status).toBe(400);
    expect(fixture.calls).toHaveLength(0);
  });
});
