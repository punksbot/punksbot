import { canonicalJson, sha256Hex } from "@punks/core";

export const maximumCommandReceiptArchiveBodyBytes = 131_072;

export type CommandReceiptAggregate = "bot" | "bot-installation";

export interface CommandReceiptCoordinate {
  aggregate: CommandReceiptAggregate;
  aggregateHash: string;
  commandHash: string;
  key: string;
}

export interface PreparedCommandReceiptArchive {
  coordinate: CommandReceiptCoordinate;
  body: string;
  bodyBytes: number;
  metadata: Record<string, string> & {
    aggregate: string;
    schemaVersion: "1";
    aggregateHash: string;
    commandHash: string;
    payloadHash: string;
    terminal: "committed" | "rejected";
    bodyHash: string;
  };
}

export type ReadCommandReceiptArchive =
  | { status: "missing" }
  | {
      status: "found";
      value: unknown;
      body: string;
      metadata: PreparedCommandReceiptArchive["metadata"];
    };

export class CommandReceiptArchiveError extends Error {
  constructor(
    readonly code: "corrupt" | "too_large" | "unavailable",
    message: string,
  ) {
    super(message);
    this.name = "CommandReceiptArchiveError";
  }
}

export async function commandReceiptCoordinate(input: {
  aggregate: CommandReceiptAggregate;
  aggregateId: string;
  commandId: string;
}): Promise<CommandReceiptCoordinate> {
  const aggregateHash = await sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      domain: "punks.command-receipt.aggregate.v1",
      aggregate: input.aggregate,
      aggregateId: input.aggregateId,
    }),
  );
  const commandHash = await sha256Hex(
    canonicalJson({
      schemaVersion: 1,
      domain: "punks.command-receipt.command.v1",
      aggregate: input.aggregate,
      aggregateId: input.aggregateId,
      commandId: input.commandId,
    }),
  );
  return {
    aggregate: input.aggregate,
    aggregateHash,
    commandHash,
    key: `command-receipts/v1/${input.aggregate}/${aggregateHash}/${commandHash}.json`,
  };
}

export async function prepareCommandReceiptArchive(
  coordinate: CommandReceiptCoordinate,
  payloadHash: string,
  value: unknown,
  terminal: "committed" | "rejected" = "committed",
): Promise<PreparedCommandReceiptArchive> {
  if (!hexHash(payloadHash)) {
    throw new CommandReceiptArchiveError(
      "corrupt",
      "Command receipt payload hash is invalid",
    );
  }
  const body = canonicalJson(value);
  const bodyBytes = utf8ByteLength(body);
  if (bodyBytes > maximumCommandReceiptArchiveBodyBytes) {
    throw new CommandReceiptArchiveError(
      "too_large",
      "Command receipt archive exceeds its UTF-8 body cap",
    );
  }
  return {
    coordinate,
    body,
    bodyBytes,
    metadata: {
      aggregate: `${coordinate.aggregate}-command-receipt`,
      schemaVersion: "1",
      aggregateHash: coordinate.aggregateHash,
      commandHash: coordinate.commandHash,
      payloadHash,
      terminal,
      bodyHash: await sha256Hex(body),
    },
  };
}

export async function readCommandReceiptArchive(
  bucket: R2Bucket,
  coordinate: CommandReceiptCoordinate,
): Promise<ReadCommandReceiptArchive> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(coordinate.key);
  } catch (error) {
    throw unavailable("Command receipt archive lookup failed", error);
  }
  if (object === null) {
    return { status: "missing" };
  }
  if (object.size > maximumCommandReceiptArchiveBodyBytes) {
    throw new CommandReceiptArchiveError(
      "corrupt",
      "Stored command receipt archive exceeds its body cap",
    );
  }
  let body: string;
  try {
    body = await object.text();
  } catch (error) {
    throw unavailable("Command receipt archive body read failed", error);
  }
  if (utf8ByteLength(body) > maximumCommandReceiptArchiveBodyBytes) {
    throw new CommandReceiptArchiveError(
      "corrupt",
      "Stored command receipt UTF-8 body exceeds its cap",
    );
  }
  const value = parseJson(body);
  if (value === null || canonicalJson(value) !== body) {
    throw new CommandReceiptArchiveError(
      "corrupt",
      "Stored command receipt body is not canonical JSON",
    );
  }
  const metadata = object.customMetadata;
  const expectedMetadataKeys = [
    "aggregate",
    "aggregateHash",
    "bodyHash",
    "commandHash",
    "payloadHash",
    "schemaVersion",
    "terminal",
  ];
  if (
    object.httpMetadata?.contentType !== "application/json" ||
    metadata === undefined ||
    Object.keys(metadata).sort().join(",") !== expectedMetadataKeys.join(",") ||
    metadata.aggregate !== `${coordinate.aggregate}-command-receipt` ||
    metadata.schemaVersion !== "1" ||
    metadata.aggregateHash !== coordinate.aggregateHash ||
    metadata.commandHash !== coordinate.commandHash ||
    !hexHash(metadata.payloadHash) ||
    (metadata.terminal !== "committed" && metadata.terminal !== "rejected") ||
    !hexHash(metadata.bodyHash) ||
    metadata.bodyHash !== (await sha256Hex(body))
  ) {
    throw new CommandReceiptArchiveError(
      "corrupt",
      "Stored command receipt metadata is not exact",
    );
  }
  return {
    status: "found",
    value,
    body,
    metadata: metadata as PreparedCommandReceiptArchive["metadata"],
  };
}

export async function writeCommandReceiptArchive(
  bucket: R2Bucket,
  prepared: PreparedCommandReceiptArchive,
): Promise<"created" | "existing"> {
  let stored: R2Object | null;
  try {
    stored = await bucket.put(prepared.coordinate.key, prepared.body, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: "application/json" },
      customMetadata: prepared.metadata,
    });
  } catch (error) {
    throw unavailable("Command receipt archive create failed", error);
  }
  const existing = await readCommandReceiptArchive(bucket, prepared.coordinate);
  if (
    existing.status !== "found" ||
    existing.body !== prepared.body ||
    canonicalJson(existing.metadata) !== canonicalJson(prepared.metadata)
  ) {
    throw new CommandReceiptArchiveError(
      "corrupt",
      "Stored command receipt does not equal the prepared archive",
    );
  }
  return stored === null ? "existing" : "created";
}

function unavailable(
  message: string,
  cause: unknown,
): CommandReceiptArchiveError {
  if (cause instanceof CommandReceiptArchiveError) {
    return cause;
  }
  return new CommandReceiptArchiveError(
    "unavailable",
    `${message}: ${cause instanceof Error ? cause.message : "unknown error"}`,
  );
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function hexHash(value: string | undefined): value is string {
  return value !== undefined && /^[0-9a-f]{64}$/.test(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
