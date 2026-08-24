import { describe, expect, it } from "vitest";

import {
  decodeDirectoryCursor,
  encodeDirectoryCursor,
} from "../src/directory-cursor";

const key = new TextEncoder().encode(
  "directory-cursor-test-key-material-with-at-least-32-bytes",
);
const punkId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const positionId = "33333333-3333-4333-8333-333333333333";

describe("directory cursor", () => {
  it("round-trips an opaque Workspace-bound Stream position", async () => {
    const encoded = await encodeDirectoryCursor(
      {
        version: 1,
        kind: "streams",
        punkId,
        workspaceId,
        positionId,
      },
      key,
    );

    expect(encoded).toMatch(/^pdc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    await expect(
      decodeDirectoryCursor(
        encoded,
        { kind: "streams", punkId, workspaceId },
        key,
      ),
    ).resolves.toEqual({
      version: 1,
      kind: "streams",
      punkId,
      workspaceId,
      positionId,
    });
  });

  it("rejects tampering and replay in another scope", async () => {
    const encoded = await encodeDirectoryCursor(
      { version: 1, kind: "workspaces", punkId, positionId },
      key,
    );
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("A") ? "B" : "A"}`;

    await expect(
      decodeDirectoryCursor(tampered, { kind: "workspaces", punkId }, key),
    ).rejects.toThrow("Invalid directory cursor");
    await expect(
      decodeDirectoryCursor(
        encoded,
        {
          kind: "workspaces",
          punkId: "99999999-9999-4999-8999-999999999999",
        },
        key,
      ),
    ).rejects.toThrow("Invalid directory cursor");
  });

  it("requires a Workspace exactly for Stream cursors", async () => {
    await expect(
      encodeDirectoryCursor(
        { version: 1, kind: "streams", punkId, positionId },
        key,
      ),
    ).rejects.toThrow("Invalid directory cursor input");
    await expect(
      encodeDirectoryCursor(
        {
          version: 1,
          kind: "workspaces",
          punkId,
          workspaceId,
          positionId,
        },
        key,
      ),
    ).rejects.toThrow("Invalid directory cursor input");
  });
});
