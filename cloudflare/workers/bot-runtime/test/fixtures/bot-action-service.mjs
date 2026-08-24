import { WorkerEntrypoint } from "cloudflare:workers";

const seenActions = new Set();

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

export class BotActionService extends WorkerEntrypoint {
  async executeBotAction(input) {
    const props = this.ctx.props;
    if (
      props === null ||
      typeof props !== "object" ||
      Array.isArray(props) ||
      Object.keys(props).sort().join(",") !== "environment,role" ||
      props.role !== "punks-bot-runtime" ||
      props.environment !== "local"
    ) {
      return { ok: false, code: "forbidden" };
    }
    if (input.action.payload.reaction === "temporary") {
      return { ok: false, code: "temporarily_unavailable" };
    }
    if (input.action.payload.reaction === "forbidden") {
      return { ok: false, code: "forbidden" };
    }
    const actionKey = `${input.installationId}:${input.actionId}`;
    const replayed = seenActions.has(actionKey);
    seenActions.add(actionKey);
    return {
      ok: true,
      admissionId: await deriveOpaqueUuid(
        "punks.bot-action-admission.v1",
        `${input.installationId}\0${input.actionId}`,
      ),
      replayed,
    };
  }
}
