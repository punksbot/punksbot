import { describe, expect, it } from "vitest";

import {
  canonicalPunkDisplayName,
  canonicalPunkSearchPrefix,
  decodePunkSearchCursor,
  derivePunkSearchQueryBinding,
  encodePunkSearchCursor,
  PUNK_SEARCH_MAX_RESULTS,
} from "../src/punk-search";

const key = new TextEncoder().encode(
  "punk-search-cursor-test-key-material-with-at-least-32-bytes",
);
const requesterPunkId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const positionPunkId = "33333333-3333-4333-8333-333333333333";

describe("private Punk search", () => {
  it("canonicalizes editable names and requires a constrained prefix", () => {
    expect(canonicalPunkDisplayName("  Me\u0301lanie  ")).toBe("Mélanie");
    expect(canonicalPunkSearchPrefix("  MÉL  ")).toBe("mél");
    expect(() => canonicalPunkSearchPrefix("mé")).toThrow("Punk search prefix");
    expect(() => canonicalPunkDisplayName("   ")).toThrow("Punk display name");
  });

  it("round-trips an opaque cursor bound to Punk, Workspace, query and limit", async () => {
    const queryBinding = await derivePunkSearchQueryBinding(
      { requesterPunkId, workspaceId, prefix: "mél" },
      key,
    );
    const scope = { requesterPunkId, workspaceId, queryBinding, limit: 10 };
    const encoded = await encodePunkSearchCursor(
      {
        version: 1,
        ...scope,
        positionPunkId,
        remaining: PUNK_SEARCH_MAX_RESULTS - 10,
      },
      key,
    );

    expect(encoded).toMatch(/^psc1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/u);
    expect(encoded).not.toContain(requesterPunkId);
    expect(encoded).not.toContain(workspaceId);
    await expect(decodePunkSearchCursor(encoded, scope, key)).resolves.toEqual({
      version: 1,
      ...scope,
      positionPunkId,
      remaining: PUNK_SEARCH_MAX_RESULTS - 10,
    });
  });

  it("rejects tampering and transplanting a continuation", async () => {
    const queryBinding = await derivePunkSearchQueryBinding(
      { requesterPunkId, workspaceId, prefix: "mel" },
      key,
    );
    const scope = { requesterPunkId, workspaceId, queryBinding, limit: 10 };
    const encoded = await encodePunkSearchCursor(
      {
        version: 1,
        ...scope,
        positionPunkId,
        remaining: 20,
      },
      key,
    );
    const tampered = `${encoded.slice(0, -1)}${encoded.endsWith("A") ? "B" : "A"}`;

    await expect(decodePunkSearchCursor(tampered, scope, key)).rejects.toThrow(
      "Invalid Punk search cursor",
    );
    await expect(
      decodePunkSearchCursor(
        encoded,
        {
          ...scope,
          workspaceId: "99999999-9999-4999-8999-999999999999",
        },
        key,
      ),
    ).rejects.toThrow("Invalid Punk search cursor");
    await expect(
      decodePunkSearchCursor(encoded, { ...scope, limit: 5 }, key),
    ).rejects.toThrow("Invalid Punk search cursor");
  });
});
