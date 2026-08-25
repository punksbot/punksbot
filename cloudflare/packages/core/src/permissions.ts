const workspacePermissionValues = [
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

export const workspacePermissions = Object.freeze(workspacePermissionValues);

export type WorkspacePermission = (typeof workspacePermissions)[number];
export type WorkspaceRole = "owner" | "moderator" | "member" | "guest";

function immutablePermissionSet<T>(values: readonly T[]): ReadonlySet<T> {
  const backing = new Set(values);
  let view: ReadonlySet<T>;
  view = Object.freeze({
    get size() {
      return backing.size;
    },
    has(value: T) {
      return backing.has(value);
    },
    entries() {
      return backing.entries();
    },
    keys() {
      return backing.keys();
    },
    values() {
      return backing.values();
    },
    forEach(
      callback: (value: T, value2: T, set: ReadonlySet<T>) => void,
      thisArg?: unknown,
    ) {
      backing.forEach((value) => {
        callback.call(thisArg, value, value, view);
      });
    },
    [Symbol.iterator]() {
      return backing[Symbol.iterator]();
    },
    [Symbol.toStringTag]: "Set",
  });
  return view;
}

export const rolePermissions: Readonly<
  Record<WorkspaceRole, ReadonlySet<WorkspacePermission>>
> = Object.freeze({
  owner: immutablePermissionSet<WorkspacePermission>(workspacePermissions),
  moderator: immutablePermissionSet<WorkspacePermission>([
    "workspace.read",
    "moderation.perform",
    "conversations.write",
    "huddles.join",
    "huddles.manage",
  ]),
  member: immutablePermissionSet<WorkspacePermission>([
    "workspace.read",
    "conversations.write",
    "huddles.join",
  ]),
  guest: immutablePermissionSet<WorkspacePermission>(["workspace.read"]),
});

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
