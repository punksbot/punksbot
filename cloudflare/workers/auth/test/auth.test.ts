import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv, AuthIntent, AuthProvider } from "../src/env";
import type { ProviderFetch } from "../src/provider";
import { route } from "../src/router";
import { aggregateName, getActiveSession } from "../src/session";
import { bytesToBase64Url } from "../src/crypto";

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

function passkeyCookie(response: Response): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(/(__Host-punks_passkey_[A-Za-z0-9-]+)=([^;,]+)/);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Missing passkey cookie: ${value}`);
  }
  return `${match[1]}=${match[2]}`;
}

function concatBytes(...values: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    values.reduce((total, value) => total + value.byteLength, 0),
  );
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.byteLength;
  }
  return output;
}

function derInteger(value: Uint8Array): Uint8Array {
  let offset = 0;
  while (offset < value.length - 1 && value[offset] === 0) offset += 1;
  const normalized = value.slice(offset);
  const prefixed = (normalized[0] ?? 0) >= 0x80;
  return concatBytes(
    new Uint8Array([0x02, normalized.length + (prefixed ? 1 : 0)]),
    prefixed ? new Uint8Array([0]) : new Uint8Array(),
    normalized,
  );
}

function webAuthnSignature(signature: Uint8Array): Uint8Array {
  if (signature[0] === 0x30) return signature;
  if (signature.length !== 64)
    throw new TypeError("Unexpected ECDSA signature");
  const left = derInteger(signature.slice(0, 32));
  const right = derInteger(signature.slice(32));
  return concatBytes(
    new Uint8Array([0x30, left.length + right.length]),
    left,
    right,
  );
}

async function passkeyFixture(punkId: string) {
  const keys = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  if (jwk.x === undefined || jwk.y === undefined) {
    throw new TypeError("P-256 key coordinates are missing");
  }
  const x = Uint8Array.from(
    atob(jwk.x.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
  const y = Uint8Array.from(
    atob(jwk.y.replace(/-/g, "+").replace(/_/g, "/")),
    (char) => char.charCodeAt(0),
  );
  const cosePublicKey = concatBytes(
    new Uint8Array([
      0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20,
    ]),
    x,
    new Uint8Array([0x22, 0x58, 0x20]),
    y,
  );
  const credentialId = bytesToBase64Url(
    crypto.getRandomValues(new Uint8Array(32)),
  );
  const credential = authEnv.PASSKEY_CREDENTIALS.getByName(
    await aggregateName("passkey-credential", credentialId),
  );
  const transactionId = crypto.randomUUID();
  expect(
    await credential.reserve({
      credentialId,
      punkId,
      subjectHash: "9".repeat(64),
      publicKey: bytesToBase64Url(cosePublicKey),
      counter: 0,
      transports: [],
      deviceType: "singleDevice",
      backedUp: false,
      transactionId,
      now: new Date().toISOString(),
    }),
  ).toMatchObject({ ok: true });
  expect(await credential.activate({ punkId, transactionId })).toBe(true);
  return { credentialId, privateKey: keys.privateKey };
}

async function passkeyAssertion(input: {
  credentialId: string;
  privateKey: CryptoKey;
  challenge: string;
}) {
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: "webauthn.get",
      challenge: input.challenge,
      origin,
      crossOrigin: false,
    }),
  );
  const rpIdHash = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("auth.punks.test"),
    ),
  );
  const authenticatorData = concatBytes(
    rpIdHash,
    new Uint8Array([0x05]),
    new Uint8Array([0, 0, 0, 1]),
  );
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientData),
  );
  const signature = webAuthnSignature(
    new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        input.privateKey,
        new Uint8Array(concatBytes(authenticatorData, clientDataHash)).buffer,
      ),
    ),
  );
  return {
    id: input.credentialId,
    rawId: input.credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: bytesToBase64Url(clientData),
      authenticatorData: bytesToBase64Url(authenticatorData),
      signature: bytesToBase64Url(signature),
      userHandle: null,
    },
  };
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
  if (state === null) {
    throw new Error("Authorization URL has no state");
  }
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

  it("offers optional passkey registration only after recent reauthentication", async () => {
    const signedIn = await signInGoogle("passkey-owner");
    const denied = await route(
      new Request(`${origin}/api/auth/v1/passkeys/register/options`, {
        method: "POST",
        headers: { cookie: signedIn.sessionCookie, origin },
      }),
      authEnv,
    );
    expect(denied.status).toBe(403);

    await reauthenticateGoogle("passkey-owner", signedIn.sessionCookie);
    const optionsResponse = await route(
      new Request(`${origin}/api/auth/v1/passkeys/register/options`, {
        method: "POST",
        headers: { cookie: signedIn.sessionCookie, origin },
      }),
      authEnv,
    );
    expect(optionsResponse.status).toBe(201);
    const body = (await optionsResponse.clone().json()) as {
      ceremonyId: string;
      purpose: string;
      publicKey: {
        rp: { id: string };
        user: { id: string; name: string };
        authenticatorSelection: {
          residentKey: string;
          userVerification: string;
        };
      };
    };
    expect(body).toMatchObject({
      purpose: "registration",
      publicKey: {
        rp: { id: "auth.punks.test" },
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      },
    });
    expect(body.publicKey.user.name).toBe(`punk:${signedIn.punkId}`);
    expect(body.publicKey.user.id).not.toContain("passkey-owner@example.com");
    const ceremonyCookie = passkeyCookie(optionsResponse);
    expect(ceremonyCookie).toContain("__Host-punks_passkey_");

    const invalidProof = await route(
      new Request(`${origin}/api/auth/v1/passkeys/register/finish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ceremonyCookie}; ${signedIn.sessionCookie}`,
          origin,
        },
        body: JSON.stringify({
          contract: "auth.passkey.finish@1",
          ceremonyId: body.ceremonyId,
          response: {
            id: "invalid-registration",
            rawId: "invalid-registration",
            type: "public-key",
            clientExtensionResults: {},
            response: {
              clientDataJSON: "invalid",
              attestationObject: "invalid",
            },
          },
        }),
      }),
      authEnv,
    );
    expect(invalidProof.status).toBe(400);
  });

  it("binds discoverable passkey authentication to a one-use browser ceremony", async () => {
    const optionsResponse = await route(
      new Request(`${origin}/api/auth/v1/passkeys/authenticate/options`, {
        method: "POST",
        headers: { origin },
      }),
      authEnv,
    );
    expect(optionsResponse.status).toBe(201);
    const body = (await optionsResponse.clone().json()) as {
      ceremonyId: string;
      purpose: string;
      publicKey: {
        rpId: string;
        userVerification: string;
        allowCredentials?: unknown;
      };
    };
    expect(body).toMatchObject({
      purpose: "authentication",
      publicKey: {
        rpId: "auth.punks.test",
        userVerification: "required",
      },
    });
    expect(body.publicKey.allowCredentials).toBeUndefined();

    const finishBody = JSON.stringify({
      contract: "auth.passkey.finish@1",
      ceremonyId: body.ceremonyId,
      response: {
        id: "unknown-credential",
        rawId: "unknown-credential",
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: "invalid",
          authenticatorData: "invalid",
          signature: "invalid",
        },
      },
    });
    const wrongBrowser = await route(
      new Request(`${origin}/api/auth/v1/passkeys/authenticate/finish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: passkeyCookie(optionsResponse).replace(
            /=.*/,
            "=wrong-browser-binding",
          ),
          origin,
        },
        body: finishBody,
      }),
      authEnv,
    );
    expect(wrongBrowser.status).toBe(400);

    const unknownCredential = await route(
      new Request(`${origin}/api/auth/v1/passkeys/authenticate/finish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: passkeyCookie(optionsResponse),
          origin,
        },
        body: finishBody,
      }),
      authEnv,
    );
    expect(unknownCredential.status).toBe(401);

    const replay = await route(
      new Request(`${origin}/api/auth/v1/passkeys/authenticate/finish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: passkeyCookie(optionsResponse),
          origin,
        },
        body: finishBody,
      }),
      authEnv,
    );
    expect(replay.status).toBe(400);
  });

  it("records merge reauthentication only after the real passkey verification path", async () => {
    const signedIn = await signInGoogle("merge-passkey");
    const credential = await passkeyFixture(signedIn.punkId);
    const optionsResponse = await route(
      new Request(`${origin}/api/auth/v1/passkeys/authenticate/options`, {
        method: "POST",
        headers: { cookie: signedIn.sessionCookie, origin },
      }),
      authEnv,
    );
    expect(optionsResponse.status).toBe(201);
    const options = (await optionsResponse.clone().json()) as {
      ceremonyId: string;
      publicKey: { challenge: string };
    };
    const response = await passkeyAssertion({
      ...credential,
      challenge: options.publicKey.challenge,
    });
    const finished = await route(
      new Request(`${origin}/api/auth/v1/passkeys/authenticate/finish`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${passkeyCookie(optionsResponse)}; ${signedIn.sessionCookie}`,
          origin,
        },
        body: JSON.stringify({
          contract: "auth.passkey.finish@1",
          ceremonyId: options.ceremonyId,
          response,
        }),
      }),
      authEnv,
    );
    expect(finished.status).toBe(200);
    const active = await getActiveSession(
      new Request(`${origin}/api/auth/v1/session`, {
        headers: { cookie: signedIn.sessionCookie },
      }),
      authEnv,
    );
    expect(active).not.toBeNull();
    await expect(
      active?.stub.accountMergeProofContext(),
    ).resolves.toMatchObject({
      authenticationMethod: "passkey",
      providerSubjectBindingHash: "9".repeat(64),
    });
  });
});
