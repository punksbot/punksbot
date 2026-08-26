export interface AuthEnv extends CloudflareBindings {
  GOOGLE_OAUTH_CLIENT_ID: string;
  GOOGLE_OAUTH_CLIENT_SECRET: string;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  BOT_INVOCATION_PREVIOUS_KID?: string;
  BOT_INVOCATION_PREVIOUS_SECRET?: string;
  ACCOUNT_MERGE_RECEIPTS: CloudflareBindings["ACCOUNT_MERGE_RECEIPTS"] & {
    recordAccountMergeReceipt(input: unknown): Promise<unknown>;
    lookupAccountMergeReceipt(input: unknown): Promise<unknown>;
    lookupAccountMergeRecovery(input: unknown): Promise<unknown>;
  };
  ACCOUNT_MERGE_WORKSPACES: CloudflareBindings["ACCOUNT_MERGE_WORKSPACES"] & {
    prepare(input: unknown): Promise<unknown>;
    apply(input: unknown): Promise<unknown>;
    abort(input: unknown): Promise<unknown>;
  };
}

export type AuthProvider = "google" | "github";
export type AuthIntent = "sign_in" | "reauthenticate" | "link";
