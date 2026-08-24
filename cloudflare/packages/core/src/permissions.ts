export const workspacePermissions = [
  "workspace.read",
  "workspace.rename",
  "members.manage",
  "moderation.perform",
  "conversations.write",
  "huddles.join",
  "huddles.manage",
  "repositories.manage",
  "bots.install",
] as const;

export type WorkspacePermission = (typeof workspacePermissions)[number];
export type WorkspaceRole = "owner" | "moderator" | "member" | "guest";

export const rolePermissions: Readonly<
  Record<WorkspaceRole, ReadonlySet<WorkspacePermission>>
> = {
  owner: new Set(workspacePermissions),
  moderator: new Set([
    "workspace.read",
    "moderation.perform",
    "conversations.write",
    "huddles.join",
    "huddles.manage",
  ]),
  member: new Set(["workspace.read", "conversations.write", "huddles.join"]),
  guest: new Set(["workspace.read"]),
};

export function roleHasPermission(
  role: WorkspaceRole,
  permission: WorkspacePermission,
): boolean {
  return rolePermissions[role].has(permission);
}

export function isStrictWorkspaceRoleReduction(
  currentRole: WorkspaceRole,
  nextRole: WorkspaceRole,
): boolean {
  const current = rolePermissions[currentRole];
  const next = rolePermissions[nextRole];
  return (
    next.size < current.size &&
    [...next].every((permission) => current.has(permission))
  );
}
