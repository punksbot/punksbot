import { isStrictWorkspaceRoleReduction } from "../src/permissions";
import { describe, expect, it } from "vitest";

describe("Workspace role authority reductions", () => {
  it.each([
    ["owner", "moderator", true],
    ["moderator", "member", true],
    ["member", "guest", true],
    ["owner", "guest", true],
    ["guest", "member", false],
    ["member", "member", false],
    ["moderator", "owner", false],
  ] as const)("classifies %s -> %s as strict-subset=%s", (currentRole, nextRole, expected) => {
    expect(isStrictWorkspaceRoleReduction(currentRole, nextRole)).toBe(
      expected,
    );
  });
});
