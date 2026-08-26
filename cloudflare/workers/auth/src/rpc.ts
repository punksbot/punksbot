import type { AuthProviderProfile, AuthSession, Punk } from "@punks/contracts";

import type { AuthIntent, AuthProvider } from "./env";

export interface DesktopTransactionTarget {
  flowId: string;
}

export interface AuthTransaction {
  provider: AuthProvider;
  intent: AuthIntent;
  returnTo: string;
  browserBindingHash: string;
  codeVerifier: string;
  currentPunkId: string | null;
  currentSessionId: string | null;
  createdAt: string;
  expiresAt: string;
  /** Présent uniquement pour la Cérémonie de connexion desktop (issue #54). */
  desktop?: DesktopTransactionTarget;
}

export type ClaimResolution =
  | { status: "missing" }
  | { status: "pending"; punkId: string }
  | { status: "active"; punkId: string };

export type ClaimResult =
  | { ok: true; replayed: boolean }
  | { ok: false; ownerPunkId: string; status: "pending" | "active" };

export type PunkResult =
  | { ok: true; state: Punk; replayed: boolean }
  | { ok: false; code: "not_found" | "inactive" | "identity_conflict" };

export interface SessionRecord extends Omit<AuthSession, "punk"> {}

export interface IdentityInput {
  profile: AuthProviderProfile;
  subjectHash: string;
  emailHash: string;
}
