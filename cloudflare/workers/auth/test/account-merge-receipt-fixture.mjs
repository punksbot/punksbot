import { WorkerEntrypoint } from "cloudflare:workers";

const receipts = new Map();

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value) {
  const result = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class AccountMergeReceiptRegistryService extends WorkerEntrypoint {
  #allowed() {
    return (
      this.ctx.props?.role === "punks-account-merge-receipt-writer" &&
      this.ctx.props?.environment === "local" &&
      Object.keys(this.ctx.props).sort().join(",") === "environment,role"
    );
  }

  async recordAccountMergeReceipt(input) {
    if (!this.#allowed()) return { ok: false, code: "invalid_request" };
    const existing = receipts.get(input.absorbedPunkId);
    if (existing !== undefined) {
      const same = [
        "receiptId",
        "intentId",
        "planId",
        "planDigest",
        "commitCommandId",
        "survivorPunkId",
        "absorbedPunkId",
      ].every((key) => existing.receipt[key] === input[key]);
      const sameRevisions =
        existing.receipt.accountRevisions.survivor ===
          input.accountRevisions.survivor &&
        existing.receipt.accountRevisions.absorbed ===
          input.accountRevisions.absorbed;
      return same &&
        sameRevisions &&
        existing.recoveryDescriptor === input.recoveryDescriptor
        ? {
            ok: true,
            receipt: structuredClone(existing.receipt),
            replayed: true,
          }
        : { ok: false, code: "conflict" };
    }
    const { recoveryDescriptor, ...decision } = structuredClone(input);
    const draft = {
      contract: "account-merge.receipt@1",
      schemaVersion: 1,
      ...decision,
      committedAt: new Date().toISOString(),
    };
    const receipt = { ...draft, receiptHash: await digest(canonical(draft)) };
    receipts.set(input.absorbedPunkId, {
      receipt,
      recoveryDescriptor,
    });
    return { ok: true, receipt: structuredClone(receipt), replayed: false };
  }

  lookupAccountMergeReceipt(input) {
    if (!this.#allowed()) return { ok: false, code: "invalid_request" };
    return {
      ok: true,
      receipt: structuredClone(
        receipts.get(input.absorbedPunkId)?.receipt ?? null,
      ),
    };
  }

  lookupAccountMergeRecovery(input) {
    if (!this.#allowed()) return { ok: false, code: "invalid_request" };
    const existing = receipts.get(input.absorbedPunkId);
    return {
      ok: true,
      receipt: structuredClone(existing?.receipt ?? null),
      recoveryDescriptor: existing?.recoveryDescriptor ?? null,
    };
  }

  overrideFetch() {
    return new Response(null, { status: 404 });
  }

  fetch() {
    return this.overrideFetch();
  }
}

export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
