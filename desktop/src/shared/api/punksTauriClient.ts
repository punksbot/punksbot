import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
  AuthSession,
  ConversationSummary,
  ConversationView,
  DesktopCompatibilityResponse,
  ListConversationsResponse,
  ListWorkspacesResponse,
  MessageHistoryResponse,
  MessageMutationResponse,
  MessageReactionMutationResponse,
  MessageView,
  ResolveAuthorsQuery,
  ResolveAuthorsResponse,
  WorkspaceSummary,
} from "@punks/contracts";
import {
  type DesktopContractId,
  validateDesktopContract,
} from "@punks/contracts/desktop";

import { PunksDesktopFailure, type PunksFailureKind } from "./punksFailure";
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

const failureKinds = new Set<PunksFailureKind>([
  "problem",
  "transport",
  "contract_violation",
  "cancelled",
  "stale_workspace",
  "session_expired",
  "ambiguous",
]);

function normalizeFailure(error: unknown): PunksDesktopFailure {
  if (error instanceof PunksDesktopFailure) return error;
  if (
    typeof error === "object" &&
    error !== null &&
    "kind" in error &&
    typeof error.kind === "string" &&
    failureKinds.has(error.kind as PunksFailureKind) &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return new PunksDesktopFailure(
      error.kind as PunksFailureKind,
      error.message,
      "problem" in error ? error.problem : undefined,
    );
  }
  return new PunksDesktopFailure(
    "contract_violation",
    "Tauri returned an invalid Punks failure",
  );
}

async function invokePunks<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw normalizeFailure(error);
  }
}

function requireContract<T>(contractId: DesktopContractId, value: unknown): T {
  if (!validateDesktopContract(contractId, value).valid) {
    throw new PunksDesktopFailure(
      "contract_violation",
      `Tauri result violated ${contractId}`,
    );
  }
  return value as T;
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
    const response = await invokePunks<MessageMutationResponse>(
      "punks_edit_message",
      { lease: this.lease, input },
    );
    const acknowledgement = requireContract<MessageMutationResponse>(
      "punks://contracts/message.mutation-response@1",
      response,
    );
    if (
      acknowledgement.message.workspaceId !== this.lease.workspaceId ||
      acknowledgement.message.conversationId !== input.conversationId ||
      acknowledgement.message.id !== input.messageId
    ) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "Tauri returned a Message from the wrong scope",
      );
    }
    return acknowledgement.message;
  }

  async retractMessage(input: RetractMessageInput): Promise<MessageView> {
    const response = await invokePunks<MessageMutationResponse>(
      "punks_retract_message",
      { lease: this.lease, input },
    );
    const acknowledgement = requireContract<MessageMutationResponse>(
      "punks://contracts/message.mutation-response@1",
      response,
    );
    if (
      acknowledgement.message.workspaceId !== this.lease.workspaceId ||
      acknowledgement.message.conversationId !== input.conversationId ||
      acknowledgement.message.id !== input.messageId
    ) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "Tauri returned a Message from the wrong scope",
      );
    }
    return acknowledgement.message;
  }

  async restoreMessage(input: RestoreMessageInput): Promise<MessageView> {
    const response = await invokePunks<MessageMutationResponse>(
      "punks_restore_message",
      { lease: this.lease, input },
    );
    const acknowledgement = requireContract<MessageMutationResponse>(
      "punks://contracts/message.mutation-response@1",
      response,
    );
    if (
      acknowledgement.message.workspaceId !== this.lease.workspaceId ||
      acknowledgement.message.conversationId !== input.conversationId ||
      acknowledgement.message.id !== input.messageId
    ) {
      throw new PunksDesktopFailure(
        "contract_violation",
        "Tauri returned a Message from the wrong scope",
      );
    }
    return acknowledgement.message;
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
