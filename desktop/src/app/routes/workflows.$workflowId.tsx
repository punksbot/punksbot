import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RouteCapabilityBoundary } from "@/shared/capabilities";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export const Route = createFileRoute("/workflows/$workflowId")({
  component: WorkflowDetailRouteComponent,
});

const WorkflowsRouteScreen = React.lazy(async () => {
  const module = await import("./WorkflowsRouteScreen");
  return { default: module.WorkflowsRouteScreen };
});

function WorkflowDetailRouteComponent() {
  const { workflowId } = Route.useParams();

  return (
    <RouteCapabilityBoundary capability="workflows">
      <React.Suspense fallback={<ViewLoadingFallback kind="workflows" />}>
        <WorkflowsRouteScreen selectedWorkflowId={workflowId} />
      </React.Suspense>
    </RouteCapabilityBoundary>
  );
}
