import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { RouteCapabilityBoundary } from "@/shared/capabilities";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ProjectsScreen = React.lazy(async () => {
  const module = await import("@/features/projects/ui/ProjectsScreen");
  return { default: module.ProjectsScreen };
});

export const Route = createFileRoute("/projects")({
  component: ProjectsRouteComponent,
});

function ProjectsRouteComponent() {
  return (
    <RouteCapabilityBoundary capability="repositories">
      <React.Suspense fallback={<ViewLoadingFallback kind="projects" />}>
        <ProjectsScreen />
      </React.Suspense>
    </RouteCapabilityBoundary>
  );
}
