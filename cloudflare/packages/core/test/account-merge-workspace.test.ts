import type { Workspace } from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  decideApplyAccountMergeToWorkspaceV2,
  PUNKS_EVENT_KINDS,
  WorkspaceDomainError,
} from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000061";
const survivorPunkId = "20000000-0000-8000-8000-000000000061";
const absorbedPunkId = "30000000-0000-8000-8000-000000000061";
const planId = "40000000-0000-8000-8000-000000000061";
const receiptId = "50000000-0000-8000-8000-000000000061";
const commitCommandId = "60000000-0000-8000-8000-000000000061";

function workspace(): Workspace {
  return {
    id: workspaceId,
    slug: "merge-workspace",
    name: "Merge Workspace",
    visibility: "private",
    status: "active",
    ownerPunkId: absorbedPunkId,
    members: [
      { punkId: absorbedPunkId, role: "owner" },
      { punkId: survivorPunkId, role: "member" },
    ],
    revision: 7,
    cursor: 12,
    createdAt: "2031-01-01T00:00:00.000Z",
    updatedAt: "2031-02-01T00:00:00.000Z",
  };
}

describe("Workspace account-merge decision", () => {
  it("moves current authority to the survivor without rewriting prior membership", async () => {
    const decision = await decideApplyAccountMergeToWorkspaceV2(
      workspace(),
      {
        workspaceId,
        planId,
        receiptId,
        commitCommandId,
        survivorPunkId,
        absorbedPunkId,
        expectedRevision: 7,
        survivorRole: "member",
        absorbedRole: "owner",
        resultingRole: "owner",
      },
      {
        workspaceId,
        cursor: 13,
        now: new Date("2032-01-01T00:00:00.000Z"),
      },
    );

    expect(decision.nextState).toMatchObject({
      ownerPunkId: survivorPunkId,
      revision: 8,
      cursor: 13,
      members: [{ punkId: survivorPunkId, role: "owner" }],
    });
    expect(decision.event.kind).toBe(PUNKS_EVENT_KINDS.workspaceAccountMerged);
    expect(decision.event.tags).toContainEqual(["plan", planId]);
    expect(decision.event.tags).toContainEqual(["receipt", receiptId]);
    expect(decision.membershipProjection.chunks[0]?.memberDeltas).toEqual([
      { punkId: absorbedPunkId, present: false, role: "owner" },
      { punkId: survivorPunkId, present: true, role: "owner" },
    ]);
  });

  it("rejects a stale role or revision before producing any effect", async () => {
    await expect(
      decideApplyAccountMergeToWorkspaceV2(
        workspace(),
        {
          workspaceId,
          planId,
          receiptId,
          commitCommandId,
          survivorPunkId,
          absorbedPunkId,
          expectedRevision: 6,
          survivorRole: "moderator",
          absorbedRole: "owner",
          resultingRole: "owner",
        },
        {
          workspaceId,
          cursor: 13,
          now: new Date("2032-01-01T00:00:00.000Z"),
        },
      ),
    ).rejects.toBeInstanceOf(WorkspaceDomainError);
  });
});
