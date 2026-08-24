import {
  PunksDesktopFailure,
  type PunksFollow,
  type PunksFollowDelivery,
} from "@/shared/api/punksClient";
import type { MessageView } from "@punks/contracts";

import type { FollowStatus } from "./PunksConversationTypes";

/** Compares React Query keys without allowing a cross-view cache update. */
export function sameQueryKey(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** Maps typed session failures to the only statuses the conversation renders. */
export function failureStatus(
  error: unknown,
): Exclude<FollowStatus, "loading" | "connecting" | "live" | "resyncing"> {
  if (error instanceof PunksDesktopFailure && error.kind === "transport") {
    return "offline";
  }
  return "unavailable";
}

/**
 * Mirrors the server's restore authority without offering a doomed control.
 * Author retractions belong to their author; moderation retractions belong to
 * a current moderator. Unknown or malformed retraction kinds fail closed.
 */
export function canRestoreMessage(
  message: Pick<MessageView, "status" | "retractionKind">,
  isAuthor: boolean,
  canModerate: boolean,
): boolean {
  if (message.status !== "retracted") return false;
  if (message.retractionKind === "author") return isAuthor;
  if (message.retractionKind === "moderation") return canModerate;
  return false;
}

/** Drains a FOLLOW until its scoped controller asks the pump to stop. */
export async function pumpFollow(
  follow: PunksFollow,
  isActive: () => boolean,
  onDelivery: (delivery: PunksFollowDelivery) => Promise<boolean>,
): Promise<void> {
  while (isActive()) {
    const delivery = await follow.nextDelivery();
    if (!isActive()) return;
    if (!(await onDelivery(delivery))) return;
  }
}
