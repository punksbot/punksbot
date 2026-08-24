import type {
  AttestationResponse,
  ArchiveConversationCommand,
  ConversationJournalSegmentArchive,
  CreateConversationCommand,
  CreateWorkspaceCommand,
  RemoveConversationMemberCommand,
  SignedNostrEvent,
  UnsignedNostrEvent,
  UpdateConversationCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  prepareConversationJournalSegment,
  verifyConversationJournalSegmentHash,
} from "@punks/core";
import {
  env,
  evictDurableObject,
  runInDurableObject,
  SELF,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

const authorization = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
const ownerPunkId = "00000000-0000-8000-8000-000000000001";

async function createConversationFixture(options: {
  workspaceCommandId: string;
  conversationCommandId: string;
  slug: string;
}): Promise<{ workspaceId: string; conversationId: string }> {
  const workspaceCommand: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: options.workspaceCommandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: options.slug,
      name: "Conversation Journal Test",
      visibility: "private",
    },
  };
  const workspaceResponse = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": workspaceCommand.commandId,
      },
      body: JSON.stringify(workspaceCommand),
    },
  );
  expect(workspaceResponse.status).toBe(201);
  const workspaceId = (
    (await workspaceResponse.json()) as { workspace: { id: string } }
  ).workspace.id;

  const conversationCommand: CreateConversationCommand = {
    contract: "conversation.create@1",
    commandId: options.conversationCommandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      name: options.slug,
      type: "stream",
      visibility: "open",
    },
  };
  const conversationResponse = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": conversationCommand.commandId,
      },
      body: JSON.stringify(conversationCommand),
    },
  );
  expect(conversationResponse.status).toBe(201);
  const conversationId = (
    (await conversationResponse.json()) as { conversation: { id: string } }
  ).conversation.id;
  return { workspaceId, conversationId };
}

async function seedSecondHotEvent(conversationId: string): Promise<void> {
  const stub = env.CONVERSATIONS.getByName(conversationId);
  await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAlarm();
    const first = state.storage.sql
      .exec<Record<"event_json", string>>(
        "SELECT event_json FROM journal WHERE cursor = 1",
      )
      .one();
    const event = JSON.parse(first.event_json) as SignedNostrEvent;
    const tags: SignedNostrEvent["tags"] = event.tags.map(
      ([name, ...values]) =>
        name === "cursor" ? ["cursor", "2"] : [name, ...values],
    );
    const second: SignedNostrEvent = {
      ...event,
      id: "f".repeat(64),
      created_at: event.created_at + 1,
      kind: 50101,
      tags,
    };
    state.storage.sql.exec(
      `INSERT INTO journal (cursor, event_id, event_kind, event_json, committed_at)
       VALUES (2, ?, ?, ?, ?)`,
      second.id,
      second.kind,
      JSON.stringify(second),
      new Date().toISOString(),
    );
  });
}

async function commitSecondConversationEvent(
  workspaceId: string,
  conversationId: string,
  commandId: string,
): Promise<void> {
  const command: UpdateConversationCommand = {
    contract: "conversation.update@1",
    commandId,
    workspaceId,
    conversationId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { description: "Second hot Conversation event" },
  };
  await expect(
    env.CONVERSATIONS.getByName(conversationId).execute(command),
  ).resolves.toMatchObject({ ok: true });
}

async function localCounts(conversationId: string) {
  return runInDurableObject(
    env.CONVERSATIONS.getByName(conversationId),
    (_instance, state) => ({
      hot: state.storage.sql
        .exec<Record<"count", number>>("SELECT COUNT(*) AS count FROM journal")
        .one().count,
      archived: state.storage.sql
        .exec<Record<"count", number>>(
          "SELECT COUNT(*) AS count FROM archive_segments",
        )
        .one().count,
      pending: state.storage.sql
        .exec<Record<"count", number>>(
          "SELECT COUNT(*) AS count FROM pending_archive",
        )
        .one().count,
    }),
  );
}

async function setArchiveAttestationFailure(reject: boolean): Promise<void> {
  const response = await env.ATTESTATION.fetch(
    "https://fixture/__test/archive-failure",
    { method: "POST", body: JSON.stringify({ reject }) },
  );
  expect(response.ok).toBe(true);
}

describe("ConversationDO sealed journal", () => {
  it("rearms an evicted archive-ready Conversation without a pending archive", async () => {
    const { workspaceId, conversationId } = await createConversationFixture({
      workspaceCommandId: "11000000-0000-4000-8000-000000000001",
      conversationCommandId: "11000000-0000-4000-8000-000000000002",
      slug: "conversation-journal-eviction-repair",
    });
    await setArchiveAttestationFailure(true);
    try {
      await commitSecondConversationEvent(
        workspaceId,
        conversationId,
        "11000000-0000-4000-8000-000000000003",
      );
      const stub = env.CONVERSATIONS.getByName(conversationId);
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec("DELETE FROM pending_archive");
        state.storage.sql.exec("DELETE FROM pending_archive_seals");
        await state.storage.deleteAlarm();
        expect(
          state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
            .one().count,
        ).toBe(2);
      });

      await evictDurableObject(stub);

      await runInDurableObject(stub, async (_instance, state) => {
        await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      });
      await setArchiveAttestationFailure(false);
    } finally {
      await setArchiveAttestationFailure(false);
    }
  });

  it("blocks ordinary mutations at capacity but still commits a Conversation archive", async () => {
    const { workspaceId, conversationId } = await createConversationFixture({
      workspaceCommandId: "12000000-0000-4000-8000-000000000001",
      conversationCommandId: "12000000-0000-4000-8000-000000000002",
      slug: "conversation-journal-capacity",
    });
    const stub = env.CONVERSATIONS.getByName(conversationId);
    await setArchiveAttestationFailure(true);
    try {
      await commitSecondConversationEvent(
        workspaceId,
        conversationId,
        "12000000-0000-4000-8000-000000000005",
      );
      const update: UpdateConversationCommand = {
        contract: "conversation.update@1",
        commandId: "12000000-0000-4000-8000-000000000003",
        workspaceId,
        conversationId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { name: "Must remain blocked" },
      };
      await expect(stub.execute(update)).resolves.toEqual({
        ok: false,
        code: "internal",
      });

      const archive: ArchiveConversationCommand = {
        contract: "conversation.archive@1",
        commandId: "12000000-0000-4000-8000-000000000004",
        workspaceId,
        conversationId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { cause: "manual" },
      };
      await expect(stub.execute(archive)).resolves.toMatchObject({
        ok: true,
        value: { state: { status: "archived" } },
      });
      await expect(localCounts(conversationId)).resolves.toMatchObject({
        hot: 3,
        archived: 0,
      });
    } finally {
      await setArchiveAttestationFailure(false);
    }
  });

  it("makes a pending Conversation access removal effective and rejects forged overlays", async () => {
    const { workspaceId, conversationId } = await createConversationFixture({
      workspaceCommandId: "14000000-0000-4000-8000-000000000001",
      conversationCommandId: "14000000-0000-4000-8000-000000000002",
      slug: "conversation-access-reduction-overlay",
    });
    const otherPunkId = "00000000-0000-8000-8000-000000000002";
    const stub = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM conversation_state WHERE singleton = 1",
        )
        .one();
      const conversation = JSON.parse(row.state_json) as {
        members: Array<{
          punkId: string;
          access: string;
          joinedAt: string;
          invitedByPunkId: string | null;
        }>;
      };
      conversation.members.push({
        punkId: otherPunkId,
        access: "manager",
        joinedAt: new Date().toISOString(),
        invitedByPunkId: ownerPunkId,
      });
      state.storage.sql.exec(
        "UPDATE conversation_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(conversation),
      );
    });
    const remove: RemoveConversationMemberCommand = {
      contract: "conversation.member-remove@1",
      commandId: "dfcb14f1-c2b7-8119-bf0c-9d545adee869",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { targetPunkId: otherPunkId },
    };
    await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/__test/fail-once", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: remove.commandId }),
      }),
    );
    await expect(stub.execute(remove)).resolves.toEqual({
      ok: false,
      code: "attestation_failed",
    });
    await expect(
      stub.query({
        contract: "conversation.get@1",
        workspaceId,
        conversationId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        members: [{ punkId: ownerPunkId, access: "owner" }],
      },
    });
    await expect(
      stub.authorizeBotGrant({
        workspaceId,
        conversationId,
        punkId: otherPunkId,
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });

    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ next_state_json: string; unsigned_json: string }>(
          `SELECT next_state_json, unsigned_json FROM pending_command
           WHERE singleton = 1`,
        )
        .one();
      const forged = JSON.parse(row.next_state_json) as {
        members: Array<{
          punkId: string;
          access: string;
          joinedAt: string;
          invitedByPunkId: string | null;
        }>;
      };
      forged.members.push({
        punkId: otherPunkId,
        access: "manager",
        joinedAt: new Date().toISOString(),
        invitedByPunkId: ownerPunkId,
      });
      const unsigned = JSON.parse(row.unsigned_json) as UnsignedNostrEvent;
      unsigned.tags.push(["unexpected", "tag"]);
      state.storage.sql.exec(
        `UPDATE pending_command
         SET next_state_json = ?, unsigned_json = ? WHERE singleton = 1`,
        JSON.stringify(forged),
        JSON.stringify(unsigned),
      );
    });
    await expect(
      stub.query({
        contract: "conversation.get@1",
        workspaceId,
        conversationId,
      }),
    ).resolves.toEqual({ ok: false, code: "not_found" });
  });

  it("seals old hot events into an aggregate-bound R2 segment", async () => {
    const { workspaceId, conversationId } = await createConversationFixture({
      workspaceCommandId: "2f86d3eb-e0de-405f-8b8c-069a8bc907f5",
      conversationCommandId: "90f83db0-e2ac-4391-86ca-174347c8daac",
      slug: "conversation-journal",
    });
    await seedSecondHotEvent(conversationId);

    await runInDurableObject(
      env.CONVERSATIONS.getByName(conversationId),
      async (instance) => {
        expect(instance.alarm).toBeTypeOf("function");
        await instance.alarm?.();
      },
    );

    const prefix = `workspaces/${workspaceId}/conversations/${conversationId}/journal/`;
    const archived = await env.JOURNAL_ARCHIVE_BUCKET.list({ prefix });
    expect(archived.objects).toHaveLength(1);
    const object = await env.JOURNAL_ARCHIVE_BUCKET.get(
      archived.objects[0]?.key ?? "",
    );
    expect(object).not.toBeNull();
    const segment = (await object?.json()) as ConversationJournalSegmentArchive;
    expect(
      validateContract(
        "punks://contracts/conversation.journal-segment@1",
        segment,
      ),
    ).toEqual({ valid: true });
    expect(segment).toMatchObject({
      workspaceId,
      conversationId,
      startCursor: 1,
      endCursor: 1,
      previousSegmentHash: null,
      seal: { kind: 50104 },
    });
    expect(await verifyConversationJournalSegmentHash(segment)).toBe(true);
    expect(object?.customMetadata).toMatchObject({
      workspaceId,
      conversationId,
      segmentHash: segment.segmentHash,
    });
    await expect(localCounts(conversationId)).resolves.toEqual({
      hot: 1,
      archived: 1,
      pending: 0,
    });
  });

  it("recovers idempotently after R2 was written but local finalization crashed", async () => {
    const { workspaceId, conversationId } = await createConversationFixture({
      workspaceCommandId: "187bca90-c006-4e32-8ca0-a9ca1e5b19e4",
      conversationCommandId: "143813bd-8669-4162-82f9-cf7dd6c2e901",
      slug: "conversation-journal-recovery",
    });
    await seedSecondHotEvent(conversationId);

    const stub = env.CONVERSATIONS.getByName(conversationId);
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });
    const head = await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
      const row = state.storage.sql
        .exec<Record<"cursor" | "event_json", string | number>>(
          "SELECT cursor, event_json FROM journal ORDER BY cursor LIMIT 1",
        )
        .one();
      return {
        cursor: Number(row.cursor),
        event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
        previousSegmentHash: state.storage.sql
          .exec<Record<"segment_hash", string>>(
            "SELECT segment_hash FROM archive_segments ORDER BY end_cursor DESC LIMIT 1",
          )
          .one().segment_hash,
      };
    });
    const draft = await prepareConversationJournalSegment(
      workspaceId,
      conversationId,
      [{ cursor: head.cursor, event: head.event }],
      head.previousSegmentHash,
      new Date("2026-08-20T14:00:00.000Z"),
    );
    const attestationResponse = await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/internal/v1/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "conversation-journal-segment",
          event: draft.unsignedSeal,
        }),
      }),
    );
    expect(attestationResponse.status).toBe(200);
    const seal = ((await attestationResponse.json()) as AttestationResponse)
      .event;
    const archive: ConversationJournalSegmentArchive = {
      schemaVersion: 1,
      workspaceId,
      conversationId,
      startCursor: draft.startCursor,
      endCursor: draft.endCursor,
      previousSegmentHash: draft.previousSegmentHash,
      segmentHash: draft.segmentHash,
      events: draft.events as ConversationJournalSegmentArchive["events"],
      seal: { ...seal, kind: 50104 },
    };
    const objectKey = `workspaces/${workspaceId}/conversations/${conversationId}/journal/${draft.startCursor}-${draft.endCursor}-${draft.segmentHash}.json`;

    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
      state.storage.sql.exec(
        `UPDATE projection_delivery_state
         SET enqueued_through_cursor = ? WHERE singleton = 1`,
        draft.endCursor,
      );
      state.storage.sql.exec(
        `INSERT INTO pending_archive
          (singleton, start_cursor, end_cursor, previous_segment_hash, segment_hash,
           object_key, events_json, unsigned_seal_json, attempts, created_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        draft.startCursor,
        draft.endCursor,
        draft.previousSegmentHash,
        draft.segmentHash,
        objectKey,
        JSON.stringify(draft.events),
        JSON.stringify(draft.unsignedSeal),
        new Date().toISOString(),
      );
    });
    const exactMetadata = {
      workspaceId,
      conversationId,
      segmentHash: archive.segmentHash,
      startCursor: String(archive.startCursor),
      endCursor: String(archive.endCursor),
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(objectKey, canonicalJson(archive), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        ...exactMetadata,
        conversationId: "143813bd-8669-4162-82f9-cf7dd6c2e999",
      },
    });

    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });
    await expect(localCounts(conversationId)).resolves.toEqual({
      hot: 1,
      archived: 1,
      pending: 1,
    });

    const invalidSignature: ConversationJournalSegmentArchive = {
      ...archive,
      seal: { ...archive.seal, sig: "0".repeat(128) },
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      objectKey,
      canonicalJson(invalidSignature),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: exactMetadata,
      },
    );
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });
    await expect(localCounts(conversationId)).resolves.toEqual({
      hot: 1,
      archived: 1,
      pending: 1,
    });

    await env.JOURNAL_ARCHIVE_BUCKET.put(
      objectKey,
      ` ${canonicalJson(archive)}`,
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: exactMetadata,
      },
    );
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });
    await expect(localCounts(conversationId)).resolves.toEqual({
      hot: 1,
      archived: 1,
      pending: 1,
    });

    await env.JOURNAL_ARCHIVE_BUCKET.put(objectKey, canonicalJson(archive), {
      httpMetadata: { contentType: "application/json" },
      customMetadata: exactMetadata,
    });
    await runInDurableObject(stub, async (instance) => {
      await instance.alarm?.();
    });

    const objects = await env.JOURNAL_ARCHIVE_BUCKET.list({
      prefix: `workspaces/${workspaceId}/conversations/${conversationId}/journal/`,
    });
    expect(objects.objects).toHaveLength(2);
    expect(objects.objects.filter(({ key }) => key === objectKey)).toHaveLength(
      1,
    );
    await expect(localCounts(conversationId)).resolves.toEqual({
      hot: 0,
      archived: 2,
      pending: 0,
    });
    const recovered = await env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
    await expect(recovered?.json()).resolves.toEqual(archive);
  });
});
