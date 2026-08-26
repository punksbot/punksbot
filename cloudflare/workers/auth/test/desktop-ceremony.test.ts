import { describe, expect, it, vi } from "vitest";
import { exports as workerExports } from "cloudflare:workers";

import { bytesToBase64Url } from "../src/crypto";
import { route } from "../src/router";
import { aggregateName } from "../src/session";
import {
  authEnv,
  cancel,
  claim,
  completeOAuth,
  confirm,
  finishOAuth,
  launchOAuth,
  nativeHeaders,
  oauthCookie,
  origin,
  providerFixture,
  provisionIdentity,
  readyGoogle,
  reauthenticateFor,
  sessionCookie,
  startDesktop,
  status,
} from "./desktop-ceremony-helpers";

describe("DesktopAuthFlow protocol (issue #54)", () => {
  it("consomme une réauthentification de transfert seulement pour sa Session et sa commande", async () => {
    const subject = `desktop-transfer-${crypto.randomUUID()}`;
    const current = await provisionIdentity(subject);
    const workspaceOwnershipTransfer = {
      workspaceId: crypto.randomUUID(),
      targetPunkId: crypto.randomUUID(),
      expectedRevision: 7,
    };
    const missingBinding = await startDesktop({
      intent: "reauthenticate",
      method: "google",
      purpose: "transfer_workspace_ownership",
      session: current.cookie,
    });
    expect(missingBinding.response.status).toBe(400);
    const reauth = await reauthenticateFor(
      subject,
      current.cookie,
      "transfer_workspace_ownership",
      workspaceOwnershipTransfer,
    );
    const session = await workerExports.PunkSessionService.resolveSessionCookie(
      current.cookie,
    );
    if (session === null) throw new TypeError("Desktop Session is absent");
    const factory =
      workerExports.WorkspaceOwnershipAuthorizationService as (options: {
        props: unknown;
      }) => { consume(input: unknown): Promise<boolean> };
    const authority = factory({
      props: {
        role: "punks-workspace-ownership-authorizer",
        environment: "local",
      },
    });
    const commandId = crypto.randomUUID();
    const input = {
      authorizationId: reauth.authorizationId,
      commandId,
      punkId: session.punkId,
      sessionId: session.sessionId,
      ...workspaceOwnershipTransfer,
    };

    await expect(authority.consume(input)).resolves.toBe(false);
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    await expect(
      authority.consume({ ...input, targetPunkId: crypto.randomUUID() }),
    ).resolves.toBe(false);
    await expect(
      authority.consume({ ...input, workspaceId: crypto.randomUUID() }),
    ).resolves.toBe(false);
    await expect(
      authority.consume({ ...input, expectedRevision: 8 }),
    ).resolves.toBe(false);
    await expect(authority.consume(input)).resolves.toBe(true);
    await expect(authority.consume(input)).resolves.toBe(true);
    await expect(
      authority.consume({ ...input, commandId: crypto.randomUUID() }),
    ).resolves.toBe(false);
    await expect(
      authority.consume({ ...input, punkId: crypto.randomUUID() }),
    ).resolves.toBe(false);
  });

  it("demande confirmation avant de continuer avec la Session web", async () => {
    const web = await provisionIdentity(`desktop-web-${crypto.randomUUID()}`);
    const { started } = await startDesktop();
    if (started === null) throw new Error("desktop start absent");
    const page = await route(
      new Request(started.browserUrl, { headers: { cookie: web.cookie } }),
      authEnv,
    );
    expect(page.status).toBe(200);
    const html = await page.clone().text();
    expect(html).toContain("Continuer comme");
    expect(html).toContain("Utiliser Google à la place");
    const form = new FormData();
    form.set("flow", started.flowId);
    const continued = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/session/confirm`, {
        method: "POST",
        headers: { origin, cookie: `${web.cookie}; ${oauthCookie(page)}` },
        body: form,
      }),
      authEnv,
    );
    expect(continued.status).toBe(303);
    const delivered = await claim(started);
    const body = (await delivered.json()) as { deliveryId: string };
    expect((await confirm(started, body.deliveryId)).status).toBe(200);
  });

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

  it("reprend le callback desktop lié au state quand le cookie SameSite manque", async () => {
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
    expect(withoutBinding.status).toBe(303);
    const delivered = await claim(started);
    expect(delivered.status).toBe(200);
    const delivery = (await delivered.json()) as { deliveryId: string };
    expect((await confirm(started, delivery.deliveryId)).status).toBe(200);
    const proofStub = authEnv.DESKTOP_AUTH_FLOWS.getByName(started.flowId);
    const metadata = await proofStub.browserMetadata();
    expect({
      phase: metadata?.phase,
      result: metadata?.result,
      hasPunk: metadata !== null && metadata.punkId !== null,
      hasSession: metadata !== null && metadata.sessionId !== null,
      hasBrowserCompleted:
        metadata !== null && metadata.browserCompletedAt !== null,
      hasConfirmed: metadata !== null && metadata.confirmedAt !== null,
      hasBrowserBinding:
        metadata !== null && metadata.browserBindingHash !== null,
      hasOauthState: metadata !== null && metadata.oauthState !== null,
      hasProviderPkce: metadata !== null && metadata.codeVerifier !== null,
    }).toEqual({
      phase: "confirmed",
      result: "success",
      hasPunk: true,
      hasSession: true,
      hasBrowserCompleted: true,
      hasConfirmed: true,
      hasBrowserBinding: true,
      hasOauthState: true,
      hasProviderPkce: true,
    });
    expect(await proofStub.promotionProof()).toBeNull();
    const callbackUrl = `${origin}/api/auth/v1/oauth/google/callback?state=${launched.state}&code=x`;
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

  it("lie la preuve promotion terminale au SHA et au déploiement dès create", async () => {
    const flowId = crypto.randomUUID();
    const sourceSha = "ab".repeat(20);
    const stagingDeploymentId = `sha256:${"cd".repeat(32)}`;
    const commitment = "e".repeat(43);
    const punkId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const stub = authEnv.DESKTOP_AUTH_FLOWS.getByName(flowId);
    expect(
      await stub.create({
        flowId,
        intent: "sign_in",
        method: "github",
        purpose: null,
        workspaceOwnershipTransfer: null,
        verifierCommitment: commitment,
        environment: "staging",
        currentSessionId: null,
        currentPunkId: null,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        promotionSourceSha: sourceSha,
        promotionStagingDeploymentId: stagingDeploymentId,
      }),
    ).toBe(true);
    expect((await stub.browserLaunch()).ok).toBe(true);
    expect(await stub.ready({ punkId, outcomeCode: "authenticated" })).toBe(
      true,
    );
    const delivery = await stub.claim(commitment);
    if (!delivery.ok || delivery.kind !== "session") {
      throw new Error("promotion delivery missing");
    }
    expect(
      await stub.recordPreparedSession({
        deliveryId: delivery.deliveryId,
        sessionId,
      }),
    ).toBe(true);
    expect(
      await stub.confirmed({ deliveryId: delivery.deliveryId, sessionId }),
    ).not.toBeNull();
    await expect(stub.promotionProof()).resolves.toMatchObject({
      flowId,
      sourceSha,
      stagingDeploymentId,
      sessionId,
      punkId,
      method: "github",
    });
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
    expect((await cancel(started)).status).toBe(200);
    expect((await cancel(started)).status).toBe(200);
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
    const launched = await launchOAuth(started);
    const completed = await finishOAuth(launched, subject);
    expect(completed.status).toBe(200);
    const page = await completed.text();
    expect(page).toContain("Créer mon Compte Punks");
    expect(page).toContain(`name="state" value="${launched.state}"`);
    const capability = page.match(
      /name="capability" value="([A-Za-z0-9_-]{43})"/,
    )?.[1];
    expect(capability).toBeTypeOf("string");
    if (capability === undefined) throw new Error("capability absente");
    expect(await (await status(started)).json()).toMatchObject({
      phase: "browser_complete",
      result: "human_action_required",
    });

    const reopened = await route(
      new Request(started.browserUrl, {
        headers: { cookie: launched.cookie },
      }),
      authEnv,
    );
    expect(reopened.status).toBe(200);
    expect(await reopened.text()).toContain(
      `name="state" value="${launched.state}"`,
    );

    const resumed = await route(
      new Request(
        `${origin}/api/auth/v1/desktop/browser/oauth/resume?flow=${started.flowId}`,
        { headers: { cookie: launched.cookie } },
      ),
      authEnv,
    );
    expect(resumed.status).toBe(200);
    expect(await resumed.text()).toContain(
      `name="state" value="${launched.state}"`,
    );
    expect(
      (
        await route(
          new Request(
            `${origin}/api/auth/v1/desktop/browser/oauth/resume?flow=${started.flowId}`,
          ),
          authEnv,
        )
      ).status,
    ).toBe(400);

    const forged = new FormData();
    forged.set("flow", started.flowId);
    forged.set("state", "A".repeat(43));
    forged.set("capability", capability);
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/desktop/browser/oauth/confirm`, {
            method: "POST",
            headers: {
              origin: "https://github.com",
            },
            body: forged,
          }),
          authEnv,
        )
      ).status,
    ).toBe(403);

    const forgedCapability = new FormData();
    forgedCapability.set("flow", started.flowId);
    forgedCapability.set("state", launched.state);
    forgedCapability.set("capability", "A".repeat(43));
    expect(
      (
        await route(
          new Request(`${origin}/api/auth/v1/desktop/browser/oauth/confirm`, {
            method: "POST",
            headers: { origin: "https://github.com" },
            body: forgedCapability,
          }),
          authEnv,
        )
      ).status,
    ).toBe(403);

    const form = new FormData();
    form.set("flow", started.flowId);
    form.set("state", launched.state);
    form.set("capability", capability);
    const confirmed = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/oauth/confirm`, {
        method: "POST",
        headers: {
          origin: "https://github.com",
        },
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
    if (accepted.started === null) throw new Error("link flow absent");
    const launched = await launchOAuth(accepted.started);
    expect((await cancel(accepted.started)).status).toBe(200);
    expect((await finishOAuth(launched, `${subject}-late`)).status).toBe(400);
    expect(
      await authEnv.IDENTITY_CLAIMS.getByName(
        await aggregateName("identity", `google:${subject}-late`),
      ).resolve(),
    ).toEqual({ status: "missing" });
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

  it("ne lie le nouveau Moyen qu'au confirm natif avec rotation", async () => {
    const ownerSubject = `desktop-link-owner-${crypto.randomUUID()}`;
    const linkedSubject = `desktop-link-target-${crypto.randomUUID()}`;
    const current = await provisionIdentity(ownerSubject);
    const reauth = await reauthenticateFor(
      ownerSubject,
      current.cookie,
      "link_google",
    );
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    const { started } = await startDesktop({
      intent: "link_google",
      method: "google",
      session: current.cookie,
      authorizationId: reauth.authorizationId,
    });
    if (started === null) throw new Error("link flow absent");
    expect((await completeOAuth(started, linkedSubject)).response.status).toBe(
      303,
    );
    const identity = authEnv.IDENTITY_CLAIMS.getByName(
      await aggregateName("identity", `google:${linkedSubject}`),
    );
    expect(await identity.resolve()).toEqual({ status: "missing" });
    const delivered = await claim(started);
    const body = (await delivered.json()) as { deliveryId: string };
    expect((await confirm(started, body.deliveryId)).status).toBe(200);
    expect(await (await status(started)).json()).toMatchObject({
      phase: "confirmed",
      outcomeCode: "linked",
    });
    expect(await identity.resolve()).toMatchObject({
      status: "active",
      punkId: current.punkId,
    });
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
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON: bytesToBase64Url(clientData),
      authenticatorData: bytesToBase64Url(authenticatorData),
      signature: bytesToBase64Url(signature),
    },
  };
}

async function passkeyRegistration(challenge: string) {
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
  const credentialIdBytes = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = bytesToBase64Url(credentialIdBytes);
  const clientData = new TextEncoder().encode(
    JSON.stringify({
      type: "webauthn.create",
      challenge,
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
  const authData = concatBytes(
    rpIdHash,
    new Uint8Array([0x45, 0, 0, 0, 0]),
    new Uint8Array(16),
    new Uint8Array([0, credentialIdBytes.length]),
    credentialIdBytes,
    cose,
  );
  const attestationObject = concatBytes(
    new Uint8Array([
      0xa3,
      0x63,
      0x66,
      0x6d,
      0x74,
      0x64,
      0x6e,
      0x6f,
      0x6e,
      0x65,
      0x67,
      0x61,
      0x74,
      0x74,
      0x53,
      0x74,
      0x6d,
      0x74,
      0xa0,
      0x68,
      0x61,
      0x75,
      0x74,
      0x68,
      0x44,
      0x61,
      0x74,
      0x61,
      0x58,
      authData.length,
    ]),
    authData,
  );
  return {
    credentialId,
    privateKey: keys.privateKey,
    response: {
      id: credentialId,
      rawId: credentialId,
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: bytesToBase64Url(clientData),
        attestationObject: bytesToBase64Url(attestationObject),
        transports: ["internal"],
      },
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
    expect(await (await status(started)).json()).toMatchObject({
      phase: "ready",
    });
  });

  it("enregistre puis authentifie une passkey desktop seulement après confirm", async () => {
    const subject = `desktop-register-passkey-${crypto.randomUUID()}`;
    const current = await provisionIdentity(subject);
    const reauth = await reauthenticateFor(
      subject,
      current.cookie,
      "register_passkey",
    );
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    const { started } = await startDesktop({
      intent: "register_passkey",
      method: "passkey",
      session: current.cookie,
      authorizationId: reauth.authorizationId,
    });
    if (started === null) throw new Error("passkey registration flow absent");
    const launched = await route(new Request(started.browserUrl), authEnv);
    const page = await launched.clone().text();
    const payload = page.match(/const input=(\{.*?\});\n/)?.[1];
    if (payload === undefined) throw new Error("options passkey absentes");
    const challenge = (
      JSON.parse(payload) as { publicKey: { challenge: string } }
    ).publicKey.challenge;
    const registration = await passkeyRegistration(challenge);
    const completed = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/passkey/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: oauthCookie(launched),
        },
        body: JSON.stringify({
          flowId: started.flowId,
          response: registration.response,
        }),
      }),
      authEnv,
    );
    expect(completed.status, await completed.clone().text()).toBe(200);
    const credential = authEnv.PASSKEY_CREDENTIALS.getByName(
      await aggregateName("passkey-credential", registration.credentialId),
    );
    expect(
      await credential.verifyAuthentication({
        ceremonyId: crypto.randomUUID(),
        challenge: "pending-registration-check",
        origin,
        rpId: "auth.punks.test",
        response: await passkeyAssertion({
          ...registration,
          challenge: "pending-registration-check",
        }),
      }),
    ).toEqual({ ok: false, code: "pending" });

    const delivered = await claim(started);
    const delivery = (await delivered.json()) as { deliveryId: string };
    expect((await confirm(started, delivery.deliveryId)).status).toBe(200);
    expect(await (await status(started)).json()).toMatchObject({
      phase: "confirmed",
      outcomeCode: "passkey_registered",
    });

    const signedIn = await startDesktop({ method: "passkey" });
    if (signedIn.started === null)
      throw new Error("passkey sign-in flow absent");
    const signInPage = await route(
      new Request(signedIn.started.browserUrl),
      authEnv,
    );
    const signInPayload = (await signInPage.text()).match(
      /const input=(\{.*?\});\n/,
    )?.[1];
    if (signInPayload === undefined)
      throw new Error("options passkey absentes");
    const signInChallenge = (
      JSON.parse(signInPayload) as { publicKey: { challenge: string } }
    ).publicKey.challenge;
    const authenticated = await route(
      new Request(`${origin}/api/auth/v1/desktop/browser/passkey/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          cookie: oauthCookie(signInPage),
        },
        body: JSON.stringify({
          flowId: signedIn.started.flowId,
          response: await passkeyAssertion({
            ...registration,
            challenge: signInChallenge,
          }),
        }),
      }),
      authEnv,
    );
    expect(authenticated.status, await authenticated.clone().text()).toBe(200);
    const signedInDelivery = await claim(signedIn.started);
    const signedInBody = (await signedInDelivery.json()) as {
      deliveryId: string;
    };
    expect(
      (await confirm(signedIn.started, signedInBody.deliveryId)).status,
    ).toBe(200);
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
