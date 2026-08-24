import type {
  AttestationResponse,
  Bot,
  BotCommandReceiptArchive,
  BotProjectionEnvelope,
  SignedNostrEvent,
  UnsignedNostrEvent,
  UpdateBotCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import {
  botRuntimeReleaseReference,
  canonicalJson,
  sha256Hex,
} from "@punks/core";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { prepareBotCommandReceipt } from "../src/bot-command-receipt";
import {
  commandReceiptCoordinate,
  prepareCommandReceiptArchive,
  writeCommandReceiptArchive,
} from "../src/command-receipt-archive";
import type { BotExecuteResult, CommittedBotCommand } from "../src/rpc";

const botId = "59000000-0000-4000-8000-000000000001";
const commandId = "59000000-0000-4000-8000-000000000002";
const operatorPunkId = "59000000-0000-4000-8000-000000000003";
const timestamp = "2026-08-21T08:00:00.000Z";
const runtimeRelease = await botRuntimeReleaseReference();

function successful(
  result: BotExecuteResult,
): Extract<BotExecuteResult, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected committed Bot command, received ${result.code}`);
  }
  return result;
}

function legacyBotWithoutRelease(): Bot {
  return {
    id: botId,
    slug: "legacy-runtime-bot",
    name: "Legacy runtime Bot",
    description: "Published before runtime release pinning",
    status: "published",
    configContractId: "punks://contracts/bot.config.empty@1",
    supportedActionContracts: ["message.reaction-toggle@1"],
    revision: 1,
    cursor: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    suspendedAt: null,
    withdrawnAt: null,
  };
}

function setRuntimeReleaseCommand(): UpdateBotCommand {
  return {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-runtime-release", runtimeRelease },
  };
}

async function attest(event: UnsignedNostrEvent): Promise<SignedNostrEvent> {
  const response = await env.ATTESTATION.fetch(
    new Request("https://punks-attestation.invalid/internal/v1/attest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "bot-journal", event }),
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as AttestationResponse).event;
}

async function legacyTerminal(input: {
  botId: string;
  commandId: string;
  release: "absent" | "null" | "known";
}): Promise<{
  command: UpdateBotCommand;
  payloadHash: string;
  response: CommittedBotCommand;
}> {
  const base: Bot = {
    ...legacyBotWithoutRelease(),
    id: input.botId,
    slug: `legacy-${input.release}`,
    name: `Legacy ${input.release}`,
    revision: 2,
    cursor: 2,
    updatedAt: "2026-08-21T08:01:00.000Z",
  };
  const state: Bot =
    input.release === "absent"
      ? base
      : {
          ...base,
          runtimeRelease: input.release === "null" ? null : runtimeRelease,
        };
  const command: UpdateBotCommand = {
    contract: "bot.update@1",
    commandId: input.commandId,
    botId: input.botId,
    actor: { kind: "punk", punkId: operatorPunkId },
    payload: { operation: "set-metadata", name: state.name },
  };
  const unsigned: UnsignedNostrEvent = {
    created_at: Math.floor(new Date(state.updatedAt).getTime() / 1_000),
    kind: 50301,
    tags: [
      ["bot", input.botId],
      ["cursor", "2"],
      ["command", input.commandId],
      ["contract", "bot.update@1"],
      ["actor", "punk", operatorPunkId],
    ],
    content: canonicalJson({
      schemaVersion: 1,
      bot: state,
      delta: { operation: "set-metadata", name: state.name },
    }),
  };
  return {
    command,
    payloadHash: await sha256Hex(canonicalJson(command)),
    response: {
      state,
      event: await attest(unsigned),
      previousSlug: null,
    },
  };
}

describe("Bot runtime release management", () => {
  it("adopts one known release and replays the exact attested projection hot then cold", async () => {
    const bot = env.BOTS.getByName(botId);
    await runInDurableObject(bot, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)",
        JSON.stringify(legacyBotWithoutRelease()),
      );
    });

    const command = setRuntimeReleaseCommand();
    const committed = successful(
      (await bot.execute({
        command,
        operatorAuthorized: true,
      })) as BotExecuteResult,
    );
    expect(committed).toMatchObject({ ok: true, replayed: false });
    expect(committed.value.state).toMatchObject({
      runtimeRelease,
      revision: 2,
      cursor: 2,
    });
    const content = JSON.parse(committed.value.event.content) as {
      bot: Bot;
      delta: unknown;
      schemaVersion: number;
    };
    expect(content).toEqual({
      schemaVersion: 1,
      bot: committed.value.state,
      delta: { operation: "set-runtime-release", runtimeRelease },
    });
    expect(committed.value.event.content).toBe(canonicalJson(content));
    expect(committed.value.event.tags).toEqual(
      expect.arrayContaining([
        ["command", command.commandId],
        ["contract", "bot.update@1"],
        ["attestation", expect.any(String)],
      ]),
    );
    const projection: BotProjectionEnvelope = {
      contract: "bot.projection@1",
      botId,
      cursor: 2,
      event: committed.value.event,
      state: committed.value.state,
    };
    expect(
      validateContract("punks://contracts/bot.projection@1", projection),
    ).toEqual({ valid: true });
    expect(projection.state.runtimeRelease).toEqual(runtimeRelease);
    const committedJson = canonicalJson(committed.value);
    expect(JSON.stringify(committed.value)).toBe(committedJson);

    const hot = successful(
      (await bot.execute({
        command,
        operatorAuthorized: true,
      })) as BotExecuteResult,
    );
    expect(hot).toEqual({
      ok: true,
      value: committed.value,
      replayed: true,
    });
    expect(JSON.stringify(hot.value)).toBe(committedJson);

    await runInDurableObject(bot, (instance) => instance.alarm());
    await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
            command.commandId,
          )
          .one().count,
      ).toBe(0);
    });
    const cold = successful(
      (await bot.execute({
        command,
        operatorAuthorized: true,
      })) as BotExecuteResult,
    );
    expect(cold).toEqual({
      ok: true,
      value: committed.value,
      replayed: true,
    });
    expect(JSON.stringify(cold.value)).toBe(committedJson);
  });

  it("preserves absent, null and known release receipts exactly through hot and cold lookup", async () => {
    for (const [index, release] of ["absent", "null", "known"].entries()) {
      const suffix = String(index + 10).padStart(12, "0");
      const hotFixture = await legacyTerminal({
        botId: `59100000-0000-4000-8000-${suffix}`,
        commandId: `59200000-0000-4000-8000-${suffix}`,
        release: release as "absent" | "null" | "known",
      });
      const hotBot = env.BOTS.getByName(hotFixture.command.botId);
      const hotJson = JSON.stringify(hotFixture.response);
      const expectedJson = canonicalJson(hotFixture.response);
      await runInDurableObject(hotBot, (_instance, state) => {
        state.storage.sql.exec(
          "INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)",
          JSON.stringify(hotFixture.response.state),
        );
        state.storage.sql.exec(
          `INSERT INTO command_results
            (command_id, payload_hash, command_json, response_json, committed_at)
           VALUES (?, ?, '{}', ?, ?)`,
          hotFixture.command.commandId,
          hotFixture.payloadHash,
          hotJson,
          timestamp,
        );
      });
      const hot = successful(
        (await hotBot.execute({
          command: hotFixture.command,
          operatorAuthorized: true,
        })) as BotExecuteResult,
      );
      expect(hot).toEqual({
        ok: true,
        value: hotFixture.response,
        replayed: true,
      });
      expect(JSON.stringify(hot.value)).toBe(expectedJson);

      const prepared = await prepareBotCommandReceipt({
        botId: hotFixture.command.botId,
        commandId: hotFixture.command.commandId,
        payloadHash: hotFixture.payloadHash,
        value: hotFixture.response,
        verifyEvent: async () => true,
      });
      await writeCommandReceiptArchive(env.JOURNAL_ARCHIVE_BUCKET, prepared);
      await runInDurableObject(hotBot, (_instance, state) => {
        state.storage.sql.exec(
          "DELETE FROM command_results WHERE command_id = ?",
          hotFixture.command.commandId,
        );
      });
      const cold = successful(
        (await hotBot.execute({
          command: hotFixture.command,
          operatorAuthorized: true,
        })) as BotExecuteResult,
      );
      expect(cold).toEqual({
        ok: true,
        value: hotFixture.response,
        replayed: true,
      });
      expect(JSON.stringify(cold.value)).toBe(expectedJson);
      expect(JSON.stringify(cold.value)).toBe(JSON.stringify(hot.value));
      expect(Object.hasOwn(cold.value.state, "runtimeRelease")).toBe(
        release !== "absent",
      );
    }
  }, 15_000);

  it("fails closed on a cold runtime delta substitution before trusting a hot replay", async () => {
    const corruptBotId = "59300000-0000-4000-8000-000000000001";
    const corruptCommandId = "59300000-0000-4000-8000-000000000002";
    const fixture = await legacyTerminal({
      botId: corruptBotId,
      commandId: corruptCommandId,
      release: "known",
    });
    const validContent = JSON.parse(fixture.response.event.content) as {
      bot: Bot;
      delta: unknown;
      schemaVersion: number;
    };
    const substitutedEvent = await attest({
      created_at: fixture.response.event.created_at,
      kind: fixture.response.event.kind,
      tags: fixture.response.event.tags.slice(0, -1),
      content: canonicalJson({
        ...validContent,
        delta: { operation: "set-runtime-release", runtimeRelease: null },
      }),
    });
    const archive: BotCommandReceiptArchive = {
      schemaVersion: 1,
      aggregate: "bot",
      botId: corruptBotId,
      commandId: corruptCommandId,
      payloadHash: fixture.payloadHash,
      terminal: {
        kind: "committed",
        value: {
          state: fixture.response.state,
          event: {
            ...substitutedEvent,
            kind: 50301,
          } as unknown as BotCommandReceiptArchive["terminal"]["value"]["event"],
          previousSlug: null,
        },
      },
    };
    const coordinate = await commandReceiptCoordinate({
      aggregate: "bot",
      aggregateId: corruptBotId,
      commandId: corruptCommandId,
    });
    await writeCommandReceiptArchive(
      env.JOURNAL_ARCHIVE_BUCKET,
      await prepareCommandReceiptArchive(
        coordinate,
        fixture.payloadHash,
        archive,
      ),
    );

    const bot = env.BOTS.getByName(corruptBotId);
    await runInDurableObject(bot, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO bot_state (singleton, state_json) VALUES (1, ?)",
        JSON.stringify(fixture.response.state),
      );
      state.storage.sql.exec(
        `INSERT INTO command_results
          (command_id, payload_hash, command_json, response_json, committed_at)
         VALUES (?, ?, '{}', ?, ?)`,
        corruptCommandId,
        fixture.payloadHash,
        JSON.stringify(fixture.response),
        timestamp,
      );
    });
    await expect(
      bot.execute({ command: fixture.command, operatorAuthorized: true }),
    ).resolves.toEqual({ ok: false, code: "temporarily_unavailable" });
    await runInDurableObject(bot, (_instance, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM command_results WHERE command_id = ?",
            corruptCommandId,
          )
          .one().count,
      ).toBe(1);
      expect(
        JSON.parse(
          state.storage.sql
            .exec<{ state_json: string }>(
              "SELECT state_json FROM bot_state WHERE singleton = 1",
            )
            .one().state_json,
        ),
      ).toEqual(fixture.response.state);
    });
  });
});
