import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { AuthEnv } from "../src/env";
import type { ProviderFetch } from "../src/provider";
import { bytesToBase64Url, pkceChallenge } from "../src/crypto";
import { route } from "../src/router";
import { aggregateName } from "../src/session";

const authEnv = env as AuthEnv;
const origin = "https://auth.punks.test";
const nativeHeaders = {
  origin,
  "sec-punks-desktop-environment": authEnv.ENVIRONMENT,
} as const;

function cookie(response: Response, pattern: RegExp): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(pattern);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Cookie absent: ${value}`);
  }
  return `${match[1]}=${match[2]}`;
}

function oauthCookie(response: Response): string {
  return cookie(response, /(__Host-punks_oauth_[A-Za-z0-9_-]+)=([^;,]+)/);
}

function sessionCookie(response: Response): string {
  return cookie(response, /((?:__Host-)?punks_session(?:_dev)?)=([^;,]+)/);
}

function providerFixture(subject: string): ProviderFetch {
  return async (input, init) => {
    const url = String(input);
    if (url.includes("/token") || url.includes("access_token")) {
      expect(String(init?.body)).toContain("code_verifier=");
      return Response.json({
        access_token: `provider-token-${subject}`,
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

async function provisionIdentity(subject: string): Promise<{
  punkId: string;
  cookie: string;
}> {
  const started = await route(
    new Request(`${origin}/api/auth/v1/start`, {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        contract: "auth.start@1",
        provider: "google",
        intent: "sign_in",
        returnTo: "/",
      }),
    }),
    authEnv,
  );
  expect(started.status).toBe(201);
  const authorizationUrl = new URL(
    ((await started.clone().json()) as { authorizationUrl: string })
      .authorizationUrl,
  );
  const response = await route(
    new Request(
      `${origin}/api/auth/v1/oauth/google/callback?state=${encodeURIComponent(
        authorizationUrl.searchParams.get("state") ?? "",
      )}&code=fixture`,
      { headers: { cookie: oauthCookie(started) } },
    ),
    authEnv,
    providerFixture(subject),
  );
  expect(response.status).toBe(303);
  const activeCookie = sessionCookie(response);
  const session = await route(
    new Request(`${origin}/api/auth/v1/session`, {
      headers: { cookie: activeCookie },
    }),
    authEnv,
  );
  const sessionBody = (await session.json()) as {
    session: { punkId: string };
  };
  return { punkId: sessionBody.session.punkId, cookie: activeCookie };
}

interface StartedDesktop {
  flowId: string;
  browserUrl: string;
  verifier: string;
  commitment: string;
}

async function startDesktop(
  input: {
    verifier?: string;
    intent?:
      | "sign_in"
      | "switch_account"
      | "reauthenticate"
      | "link_google"
      | "link_github"
      | "register_passkey";
    method?: "google" | "github" | "passkey";
    session?: string;
    originHeader?: string | null;
    purpose?: "link_google" | "link_github" | "register_passkey";
    authorizationId?: string;
    nativeHeader?: boolean;
  } = {},
): Promise<{ response: Response; started: StartedDesktop | null }> {
  const verifier =
    input.verifier ??
    bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const commitment = await pkceChallenge(verifier);
  const response = await route(
    new Request(`${origin}/api/auth/v1/desktop/start`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(input.nativeHeader === false
          ? {}
          : { "sec-punks-desktop-environment": authEnv.ENVIRONMENT }),
        ...(input.originHeader === null
          ? {}
          : { origin: input.originHeader ?? origin }),
        ...(input.session === undefined ? {} : { cookie: input.session }),
      },
      body: JSON.stringify({
        contract: "desktop-auth.start@1",
        message: "request",
        intent: input.intent ?? "sign_in",
        method: input.method ?? "google",
        verifierCommitment: commitment,
        ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
        ...(input.authorizationId === undefined
          ? {}
          : { authorizationId: input.authorizationId }),
      }),
    }),
    authEnv,
  );
  if (response.status !== 201) return { response, started: null };
  const body = (await response.clone().json()) as {
    flowId: string;
    browserUrl: string;
  };
  return {
    response,
    started: { ...body, verifier, commitment },
  };
}

async function launchOAuth(started: StartedDesktop): Promise<{
  state: string;
  cookie: string;
  response: Response;
}> {
  const response = await route(new Request(started.browserUrl), authEnv);
  expect(response.status).toBe(303);
  const location = new URL(response.headers.get("location") ?? "");
  return {
    state: location.searchParams.get("state") ?? "",
    cookie: oauthCookie(response),
    response,
  };
}

async function completeOAuth(
  started: StartedDesktop,
  subject: string,
): Promise<{ response: Response; browserCookie: string }> {
  const launched = await launchOAuth(started);
  const response = await route(
    new Request(
      `${origin}/api/auth/v1/oauth/google/callback?state=${encodeURIComponent(
        launched.state,
      )}&code=fixture`,
      { headers: { cookie: launched.cookie } },
    ),
    authEnv,
    providerFixture(subject),
  );
  return { response, browserCookie: launched.cookie };
}

async function status(
  started: StartedDesktop,
  commitment = started.commitment,
) {
  return route(
    new Request(`${origin}/api/auth/v1/desktop/status`, {
      method: "POST",
      headers: { "content-type": "application/json", ...nativeHeaders },
      body: JSON.stringify({
        contract: "desktop-auth.status@1",
        message: "request",
        flowId: started.flowId,
        verifierCommitment: commitment,
      }),
    }),
    authEnv,
  );
}

async function claim(started: StartedDesktop, verifier = started.verifier) {
  return route(
    new Request(`${origin}/api/auth/v1/desktop/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", ...nativeHeaders },
      body: JSON.stringify({
        contract: "desktop-auth.claim@1",
        message: "request",
        deliveryKind: "request",
        flowId: started.flowId,
        verifier,
      }),
    }),
    authEnv,
  );
}

async function confirm(
  started: StartedDesktop,
  deliveryId: string,
  verifier = started.verifier,
) {
  return route(
    new Request(`${origin}/api/auth/v1/desktop/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json", ...nativeHeaders },
      body: JSON.stringify({
        contract: "desktop-auth.confirm@1",
        message: "request",
        flowId: started.flowId,
        verifier,
        deliveryId,
      }),
    }),
    authEnv,
  );
}

async function readyGoogle(subject: string): Promise<StartedDesktop> {
  await provisionIdentity(subject);
  const { response, started } = await startDesktop();
  expect(response.status).toBe(201);
  if (started === null) throw new Error("desktop start absent");
  const completed = await completeOAuth(started, subject);
  expect(completed.response.status).toBe(303);
  expect(completed.response.headers.get("location")).toBe(
    `punks-local://auth/complete?flow=${started.flowId}`,
  );
  expect(completed.response.headers.get("set-cookie") ?? "").not.toContain(
    "punks_session",
  );
  return started;
}

async function reauthenticateFor(
  subject: string,
  session: string,
  purpose: "link_google" | "link_github" | "register_passkey",
): Promise<{
  started: StartedDesktop;
  deliveryId: string;
  authorizationId: string;
}> {
  const { started } = await startDesktop({
    intent: "reauthenticate",
    method: "google",
    purpose,
    session,
  });
  if (started === null) throw new Error("reauth start absent");
  expect((await completeOAuth(started, subject)).response.status).toBe(303);
  const delivered = await claim(started);
  expect(delivered.status).toBe(200);
  const body = (await delivered.json()) as {
    deliveryId: string;
    authorization: { authorizationId: string };
  };
  return {
    started,
    deliveryId: body.deliveryId,
    authorizationId: body.authorization.authorizationId,
  };
}

describe("DesktopAuthFlow protocol (issue #54)", () => {
  it("ferme origin, commitment et intentions liées à la Session courante", async () => {
    expect((await startDesktop({ originHeader: null })).response.status).toBe(
      403,
    );
    expect(
      (await startDesktop({ originHeader: "https://evil.example" })).response
        .status,
    ).toBe(403);
    expect((await startDesktop({ nativeHeader: false })).response.status).toBe(
      403,
    );
    const current = await provisionIdentity(
      `desktop-rules-${crypto.randomUUID()}`,
    );
    expect(
      (await startDesktop({ session: current.cookie })).response.status,
    ).toBe(409);
    expect(
      (await startDesktop({ intent: "switch_account" })).response.status,
    ).toBe(401);
    expect(
      (
        await startDesktop({
          intent: "switch_account",
          session: current.cookie,
        })
      ).response.status,
    ).toBe(201);
  });

  it("pose le browser-binding dans le navigateur et consomme state une seule fois", async () => {
    const subject = `desktop-state-${crypto.randomUUID()}`;
    await provisionIdentity(subject);
    const { started } = await startDesktop();
    if (started === null) throw new Error("desktop start absent");
    const launched = await launchOAuth(started);
    expect(launched.cookie).toContain("__Host-punks_oauth_");
    const withoutBinding = await route(
      new Request(
        `${origin}/api/auth/v1/oauth/google/callback?state=${launched.state}&code=x`,
      ),
      authEnv,
      providerFixture(subject),
    );
    expect(withoutBinding.status).toBe(400);
    const callbackUrl = `${origin}/api/auth/v1/oauth/google/callback?state=${launched.state}&code=x`;
    expect(
      (
        await route(
          new Request(callbackUrl, { headers: { cookie: launched.cookie } }),
          authEnv,
          providerFixture(subject),
        )
      ).status,
    ).toBe(303);
    expect(
      (
        await route(
          new Request(callbackUrl, { headers: { cookie: launched.cookie } }),
          authEnv,
          providerFixture(subject),
        )
      ).status,
    ).toBe(400);
  });

  it("rejoue claim/confirm, garde la Session prepared fermée puis révoque par capacité seule", async () => {
    const started = await readyGoogle(
      `desktop-delivery-${crypto.randomUUID()}`,
    );
    expect((await status(started, "Z".repeat(43))).status).toBe(404);
    const ready = await status(started);
    expect(await ready.json()).toMatchObject({
      phase: "ready",
      terminal: false,
    });
    expect((await claim(started, "Y".repeat(43))).status).toBe(403);

    const first = await claim(started);
    expect(first.status).toBe(200);
    const firstBody = (await first.clone().json()) as {
      deliveryId: string;
      session: { sessionId: string };
      revokeCapability: { token: string };
    };
    const preparedCookie = sessionCookie(first);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: preparedCookie, ...nativeHeaders },
          }),
          authEnv,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/passkeys/register/options`, {
            method: "POST",
            headers: { cookie: preparedCookie, origin },
          }),
          authEnv,
        )
      ).status,
    ).toBe(401);

    const replay = await claim(started);
    expect(await replay.clone().json()).toEqual(firstBody);
    expect(sessionCookie(replay)).toBe(preparedCookie);

    const confirmed = await confirm(started, firstBody.deliveryId);
    expect(confirmed.status).toBe(200);
    const confirmedBody = await confirmed.clone().json();
    expect(await (await confirm(started, firstBody.deliveryId)).json()).toEqual(
      confirmedBody,
    );
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: preparedCookie },
          }),
          authEnv,
        )
      ).status,
    ).toBe(200);

    const revoke = () =>
      route(
        new Request(`${origin}/api/auth/v1/desktop/session/revoke`, {
          method: "POST",
          headers: { "content-type": "application/json", ...nativeHeaders },
          body: JSON.stringify({
            contract: "desktop-session.revoke@1",
            message: "request",
            capability: firstBody.revokeCapability.token,
          }),
        }),
        authEnv,
      );
    expect(await (await revoke()).json()).toMatchObject({ revoked: true });
    expect(await (await revoke()).json()).toMatchObject({ revoked: true });
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: preparedCookie },
          }),
          authEnv,
        )
      ).status,
    ).toBe(401);
  });

  it("cancel est idempotent et détruit toute Session préparée", async () => {
    const started = await readyGoogle(`desktop-cancel-${crypto.randomUUID()}`);
    const delivered = await claim(started);
    const delivery = (await delivered.clone().json()) as {
      deliveryId: string;
    };
    const preparedCookie = sessionCookie(delivered);
    const cancel = () =>
      route(
        new Request(`${origin}/api/auth/v1/desktop/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json", ...nativeHeaders },
          body: JSON.stringify({
            contract: "desktop-auth.cancel@1",
            message: "request",
            flowId: started.flowId,
            verifier: started.verifier,
          }),
        }),
        authEnv,
      );
    expect((await cancel()).status).toBe(200);
    expect((await cancel()).status).toBe(200);
    expect((await confirm(started, delivery.deliveryId)).status).toBe(409);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: preparedCookie, ...nativeHeaders },
          }),
          authEnv,
        )
      ).status,
    ).toBe(401);
  });

  it("exige une confirmation navigateur explicite avant un nouveau Compte OAuth", async () => {
    const subject = `desktop-create-${crypto.randomUUID()}`;
    const { started } = await startDesktop();
    if (started === null) throw new Error("desktop start absent");
    const completed = await completeOAuth(started, subject);
    expect(completed.response.status).toBe(200);
    expect(await completed.response.text()).toContain("Créer mon Compte Punks");
    expect(await (await status(started)).json()).toMatchObject({
      phase: "browser_complete",
      result: "human_action_required",
    });
    const form = new FormData();
    form.set("flow", started.flowId);
    const confirmed = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/oauth/confirm`, {
        method: "POST",
        headers: { origin, cookie: completed.browserCookie },
        body: form,
      }),
      authEnv,
    );
    expect(confirmed.status).toBe(303);
    expect(confirmed.headers.get("location")).toBe(
      `punks-local://auth/complete?flow=${started.flowId}`,
    );
    expect(await (await status(started)).json()).toMatchObject({
      phase: "ready",
    });
  });

  it("scelle au confirm un grant 5 min ciblé, refuse cross-purpose et rejeu", async () => {
    const subject = `desktop-reauth-${crypto.randomUUID()}`;
    const current = await provisionIdentity(subject);
    const reauth = await reauthenticateFor(
      subject,
      current.cookie,
      "link_google",
    );

    const beforeConfirm = await startDesktop({
      intent: "link_google",
      method: "google",
      session: current.cookie,
      authorizationId: reauth.authorizationId,
    });
    expect(beforeConfirm.response.status).toBe(409);
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);

    const wrongPurpose = await startDesktop({
      intent: "register_passkey",
      method: "passkey",
      session: current.cookie,
      authorizationId: reauth.authorizationId,
    });
    expect(wrongPurpose.response.status).toBe(403);

    const other = await provisionIdentity(
      `desktop-reauth-other-${crypto.randomUUID()}`,
    );
    const wrongSession = await startDesktop({
      intent: "link_google",
      method: "google",
      session: other.cookie,
      authorizationId: reauth.authorizationId,
    });
    expect(wrongSession.response.status).toBe(403);

    const accepted = await startDesktop({
      intent: "link_google",
      method: "google",
      session: current.cookie,
      authorizationId: reauth.authorizationId,
    });
    expect(accepted.response.status).toBe(201);
    const replayedElsewhere = await startDesktop({
      intent: "link_google",
      method: "google",
      session: current.cookie,
      authorizationId: reauth.authorizationId,
    });
    expect(replayedElsewhere.response.status).toBe(409);
  });

  it("expire le grant de réauthentification après cinq minutes", async () => {
    const subject = `desktop-reauth-expiry-${crypto.randomUUID()}`;
    const current = await provisionIdentity(subject);
    const reauth = await reauthenticateFor(
      subject,
      current.cookie,
      "link_google",
    );
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(6 * 60_000);
      const expired = await startDesktop({
        intent: "link_google",
        method: "google",
        session: current.cookie,
        authorizationId: reauth.authorizationId,
      });
      expect(expired.response.status).toBe(409);
    } finally {
      vi.useRealTimers();
    }
  });

  it("expire publiquement le flow et refuse toute réclamation tardive", async () => {
    vi.useFakeTimers();
    try {
      const { started } = await startDesktop();
      if (started === null) throw new Error("desktop start absent");
      vi.advanceTimersByTime(11 * 60_000);
      expect(await (await status(started)).json()).toMatchObject({
        phase: "expired",
        terminal: true,
      });
      expect((await claim(started)).status).toBe(409);
    } finally {
      vi.useRealTimers();
    }
  });
});

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
  const decode = (value: string) =>
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
      char.charCodeAt(0),
    );
  const cose = concatBytes(
    new Uint8Array([
      0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20,
    ]),
    decode(jwk.x ?? ""),
    new Uint8Array([0x22, 0x58, 0x20]),
    decode(jwk.y ?? ""),
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
      publicKey: bytesToBase64Url(cose),
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
    new Uint8Array([0x05, 0, 0, 0, 1]),
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
    type: "public-key",
    clientExtensionResults: {},
    response: {
      clientDataJSON: bytesToBase64Url(clientData),
      authenticatorData: bytesToBase64Url(authenticatorData),
      signature: bytesToBase64Url(signature),
      userHandle: null,
    },
  };
}

describe("Desktop passkey and confirmed rotation", () => {
  it("refuse une passkey inconnue sans créer de Compte", async () => {
    const { started } = await startDesktop({ method: "passkey" });
    if (started === null) throw new Error("desktop start absent");
    const launched = await route(new Request(started.browserUrl), authEnv);
    expect(launched.status).toBe(200);
    expect(await launched.clone().text()).toContain('<script type="module">');
    expect(launched.headers.get("x-content-type-options")).toBe("nosniff");
    expect(launched.headers.get("permissions-policy")).toContain(
      "publickey-credentials-get=(self)",
    );
    const response = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/passkey/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: oauthCookie(launched),
        },
        body: JSON.stringify({
          flowId: started.flowId,
          response: {
            id: "unknown-passkey",
            rawId: "unknown-passkey",
            type: "public-key",
            clientExtensionResults: {},
            response: {
              clientDataJSON: "AA",
              authenticatorData: "AA",
              signature: "AA",
              userHandle: null,
            },
          },
        }),
      }),
      authEnv,
    );
    expect(response.status).toBe(401);
    expect(await (await status(started)).json()).toMatchObject({
      phase: "cancelled",
      result: "security_failure",
    });
  });

  it("authentifie une passkey connue dans le navigateur système", async () => {
    const owner = await provisionIdentity(
      `desktop-passkey-${crypto.randomUUID()}`,
    );
    const fixture = await passkeyFixture(owner.punkId);
    const { started } = await startDesktop({ method: "passkey" });
    if (started === null) throw new Error("desktop start absent");
    const launched = await route(new Request(started.browserUrl), authEnv);
    const page = await launched.clone().text();
    const payload = page.match(/const input=(\{.*?\});\n/)?.[1];
    if (payload === undefined) throw new Error("options passkey absentes");
    const challenge = (
      JSON.parse(payload) as { publicKey: { challenge: string } }
    ).publicKey.challenge;
    const assertion = await passkeyAssertion({ ...fixture, challenge });
    const completed = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/passkey/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: oauthCookie(launched),
        },
        body: JSON.stringify({ flowId: started.flowId, response: assertion }),
      }),
      authEnv,
    );
    expect(completed.status, await completed.clone().text()).toBe(200);
    expect(await completed.json()).toEqual({
      completionUrl: `punks-local://auth/complete?flow=${started.flowId}`,
    });
    expect(await (await status(started)).json()).toMatchObject({
      phase: "ready",
    });
  });

  it("ne renouvelle pas à exactement sept jours, seulement en dessous", async () => {
    const owner = await provisionIdentity(
      `desktop-renew-boundary-${crypto.randomUUID()}`,
    );
    vi.useFakeTimers();
    try {
      const now = Date.now();
      const token = bytesToBase64Url(
        crypto.getRandomValues(new Uint8Array(32)),
      );
      const sessionId = await aggregateName("session", token);
      expect(
        await authEnv.SESSIONS.getByName(sessionId).create(
          {
            sessionId,
            punkId: owner.punkId,
            authenticatedAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 7 * 24 * 3_600_000).toISOString(),
            recentReauthUntil: null,
          },
          "desktop",
          "active",
        ),
      ).toBe(true);
      const exact = await route(
        new Request(`${origin}/api/auth/v1/desktop/session/renew`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...nativeHeaders,
            cookie: `punks_session_dev=${token}`,
          },
          body: JSON.stringify({
            contract: "desktop-session.renew@1",
            message: "request",
            action: "prepare",
            commandId: crypto.randomUUID(),
          }),
        }),
        authEnv,
      );
      expect(exact.status).toBe(409);
      expect(await exact.json()).toMatchObject({
        title: expect.stringContaining("not_due"),
      });

      vi.advanceTimersByTime(1);
      const below = await route(
        new Request(`${origin}/api/auth/v1/desktop/session/renew`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...nativeHeaders,
            cookie: `punks_session_dev=${token}`,
          },
          body: JSON.stringify({
            contract: "desktop-session.renew@1",
            message: "request",
            action: "prepare",
            commandId: crypto.randomUUID(),
          }),
        }),
        authEnv,
      );
      expect(below.status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });

  it("renouvelle par rotation préparée puis confirmée, jamais en place", async () => {
    const started = await readyGoogle(`desktop-renew-${crypto.randomUUID()}`);
    const delivered = await claim(started);
    const delivery = (await delivered.clone().json()) as {
      deliveryId: string;
    };
    const oldCookie = sessionCookie(delivered);
    expect((await confirm(started, delivery.deliveryId)).status).toBe(200);

    const commandId = crypto.randomUUID();
    const prepared = await route(
      new Request(`${origin}/api/auth/v1/desktop/session/renew`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...nativeHeaders,
          cookie: oldCookie,
        },
        body: JSON.stringify({
          contract: "desktop-session.renew@1",
          message: "request",
          action: "prepare",
          commandId,
        }),
      }),
      authEnv,
    );
    expect(prepared.status).toBe(200);
    const preparedBody = (await prepared.clone().json()) as {
      rotationId: string;
    };
    const newCookie = sessionCookie(prepared);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: newCookie, ...nativeHeaders },
          }),
          authEnv,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: oldCookie },
          }),
          authEnv,
        )
      ).status,
    ).toBe(200);
    const confirmed = await route(
      new Request(`${origin}/api/auth/v1/desktop/session/renew`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...nativeHeaders,
          cookie: newCookie,
        },
        body: JSON.stringify({
          contract: "desktop-session.renew@1",
          message: "request",
          action: "confirm",
          commandId,
          rotationId: preparedBody.rotationId,
        }),
      }),
      authEnv,
    );
    expect(confirmed.status).toBe(200);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: oldCookie },
          }),
          authEnv,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/session`, {
            headers: { cookie: newCookie },
          }),
          authEnv,
        )
      ).status,
    ).toBe(200);
  });
});
