import {
  completeDesktopPasskey,
  confirmDesktopOAuthAccount,
  launchDesktopBrowser,
  startDesktopAuth,
} from "./desktop-auth";
import {
  cancelDesktopAuth,
  claimDesktopAuth,
  confirmDesktopAuth,
  statusDesktopAuth,
} from "./desktop-auth-native";
import { renewDesktopSession, revokeDesktopSession } from "./desktop-session";
import type { AuthEnv } from "./env";

/** Closed HTTP surface for the seven native contracts and browser continuation. */
export function routeDesktopAuth(
  request: Request,
  env: AuthEnv,
  path: string,
): Promise<Response> | null {
  const key = `${request.method} ${path}`;
  switch (key) {
    case "POST /api/auth/v1/desktop/start":
      return startDesktopAuth(request, env);
    case "POST /api/auth/v1/desktop/status":
      return statusDesktopAuth(request, env);
    case "POST /api/auth/v1/desktop/claim":
      return claimDesktopAuth(request, env);
    case "POST /api/auth/v1/desktop/confirm":
      return confirmDesktopAuth(request, env);
    case "POST /api/auth/v1/desktop/cancel":
      return cancelDesktopAuth(request, env);
    case "POST /api/auth/v1/desktop/session/renew":
      return renewDesktopSession(request, env);
    case "POST /api/auth/v1/desktop/session/revoke":
      return revokeDesktopSession(request, env);
    case "GET /api/auth/v1/desktop/browser":
      return launchDesktopBrowser(request, env);
    case "POST /api/auth/v1/desktop/browser/oauth/confirm":
      return confirmDesktopOAuthAccount(request, env);
    case "POST /api/auth/v1/desktop/browser/passkey/complete":
      return completeDesktopPasskey(request, env);
    default:
      return null;
  }
}
