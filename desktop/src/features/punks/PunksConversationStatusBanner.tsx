import type { FollowStatus } from "./PunksConversationTypes";

export function ConversationStatusBanner({ status }: { status: FollowStatus }) {
  return (
    <p
      className={`text-xs ${status === "offline" || status === "unavailable" ? "text-destructive" : "text-muted-foreground"}`}
      data-testid={`punks-follow-${status}`}
      role={
        status === "offline" || status === "unavailable" ? "alert" : "status"
      }
    >
      {status === "loading"
        ? "Loading Messages…"
        : status === "connecting"
          ? "Connecting to the live Stream…"
          : status === "live"
            ? "Live"
            : status === "resyncing"
              ? "Refreshing the Stream…"
              : status === "offline"
                ? "Offline — existing Messages remain visible; new activity is paused."
                : status === "archived"
                  ? "This Stream is archived."
                  : "This Stream is no longer available to this Punk."}
    </p>
  );
}
