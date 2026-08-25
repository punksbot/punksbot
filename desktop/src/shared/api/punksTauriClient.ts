import type {
  AuthSession,
  ConversationSummary,
  ConversationView,
  DesktopCompatibilityResponse,
  ListConversationsResponse,
  ListWorkspacesResponse,
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
  CeremonyPhaseView,
  EditMessageInput,
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
  WorkspaceLease,
} from "./punksClient";

class TauriWorkspaceSession implements PunksWorkspaceSession {
  readonly lease: WorkspaceLease;

  constructor(lease: WorkspaceLease) {
    this.lease = lease;
  }

  async close(): Promise<void> {
    await invokePunks<void>("punks_close_workspace", { lease: this.lease });
  }

  async listStreams(): Promise<ConversationSummary[]> {
    const items = await invokePunks<ConversationSummary[]>(
      "punks_list_streams",
      { lease: this.lease },
    );
    return requireContract<ListConversationsResponse>(
      "punks://contracts/conversation.list-response@1",
      {
        contract: "conversation.list-response@1",
        workspaceId: this.lease.workspaceId,
        items,
        nextCursor: null,
      },
    ).items;
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

  async getSession(): Promise<AuthSession> {
    return requireContract<AuthSession>(
      "punks://contracts/auth.session@1",
      await invokePunks("punks_get_session"),
    );
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    const items = await invokePunks<WorkspaceSummary[]>(
      "punks_list_workspaces",
    );
    return requireContract<ListWorkspacesResponse>(
      "punks://contracts/workspace.list-response@1",
      { contract: "workspace.list-response@1", items, nextCursor: null },
    ).items;
  }

  resolveWorkspace(idOrSlug: string): Promise<WorkspaceSummary | null> {
    return invokePunks("punks_resolve_workspace", { idOrSlug });
  }

  ceremonyStart(provider: "google" | "github"): Promise<CeremonyPhaseView> {
    return invokePunks("punks_ceremony_start", { provider });
  }

  ceremonyStatus(): Promise<CeremonyPhaseView> {
    return invokePunks("punks_ceremony_status");
  }

  ceremonyCancel(): Promise<CeremonyPhaseView> {
    return invokePunks("punks_ceremony_cancel");
  }

  sessionRenew(): Promise<CeremonyPhaseView> {
    return invokePunks("punks_session_renew");
  }

  logout(): Promise<"revoked" | "queued"> {
    return invokePunks("punks_logout");
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
