import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RouteCapabilityBoundary } from "@/shared/capabilities";

const NewMessageScreen = React.lazy(async () => {
  const module = await import("@/features/messages/ui/NewMessageScreen");
  return { default: module.NewMessageScreen };
});

export const Route = createFileRoute("/messages/new")({
  component: NewMessageRouteComponent,
});

function NewMessageRouteComponent() {
  return (
    <RouteCapabilityBoundary capability="direct-conversations">
      <React.Suspense fallback={null}>
        <NewMessageScreen />
      </React.Suspense>
    </RouteCapabilityBoundary>
  );
}
