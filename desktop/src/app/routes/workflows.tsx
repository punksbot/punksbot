import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RouteCapabilityBoundary } from "@/shared/capabilities";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export const Route = createFileRoute("/workflows")({
  component: WorkflowsRouteComponent,
});

const WorkflowsRouteScreen = React.lazy(async () => {
  const module = await import("./WorkflowsRouteScreen");
  return { default: module.WorkflowsRouteScreen };
});

function WorkflowsRouteComponent() {
  return (
    <RouteCapabilityBoundary capability="workflows">
      <React.Suspense fallback={<ViewLoadingFallback kind="workflows" />}>
        <WorkflowsRouteScreen selectedWorkflowId={null} />
      </React.Suspense>
    </RouteCapabilityBoundary>
  );
}
