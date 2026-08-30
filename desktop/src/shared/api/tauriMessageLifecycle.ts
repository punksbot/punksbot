import { invokeTauri } from "@/shared/api/tauri";

export async function restoreMessage(
  channelId: string,
  eventId: string,
): Promise<void> {
  await invokeTauri("restore_message", { channelId, eventId });
}

export async function eraseMessage(
  channelId: string,
  eventId: string,
): Promise<void> {
  await invokeTauri("erase_message", { channelId, eventId });
}
