import { env } from "cloudflare:test";
import { expect } from "vitest";

import type { AuthEnv } from "../src/env";
import type { ProviderFetch } from "../src/provider";
import { bytesToBase64Url, pkceChallenge } from "../src/crypto";
import { route } from "../src/router";

export const authEnv = env as AuthEnv;
export const origin = "https://auth.punks.test";
export const nativeHeaders = {
  origin,
  "sec-punks-desktop-environment": authEnv.ENVIRONMENT,
} as const;

export function cookie(response: Response, pattern: RegExp): string {
  const value = response.headers.get("set-cookie") ?? "";
  const match = value.match(pattern);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new Error(`Cookie absent: ${value}`);
  }
  return `${match[1]}=${match[2]}`;
}

export function oauthCookie(response: Response): string {
  return cookie(response, /(__Host-punks_oauth_[A-Za-z0-9_-]+)=([^;,]+)/);
}

export function sessionCookie(response: Response): string {
  return cookie(response, /((?:__Host-)?punks_session(?:_dev)?)=([^;,]+)/);
}

export function providerFixture(subject: string): ProviderFetch {
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

export async function provisionIdentity(subject: string): Promise<{
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

export interface StartedDesktop {
  flowId: string;
  browserUrl: string;
  verifier: string;
  commitment: string;
}

export async function startDesktop(
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
    purpose?:
      | "link_google"
      | "link_github"
      | "register_passkey"
      | "transfer_workspace_ownership";
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

export async function launchOAuth(started: StartedDesktop): Promise<{
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

export async function completeOAuth(
  started: StartedDesktop,
  subject: string,
): Promise<{ response: Response; browserCookie: string }> {
  const launched = await launchOAuth(started);
  const response = await finishOAuth(launched, subject);
  return { response, browserCookie: launched.cookie };
}

export async function finishOAuth(
  launched: { state: string; cookie: string },
  subject: string,
): Promise<Response> {
  return route(
    new Request(
      `${origin}/api/auth/v1/oauth/google/callback?state=${encodeURIComponent(
        launched.state,
      )}&code=fixture`,
      { headers: { cookie: launched.cookie } },
    ),
    authEnv,
    providerFixture(subject),
  );
}

export async function cancel(started: StartedDesktop): Promise<Response> {
  return route(
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
}

export async function status(
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

export async function claim(
  started: StartedDesktop,
  verifier = started.verifier,
) {
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

export async function confirm(
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

export async function readyGoogle(subject: string): Promise<StartedDesktop> {
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

export async function reauthenticateFor(
  subject: string,
  session: string,
  purpose:
    | "link_google"
    | "link_github"
    | "register_passkey"
    | "transfer_workspace_ownership",
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
