import { invokeTauri } from "@/shared/api/tauri";

type RawMessageMarkers = {
  pinned: string[];
  bookmarked: string[];
};

export type MessageMarkers = {
  pinned: ReadonlySet<string>;
  bookmarked: ReadonlySet<string>;
};

export async function getMessageMarkers(
  channelId: string,
): Promise<MessageMarkers> {
  const raw = await invokeTauri<RawMessageMarkers>("get_message_markers", {
    channelId,
  });
  return {
    pinned: new Set(raw.pinned),
    bookmarked: new Set(raw.bookmarked),
  };
}

export async function setMessagePin(
  channelId: string,
  eventId: string,
  pinned: boolean,
): Promise<void> {
  await invokeTauri("set_message_pin", { channelId, eventId, pinned });
}

export async function setMessageBookmark(
  channelId: string,
  eventId: string,
  bookmarked: boolean,
): Promise<void> {
  await invokeTauri("set_message_bookmark", {
    channelId,
    eventId,
    bookmarked,
  });
}
