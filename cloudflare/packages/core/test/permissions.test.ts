import { describe, expect, it } from "vitest";

import {
  isStrictWorkspaceRoleReduction,
  roleHasPermission,
  rolePermissions,
  workspacePermissions,
} from "../src";

describe("closed Workspace role capabilities", () => {
  it("keeps the four normative bundles exact and immutable at runtime", () => {
    expect(Object.keys(rolePermissions)).toEqual([
      "owner",
      "moderator",
      "member",
      "guest",
    ]);
    expect([...rolePermissions.owner]).toEqual(workspacePermissions);
    expect([...rolePermissions.moderator]).toEqual([
      "workspace.read",
      "moderation.perform",
      "conversations.write",
      "huddles.join",
      "huddles.manage",
    ]);
    expect([...rolePermissions.member]).toEqual([
      "workspace.read",
      "conversations.write",
      "huddles.join",
    ]);
    expect([...rolePermissions.guest]).toEqual(["workspace.read"]);

    for (const permissions of Object.values(rolePermissions)) {
      expect(Object.isFrozen(permissions)).toBe(true);
      expect(Reflect.get(permissions, "add")).toBeUndefined();
      expect(Reflect.get(permissions, "delete")).toBeUndefined();
      expect(Reflect.get(permissions, "clear")).toBeUndefined();
    }
  });

  it("allows only strict capability reductions down the normative chain", () => {
    expect(isStrictWorkspaceRoleReduction("owner", "moderator")).toBe(true);
    expect(isStrictWorkspaceRoleReduction("moderator", "member")).toBe(true);
    expect(isStrictWorkspaceRoleReduction("member", "guest")).toBe(true);
    expect(isStrictWorkspaceRoleReduction("guest", "member")).toBe(false);
    expect(roleHasPermission("moderator", "members.manage")).toBe(false);
    expect(roleHasPermission("owner", "members.manage")).toBe(true);
  });
});
