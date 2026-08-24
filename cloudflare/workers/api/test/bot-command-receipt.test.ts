import type {
  Bot,
  BotCommandReceiptArchive,
  SignedNostrEvent,
} from "@punks/contracts";
import { canonicalJson } from "@punks/core";
import { describe, expect, it } from "vitest";

import {
  parseBotCommandReceiptArchive,
  prepareBotCommandReceipt,
} from "../src/bot-command-receipt";

const botId = "52000000-0000-4000-8000-000000000001";
const commandId = "52000000-0000-4000-8000-000000000002";
const payloadHash = "ab".repeat(32);
const timestamp = "2026-08-21T08:00:00.000Z";

const state: Bot = {
  id: botId,
  slug: "reactor",
  name: "Réacteur 🤖",
  description: "Réactions bornées",
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

const event: SignedNostrEvent = {
  id: "11".repeat(32),
  pubkey: "22".repeat(32),
  created_at: Math.floor(new Date(timestamp).getTime() / 1_000),
  kind: 50300,
  tags: [
    ["bot", botId],
    ["cursor", "1"],
    ["command", commandId],
    ["contract", "bot.publish@1"],
    ["actor", "punk", "52000000-0000-4000-8000-000000000003"],
    ["attestation", "test-key-v1"],
  ],
  content: canonicalJson({
    schemaVersion: 1,
    bot: state,
    delta: { operation: "published" },
  }),
  sig: "33".repeat(64),
};

function archive(
  overrides: Record<string, unknown> = {},
): BotCommandReceiptArchive {
  return {
    schemaVersion: 1,
    aggregate: "bot",
    botId,
    commandId,
    payloadHash,
    terminal: {
      kind: "committed",
      value: { state, event, previousSlug: null },
    },
    ...overrides,
  } as unknown as BotCommandReceiptArchive;
}

describe("Bot command receipt domain archive", () => {
  it("prepares the strict minimal committed receipt without command material", async () => {
    const prepared = await prepareBotCommandReceipt({
      botId,
      commandId,
      payloadHash,
      value: { state, event, previousSlug: null },
      verifyEvent: async () => true,
    });

    expect(JSON.parse(prepared.body)).toEqual(archive());
    expect(prepared.coordinate.key).not.toContain(botId);
    expect(prepared.coordinate.key).not.toContain(commandId);
    expect(prepared.body).not.toContain("commandJson");
    expect(prepared.body).not.toContain("credential");
    expect(prepared.body).not.toContain('configContractId":{');
  });

  it("accepts only exact state-event semantics and a trusted signature", async () => {
    await expect(
      parseBotCommandReceiptArchive({
        value: archive(),
        expectedBotId: botId,
        expectedCommandId: commandId,
        metadataPayloadHash: payloadHash,
        verifyEvent: async (candidate) => candidate.sig === event.sig,
      }),
    ).resolves.toEqual(archive());
  });

  it("rejects substituted identity, state, content, tags, previous slug, and signature", async () => {
    const mutations: BotCommandReceiptArchive[] = [
      archive({ botId: "52000000-0000-4000-8000-000000000099" }),
      archive({
        terminal: {
          kind: "committed",
          value: {
            state: { ...state, name: "substituted" },
            event,
            previousSlug: null,
          },
        },
      }),
      archive({
        terminal: {
          kind: "committed",
          value: {
            state,
            event: { ...event, content: "{}" },
            previousSlug: null,
          },
        },
      }),
      archive({
        terminal: {
          kind: "committed",
          value: {
            state,
            event: {
              ...event,
              tags: event.tags.toSpliced(2, 1, [
                "command",
                "52000000-0000-4000-8000-000000000099",
              ]),
            },
            previousSlug: null,
          },
        },
      }),
      archive({
        terminal: {
          kind: "committed",
          value: { state, event, previousSlug: "former-slug" },
        },
      }),
    ];
    for (const candidate of mutations) {
      await expect(
        parseBotCommandReceiptArchive({
          value: candidate,
          expectedBotId: botId,
          expectedCommandId: commandId,
          metadataPayloadHash: payloadHash,
          verifyEvent: async () => true,
        }),
      ).rejects.toMatchObject({ code: "corrupt" });
    }
    await expect(
      parseBotCommandReceiptArchive({
        value: archive(),
        expectedBotId: botId,
        expectedCommandId: commandId,
        metadataPayloadHash: payloadHash,
        verifyEvent: async () => false,
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
  });

  it("validates update delta and previousSlug as an exact replay receipt", async () => {
    const updated = {
      ...state,
      slug: "reactor-two",
      revision: 2,
      cursor: 2,
      updatedAt: "2026-08-21T08:01:00.000Z",
    };
    const updateEvent: SignedNostrEvent = {
      ...event,
      id: "44".repeat(32),
      created_at: Math.floor(new Date(updated.updatedAt).getTime() / 1_000),
      kind: 50301,
      tags: event.tags.map((tag) =>
        tag[0] === "cursor"
          ? ["cursor", "2"]
          : tag[0] === "contract"
            ? ["contract", "bot.update@1"]
            : tag,
      ),
      content: canonicalJson({
        schemaVersion: 1,
        bot: updated,
        delta: { operation: "set-slug", slug: "reactor-two" },
      }),
    };
    const candidate = archive({
      terminal: {
        kind: "committed",
        value: { state: updated, event: updateEvent, previousSlug: "reactor" },
      },
    });

    await expect(
      parseBotCommandReceiptArchive({
        value: candidate,
        expectedBotId: botId,
        expectedCommandId: commandId,
        metadataPayloadHash: payloadHash,
        verifyEvent: async () => true,
      }),
    ).resolves.toEqual(candidate);
  });
});
