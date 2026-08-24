import { describe, expect, it } from "vitest";

import { validateContract } from "../src/registry";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
const digest = "a".repeat(64);

function signedEvent(kind: number, content: object) {
  return {
    id: "1".repeat(64),
    pubkey: "2".repeat(64),
    created_at: 1_787_230_800,
    kind,
    tags: [["workspace", workspaceId]],
    content: JSON.stringify(content),
    sig: "3".repeat(128),
  };
}

function commitment(deltaCount: number) {
  return {
    algorithm: "sha256-canonical-json",
    deltaDigest: digest,
    deltaCount,
    chunkCount: 1,
    chunkDigests: [digest],
  };
}

const workspaceEventContent = {
  schemaVersion: 2,
  workspace: {
    id: workspaceId,
    slug: "engineering",
    name: "Engineering",
    visibility: "private",
    status: "active",
    ownerPunkId: "punk_owner",
    memberCount: 1,
    revision: 1,
    cursor: 1,
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
  },
  transition: { type: "created" },
  membershipCommitment: commitment(1),
};

const conversationEventContent = {
  schemaVersion: 2,
  conversation: {
    id: conversationId,
    workspaceId,
    name: "General",
    type: "stream",
    visibility: "private",
    description: null,
    topic: null,
    purpose: null,
    topicRequired: false,
    maxMembers: 1000,
    ttlSeconds: null,
    ttlDeadline: null,
    ownerPunkId: "punk_owner",
    memberCount: 1,
    status: "active",
    revision: 1,
    cursor: 1,
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
    archivedAt: null,
  },
  transition: { type: "created" },
  membershipCommitment: commitment(1),
};

describe("membership delta projection v2 contracts", () => {
  it("accepts a strict Workspace event commitment and tombstone chunk", () => {
    expect(
      validateContract(
        "punks://contracts/workspace.event@2",
        workspaceEventContent,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/workspace.event@2", {
        ...workspaceEventContent,
        workspace: { ...workspaceEventContent.workspace, members: [] },
      }).valid,
    ).toBe(false);

    const projection = {
      schemaVersion: 2,
      workspaceId,
      cursor: 1,
      chunkIndex: 0,
      chunkCount: 1,
      chunkDigest: digest,
      memberDeltas: [
        {
          punkId: "punk_guest",
          present: false,
          role: "guest",
        },
      ],
      event: signedEvent(50004, workspaceEventContent),
    };
    expect(
      validateContract("punks://contracts/workspace.projection@2", projection),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/workspace.projection@2", {
        ...projection,
        state: { members: [] },
      }).valid,
    ).toBe(false);
  });

  it("accepts a self-contained Conversation tombstone and rejects snapshots", () => {
    expect(
      validateContract(
        "punks://contracts/conversation.event@2",
        conversationEventContent,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/conversation.event@2", {
        ...conversationEventContent,
        initialMembers: [],
      }).valid,
    ).toBe(false);

    const projection = {
      schemaVersion: 2,
      workspaceId,
      conversationId,
      cursor: 1,
      chunkIndex: 0,
      chunkCount: 1,
      chunkDigest: digest,
      memberDeltas: [
        {
          punkId: "punk_guest",
          present: false,
          access: "guest",
          joinedAt: "2026-08-21T10:00:00.000Z",
          invitedByPunkId: "punk_owner",
        },
      ],
      event: signedEvent(50103, conversationEventContent),
    };
    expect(
      validateContract(
        "punks://contracts/conversation.projection@2",
        projection,
      ),
    ).toEqual({ valid: true });
    expect(
      validateContract("punks://contracts/conversation.projection@2", {
        ...projection,
        initialMembers: projection.memberDeltas,
      }).valid,
    ).toBe(false);
  });

  it("bounds chunks and rejects non-self-contained deltas", () => {
    const baseProjection = {
      schemaVersion: 2,
      workspaceId,
      conversationId,
      cursor: 1,
      chunkIndex: 0,
      chunkCount: 1,
      chunkDigest: digest,
      event: signedEvent(50103, conversationEventContent),
    };
    const incomplete = {
      ...baseProjection,
      memberDeltas: [
        {
          punkId: "punk_guest",
          present: false,
          access: "guest",
        },
      ],
    };
    expect(
      validateContract(
        "punks://contracts/conversation.projection@2",
        incomplete,
      ).valid,
    ).toBe(false);
    const validDelta = {
      punkId: "punk_guest",
      present: false,
      access: "guest",
      joinedAt: "2026-08-21T10:00:00.000Z",
      invitedByPunkId: null,
    };
    expect(
      validateContract("punks://contracts/conversation.projection@2", {
        ...baseProjection,
        chunkCount: 65,
        memberDeltas: [validDelta],
      }).valid,
    ).toBe(false);
    expect(
      validateContract("punks://contracts/conversation.projection@2", {
        ...baseProjection,
        memberDeltas: Array.from({ length: 101 }, (_, index) => ({
          ...validDelta,
          punkId: `punk_${index}`,
        })),
      }).valid,
    ).toBe(false);
  });

  it("keeps v1 projections strict and unchanged", () => {
    const v1WithV2Fields = {
      schemaVersion: 1,
      workspaceId,
      cursor: 1,
      chunkIndex: 0,
      chunkCount: 1,
      chunkDigest: digest,
      memberDeltas: [],
      event: signedEvent(50000, workspaceEventContent),
    };
    expect(
      validateContract(
        "punks://contracts/workspace.projection@1",
        v1WithV2Fields,
      ).valid,
    ).toBe(false);
  });
});
