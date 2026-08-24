import { WorkerEntrypoint } from "cloudflare:workers";

const audits = new Map();
const scenarios = new Map();

function exactRuntimeProps(props) {
  return (
    props !== null &&
    typeof props === "object" &&
    !Array.isArray(props) &&
    Object.keys(props).sort().join(",") === "environment,role" &&
    props.role === "punks-bot-runtime" &&
    props.environment === "local"
  );
}

async function deriveOpaqueUuid(namespace, value) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${namespace}\0${value}`),
    ),
  );
  digest[6] = (digest[6] & 15) | 128;
  digest[8] = (digest[8] & 63) | 128;
  const hex = [...digest.subarray(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function auditFor(wakeId) {
  const existing = audits.get(wakeId);
  if (existing !== undefined) {
    return existing;
  }
  const audit = { claims: [], reads: [], completions: [] };
  audits.set(wakeId, audit);
  return audit;
}

function offer(input) {
  return {
    contract: "bot-wake.offer@1",
    wakeId: input.wakeId,
    workspaceId: "10000000-0000-8000-8000-000000000001",
    installationId: input.installationId,
    botId: "a0000000-0000-8000-8000-000000000003",
    conversationId: "50000000-0000-8000-8000-000000000005",
    messageId: "60000000-0000-8000-8000-000000000006",
    messageCursor: 42,
    subscriptionEpoch: 7,
    runtimeRelease: {
      releaseId: "punks.reaction-turn.v1",
      releaseDigest:
        "fe075600eab020932774516439f643e8b83f62a10245e6388ee25bbf61aa837f",
    },
    sourceEventId: "a".repeat(64),
    sourceEventDigest: "b".repeat(64),
    createdAt: "2026-08-21T00:00:00.000Z",
  };
}

export class BotHarnessService extends WorkerEntrypoint {
  async claimWake(input) {
    if (!exactRuntimeProps(this.ctx.props)) {
      return {
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "authority_revoked",
      };
    }
    auditFor(input.wakeId).claims.push(structuredClone(input));
    if (scenarios.get(input.wakeId) === "claim-temporarily-unavailable") {
      return {
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "temporarily_unavailable",
      };
    }
    if (scenarios.get(input.wakeId) === "mismatched-terminal") {
      const turnId = await deriveOpaqueUuid(
        "punks.bot-wake.turn-id.v1",
        input.wakeId,
      );
      return {
        contract: "bot-wake.claim-result@1",
        ok: true,
        status: "terminal",
        receipt: {
          schemaVersion: 1,
          offer: {
            ...offer(input),
            installationId: "20000000-0000-8000-8000-00000000000a",
          },
          turnId,
          claimedAt: "2026-08-21T00:00:01.000Z",
          completedAt: "2026-08-21T00:00:02.000Z",
          terminal: {
            outcome: "succeeded",
            decision: "skip",
            reason: "model_selected_skip",
          },
        },
        replayed: true,
      };
    }
    return {
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "claimed",
      offer: offer(input),
      turnId: await deriveOpaqueUuid("punks.bot-wake.turn-id.v1", input.wakeId),
      claimedAt: "2026-08-21T00:00:01.000Z",
      replayed: false,
    };
  }

  async readWakeContext(input) {
    if (!exactRuntimeProps(this.ctx.props)) {
      return { ok: false, code: "authority_revoked" };
    }
    auditFor(input.wakeId).reads.push(structuredClone(input));
    if (scenarios.get(input.wakeId) === "temporarily-unavailable") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    return { ok: true, content: "SENSITIVE_WORKFLOW_SENTINEL" };
  }

  async completeWake(input) {
    if (!exactRuntimeProps(this.ctx.props)) {
      return {
        contract: "bot-wake.claim-result@1",
        ok: false,
        code: "authority_revoked",
      };
    }
    auditFor(input.wakeId).completions.push(structuredClone(input));
    return {
      contract: "bot-wake.claim-result@1",
      ok: true,
      status: "terminal",
      receipt: {
        schemaVersion: 1,
        offer: offer(input),
        turnId: input.turnId,
        claimedAt: "2026-08-21T00:00:01.000Z",
        completedAt: "2026-08-21T00:00:02.000Z",
        terminal: structuredClone(input.terminal),
      },
      replayed: true,
    };
  }
}

export class BotHarnessAudit extends WorkerEntrypoint {
  configure(wakeId, scenario) {
    scenarios.set(wakeId, scenario);
  }

  getAudit(wakeId) {
    return structuredClone(
      audits.get(wakeId) ?? { claims: [], reads: [], completions: [] },
    );
  }
}
