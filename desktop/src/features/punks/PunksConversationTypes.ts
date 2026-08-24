import type { MessageView, ResolveAuthorsResponse } from "@punks/contracts";

export type FollowStatus =
  | "loading"
  | "connecting"
  | "live"
  | "resyncing"
  | "offline"
  | "archived"
  | "unavailable";

export type AuthorSummary = ResolveAuthorsResponse["authors"][number];

export function actorKey(actor: MessageView["author"]): string {
  return actor.kind === "punk"
    ? `punk:${actor.punkId}`
    : `bot:${actor.installationId}`;
}
