import type {
  CreateWorkspaceCommand,
  MembershipJournalSegmentArchiveV2,
  RenameWorkspaceCommand,
  SignedNostrEvent,
  UnsignedNostrEvent,
  WorkspaceProjectionMessageV2,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  canonicalJson,
  decideCreateWorkspace,
  verifyJournalSegmentHashV2,
} from "@punks/core";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";

function createWorkspaceCommand(commandId: string): CreateWorkspaceCommand {
  return {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: `workspace-membership-v2-${commandId.slice(-6)}`,
      name: "Workspace Membership v2",
      visibility: "private",
    },
  };
}

describe("WorkspaceDO membership projection v2", () => {
  it("durably stores the complete chunk lot before attesting one shared event", async () => {
    const workspaceId = "b0000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    const command = createWorkspaceCommand(
      "b0000000-0000-8000-8000-000000000002",
    );

    const observed = await runInDurableObject(stub, async (instance, state) => {
      const doEnv = Reflect.get(instance, "env") as {
        ATTESTATION: { fetch(request: Request): Promise<Response> };
      };
      const originalAttestation = doEnv.ATTESTATION;
      let pendingUnsigned: unknown;
      let pendingChunks: unknown;
      doEnv.ATTESTATION = {
        async fetch(request: Request): Promise<Response> {
          const pending = state.storage.sql
            .exec<{ unsigned_json: string; chunks_json: string }>(
              `SELECT unsigned_json, chunks_json FROM pending_command
               WHERE singleton = 1`,
            )
            .one();
          pendingUnsigned = JSON.parse(pending.unsigned_json) as unknown;
          pendingChunks = JSON.parse(pending.chunks_json) as unknown;
          return originalAttestation.fetch(request);
        },
      };
      try {
        const result = await instance.execute(command);
        const journal = state.storage.sql
          .exec<{ event_json: string; chunks_json: string }>(
            `SELECT event_json, chunks_json FROM journal WHERE cursor = 1`,
          )
          .one();
        return {
          result,
          pendingUnsigned,
          pendingChunks,
          event: JSON.parse(journal.event_json) as SignedNostrEvent,
          chunks: JSON.parse(
            journal.chunks_json,
          ) as WorkspaceProjectionMessageV2[],
        };
      } finally {
        doEnv.ATTESTATION = originalAttestation;
        await state.storage.deleteAlarm();
      }
    });

    expect(observed.result).toMatchObject({ ok: true });
    expect(
      validateContract(
        "punks://contracts/nostr.unsigned-event@1",
        observed.pendingUnsigned,
      ).valid,
    ).toBe(true);
    expect(observed.pendingChunks).toEqual([
      expect.objectContaining({
        chunkIndex: 0,
        memberDeltas: [{ punkId: ownerPunkId, present: true, role: "owner" }],
      }),
    ]);
    expect(observed.chunks).toHaveLength(1);
    expect(
      validateContract(
        "punks://contracts/workspace.projection@2",
        observed.chunks[0],
      ).valid,
    ).toBe(true);
    expect(observed.chunks[0]?.event).toEqual(observed.event);
    expect(observed.chunks[0]?.event.id).toBe(
      (observed.result.ok && observed.result.value.event.id) || undefined,
    );
    expect(canonicalJson(observed.chunks[0]?.event)).toBe(
      canonicalJson(observed.event),
    );
  });

  it("advances the delivery cursor only after every chunk is Queue-accepted", async () => {
    const workspaceId = "b1000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);

    const observed = await runInDurableObject(stub, async (instance, state) => {
      const eventId = "9".repeat(64);
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, chunk_index, chunk_count, cursor, payload_json,
           delivered_at, attempts)
         VALUES (?, 0, 2, 1, ?, NULL, 0), (?, 1, 2, 1, ?, NULL, 0)`,
        eventId,
        canonicalJson({ chunkIndex: 0 }),
        eventId,
        canonicalJson({ chunkIndex: 1 }),
      );
      const doEnv = Reflect.get(instance, "env") as {
        PROJECTION_QUEUE: { send(value: unknown): Promise<void> };
      };
      const originalQueue = doEnv.PROJECTION_QUEUE;
      const cursorsDuringSend: number[] = [];
      const acceptedChunks: number[] = [];
      doEnv.PROJECTION_QUEUE = {
        async send(value: unknown): Promise<void> {
          acceptedChunks.push(
            Number(Reflect.get(value as object, "chunkIndex")),
          );
          cursorsDuringSend.push(
            state.storage.sql
              .exec<{ enqueued_through_cursor: number }>(
                `SELECT enqueued_through_cursor
                 FROM projection_delivery_state WHERE singleton = 1`,
              )
              .one().enqueued_through_cursor,
          );
        },
      };
      try {
        const flush = Reflect.get(
          instance,
          "flushOutbox",
        ) as () => Promise<void>;
        await flush.call(instance);
        return {
          acceptedChunks,
          cursorsDuringSend,
          cursor: state.storage.sql
            .exec<{ enqueued_through_cursor: number }>(
              `SELECT enqueued_through_cursor
               FROM projection_delivery_state WHERE singleton = 1`,
            )
            .one().enqueued_through_cursor,
          outboxRows: state.storage.sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
            .one().count,
        };
      } finally {
        doEnv.PROJECTION_QUEUE = originalQueue;
        await state.storage.deleteAlarm();
      }
    });

    expect(observed).toEqual({
      acceptedChunks: [0, 1],
      cursorsDuringSend: [0, 0],
      cursor: 1,
      outboxRows: 0,
    });
  });

  it("archives hot v2 events together with their complete projection chunks", async () => {
    const workspaceId = "b2000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("b2000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      stub.execute({
        contract: "workspace.rename@1",
        commandId: "b2000000-0000-8000-8000-000000000003",
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { slug: "workspace-membership-v2-archived" },
      } satisfies RenameWorkspaceCommand),
    ).resolves.toMatchObject({ ok: true });

    const objectKey = await runInDurableObject(
      stub,
      async (instance, state) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await instance.alarm?.();
          const archived = state.storage.sql
            .exec<{ object_key: string; schema_version: number }>(
              `SELECT object_key, schema_version FROM archive_segments
               ORDER BY end_cursor LIMIT 1`,
            )
            .toArray()[0];
          if (archived !== undefined) {
            expect(archived.schema_version).toBe(2);
            return archived.object_key;
          }
        }
        throw new Error("Expected a v2 Workspace journal archive");
      },
    );
    const stored = await env.JOURNAL_ARCHIVE_BUCKET.get(objectKey);
    expect(stored).not.toBeNull();
    const archive = (await stored?.json()) as MembershipJournalSegmentArchiveV2;
    expect(
      validateContract("punks://contracts/journal.segment@2", archive).valid,
    ).toBe(true);
    expect(archive.entries[0]?.chunks).toHaveLength(1);
    expect(archive.entries[0]?.chunks[0]?.event).toEqual(
      archive.entries[0]?.event,
    );
    await expect(verifyJournalSegmentHashV2(archive)).resolves.toBe(true);
  });

  it("accepts only the exact pre-existing canonical v2 archive on retry", async () => {
    const workspaceId = "b2500000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("b2500000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    const rename = {
      contract: "workspace.rename@1",
      commandId: "b2500000-0000-8000-8000-000000000003",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: "workspace-membership-v2-existing-archive" },
    } satisfies RenameWorkspaceCommand;
    const pending = await runInDurableObject(stub, async (instance, state) => {
      const doEnv = Reflect.get(instance, "env") as {
        JOURNAL_HOT_EVENTS: string;
        JOURNAL_SEGMENT_EVENTS: string;
      };
      doEnv.JOURNAL_HOT_EVENTS = "1000";
      doEnv.JOURNAL_SEGMENT_EVENTS = "250";
      await state.storage.deleteAlarm();
      await expect(instance.execute(rename)).resolves.toMatchObject({
        ok: true,
      });
      const alarmScheduling = Reflect.get(
        instance,
        "alarmScheduling",
      ) as Promise<void>;
      await alarmScheduling;
      await state.storage.deleteAlarm();
      const flush = Reflect.get(instance, "flushOutbox") as () => Promise<void>;
      await flush.call(instance);
      await state.storage.deleteAlarm();
      doEnv.JOURNAL_HOT_EVENTS = "1";
      doEnv.JOURNAL_SEGMENT_EVENTS = "1";
      const prepare = Reflect.get(
        instance,
        "preparePendingArchive",
      ) as () => Promise<
        | {
            start_cursor: number;
            end_cursor: number;
            previous_segment_hash: string | null;
            segment_hash: string;
            object_key: string;
            events_json: string;
            unsigned_seal_json: string;
            schema_version: number;
          }
        | undefined
      >;
      const value = await prepare.call(instance);
      if (value === undefined) {
        throw new Error("Expected a pending v2 Workspace archive");
      }
      expect(value.schema_version).toBe(2);
      return value;
    });
    const unsignedSeal = JSON.parse(
      pending.unsigned_seal_json,
    ) as UnsignedNostrEvent;
    const attestation = await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/internal/v1/attest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "workspace-journal-segment",
          event: unsignedSeal,
        }),
      }),
    );
    expect(attestation.status).toBe(200);
    const seal = ((await attestation.json()) as { event: SignedNostrEvent })
      .event;
    const archive: MembershipJournalSegmentArchiveV2 = {
      schemaVersion: 2,
      workspaceId,
      startCursor: Number(pending.start_cursor),
      endCursor: Number(pending.end_cursor),
      previousSegmentHash: pending.previous_segment_hash,
      segmentHash: pending.segment_hash,
      entries: JSON.parse(
        pending.events_json,
      ) as MembershipJournalSegmentArchiveV2["entries"],
      seal: { ...seal, kind: 50002 },
    };
    await env.JOURNAL_ARCHIVE_BUCKET.put(
      pending.object_key,
      canonicalJson(archive),
      {
        httpMetadata: { contentType: "application/json" },
        customMetadata: {
          workspaceId,
          segmentHash: archive.segmentHash,
          startCursor: String(archive.startCursor),
          endCursor: String(archive.endCursor),
        },
      },
    );

    await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_archive",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ schema_version: number }>(
            `SELECT schema_version FROM archive_segments
             WHERE segment_hash = ?`,
            archive.segmentHash,
          )
          .one().schema_version,
      ).toBe(2);
      await state.storage.deleteAlarm();
    });
    await expect(
      env.JOURNAL_ARCHIVE_BUCKET.get(pending.object_key).then((object) =>
        object?.text(),
      ),
    ).resolves.toBe(canonicalJson(archive));
  });

  it("replays a migrated legacy v1 pending command and journal event", async () => {
    const workspaceId = "b3000000-0000-8000-8000-000000000001";
    const command = createWorkspaceCommand(
      "b3000000-0000-8000-8000-000000000002",
    );
    await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/__test/fail-once", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: command.commandId }),
      }),
    );
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(stub.execute(command)).resolves.toEqual({
      ok: false,
      code: "attestation_failed",
    });
    await runInDurableObject(stub, (_instance, state) => {
      const pending = state.storage.sql
        .exec<{ next_state_json: string }>(
          "SELECT next_state_json FROM pending_command WHERE singleton = 1",
        )
        .one();
      const nextState = JSON.parse(pending.next_state_json) as {
        createdAt: string;
      };
      const legacy = decideCreateWorkspace(null, command, {
        workspaceId,
        cursor: 1,
        now: new Date(nextState.createdAt),
      });
      state.storage.sql.exec(
        `UPDATE pending_command SET unsigned_json = ?, chunks_json = '[]'
         WHERE singleton = 1`,
        JSON.stringify(legacy.event),
      );
    });

    await expect(stub.execute(command)).resolves.toMatchObject({
      ok: true,
      replayed: true,
      value: { event: { content: expect.stringContaining("schemaVersion") } },
    });
    await runInDurableObject(stub, async (_instance, state) => {
      const journal = state.storage.sql
        .exec<{ event_json: string; chunks_json: string | null }>(
          "SELECT event_json, chunks_json FROM journal WHERE cursor = 1",
        )
        .one();
      expect(journal.chunks_json).toBeNull();
      expect(
        JSON.parse(
          (JSON.parse(journal.event_json) as SignedNostrEvent).content,
        ),
      ).toMatchObject({ schemaVersion: 1 });
      await state.storage.deleteAlarm();
    });
  });

  it("fails closed when a durable pending chunk is substituted before replay", async () => {
    const workspaceId = "b3500000-0000-8000-8000-000000000001";
    const command = createWorkspaceCommand(
      "b3500000-0000-8000-8000-000000000002",
    );
    await env.ATTESTATION.fetch(
      new Request("https://punks-attestation.invalid/__test/fail-once", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: command.commandId }),
      }),
    );
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(stub.execute(command)).resolves.toEqual({
      ok: false,
      code: "attestation_failed",
    });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ chunks_json: string }>(
          "SELECT chunks_json FROM pending_command WHERE singleton = 1",
        )
        .one();
      const chunks = JSON.parse(
        row.chunks_json,
      ) as WorkspaceProjectionMessageV2[];
      const first = chunks[0];
      if (first === undefined) {
        throw new Error("Expected a pending Workspace projection chunk");
      }
      chunks[0] = { ...first, chunkDigest: "0".repeat(64) };
      state.storage.sql.exec(
        "UPDATE pending_command SET chunks_json = ? WHERE singleton = 1",
        canonicalJson(chunks),
      );
    });

    await expect(stub.execute(command)).resolves.toEqual({
      ok: false,
      code: "internal",
    });
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM pending_command WHERE singleton = 1",
          )
          .one().attempts,
      ).toBe(2);
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
      ).toBe(0);
      await state.storage.deleteAlarm();
    });
  });

  it("does not reuse a cursor retained by a local archive after PITR", async () => {
    const workspaceId = "b3750000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("b3750000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    const rename: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: "b3750000-0000-8000-8000-000000000003",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: "workspace-pitr-cursor-conflict" },
    };
    const observed = await runInDurableObject(stub, async (instance, state) => {
      try {
        const first = await instance.execute(rename);
        await state.storage.deleteAlarm();
        state.storage.sql.exec(
          `INSERT INTO archive_segments
              (start_cursor, end_cursor, previous_segment_hash, segment_hash,
               object_key, seal_json, schema_version, archived_at)
             VALUES (2, 2, NULL, ?, ?, '{}', 2, ?)`,
          "7".repeat(64),
          `workspaces/${workspaceId}/journal/pitr-future.json`,
          new Date().toISOString(),
        );
        const second = await instance.execute(rename);
        return {
          first,
          second,
          query: await instance.query({
            contract: "workspace.get@1",
            workspaceId,
          }),
          pending: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM pending_command",
            )
            .one().count,
          cursorTwoEvents: state.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM journal WHERE cursor = 2",
            )
            .one().count,
        };
      } finally {
        await state.storage.deleteAlarm();
      }
    });
    expect(observed.first).toEqual({
      ok: false,
      code: "attestation_failed",
    });
    expect(observed.second).toEqual({ ok: false, code: "internal" });
    expect(observed.query).toMatchObject({
      ok: true,
      state: { cursor: 1 },
    });
    expect(observed.pending).toBe(1);
    expect(observed.cursorTwoEvents).toBe(0);
  });

  it("resumes a partially accepted chunk batch after eviction without advancing early", async () => {
    const workspaceId = "b4000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await runInDurableObject(stub, async (instance, state) => {
      const eventId = "8".repeat(64);
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, chunk_index, chunk_count, cursor, payload_json,
           delivered_at, attempts)
         VALUES (?, 0, 2, 1, ?, NULL, 0), (?, 1, 2, 1, ?, NULL, 0)`,
        eventId,
        canonicalJson({ chunkIndex: 0 }),
        eventId,
        canonicalJson({ chunkIndex: 1 }),
      );
      const doEnv = Reflect.get(instance, "env") as {
        PROJECTION_QUEUE: { send(value: unknown): Promise<void> };
      };
      const originalQueue = doEnv.PROJECTION_QUEUE;
      doEnv.PROJECTION_QUEUE = {
        async send(value: unknown): Promise<void> {
          if (Reflect.get(value as object, "chunkIndex") === 1) {
            throw new Error("Queue unavailable after first chunk");
          }
        },
      };
      try {
        const flush = Reflect.get(
          instance,
          "flushOutbox",
        ) as () => Promise<void>;
        await flush.call(instance);
      } finally {
        doEnv.PROJECTION_QUEUE = originalQueue;
      }
      expect(
        state.storage.sql
          .exec<{ enqueued_through_cursor: number }>(
            `SELECT enqueued_through_cursor
             FROM projection_delivery_state WHERE singleton = 1`,
          )
          .one().enqueued_through_cursor,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ delivered: number; attempts: number }>(
            `SELECT COUNT(delivered_at) AS delivered,
                    MAX(attempts) AS attempts FROM outbox`,
          )
          .one(),
      ).toEqual({ delivered: 1, attempts: 1 });
    });

    await evictDurableObject(stub);
    await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ enqueued_through_cursor: number }>(
            `SELECT enqueued_through_cursor
             FROM projection_delivery_state WHERE singleton = 1`,
          )
          .one().enqueued_through_cursor,
      ).toBe(1);
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
      ).toBe(0);
      await state.storage.deleteAlarm();
    });
  });
});
