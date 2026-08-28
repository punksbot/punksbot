const bytesToHex = (bytes) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
const failureCounts = new Map();
const calls = [];
let rejectJournalArchive = false;
const failOnceCommandIds = new Set([
  "8a3837bd-6d5b-4f43-b5a5-cd50208a2c53",
  "91b49ce8-fc79-44c2-bc25-06e8d067f802",
  "dfcb14f1-c2b7-8119-bf0c-9d545adee869",
  "04000000-0000-4000-8000-000000000099",
  "04000000-0000-4000-8000-000000000096",
  "56000000-0000-4000-8000-000000000020",
  "6f000000-0000-8000-8000-000000000001",
  "b3750000-0000-8000-8000-000000000003",
]);
const delayedCommandIds = new Set([
  "ae14f42a-8762-4e2e-bd7b-c2fbaddf3f18",
  "04000000-0000-4000-8000-000000000098",
  "53000000-0000-4000-8000-000000000070",
  "56000000-0000-4000-8000-000000000070",
]);

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/__test/calls") {
      return Response.json({ calls });
    }
    if (
      request.method === "POST" &&
      url.pathname === "/__test/archive-failure"
    ) {
      const body = await request.json();
      rejectJournalArchive = body.reject === true;
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/__test/fail-once") {
      const body = await request.json();
      if (typeof body.commandId !== "string") {
        return Response.json({ ok: false }, { status: 400 });
      }
      failureCounts.delete(body.commandId);
      failOnceCommandIds.add(body.commandId);
      return Response.json({ ok: true });
    }
    const body = await request.json();
    calls.push(structuredClone(body));
    if (
      rejectJournalArchive &&
      (body.purpose === "conversation-journal-segment" ||
        body.purpose === "bot-journal-segment" ||
        body.purpose === "bot-installation-journal-segment")
    ) {
      return Response.json({ code: "attestation_failed" }, { status: 503 });
    }
    const commandId = body.event.tags.find((tag) => tag[0] === "command")?.[1];
    const contract = body.event.tags.find((tag) => tag[0] === "contract")?.[1];
    const failsOnce =
      body.event.content.includes("retry-attestation") ||
      body.event.content.includes("retry-rename") ||
      contract === "message.finalize-erasure@1" ||
      failOnceCommandIds.has(commandId);
    const failureKey = commandId ?? body.event.content;
    const failures = failureCounts.get(failureKey) ?? 0;
    const maximumFailures = contract === "message.finalize-erasure@1" ? 2 : 1;
    if (failsOnce && failures < maximumFailures) {
      failureCounts.set(failureKey, failures + 1);
      return Response.json({ code: "attestation_failed" }, { status: 503 });
    }
    if (delayedCommandIds.has(commandId)) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    const pubkey =
      "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const event = {
      ...body.event,
      tags: [...body.event.tags, ["attestation", "test-v1"]],
    };
    if (
      commandId === "51000000-0000-4000-8000-000000000099" ||
      commandId === "51000000-0000-4000-8000-000000000098"
    ) {
      event.tags.push(["unauthorized", "extra-tag"]);
    }
    if (commandId === "04000000-0000-4000-8000-000000000097") {
      event.kind = event.kind === 50210 ? 50211 : 50210;
    }
    if (commandId === "90000000-0000-8000-8000-000000000002") {
      event.content = `${event.content} `;
    }
    const serialized = JSON.stringify([
      0,
      pubkey,
      event.created_at,
      event.kind,
      event.tags,
      event.content,
    ]);
    const id = bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(serialized),
        ),
      ),
    );
    const signature = bytesToHex(
      schnorr.sign(
        new Uint8Array(
          id.match(/.{2}/g).map((byte) => Number.parseInt(byte, 16)),
        ),
        new Uint8Array(32).fill(0).map((_, index) => (index === 31 ? 1 : 0)),
      ),
    );
    const responseSignature =
      commandId === "90000000-0000-8000-8000-000000000001"
        ? "0".repeat(128)
        : signature;
    return Response.json({
      keyVersion:
        commandId === "90000000-0000-8000-8000-000000000003"
          ? "test-v2"
          : "test-v1",
      event: { ...event, id, pubkey, sig: responseSignature },
    });
  },
};
import { schnorr } from "@noble/curves/secp256k1.js";
