import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getMessageMarkers,
  setMessageBookmark,
  setMessagePin,
} from "@/shared/api/tauriMessageMarkers";

const messageMarkersQueryKey = (channelId: string) =>
  ["message-markers", channelId] as const;

export function useMessageMarkerState(
  channelId: string | null,
  messageId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: messageMarkersQueryKey(channelId ?? ""),
    queryFn: () => getMessageMarkers(channelId ?? ""),
    enabled: enabled && channelId !== null,
    staleTime: 15_000,
    select: (markers) => ({
      pinned: markers.pinned.has(messageId),
      bookmarked: markers.bookmarked.has(messageId),
    }),
  });
}

export function useMessageMarkerMutations(channelId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () =>
    channelId
      ? queryClient.invalidateQueries({
          queryKey: messageMarkersQueryKey(channelId),
        })
      : Promise.resolve();
  const pin = useMutation({
    mutationFn: (input: { messageId: string; active: boolean }) => {
      if (!channelId)
        return Promise.reject(new Error("No Conversation selected"));
      return setMessagePin(channelId, input.messageId, input.active);
    },
    onSuccess: invalidate,
  });
  const bookmark = useMutation({
    mutationFn: (input: { messageId: string; active: boolean }) => {
      if (!channelId)
        return Promise.reject(new Error("No Conversation selected"));
      return setMessageBookmark(channelId, input.messageId, input.active);
    },
    onSuccess: invalidate,
  });
  return { pin, bookmark };
}
