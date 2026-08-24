import type { MessageHistoryResponse, MessageView } from "@punks/contracts";
import { encodeMessageHistoryCursor } from "@punks/core";

export const MESSAGE_HISTORY_MAX_RESPONSE_BYTES = 1_048_576;

export class MessageHistoryResponseTooLarge extends Error {
  constructor() {
    super("A single authorized Message exceeds the history response limit");
    this.name = "MessageHistoryResponseTooLarge";
  }
}

interface BuildMessageHistoryResponseInput {
  workspaceId: string;
  conversationId: string;
  threadRootMessageId?: string;
  highWaterCursor: number;
  direction: "older" | "newer";
  /** Items in traversal order: DESC for older, ASC for newer. */
  candidates: readonly MessageView[];
  hasMoreAfterCandidates: boolean;
  cursorKey: Uint8Array;
  maxBytes?: number;
}

function responseBytes(value: MessageHistoryResponse): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function displayOrder(
  traversal: readonly MessageView[],
  direction: "older" | "newer",
): MessageView[] {
  return direction === "older" ? [...traversal].reverse() : [...traversal];
}

/**
 * Caps a history page by serialized bytes while preserving a stable traversal
 * position. The 512-byte placeholder reserves the contract's maximum cursor.
 */
export async function buildMessageHistoryResponse(
  input: BuildMessageHistoryResponseInput,
): Promise<MessageHistoryResponse> {
  const maxBytes = input.maxBytes ?? MESSAGE_HISTORY_MAX_RESPONSE_BYTES;
  const included: MessageView[] = [];
  for (const candidate of input.candidates) {
    const trial = [...included, candidate];
    const provisional: MessageHistoryResponse = {
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      highWaterCursor: input.highWaterCursor,
      order: "createdCursor-ascending",
      items: displayOrder(trial, input.direction),
      nextCursor: "x".repeat(512),
    };
    if (responseBytes(provisional) > maxBytes) {
      if (included.length === 0) {
        throw new MessageHistoryResponseTooLarge();
      }
      break;
    }
    included.push(candidate);
  }

  const more =
    input.hasMoreAfterCandidates || included.length < input.candidates.length;
  const position = included.at(-1)?.createdCursor;
  const nextCursor =
    more && position !== undefined
      ? await encodeMessageHistoryCursor(
          {
            version: 1,
            workspaceId: input.workspaceId,
            conversationId: input.conversationId,
            ...(input.threadRootMessageId === undefined
              ? {}
              : { threadRootMessageId: input.threadRootMessageId }),
            highWaterCursor: input.highWaterCursor,
            positionCursor: position,
            direction: input.direction,
          },
          input.cursorKey,
        )
      : null;
  const response: MessageHistoryResponse = {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    highWaterCursor: input.highWaterCursor,
    order: "createdCursor-ascending",
    items: displayOrder(included, input.direction),
    nextCursor,
  };
  if (responseBytes(response) > maxBytes) {
    throw new MessageHistoryResponseTooLarge();
  }
  return response;
}
