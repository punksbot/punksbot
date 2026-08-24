import { describe, expect, it } from "vitest";

import { canonicalJson, deriveOpaqueUuid } from "../src";

describe("canonicalJson", () => {
  it("sorts keys recursively without changing array order", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: [3, 2, 1] } })).toBe(
      '{"a":{"b":[3,2,1],"y":true},"z":1}',
    );
  });

  it("rejects values JSON cannot sign consistently", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow("non-finite");
  });
});

describe("deriveOpaqueUuid", () => {
  it("derives a stable version-8 UUID without exposing the source id", async () => {
    const first = await deriveOpaqueUuid("punks.workspace.v1", "command-1");
    const replay = await deriveOpaqueUuid("punks.workspace.v1", "command-1");
    const another = await deriveOpaqueUuid("punks.workspace.v1", "command-2");
    expect(first).toBe(replay);
    expect(first).not.toBe(another);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first).not.toContain("command");
  });
});
