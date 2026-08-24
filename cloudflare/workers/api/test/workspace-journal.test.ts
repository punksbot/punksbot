import type {
  AttestationResponse,
  CreateWorkspaceCommand,
  JournalSegmentArchive,
  RenameWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
  SignedNostrEvent,
  UnsignedNostrEvent,
  Workspace,
} from "@punks/contracts";
import { canonicalJson, prepareJournalSegment } from "@punks/core";
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
const otherPunkId = "00000000-0000-8000-8000-000000000002";

interface PendingArchive {
  workspaceId: string;
  objectKey: string;
  archive: JournalSegmentArchive;
  unsignedSeal: UnsignedNostrEvent;
}

async function createWorkspaceWithTwoEvents(options: {
  createCommandId: string;
  renameCommandId: string;
  slug: string;
}): Promise<string> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: options.createCommandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: options.slug,
      name: "Workspace Journal Test",
      visibility: "private",
    },
  };
  const created = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(created.status).toBe(201);
  const workspaceId = ((await created.json()) as { workspace: { id: string } })
    .workspace.id;
  const rename = {
    contract: "workspace.rename@1",
    commandId: options.renameCommandId,
    workspaceId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: { slug: `${options.slug}-renamed` },
  } as const;
  const renamed = await SELF.fetch(
    `https://punks.bot/api/internal/v1/workspaces/${workspaceId}/slug`,
    {
      method: "PATCH",
      headers: {
        ...authorization,
        "content-type": "application/json",
        "idempotency-key": rename.commandId,
      },
      body: JSON.stringify(rename),
    },
  );
  expect(renamed.status).toBe(200);
  return workspaceId;
}

async function preparePendingArchive(
  workspaceId: string,
): Promise<PendingArchive> {
  const stub = env.WORKSPACES.getByName(workspaceId);
  const draft = await runInDurableObject(stub, async (_instance, state) => {
    await state.storage.deleteAlarm();
    const row = state.storage.sql
      .exec<Record<"cursor" | "event_json", string | number>>(
        "SELECT cursor, event_json FROM journal ORDER BY cursor LIMIT 1",
      )
      .one();
    const previousSegmentHash =
      state.storage.sql
        .exec<{ segment_hash: string }>(
          `SELECT segment_hash FROM archive_segments
           ORDER BY end_cursor DESC LIMIT 1`,
        )
        .toArray()[0]?.segment_hash ?? null;
    return prepareJournalSegment(
      workspaceId,
      [
        {
          cursor: Number(row.cursor),
          event: JSON.parse(String(row.event_json)) as SignedNostrEvent,
        },
      ],
      previousSegmentHash,
      new Date("2026-08-21T15:00:00.000Z"),
    );
  });
  const attestationResponse = await env.ATTESTATION.fetch(
    new Request("https://punks-attestation.invalid/internal/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "workspace-journal-segment",
        event: draft.unsignedSeal,
      }),
    }),
  );
  expect(attestationResponse.status).toBe(200);
  const seal = ((await attestationResponse.json()) as AttestationResponse)
    .event;
  const firstEvent = draft.events[0];
  if (firstEvent === undefined) {
    throw new Error("Workspace journal draft must contain an event");
  }
  const archive: JournalSegmentArchive = {
    schemaVersion: 1,
    workspaceId,
    startCursor: draft.startCursor,
    endCursor: draft.endCursor,
    previousSegmentHash: draft.previousSegmentHash,
    segmentHash: draft.segmentHash,
    events: [firstEvent, ...draft.events.slice(1)],
    seal: { ...seal, kind: 50002 },
  };
  const objectKey = `workspaces/${workspaceId}/journal/${draft.startCursor}-${draft.endCursor}-${draft.segmentHash}.json`;
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `INSERT OR REPLACE INTO pending_archive
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
    await state.storage.deleteAlarm();
  });
  return { workspaceId, objectKey, archive, unsignedSeal: draft.unsignedSeal };
}

function archiveMetadata(archive: JournalSegmentArchive) {
  return {
    workspaceId: archive.workspaceId,
    segmentHash: archive.segmentHash,
    startCursor: String(archive.startCursor),
    endCursor: String(archive.endCursor),
  };
}

async function localCounts(workspaceId: string) {
  return runInDurableObject(
    env.WORKSPACES.getByName(workspaceId),
    (_instance, state) => ({
      hot: state.storage.sql
        .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
        .one().count,
      archived: state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM archive_segments",
        )
        .one().count,
      pending: state.storage.sql
        .exec<{ count: number }>(
          "SELECT COUNT(*) AS count FROM pending_archive",
        )
        .one().count,
    }),
  );
}

async function seedAdditionalHotEvent(workspaceId: string): Promise<void> {
  await runInDurableObject(
    env.WORKSPACES.getByName(workspaceId),
    async (_instance, state) => {
      await state.storage.deleteAlarm();
      const last = state.storage.sql
        .exec<Record<"cursor" | "event_json", string | number>>(
          "SELECT cursor, event_json FROM journal ORDER BY cursor DESC LIMIT 1",
        )
        .one();
      const cursor = Number(last.cursor) + 1;
      const event = JSON.parse(String(last.event_json)) as SignedNostrEvent;
      state.storage.sql.exec(
        `INSERT INTO journal (cursor, event_id, event_kind, event_json, committed_at)
         VALUES (?, ?, ?, ?, ?)`,
        cursor,
        cursor.toString(16).padStart(64, "a"),
        event.kind,
        JSON.stringify({ ...event, id: cursor.toString(16).padStart(64, "a") }),
        new Date().toISOString(),
      );
    },
  );
}

describe("WorkspaceDO sealed journal recovery", () => {
  it("rearms an evicted archive-ready Workspace without a pending archive", async () => {
    const workspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "96000000-0000-8000-8000-000000000001",
      renameCommandId: "96000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-eviction-repair",
    });
    const stub = env.WORKSPACES.getByName(workspaceId);
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
      const committed = state.storage.sql
        .exec<{ response_json: string }>(
          "SELECT response_json FROM command_results ORDER BY committed_at",
        )
        .toArray()
        .map(
          (row) =>
            JSON.parse(row.response_json) as {
              state: Workspace;
              event: SignedNostrEvent;
            },
        )
        .sort((left, right) => left.state.cursor - right.state.cursor);
      expect(committed).toHaveLength(2);
      state.storage.transactionSync(() => {
        state.storage.sql.exec("DELETE FROM pending_archive");
        state.storage.sql.exec("DELETE FROM archive_segments");
        state.storage.sql.exec("DELETE FROM journal");
        for (const result of committed) {
          state.storage.sql.exec(
            `INSERT INTO journal
              (cursor, event_id, event_kind, event_json, committed_at)
             VALUES (?, ?, ?, ?, ?)`,
            result.state.cursor,
            result.event.id,
            result.event.kind,
            JSON.stringify(result.event),
            result.state.updatedAt,
          );
        }
      });
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
      ).toBe(2);
    });

    await evictDurableObject(stub);

    await runInDurableObject(stub, async (_instance, state) => {
      const alarm = await state.storage.getAlarm();
      const durableProgress = state.storage.sql
        .exec<{ progressed: number }>(
          `SELECT (
             EXISTS(SELECT 1 FROM pending_archive) OR
             EXISTS(SELECT 1 FROM archive_segments) OR
             (SELECT COUNT(*) FROM journal) < 2
           ) AS progressed`,
        )
        .one().progressed;
      expect(alarm !== null || durableProgress === 1).toBe(true);
    });
  });

  it("blocks expansions at journal capacity while making a pending strict role reduction effective", async () => {
    const expansionWorkspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "97000000-0000-8000-8000-000000000001",
      renameCommandId: "97000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-expansion-fence",
    });
    await seedAdditionalHotEvent(expansionWorkspaceId);
    const expansionPending = await preparePendingArchive(expansionWorkspaceId);
    const forgedExpansion = {
      ...expansionPending.archive,
      seal: { ...expansionPending.archive.seal, sig: "0".repeat(128) },
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      expansionPending.objectKey,
      canonicalJson(forgedExpansion),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: archiveMetadata(forgedExpansion),
      },
    );
    const expansion: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: "97000000-0000-8000-8000-000000000003",
      workspaceId: expansionWorkspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: "must-remain-blocked" },
    };
    await expect(
      env.WORKSPACES.getByName(expansionWorkspaceId).execute(expansion),
    ).resolves.toEqual({ ok: false, code: "internal" });

    const reductionWorkspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "98000000-0000-8000-8000-000000000001",
      renameCommandId: "98000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-reduction-overlay",
    });
    await seedAdditionalHotEvent(reductionWorkspaceId);
    await runInDurableObject(
      env.WORKSPACES.getByName(reductionWorkspaceId),
      (_instance, state) => {
        const row = state.storage.sql
          .exec<{ state_json: string }>(
            "SELECT state_json FROM workspace_state WHERE singleton = 1",
          )
          .one();
        const workspace = JSON.parse(row.state_json) as {
          members: Array<{ punkId: string; role: string }>;
        };
        workspace.members.push({ punkId: otherPunkId, role: "moderator" });
        state.storage.sql.exec(
          "UPDATE workspace_state SET state_json = ? WHERE singleton = 1",
          JSON.stringify(workspace),
        );
      },
    );
    const committedCursor = await env.WORKSPACES.getByName(reductionWorkspaceId)
      .query({
        contract: "workspace.get@1",
        workspaceId: reductionWorkspaceId,
      })
      .then((result) => {
        if (!result.ok) {
          throw new Error("Expected committed Workspace");
        }
        return result.state.cursor;
      });
    const reduction: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "8a3837bd-6d5b-4f43-b5a5-cd50208a2c53",
      workspaceId: reductionWorkspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { targetPunkId: otherPunkId, role: "guest" },
    };
    await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/__test/fail-once", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: reduction.commandId }),
      }),
    );
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).execute(reduction),
    ).resolves.toEqual({ ok: false, code: "attestation_failed" });
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).query({
        contract: "workspace.get@1",
        workspaceId: reductionWorkspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      state: {
        members: expect.arrayContaining([
          { punkId: otherPunkId, role: "guest" },
        ]),
      },
    });
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).authorize({
        workspaceId: reductionWorkspaceId,
        punkId: otherPunkId,
        permission: "conversations.write",
      }),
    ).resolves.toEqual({ ok: false, code: "forbidden" });
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).authorize({
        workspaceId: reductionWorkspaceId,
        punkId: otherPunkId,
        permission: "workspace.read",
      }),
    ).resolves.toEqual({
      ok: true,
      workspaceCursor: committedCursor,
      role: "guest",
      visibility: "private",
    });

    const validPending = await runInDurableObject(
      env.WORKSPACES.getByName(reductionWorkspaceId),
      (_instance, state) => {
        const row = state.storage.sql
          .exec<{ next_state_json: string; unsigned_json: string }>(
            `SELECT next_state_json, unsigned_json FROM pending_command
             WHERE singleton = 1`,
          )
          .one();
        state.storage.sql.exec(
          "UPDATE pending_command SET next_state_json = '{}' WHERE singleton = 1",
        );
        return {
          nextStateJson: row.next_state_json,
          unsignedJson: row.unsigned_json,
        };
      },
    );
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).query({
        contract: "workspace.get@1",
        workspaceId: reductionWorkspaceId,
      }),
    ).resolves.toEqual({ ok: false, code: "not_found" });

    await runInDurableObject(
      env.WORKSPACES.getByName(reductionWorkspaceId),
      (_instance, state) => {
        const forged = JSON.parse(validPending.nextStateJson) as {
          members: Array<{ punkId: string; role: string }>;
        };
        const target = forged.members.find(
          (member) => member.punkId === otherPunkId,
        );
        if (target === undefined) {
          throw new Error("Expected reduction target in overlay");
        }
        target.role = "owner";
        state.storage.sql.exec(
          "UPDATE pending_command SET next_state_json = ? WHERE singleton = 1",
          JSON.stringify(forged),
        );
      },
    );
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).authorize({
        workspaceId: reductionWorkspaceId,
        punkId: otherPunkId,
        permission: "bots.install",
      }),
    ).resolves.toEqual({ ok: false, code: "not_found" });

    await runInDurableObject(
      env.WORKSPACES.getByName(reductionWorkspaceId),
      (_instance, state) => {
        const unsigned = JSON.parse(
          validPending.unsignedJson,
        ) as UnsignedNostrEvent;
        unsigned.tags.push(["unexpected", "tag"]);
        state.storage.sql.exec(
          `UPDATE pending_command
           SET next_state_json = ?, unsigned_json = ? WHERE singleton = 1`,
          validPending.nextStateJson,
          JSON.stringify(unsigned),
        );
      },
    );
    await expect(
      env.WORKSPACES.getByName(reductionWorkspaceId).query({
        contract: "workspace.get@1",
        workspaceId: reductionWorkspaceId,
      }),
    ).resolves.toEqual({ ok: false, code: "not_found" });
  });

  it("keeps the hot journal when an existing R2 object has a false seal", async () => {
    const workspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "91000000-0000-8000-8000-000000000001",
      renameCommandId: "91000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-false-seal",
    });
    const pending = await preparePendingArchive(workspaceId);
    const forged: JournalSegmentArchive = {
      ...pending.archive,
      seal: { ...pending.archive.seal, sig: "0".repeat(128) },
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.objectKey,
      canonicalJson(forged),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: archiveMetadata(forged),
      },
    );
    const beforeRecovery = await localCounts(workspaceId);
    expect(beforeRecovery.pending).toBe(1);

    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      async (instance) => instance.alarm?.(),
    );

    await expect(localCounts(workspaceId)).resolves.toEqual(beforeRecovery);
    const unchanged = await env.JOURNAL_ARCHIVE_BUCKET.get(pending.objectKey);
    await expect(unchanged?.json()).resolves.toEqual(forged);
  });

  it.each([
    {
      label: "divergent custom metadata",
      createCommandId: "92000000-0000-8000-8000-000000000001",
      renameCommandId: "92000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-bad-metadata",
      contentType: "application/json",
      body: canonicalJson,
      metadata: (archive: JournalSegmentArchive) => ({
        ...archiveMetadata(archive),
        startCursor: "999",
      }),
    },
    {
      label: "a divergent content type",
      createCommandId: "92000000-0000-8000-8000-000000000003",
      renameCommandId: "92000000-0000-8000-8000-000000000004",
      slug: "workspace-journal-bad-content-type",
      contentType: "text/plain",
      body: canonicalJson,
      metadata: archiveMetadata,
    },
    {
      label: "a non-canonical body",
      createCommandId: "92000000-0000-8000-8000-000000000005",
      renameCommandId: "92000000-0000-8000-8000-000000000006",
      slug: "workspace-journal-noncanonical-body",
      contentType: "application/json",
      body: (archive: JournalSegmentArchive) => ` ${canonicalJson(archive)}`,
      metadata: archiveMetadata,
    },
  ])("keeps the hot journal when an existing R2 object has $label", async (options) => {
    const workspaceId = await createWorkspaceWithTwoEvents(options);
    const pending = await preparePendingArchive(workspaceId);
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.objectKey,
      options.body(pending.archive),
      {
        httpMetadata: { contentType: options.contentType },
        customMetadata: options.metadata(pending.archive),
      },
    );
    const beforeRecovery = await localCounts(workspaceId);
    expect(beforeRecovery.pending).toBe(1);

    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      async (instance) => instance.alarm?.(),
    );

    await expect(localCounts(workspaceId)).resolves.toEqual(beforeRecovery);
  });

  it("keeps the hot journal for a valid seal of another unsigned event", async () => {
    const workspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "94000000-0000-8000-8000-000000000001",
      renameCommandId: "94000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-foreign-seal",
    });
    const pending = await preparePendingArchive(workspaceId);
    const foreignResponse = await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/internal/v1/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "workspace-journal-segment",
          event: {
            ...pending.unsignedSeal,
            created_at: pending.unsignedSeal.created_at + 1,
          },
        }),
      }),
    );
    expect(foreignResponse.status).toBe(200);
    const foreignSeal = ((await foreignResponse.json()) as AttestationResponse)
      .event;
    const foreignArchive: JournalSegmentArchive = {
      ...pending.archive,
      seal: { ...foreignSeal, kind: 50002 },
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.objectKey,
      canonicalJson(foreignArchive),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: archiveMetadata(foreignArchive),
      },
    );
    const beforeRecovery = await localCounts(workspaceId);

    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      async (instance) => instance.alarm?.(),
    );

    await expect(localCounts(workspaceId)).resolves.toEqual(beforeRecovery);
  });

  it("keeps the hot journal when the existing archive body substitutes its Workspace scope", async () => {
    const workspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "95000000-0000-8000-8000-000000000001",
      renameCommandId: "95000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-foreign-scope",
    });
    const pending = await preparePendingArchive(workspaceId);
    const foreignArchive: JournalSegmentArchive = {
      ...pending.archive,
      workspaceId: "d86a1021-24dd-4e2d-bf0a-5ba340637bbc",
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.objectKey,
      canonicalJson(foreignArchive),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: archiveMetadata(foreignArchive),
      },
    );
    const beforeRecovery = await localCounts(workspaceId);

    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      async (instance) => instance.alarm?.(),
    );

    await expect(localCounts(workspaceId)).resolves.toEqual(beforeRecovery);
  });

  it("recovers a valid existing seal after a retry signs the same event differently", async () => {
    const workspaceId = await createWorkspaceWithTwoEvents({
      createCommandId: "93000000-0000-8000-8000-000000000001",
      renameCommandId: "93000000-0000-8000-8000-000000000002",
      slug: "workspace-journal-randomized-recovery",
    });
    await runInDurableObject(
      env.WORKSPACES.getByName(workspaceId),
      (instance) => instance.alarm?.(),
    );
    const pending = await preparePendingArchive(workspaceId);
    const anotherResponse = await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/internal/v1/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "workspace-journal-segment",
          event: pending.unsignedSeal,
        }),
      }),
    );
    expect(anotherResponse.status).toBe(200);
    const anotherSeal = ((await anotherResponse.json()) as AttestationResponse)
      .event;
    expect(anotherSeal.id).toBe(pending.archive.seal.id);
    expect(anotherSeal.sig).not.toBe(pending.archive.seal.sig);

    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.objectKey,
      canonicalJson(pending.archive),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: archiveMetadata(pending.archive),
      },
    );
    const beforeRecovery = await localCounts(workspaceId);
    expect(beforeRecovery.pending).toBe(1);

    const expectedCounts = {
      hot: beforeRecovery.hot - 1,
      archived: beforeRecovery.archived + 1,
      pending: 0,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await runInDurableObject(
        env.WORKSPACES.getByName(workspaceId),
        async (instance) => instance.alarm?.(),
      );
      const counts = await localCounts(workspaceId);
      if (
        counts.hot === expectedCounts.hot &&
        counts.archived === expectedCounts.archived &&
        counts.pending === expectedCounts.pending
      ) {
        break;
      }
    }

    await expect(localCounts(workspaceId)).resolves.toEqual(expectedCounts);
    const recovered = await env.JOURNAL_ARCHIVE_BUCKET.get(pending.objectKey);
    await expect(recovered?.json()).resolves.toEqual(pending.archive);
  });
});
