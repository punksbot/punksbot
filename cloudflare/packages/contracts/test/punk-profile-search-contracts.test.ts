import { describe, expect, it } from "vitest";

import desktopProfile from "../profiles/desktop-social-loop@1.json";
import { validateContract } from "../src/registry";

const workspaceId = "22222222-2222-4222-8222-222222222222";
const punkId = "11111111-1111-4111-8111-111111111111";

function valid(contract: string, payload: unknown): boolean {
  return validateContract(contract as never, payload).valid;
}

describe("Punk profile and private search contracts", () => {
  it("allows only the self-editable fields with an explicit revision", () => {
    const update = {
      contract: "punk.update@1",
      commandId: "33333333-3333-4333-8333-333333333333",
      expectedRevision: 4,
      displayName: "Mélanie",
      avatarUrl: "https://images.example/melanie.png",
    };

    expect(valid("punks://contracts/punk.update@1", update)).toBe(true);
    expect(
      valid("punks://contracts/punk.update@1", {
        ...update,
        identities: [],
      }),
    ).toBe(false);
    expect(
      valid("punks://contracts/punk.update@1", {
        ...update,
        avatarUrl: "http://images.example/melanie.png",
      }),
    ).toBe(false);
    expect(
      valid("punks://contracts/punk.update@1", {
        ...update,
        expectedRevision: 0,
      }),
    ).toBe(false);
  });

  it("closes prefix and exact-id search without an enumerable empty query", () => {
    const prefix = {
      contract: "punk.search@1",
      workspaceId,
      query: { kind: "prefix", value: "mél" },
      limit: 10,
      cursor: null,
    };
    const exact = {
      ...prefix,
      query: { kind: "punk_id", punkId },
      limit: 1,
    };

    expect(valid("punks://contracts/punk.search@1", prefix)).toBe(true);
    expect(valid("punks://contracts/punk.search@1", exact)).toBe(true);
    expect(
      valid("punks://contracts/punk.search@1", {
        ...prefix,
        query: { kind: "prefix", value: "mé" },
      }),
    ).toBe(false);
    expect(
      valid("punks://contracts/punk.search@1", {
        ...prefix,
        query: { kind: "prefix", value: "" },
      }),
    ).toBe(false);
    expect(
      valid("punks://contracts/punk.search@1", { ...prefix, limit: 21 }),
    ).toBe(false);
  });

  it("returns only bounded summaries and an opaque continuation", () => {
    const response = {
      contract: "punk.search-response@1",
      workspaceId,
      items: [
        {
          punkId,
          displayName: "Mélanie",
          avatarUrl: null,
        },
      ],
      nextCursor: null,
    };

    expect(valid("punks://contracts/punk.search-response@1", response)).toBe(
      true,
    );
    expect(
      valid("punks://contracts/punk.search-response@1", {
        ...response,
        total: 1,
      }),
    ).toBe(false);
  });

  it("registers the four semantic operations without claiming full governance", () => {
    expect(desktopProfile.capabilities).toEqual(
      expect.arrayContaining([
        "punk-profile",
        "bounded-punk-summaries",
        "private-punk-search",
      ]),
    );
    expect(desktopProfile.operations.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "getPunkProfile",
        "updatePunkProfile",
        "getPunkSummaries",
        "searchPunks",
      ]),
    );
    expect(desktopProfile.unavailableCapabilities).toContain(
      "identity-governance",
    );
  });
});
