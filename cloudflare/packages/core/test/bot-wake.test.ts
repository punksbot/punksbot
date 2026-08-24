import type {
  BotWakeOffer,
  BotWakeTerminalReceiptArchive,
  CompleteBotWakeCommand,
} from "@punks/contracts";
import { describe, expect, it } from "vitest";

import {
  botWakeQueueBody,
  deriveBotWakeActionId,
  deriveBotWakeId,
  deriveBotWakeOfferDigest,
  deriveBotWakeReceiptDigest,
  deriveBotWakeTurnId,
  deriveBotWakeWorkflowId,
  prepareBotWakeOffer,
  prepareBotWakeTerminalReceipt,
  validateBotWakeCompletion,
  validateBotWakeOffer,
  validateBotWakeTerminalReceipt,
} from "../src";

const workspaceId = "10000000-0000-8000-8000-000000000001";
const installationId = "20000000-0000-8000-8000-000000000002";
const botId = "30000000-0000-8000-8000-000000000003";
const conversationId = "40000000-0000-8000-8000-000000000004";
const messageId = "50000000-0000-8000-8000-000000000005";
const sourceEventId = "b".repeat(64);
const sourceEventDigest = "c".repeat(64);
const runtimeRelease = {
  releaseId: "punks.reaction-turn.v1",
  releaseDigest:
    "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
} as const;
const createdAt = new Date("2026-08-21T10:00:00.000Z");

async function offer(): Promise<BotWakeOffer> {
  return prepareBotWakeOffer({
    workspaceId,
    installationId,
    botId,
    conversationId,
    messageId,
    messageCursor: 41,
    subscriptionEpoch: 7,
    runtimeRelease,
    sourceEventId,
    sourceEventDigest,
    createdAt,
  });
}

describe("Bot Wake domain module", () => {
  it("derives opaque Wake identities and prepares one canonical known-release offer", async () => {
    const wakeId = "4e7f2e84-f058-8f92-b929-13bf4b4207bc";
    await expect(
      deriveBotWakeId({
        installationId,
        subscriptionEpoch: 7,
        messageId,
        messageCursor: 41,
      }),
    ).resolves.toBe(wakeId);
    await expect(deriveBotWakeWorkflowId(wakeId)).resolves.toBe(
      "c80bd6b7-8976-839c-ae8c-093781c2a029",
    );
    await expect(deriveBotWakeTurnId(wakeId)).resolves.toBe(
      "5ce0651d-82ae-86cb-99a9-5918e6a029d6",
    );
    await expect(deriveBotWakeActionId(wakeId)).resolves.toBe(
      "3546250b-dd39-8800-b8a1-762a9d667152",
    );

    const prepared = await offer();
    expect(prepared).toEqual({
      contract: "bot-wake.offer@1",
      wakeId,
      workspaceId,
      installationId,
      botId,
      conversationId,
      messageId,
      messageCursor: 41,
      subscriptionEpoch: 7,
      runtimeRelease,
      sourceEventId,
      sourceEventDigest,
      createdAt: createdAt.toISOString(),
    });
    await expect(validateBotWakeOffer(prepared)).resolves.toBe(true);
    expect(botWakeQueueBody(prepared)).toEqual({ installationId, wakeId });
    await expect(deriveBotWakeOfferDigest(prepared)).resolves.toBe(
      "af2c2857aebda95c68cd26e323e90863d6fb0ab33d02e4106535f22991619332",
    );

    await expect(
      validateBotWakeOffer({ ...prepared, messageCursor: 42 }),
    ).resolves.toBe(false);
    await expect(
      prepareBotWakeOffer({
        ...prepared,
        createdAt,
        runtimeRelease: {
          ...runtimeRelease,
          releaseId: "caller.release",
        } as unknown as typeof runtimeRelease,
      }),
    ).rejects.toThrow();
  });

  it("prepares a canonical terminal receipt only for the stable Wake transition", async () => {
    const preparedOffer = await offer();
    const turnId = "5ce0651d-82ae-86cb-99a9-5918e6a029d6";
    const completion: CompleteBotWakeCommand = {
      contract: "bot-wake.complete@1",
      installationId,
      wakeId: preparedOffer.wakeId,
      turnId,
      terminal: {
        outcome: "succeeded",
        decision: "skip",
        reason: "model_selected_skip",
      },
    };
    await expect(
      validateBotWakeCompletion(preparedOffer, completion),
    ).resolves.toBe(true);

    const receipt: BotWakeTerminalReceiptArchive =
      await prepareBotWakeTerminalReceipt({
        offer: preparedOffer,
        completion,
        claimedAt: new Date("2026-08-21T10:00:01.000Z"),
        completedAt: new Date("2026-08-21T10:00:02.000Z"),
      });
    expect(receipt).toEqual({
      schemaVersion: 1,
      offer: preparedOffer,
      turnId,
      claimedAt: "2026-08-21T10:00:01.000Z",
      completedAt: "2026-08-21T10:00:02.000Z",
      terminal: completion.terminal,
    });
    await expect(validateBotWakeTerminalReceipt(receipt)).resolves.toBe(true);
    await expect(deriveBotWakeReceiptDigest(receipt)).resolves.toBe(
      "dc6e02014d57f9a78a82fd15b9644af9ccf81bb1b46b442cc29ae4efa43a4fa4",
    );

    const actionId = "3546250b-dd39-8800-b8a1-762a9d667152";
    const reactionCompletion: CompleteBotWakeCommand = {
      ...completion,
      terminal: {
        outcome: "succeeded",
        decision: "react",
        actionId,
        admissionId: "fed2b45a-6c28-8226-9881-5c3bcc4e5291",
        actionDigest: "d".repeat(64),
      },
    };
    await expect(
      validateBotWakeCompletion(preparedOffer, reactionCompletion),
    ).resolves.toBe(true);
    await expect(
      validateBotWakeCompletion(preparedOffer, {
        ...reactionCompletion,
        terminal: {
          ...reactionCompletion.terminal,
          actionId: "80000000-0000-8000-8000-000000000008",
        },
      }),
    ).resolves.toBe(false);
    await expect(
      prepareBotWakeTerminalReceipt({
        offer: preparedOffer,
        completion,
        claimedAt: new Date("2026-08-21T10:00:03.000Z"),
        completedAt: new Date("2026-08-21T10:00:02.000Z"),
      }),
    ).rejects.toThrow();
  });
});
