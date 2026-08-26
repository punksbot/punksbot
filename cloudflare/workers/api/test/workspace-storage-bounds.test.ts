import type {
  CreateWorkspaceCommand,
  RemoveWorkspaceMemberCommand,
  RenameWorkspaceCommand,
  SetWorkspaceMemberRoleCommand,
  SignedNostrEvent,
} from "@punks/contracts";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const secondaryOwnerPunkId = "00000000-0000-8000-8000-000000000002";
const ownerAuthorization = {
  sessionId: "11111111-1111-8111-8111-111111111111",
  punkId: ownerPunkId,
};

function createWorkspaceCommand(commandId: string): CreateWorkspaceCommand {
  return {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: ownerPunkId },
    payload: {
      slug: `workspace-storage-${commandId.slice(-6)}`,
      name: "Workspace Storage Bounds",
      visibility: "private",
    },
  };
}

describe("WorkspaceDO storage bounds", () => {
  it("caps combined projection rows while preserving a funded authority reduction", async () => {
    const fillProjectionRows = async (
      workspaceId: string,
      state: DurableObjectState,
    ) => {
      const existing = state.storage.sql
        .exec<{ rows: number }>(
          `SELECT (
             (SELECT COUNT(*) FROM journal) +
             (SELECT COUNT(*) FROM outbox) +
             (SELECT COUNT(*) FROM pending_archive) +
             (SELECT COUNT(*) FROM archive_segments)
           ) AS rows`,
        )
        .one().rows;
      const needed = 1_024 - Number(existing);
      for (let index = 0; index < needed; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, chunk_index, chunk_count, cursor, payload_json,
             delivered_at, attempts)
           VALUES (?, 0, 1, ?, '{}', NULL, 0)`,
          `${workspaceId.startsWith("af1") ? "e" : "f"}`.repeat(56) +
            index.toString(16).padStart(8, "0"),
          10_000 + index,
        );
      }
      await state.storage.deleteAlarm();
    };

    const normalWorkspaceId = "af000000-0000-8000-8000-000000000001";
    const normalStub = env.WORKSPACES.getByName(normalWorkspaceId);
    await expect(
      normalStub.execute(
        createWorkspaceCommand("af000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await runInDurableObject(normalStub, async (instance, state) => {
      await fillProjectionRows(normalWorkspaceId, state);
      await expect(
        instance.execute({
          contract: "workspace.rename@1",
          commandId: "af000000-0000-8000-8000-000000000003",
          workspaceId: normalWorkspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { slug: "workspace-projection-row-cap" },
        } satisfies RenameWorkspaceCommand),
      ).resolves.toEqual({ ok: false, code: "internal" });
    });

    const reductionWorkspaceId = "af100000-0000-8000-8000-000000000001";
    const reductionStub = env.WORKSPACES.getByName(reductionWorkspaceId);
    await expect(
      reductionStub.execute(
        createWorkspaceCommand("af100000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      reductionStub.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: "af100000-0000-8000-8000-000000000003",
          workspaceId: reductionWorkspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: secondaryOwnerPunkId,
            role: "guest",
            expectedRevision: 1,
          },
        } satisfies SetWorkspaceMemberRoleCommand,
        ownerAuthorization,
      ),
    ).resolves.toMatchObject({ ok: true });
    await runInDurableObject(reductionStub, async (instance, state) => {
      await fillProjectionRows(reductionWorkspaceId, state);
      await expect(
        instance.executeAuthorized(
          {
            contract: "workspace.member-remove@1",
            commandId: "af100000-0000-8000-8000-000000000004",
            workspaceId: reductionWorkspaceId,
            actor: { kind: "punk", punkId: ownerPunkId },
            payload: {
              targetPunkId: secondaryOwnerPunkId,
              expectedRevision: 2,
            },
          } satisfies RemoveWorkspaceMemberCommand,
          ownerAuthorization,
        ),
      ).resolves.toMatchObject({ ok: true });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("measures combined projection storage in UTF-8 bytes", async () => {
    const workspaceId = "af200000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("af200000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });

    await runInDurableObject(stub, async (instance, state) => {
      const scheduled = Reflect.get(
        instance,
        "alarmScheduling",
      ) as Promise<void>;
      await scheduled;
      await state.storage.deleteAlarm();
      const multibytePayload = "é".repeat(262_144);
      for (let index = 0; index < 16; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO outbox
            (event_id, chunk_index, chunk_count, cursor, payload_json,
             delivered_at, attempts)
           VALUES (?, 0, 1, ?, ?, NULL, 0)`,
          `${"d".repeat(56)}${index.toString(16).padStart(8, "0")}`,
          10_000 + index,
          multibytePayload,
        );
      }
      expect(
        state.storage.sql
          .exec<{ characters: number; bytes: number }>(
            `SELECT SUM(length(payload_json)) AS characters,
                    SUM(length(CAST(payload_json AS BLOB))) AS bytes
             FROM outbox`,
          )
          .one(),
      ).toEqual({ characters: 4_194_304, bytes: 8_388_608 });

      await expect(
        instance.execute({
          contract: "workspace.rename@1",
          commandId: "af200000-0000-8000-8000-000000000003",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { slug: "workspace-projection-utf8-cap" },
        } satisfies RenameWorkspaceCommand),
      ).resolves.toEqual({ ok: false, code: "internal" });
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
    });
  });

  it("rechecks combined projection capacity after attestation", async () => {
    const workspaceId = "af300000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("af300000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });

    await runInDurableObject(stub, async (instance, state) => {
      const scheduled = Reflect.get(
        instance,
        "alarmScheduling",
      ) as Promise<void>;
      await scheduled;
      await state.storage.deleteAlarm();
      const doEnv = Reflect.get(instance, "env") as {
        ATTESTATION: { fetch(request: Request): Promise<Response> };
      };
      const originalAttestation = doEnv.ATTESTATION;
      doEnv.ATTESTATION = {
        async fetch(request: Request): Promise<Response> {
          const response = await originalAttestation.fetch(request);
          const existing = state.storage.sql
            .exec<{ rows: number }>(
              `SELECT (
                 (SELECT COUNT(*) FROM journal) +
                 (SELECT COUNT(*) FROM outbox) +
                 (SELECT COUNT(*) FROM pending_archive) +
                 (SELECT COUNT(*) FROM archive_segments)
               ) AS rows`,
            )
            .one().rows;
          for (let index = Number(existing); index < 1_024; index += 1) {
            state.storage.sql.exec(
              `INSERT INTO outbox
                (event_id, chunk_index, chunk_count, cursor, payload_json,
                 delivered_at, attempts)
               VALUES (?, 0, 1, ?, '{}', NULL, 0)`,
              `${"c".repeat(56)}${index.toString(16).padStart(8, "0")}`,
              20_000 + index,
            );
          }
          return response;
        },
      };
      try {
        await expect(
          instance.execute({
            contract: "workspace.rename@1",
            commandId: "af300000-0000-8000-8000-000000000003",
            workspaceId,
            actor: { kind: "punk", punkId: ownerPunkId },
            payload: { slug: "workspace-projection-attestation-race" },
          } satisfies RenameWorkspaceCommand),
        ).resolves.toEqual({ ok: false, code: "internal" });
      } finally {
        doEnv.ATTESTATION = originalAttestation;
      }
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        instance.query({ contract: "workspace.get@1", workspaceId }),
      ).toMatchObject({ ok: true, state: { cursor: 1 } });
      await state.storage.deleteAlarm();
    });
  });

  it("does not delete a projection row substituted while Queue is accepting it", async () => {
    const workspaceId = "a0000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await runInDurableObject(stub, async (instance, state) => {
      const eventId = "9".repeat(64);
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, 1, ?, NULL, 0)`,
        eventId,
        JSON.stringify({ version: "before" }),
      );
      const doEnv = Reflect.get(instance, "env") as {
        PROJECTION_QUEUE: { send(value: unknown): Promise<void> };
      };
      const originalQueue = doEnv.PROJECTION_QUEUE;
      doEnv.PROJECTION_QUEUE = {
        async send() {
          state.storage.sql.exec(
            `UPDATE outbox SET payload_json = ?, attempts = 7
             WHERE event_id = ? AND cursor = 1`,
            JSON.stringify({ version: "after" }),
            eventId,
          );
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
          .exec<{ payload_json: string; attempts: number }>(
            `SELECT payload_json, attempts FROM outbox
             WHERE event_id = ? AND cursor = 1`,
            eventId,
          )
          .one(),
      ).toEqual({
        payload_json: JSON.stringify({ version: "after" }),
        attempts: 7,
      });
    });
  });

  it("deletes accepted projection outbox rows and legacy delivered rows", async () => {
    const workspaceId = "a1000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    const command = createWorkspaceCommand(
      "a1000000-0000-8000-8000-000000000002",
    );

    await expect(stub.execute(command)).resolves.toMatchObject({ ok: true });
    await runInDurableObject(stub, async (instance, state) => {
      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
      ).toBe(0);
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, ?, '{}', ?, 0)`,
        "a".repeat(64),
        1,
        new Date().toISOString(),
      );
    });

    await evictDurableObject(stub);
    await runInDurableObject(stub, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbox")
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ enqueued_through_cursor: number }>(
            `SELECT enqueued_through_cursor FROM projection_delivery_state
             WHERE singleton = 1`,
          )
          .one().enqueued_through_cursor,
      ).toBe(1);
    });
  });

  it("does not archive journal entries that have not reached the Queue", async () => {
    const workspaceId = "a2000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a2000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });

    await runInDurableObject(stub, async (instance, state) => {
      await state.storage.deleteAlarm();
      state.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS projection_delivery_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          enqueued_through_cursor INTEGER NOT NULL CHECK (
            enqueued_through_cursor >= 0
          )
        ) STRICT;
        INSERT INTO projection_delivery_state
          (singleton, enqueued_through_cursor)
        VALUES (1, 0)
        ON CONFLICT(singleton) DO UPDATE SET enqueued_through_cursor = 0;
      `);
      const first = state.storage.sql
        .exec<{ event_id: string; event_json: string; event_kind: number }>(
          "SELECT event_id, event_json, event_kind FROM journal WHERE cursor = 1",
        )
        .one();
      const firstEvent = JSON.parse(first.event_json) as SignedNostrEvent;
      const secondEventId = "b".repeat(64);
      state.storage.sql.exec(
        `INSERT INTO journal
          (cursor, event_id, event_kind, event_json, committed_at)
         VALUES (2, ?, ?, ?, ?)`,
        secondEventId,
        first.event_kind,
        JSON.stringify({ ...firstEvent, id: secondEventId }),
        new Date().toISOString(),
      );
      state.storage.sql.exec(
        `INSERT INTO outbox
          (event_id, cursor, payload_json, delivered_at, attempts)
         VALUES (?, 1, '{', NULL, 63)`,
        first.event_id,
      );
      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM outbox WHERE event_id = ?",
            first.event_id,
          )
          .one().attempts,
      ).toBe(63);
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM archive_segments",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
      ).toBe(2);
      state.storage.sql.exec("DELETE FROM outbox");
      await state.storage.deleteAlarm();
    });
  });

  it("saturates a permanently failing pending command retry counter", async () => {
    const workspaceId = "a3000000-0000-8000-8000-000000000001";
    const command = createWorkspaceCommand(
      "a3000000-0000-8000-8000-000000000002",
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

    await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(
        `UPDATE pending_command SET attempts = 63, unsigned_json = '{}'
         WHERE singleton = 1`,
      );
      await instance.alarm?.();
      expect(
        state.storage.sql
          .exec<{ attempts: number }>(
            "SELECT attempts FROM pending_command WHERE singleton = 1",
          )
          .one().attempts,
      ).toBe(63);
      state.storage.sql.exec("DELETE FROM pending_command");
      await state.storage.deleteAlarm();
    });
  });

  it("keeps a metadata-only v2 projection bounded without copying the roster", async () => {
    const workspaceId = "a4000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a4000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM workspace_state WHERE singleton = 1",
        )
        .one();
      const workspace = JSON.parse(row.state_json) as { memberCount: number };
      for (let index = 0; index < 1_200; index += 1) {
        state.storage.sql.exec(
          "INSERT INTO workspace_members (punk_id, role) VALUES (?, 'member')",
          `member-${String(index).padStart(4, "0")}-${"x".repeat(96)}`,
        );
      }
      workspace.memberCount += 1_200;
      state.storage.sql.exec(
        "UPDATE workspace_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(workspace),
      );
    });
    const rename: RenameWorkspaceCommand = {
      contract: "workspace.rename@1",
      commandId: "a4000000-0000-8000-8000-000000000003",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: { slug: "workspace-storage-oversized-projection" },
    };

    const renamed = await stub.execute(rename);
    expect(renamed).toMatchObject({ ok: true });
    if (!renamed.ok) {
      throw new Error("Expected bounded Workspace v2 rename projection");
    }
    const eventContent = JSON.parse(renamed.value.event.content) as {
      workspace: { memberCount: number };
    };
    expect(eventContent.workspace.memberCount).toBe(1_201);
    expect(renamed.value.event.content).not.toContain("member-0000-");
    expect(
      new TextEncoder().encode(renamed.value.event.content).byteLength,
    ).toBeLessThan(126_000);
    await runInDurableObject(stub, async (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
      ).toBe(0);
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
      ).toBe(2);
      await state.storage.deleteAlarm();
    });
  });

  it("keeps the command-result row cap after journal archival", async () => {
    const workspaceId = "a5000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a5000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      stub.execute({
        contract: "workspace.rename@1",
        commandId: "a5000000-0000-8000-8000-000000000003",
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { slug: "workspace-storage-before-result-cap" },
      } satisfies RenameWorkspaceCommand),
    ).resolves.toMatchObject({ ok: true });
    await runInDurableObject(stub, (instance) => instance.alarm?.());

    const observed = await runInDurableObject(stub, async (instance, state) => {
      for (let index = 2; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, '{}', '{}', ?)`,
          `workspace-cap-${index}`,
          "0".repeat(64),
          "2026-08-21T00:00:00.000Z",
        );
      }
      const before = instance.query({
        contract: "workspace.get@1",
        workspaceId,
      });
      const rename: RenameWorkspaceCommand = {
        contract: "workspace.rename@1",
        commandId: "a5000000-0000-8000-8000-000000000004",
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { slug: "workspace-storage-result-row-cap" },
      };
      const result = await instance.execute(rename);
      return {
        before,
        result,
        after: instance.query({
          contract: "workspace.get@1",
          workspaceId,
        }),
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
        archives: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM archive_segments",
          )
          .one().count,
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });

    expect(observed.result).toEqual({ ok: false, code: "internal" });
    expect(observed.after).toEqual(observed.before);
    expect(observed).toMatchObject({
      pending: 0,
      journal: 1,
      archives: 1,
      results: 256,
    });
  });

  it("measures command-result capacity in UTF-8 bytes", async () => {
    const workspaceId = "a6000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a6000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });

    const observed = await runInDurableObject(stub, async (instance, state) => {
      const normalResultBytes = 4_194_304;
      const currentBytes = state.storage.sql
        .exec<{ bytes: number }>(
          `SELECT COALESCE(SUM(
             length(CAST(command_id AS BLOB)) +
             length(CAST(payload_hash AS BLOB)) +
             length(CAST(command_json AS BLOB)) +
             length(CAST(response_json AS BLOB)) +
             length(CAST(committed_at AS BLOB))
           ), 0) AS bytes FROM command_results`,
        )
        .one().bytes;
      const payloadHash = "0".repeat(64);
      const commandJson = "{}";
      const committedAt = "2026-08-21T00:00:00.000Z";
      const encoder = new TextEncoder();
      const commandIds = Array.from(
        { length: 128 },
        (_, index) => `workspace-utf8-cap-${String(index).padStart(3, "0")}`,
      );
      const fixedBytes = commandIds.reduce(
        (total, commandId) =>
          total +
          [commandId, payloadHash, commandJson, committedAt]
            .map((value) => encoder.encode(value).byteLength)
            .reduce((rowTotal, value) => rowTotal + value, 0),
        0,
      );
      const payloadBytes =
        normalResultBytes - Number(currentBytes) - fixedBytes;
      const basePayloadBytes = Math.floor(payloadBytes / commandIds.length);
      const extraPayloadBytes = payloadBytes % commandIds.length;
      state.storage.sql.exec(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 0
           UNION ALL
           SELECT value + 1 FROM sequence WHERE value < 127
         ), payloads(value, bytes) AS (
           SELECT value, ? + CASE WHEN value < ? THEN 1 ELSE 0 END
           FROM sequence
         )
         INSERT INTO command_results
           (command_id, payload_hash, command_json, response_json, committed_at)
         SELECT 'workspace-utf8-cap-' || printf('%03d', value), ?, ?,
                replace(hex(zeroblob(CAST(bytes / 2 AS INTEGER))), '00', 'é') ||
                  CASE WHEN bytes % 2 = 0 THEN '' ELSE 'x' END,
                ?
         FROM payloads`,
        basePayloadBytes,
        extraPayloadBytes,
        payloadHash,
        commandJson,
        committedAt,
      );
      const storedBytes = state.storage.sql
        .exec<{ bytes: number }>(
          `SELECT COALESCE(SUM(
             length(CAST(command_id AS BLOB)) +
             length(CAST(payload_hash AS BLOB)) +
             length(CAST(command_json AS BLOB)) +
             length(CAST(response_json AS BLOB)) +
             length(CAST(committed_at AS BLOB))
           ), 0) AS bytes FROM command_results`,
        )
        .one().bytes;
      const result = await instance.execute({
        contract: "workspace.rename@1",
        commandId: "a6000000-0000-8000-8000-000000000003",
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { slug: "workspace-storage-utf8-blocked" },
      } satisfies RenameWorkspaceCommand);
      return {
        result,
        storedBytes,
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
        results: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });

    expect(observed).toEqual({
      result: { ok: false, code: "internal" },
      storedBytes: 4_194_304,
      pending: 0,
      journal: 1,
      results: 129,
    });
  });

  it("reserves the exact four-step authority reduction chain at the normal cap", async () => {
    const workspaceId = "a7000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a7000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    const admitSecondaryMember: SetWorkspaceMemberRoleCommand = {
      contract: "workspace.member-set-role@1",
      commandId: "a7000000-0000-8000-8000-000000000003",
      workspaceId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        targetPunkId: secondaryOwnerPunkId,
        role: "member",
        expectedRevision: 1,
      },
    };
    await expect(
      stub.executeAuthorized(admitSecondaryMember, ownerAuthorization),
    ).resolves.toMatchObject({ ok: true });
    const promoteSecondaryOwner: SetWorkspaceMemberRoleCommand = {
      ...admitSecondaryMember,
      commandId: "a7000000-0000-8000-8000-000000000008",
      payload: {
        targetPunkId: secondaryOwnerPunkId,
        role: "owner",
        expectedRevision: 2,
      },
    };
    await expect(
      stub.executeAuthorized(promoteSecondaryOwner, ownerAuthorization),
    ).resolves.toMatchObject({ ok: true });

    const observed = await runInDurableObject(stub, async (instance, state) => {
      for (let index = 3; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, '{}', '{}', ?)`,
          `workspace-reserve-${index}`,
          "0".repeat(64),
          "2026-08-21T00:00:00.000Z",
        );
      }
      const roleCommand = (
        commandId: string,
        role: "moderator" | "member" | "guest",
        expectedRevision: number,
      ): SetWorkspaceMemberRoleCommand => ({
        contract: "workspace.member-set-role@1",
        commandId,
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { targetPunkId: secondaryOwnerPunkId, role, expectedRevision },
      });
      const reductions = [
        roleCommand("a7000000-0000-8000-8000-000000000004", "moderator", 3),
        roleCommand("a7000000-0000-8000-8000-000000000005", "member", 4),
        roleCommand("a7000000-0000-8000-8000-000000000006", "guest", 5),
        {
          contract: "workspace.member-remove@1",
          commandId: "a7000000-0000-8000-8000-000000000007",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: secondaryOwnerPunkId,
            expectedRevision: 6,
          },
        } satisfies RemoveWorkspaceMemberCommand,
      ];
      const results = [];
      for (const reduction of reductions) {
        results.push(
          await instance.executeAuthorized(reduction, ownerAuthorization),
        );
      }
      return {
        results,
        query: instance.query({ contract: "workspace.get@1", workspaceId }),
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        commandResults: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });

    expect(observed.results).toHaveLength(4);
    expect(observed.results.every((result) => result.ok)).toBe(true);
    expect(observed.query).toMatchObject({
      ok: true,
      state: { cursor: 7, members: [{ punkId: ownerPunkId, role: "owner" }] },
    });
    expect(observed).toMatchObject({
      pending: 0,
      commandResults: 260,
    });
  });

  it("classifies add, promotion, and rename as normal commands", async () => {
    const workspaceId = "a8000000-0000-8000-8000-000000000001";
    const existingGuestPunkId = "00000000-0000-8000-8000-000000000003";
    const newGuestPunkId = "00000000-0000-8000-8000-000000000004";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a8000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      stub.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: "a8000000-0000-8000-8000-000000000003",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: existingGuestPunkId,
            role: "guest",
            expectedRevision: 1,
          },
        } satisfies SetWorkspaceMemberRoleCommand,
        ownerAuthorization,
      ),
    ).resolves.toMatchObject({ ok: true });

    const observed = await runInDurableObject(stub, async (instance, state) => {
      for (let index = 2; index < 256; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, '{}', '{}', ?)`,
          `workspace-normal-class-${index}`,
          "0".repeat(64),
          "2026-08-21T00:00:00.000Z",
        );
      }
      const add = await instance.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: "a8000000-0000-8000-8000-000000000004",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: newGuestPunkId,
            role: "guest",
            expectedRevision: 2,
          },
        } satisfies SetWorkspaceMemberRoleCommand,
        ownerAuthorization,
      );
      const promote = await instance.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: "a8000000-0000-8000-8000-000000000005",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: existingGuestPunkId,
            role: "member",
            expectedRevision: 2,
          },
        } satisfies SetWorkspaceMemberRoleCommand,
        ownerAuthorization,
      );
      const rename = await instance.execute({
        contract: "workspace.rename@1",
        commandId: "a8000000-0000-8000-8000-000000000006",
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { slug: "workspace-normal-class-blocked" },
      } satisfies RenameWorkspaceCommand);
      return {
        add,
        promote,
        rename,
        query: instance.query({ contract: "workspace.get@1", workspaceId }),
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        commandResults: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });

    expect(observed.add).toEqual({ ok: false, code: "internal" });
    expect(observed.promote).toEqual({ ok: false, code: "internal" });
    expect(observed.rename).toEqual({ ok: false, code: "internal" });
    expect(observed.query).toMatchObject({
      ok: true,
      state: {
        cursor: 2,
        members: [
          { punkId: ownerPunkId, role: "owner" },
          { punkId: existingGuestPunkId, role: "guest" },
        ],
      },
    });
    expect(observed).toMatchObject({ pending: 0, commandResults: 256 });
  });

  it("uses the last hard-cap row only for the final authority removal", async () => {
    const workspaceId = "a9000000-0000-8000-8000-000000000001";
    const guestPunkId = "00000000-0000-8000-8000-000000000005";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("a9000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      stub.executeAuthorized(
        {
          contract: "workspace.member-set-role@1",
          commandId: "a9000000-0000-8000-8000-000000000003",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: {
            targetPunkId: guestPunkId,
            role: "guest",
            expectedRevision: 1,
          },
        } satisfies SetWorkspaceMemberRoleCommand,
        ownerAuthorization,
      ),
    ).resolves.toMatchObject({ ok: true });

    const observed = await runInDurableObject(stub, async (instance, state) => {
      state.storage.sql.exec(
        `WITH RECURSIVE sequence(value) AS (
           SELECT 2
           UNION ALL
           SELECT value + 1 FROM sequence WHERE value < 65534
         )
         INSERT INTO command_results
           (command_id, payload_hash, command_json, response_json, committed_at)
         SELECT 'workspace-hard-cap-' || printf('%04d', value), ?, '{}', '{}', ?
         FROM sequence`,
        "0".repeat(64),
        "2026-08-21T00:00:00.000Z",
      );
      const remove = await instance.executeAuthorized(
        {
          contract: "workspace.member-remove@1",
          commandId: "a9000000-0000-8000-8000-000000000004",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { targetPunkId: guestPunkId, expectedRevision: 2 },
        } satisfies RemoveWorkspaceMemberCommand,
        ownerAuthorization,
      );
      const rename = await instance.execute({
        contract: "workspace.rename@1",
        commandId: "a9000000-0000-8000-8000-000000000005",
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: { slug: "workspace-hard-cap-blocked" },
      } satisfies RenameWorkspaceCommand);
      return {
        remove,
        rename,
        query: instance.query({ contract: "workspace.get@1", workspaceId }),
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        commandResults: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });

    expect(observed.remove).toMatchObject({ ok: true });
    expect(observed.rename).toEqual({ ok: false, code: "internal" });
    expect(observed.query).toMatchObject({
      ok: true,
      state: { cursor: 3, members: [{ punkId: ownerPunkId, role: "owner" }] },
    });
    expect(observed).toMatchObject({ pending: 0, commandResults: 65_536 });
  });

  it("rechecks result capacity after attestation without leaving a normal pending command", async () => {
    const workspaceId = "aa000000-0000-8000-8000-000000000001";
    const stub = env.WORKSPACES.getByName(workspaceId);
    await expect(
      stub.execute(
        createWorkspaceCommand("aa000000-0000-8000-8000-000000000002"),
      ),
    ).resolves.toMatchObject({ ok: true });

    const observed = await runInDurableObject(stub, async (instance, state) => {
      const scheduledBeforeRace = Reflect.get(
        instance,
        "alarmScheduling",
      ) as Promise<void>;
      await scheduledBeforeRace;
      await state.storage.deleteAlarm();
      for (let index = 1; index < 255; index += 1) {
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, '{}', '{}', ?)`,
          `workspace-before-attestation-${index}`,
          "0".repeat(64),
          "2026-08-21T00:00:00.000Z",
        );
      }
      const doEnv = Reflect.get(instance, "env") as {
        ATTESTATION: { fetch(request: Request): Promise<Response> };
      };
      const originalAttestation = doEnv.ATTESTATION;
      doEnv.ATTESTATION = {
        async fetch(request: Request): Promise<Response> {
          const body: unknown = await request.clone().json();
          const tags =
            typeof body === "object" &&
            body !== null &&
            "event" in body &&
            typeof body.event === "object" &&
            body.event !== null &&
            "tags" in body.event &&
            Array.isArray(body.event.tags)
              ? body.event.tags
              : [];
          const commandId = tags.find(
            (tag) =>
              Array.isArray(tag) &&
              tag[0] === "command" &&
              tag[1] === "aa000000-0000-8000-8000-000000000003",
          );
          const response = await originalAttestation.fetch(request);
          if (commandId !== undefined) {
            state.storage.sql.exec(
              `INSERT OR IGNORE INTO command_results
                (command_id, payload_hash, command_json, response_json, committed_at)
               VALUES ('workspace-attestation-race', ?, '{}', '{}', ?)`,
              "0".repeat(64),
              "2026-08-21T00:00:00.000Z",
            );
          }
          return response;
        },
      };
      let result: Awaited<ReturnType<(typeof instance)["execute"]>>;
      try {
        result = await instance.execute({
          contract: "workspace.rename@1",
          commandId: "aa000000-0000-8000-8000-000000000003",
          workspaceId,
          actor: { kind: "punk", punkId: ownerPunkId },
          payload: { slug: "workspace-attestation-cap-race" },
        } satisfies RenameWorkspaceCommand);
      } finally {
        doEnv.ATTESTATION = originalAttestation;
        const scheduledDuringRace = Reflect.get(
          instance,
          "alarmScheduling",
        ) as Promise<void>;
        await scheduledDuringRace;
        await state.storage.deleteAlarm();
      }
      return {
        result,
        query: instance.query({ contract: "workspace.get@1", workspaceId }),
        pending: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM pending_command",
          )
          .one().count,
        journal: state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
          .one().count,
        commandResults: state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results",
          )
          .one().count,
      };
    });

    expect(observed.result).toEqual({ ok: false, code: "internal" });
    expect(observed.query).toMatchObject({ ok: true, state: { cursor: 1 } });
    expect(observed).toMatchObject({
      pending: 0,
      journal: 1,
      commandResults: 256,
    });
  });
});
