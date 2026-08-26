import { schnorr } from "@noble/curves/secp256k1.js";
import type { AttestationResponse } from "@punks/contracts";
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { serializeNostrEvent } from "../src/nostr";

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

async function requestAttestation(body: unknown): Promise<Response> {
  return SELF.fetch("https://attestation.invalid/internal/v1/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("private attestation Worker", () => {
  it("fences the ordinary signing path until service-state recovery completes", async () => {
    const identity = {
      executionId: "929292929292:windows-x64:coupure:internal-event-signature",
      candidateSha: "91".repeat(20),
      stagingDeploymentId: `sha256:${"92".repeat(32)}`,
      type: "coupure" as const,
      authority: "internal-event-signature",
      target: {
        kind: "service" as const,
        id: "internal-event-signature",
        probe: {
          punkId: "00000000-0000-8000-8000-000000000001",
          workspaceId: "58975ca8-3b75-42c7-a13a-51c9d7306200",
          workspaceSlug: "promotion-fixture",
          conversationId: "00000000-0000-8000-8000-000000000060",
          messageId: "537dc710-324c-4d4a-b8dc-a1fd8c177537",
        },
      },
    };
    const fault = env.PROMOTION_AUTHORITY_FAULTS.getByName(
      "internal-event-signature",
    );
    await expect(fault.injectPromotionFault(identity)).resolves.toMatchObject({
      phase: "injected",
      stateFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    const body = {
      purpose: "workspace-journal",
      event: {
        created_at: 1_787_227_200,
        kind: 50000,
        tags: [
          ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
          ["cursor", "1"],
          ["command", "537dc710-324c-4d4a-b8dc-a1fd8c177537"],
          ["contract", "workspace.create@1"],
          ["actor", "punk", "punk_owner"],
        ],
        content: '{"schemaVersion":1}',
      },
    };
    expect((await requestAttestation(body)).status).toBe(503);
    for (const proof of [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
      "recu-resistant-pitr",
    ] as const) {
      await expect(
        fault.recoverPromotionFault({ ...identity, proof }),
      ).resolves.toMatchObject({ proof });
    }
    expect((await requestAttestation(body)).status).toBe(200);
  });

  it("produces a NIP-01 id and a valid BIP-340 Schnorr signature", async () => {
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          purpose: "workspace-journal",
          event: {
            created_at: 1_787_227_200,
            kind: 50000,
            tags: [
              ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
              ["cursor", "1"],
              ["command", "537dc710-324c-4d4a-b8dc-a1fd8c177537"],
              ["contract", "workspace.create@1"],
              ["actor", "punk", "punk_owner"],
            ],
            content: '{"schemaVersion":1}',
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as AttestationResponse;
    expect(body.keyVersion).toBe("local-v1");
    expect(body.event.tags).toContainEqual(["attestation", "local-v1"]);

    const serialized = serializeNostrEvent(body.event.pubkey, body.event);
    const expectedId = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(serialized),
      ),
    );
    expect(body.event.id).toBe(
      Array.from(expectedId, (byte) => byte.toString(16).padStart(2, "0")).join(
        "",
      ),
    );
    expect(
      schnorr.verify(
        hexToBytes(body.event.sig),
        expectedId,
        hexToBytes(body.event.pubkey),
      ),
    ).toBe(true);
  });

  it.each([
    [50300, "bot.publish@1"],
    [50301, "bot.update@1"],
  ] as const)("attests Bot journal kind %i only with its exact contract and Punk actor", async (kind, contract) => {
    const event = {
      created_at: 1_787_230_900,
      kind,
      tags: [
        ["bot", "00000000-0000-8000-8000-000000000204"],
        ["cursor", "2"],
        ["command", "00000000-0000-8000-8000-000000000207"],
        ["contract", contract],
        ["actor", "punk", "00000000-0000-8000-8000-000000000206"],
      ],
      content: '{"schemaVersion":1}',
    };

    const accepted = await requestAttestation({
      purpose: "bot-journal",
      event,
    });
    expect(accepted.status).toBe(200);
    const responseBody = (await accepted.json()) as AttestationResponse;
    expect(Object.keys(responseBody).sort()).toEqual(["event", "keyVersion"]);
    expect(responseBody).toMatchObject({
      keyVersion: "local-v1",
      event: {
        created_at: event.created_at,
        kind,
        tags: [...event.tags, ["attestation", "local-v1"]],
        content: event.content,
      },
    });

    for (const tags of [
      event.tags.map((tag) =>
        tag[0] === "contract"
          ? [
              "contract",
              contract === "bot.publish@1" ? "bot.update@1" : "bot.publish@1",
            ]
          : tag,
      ),
      event.tags.map((tag) =>
        tag[0] === "actor"
          ? ["actor", "bot", "00000000-0000-8000-8000-000000000299"]
          : tag,
      ),
    ]) {
      const rejected = await requestAttestation({
        purpose: "bot-journal",
        event: { ...event, tags },
      });
      expect(rejected.status).toBe(400);
    }
  });

  it("attests one exact hash-chained Bot journal segment seal", async () => {
    const botId = "00000000-0000-8000-8000-000000000204";
    const segmentHash = "a".repeat(64);
    const previousSegmentHash = "b".repeat(64);
    const eventIds = ["c".repeat(64), "d".repeat(64)];
    const event = {
      created_at: 1_787_313_600,
      kind: 50302,
      tags: [
        ["bot", botId],
        ["start_cursor", "7"],
        ["end_cursor", "8"],
        ["segment_hash", segmentHash],
        ["previous_segment_hash", previousSegmentHash],
      ],
      content: `{"botId":"${botId}","endCursor":8,"eventIds":["${eventIds[0]}","${eventIds[1]}"],"previousSegmentHash":"${previousSegmentHash}","schemaVersion":1,"segmentHash":"${segmentHash}","startCursor":7}`,
    };

    const response = await requestAttestation({
      purpose: "bot-journal-segment",
      event,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      event: {
        kind: 50302,
        content: event.content,
        tags: [...event.tags, ["attestation", "local-v1"]],
      },
    });
  });

  it("attests an exact Installation journal segment without a previous segment", async () => {
    const workspaceId = "00000000-0000-8000-8000-000000000201";
    const installationId = "b8fef268-2a45-8b29-9677-40bb4ec85b5a";
    const segmentHash = "a".repeat(64);
    const eventId = "c".repeat(64);
    const event = {
      created_at: 1_787_313_600,
      kind: 50313,
      tags: [
        ["workspace", workspaceId],
        ["installation", installationId],
        ["start_cursor", "4"],
        ["end_cursor", "4"],
        ["segment_hash", segmentHash],
      ],
      content: `{"endCursor":4,"eventIds":["${eventId}"],"installationId":"${installationId}","previousSegmentHash":null,"schemaVersion":1,"segmentHash":"${segmentHash}","startCursor":4,"workspaceId":"${workspaceId}"}`,
    };

    const response = await requestAttestation({
      purpose: "bot-installation-journal-segment",
      event,
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      event: {
        kind: 50313,
        content: event.content,
        tags: [...event.tags, ["attestation", "local-v1"]],
      },
    });
  });

  it("rejects segment wrong purpose, kind, order, extra tags, range, content, or aggregate substitution", async () => {
    const botId = "00000000-0000-8000-8000-000000000204";
    const anotherBotId = "00000000-0000-8000-8000-000000000205";
    const workspaceId = "00000000-0000-8000-8000-000000000201";
    const anotherWorkspaceId = "00000000-0000-8000-8000-000000000202";
    const installationId = "b8fef268-2a45-8b29-9677-40bb4ec85b5a";
    const anotherInstallationId = "38dbd84c-5dcd-82b4-b0ad-f3aebdadddaa";
    const segmentHash = "a".repeat(64);
    const previousSegmentHash = "b".repeat(64);
    const eventId = "c".repeat(64);
    const botEvent = {
      created_at: 1_787_313_600,
      kind: 50302,
      tags: [
        ["bot", botId],
        ["start_cursor", "4"],
        ["end_cursor", "4"],
        ["segment_hash", segmentHash],
        ["previous_segment_hash", previousSegmentHash],
      ],
      content: `{"botId":"${botId}","endCursor":4,"eventIds":["${eventId}"],"previousSegmentHash":"${previousSegmentHash}","schemaVersion":1,"segmentHash":"${segmentHash}","startCursor":4}`,
    };
    const installationEvent = {
      created_at: 1_787_313_600,
      kind: 50313,
      tags: [
        ["workspace", workspaceId],
        ["installation", installationId],
        ["start_cursor", "4"],
        ["end_cursor", "4"],
        ["segment_hash", segmentHash],
      ],
      content: `{"endCursor":4,"eventIds":["${eventId}"],"installationId":"${installationId}","previousSegmentHash":null,"schemaVersion":1,"segmentHash":"${segmentHash}","startCursor":4,"workspaceId":"${workspaceId}"}`,
    };
    const cases = [
      { purpose: "bot-journal", event: botEvent },
      {
        purpose: "bot-journal-segment",
        event: { ...botEvent, kind: 50313 },
      },
      {
        purpose: "bot-journal-segment",
        event: { ...botEvent, tags: [...botEvent.tags, ["extra", "no"]] },
      },
      {
        purpose: "bot-journal-segment",
        event: {
          ...botEvent,
          tags: [
            ...botEvent.tags.slice(0, 3),
            botEvent.tags[4],
            botEvent.tags[3],
          ],
        },
      },
      {
        purpose: "bot-journal-segment",
        event: {
          ...botEvent,
          content: botEvent.content.replace(botId, anotherBotId),
        },
      },
      {
        purpose: "bot-journal-segment",
        event: { ...botEvent, content: ` ${botEvent.content}` },
      },
      {
        purpose: "bot-journal-segment",
        event: {
          ...botEvent,
          content: botEvent.content.replace(segmentHash, "d".repeat(64)),
        },
      },
      {
        purpose: "bot-journal-segment",
        event: {
          ...botEvent,
          tags: botEvent.tags.map((tag) =>
            tag[0] === "end_cursor" ? ["end_cursor", "5"] : tag,
          ),
        },
      },
      {
        purpose: "bot-journal-segment",
        event: { ...botEvent, content: "x".repeat(65_537) },
      },
      {
        purpose: "bot-installation-journal",
        event: installationEvent,
      },
      {
        purpose: "bot-installation-journal-segment",
        event: {
          ...installationEvent,
          content: installationEvent.content.replace(
            workspaceId,
            anotherWorkspaceId,
          ),
        },
      },
      {
        purpose: "bot-installation-journal-segment",
        event: {
          ...installationEvent,
          content: installationEvent.content.replace(
            installationId,
            anotherInstallationId,
          ),
        },
      },
      {
        purpose: "bot-installation-journal-segment",
        event: {
          ...installationEvent,
          tags: installationEvent.tags.filter(
            ([name]) => name !== "installation",
          ),
        },
      },
    ];

    for (const body of cases) {
      const response = await requestAttestation(body);
      expect(response.status).toBe(400);
    }
  });

  it("attests one exact Bot action admission with Installation-bound actor and derived capability tags", async () => {
    const event = {
      created_at: 1_787_230_900,
      kind: 50320,
      tags: [
        ["workspace", "00000000-0000-8000-8000-000000000201"],
        ["installation", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
        ["bot", "00000000-0000-8000-8000-000000000204"],
        ["cursor", "3"],
        ["command", "00000000-0000-8000-8000-000000000210"],
        ["contract", "bot-action.admit@1"],
        ["actor", "bot", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
        ["admission", "38dbd84c-5dcd-82b4-b0ad-f3aebdadddaa"],
        ["action", "00000000-0000-8000-8000-000000000208", "a".repeat(64)],
        ["action_contract", "message.reaction-toggle@1"],
        ["capability", "messages.react"],
        ["conversation", "00000000-0000-8000-8000-000000000202"],
        ["message", "00000000-0000-8000-8000-000000000203"],
      ],
      content: '{"schemaVersion":1}',
    };

    const accepted = await requestAttestation({
      purpose: "bot-installation-journal",
      event,
    });
    expect(accepted.status).toBe(200);

    for (const tags of [
      event.tags.map((tag) =>
        tag[0] === "actor"
          ? ["actor", "bot", "00000000-0000-8000-8000-000000000299"]
          : tag,
      ),
      event.tags.map((tag) =>
        tag[0] === "action_contract"
          ? ["action_contract", "message.post@1"]
          : tag,
      ),
      event.tags.map((tag) =>
        tag[0] === "capability" ? ["capability", "messages.write"] : tag,
      ),
    ]) {
      const rejected = await requestAttestation({
        purpose: "bot-installation-journal",
        event: { ...event, tags },
      });
      expect(rejected.status).toBe(400);
    }
  });

  it("attests one compact Bot action completion without admission-only tags", async () => {
    const event = {
      created_at: 1_787_230_900,
      kind: 50321,
      tags: [
        ["workspace", "00000000-0000-8000-8000-000000000201"],
        ["installation", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
        ["bot", "00000000-0000-8000-8000-000000000204"],
        ["cursor", "4"],
        ["command", "00000000-0000-8000-8000-000000000214"],
        ["contract", "bot-action.complete@1"],
        ["actor", "bot", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
        ["admission", "38dbd84c-5dcd-82b4-b0ad-f3aebdadddaa"],
        ["action", "00000000-0000-8000-8000-000000000208", "a".repeat(64)],
        ["outcome", "succeeded"],
      ],
      content: '{"schemaVersion":1}',
    };

    const accepted = await requestAttestation({
      purpose: "bot-installation-journal",
      event,
    });
    expect(accepted.status).toBe(200);

    for (const tags of [
      event.tags.map((tag) =>
        tag[0] === "actor"
          ? ["actor", "punk", "00000000-0000-8000-8000-000000000206"]
          : tag,
      ),
      event.tags.map((tag) =>
        tag[0] === "outcome" ? ["outcome", "pending"] : tag,
      ),
      [...event.tags, ["capability", "messages.react"]],
    ]) {
      const rejected = await requestAttestation({
        purpose: "bot-installation-journal",
        event: { ...event, tags },
      });
      expect(rejected.status).toBe(400);
    }
  });

  it.each([
    {
      purpose: "bot-journal",
      event: {
        created_at: 1_787_230_900,
        kind: 50300,
        tags: [
          ["bot", "00000000-0000-8000-8000-000000000204"],
          ["cursor", "1"],
          ["command", "00000000-0000-8000-8000-000000000207"],
          ["contract", "bot.publish@1"],
          ["actor", "punk", "00000000-0000-8000-8000-000000000206"],
        ],
      },
    },
    {
      purpose: "bot-installation-journal",
      event: {
        created_at: 1_787_230_900,
        kind: 50310,
        tags: [
          ["workspace", "00000000-0000-8000-8000-000000000201"],
          ["installation", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
          ["bot", "00000000-0000-8000-8000-000000000204"],
          ["cursor", "1"],
          ["command", "00000000-0000-8000-8000-000000000207"],
          ["contract", "bot-installation.install@1"],
          ["actor", "punk", "00000000-0000-8000-8000-000000000206"],
        ],
      },
    },
  ])("rejects $purpose content exceeding 256 KiB in UTF-8 before signing", async ({
    purpose,
    event,
  }) => {
    const response = await requestAttestation({
      purpose,
      event: { ...event, content: "🔥".repeat(65_537) },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "forbidden",
    });
  });

  it("rejects missing, additional, malformed or cross-purpose Bot authority tags and unlisted kinds", async () => {
    const botEvent = {
      created_at: 1_787_230_900,
      kind: 50300,
      tags: [
        ["bot", "00000000-0000-8000-8000-000000000204"],
        ["cursor", "1"],
        ["command", "00000000-0000-8000-8000-000000000207"],
        ["contract", "bot.publish@1"],
        ["actor", "punk", "00000000-0000-8000-8000-000000000206"],
      ],
      content: '{"schemaVersion":1}',
    };
    const installationEvent = {
      created_at: 1_787_230_900,
      kind: 50310,
      tags: [
        ["workspace", "00000000-0000-8000-8000-000000000201"],
        ["installation", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
        ["bot", "00000000-0000-8000-8000-000000000204"],
        ["cursor", "1"],
        ["command", "00000000-0000-8000-8000-000000000207"],
        ["contract", "bot-installation.install@1"],
        ["actor", "punk", "00000000-0000-8000-8000-000000000206"],
      ],
      content: '{"schemaVersion":1}',
    };
    const cases = [
      {
        purpose: "bot-journal",
        event: {
          ...botEvent,
          tags: botEvent.tags.filter(([name]) => name !== "bot"),
        },
      },
      {
        purpose: "bot-journal",
        event: {
          ...botEvent,
          tags: [
            ...botEvent.tags,
            ["workspace", "00000000-0000-8000-8000-000000000201"],
          ],
        },
      },
      {
        purpose: "bot-journal",
        event: {
          ...botEvent,
          tags: botEvent.tags.map((tag) =>
            tag[0] === "actor" ? [...tag, "unexpected"] : tag,
          ),
        },
      },
      {
        purpose: "bot-installation-journal",
        event: botEvent,
      },
      {
        purpose: "bot-journal",
        event: { ...botEvent, kind: 50302 },
      },
      {
        purpose: "bot-installation-journal",
        event: {
          ...installationEvent,
          tags: installationEvent.tags.filter(
            ([name]) => name !== "installation",
          ),
        },
      },
      {
        purpose: "bot-installation-journal",
        event: {
          ...installationEvent,
          tags: [...installationEvent.tags, ["admission", crypto.randomUUID()]],
        },
      },
      {
        purpose: "bot-installation-journal",
        event: { ...installationEvent, kind: 50313 },
      },
      {
        purpose: "bot-installation-journal",
        event: { ...installationEvent, kind: 50319 },
      },
      {
        purpose: "bot-installation-journal",
        event: { ...installationEvent, kind: 50322 },
      },
    ];

    for (const body of cases) {
      const response = await requestAttestation(body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it.each([
    [50310, "bot-installation.install@1"],
    [50311, "bot-installation.configure@1"],
    [50312, "bot-installation.revoke@1"],
  ] as const)("attests Installation management kind %i only with its exact contract and Punk actor", async (kind, contract) => {
    const event = {
      created_at: 1_787_230_900,
      kind,
      tags: [
        ["workspace", "00000000-0000-8000-8000-000000000201"],
        ["installation", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"],
        ["bot", "00000000-0000-8000-8000-000000000204"],
        ["cursor", "2"],
        ["command", "00000000-0000-8000-8000-000000000207"],
        ["contract", contract],
        ["actor", "punk", "00000000-0000-8000-8000-000000000206"],
      ],
      content: '{"schemaVersion":1}',
    };
    const accepted = await requestAttestation({
      purpose: "bot-installation-journal",
      event,
    });
    expect(accepted.status).toBe(200);

    const wrongContract = await requestAttestation({
      purpose: "bot-installation-journal",
      event: {
        ...event,
        tags: event.tags.map((tag) =>
          tag[0] === "contract" ? ["contract", "bot-action.admit@1"] : tag,
        ),
      },
    });
    expect(wrongContract.status).toBe(400);

    const botActor = await requestAttestation({
      purpose: "bot-installation-journal",
      event: {
        ...event,
        tags: event.tags.map((tag) =>
          tag[0] === "actor"
            ? ["actor", "bot", "b8fef268-2a45-8b29-9677-40bb4ec85b5a"]
            : tag,
        ),
      },
    });
    expect(botActor.status).toBe(400);
  });

  it("fails closed for a caller-supplied attestation tag", async () => {
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "workspace-journal",
          event: {
            created_at: 1,
            kind: 50000,
            tags: [["attestation", "forged"]],
            content: "{}",
          },
        }),
      },
    );
    expect(response.status).toBe(400);
  });

  it("rejects non-contract JSON", async () => {
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({ event: {} }),
      },
    );
    expect(response.status).toBe(400);
  });

  it("does not let a journal request obtain a segment-seal signature", async () => {
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "workspace-journal",
          event: {
            created_at: 1,
            kind: 50002,
            tags: [
              ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
              ["start_cursor", "1"],
              ["end_cursor", "2"],
              ["segment_hash", "a".repeat(64)],
            ],
            content: "{}",
          },
        }),
      },
    );
    expect(response.status).toBe(400);
  });

  it("attests a policy-compliant hash-chained journal segment", async () => {
    const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
    const segmentHash = "a".repeat(64);
    const previousSegmentHash = "b".repeat(64);
    const eventId = "c".repeat(64);
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "workspace-journal-segment",
          event: {
            created_at: 1_787_227_200,
            kind: 50002,
            tags: [
              ["workspace", workspaceId],
              ["start_cursor", "1"],
              ["end_cursor", "1"],
              ["segment_hash", segmentHash],
              ["previous_segment_hash", previousSegmentHash],
            ],
            content: `{"endCursor":1,"eventIds":["${eventId}"],"previousSegmentHash":"${previousSegmentHash}","schemaVersion":1,"segmentHash":"${segmentHash}","startCursor":1,"workspaceId":"${workspaceId}"}`,
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      keyVersion: "local-v1",
      event: {
        kind: 50002,
        tags: expect.arrayContaining([["attestation", "local-v1"]]),
      },
    });
  });

  it("attests a Conversation journal segment only when its aggregate is bound", async () => {
    const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
    const conversationId = "e3a92f8d-f013-46b7-9370-5ca1c79b6280";
    const segmentHash = "a".repeat(64);
    const previousSegmentHash = "b".repeat(64);
    const eventId = "c".repeat(64);
    const event = {
      created_at: 1_787_227_200,
      kind: 50104,
      tags: [
        ["workspace", workspaceId],
        ["conversation", conversationId],
        ["start_cursor", "1"],
        ["end_cursor", "1"],
        ["segment_hash", segmentHash],
        ["previous_segment_hash", previousSegmentHash],
      ],
      content: `{"conversationId":"${conversationId}","endCursor":1,"eventIds":["${eventId}"],"previousSegmentHash":"${previousSegmentHash}","schemaVersion":1,"segmentHash":"${segmentHash}","startCursor":1,"workspaceId":"${workspaceId}"}`,
    };
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "conversation-journal-segment",
          event,
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      keyVersion: "local-v1",
      event: {
        kind: 50104,
        tags: expect.arrayContaining([
          ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
          ["attestation", "local-v1"],
        ]),
      },
    });

    const withoutConversation = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "conversation-journal-segment",
          event: {
            ...event,
            tags: event.tags.filter(([name]) => name !== "conversation"),
          },
        }),
      },
    );
    expect(withoutConversation.status).toBe(400);
  });

  it.each([
    [
      "Workspace",
      "workspace-journal-segment",
      {
        created_at: 1_787_227_200,
        kind: 50002,
        tags: [
          ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
          ["start_cursor", "1"],
          ["end_cursor", "1"],
          ["segment_hash", "a".repeat(64)],
        ],
        content: `{"endCursor":1,"eventIds":["${"c".repeat(64)}"],"previousSegmentHash":null,"schemaVersion":1,"segmentHash":"${"a".repeat(64)}","startCursor":1,"workspaceId":"58975ca8-3b75-42c7-a13a-51c9d7306200"}`,
      },
    ],
    [
      "Conversation",
      "conversation-journal-segment",
      {
        created_at: 1_787_227_200,
        kind: 50104,
        tags: [
          ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
          ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
          ["start_cursor", "1"],
          ["end_cursor", "1"],
          ["segment_hash", "a".repeat(64)],
        ],
        content: `{"conversationId":"e3a92f8d-f013-46b7-9370-5ca1c79b6280","endCursor":1,"eventIds":["${"c".repeat(64)}"],"previousSegmentHash":null,"schemaVersion":1,"segmentHash":"${"a".repeat(64)}","startCursor":1,"workspaceId":"58975ca8-3b75-42c7-a13a-51c9d7306200"}`,
      },
    ],
  ] as const)("rejects %s seals with extra, reordered, or content-substituted authority", async (_aggregate, purpose, event) => {
    const cases = [
      { ...event, tags: [...event.tags, ["extra", "forbidden"]] },
      {
        ...event,
        tags: [event.tags[1], event.tags[0], ...event.tags.slice(2)],
      },
      { ...event, content: "{}" },
    ];
    for (const candidate of cases) {
      const response = await requestAttestation({ purpose, event: candidate });
      expect(response.status).toBe(400);
    }
  });

  it("attests a canonical Workspace membership event", async () => {
    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "workspace-journal",
          event: {
            created_at: 1_787_227_200,
            kind: 50003,
            tags: [
              ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
              ["cursor", "2"],
              ["command", "47da754e-dcd3-4c39-aeca-8fb1454a57ed"],
              ["contract", "workspace.member-set-role@1"],
              ["actor", "punk", "00000000-0000-8000-8000-000000000001"],
              ["target", "punk", "00000000-0000-8000-8000-000000000002"],
            ],
            content: "{}",
          },
        }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      event: { kind: 50003 },
    });
  });

  it("attests a Conversation event only under the Conversation policy", async () => {
    const request = {
      event: {
        created_at: 1_787_230_800,
        kind: 50100,
        tags: [
          ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
          ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
          ["cursor", "1"],
          ["command", "786ed512-b403-4aab-b397-f5c4eab4d797"],
          ["contract", "conversation.create@1"],
          ["actor", "punk", "punk_owner"],
          ["workspace_cursor", "7"],
          ["workspace_role", "owner"],
        ],
        content: "{}",
      },
    };
    const wrongPurpose = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({ purpose: "workspace-journal", ...request }),
      },
    );
    expect(wrongPurpose.status).toBe(400);

    const response = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({ purpose: "conversation-journal", ...request }),
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      event: { kind: 50100 },
    });
  });

  it.each([
    [50105, "conversation.update@1"],
    [50106, "conversation.archive@1"],
    [50107, "conversation.restore@1"],
  ] as const)("attests Conversation lifecycle kind %i only with its canonical contract", async (kind, contract) => {
    const event = {
      created_at: 1_787_230_800,
      kind,
      tags: [
        ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
        ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
        ["cursor", "2"],
        ["command", "117faaf2-f913-4f89-9892-a6bcae7d26ce"],
        ["contract", contract],
        ["actor", "punk", "punk_owner"],
        ["workspace_cursor", "7"],
        ["workspace_role", "owner"],
      ],
      content: "{}",
    };
    const accepted = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({ purpose: "conversation-journal", event }),
      },
    );
    expect(accepted.status).toBe(200);

    const mismatched = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "conversation-journal",
          event: {
            ...event,
            tags: event.tags.map((tag) =>
              tag[0] === "contract"
                ? ["contract", "conversation.create@1"]
                : tag,
            ),
          },
        }),
      },
    );
    expect(mismatched.status).toBe(400);
  });

  it("attests only the exact actor and contract for each private Message journal kind", async () => {
    const event = {
      created_at: 1_787_230_900,
      kind: 50200,
      tags: [
        ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
        ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
        ["message", "9ec4ad7e-b4b0-4e25-ae11-8ec5f3dcfd17"],
        ["cursor", "2"],
        ["workspace_cursor", "7"],
        ["conversation_cursor", "2"],
        ["command", "8f81d587-27b6-4be3-9b55-902c90bcc21c"],
        ["contract", "message.post@1"],
        ["actor", "punk", "00000000-0000-8000-8000-000000000001"],
      ],
      content:
        '{"schemaVersion":1,"message":{"topicPresent":true},"versionDelta":{"operation":"retain"}}',
    };
    const accepted = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({ purpose: "message-journal", event }),
      },
    );
    expect(accepted.status).toBe(200);

    for (const [kind, contract] of [
      [50201, "message.edit@1"],
      [50202, "message.retract@1"],
      [50203, "message.restore@1"],
    ] as const) {
      const mutation = await SELF.fetch(
        "https://attestation.invalid/internal/v1/attest",
        {
          method: "POST",
          body: JSON.stringify({
            purpose: "message-journal",
            event: {
              ...event,
              kind,
              tags: event.tags.map((tag) =>
                tag[0] === "contract" ? ["contract", contract] : tag,
              ),
            },
          }),
        },
      );
      expect(mutation.status).toBe(200);
    }

    const erasure = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "message-journal",
          event: {
            ...event,
            kind: 50204,
            tags: event.tags
              .filter(
                (tag) =>
                  tag[0] !== "workspace_cursor" &&
                  tag[0] !== "conversation_cursor",
              )
              .map((tag) =>
                tag[0] === "contract"
                  ? ["contract", "message.finalize-erasure@1"]
                  : tag[0] === "actor"
                    ? ["actor", "service", "crypto-erasure"]
                    : tag,
              ),
          },
        }),
      },
    );
    expect(erasure.status).toBe(200);

    const bot = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "message-journal",
          event: {
            ...event,
            tags: event.tags.map((tag) =>
              tag[0] === "actor" ? ["actor", "bot", tag[2]] : tag,
            ),
          },
        }),
      },
    );
    expect(bot.status).toBe(400);
  });

  it("attests bounded Punk and Bot Reaction events with exact authority tags", async () => {
    const event = {
      created_at: 1_787_230_900,
      kind: 50210,
      tags: [
        ["workspace", "58975ca8-3b75-42c7-a13a-51c9d7306200"],
        ["conversation", "e3a92f8d-f013-46b7-9370-5ca1c79b6280"],
        ["message", "9ec4ad7e-b4b0-4e25-ae11-8ec5f3dcfd17"],
        ["reaction_entity", "7172efb7-9ead-4e24-aee4-4be733834800"],
        ["cursor", "3"],
        ["workspace_cursor", "7"],
        ["conversation_cursor", "3"],
        ["command", "8f81d587-27b6-4be3-9b55-902c90bcc21c"],
        ["contract", "message.reaction-add@1"],
        ["actor", "punk", "00000000-0000-8000-8000-000000000001"],
      ],
      content: '{"schemaVersion":1}',
    };

    const punk = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({ purpose: "message-journal", event }),
      },
    );
    expect(punk.status).toBe(200);

    const botTags = [
      ...event.tags.slice(0, 5),
      ["installation_cursor", "17"],
      ["admission", "00000000-0000-8000-8000-000000000003"],
      ["action", "00000000-0000-8000-8000-000000000004", "ab".repeat(32)],
      ...event.tags
        .slice(6)
        .map((tag) =>
          tag[0] === "contract"
            ? ["contract", "message.reaction-remove@1"]
            : tag[0] === "actor"
              ? ["actor", "bot", "00000000-0000-8000-8000-000000000002"]
              : tag,
        ),
    ];
    const bot = await SELF.fetch(
      "https://attestation.invalid/internal/v1/attest",
      {
        method: "POST",
        body: JSON.stringify({
          purpose: "message-journal",
          event: {
            ...event,
            kind: 50211,
            tags: botTags,
          },
        }),
      },
    );
    expect(bot.status).toBe(200);

    for (const tags of [
      botTags.map((tag) =>
        tag[0] === "installation_cursor"
          ? ["workspace_cursor", tag[1] ?? ""]
          : tag,
      ),
      [...botTags, ["workspace_cursor", "7"]],
      botTags.filter(([name]) => name !== "admission"),
      botTags.map((tag) =>
        tag[0] === "action" ? ["action", tag[1] ?? "", "not-a-digest"] : tag,
      ),
    ]) {
      const rejected = await SELF.fetch(
        "https://attestation.invalid/internal/v1/attest",
        {
          method: "POST",
          body: JSON.stringify({
            purpose: "message-journal",
            event: { ...event, kind: 50211, tags },
          }),
        },
      );
      expect(rejected.status).toBe(400);
    }

    for (const tags of [
      event.tags.filter(([name]) => name !== "reaction_entity"),
      event.tags.map((tag) =>
        tag[0] === "contract" ? ["contract", "message.reaction-remove@1"] : tag,
      ),
      event.tags.map((tag) =>
        tag[0] === "actor" ? ["actor", "service", "reaction"] : tag,
      ),
    ]) {
      const rejected = await SELF.fetch(
        "https://attestation.invalid/internal/v1/attest",
        {
          method: "POST",
          body: JSON.stringify({
            purpose: "message-journal",
            event: { ...event, tags },
          }),
        },
      );
      expect(rejected.status).toBe(400);
    }
  });
});
