import type { BotInstallationProjectionEnvelope } from "@punks/contracts";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  env,
  getQueueResult,
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import {
  isConsistentBotInstallationProjection,
  projectBotInstallationEnvelope,
} from "../src/bot-installation-projector";
import worker from "../src/index";
import { shardIndex } from "../src/shards";
import { attestNostrEvent } from "../../attestation/src/nostr";

interface TestEnv extends CloudflareBindings {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
}

const testEnv = env as TestEnv;
const workspaceId = "00000000-0000-8000-8000-000000000910";
const installationId = "00000000-0000-8000-8000-000000000912";
const botId = "00000000-0000-8000-8000-000000000913";
const conversationId = "00000000-0000-8000-8000-000000000914";
const messageId = "00000000-0000-8000-8000-000000000916";
const admissionId = "00000000-0000-8000-8000-000000000917";
const actionId = "00000000-0000-8000-8000-000000000918";
const baseTime = Date.parse("2026-08-21T09:00:00.000Z");
const configDigest = "a".repeat(64);

type InstallationSummary = Extract<
  BotInstallationProjectionEnvelope["delta"],
  { installation: unknown }
>["installation"];

function summary(
  cursor: number,
  status: "active" | "revoked",
  grantCount: number,
): InstallationSummary {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  return {
    id: installationId,
    workspaceId,
    botId,
    status,
    configContractId: "punks://contracts/bot.config.empty@1",
    configDigest,
    grantCount,
    openAdmissionCount: 0,
    authorityGeneration: cursor,
    revision: cursor,
    cursor,
    createdAt: new Date(baseTime + 1_000).toISOString(),
    updatedAt: timestamp,
    revokedAt: status === "revoked" ? timestamp : null,
  };
}

function managementEnvelope(
  cursor: number,
  operation: "installed" | "reinstalled" | "revoked",
): BotInstallationProjectionEnvelope {
  const installation = summary(
    cursor,
    operation === "revoked" ? "revoked" : "active",
    0,
  );
  const contract =
    operation === "revoked"
      ? "bot-installation.revoke@1"
      : "bot-installation.install@1";
  return {
    contract: "bot-installation.projection@1",
    workspaceId,
    installationId,
    cursor,
    event: signedEvent(
      cursor,
      operation === "revoked" ? 50312 : 50310,
      contract,
      {
        installation,
        delta:
          operation === "revoked"
            ? { operation: "revoked", cause: "operator" }
            : {
                operation,
                configContractId: installation.configContractId,
                configDigest,
              },
      },
    ),
    delta:
      operation === "revoked"
        ? { operation, installation }
        : { operation, installation },
  };
}

function grantEnvelope(
  cursor: number,
  enabled: boolean,
): BotInstallationProjectionEnvelope {
  const installation = summary(cursor, "active", enabled ? 1 : 0);
  const grant = {
    capability: "messages.react" as const,
    resource: { kind: "conversation" as const, conversationId },
    enabled,
  };
  return {
    contract: "bot-installation.projection@1",
    workspaceId,
    installationId,
    cursor,
    event: signedEvent(cursor, 50311, "bot-installation.configure@1", {
      installation,
      delta: { operation: "set-grant", grant },
    }),
    delta: {
      operation: "set-grant",
      ...grant,
      authorityGeneration: cursor,
      revision: cursor,
      cursor,
    },
  };
}

function signedEvent(
  cursor: number,
  kind: 50310 | 50311 | 50312,
  contract:
    | "bot-installation.install@1"
    | "bot-installation.configure@1"
    | "bot-installation.revoke@1",
  content: object,
): BotInstallationProjectionEnvelope["event"] {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  return {
    id: `8${String(cursor).padStart(63, "0")}`,
    pubkey: "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    created_at: Math.floor(Date.parse(timestamp) / 1_000),
    kind,
    tags: [
      ["workspace", workspaceId],
      ["installation", installationId],
      ["bot", botId],
      ["cursor", String(cursor)],
      [
        "command",
        `00000000-0000-8000-8001-${String(cursor).padStart(12, "0")}`,
      ],
      ["contract", contract],
      ["actor", "punk", "00000000-0000-8000-8000-000000000915"],
      ["attestation", "bot-installation-key-v1"],
    ],
    content: JSON.stringify({ schemaVersion: 1, ...content }),
    sig: "0".repeat(128),
  };
}

async function cryptographicallySign(
  envelope: BotInstallationProjectionEnvelope,
): Promise<BotInstallationProjectionEnvelope> {
  const { id: _id, pubkey: _pubkey, sig: _sig, ...event } = envelope.event;
  return {
    ...envelope,
    event: await attestNostrEvent(
      {
        ...event,
        tags: event.tags.filter(([name]) => name !== "attestation"),
      },
      `${"0".repeat(63)}1`,
      "local-v1",
    ),
  };
}

function admissionEnvelope(
  cursor: 6 | 7,
  completed: boolean,
): BotInstallationProjectionEnvelope {
  const timestamp = new Date(baseTime + cursor * 1_000).toISOString();
  const admission = {
    id: admissionId,
    actionId,
    actionDigest: "b".repeat(64),
    workspaceId,
    installationId,
    botId,
    actionContract: "message.reaction-toggle@1" as const,
    capability: "messages.react" as const,
    risk: "routine" as const,
    resource: {
      kind: "message" as const,
      conversationId,
      messageId,
    },
    status: completed ? ("completed" as const) : ("admitted" as const),
    outcome: completed ? ("succeeded" as const) : null,
    installationCursor: 6,
    authorityGeneration: 5,
    admittedCursor: 6,
    completedCursor: completed ? 7 : null,
    admittedAt: new Date(baseTime + 6_000).toISOString(),
    completedAt: completed ? timestamp : null,
  };
  const contract = completed ? "bot-action.complete@1" : "bot-action.admit@1";
  const actionTags: [string, ...string[]][] = completed
    ? [["outcome", "succeeded"]]
    : [
        ["action_contract", admission.actionContract],
        ["capability", admission.capability],
        ["conversation", conversationId],
        ["message", messageId],
      ];
  return {
    contract: "bot-installation.projection@1",
    workspaceId,
    installationId,
    cursor,
    event: {
      id: `7${String(cursor).padStart(63, "0")}`,
      pubkey:
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind: completed ? 50321 : 50320,
      tags: [
        ["workspace", workspaceId],
        ["installation", installationId],
        ["bot", botId],
        ["cursor", String(cursor)],
        [
          "command",
          `00000000-0000-8000-8002-${String(cursor).padStart(12, "0")}`,
        ],
        ["contract", contract],
        ["actor", "bot", installationId],
        ["admission", admissionId],
        ["action", actionId, admission.actionDigest],
        ...actionTags,
        ["attestation", "bot-installation-key-v1"],
      ],
      content: JSON.stringify({ schemaVersion: 1, admission }),
      sig: "0".repeat(128),
    },
    delta: {
      operation: completed ? "action-completed" : "action-admitted",
      admission,
    },
  };
}

function rebindScope(
  envelope: BotInstallationProjectionEnvelope,
  scope: {
    workspaceId: string;
    installationId: string;
    botId: string;
    admissionId: string;
    actionId: string;
  },
): BotInstallationProjectionEnvelope {
  let serialized = JSON.stringify(envelope);
  const replacements: readonly (readonly [string, string])[] = [
    [workspaceId, scope.workspaceId],
    [installationId, scope.installationId],
    [botId, scope.botId],
    [admissionId, scope.admissionId],
    [actionId, scope.actionId],
  ];
  for (const [source, target] of replacements) {
    serialized = serialized.replaceAll(source, target);
  }
  return JSON.parse(serialized) as BotInstallationProjectionEnvelope;
}

beforeAll(async () => {
  await Promise.all(
    [
      testEnv.PROJECTION_DB_0,
      testEnv.PROJECTION_DB_1,
      testEnv.PROJECTION_DB_2,
      testEnv.PROJECTION_DB_3,
    ].map((database) => applyD1Migrations(database, testEnv.TEST_MIGRATIONS)),
  );
});

describe("Workspace Bot Installation D1 projector", () => {
  it("refuses every remappable D1 shard-ring size", () => {
    expect(() => shardIndex(workspaceId, 1)).toThrow("fixed four-shard");
    expect(() => shardIndex(workspaceId, 8)).toThrow("fixed four-shard");
    expect(shardIndex(workspaceId, 4)).toBe(3);
  });

  it("rejects a revoke event whose exact signed summary is still active", () => {
    const revoked = managementEnvelope(3, "revoked");
    if (revoked.delta.operation !== "revoked") {
      throw new TypeError("Expected a revoked projection");
    }
    const installation = {
      ...revoked.delta.installation,
      status: "active" as const,
      revokedAt: null,
    };
    const content = JSON.parse(revoked.event.content) as {
      schemaVersion: 1;
      delta: object;
    };
    const inconsistent: BotInstallationProjectionEnvelope = {
      ...revoked,
      event: {
        ...revoked.event,
        content: JSON.stringify({ ...content, installation }),
      },
      delta: { operation: "revoked", installation },
    };

    expect(isConsistentBotInstallationProjection(inconsistent)).toBe(false);
  });

  it("does not recreate an enabled grant delivered after a newer revocation", async () => {
    const lateGrantScope = {
      workspaceId: "00000000-0000-8000-8000-000000000960",
      installationId: "00000000-0000-8000-8000-000000000961",
      botId: "00000000-0000-8000-8000-000000000962",
      admissionId: "00000000-0000-8000-8000-000000000963",
      actionId: "00000000-0000-8000-8000-000000000964",
    };
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(managementEnvelope(1, "installed"), lateGrantScope),
    );
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(managementEnvelope(3, "revoked"), lateGrantScope),
    );
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(grantEnvelope(2, true), lateGrantScope),
    );

    const row = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT COUNT(*) AS count
       FROM bot_installation_grant_projection
       WHERE workspace_id = ? AND installation_id = ? AND enabled = 1`,
    )
      .bind(lateGrantScope.workspaceId, lateGrantScope.installationId)
      .first<{ count: number }>();
    expect(row).toEqual({ count: 0 });
  });

  it("normalizes grants and does not let a late revocation defeat a newer reinstall", async () => {
    const installed = managementEnvelope(1, "installed");
    const firstGrant = grantEnvelope(2, true);
    const revoked = managementEnvelope(3, "revoked");
    const reinstalled = managementEnvelope(4, "reinstalled");
    const currentGrant = grantEnvelope(5, true);

    expect(isConsistentBotInstallationProjection(currentGrant)).toBe(true);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, installed);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, firstGrant);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, revoked);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, reinstalled);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, currentGrant);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, revoked);

    const installation = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT status, config_contract_id, config_digest, grant_count,
              authority_generation, revision, last_cursor
       FROM bot_installation_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(workspaceId, installationId)
      .first();
    expect(installation).toEqual({
      status: "active",
      config_contract_id: "punks://contracts/bot.config.empty@1",
      config_digest: configDigest,
      grant_count: 1,
      authority_generation: 5,
      revision: 5,
      last_cursor: 5,
    });
    const grants = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT conversation_id, enabled, authority_generation, last_cursor
       FROM bot_installation_grant_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(workspaceId, installationId)
      .all();
    expect(grants.results).toEqual([
      {
        conversation_id: conversationId,
        enabled: 1,
        authority_generation: 5,
        last_cursor: 5,
      },
    ]);

    for (const table of [
      "bot_installation_projection",
      "bot_installation_grant_projection",
      "bot_installation_event_projection",
    ]) {
      const columns = await testEnv.PROJECTION_DB_0.prepare(
        `SELECT name FROM pragma_table_info('${table}') ORDER BY name`,
      ).all<{ name: string }>();
      expect(columns.results.map(({ name }) => name)).not.toEqual(
        expect.arrayContaining([
          "config",
          "value",
          "payload",
          "credential",
          "event_json",
          "content",
        ]),
      );
    }
  });

  it("keeps a compact completed Admission terminal across duplicates and reordering", async () => {
    const admitted = admissionEnvelope(6, false);
    const completed = admissionEnvelope(7, true);

    expect(isConsistentBotInstallationProjection(completed)).toBe(true);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, completed);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, admitted);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, completed);

    const row = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT admission_id, action_id, action_digest, status, outcome,
              admitted_cursor, completed_cursor, last_cursor
       FROM bot_action_admission_projection
       WHERE workspace_id = ? AND installation_id = ? AND admission_id = ?`,
    )
      .bind(workspaceId, installationId, admissionId)
      .first();
    expect(row).toEqual({
      admission_id: admissionId,
      action_id: actionId,
      action_digest: "b".repeat(64),
      status: "completed",
      outcome: "succeeded",
      admitted_cursor: 6,
      completed_cursor: 7,
      last_cursor: 7,
    });
    const columns = await testEnv.PROJECTION_DB_0.prepare(
      "SELECT name FROM pragma_table_info('bot_action_admission_projection') ORDER BY name",
    ).all<{ name: string }>();
    expect(columns.results.map(({ name }) => name)).not.toEqual(
      expect.arrayContaining([
        "config",
        "payload",
        "credential",
        "event_json",
        "content",
      ]),
    );

    if (completed.delta.operation !== "action-completed") {
      throw new TypeError("Expected a completed Admission envelope");
    }
    const conflictingAdmission = {
      ...completed.delta.admission,
      outcome: "failed" as const,
    };
    const conflictingTags: [string, ...string[]][] = completed.event.tags.map(
      (tag): [string, ...string[]] =>
        tag[0] === "outcome" ? ["outcome", "failed"] : [...tag],
    );
    const conflicting: BotInstallationProjectionEnvelope = {
      ...completed,
      event: {
        ...completed.event,
        tags: conflictingTags,
        content: JSON.stringify({
          schemaVersion: 1,
          admission: conflictingAdmission,
        }),
      },
      delta: {
        operation: "action-completed" as const,
        admission: conflictingAdmission,
      },
    };
    expect(isConsistentBotInstallationProjection(conflicting)).toBe(true);
    await expect(
      projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, conflicting),
    ).rejects.toThrow();
  });

  it("rejects malformed management tag sequences before touching D1", () => {
    const baseline = grantEnvelope(8, true);
    const substitutions: BotInstallationProjectionEnvelope["event"]["tags"][] =
      [
        baseline.event.tags.map((tag) =>
          tag[0] === "actor" ? ["actor", "bot", installationId] : tag,
        ),
        baseline.event.tags.map((tag) =>
          tag[0] === "command" ? ["command", "not-a-uuid"] : tag,
        ),
        baseline.event.tags.map((tag) =>
          tag[0] === "attestation" ? ["attestation", ""] : tag,
        ),
        [...baseline.event.tags, ["extra", "forbidden"]],
      ];

    for (const tags of substitutions) {
      expect(
        isConsistentBotInstallationProjection({
          ...baseline,
          event: { ...baseline.event, tags },
        }),
      ).toBe(false);
    }
  });

  it("rejects config, payload, and credential fields from signed projection content", () => {
    const grant = grantEnvelope(8, true);
    const admitted = admissionEnvelope(6, false);
    const grantContent = JSON.parse(grant.event.content) as {
      schemaVersion: 1;
      installation: Record<string, unknown>;
      delta: Record<string, unknown>;
    };
    const admissionContent = JSON.parse(admitted.event.content) as Record<
      string,
      unknown
    >;
    const tampered = [
      {
        ...grant,
        event: {
          ...grant.event,
          content: JSON.stringify({
            ...grantContent,
            installation: {
              ...grantContent.installation,
              config: { contractId: "forbidden", value: {} },
            },
          }),
        },
      },
      {
        ...grant,
        event: {
          ...grant.event,
          content: JSON.stringify({
            ...grantContent,
            delta: { ...grantContent.delta, credential: "secret" },
          }),
        },
      },
      {
        ...admitted,
        event: {
          ...admitted.event,
          content: JSON.stringify({
            ...admissionContent,
            payload: { emoji: "🔥" },
          }),
        },
      },
    ];

    for (const envelope of tampered) {
      expect(
        isConsistentBotInstallationProjection(
          envelope as BotInstallationProjectionEnvelope,
        ),
      ).toBe(false);
    }
  });

  it("routes Installation envelopes through Queue by Workspace shard", async () => {
    const body = await cryptographicallySign(
      managementEnvelope(1, "installed"),
    );
    const invalid = {
      ...body,
      event: {
        ...body.event,
        tags: [...body.event.tags, ["extra", "forbidden"]],
      },
    };
    const batch = createMessageBatch("punks-projection-local", [
      {
        id: "bot-installation-queue-9",
        timestamp: new Date(),
        body,
        attempts: 1,
      },
      {
        id: "bot-installation-queue-invalid",
        timestamp: new Date(),
        body: invalid,
        attempts: 1,
      },
    ]);
    const context = createExecutionContext();

    expect(shardIndex(workspaceId, 4)).toBe(3);
    await worker.queue?.(batch, testEnv, context);

    const queueResult = await getQueueResult(batch, context);
    expect(queueResult.explicitAcks).toEqual(["bot-installation-queue-9"]);
    expect(queueResult.retryMessages).toEqual([
      { msgId: "bot-installation-queue-invalid" },
    ]);
  });

  it("reconciles Admission counts when receipts arrive before Installation snapshots", async () => {
    const admittedFirst = {
      workspaceId: "00000000-0000-8000-8000-000000000920",
      installationId: "00000000-0000-8000-8000-000000000921",
      botId: "00000000-0000-8000-8000-000000000922",
      admissionId: "00000000-0000-8000-8000-000000000923",
      actionId: "00000000-0000-8000-8000-000000000924",
    };
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(admissionEnvelope(6, false), admittedFirst),
    );
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(managementEnvelope(1, "installed"), admittedFirst),
    );
    const admittedCount = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT open_admission_count FROM bot_installation_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(admittedFirst.workspaceId, admittedFirst.installationId)
      .first();
    expect(admittedCount).toEqual({ open_admission_count: 1 });

    const completedFirst = {
      workspaceId: "00000000-0000-8000-8000-000000000930",
      installationId: "00000000-0000-8000-8000-000000000931",
      botId: "00000000-0000-8000-8000-000000000932",
      admissionId: "00000000-0000-8000-8000-000000000933",
      actionId: "00000000-0000-8000-8000-000000000934",
    };
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(admissionEnvelope(7, true), completedFirst),
    );
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(managementEnvelope(1, "installed"), completedFirst),
    );
    const completedCount = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT open_admission_count FROM bot_installation_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(completedFirst.workspaceId, completedFirst.installationId)
      .first();
    expect(completedCount).toEqual({ open_admission_count: 0 });

    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(managementEnvelope(2, "revoked"), completedFirst),
    );
    const newer = rebindScope(
      managementEnvelope(3, "reinstalled"),
      completedFirst,
    );
    const older = rebindScope(
      managementEnvelope(1, "installed"),
      completedFirst,
    );
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, newer);
    await projectBotInstallationEnvelope(testEnv.PROJECTION_DB_0, older);
    const winningCursor = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT last_cursor FROM bot_installation_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(completedFirst.workspaceId, completedFirst.installationId)
      .first();
    expect(winningCursor).toEqual({ last_cursor: 3 });
  });

  it("retries a non-reducing management gap without touching D1", async () => {
    const gapScope = {
      workspaceId: "00000000-0000-8000-8000-000000000970",
      installationId: "00000000-0000-8000-8000-000000000971",
      botId: "00000000-0000-8000-8000-000000000972",
      admissionId: "00000000-0000-8000-8000-000000000973",
      actionId: "00000000-0000-8000-8000-000000000974",
    };
    await projectBotInstallationEnvelope(
      testEnv.PROJECTION_DB_0,
      rebindScope(managementEnvelope(1, "installed"), gapScope),
    );
    await expect(
      projectBotInstallationEnvelope(
        testEnv.PROJECTION_DB_0,
        rebindScope(grantEnvelope(3, true), gapScope),
      ),
    ).rejects.toThrow("contiguous");

    const row = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT last_cursor, grant_count FROM bot_installation_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(gapScope.workspaceId, gapScope.installationId)
      .first();
    expect(row).toEqual({ last_cursor: 1, grant_count: 0 });
    const events = await testEnv.PROJECTION_DB_0.prepare(
      `SELECT COUNT(*) AS count FROM bot_installation_event_projection
       WHERE workspace_id = ? AND installation_id = ?`,
    )
      .bind(gapScope.workspaceId, gapScope.installationId)
      .first<{ count: number }>();
    expect(events).toEqual({ count: 1 });
  });
});
