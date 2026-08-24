import type { SignedNostrEvent } from "@punks/contracts";
import { canonicalJson, sha256Hex } from "@punks/core";
import { describe, expect, it, vi } from "vitest";

import {
  parseBotInstallationCommandReceiptArchive,
  prepareBotInstallationCommandReceipt,
} from "../src/bot-installation-command-receipt";

const installationId = "92000000-0000-4000-8000-000000000001";
const workspaceId = "92000000-0000-4000-8000-000000000002";
const botId = "92000000-0000-4000-8000-000000000003";
const commandId = "92000000-0000-4000-8000-000000000004";
const punkId = "92000000-0000-4000-8000-000000000005";
const payloadHash = "a".repeat(64);
const timestamp = "2026-08-21T10:00:00.000Z";

async function committedFixture() {
  const state = {
    id: installationId,
    workspaceId,
    botId,
    status: "active" as const,
    config: {
      contractId: "punks://contracts/bot.config.empty@1" as const,
      value: {},
    },
    grantCount: 0,
    openAdmissionCount: 0,
    authorityGeneration: 1,
    revision: 1,
    cursor: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: null,
  };
  const configDigest = await sha256Hex(canonicalJson(state.config));
  const content = canonicalJson({
    schemaVersion: 1,
    installation: {
      id: installationId,
      workspaceId,
      botId,
      status: "active",
      grantCount: 0,
      openAdmissionCount: 0,
      authorityGeneration: 1,
      revision: 1,
      cursor: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      revokedAt: null,
      configContractId: state.config.contractId,
      configDigest,
    },
    delta: {
      operation: "installed",
      configContractId: state.config.contractId,
      configDigest,
    },
  });
  return {
    state,
    event: {
      id: "b".repeat(64),
      pubkey: "c".repeat(64),
      created_at: Math.floor(Date.parse(timestamp) / 1_000),
      kind: 50310 as const,
      tags: [
        ["workspace", workspaceId],
        ["installation", installationId],
        ["bot", botId],
        ["cursor", "1"],
        ["command", commandId],
        ["contract", "bot-installation.install@1"],
        ["actor", "punk", punkId],
        ["attestation", "staging-v1"],
      ],
      content,
      sig: "d".repeat(128),
    } as SignedNostrEvent,
  };
}

describe("Bot Installation command receipt domain", () => {
  it("prepares one canonical committed receipt with exact terminal metadata", async () => {
    const value = await committedFixture();
    const prepared = await prepareBotInstallationCommandReceipt({
      installationId,
      commandId,
      payloadHash,
      terminal: { kind: "committed", value },
      verifyEvent: vi.fn().mockResolvedValue(true),
    });

    expect(prepared.coordinate.aggregate).toBe("bot-installation");
    expect(prepared.coordinate.key).not.toContain(installationId);
    expect(prepared.coordinate.key).not.toContain(commandId);
    expect(prepared.metadata.terminal).toBe("committed");
    expect(JSON.parse(prepared.body)).toEqual({
      aggregate: "bot-installation",
      commandId,
      installationId,
      payloadHash,
      schemaVersion: 1,
      terminal: { kind: "committed", value },
    });
    expect(prepared.body).not.toContain("commandJson");
  });

  it("prepares and parses an exact rejected receipt without command data", async () => {
    const verifyEvent = vi.fn().mockResolvedValue(true);
    const prepared = await prepareBotInstallationCommandReceipt({
      installationId,
      commandId,
      payloadHash,
      terminal: { kind: "rejected", code: "forbidden" },
      verifyEvent,
    });
    const parsed = await parseBotInstallationCommandReceiptArchive({
      value: JSON.parse(prepared.body),
      expectedInstallationId: installationId,
      expectedCommandId: commandId,
      metadataPayloadHash: payloadHash,
      metadataTerminal: "rejected",
      verifyEvent,
    });

    expect(parsed.terminal).toEqual({ kind: "rejected", code: "forbidden" });
    expect(prepared.metadata.terminal).toBe("rejected");
    expect(verifyEvent).not.toHaveBeenCalled();
  });

  it("fails closed on a substituted coordinate, payload, state-event pair or signature", async () => {
    const value = await committedFixture();
    const prepared = await prepareBotInstallationCommandReceipt({
      installationId,
      commandId,
      payloadHash,
      terminal: { kind: "committed", value },
      verifyEvent: vi.fn().mockResolvedValue(true),
    });
    const archive = JSON.parse(prepared.body) as Record<string, unknown>;
    const terminal = archive.terminal as {
      kind: "committed";
      value: typeof value;
    };
    const attempts = [
      {
        ...archive,
        installationId: "92000000-0000-4000-8000-000000000099",
      },
      { ...archive, payloadHash: "f".repeat(64) },
      {
        ...archive,
        terminal: {
          ...terminal,
          value: {
            ...terminal.value,
            state: { ...terminal.value.state, cursor: 2 },
          },
        },
      },
      {
        ...archive,
        terminal: {
          ...terminal,
          value: {
            ...terminal.value,
            event: {
              ...terminal.value.event,
              tags: terminal.value.event.tags.map((tag, index) =>
                index === 4 ? ["command", installationId] : tag,
              ),
            },
          },
        },
      },
    ];
    for (const candidate of attempts) {
      await expect(
        parseBotInstallationCommandReceiptArchive({
          value: candidate,
          expectedInstallationId: installationId,
          expectedCommandId: commandId,
          metadataPayloadHash: payloadHash,
          metadataTerminal: "committed",
          verifyEvent: vi.fn().mockResolvedValue(true),
        }),
      ).rejects.toMatchObject({ code: "corrupt" });
    }
    await expect(
      parseBotInstallationCommandReceiptArchive({
        value: archive,
        expectedInstallationId: installationId,
        expectedCommandId: commandId,
        metadataPayloadHash: payloadHash,
        metadataTerminal: "committed",
        verifyEvent: vi.fn().mockResolvedValue(false),
      }),
    ).rejects.toMatchObject({ code: "corrupt" });
  });
});
