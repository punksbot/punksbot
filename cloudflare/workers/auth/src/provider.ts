import type { AuthProviderProfile } from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import type { AuthEnv, AuthProvider } from "./env";

export type ProviderFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const githubScopes = ["read:user", "user:email"] as const;

export function callbackUrl(env: AuthEnv, provider: AuthProvider): string {
  return `${env.AUTH_BASE_URL}/api/auth/v1/oauth/${provider}/callback`;
}

export function authorizationUrl(
  env: AuthEnv,
  provider: AuthProvider,
  options: { state: string; challenge: string },
): string {
  const google = provider === "google";
  const url = new URL(
    google
      ? env.GOOGLE_AUTHORIZATION_ENDPOINT
      : env.GITHUB_AUTHORIZATION_ENDPOINT,
  );
  url.searchParams.set(
    "client_id",
    google ? env.GOOGLE_OAUTH_CLIENT_ID : env.GITHUB_OAUTH_CLIENT_ID,
  );
  url.searchParams.set("redirect_uri", callbackUrl(env, provider));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set(
    "scope",
    google ? "openid email profile" : githubScopes.join(" "),
  );
  if (google) {
    url.searchParams.set("prompt", "select_account");
  } else {
    url.searchParams.set("allow_signup", "true");
    url.searchParams.set("prompt", "select_account");
  }
  return url.toString();
}

async function responseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  if (!response.ok) {
    throw new Error(`Provider responded with HTTP ${response.status}`);
  }
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Provider response is not an object");
  }
  return value as Record<string, unknown>;
}

function bearer(value: unknown): string {
  if (typeof value !== "string" || value.length < 16 || value.length > 4096) {
    throw new Error("Provider did not return a usable access token");
  }
  return value;
}

async function googleProfile(
  env: AuthEnv,
  code: string,
  verifier: string,
  providerFetch: ProviderFetch,
): Promise<AuthProviderProfile> {
  const body = new URLSearchParams({
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: callbackUrl(env, "google"),
  });
  const token = await responseJson(
    await providerFetch(env.GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  const profile = await responseJson(
    await providerFetch(env.GOOGLE_USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${bearer(token.access_token)}` },
      signal: AbortSignal.timeout(10_000),
    }),
  );
  if (
    typeof profile.sub !== "string" ||
    typeof profile.email !== "string" ||
    profile.email_verified !== true
  ) {
    throw new Error("Google identity has no verified email");
  }
  const result: AuthProviderProfile = {
    provider: "google",
    subject: profile.sub,
    verifiedEmail: profile.email.toLowerCase(),
    displayName:
      typeof profile.name === "string" && profile.name.length > 0
        ? profile.name.slice(0, 80)
        : profile.email.slice(0, 80),
    avatarUrl: typeof profile.picture === "string" ? profile.picture : null,
    username: null,
  };
  return validProfile(result);
}

function githubScope(value: unknown): void {
  if (typeof value !== "string") {
    throw new Error("GitHub did not return granted scopes");
  }
  const actual = new Set(value.split(/[ ,]+/).filter(Boolean));
  const allowed = new Set<string>(githubScopes);
  if (
    githubScopes.some((scope) => !actual.has(scope)) ||
    [...actual].some((scope) => !allowed.has(scope))
  ) {
    throw new Error("GitHub granted an unexpected OAuth scope");
  }
}

async function githubProfile(
  env: AuthEnv,
  code: string,
  verifier: string,
  providerFetch: ProviderFetch,
): Promise<AuthProviderProfile> {
  const token = await responseJson(
    await providerFetch(env.GITHUB_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        redirect_uri: callbackUrl(env, "github"),
      }),
      signal: AbortSignal.timeout(10_000),
    }),
  );
  githubScope(token.scope);
  const accessToken = bearer(token.access_token);
  const headers = {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${accessToken}`,
    "user-agent": "Punks-Bot-Auth",
    "x-github-api-version": "2022-11-28",
  };
  const user = await responseJson(
    await providerFetch(`${env.GITHUB_API_BASE_URL}/user`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }),
  );
  const emailsResponse = await providerFetch(
    `${env.GITHUB_API_BASE_URL}/user/emails`,
    { headers, signal: AbortSignal.timeout(10_000) },
  );
  if (!emailsResponse.ok) {
    throw new Error(
      `GitHub emails responded with HTTP ${emailsResponse.status}`,
    );
  }
  const emails: unknown = await emailsResponse.json();
  if (!Array.isArray(emails)) {
    throw new Error("GitHub emails response is not an array");
  }
  const verified =
    emails.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        Reflect.get(entry, "verified") === true &&
        Reflect.get(entry, "primary") === true &&
        typeof Reflect.get(entry, "email") === "string",
    ) ??
    emails.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        Reflect.get(entry, "verified") === true &&
        typeof Reflect.get(entry, "email") === "string",
    );
  if (
    typeof user.id !== "number" ||
    !Number.isSafeInteger(user.id) ||
    typeof user.login !== "string" ||
    verified === undefined
  ) {
    throw new Error("GitHub identity has no verified email");
  }
  const email = String(Reflect.get(verified, "email")).toLowerCase();
  const result: AuthProviderProfile = {
    provider: "github",
    subject: String(user.id),
    verifiedEmail: email,
    displayName:
      typeof user.name === "string" && user.name.length > 0
        ? user.name.slice(0, 80)
        : user.login.slice(0, 80),
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
    username: user.login,
  };
  return validProfile(result);
}

function validProfile(profile: AuthProviderProfile): AuthProviderProfile {
  if (
    !validateContract("punks://contracts/auth.provider-profile@1", profile)
      .valid
  ) {
    throw new Error("Provider profile violated its canonical contract");
  }
  return profile;
}

export function exchangeProfile(
  env: AuthEnv,
  provider: AuthProvider,
  code: string,
  verifier: string,
  providerFetch: ProviderFetch = fetch,
): Promise<AuthProviderProfile> {
  return provider === "google"
    ? googleProfile(env, code, verifier, providerFetch)
    : githubProfile(env, code, verifier, providerFetch);
}
