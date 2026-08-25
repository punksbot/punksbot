import type { MessageMutationResponse, MessageView } from "@punks/contracts";

import type {
  EditMessageInput,
  RestoreMessageInput,
  RetractMessageInput,
  WorkspaceLease,
} from "./punksClient";
import { PunksDesktopFailure } from "./punksFailure";
import { invokePunks, requireContract } from "./punksTauriTransport";

function acknowledgedMessage(
  response: unknown,
  lease: WorkspaceLease,
  conversationId: string,
  messageId: string,
): MessageView {
  const acknowledgement = requireContract<MessageMutationResponse>(
    "punks://contracts/message.mutation-response@1",
    response,
  );
  if (
    acknowledgement.message.workspaceId !== lease.workspaceId ||
    acknowledgement.message.conversationId !== conversationId ||
    acknowledgement.message.id !== messageId
  ) {
    throw new PunksDesktopFailure(
      "contract_violation",
      "Tauri returned a Message from the wrong scope",
    );
  }
  return acknowledgement.message;
}

export async function editPunksMessage(
  lease: WorkspaceLease,
  input: EditMessageInput,
): Promise<MessageView> {
  return acknowledgedMessage(
    await invokePunks("punks_edit_message", { lease, input }),
    lease,
    input.conversationId,
    input.messageId,
  );
}

export async function retractPunksMessage(
  lease: WorkspaceLease,
  input: RetractMessageInput,
): Promise<MessageView> {
  return acknowledgedMessage(
    await invokePunks("punks_retract_message", { lease, input }),
    lease,
    input.conversationId,
    input.messageId,
  );
}

export async function restorePunksMessage(
  lease: WorkspaceLease,
  input: RestoreMessageInput,
): Promise<MessageView> {
  return acknowledgedMessage(
    await invokePunks("punks_restore_message", { lease, input }),
    lease,
    input.conversationId,
    input.messageId,
  );
}
