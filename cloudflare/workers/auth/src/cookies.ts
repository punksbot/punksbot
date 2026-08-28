const SESSION_COOKIE = "__Host-punks_session";
const LOCAL_DEV_SESSION_COOKIE = "punks_session_dev";

export function parseCookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name.length > 0 && value.length > 0) {
      result.set(name, value);
    }
  }
  return result;
}

function secureCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function sessionCookie(value: string, maxAgeSeconds: number): string {
  return secureCookie(SESSION_COOKIE, value, maxAgeSeconds);
}

export function localDevSessionCookie(
  value: string,
  maxAgeSeconds: number,
): string {
  return `${LOCAL_DEV_SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax`;
}

export function clearSessionCookie(environment: string): string {
  return environment === "local"
    ? localDevSessionCookie("deleted", 0)
    : secureCookie(SESSION_COOKIE, "deleted", 0);
}

export function sessionToken(
  request: Request,
  env: { ENVIRONMENT: string },
): string | null {
  const cookies = parseCookies(request);
  return env.ENVIRONMENT === "local"
    ? (cookies.get(LOCAL_DEV_SESSION_COOKIE) ??
        cookies.get(SESSION_COOKIE) ??
        null)
    : (cookies.get(SESSION_COOKIE) ?? null);
}

export function oauthCookieName(state: string): string {
  return `__Host-punks_oauth_${state.slice(0, 16)}`;
}

export function oauthCookie(
  state: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return secureCookie(oauthCookieName(state), value, maxAgeSeconds);
}

export function clearOauthCookie(state: string): string {
  return secureCookie(oauthCookieName(state), "deleted", 0);
}
