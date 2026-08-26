import type { MessageSearchResponse } from "@punks/contracts";

import type { MessageSearchInput, WorkspaceLease } from "./punksClientTypes";
import { invokePunks, requireContract } from "./punksTauriTransport";

/** Typed Tauri boundary for one Conversation- or Fil-scoped Message search. */
export async function searchMessages(
  lease: WorkspaceLease,
  input: MessageSearchInput,
): Promise<MessageSearchResponse> {
  return requireContract<MessageSearchResponse>(
    "punks://contracts/message.search-response@1",
    await invokePunks("punks_search_messages", { lease, input }),
  );
}
