import type {
  PresenceHoldServerFrame,
  PresenceTypingPatch,
  PresenceTypingSignal,
  PresenceView,
  SetPresenceStatusSignal,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { DurableObject } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import {
  canonicalStatus,
  createLeaseToken,
  socketAttachment,
  toPresenceView,
  workspaceAuthorization,
  type CurrentTypingRpcPatch,
  type LeaseRow,
  type PresenceSocketAttachment,
  type TypingRow,
} from "./presence-protocol";

const PRESENCE_PROTOCOL = "punks.presence.v1";
const HEARTBEAT_INTERVAL_MS = 15_000;
const AWAY_AFTER_MS = 30_000;
const EXPIRES_AFTER_MS = 60_000;
const MAX_INITIAL_PRESENCES = 10_000;
const STATUS_WINDOW_MS = 60_000;
const MAX_STATUS_UPDATES_PER_WINDOW = 4;
const TYPING_TTL_MS = 5_000;
const TYPING_WINDOW_MS = 5_000;
const MAX_TYPING_SIGNALS_PER_WINDOW = 8;
const AUDIENCE_AUTHORIZATION_BATCH = 32;

class PresenceCapacityExceeded extends Error {}

/**
 * One current, self-expiring Presence coordination atom per Workspace.
 *
 * SQLite contains only live leases needed to survive hibernation and drive the
 * next alarm. Expiry or disconnect deletes the row; no journal, projection,
 * archive, replay cursor or delivery acknowledgement exists.
 */
export class PresenceDO extends DurableObject<ApiEnv> {
  constructor(ctx: DurableObjectState, env: ApiEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong"),
    );
    this.ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS presence_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          workspace_id TEXT NOT NULL,
          next_generation INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS presence_lease (
          punk_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          client_generation INTEGER NOT NULL,
          hold_id TEXT NOT NULL,
          lease_token TEXT NOT NULL UNIQUE,
          connection_id TEXT NOT NULL,
          lease_generation INTEGER NOT NULL,
          status TEXT,
          last_client_sequence INTEGER NOT NULL,
          patch_sequence INTEGER NOT NULL,
          away_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          away_emitted INTEGER NOT NULL CHECK (away_emitted IN (0, 1)),
          status_window_started_at INTEGER NOT NULL,
          status_updates_in_window INTEGER NOT NULL,
          typing_window_started_at INTEGER NOT NULL,
          typing_signals_in_window INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS presence_lease_expiry
          ON presence_lease(expires_at);
        CREATE INDEX IF NOT EXISTS presence_lease_away
          ON presence_lease(away_at, away_emitted);
        CREATE TABLE IF NOT EXISTS presence_typing (
          punk_id TEXT NOT NULL,
          conversation_id TEXT NOT NULL,
          lease_token TEXT NOT NULL,
          lease_generation INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          PRIMARY KEY (punk_id, conversation_id)
        );
        CREATE INDEX IF NOT EXISTS presence_typing_expiry
          ON presence_typing(expires_at);
      `);
      const leaseColumns = this.ctx.storage.sql
        .exec<{ name: string }>("PRAGMA table_info(presence_lease)")
        .toArray();
      if (!leaseColumns.some(({ name }) => name === "connection_id")) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(
            `ALTER TABLE presence_lease ADD COLUMN connection_id TEXT
             NOT NULL DEFAULT ''`,
          );
          // A pre-fence socket cannot prove that it owns the upgraded row.
          // Presence is lossy by contract, so fail closed and let clients
          // establish fresh Baux instead of exposing a stale live signal.
          this.ctx.storage.sql.exec("DELETE FROM presence_typing");
          this.ctx.storage.sql.exec("DELETE FROM presence_lease");
        });
      }
      this.ctx.storage.sql.exec(
        `INSERT OR IGNORE INTO presence_meta
           (singleton, workspace_id, next_generation)
         VALUES (1, ?, 0)`,
        this.ctx.id.name ?? "",
      );
      await this.scheduleNextAlarm();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (
      request.headers.get("upgrade")?.toLowerCase() !== "websocket" ||
      request.headers.get("sec-websocket-protocol") !== PRESENCE_PROTOCOL
    ) {
      return new Response("Not found", { status: 404 });
    }
    const workspaceId =
      request.headers.get("x-punks-presence-workspace-id") ?? "";
    const punkId = request.headers.get("x-punks-presence-punk-id") ?? "";
    const sessionId = request.headers.get("x-punks-presence-session-id") ?? "";
    const deviceId = request.headers.get("x-punks-presence-device-id") ?? "";
    const holdId = request.headers.get("x-punks-presence-hold-id") ?? "";
    const clientGeneration = Number(
      request.headers.get("x-punks-presence-client-generation") ?? "NaN",
    );
    const hold = {
      contract: "presence.hold@1" as const,
      type: "hold" as const,
      workspaceId,
      deviceId,
      clientGeneration,
      holdId,
    };
    if (
      workspaceId !== this.ctx.id.name ||
      !validateContract("punks://contracts/presence.hold@1", hold).valid
    ) {
      return new Response("Not found", { status: 404 });
    }

    let session: Awaited<
      ReturnType<ApiEnv["AUTH_SERVICE"]["resolveSessionId"]>
    >;
    try {
      session = await this.env.AUTH_SERVICE.resolveSessionId(sessionId);
    } catch {
      return new Response("Realtime unavailable", { status: 503 });
    }
    if (
      session === null ||
      !validateContract("punks://contracts/auth.session@1", session).valid ||
      session.sessionId !== sessionId ||
      session.punkId !== punkId ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      return new Response("Unauthenticated", { status: 401 });
    }
    let rawAuthorization: unknown;
    try {
      rawAuthorization = await this.env.WORKSPACES.getByName(
        workspaceId,
      ).authorize({ workspaceId, punkId, permission: "workspace.read" });
    } catch {
      return new Response("Realtime unavailable", { status: 503 });
    }
    const authorization = workspaceAuthorization(rawAuthorization);
    if (authorization === null) {
      return new Response("Forbidden", { status: 403 });
    }

    const now = Date.now();
    const previous = this.leaseForPunk(punkId);
    const replayed =
      previous !== null &&
      previous.session_id === sessionId &&
      previous.device_id === deviceId &&
      previous.client_generation === clientGeneration &&
      previous.hold_id === holdId &&
      previous.expires_at > now;
    let prepared: { row: LeaseRow; visiblePresences: PresenceView[] };
    try {
      prepared = this.ctx.storage.transactionSync(() => {
        const row: LeaseRow =
          replayed && previous !== null
            ? {
                ...previous,
                connection_id: crypto.randomUUID(),
                last_client_sequence: 0,
              }
            : {
                punk_id: punkId,
                session_id: sessionId,
                device_id: deviceId,
                client_generation: clientGeneration,
                hold_id: holdId,
                lease_token: createLeaseToken(),
                connection_id: crypto.randomUUID(),
                lease_generation: this.ctx.storage.sql
                  .exec<{ generation: number }>(
                    `UPDATE presence_meta
                     SET next_generation = next_generation + 1
                     WHERE singleton = 1
                     RETURNING next_generation AS generation`,
                  )
                  .one().generation,
                status: null,
                last_client_sequence: 0,
                patch_sequence: 1,
                away_at: now + AWAY_AFTER_MS,
                expires_at: now + EXPIRES_AFTER_MS,
                away_emitted: 0,
                status_window_started_at: now,
                status_updates_in_window: 0,
                typing_window_started_at: now,
                typing_signals_in_window: 0,
              };
        if (replayed) {
          this.ctx.storage.sql.exec(
            `UPDATE presence_lease
             SET connection_id = ?, last_client_sequence = 0
             WHERE punk_id = ? AND lease_token = ?`,
            row.connection_id,
            row.punk_id,
            row.lease_token,
          );
        } else {
          this.ctx.storage.sql.exec(
            `INSERT OR REPLACE INTO presence_lease (
               punk_id, session_id, device_id, client_generation, hold_id,
               lease_token, connection_id, lease_generation, status,
               patch_sequence, away_at, last_client_sequence, expires_at,
               away_emitted, status_window_started_at,
               status_updates_in_window, typing_window_started_at,
               typing_signals_in_window
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            row.punk_id,
            row.session_id,
            row.device_id,
            row.client_generation,
            row.hold_id,
            row.lease_token,
            row.connection_id,
            row.lease_generation,
            row.status,
            row.patch_sequence,
            row.away_at,
            row.last_client_sequence,
            row.expires_at,
            row.away_emitted,
            row.status_window_started_at,
            row.status_updates_in_window,
            row.typing_window_started_at,
            row.typing_signals_in_window,
          );
        }
        const visiblePresences = this.visiblePresences(
          authorization.role,
          punkId,
          now,
        );
        if (visiblePresences === null) {
          throw new PresenceCapacityExceeded();
        }
        return { row, visiblePresences };
      });
    } catch (error) {
      if (!(error instanceof PresenceCapacityExceeded)) throw error;
      await this.scheduleNextAlarm();
      return new Response("Realtime capacity unavailable", { status: 503 });
    }
    const { row, visiblePresences } = prepared;

    if (replayed) {
      this.closeLeaseSockets(row.lease_token, "presence reconnected");
    }
    if (previous !== null && !replayed) {
      // Device/generation replacement is an authority boundary: a typing
      // signal owned by the superseded lease must not survive until its TTL.
      await this.clearTypingForLease(previous);
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: PresenceSocketAttachment = {
      schemaVersion: 1,
      workspaceId,
      punkId,
      sessionId,
      role: authorization.role,
      leaseToken: row.lease_token,
      leaseGeneration: row.lease_generation,
      deviceId,
      clientGeneration,
      connectionId: row.connection_id,
    };
    this.ctx.acceptWebSocket(server, [
      `punk:${punkId}`,
      `session:${sessionId}`,
    ]);
    server.serializeAttachment(attachment);
    this.send(server, {
      schemaVersion: 1,
      type: "accepted",
      leaseToken: row.lease_token,
      leaseGeneration: row.lease_generation,
      clientGeneration,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      awayAfterMs: AWAY_AFTER_MS,
      expiresAfterMs: EXPIRES_AFTER_MS,
      presences: visiblePresences,
    });
    if (previous !== null && !replayed) {
      await this.broadcast(
        toPresenceView(previous, now, "offline", previous.patch_sequence + 1),
        previous.lease_token,
      );
      this.closeLeaseSockets(previous.lease_token, "presence superseded");
    }
    if (!replayed) {
      await this.broadcast(toPresenceView(row, now), row.lease_token);
    }
    await this.scheduleNextAlarm();
    return new Response(null, {
      status: 101,
      headers: { "sec-websocket-protocol": PRESENCE_PROTOCOL },
      webSocket: client,
    });
  }

  override async alarm(): Promise<void> {
    const now = Date.now();
    const expired = this.ctx.storage.sql
      .exec<LeaseRow>(
        "SELECT * FROM presence_lease WHERE expires_at <= ? ORDER BY punk_id",
        now,
      )
      .toArray();
    for (const row of expired) {
      await this.clearTypingForLease(row);
      this.ctx.storage.sql.exec(
        "DELETE FROM presence_lease WHERE punk_id = ? AND lease_token = ?",
        row.punk_id,
        row.lease_token,
      );
      await this.broadcast(
        toPresenceView(row, now, "offline", row.patch_sequence + 1),
      );
      this.closeLeaseSockets(row.lease_token, "presence expired");
    }

    const away = this.ctx.storage.sql
      .exec<LeaseRow>(
        `SELECT * FROM presence_lease
         WHERE away_emitted = 0 AND away_at <= ? AND expires_at > ?
         ORDER BY punk_id`,
        now,
        now,
      )
      .toArray();
    for (const row of away) {
      const sequence = row.patch_sequence + 1;
      this.ctx.storage.sql.exec(
        `UPDATE presence_lease
         SET away_emitted = 1, patch_sequence = ?
         WHERE punk_id = ? AND lease_token = ?`,
        sequence,
        row.punk_id,
        row.lease_token,
      );
      await this.broadcast(toPresenceView(row, now, "away", sequence));
    }

    const expiredTyping = this.ctx.storage.sql
      .exec<TypingRow>(
        `SELECT * FROM presence_typing
         WHERE expires_at <= ? ORDER BY conversation_id, punk_id`,
        now,
      )
      .toArray();
    for (const row of expiredTyping) {
      this.ctx.storage.sql.exec(
        `DELETE FROM presence_typing
         WHERE punk_id = ? AND conversation_id = ? AND lease_token = ?`,
        row.punk_id,
        row.conversation_id,
        row.lease_token,
      );
      await this.publishTypingPatch({
        workspaceId: this.ctx.id.name ?? "",
        conversationId: row.conversation_id,
        punkId: row.punk_id,
        active: false,
        leaseGeneration: row.lease_generation,
        sequence: row.sequence + 1,
        expiresAt: null,
      });
    }
    await this.scheduleNextAlarm();
  }

  override async webSocketMessage(
    socket: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (
      typeof message !== "string" ||
      new TextEncoder().encode(message).byteLength > 2_048
    ) {
      socket.close(1008, "invalid presence frame");
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(message);
    } catch {
      socket.close(1008, "invalid presence frame");
      return;
    }
    const heartbeatValid =
      validateContract("punks://contracts/presence.hold@1", frame).valid &&
      typeof frame === "object" &&
      frame !== null &&
      "type" in frame &&
      frame.type === "heartbeat";
    const statusValid = validateContract(
      "punks://contracts/presence.status.set@1",
      frame,
    ).valid;
    const typingValid = validateContract(
      "punks://contracts/presence.typing.signal@1",
      frame,
    ).valid;
    if (!heartbeatValid && !statusValid && !typingValid) {
      socket.close(1008, "invalid presence frame");
      return;
    }
    const signal = frame as {
      leaseToken: string;
      sequence: number;
    };
    const attachment = socketAttachment(socket.deserializeAttachment());
    if (attachment === null || signal.leaseToken !== attachment.leaseToken) {
      socket.close(1008, "stale presence lease");
      return;
    }
    const current = this.leaseForPunk(attachment.punkId);
    if (
      current === null ||
      current.lease_token !== attachment.leaseToken ||
      current.lease_generation !== attachment.leaseGeneration ||
      current.connection_id !== attachment.connectionId
    ) {
      socket.close(1008, "stale presence lease");
      return;
    }
    if (signal.sequence <= current.last_client_sequence) return;

    const authorization = await this.authorizeSocket(attachment);
    if (authorization.status === "unavailable") {
      this.send(socket, {
        schemaVersion: 1,
        type: "realtime-degraded",
        reason: "authorization_unavailable",
      });
      socket.close(1013, "realtime unavailable");
      return;
    }
    if (authorization.status === "denied") {
      socket.close(1008, "authorization revoked");
      await this.releaseSocket(socket);
      return;
    }
    if (authorization.role !== attachment.role) {
      socket.serializeAttachment({
        ...attachment,
        role: authorization.role,
      } satisfies PresenceSocketAttachment);
    }

    const now = Date.now();
    if (typingValid) {
      await this.handleTypingSignal(
        socket,
        attachment,
        current,
        frame as PresenceTypingSignal,
        now,
      );
      return;
    }
    if (statusValid) {
      const statusSignal = frame as SetPresenceStatusSignal;
      const status = canonicalStatus(statusSignal.status);
      if (statusSignal.status !== null && status === null) {
        socket.close(1008, "invalid presence status");
        return;
      }
      const windowExpired =
        now - current.status_window_started_at >= STATUS_WINDOW_MS;
      const windowStartedAt = windowExpired
        ? now
        : current.status_window_started_at;
      const updatesInWindow = windowExpired
        ? 0
        : current.status_updates_in_window;
      if (updatesInWindow >= MAX_STATUS_UPDATES_PER_WINDOW) {
        this.ctx.storage.sql.exec(
          `UPDATE presence_lease SET last_client_sequence = ?
           WHERE punk_id = ? AND lease_token = ?`,
          signal.sequence,
          current.punk_id,
          current.lease_token,
        );
        return;
      }
      const updated: LeaseRow = {
        ...current,
        status,
        last_client_sequence: signal.sequence,
        patch_sequence: current.patch_sequence + 1,
        status_window_started_at: windowStartedAt,
        status_updates_in_window: updatesInWindow + 1,
      };
      this.ctx.storage.sql.exec(
        `UPDATE presence_lease
         SET status = ?, last_client_sequence = ?, patch_sequence = ?,
             status_window_started_at = ?, status_updates_in_window = ?
         WHERE punk_id = ? AND lease_token = ?`,
        updated.status,
        updated.last_client_sequence,
        updated.patch_sequence,
        updated.status_window_started_at,
        updated.status_updates_in_window,
        updated.punk_id,
        updated.lease_token,
      );
      await this.broadcast(toPresenceView(updated, now));
      return;
    }

    const renewed: LeaseRow = {
      ...current,
      last_client_sequence: signal.sequence,
      patch_sequence: current.patch_sequence + 1,
      away_at: now + AWAY_AFTER_MS,
      expires_at: now + EXPIRES_AFTER_MS,
      away_emitted: 0,
    };
    this.ctx.storage.sql.exec(
      `UPDATE presence_lease
       SET last_client_sequence = ?, patch_sequence = ?, away_at = ?,
           expires_at = ?, away_emitted = 0
       WHERE punk_id = ? AND lease_token = ?`,
      renewed.last_client_sequence,
      renewed.patch_sequence,
      renewed.away_at,
      renewed.expires_at,
      renewed.punk_id,
      renewed.lease_token,
    );
    await this.broadcast(toPresenceView(renewed, now));
    await this.scheduleNextAlarm();
  }

  override async webSocketClose(socket: WebSocket): Promise<void> {
    await this.releaseSocket(socket);
  }

  override async webSocketError(socket: WebSocket): Promise<void> {
    await this.releaseSocket(socket);
  }

  private leaseForPunk(punkId: string): LeaseRow | null {
    return (
      this.ctx.storage.sql
        .exec<LeaseRow>(
          "SELECT * FROM presence_lease WHERE punk_id = ?",
          punkId,
        )
        .toArray()[0] ?? null
    );
  }

  /** Current active typing is consumed only by an already-authorized ConversationDO. */
  async currentTyping(
    conversationId: string,
  ): Promise<CurrentTypingRpcPatch[]> {
    const now = Date.now();
    const rows = this.ctx.storage.sql
      .exec<TypingRow>(
        `SELECT * FROM presence_typing
         WHERE conversation_id = ? AND expires_at > ? ORDER BY punk_id
         LIMIT 101`,
        conversationId,
        now,
      )
      .toArray();
    if (rows.length > 100) return [];
    return rows.map((row) => ({
      workspaceId: this.ctx.id.name ?? "",
      conversationId: row.conversation_id,
      punkId: row.punk_id,
      active: true,
      leaseGeneration: row.lease_generation,
      sequence: row.sequence,
      expiresAt: new Date(row.expires_at).toISOString(),
    }));
  }

  /** Idempotent best-effort fence called after authoritative access removal. */
  async revokePunk(punkId: string): Promise<void> {
    const row = this.leaseForPunk(punkId);
    if (row === null) return;
    await this.clearTypingForLease(row);
    this.ctx.storage.sql.exec(
      "DELETE FROM presence_lease WHERE punk_id = ? AND lease_token = ?",
      row.punk_id,
      row.lease_token,
    );
    await this.broadcast(
      toPresenceView(row, Date.now(), "offline", row.patch_sequence + 1),
      row.lease_token,
    );
    this.closeLeaseSockets(row.lease_token, "authorization revoked");
    await this.scheduleNextAlarm();
  }

  private async handleTypingSignal(
    socket: WebSocket,
    attachment: PresenceSocketAttachment,
    current: LeaseRow,
    signal: PresenceTypingSignal,
    now: number,
  ): Promise<void> {
    if (signal.workspaceId !== attachment.workspaceId) {
      socket.close(1008, "stale presence scope");
      return;
    }
    const windowExpired =
      now - current.typing_window_started_at >= TYPING_WINDOW_MS;
    const windowStartedAt = windowExpired
      ? now
      : current.typing_window_started_at;
    const signalsInWindow = windowExpired
      ? 0
      : current.typing_signals_in_window;
    this.ctx.storage.sql.exec(
      `UPDATE presence_lease
       SET last_client_sequence = ?, typing_window_started_at = ?
       WHERE punk_id = ? AND lease_token = ?`,
      signal.sequence,
      windowStartedAt,
      current.punk_id,
      current.lease_token,
    );
    if (signalsInWindow >= MAX_TYPING_SIGNALS_PER_WINDOW) return;
    this.ctx.storage.sql.exec(
      `UPDATE presence_lease SET typing_signals_in_window = ?
       WHERE punk_id = ? AND lease_token = ?`,
      signalsInWindow + 1,
      current.punk_id,
      current.lease_token,
    );

    const patch: PresenceTypingPatch = {
      workspaceId: attachment.workspaceId,
      conversationId: signal.conversationId,
      punkId: attachment.punkId,
      active: signal.active,
      leaseGeneration: attachment.leaseGeneration,
      sequence: signal.sequence,
      expiresAt: signal.active
        ? new Date(now + TYPING_TTL_MS).toISOString()
        : null,
    };
    const published = await this.publishTypingPatch(
      patch,
      attachment.sessionId,
    );
    if (!published.ok) return;

    if (signal.active) {
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO presence_typing (
           punk_id, conversation_id, lease_token, lease_generation, sequence,
           expires_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        attachment.punkId,
        signal.conversationId,
        attachment.leaseToken,
        attachment.leaseGeneration,
        signal.sequence,
        now + TYPING_TTL_MS,
      );
    } else {
      this.ctx.storage.sql.exec(
        `DELETE FROM presence_typing
         WHERE punk_id = ? AND conversation_id = ? AND lease_token = ?`,
        attachment.punkId,
        signal.conversationId,
        attachment.leaseToken,
      );
    }
    await this.scheduleNextAlarm();
  }

  private async publishTypingPatch(
    patch: PresenceTypingPatch,
    sessionId: string | null = null,
  ): Promise<{ ok: boolean }> {
    try {
      return await this.env.CONVERSATIONS.getByName(
        patch.conversationId,
      ).publishTypingPatch({ patch, sessionId });
    } catch {
      return { ok: false };
    }
  }

  private async clearTypingForLease(row: LeaseRow): Promise<void> {
    const typing = this.ctx.storage.sql
      .exec<TypingRow>(
        `SELECT * FROM presence_typing
         WHERE punk_id = ? AND lease_token = ? ORDER BY conversation_id`,
        row.punk_id,
        row.lease_token,
      )
      .toArray();
    this.ctx.storage.sql.exec(
      "DELETE FROM presence_typing WHERE punk_id = ? AND lease_token = ?",
      row.punk_id,
      row.lease_token,
    );
    for (const active of typing) {
      await this.publishTypingPatch({
        workspaceId: this.ctx.id.name ?? "",
        conversationId: active.conversation_id,
        punkId: active.punk_id,
        active: false,
        leaseGeneration: active.lease_generation,
        sequence: active.sequence + 1,
        expiresAt: null,
      });
    }
  }

  private async authorizeSocket(
    attachment: PresenceSocketAttachment,
  ): Promise<
    | { status: "authorized"; role: PresenceSocketAttachment["role"] }
    | { status: "denied" }
    | { status: "unavailable" }
  > {
    let session: Awaited<
      ReturnType<ApiEnv["AUTH_SERVICE"]["resolveSessionId"]>
    >;
    try {
      session = await this.env.AUTH_SERVICE.resolveSessionId(
        attachment.sessionId,
      );
    } catch {
      return { status: "unavailable" };
    }
    if (
      session === null ||
      !validateContract("punks://contracts/auth.session@1", session).valid ||
      session.sessionId !== attachment.sessionId ||
      session.punkId !== attachment.punkId ||
      Date.parse(session.expiresAt) <= Date.now()
    ) {
      return { status: "denied" };
    }
    try {
      const authorization = workspaceAuthorization(
        await this.env.WORKSPACES.getByName(attachment.workspaceId).authorize({
          workspaceId: attachment.workspaceId,
          punkId: attachment.punkId,
          permission: "workspace.read",
        }),
      );
      return authorization === null
        ? { status: "denied" }
        : { status: "authorized", role: authorization.role };
    } catch {
      return { status: "unavailable" };
    }
  }

  private visiblePresences(
    viewerRole: PresenceSocketAttachment["role"],
    viewerPunkId: string,
    now: number,
  ): PresenceView[] | null {
    const rows = this.ctx.storage.sql
      .exec<LeaseRow>(
        `SELECT * FROM presence_lease
         WHERE expires_at > ? ORDER BY punk_id LIMIT ?`,
        now,
        MAX_INITIAL_PRESENCES + 1,
      )
      .toArray();
    if (rows.length > MAX_INITIAL_PRESENCES) return null;
    return rows
      .filter((row) => viewerRole !== "guest" || row.punk_id === viewerPunkId)
      .map((row) => toPresenceView(row, now));
  }

  private send(socket: WebSocket, frame: PresenceHoldServerFrame): void {
    if (
      !validateContract("punks://contracts/presence.hold-server-frame@1", frame)
        .valid
    ) {
      throw new Error("Presence frame violated its public contract");
    }
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(frame));
  }

  private async broadcast(
    presence: PresenceView,
    exceptToken?: string,
  ): Promise<void> {
    const revokedPunks = new Set<string>();
    const recipients = this.ctx.getWebSockets().flatMap((socket) => {
      const attachment = socketAttachment(socket.deserializeAttachment());
      return attachment === null ||
        attachment.leaseToken === exceptToken ||
        socket.readyState !== WebSocket.OPEN
        ? []
        : [{ socket, attachment }];
    });
    for (
      let offset = 0;
      offset < recipients.length;
      offset += AUDIENCE_AUTHORIZATION_BATCH
    ) {
      const authorized = await Promise.all(
        recipients
          .slice(offset, offset + AUDIENCE_AUTHORIZATION_BATCH)
          .map(async (recipient) => ({
            ...recipient,
            authorization: await this.authorizeSocket(recipient.attachment),
          })),
      );
      for (const { socket, attachment, authorization } of authorized) {
        if (authorization.status === "unavailable") {
          this.send(socket, {
            schemaVersion: 1,
            type: "realtime-degraded",
            reason: "authorization_unavailable",
          });
          socket.close(1013, "realtime unavailable");
          continue;
        }
        if (authorization.status === "denied") {
          socket.close(1008, "authorization revoked");
          revokedPunks.add(attachment.punkId);
          continue;
        }
        if (
          authorization.role === "guest" &&
          attachment.punkId !== presence.punkId
        ) {
          continue;
        }
        if (authorization.role !== attachment.role) {
          socket.serializeAttachment({
            ...attachment,
            role: authorization.role,
          } satisfies PresenceSocketAttachment);
        }
        this.send(socket, { schemaVersion: 1, type: "presence", presence });
      }
    }
    for (const punkId of revokedPunks) {
      await this.revokePunk(punkId);
    }
  }

  private closeLeaseSockets(leaseTokenValue: string, reason: string): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socketAttachment(socket.deserializeAttachment());
      if (
        attachment?.leaseToken === leaseTokenValue &&
        socket.readyState === WebSocket.OPEN
      ) {
        socket.close(1000, reason);
      }
    }
  }

  private async releaseSocket(socket: WebSocket): Promise<void> {
    const attachment = socketAttachment(socket.deserializeAttachment());
    if (attachment === null) return;
    const row = this.leaseForPunk(attachment.punkId);
    if (
      row === null ||
      row.lease_token !== attachment.leaseToken ||
      row.connection_id !== attachment.connectionId
    ) {
      return;
    }
    await this.clearTypingForLease(row);
    this.ctx.storage.sql.exec(
      "DELETE FROM presence_lease WHERE punk_id = ? AND lease_token = ?",
      row.punk_id,
      row.lease_token,
    );
    await this.broadcast(
      toPresenceView(row, Date.now(), "offline", row.patch_sequence + 1),
      row.lease_token,
    );
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ due_at: number | null }>(
        `SELECT MIN(due_at) AS due_at FROM (
           SELECT expires_at AS due_at FROM presence_lease
           UNION ALL
           SELECT away_at AS due_at FROM presence_lease WHERE away_emitted = 0
           UNION ALL
           SELECT expires_at AS due_at FROM presence_typing
         )`,
      )
      .toArray()[0]?.due_at;
    if (next === null || next === undefined) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(next);
    }
  }
}
