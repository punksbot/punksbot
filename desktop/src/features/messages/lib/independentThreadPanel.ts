import { formatTimelineMessages } from "@/features/messages/lib/formatTimelineMessages";
import { buildThreadPanelData } from "@/features/messages/lib/threadPanel";
import type { RelayEvent } from "@/shared/api/types";
import { CHANNEL_AUX_EVENT_KINDS } from "@/shared/constants/kinds";

const AUX_EVENT_KINDS = new Set<number>(CHANNEL_AUX_EVENT_KINDS);

function eventReferences(event: RelayEvent, targetId: string): boolean {
  return event.tags.some((tag) => tag[0] === "e" && tag[1] === targetId);
}

export function buildIndependentThreadPanel(
  channelEvents: RelayEvent[],
  replyEvents: RelayEvent[],
  rootId: string | null,
  replyTargetId: string | null,
  expandedReplyIds: ReadonlySet<string>,
  ...formatArgs: Tail<Parameters<typeof formatTimelineMessages>>
) {
  if (!rootId) {
    return {
      ...buildThreadPanelData([], null, replyTargetId, expandedReplyIds),
      messages: [],
    };
  }
  const head = channelEvents.find((event) => event.id === rootId);
  const headAuxEvents = channelEvents.filter(
    (event) =>
      AUX_EVENT_KINDS.has(event.kind) && eventReferences(event, rootId),
  );
  const candidates = head
    ? [head, ...headAuxEvents, ...replyEvents]
    : replyEvents;
  const events = [
    ...new Map(candidates.map((event) => [event.id, event])).values(),
  ];
  const messages = formatTimelineMessages(events, ...formatArgs);
  return {
    ...buildThreadPanelData(messages, rootId, replyTargetId, expandedReplyIds),
    messages,
  };
}

type Tail<T extends readonly unknown[]> = T extends readonly [
  unknown,
  ...infer R,
]
  ? R
  : never;
