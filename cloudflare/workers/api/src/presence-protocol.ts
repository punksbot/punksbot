import type { PresenceTypingPatch, PresenceView } from "@punks/contracts";

export type LeaseRow = Record<
  | "punk_id"
  | "session_id"
  | "device_id"
  | "hold_id"
  | "lease_token"
  | "connection_id",
  string
> &
  Record<"status", string | null> &
  Record<
    | "client_generation"
    | "lease_generation"
    | "last_client_sequence"
    | "patch_sequence"
    | "away_at"
    | "expires_at"
    | "away_emitted"
    | "status_window_started_at"
    | "status_updates_in_window"
    | "typing_window_started_at"
    | "typing_signals_in_window",
    number
  >;

export type TypingRow = Record<
  "punk_id" | "conversation_id" | "lease_token",
  string
> &
  Record<"lease_generation" | "sequence" | "expires_at", number>;

export interface PresenceSocketAttachment {
  schemaVersion: 1;
  workspaceId: string;
  punkId: string;
  sessionId: string;
  role: "owner" | "moderator" | "member" | "guest";
  leaseToken: string;
  leaseGeneration: number;
  deviceId: string;
  clientGeneration: number;
  connectionId: string;
}

/** Closed RPC projection derived from the generated public typing contract. */
export type CurrentTypingRpcPatch = Pick<
  PresenceTypingPatch,
  | "workspaceId"
  | "conversationId"
  | "punkId"
  | "active"
  | "leaseGeneration"
  | "sequence"
  | "expiresAt"
>;

export function socketAttachment(
  value: unknown,
): PresenceSocketAttachment | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const attachment = value as Partial<PresenceSocketAttachment>;
  if (
    attachment.schemaVersion !== 1 ||
    typeof attachment.workspaceId !== "string" ||
    typeof attachment.punkId !== "string" ||
    typeof attachment.sessionId !== "string" ||
    !["owner", "moderator", "member", "guest"].includes(
      attachment.role ?? "",
    ) ||
    typeof attachment.leaseToken !== "string" ||
    !Number.isSafeInteger(attachment.leaseGeneration) ||
    typeof attachment.deviceId !== "string" ||
    !Number.isSafeInteger(attachment.clientGeneration) ||
    typeof attachment.connectionId !== "string"
  ) {
    return null;
  }
  return attachment as PresenceSocketAttachment;
}

export function workspaceAuthorization(value: unknown): {
  ok: true;
  role: PresenceSocketAttachment["role"];
} | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const authorization = value as { ok?: unknown; role?: unknown };
  return authorization.ok === true &&
    typeof authorization.role === "string" &&
    ["owner", "moderator", "member", "guest"].includes(authorization.role)
    ? {
        ok: true,
        role: authorization.role as PresenceSocketAttachment["role"],
      }
    : null;
}

export function createLeaseToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return `pls1.${encoded}`;
}

export function canonicalStatus(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.normalize("NFC");
  return normalized === normalized.trim() &&
    Array.from(normalized).length <= 80 &&
    !/[\r\n\u2028\u2029]/u.test(normalized)
    ? normalized
    : null;
}

export function toPresenceView(
  row: LeaseRow,
  now: number,
  state?: "away" | "offline",
  sequence = row.patch_sequence,
): PresenceView {
  const resolvedState = state ?? (now >= row.away_at ? "away" : "online");
  return {
    punkId: row.punk_id,
    state: resolvedState,
    status: resolvedState === "offline" ? null : row.status,
    leaseGeneration: row.lease_generation,
    sequence,
    expiresAt:
      resolvedState === "offline"
        ? null
        : new Date(row.expires_at).toISOString(),
  };
}
