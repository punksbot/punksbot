import { describe, expect, it } from "vitest";

import {
  decodeWorkspaceGovernanceCursor,
  encodeWorkspaceGovernanceCursor,
} from "../src";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const requesterPunkId = "00000000-0000-8000-8000-000000000001";
const positionPunkId = "00000000-0000-8000-8000-000000000100";
const key = new TextEncoder().encode("g".repeat(32));

describe("Workspace governance cursor", () => {
  it("round-trips one authority-bound roster position", async () => {
    const encoded = await encodeWorkspaceGovernanceCursor(
      {
        version: 1,
        workspaceId,
        requesterPunkId,
        limit: 100,
        authorityCursor: 41,
        positionPunkId,
      },
      key,
    );

    expect(encoded).toMatch(/^pmc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u);
    await expect(
      decodeWorkspaceGovernanceCursor(
        encoded,
        { workspaceId, requesterPunkId, limit: 100 },
        key,
      ),
    ).resolves.toEqual({
      version: 1,
      workspaceId,
      requesterPunkId,
      limit: 100,
      authorityCursor: 41,
      positionPunkId,
    });
  });

  it("rejects tampering and every cross-Punk or cross-Workspace replay", async () => {
    const encoded = await encodeWorkspaceGovernanceCursor(
      {
        version: 1,
        workspaceId,
        requesterPunkId,
        limit: 100,
        authorityCursor: 41,
        positionPunkId,
      },
      key,
    );
    const invalid = [
      `${encoded.slice(0, -1)}${encoded.endsWith("A") ? "B" : "A"}`,
      encoded,
      encoded,
      encoded,
    ];
    const scopes = [
      { workspaceId, requesterPunkId, limit: 100 },
      {
        workspaceId: "58975ca8-3b75-42c7-a13a-51c9d7306201",
        requesterPunkId,
        limit: 100,
      },
      {
        workspaceId,
        requesterPunkId: "00000000-0000-8000-8000-000000000002",
        limit: 100,
      },
      { workspaceId, requesterPunkId, limit: 99 },
    ];
    for (const [index, cursor] of invalid.entries()) {
      const scope = scopes[index];
      if (scope === undefined) {
        throw new TypeError("Missing Workspace governance cursor test scope");
      }
      await expect(
        decodeWorkspaceGovernanceCursor(cursor, scope, key),
      ).rejects.toThrow("Invalid Workspace governance cursor");
    }
  });

  it("refuses non-authoritative coordinates before signing", async () => {
    await expect(
      encodeWorkspaceGovernanceCursor(
        {
          version: 1,
          workspaceId,
          requesterPunkId,
          limit: 100,
          authorityCursor: 0,
          positionPunkId,
        },
        key,
      ),
    ).rejects.toThrow("Invalid Workspace governance cursor input");
  });
});
