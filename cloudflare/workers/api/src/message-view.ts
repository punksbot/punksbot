import type { MessageView } from "@punks/contracts";
import type { BoundedMessageState } from "@punks/core";

import type { MessageContentPayload } from "./message-content-do";

/** Builds the only Message representation allowed across the public API. */
export function authorizedMessageView(
  state: BoundedMessageState,
  payload: MessageContentPayload | null,
): MessageView {
  const active = state.status === "active";
  if (active !== (payload !== null)) {
    throw new Error("Message content does not match its public status");
  }
  return {
    id: state.id,
    workspaceId: state.workspaceId,
    conversationId: state.conversationId,
    author: state.author,
    messageType: state.messageType,
    status: state.status,
    content: payload?.content ?? null,
    topic: payload?.topic ?? null,
    mentionedPunkIds: state.mentionedPunkIds,
    mediaIds: active ? state.mediaIds : [],
    parentMessageId: state.parentMessageId,
    threadRootMessageId: state.threadRootMessageId,
    threadDepth: state.threadDepth,
    broadcast: state.broadcast,
    replyCount: state.replyCount,
    descendantCount: state.descendantCount,
    lastReplyAt: state.lastReplyAt,
    currentVersion: active ? state.currentVersion : null,
    retractionKind:
      state.retraction?.kind ?? state.erasureMarker?.retractionKind ?? null,
    retractedAt:
      state.retraction?.requestedAt ?? state.erasureMarker?.retractedAt ?? null,
    eraseAfter: state.retraction?.eraseAfter ?? null,
    publicReason: state.retraction?.publicReason ?? null,
    erasedAt: state.erasureMarker?.erasedAt ?? null,
    revision: state.revision,
    createdCursor: state.createdCursor,
    cursor: state.cursor,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    editedAt: state.editedAt,
  };
}
