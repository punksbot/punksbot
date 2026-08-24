import { describe, expect, it } from "vitest";

import {
  BOT_EVENT_KINDS,
  BotDomainError,
  executeBot,
  queryBot,
  type BotExecutionContext,
} from "../src/bot";
import type {
  GetBotQuery,
  PublishBotCommand,
  UpdateBotCommand,
} from "@punks/contracts";

const botId = "00000000-0000-8000-8000-000000000204";
const punkId = "00000000-0000-8000-8000-000000000206";
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;

function publishCommand(): PublishBotCommand {
  return {
    contract: "bot.publish@1",
    commandId: "00000000-0000-8000-8000-000000000207",
    actor: { kind: "punk", punkId },
    payload: {
      slug: "reaction-bot",
      name: "Reaction Bot",
      description: "Reacts to Messages when invoked.",
      configContractId: "punks://contracts/bot.config.empty@1",
      runtimeRelease,
      supportedActionContracts: [
        "message.reaction-add@1",
        "message.reaction-remove@1",
        "message.reaction-toggle@1",
      ],
    },
  };
}

function updateCommand(
  payload: UpdateBotCommand["payload"],
  commandId = "00000000-0000-8000-8000-000000000208",
): UpdateBotCommand {
  return {
    contract: "bot.update@1",
    commandId,
    botId,
    actor: { kind: "punk", punkId },
    payload,
  };
}

function context(
  overrides: Partial<BotExecutionContext> = {},
): BotExecutionContext {
  return {
    botId,
    cursor: 1,
    now: new Date("2026-08-21T12:00:00.000Z"),
    operatorAuthorized: true,
    ...overrides,
  };
}

describe("Bot domain module", () => {
  it("publishes one global Punks-operated Bot through the execute interface", () => {
    const decision = executeBot(null, publishCommand(), context());

    expect(decision.nextState).toEqual({
      id: botId,
      slug: "reaction-bot",
      name: "Reaction Bot",
      description: "Reacts to Messages when invoked.",
      status: "published",
      configContractId: "punks://contracts/bot.config.empty@1",
      runtimeRelease,
      supportedActionContracts: [
        "message.reaction-add@1",
        "message.reaction-remove@1",
        "message.reaction-toggle@1",
      ],
      revision: 1,
      cursor: 1,
      createdAt: "2026-08-21T12:00:00.000Z",
      updatedAt: "2026-08-21T12:00:00.000Z",
      suspendedAt: null,
      withdrawnAt: null,
    });
    expect(decision.event.kind).toBe(BOT_EVENT_KINDS.botPublished);
    expect(decision.event.tags).toEqual(
      expect.arrayContaining([
        ["bot", botId],
        ["contract", "bot.publish@1"],
        ["actor", "punk", punkId],
      ]),
    );
    expect(decision.event.content).not.toContain("credential");
    expect(decision.event.content).not.toContain("code");
  });

  it("mutates slug and lifecycle with explicit deltas and makes withdrawal terminal", () => {
    const published = executeBot(null, publishCommand(), context()).nextState;
    const renamed = executeBot(
      published,
      updateCommand({ operation: "set-slug", slug: "reaction-bot-v2" }),
      context({ cursor: 2 }),
    );
    expect(renamed.nextState).toMatchObject({
      slug: "reaction-bot-v2",
      status: "published",
      revision: 2,
      cursor: 2,
    });
    expect(renamed.event.kind).toBe(BOT_EVENT_KINDS.botUpdated);

    const suspended = executeBot(
      renamed.nextState,
      updateCommand(
        { operation: "set-status", status: "suspended" },
        "00000000-0000-8000-8000-000000000209",
      ),
      context({ cursor: 3 }),
    ).nextState;
    expect(suspended).toMatchObject({
      status: "suspended",
      suspendedAt: "2026-08-21T12:00:00.000Z",
    });

    const republished = executeBot(
      suspended,
      updateCommand(
        { operation: "set-status", status: "published" },
        "00000000-0000-8000-8000-000000000210",
      ),
      context({ cursor: 4 }),
    ).nextState;
    expect(republished).toMatchObject({
      status: "published",
      suspendedAt: null,
    });

    const withdrawn = executeBot(
      republished,
      updateCommand(
        { operation: "set-status", status: "withdrawn" },
        "00000000-0000-8000-8000-000000000211",
      ),
      context({ cursor: 5 }),
    ).nextState;
    expect(withdrawn).toMatchObject({
      status: "withdrawn",
      withdrawnAt: "2026-08-21T12:00:00.000Z",
    });
    expect(() =>
      executeBot(
        withdrawn,
        updateCommand(
          { operation: "set-status", status: "published" },
          "00000000-0000-8000-8000-000000000212",
        ),
        context({ cursor: 6 }),
      ),
    ).toThrowError(/withdrawn Bot is terminal/);
  });

  it("allows one legacy nullish Bot to adopt a known runtime release exactly once", () => {
    const published = executeBot(null, publishCommand(), context()).nextState;
    const legacy = { ...published, runtimeRelease: null };
    const adopted = executeBot(
      legacy,
      updateCommand({ operation: "set-runtime-release", runtimeRelease }),
      context({ cursor: 2 }),
    );
    expect(adopted.nextState).toMatchObject({
      runtimeRelease,
      revision: 2,
      cursor: 2,
    });
    expect(JSON.parse(adopted.event.content)).toMatchObject({
      bot: { runtimeRelease },
      delta: { operation: "set-runtime-release", runtimeRelease },
    });
    expect(() =>
      executeBot(
        adopted.nextState,
        updateCommand(
          { operation: "set-runtime-release", runtimeRelease },
          "00000000-0000-8000-8000-000000000213",
        ),
        context({ cursor: 3 }),
      ),
    ).toThrowError(/immutable/);
  });

  it("fails closed without current operator authority or on foreign identity", () => {
    expect(() =>
      executeBot(
        null,
        publishCommand(),
        context({ operatorAuthorized: false }),
      ),
    ).toThrowError(BotDomainError);
    const state = executeBot(null, publishCommand(), context()).nextState;
    expect(() =>
      executeBot(
        state,
        {
          ...updateCommand({ operation: "set-slug", slug: "new-bot" }),
          botId: "00000000-0000-8000-8000-000000000299",
        },
        context({ cursor: 2 }),
      ),
    ).toThrowError(/Bot does not exist/);
  });

  it("queries one exact Bot without relying on a mutable slug", () => {
    const state = executeBot(null, publishCommand(), context()).nextState;
    const query: GetBotQuery = { contract: "bot.get@1", botId };
    expect(queryBot(state, query)).toBe(state);
    expect(() =>
      queryBot(state, {
        ...query,
        botId: "00000000-0000-8000-8000-000000000299",
      }),
    ).toThrowError(/Bot does not exist/);
  });
});
