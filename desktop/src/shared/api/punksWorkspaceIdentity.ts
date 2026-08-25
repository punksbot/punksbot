import type { WorkspaceSummary } from "@punks/contracts";

/** Keeps durable Workspace IDs distinct from mutable route slugs. */
export type WorkspaceIdentity =
  | { kind: "id"; workspaceId: string }
  | { kind: "slug"; workspaceSlug: string };

/** Resolves one explicitly typed identity from an authorized directory. */
export function resolveWorkspaceIdentity(
  workspaces: readonly WorkspaceSummary[],
  identity: WorkspaceIdentity,
): WorkspaceSummary | undefined {
  return identity.kind === "id"
    ? workspaces.find((workspace) => workspace.id === identity.workspaceId)
    : workspaces.find((workspace) => workspace.slug === identity.workspaceSlug);
}
