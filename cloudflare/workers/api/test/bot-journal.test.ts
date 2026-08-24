import type {
  AttestationResponse,
  BotInstallationJournalSegmentArchive,
  BotJournalSegmentArchive,
  ConfigureBotInstallationCommand,
  CreateWorkspaceCommand,
  InstallBotCommand,
  PublishBotCommand,
  RevokeBotInstallationCommand,
  SignedNostrEvent,
  UnsignedNostrEvent,
  UpdateBotCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  verifyBotInstallationJournalSegmentHash,
  verifyBotJournalSegmentHash,
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
const operatorPunkId = "00000000-0000-8000-8000-000000000001";
const runtimeRelease = await botRuntimeReleaseReference();

async function publishBot(commandId: string, slug: string) {
  const command: PublishBotCommand = {
    contract: "bot.publish@1",
    commandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      slug,
      name: "Journal Bot",
      description: "Punks-operated journal fixture",
      configContractId: "punks://contracts/bot.config.empty@1",
      runtimeRelease,
      supportedActionContracts: ["message.reaction-toggle@1"],
    },
  };
  const response = await SELF.fetch("https://punks.bot/api/internal/v1/bots", {
    method: "POST",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { bot: { id: string } }).bot.id;
}

async function updateBot(
  botId: string,
  commandId: string,
  description: string,
): Promise<void> {
  const response = await updateBotResponse(botId, commandId, description);
  expect(response.status, await response.clone().text()).toBe(200);
}

async function updateBotResponse(
  botId: string,
  commandId: string,
  description: string,
): Promise<Response> {
  const command: UpdateBotCommand = {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-metadata", description },
  };
  return SELF.fetch(`https://punks.bot/api/internal/v1/bots/${botId}`, {
    method: "PATCH",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
}

async function suspendBotResponse(
  botId: string,
  commandId: string,
): Promise<Response> {
  const command: UpdateBotCommand = {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-status", status: "suspended" },
  };
  return SELF.fetch(`https://punks.bot/api/internal/v1/bots/${botId}`, {
    method: "PATCH",
    headers: {
      ...authorization,
      "content-type": "application/json",
      "idempotency-key": command.commandId,
    },
    body: JSON.stringify(command),
  });
}

async function setArchiveAttestationFailure(reject: boolean): Promise<void> {
  const response = await env.ATTESTATION.fetch(
    "https://fixture/__test/archive-failure",
    {
      method: "POST",
      body: JSON.stringify({ reject }),
    },
  );
  expect(response.ok).toBe(true);
}

type PendingArchive = {
  startCursor: number;
  endCursor: number;
  previousSegmentHash: string | null;
  segmentHash: string;
  objectKey: string;
  events: SignedNostrEvent[];
  unsignedSeal: UnsignedNostrEvent;
  attempts: number;
};

async function botPendingArchive(
  botId: string,
): Promise<PendingArchive | null> {
  return runInDurableObject(env.BOTS.getByName(botId), (_instance, state) => {
    const row = state.storage.sql
      .exec<{
        start_cursor: number;
        end_cursor: number;
        previous_segment_hash: string | null;
        segment_hash: string;
        object_key: string;
        events_json: string;
        unsigned_seal_json: string;
        attempts: number;
      }>(
        `SELECT start_cursor, end_cursor, previous_segment_hash, segment_hash,
                  object_key, events_json, unsigned_seal_json, attempts
           FROM pending_archive WHERE singleton = 1`,
      )
      .toArray()[0];
    return row === undefined
      ? null
      : {
          startCursor: row.start_cursor,
          endCursor: row.end_cursor,
          previousSegmentHash: row.previous_segment_hash,
          segmentHash: row.segment_hash,
          objectKey: row.object_key,
          events: JSON.parse(row.events_json) as SignedNostrEvent[],
          unsignedSeal: JSON.parse(
            row.unsigned_seal_json,
          ) as UnsignedNostrEvent,
          attempts: row.attempts,
        };
  });
}

async function installationPendingArchive(
  installationId: string,
): Promise<PendingArchive | null> {
  return runInDurableObject(
    env.BOT_INSTALLATIONS.getByName(installationId),
    (_instance, state) => {
      const row = state.storage.sql
        .exec<{
          start_cursor: number;
          end_cursor: number;
          previous_segment_hash: string | null;
          segment_hash: string;
          object_key: string;
          events_json: string;
          unsigned_seal_json: string;
          attempts: number;
        }>(
          `SELECT start_cursor, end_cursor, previous_segment_hash, segment_hash,
                  object_key, events_json, unsigned_seal_json, attempts
           FROM pending_archive WHERE singleton = 1`,
        )
        .toArray()[0];
      return row === undefined
        ? null
        : {
            startCursor: row.start_cursor,
            endCursor: row.end_cursor,
            previousSegmentHash: row.previous_segment_hash,
            segmentHash: row.segment_hash,
            objectKey: row.object_key,
            events: JSON.parse(row.events_json) as SignedNostrEvent[],
            unsignedSeal: JSON.parse(
              row.unsigned_seal_json,
            ) as UnsignedNostrEvent,
            attempts: row.attempts,
          };
    },
  );
}

async function attestArchiveSeal(
  purpose: "bot-journal-segment" | "bot-installation-journal-segment",
  event: UnsignedNostrEvent,
): Promise<SignedNostrEvent> {
  const response = await env.ATTESTATION.fetch(
    new Request("https://punks-attestation.invalid/internal/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose, event }),
    }),
  );
  expect(response.status, await response.clone().text()).toBe(200);
  return ((await response.json()) as AttestationResponse).event;
}

function archiveMetadata(
  aggregate: "bot" | "bot-installation",
  pending: PendingArchive,
): Record<string, string> {
  return {
    aggregate,
    coordinateHash: pending.objectKey.split("/")[3] ?? "",
    segmentHash: pending.segmentHash,
    startCursor: String(pending.startCursor),
    endCursor: String(pending.endCursor),
  };
}

async function createWorkspace(commandId: string, slug: string) {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { slug, name: "Bot journal Workspace", visibility: "private" },
  };
  const response = await SELF.fetch(
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
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { workspace: { id: string } }).workspace
    .id;
}

async function seedManagedConversation(
  workspaceId: string,
  conversationId: string,
): Promise<void> {
  await runInDurableObject(
    env.CONVERSATIONS.getByName(conversationId),
    (_instance, state) => {
      const now = new Date().toISOString();
      state.storage.sql.exec(
        `INSERT INTO conversation_state (singleton, state_json) VALUES (1, ?)`,
        JSON.stringify({
          id: conversationId,
          workspaceId,
          name: "Bot journal grant authority",
          type: "stream",
          visibility: "private",
          description: null,
          topic: null,
          purpose: null,
          topicRequired: false,
          maxMembers: null,
          ttlSeconds: null,
          ttlDeadline: null,
          ownerPunkId: operatorPunkId,
          members: [
            {
              punkId: operatorPunkId,
              access: "owner",
              joinedAt: now,
              invitedByPunkId: null,
            },
          ],
          status: "active",
          revision: 1,
          cursor: 1,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
        }),
      );
    },
  );
}

async function installBot(
  workspaceId: string,
  botId: string,
  commandId: string,
) {
  const command: InstallBotCommand = {
    contract: "bot-installation.install@1",
    commandId,
    workspaceId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      config: {
        contractId: "punks://contracts/bot.config.empty@1",
        value: {},
      },
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { installation: { id: string } })
    .installation.id;
}

async function revokeInstallationResponse(
  workspaceId: string,
  installationId: string,
  commandId: string,
): Promise<Response> {
  const command: RevokeBotInstallationCommand = {
    contract: "bot-installation.revoke@1",
    commandId,
    workspaceId,
    installationId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { cause: "Emergency authority reduction" },
  };
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations/${installationId}/revoke`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

async function configureInstallation(
  workspaceId: string,
  installationId: string,
  commandId: string,
  conversationId: string,
): Promise<void> {
  const command: ConfigureBotInstallationCommand = {
    contract: "bot-installation.configure@1",
    commandId,
    workspaceId,
    installationId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: {
      operation: "set-grant",
      grant: {
        capability: "messages.react",
        resource: {
          kind: "conversation",
          conversationId,
        },
        enabled: true,
      },
    },
  };
  const response = await SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${workspaceId}/bot-installations/${installationId}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "__Host-punks_session=session-owner",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status, await response.clone().text()).toBe(200);
}

async function archiveCounts(
  stub: DurableObjectStub,
): Promise<{ hot: number; archived: number; pending: number }> {
  return runInDurableObject(stub, (_instance, state) => ({
    hot: state.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM journal")
      .one().count,
    archived: state.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM archive_segments")
      .one().count,
    pending: state.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM pending_archive")
      .one().count,
  }));
}

describe("Bot and BotInstallation sealed journals", () => {
  it("archives both aggregate journals into isolated, signed R2 segments", async () => {
    const botId = await publishBot(
      "71000000-0000-4000-8000-000000000001",
      "journal-bot-primary",
    );
    await updateBot(
      botId,
      "71000000-0000-4000-8000-000000000002",
      "Second signed Bot event",
    );
    const workspaceId = await createWorkspace(
      "72000000-0000-4000-8000-000000000001",
      "bot-journal-workspace",
    );
    const installationId = await installBot(
      workspaceId,
      botId,
      "73000000-0000-4000-8000-000000000001",
    );
    const conversationId = "70000000-0000-4000-8000-000000000001";
    await seedManagedConversation(workspaceId, conversationId);
    await configureInstallation(
      workspaceId,
      installationId,
      "73000000-0000-4000-8000-000000000002",
      conversationId,
    );

    const botStub = env.BOTS.getByName(botId);
    const installationStub = env.BOT_INSTALLATIONS.getByName(installationId);
    await runInDurableObject(botStub, (instance) => instance.alarm?.());
    await runInDurableObject(installationStub, (instance) =>
      instance.alarm?.(),
    );

    const botObjectKey = await runInDurableObject(
      botStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ object_key: string }>(
            "SELECT object_key FROM archive_segments WHERE start_cursor = 1",
          )
          .one().object_key,
    );
    const installationObjectKey = await runInDurableObject(
      installationStub,
      (_instance, state) =>
        state.storage.sql
          .exec<{ object_key: string }>(
            "SELECT object_key FROM archive_segments WHERE start_cursor = 1",
          )
          .one().object_key,
    );
    const botObject = await env.JOURNAL_ARCHIVE_BUCKET.get(botObjectKey);
    const installationObject = await env.JOURNAL_ARCHIVE_BUCKET.get(
      installationObjectKey,
    );
    expect(botObject?.customMetadata?.aggregate).toBe("bot");
    expect(installationObject?.customMetadata?.aggregate).toBe(
      "bot-installation",
    );
    expect(botObjectKey).not.toContain(botId);
    expect(installationObjectKey).not.toContain(workspaceId);
    expect(installationObjectKey).not.toContain(installationId);

    const botArchive = (await botObject?.json()) as BotJournalSegmentArchive;
    const installationArchive =
      (await installationObject?.json()) as BotInstallationJournalSegmentArchive;
    expect(
      validateContract("punks://contracts/bot.journal-segment@1", botArchive),
    ).toEqual({ valid: true });
    expect(
      validateContract(
        "punks://contracts/bot-installation.journal-segment@1",
        installationArchive,
      ),
    ).toEqual({ valid: true });
    expect(botArchive).toMatchObject({
      botId,
      startCursor: 1,
      endCursor: 1,
      previousSegmentHash: null,
      seal: { kind: 50302 },
    });
    expect(installationArchive).toMatchObject({
      workspaceId,
      installationId,
      startCursor: 1,
      endCursor: 1,
      previousSegmentHash: null,
      seal: { kind: 50313 },
    });
    await expect(verifyBotJournalSegmentHash(botArchive)).resolves.toBe(true);
    await expect(
      verifyBotInstallationJournalSegmentHash(installationArchive),
    ).resolves.toBe(true);
    await expect(archiveCounts(botStub)).resolves.toEqual({
      hot: 1,
      archived: 1,
      pending: 0,
    });
    await expect(archiveCounts(installationStub)).resolves.toEqual({
      hot: 1,
      archived: 1,
      pending: 0,
    });
  });

  it("repairs a durable Bot archive pending before and after the create-only R2 put", async () => {
    const botId = await publishBot(
      "74000000-0000-4000-8000-000000000001",
      "journal-bot-repair",
    );
    await updateBot(
      botId,
      "74000000-0000-4000-8000-000000000002",
      "Archive recovery event",
    );
    const stub = env.BOTS.getByName(botId);

    await setArchiveAttestationFailure(true);
    try {
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 2,
        archived: 0,
        pending: 1,
      });
      const pending = await botPendingArchive(botId);
      expect(pending).not.toBeNull();
      expect(pending?.attempts).toBeGreaterThanOrEqual(1);
      await expect(
        env.JOURNAL_ARCHIVE_BUCKET.get(pending?.objectKey ?? ""),
      ).resolves.toBeNull();

      await setArchiveAttestationFailure(false);
      const seal = await attestArchiveSeal(
        "bot-journal-segment",
        pending?.unsignedSeal as UnsignedNostrEvent,
      );
      const archive: BotJournalSegmentArchive = {
        schemaVersion: 1,
        botId,
        startCursor: pending?.startCursor ?? 0,
        endCursor: pending?.endCursor ?? 0,
        previousSegmentHash: pending?.previousSegmentHash ?? null,
        segmentHash: pending?.segmentHash ?? "",
        events: (pending?.events ?? []) as BotJournalSegmentArchive["events"],
        seal: { ...seal, kind: 50302 } as BotJournalSegmentArchive["seal"],
      };
      await env.JOURNAL_ARCHIVE_BUCKET.put(
        pending?.objectKey ?? "",
        ` ${canonicalJson(archive)}`,
        {
          httpMetadata: { contentType: "application/json" },
          customMetadata: archiveMetadata("bot", pending as PendingArchive),
        },
      );

      await runInDurableObject(stub, async (_instance, state) => {
        await state.storage.deleteAlarm();
      });
      await evictDurableObject(stub);
      await runInDurableObject(stub, async (_instance, state) => {
        await expect(state.storage.getAlarm()).resolves.not.toBeNull();
      });
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 2,
        archived: 0,
        pending: 1,
      });

      await env.JOURNAL_ARCHIVE_BUCKET.put(
        pending?.objectKey ?? "",
        canonicalJson(archive),
        {
          httpMetadata: { contentType: "application/json" },
          customMetadata: archiveMetadata("bot", pending as PendingArchive),
        },
      );
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 1,
        archived: 1,
        pending: 0,
      });

      await runInDurableObject(stub, (instance) => instance.alarm?.());
      const objects = await env.JOURNAL_ARCHIVE_BUCKET.list({
        prefix: "journal/v1/bot/",
      });
      expect(
        objects.objects.filter(({ key }) => key === pending?.objectKey),
      ).toHaveLength(1);
      const recovered = await env.JOURNAL_ARCHIVE_BUCKET.get(
        pending?.objectKey ?? "",
      );
      await expect(recovered?.json()).resolves.toEqual(archive);
    } finally {
      await setArchiveAttestationFailure(false);
    }
  });

  it("chains consecutive Bot segments without dropping the retained hot tail", async () => {
    const botId = await publishBot(
      "75000000-0000-4000-8000-000000000001",
      "journal-bot-chain",
    );
    await updateBot(
      botId,
      "75000000-0000-4000-8000-000000000002",
      "Second chain event",
    );
    const stub = env.BOTS.getByName(botId);
    await runInDurableObject(stub, (instance) => instance.alarm?.());

    await updateBot(
      botId,
      "75000000-0000-4000-8000-000000000003",
      "Third chain event",
    );
    await runInDurableObject(stub, (instance) => instance.alarm?.());

    const objectKeys = await runInDurableObject(stub, (_instance, state) =>
      state.storage.sql
        .exec<{ object_key: string }>(
          "SELECT object_key FROM archive_segments ORDER BY start_cursor",
        )
        .toArray()
        .map(({ object_key }) => object_key),
    );
    expect(objectKeys).toHaveLength(2);
    const archives = await Promise.all(
      objectKeys.map(async (key) => {
        const object = await env.JOURNAL_ARCHIVE_BUCKET.get(key);
        return (await object?.json()) as BotJournalSegmentArchive;
      }),
    );
    archives.sort((left, right) => left.startCursor - right.startCursor);
    expect(archives[0]).toMatchObject({
      botId,
      startCursor: 1,
      endCursor: 1,
      previousSegmentHash: null,
    });
    expect(archives[1]).toMatchObject({
      botId,
      startCursor: 2,
      endCursor: 2,
      previousSegmentHash: archives[0]?.segmentHash,
    });
    await expect(
      Promise.all(
        archives.map((archive) => verifyBotJournalSegmentHash(archive)),
      ),
    ).resolves.toEqual([true, true]);
    await expect(archiveCounts(stub)).resolves.toEqual({
      hot: 1,
      archived: 2,
      pending: 0,
    });
  });

  it("keeps a full Bot journal fail-closed when an existing R2 object is corrupt", async () => {
    const botId = await publishBot(
      "76000000-0000-4000-8000-000000000001",
      "journal-bot-corrupt",
    );
    await updateBot(
      botId,
      "76000000-0000-4000-8000-000000000002",
      "Corrupt object fence event",
    );
    const stub = env.BOTS.getByName(botId);

    await setArchiveAttestationFailure(true);
    try {
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      const pending = await botPendingArchive(botId);
      expect(pending).not.toBeNull();
      await env.JOURNAL_ARCHIVE_BUCKET.put(pending?.objectKey ?? "", "{}", {
        httpMetadata: { contentType: "application/json" },
        customMetadata: archiveMetadata("bot", pending as PendingArchive),
      });

      await setArchiveAttestationFailure(false);
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 2,
        archived: 0,
        pending: 1,
      });
      const unchanged = await env.JOURNAL_ARCHIVE_BUCKET.get(
        pending?.objectKey ?? "",
      );
      await expect(unchanged?.text()).resolves.toBe("{}");

      const blocked = await updateBotResponse(
        botId,
        "76000000-0000-4000-8000-000000000003",
        "Must not exceed the bounded hot journal",
      );
      expect(blocked.status).toBe(500);
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 2,
        archived: 0,
        pending: 1,
      });

      const reduction = await suspendBotResponse(
        botId,
        "90000000-0000-8000-8000-000000000001",
      );
      expect(reduction.status).toBe(503);
      await expect(
        stub.query({ contract: "bot.get@1", botId }),
      ).resolves.toMatchObject({ ok: true, state: { status: "suspended" } });
      await runInDurableObject(stub, (_instance, state) => {
        const row = state.storage.sql
          .exec<{ next_state_json: string; unsigned_json: string }>(
            `SELECT next_state_json, unsigned_json FROM pending_command
             WHERE singleton = 1`,
          )
          .one();
        const promoted = JSON.parse(row.next_state_json) as {
          status: string;
        };
        promoted.status = "published";
        const unsigned = JSON.parse(row.unsigned_json) as UnsignedNostrEvent;
        unsigned.tags.push(["unexpected", "tag"]);
        state.storage.sql.exec(
          `UPDATE pending_command SET next_state_json = ?, unsigned_json = ?
           WHERE singleton = 1`,
          JSON.stringify(promoted),
          JSON.stringify(unsigned),
        );
      });
      await expect(
        stub.query({ contract: "bot.get@1", botId }),
      ).resolves.toEqual({ ok: false, code: "not_found" });
    } finally {
      await setArchiveAttestationFailure(false);
    }
  });

  it("rejects a valid-shaped R2 segment substituted across Installation scope", async () => {
    const botId = await publishBot(
      "77000000-0000-4000-8000-000000000001",
      "journal-installation-scope",
    );
    const workspaceId = await createWorkspace(
      "77000000-0000-4000-8000-000000000002",
      "journal-installation-scope",
    );
    const installationId = await installBot(
      workspaceId,
      botId,
      "77000000-0000-4000-8000-000000000003",
    );
    const conversationId = "70000000-0000-4000-8000-000000000002";
    await seedManagedConversation(workspaceId, conversationId);
    await configureInstallation(
      workspaceId,
      installationId,
      "77000000-0000-4000-8000-000000000004",
      conversationId,
    );
    const stub = env.BOT_INSTALLATIONS.getByName(installationId);

    await setArchiveAttestationFailure(true);
    try {
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      const pending = await installationPendingArchive(installationId);
      expect(pending).not.toBeNull();
      await setArchiveAttestationFailure(false);
      const seal = await attestArchiveSeal(
        "bot-installation-journal-segment",
        pending?.unsignedSeal as UnsignedNostrEvent,
      );
      const substituted: BotInstallationJournalSegmentArchive = {
        schemaVersion: 1,
        workspaceId: "77000000-0000-4000-8000-000000000099",
        installationId,
        startCursor: pending?.startCursor ?? 0,
        endCursor: pending?.endCursor ?? 0,
        previousSegmentHash: pending?.previousSegmentHash ?? null,
        segmentHash: pending?.segmentHash ?? "",
        events: (pending?.events ??
          []) as BotInstallationJournalSegmentArchive["events"],
        seal: {
          ...seal,
          kind: 50313,
        } as BotInstallationJournalSegmentArchive["seal"],
      };
      expect(
        validateContract(
          "punks://contracts/bot-installation.journal-segment@1",
          substituted,
        ),
      ).toEqual({ valid: true });
      await env.JOURNAL_ARCHIVE_BUCKET.put(
        pending?.objectKey ?? "",
        canonicalJson(substituted),
        {
          httpMetadata: { contentType: "application/json" },
          customMetadata: archiveMetadata(
            "bot-installation",
            pending as PendingArchive,
          ),
        },
      );

      await runInDurableObject(stub, (instance) => instance.alarm?.());
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 2,
        archived: 0,
        pending: 1,
      });
      const unchanged = await env.JOURNAL_ARCHIVE_BUCKET.get(
        pending?.objectKey ?? "",
      );
      await expect(unchanged?.json()).resolves.toEqual(substituted);

      const reduction = await revokeInstallationResponse(
        workspaceId,
        installationId,
        "90000000-0000-8000-8000-000000000003",
      );
      expect(reduction.status).toBe(503);
      await expect(
        stub.query({
          contract: "bot-installation.get@1",
          workspaceId,
          installationId,
        }),
      ).resolves.toMatchObject({
        ok: true,
        state: { status: "revoked", grantCount: 0 },
      });

      const exact: BotInstallationJournalSegmentArchive = {
        ...substituted,
        workspaceId,
      };
      await env.JOURNAL_ARCHIVE_BUCKET.put(
        pending?.objectKey ?? "",
        ` ${canonicalJson(exact)}`,
        {
          httpMetadata: { contentType: "application/json" },
          customMetadata: archiveMetadata(
            "bot-installation",
            pending as PendingArchive,
          ),
        },
      );
      await runInDurableObject(stub, (instance) => instance.alarm?.());
      await expect(archiveCounts(stub)).resolves.toEqual({
        hot: 2,
        archived: 0,
        pending: 1,
      });
      await runInDurableObject(stub, (_instance, state) => {
        const row = state.storage.sql
          .exec<{ next_state_json: string; unsigned_json: string }>(
            `SELECT next_state_json, unsigned_json FROM pending_command
             WHERE singleton = 1`,
          )
          .one();
        const promoted = JSON.parse(row.next_state_json) as {
          status: string;
          grantCount: number;
        };
        promoted.status = "active";
        promoted.grantCount = 1;
        const unsigned = JSON.parse(row.unsigned_json) as UnsignedNostrEvent;
        unsigned.tags.push(["unexpected", "tag"]);
        state.storage.sql.exec(
          `UPDATE pending_command SET next_state_json = ?, unsigned_json = ?
           WHERE singleton = 1`,
          JSON.stringify(promoted),
          JSON.stringify(unsigned),
        );
      });
      await expect(
        stub.query({
          contract: "bot-installation.get@1",
          workspaceId,
          installationId,
        }),
      ).resolves.toEqual({ ok: false, code: "not_found" });
    } finally {
      await setArchiveAttestationFailure(false);
    }
  });
});
