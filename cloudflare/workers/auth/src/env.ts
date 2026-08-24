export interface AuthEnv extends CloudflareBindings {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  BOT_INVOCATION_PREVIOUS_KID?: string;
  BOT_INVOCATION_PREVIOUS_SECRET?: string;
}

export type AuthProvider = "google" | "github";
export type AuthIntent = "sign_in" | "reauthenticate" | "link";
