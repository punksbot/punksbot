import type {
  AttestationRequest,
  AttestationResponse,
  PunksProblem,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import { attestNostrEvent } from "./nostr";

interface AttestationEnv extends CloudflareBindings {
  ATTESTATION_PRIVATE_KEY: string;
}

/** Dedicated private probe for the version executing this Attestation Worker. */
export class RuntimeIdentityService extends WorkerEntrypoint<AttestationEnv> {
  override fetch(): Response {
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }

  runtimeVersion(): { versionId: string } {
    return { versionId: this.env.CF_VERSION_METADATA.id };
  }
}

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: jsonHeaders });
}

function problem(
  status: number,
  code: PunksProblem["code"],
  title: string,
): Response {
  const body: PunksProblem = {
    type: `https://punks.bot/problems/${code.replaceAll("_", "-")}`,
    title,
    status,
    code,
    correlationId: crypto.randomUUID(),
    retry: status >= 500 ? "same_command" : "never",
  };
  return json(body, status);
}

async function readLimitedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBytes || request.body === null) {
    throw new RangeError("Attestation body is missing or too large");
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("Attestation body is too large");
      throw new RangeError("Attestation body is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}

function hasExactlyOneTag(
  request: AttestationRequest,
  name: string,
  valuePattern: RegExp,
): boolean {
  const matches = request.event.tags.filter(([tagName]) => tagName === name);
  return matches.length === 1 && valuePattern.test(matches[0]?.[1] ?? "");
}

function hasExactActorTag(
  request: AttestationRequest,
  kind: "bot" | "punk" | "service",
  idPattern: RegExp,
): boolean {
  const matches = request.event.tags.filter(([tagName]) => tagName === "actor");
  const actor = matches[0];
  return (
    matches.length === 1 &&
    actor?.length === 3 &&
    actor[1] === kind &&
    idPattern.test(actor[2] ?? "")
  );
}

const opaqueUuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const positiveCursorPattern = /^[1-9][0-9]*$/;
const maximumEventContentBytes = 256 * 1_024;
const maximumSegmentSealContentBytes = 64 * 1_024;
const hashPattern = /^[0-9a-f]{64}$/;

function hasBoundedEventContent(request: AttestationRequest): boolean {
  return (
    new TextEncoder().encode(request.event.content).byteLength <=
    maximumEventContentBytes
  );
}

function reactionJournalPolicyAllows(
  request: AttestationRequest,
  expectedContracts: readonly string[],
): boolean {
  const tags = request.event.tags;
  const commonPrefix =
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "conversation", [opaqueUuidPattern]) &&
    tagMatches(tags[2], "message", [opaqueUuidPattern]) &&
    tagMatches(tags[3], "reaction_entity", [opaqueUuidPattern]) &&
    tagMatches(tags[4], "cursor", [positiveCursorPattern]);
  if (!commonPrefix) {
    return false;
  }
  if (tags.length === 10) {
    return (
      tagMatches(tags[5], "workspace_cursor", [positiveCursorPattern]) &&
      tagMatches(tags[6], "conversation_cursor", [positiveCursorPattern]) &&
      tagMatches(tags[7], "command", [opaqueUuidPattern]) &&
      tagMatches(tags[8], "contract", [
        new RegExp(
          `^(?:${expectedContracts
            .map((contract) => contract.replaceAll(".", "\\."))
            .join("|")})$`,
        ),
      ]) &&
      tagMatches(tags[9], "actor", ["punk", opaqueUuidPattern])
    );
  }
  return (
    tags.length === 12 &&
    tagMatches(tags[5], "installation_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[6], "admission", [opaqueUuidPattern]) &&
    tagMatches(tags[7], "action", [opaqueUuidPattern, hashPattern]) &&
    tagMatches(tags[8], "conversation_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[9], "command", [opaqueUuidPattern]) &&
    tagMatches(tags[10], "contract", [
      new RegExp(
        `^(?:${expectedContracts
          .map((contract) => contract.replaceAll(".", "\\."))
          .join("|")})$`,
      ),
    ]) &&
    tagMatches(tags[11], "actor", ["bot", opaqueUuidPattern])
  );
}

function tagMatches(
  tag: string[] | undefined,
  name: string,
  values: readonly (string | RegExp)[],
): boolean {
  return (
    tag?.length === values.length + 1 &&
    tag[0] === name &&
    values.every((expected, index) => {
      const value = tag[index + 1] ?? "";
      return typeof expected === "string"
        ? value === expected
        : expected.test(value);
    })
  );
}

function botJournalPolicyAllows(request: AttestationRequest): boolean {
  const expectedContract =
    request.event.kind === 50300
      ? "bot.publish@1"
      : request.event.kind === 50301
        ? "bot.update@1"
        : null;
  const tags = request.event.tags;
  return (
    expectedContract !== null &&
    hasBoundedEventContent(request) &&
    tags.length === 5 &&
    tagMatches(tags[0], "bot", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "cursor", [positiveCursorPattern]) &&
    tagMatches(tags[2], "command", [opaqueUuidPattern]) &&
    tagMatches(tags[3], "contract", [expectedContract]) &&
    tagMatches(tags[4], "actor", ["punk", opaqueUuidPattern])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("Canonical JSON rejects non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (!isRecord(value)) {
    throw new TypeError("Canonical JSON rejects unsupported values");
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function segmentSealContentMatches(
  request: AttestationRequest,
  coordinates: Readonly<Record<string, string>>,
  startCursor: string,
  endCursor: string,
  segmentHash: string,
  previousSegmentHash: string | null,
): boolean {
  if (
    new TextEncoder().encode(request.event.content).byteLength >
    maximumSegmentSealContentBytes
  ) {
    return false;
  }
  let content: unknown;
  try {
    content = JSON.parse(request.event.content);
  } catch {
    return false;
  }
  if (!isRecord(content) || canonicalJson(content) !== request.event.content) {
    return false;
  }
  const expectedKeys = [
    ...Object.keys(coordinates),
    "endCursor",
    "eventIds",
    "previousSegmentHash",
    "schemaVersion",
    "segmentHash",
    "startCursor",
  ].sort();
  if (
    JSON.stringify(Object.keys(content).sort()) !== JSON.stringify(expectedKeys)
  ) {
    return false;
  }
  const parsedStartCursor = Number(startCursor);
  const parsedEndCursor = Number(endCursor);
  const eventIds = content.eventIds;
  return (
    Object.entries(coordinates).every(
      ([name, value]) => content[name] === value,
    ) &&
    content.schemaVersion === 1 &&
    content.startCursor === parsedStartCursor &&
    content.endCursor === parsedEndCursor &&
    content.segmentHash === segmentHash &&
    content.previousSegmentHash === previousSegmentHash &&
    Number.isSafeInteger(parsedStartCursor) &&
    parsedStartCursor >= 1 &&
    Number.isSafeInteger(parsedEndCursor) &&
    parsedEndCursor >= parsedStartCursor &&
    Array.isArray(eventIds) &&
    eventIds.length >= 1 &&
    eventIds.length <= 500 &&
    parsedEndCursor - parsedStartCursor + 1 === eventIds.length &&
    eventIds.every(
      (eventId) => typeof eventId === "string" && hashPattern.test(eventId),
    )
  );
}

function botJournalSegmentPolicyAllows(request: AttestationRequest): boolean {
  const tags = request.event.tags;
  const withPrevious = tags.length === 5;
  const botId = tags[0]?.[1] ?? "";
  const startCursor = tags[1]?.[1] ?? "";
  const endCursor = tags[2]?.[1] ?? "";
  const segmentHash = tags[3]?.[1] ?? "";
  const previousSegmentHash = withPrevious ? (tags[4]?.[1] ?? "") : null;
  return (
    request.event.kind === 50302 &&
    (tags.length === 4 || withPrevious) &&
    tagMatches(tags[0], "bot", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "start_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[2], "end_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[3], "segment_hash", [hashPattern]) &&
    (!withPrevious ||
      tagMatches(tags[4], "previous_segment_hash", [hashPattern])) &&
    segmentSealContentMatches(
      request,
      { botId },
      startCursor,
      endCursor,
      segmentHash,
      previousSegmentHash,
    )
  );
}

function botInstallationJournalSegmentPolicyAllows(
  request: AttestationRequest,
): boolean {
  const tags = request.event.tags;
  const withPrevious = tags.length === 6;
  const workspaceId = tags[0]?.[1] ?? "";
  const installationId = tags[1]?.[1] ?? "";
  const startCursor = tags[2]?.[1] ?? "";
  const endCursor = tags[3]?.[1] ?? "";
  const segmentHash = tags[4]?.[1] ?? "";
  const previousSegmentHash = withPrevious ? (tags[5]?.[1] ?? "") : null;
  return (
    request.event.kind === 50313 &&
    (tags.length === 5 || withPrevious) &&
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "installation", [opaqueUuidPattern]) &&
    tagMatches(tags[2], "start_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[3], "end_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[4], "segment_hash", [hashPattern]) &&
    (!withPrevious ||
      tagMatches(tags[5], "previous_segment_hash", [hashPattern])) &&
    segmentSealContentMatches(
      request,
      { workspaceId, installationId },
      startCursor,
      endCursor,
      segmentHash,
      previousSegmentHash,
    )
  );
}

function workspaceJournalSegmentPolicyAllows(
  request: AttestationRequest,
): boolean {
  const tags = request.event.tags;
  const withPrevious = tags.length === 5;
  const workspaceId = tags[0]?.[1] ?? "";
  const startCursor = tags[1]?.[1] ?? "";
  const endCursor = tags[2]?.[1] ?? "";
  const segmentHash = tags[3]?.[1] ?? "";
  const previousSegmentHash = withPrevious ? (tags[4]?.[1] ?? "") : null;
  return (
    request.event.kind === 50002 &&
    (tags.length === 4 || withPrevious) &&
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "start_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[2], "end_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[3], "segment_hash", [hashPattern]) &&
    (!withPrevious ||
      tagMatches(tags[4], "previous_segment_hash", [hashPattern])) &&
    segmentSealContentMatches(
      request,
      { workspaceId },
      startCursor,
      endCursor,
      segmentHash,
      previousSegmentHash,
    )
  );
}

function conversationJournalSegmentPolicyAllows(
  request: AttestationRequest,
): boolean {
  const tags = request.event.tags;
  const withPrevious = tags.length === 6;
  const workspaceId = tags[0]?.[1] ?? "";
  const conversationId = tags[1]?.[1] ?? "";
  const startCursor = tags[2]?.[1] ?? "";
  const endCursor = tags[3]?.[1] ?? "";
  const segmentHash = tags[4]?.[1] ?? "";
  const previousSegmentHash = withPrevious ? (tags[5]?.[1] ?? "") : null;
  return (
    request.event.kind === 50104 &&
    (tags.length === 5 || withPrevious) &&
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "conversation", [opaqueUuidPattern]) &&
    tagMatches(tags[2], "start_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[3], "end_cursor", [positiveCursorPattern]) &&
    tagMatches(tags[4], "segment_hash", [hashPattern]) &&
    (!withPrevious ||
      tagMatches(tags[5], "previous_segment_hash", [hashPattern])) &&
    segmentSealContentMatches(
      request,
      { workspaceId, conversationId },
      startCursor,
      endCursor,
      segmentHash,
      previousSegmentHash,
    )
  );
}

function botActionAdmissionPolicyAllows(request: AttestationRequest): boolean {
  const tags = request.event.tags;
  const installationId = tags[1]?.[1] ?? "";
  return (
    request.event.kind === 50320 &&
    tags.length === 13 &&
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "installation", [opaqueUuidPattern]) &&
    tagMatches(tags[2], "bot", [opaqueUuidPattern]) &&
    tagMatches(tags[3], "cursor", [positiveCursorPattern]) &&
    tagMatches(tags[4], "command", [opaqueUuidPattern]) &&
    tagMatches(tags[5], "contract", ["bot-action.admit@1"]) &&
    tagMatches(tags[6], "actor", ["bot", installationId]) &&
    tagMatches(tags[7], "admission", [opaqueUuidPattern]) &&
    tagMatches(tags[8], "action", [opaqueUuidPattern, /^[0-9a-f]{64}$/]) &&
    tagMatches(tags[9], "action_contract", [
      /^(message\.reaction-add@1|message\.reaction-remove@1|message\.reaction-toggle@1)$/,
    ]) &&
    tagMatches(tags[10], "capability", ["messages.react"]) &&
    tagMatches(tags[11], "conversation", [opaqueUuidPattern]) &&
    tagMatches(tags[12], "message", [opaqueUuidPattern])
  );
}

function botActionCompletionPolicyAllows(request: AttestationRequest): boolean {
  const tags = request.event.tags;
  const installationId = tags[1]?.[1] ?? "";
  return (
    request.event.kind === 50321 &&
    tags.length === 10 &&
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "installation", [opaqueUuidPattern]) &&
    tagMatches(tags[2], "bot", [opaqueUuidPattern]) &&
    tagMatches(tags[3], "cursor", [positiveCursorPattern]) &&
    tagMatches(tags[4], "command", [opaqueUuidPattern]) &&
    tagMatches(tags[5], "contract", ["bot-action.complete@1"]) &&
    tagMatches(tags[6], "actor", ["bot", installationId]) &&
    tagMatches(tags[7], "admission", [opaqueUuidPattern]) &&
    tagMatches(tags[8], "action", [opaqueUuidPattern, /^[0-9a-f]{64}$/]) &&
    tagMatches(tags[9], "outcome", [/^(succeeded|failed)$/])
  );
}

function botInstallationJournalPolicyAllows(
  request: AttestationRequest,
): boolean {
  if (!hasBoundedEventContent(request)) {
    return false;
  }
  if (request.event.kind === 50320) {
    return botActionAdmissionPolicyAllows(request);
  }
  if (request.event.kind === 50321) {
    return botActionCompletionPolicyAllows(request);
  }
  const expectedContract =
    request.event.kind === 50310
      ? "bot-installation.install@1"
      : request.event.kind === 50311
        ? "bot-installation.configure@1"
        : request.event.kind === 50312
          ? "bot-installation.revoke@1"
          : null;
  const tags = request.event.tags;
  return (
    expectedContract !== null &&
    tags.length === 7 &&
    tagMatches(tags[0], "workspace", [opaqueUuidPattern]) &&
    tagMatches(tags[1], "installation", [opaqueUuidPattern]) &&
    tagMatches(tags[2], "bot", [opaqueUuidPattern]) &&
    tagMatches(tags[3], "cursor", [positiveCursorPattern]) &&
    tagMatches(tags[4], "command", [opaqueUuidPattern]) &&
    tagMatches(tags[5], "contract", [expectedContract]) &&
    tagMatches(tags[6], "actor", ["punk", opaqueUuidPattern])
  );
}

function attestationPolicyAllows(request: AttestationRequest): boolean {
  if (request.purpose === "bot-journal") {
    return botJournalPolicyAllows(request);
  }
  if (request.purpose === "bot-journal-segment") {
    return botJournalSegmentPolicyAllows(request);
  }
  if (request.purpose === "bot-installation-journal") {
    return botInstallationJournalPolicyAllows(request);
  }
  if (request.purpose === "bot-installation-journal-segment") {
    return botInstallationJournalSegmentPolicyAllows(request);
  }

  const workspace = hasExactlyOneTag(
    request,
    "workspace",
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  if (!workspace) {
    return false;
  }

  if (request.purpose === "workspace-journal-segment") {
    return workspaceJournalSegmentPolicyAllows(request);
  }

  if (request.purpose === "conversation-journal-segment") {
    return conversationJournalSegmentPolicyAllows(request);
  }

  if (request.purpose === "conversation-journal") {
    const expectedContract =
      request.event.kind === 50100
        ? "conversation.create@1"
        : request.event.kind === 50101
          ? "conversation.join@1"
          : request.event.kind === 50102
            ? "conversation.member-set-access@1"
            : request.event.kind === 50103
              ? "conversation.member-remove@1"
              : request.event.kind === 50105
                ? "conversation.update@1"
                : request.event.kind === 50106
                  ? "conversation.archive@1"
                  : request.event.kind === 50107
                    ? "conversation.restore@1"
                    : null;
    return (
      expectedContract !== null &&
      hasExactlyOneTag(
        request,
        "conversation",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) &&
      hasExactlyOneTag(request, "cursor", /^[1-9][0-9]*$/) &&
      hasExactlyOneTag(request, "workspace_cursor", /^[1-9][0-9]*$/) &&
      hasExactlyOneTag(
        request,
        "workspace_role",
        /^(owner|moderator|member|guest)$/,
      ) &&
      hasExactlyOneTag(
        request,
        "command",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) &&
      hasExactlyOneTag(
        request,
        "contract",
        new RegExp(`^${expectedContract.replaceAll(".", "\\.")}$`),
      ) &&
      hasExactlyOneTag(request, "actor", /^punk$/)
    );
  }

  if (request.purpose === "message-journal") {
    const expected =
      request.event.kind === 50200
        ? { contracts: ["message.post@1"], actor: "punk" as const }
        : request.event.kind === 50201
          ? { contracts: ["message.edit@1"], actor: "punk" as const }
          : request.event.kind === 50202
            ? { contracts: ["message.retract@1"], actor: "punk" as const }
            : request.event.kind === 50203
              ? { contracts: ["message.restore@1"], actor: "punk" as const }
              : request.event.kind === 50204
                ? {
                    contracts: ["message.finalize-erasure@1"],
                    actor: "service" as const,
                  }
                : request.event.kind === 50210
                  ? {
                      contracts: [
                        "message.reaction-add@1",
                        "message.reaction-toggle@1",
                      ],
                      actor: "punk-or-bot" as const,
                    }
                  : request.event.kind === 50211
                    ? {
                        contracts: [
                          "message.reaction-remove@1",
                          "message.reaction-toggle@1",
                        ],
                        actor: "punk-or-bot" as const,
                      }
                    : null;
    const reactionEvent =
      request.event.kind === 50210 || request.event.kind === 50211;
    if (reactionEvent) {
      return (
        expected !== null &&
        reactionJournalPolicyAllows(request, expected.contracts)
      );
    }
    const contractTags = request.event.tags.filter(
      ([name]) => name === "contract",
    );
    return (
      expected !== null &&
      hasExactlyOneTag(
        request,
        "conversation",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) &&
      hasExactlyOneTag(
        request,
        "message",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) &&
      hasExactlyOneTag(request, "cursor", /^[1-9][0-9]*$/) &&
      request.event.tags.every(([name]) => name !== "reaction_entity") &&
      (expected.actor === "service"
        ? request.event.tags.every(
            ([name]) =>
              name !== "workspace_cursor" && name !== "conversation_cursor",
          )
        : hasExactlyOneTag(request, "workspace_cursor", /^[1-9][0-9]*$/) &&
          hasExactlyOneTag(request, "conversation_cursor", /^[1-9][0-9]*$/)) &&
      hasExactlyOneTag(
        request,
        "command",
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ) &&
      contractTags.length === 1 &&
      expected.contracts.includes(contractTags[0]?.[1] ?? "") &&
      (expected.actor === "punk"
        ? hasExactActorTag(
            request,
            "punk",
            /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          )
        : expected.actor === "service"
          ? hasExactActorTag(request, "service", /^crypto-erasure$/)
          : hasExactActorTag(
              request,
              "punk",
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            ) ||
            hasExactActorTag(
              request,
              "bot",
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            ))
    );
  }

  const expectedContract =
    request.event.kind === 50000
      ? "workspace.create@1"
      : request.event.kind === 50001
        ? "workspace.rename@1"
        : request.event.kind === 50003
          ? "workspace.member-set-role@1"
          : request.event.kind === 50004
            ? "workspace.member-remove@1"
            : null;
  return (
    expectedContract !== null &&
    hasExactlyOneTag(request, "cursor", /^[1-9][0-9]*$/) &&
    hasExactlyOneTag(
      request,
      "command",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    ) &&
    hasExactlyOneTag(
      request,
      "contract",
      new RegExp(`^${expectedContract.replaceAll(".", "\\.")}$`),
    ) &&
    hasExactlyOneTag(request, "actor", /^(punk|bot)$/)
  );
}

export default {
  async fetch(request: Request, env: AttestationEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/internal/v1/attest") {
      return problem(404, "not_found", "Attestation endpoint not found");
    }

    let body: unknown;
    try {
      body = await readLimitedJson(request, 300_000);
    } catch {
      return problem(
        400,
        "invalid_input",
        "Attestation request must be valid JSON",
      );
    }

    const validation = validateContract(
      "punks://contracts/attestation.request@1",
      body,
    );
    if (!validation.valid) {
      return problem(
        400,
        "invalid_input",
        "Attestation request does not match its contract",
      );
    }

    try {
      const requestBody = body as AttestationRequest;
      if (requestBody.event.tags.some(([name]) => name === "attestation")) {
        return problem(
          400,
          "invalid_input",
          "Caller cannot supply an attestation tag",
        );
      }
      if (!attestationPolicyAllows(requestBody)) {
        return problem(
          400,
          "forbidden",
          "Attestation policy rejected the event",
        );
      }
      const responseBody: AttestationResponse = {
        keyVersion: env.ATTESTATION_KEY_VERSION,
        event: await attestNostrEvent(
          requestBody.event,
          env.ATTESTATION_PRIVATE_KEY,
          env.ATTESTATION_KEY_VERSION,
        ),
      };
      const responseValidation = validateContract(
        "punks://contracts/attestation.response@1",
        responseBody,
      );
      if (!responseValidation.valid) {
        throw new Error("Attestation response violated its canonical contract");
      }
      return json(responseBody);
    } catch {
      return problem(500, "attestation_failed", "Event attestation failed");
    }
  },
} satisfies ExportedHandler<AttestationEnv>;
