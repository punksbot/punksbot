import type {
  AuthSession,
  ConversationSummary,
  ConversationView,
  DesktopCompatibilityResponse,
  MessageHistoryResponse,
  MessageReactionMutationResponse,
  MessageView,
  ResolveAuthorsQuery,
  ResolveAuthorsResponse,
  WorkspaceSummary,
} from "@punks/contracts";
import { PunksDesktopFailure } from "./punksFailure";
import { invokePunks, requireContract } from "./punksTauriTransport";
import type {
  AccountSessionStateView,
  AuthenticationMethod,
  CeremonyPhaseView,
  EditMessageInput,
  IdentityLinkProvider,
  MessagePageInput,
  PunksAccountClient,
  PunksFollow,
  PunksNavigationTarget,
  PunksWorkspaceSession,
  PostTextInput,
  ReactionInput,
  RestoreMessageInput,
  RetractMessageInput,
  ThreadPageInput,
  WorkspaceIdentity,
  WorkspaceLease,
} from "./punksClient";

const authenticationMethods = new Set<AuthenticationMethod>([
  "google",
  "github",
  "passkey",
]);
const authenticationIntents = new Set([
  "sign_in",
  "switch_account",
  "reauthenticate",
  "link_google",
  "link_github",
  "register_passkey",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function invalidNativeView(message: string): never {
  throw new PunksDesktopFailure("contract_violation", message);
}

function requireCeremonyPhaseView(value: unknown): CeremonyPhaseView {
  if (!isRecord(value) || typeof value.phase !== "string") {
    return invalidNativeView("Native authentication phase is invalid");
  }
  if (
    [
      "idle",
      "browser_complete",
      "ready",
      "delivering",
      "cancelled",
      "expired",
    ].includes(value.phase)
  ) {
    if (!hasExactKeys(value, ["phase"])) {
      return invalidNativeView("Native authentication phase is not sanitized");
    }
    return value as CeremonyPhaseView;
  }
  if (value.phase === "started") {
    if (
      !hasExactKeys(value, ["phase", "intent", "method"]) ||
      typeof value.intent !== "string" ||
      !authenticationIntents.has(value.intent) ||
      typeof value.method !== "string" ||
      !authenticationMethods.has(value.method as AuthenticationMethod)
    ) {
      return invalidNativeView("Native started phase is invalid");
    }
    return value as CeremonyPhaseView;
  }
  if (
    value.phase === "confirmed" &&
    hasExactKeys(value, ["phase", "sessionId"]) &&
    typeof value.sessionId === "string"
  ) {
    return value as CeremonyPhaseView;
  }
  if (
    value.phase === "failed" &&
    hasExactKeys(value, ["phase", "code"]) &&
    typeof value.code === "string"
  ) {
    return value as CeremonyPhaseView;
  }
  return invalidNativeView("Native authentication phase is invalid");
}

function requireAccountSessionStateView(
  value: unknown,
): AccountSessionStateView {
  if (!isRecord(value) || typeof value.resumeAvailable !== "boolean") {
    return invalidNativeView("Native Account session state is invalid");
  }
  const authentication = requireCeremonyPhaseView(value.authentication);
  if (
    value.state === "signed_out" &&
    hasExactKeys(value, ["state", "authentication", "resumeAvailable"])
  ) {
    return {
      state: "signed_out",
      authentication,
      resumeAvailable: value.resumeAvailable,
    };
  }
  if (
    value.state === "authenticated" &&
    hasExactKeys(value, [
      "state",
      "session",
      "authentication",
      "resumeAvailable",
    ])
  ) {
    return {
      state: "authenticated",
      session: requireContract<AuthSession>(
        "punks://contracts/auth.session@1",
        value.session,
      ),
      authentication,
      resumeAvailable: value.resumeAvailable,
    };
  }
  return invalidNativeView("Native Account session state is not sanitized");
}

class TauriWorkspaceSession implements PunksWorkspaceSession {
  readonly lease: WorkspaceLease;

  constructor(lease: WorkspaceLease) {
    this.lease = lease;
  }

  async close(): Promise<void> {
    await invokePunks<void>("punks_close_workspace", { lease: this.lease });
  }

  async listStreams(): Promise<ConversationSummary[]> {
    return invokePunks<ConversationSummary[]>("punks_list_streams", {
      lease: this.lease,
    });
  }

  async getStream(conversationId: string): Promise<ConversationView> {
    return requireContract<ConversationView>(
      "punks://contracts/conversation.view@1",
      await invokePunks("punks_get_stream", {
        lease: this.lease,
        conversationId,
      }),
    );
  }

  async getTimeline(input: MessagePageInput): Promise<MessageHistoryResponse> {
    return requireContract<MessageHistoryResponse>(
      "punks://contracts/message.history-response@1",
      await invokePunks("punks_get_timeline", { lease: this.lease, input }),
    );
  }

  async getThread(input: ThreadPageInput): Promise<MessageHistoryResponse> {
    return requireContract<MessageHistoryResponse>(
      "punks://contracts/message.history-response@1",
      await invokePunks("punks_get_thread", { lease: this.lease, input }),
    );
  }

  resolveAuthors(
    authors: ResolveAuthorsQuery["authors"],
  ): Promise<ResolveAuthorsResponse["authors"]> {
    return invokePunks("punks_resolve_authors", {
      lease: this.lease,
      authors,
    });
  }

  async followConversation(
    conversationId: string,
    afterCursor: number,
  ): Promise<PunksFollow> {
    const operationId = await invokePunks<string>("punks_follow_conversation", {
      lease: this.lease,
      conversationId,
      afterCursor,
    });
    return {
      nextDelivery() {
        return invokePunks("punks_follow_next", { operationId });
      },
      async confirmBatch(throughCursor) {
        await invokePunks("punks_confirm_follow_batch", {
          operationId,
          throughCursor,
        });
      },
      async close() {
        await invokePunks("punks_close_follow", { operationId });
      },
    };
  }

  async postMessage(input: PostTextInput): Promise<MessageView> {
    return requireContract<MessageView>(
      "punks://contracts/message.view@1",
      await invokePunks("punks_post_message", { lease: this.lease, input }),
    );
  }

  async editMessage(input: EditMessageInput): Promise<MessageView> {
    const { editPunksMessage } = await import("./punksMessageLifecycleTauri");
    return editPunksMessage(this.lease, input);
  }

  async retractMessage(input: RetractMessageInput): Promise<MessageView> {
    const { retractPunksMessage } = await import(
      "./punksMessageLifecycleTauri"
    );
    return retractPunksMessage(this.lease, input);
  }

  async restoreMessage(input: RestoreMessageInput): Promise<MessageView> {
    const { restorePunksMessage } = await import(
      "./punksMessageLifecycleTauri"
    );
    return restorePunksMessage(this.lease, input);
  }

  async addReaction(
    input: ReactionInput,
  ): Promise<MessageReactionMutationResponse> {
    return requireContract<MessageReactionMutationResponse>(
      "punks://contracts/message.reaction-mutation-response@1",
      await invokePunks("punks_add_reaction", { lease: this.lease, input }),
    );
  }

  async removeReaction(
    input: ReactionInput,
  ): Promise<MessageReactionMutationResponse> {
    return requireContract<MessageReactionMutationResponse>(
      "punks://contracts/message.reaction-mutation-response@1",
      await invokePunks("punks_remove_reaction", { lease: this.lease, input }),
    );
  }
}

export class TauriPunksAccountClient implements PunksAccountClient {
  async checkCompatibility(): Promise<DesktopCompatibilityResponse> {
    return requireContract<DesktopCompatibilityResponse>(
      "punks://contracts/desktop.compatibility-response@1",
      await invokePunks("punks_check_compatibility"),
    );
  }

  async getAccountSessionState(): Promise<AccountSessionStateView> {
    return requireAccountSessionStateView(
      await invokePunks("punks_get_account_session_state"),
    );
  }

  async startSignIn(
    provider: AuthenticationMethod,
  ): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_start_sign_in", { provider }),
    );
  }

  async startAccountSwitch(
    provider: AuthenticationMethod,
  ): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_start_account_switch", { provider }),
    );
  }

  async startReauthentication(
    method: AuthenticationMethod,
    purpose: string,
  ): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_start_reauthentication", { method, purpose }),
    );
  }

  async startIdentityLink(
    provider: IdentityLinkProvider,
  ): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_start_identity_link", { provider }),
    );
  }

  async startPasskeyRegistration(): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_start_passkey_registration"),
    );
  }

  async resumeInterruptedAuthentication(): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_resume_interrupted_authentication"),
    );
  }

  async cancelAuthentication(): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_cancel_authentication"),
    );
  }

  async renewAccountSession(): Promise<CeremonyPhaseView> {
    return requireCeremonyPhaseView(
      await invokePunks("punks_renew_account_session"),
    );
  }

  async signOut(): Promise<"revoked" | "queued"> {
    const outcome = await invokePunks<unknown>("punks_sign_out");
    if (outcome !== "revoked" && outcome !== "queued") {
      return invalidNativeView("Native sign-out result is invalid");
    }
    return outcome;
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return invokePunks<WorkspaceSummary[]>("punks_list_workspaces");
  }

  resolveWorkspace(
    identity: WorkspaceIdentity,
  ): Promise<WorkspaceSummary | null> {
    return invokePunks("punks_resolve_workspace", { identity });
  }

  validateNavigation(url: string): Promise<PunksNavigationTarget> {
    return invokePunks<PunksNavigationTarget>("punks_validate_navigation", {
      url,
    }).then((target) => {
      if (
        typeof target !== "object" ||
        target === null ||
        !["home", "workspace", "conversation", "message"].includes(
          target.kind,
        ) ||
        typeof target.path !== "string"
      ) {
        throw new PunksDesktopFailure(
          "contract_violation",
          "Native Punks navigation target is invalid",
        );
      }
      return target;
    });
  }

  async openWorkspace(workspaceId: string): Promise<PunksWorkspaceSession> {
    const lease = await invokePunks<WorkspaceLease>("punks_open_workspace", {
      workspaceId,
    });
    return new TauriWorkspaceSession(lease);
  }
}
