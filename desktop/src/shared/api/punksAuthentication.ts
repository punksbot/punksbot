import type { AuthSession } from "@punks/contracts";

/** Moyen de connexion que la Cérémonie desktop peut prouver. */
export type AuthenticationMethod = "google" | "github" | "passkey";

/** Google et GitHub peuvent être liés ; une passkey a sa propre intention. */
export type IdentityLinkProvider = Exclude<AuthenticationMethod, "passkey">;

/** Intention sémantique publique, sans identifiant de flow ni vérificateur. */
export type AuthenticationIntent =
  | "sign_in"
  | "switch_account"
  | "reauthenticate"
  | "link_google"
  | "link_github"
  | "register_passkey";

/** Vue IPC assainie de la Cérémonie de connexion desktop. */
export type CeremonyPhaseView =
  | { phase: "idle" }
  | {
      phase: "started";
      intent: AuthenticationIntent;
      method: AuthenticationMethod;
    }
  | { phase: "browser_complete" }
  | { phase: "ready" }
  | { phase: "delivering" }
  | { phase: "confirmed"; sessionId: string }
  | { phase: "cancelled" }
  | { phase: "expired" }
  | { phase: "failed"; code: string };

/** État de Compte assaini ; aucun secret ni flow id ne traverse l'IPC. */
export type AccountSessionStateView =
  | {
      state: "signed_out";
      authentication: CeremonyPhaseView;
      resumeAvailable: boolean;
    }
  | {
      state: "authenticated";
      session: AuthSession;
      authentication: CeremonyPhaseView;
      resumeAvailable: boolean;
    };
