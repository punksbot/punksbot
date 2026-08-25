import { DurableObject } from "cloudflare:workers";

import { randomToken } from "./crypto";
import type { AuthEnv } from "./env";

export interface SessionRotationRecord {
  commandId: string;
  rotationId: string;
  oldSessionId: string;
  newSessionToken: string;
  newSessionId: string | null;
  revokeCapability: string;
  punkId: string;
  createdAt: string;
  confirmBy: string;
  confirmedAt: string | null;
}

const RECORD_KEY = "desktop_session_rotation_v1";
const CONFIRM_TTL_MS = 10 * 60_000;

/** Authority for one idempotent prepare/confirm Session rotation. */
export class SessionRotationDO extends DurableObject<AuthEnv> {
  async create(input: {
    commandId: string;
    oldSessionId: string;
    punkId: string;
  }): Promise<SessionRotationRecord | null> {
    const existing = await this.read();
    if (existing !== null) {
      const matches =
        existing.commandId === input.commandId &&
        existing.oldSessionId === input.oldSessionId &&
        existing.punkId === input.punkId;
      if (!matches || existing.confirmedAt !== null) {
        return matches ? existing : null;
      }
      return (await this.indexHandoff(
        existing,
        existing.newSessionId === null ? "pending" : "prepared",
      ))
        ? existing
        : null;
    }
    const now = Date.now();
    const record: SessionRotationRecord = {
      ...input,
      rotationId: crypto.randomUUID(),
      newSessionToken: randomToken(32),
      newSessionId: null,
      revokeCapability: randomToken(32),
      createdAt: new Date(now).toISOString(),
      confirmBy: new Date(now + CONFIRM_TTL_MS).toISOString(),
      confirmedAt: null,
    };
    await this.ctx.storage.put(RECORD_KEY, record);
    if (!(await this.indexHandoff(record, "pending"))) {
      await this.ctx.storage.delete(RECORD_KEY);
      await this.env.SESSIONS.getByName(input.oldSessionId).clearRenewal(
        input.commandId,
      );
      return null;
    }
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(record.confirmBy)));
    return record;
  }

  async prepared(input: {
    rotationId: string;
    newSessionId: string;
  }): Promise<SessionRotationRecord | null> {
    const record = await this.read();
    if (
      record === null ||
      record.rotationId !== input.rotationId ||
      (record.newSessionId !== null &&
        record.newSessionId !== input.newSessionId)
    ) {
      return null;
    }
    if (record.newSessionId === null) {
      record.newSessionId = input.newSessionId;
      await this.ctx.storage.put(RECORD_KEY, record);
    }
    return (await this.indexHandoff(record, "prepared")) ? record : null;
  }

  async confirmation(input: {
    commandId: string;
    rotationId: string;
    newSessionId: string;
  }): Promise<SessionRotationRecord | null> {
    const record = await this.read();
    if (
      record === null ||
      record.commandId !== input.commandId ||
      record.rotationId !== input.rotationId ||
      record.newSessionId !== input.newSessionId ||
      (record.confirmedAt === null &&
        Date.parse(record.confirmBy) <= Date.now())
    ) {
      return null;
    }
    return record;
  }

  async confirmed(input: {
    commandId: string;
    rotationId: string;
  }): Promise<SessionRotationRecord | null> {
    const record = await this.read();
    if (
      record === null ||
      record.commandId !== input.commandId ||
      record.rotationId !== input.rotationId
    ) {
      return null;
    }
    if (record.confirmedAt === null) {
      record.confirmedAt = new Date().toISOString();
      await this.ctx.storage.put(RECORD_KEY, record);
    }
    await this.env.PUNKS.getByName(record.punkId).removeAccountMergeHandoff(
      this.ctx.id.name ?? "",
    );
    return record;
  }

  /** Account-merge planning revalidates this pending rotation at its source. */
  async readForAccountMerge(): Promise<{
    punkId: string;
    kind: "session-renewal";
    state: "pending" | "prepared";
    expiresAt: string;
  } | null> {
    const record = await this.read();
    if (
      record === null ||
      record.confirmedAt !== null ||
      Date.parse(record.confirmBy) <= Date.now()
    ) {
      return null;
    }
    return {
      punkId: record.punkId,
      kind: "session-renewal",
      state: record.newSessionId === null ? "pending" : "prepared",
      expiresAt: record.confirmBy,
    };
  }

  override async alarm(): Promise<void> {
    const record = await this.read();
    if (record !== null && record.confirmedAt === null) {
      if (record.newSessionId !== null) {
        await this.env.SESSIONS.getByName(record.newSessionId).revoke();
      }
      await this.env.SESSIONS.getByName(record.oldSessionId).clearRenewal(
        record.commandId,
      );
    }
    if (record !== null) {
      await this.env.PUNKS.getByName(record.punkId).removeAccountMergeHandoff(
        this.ctx.id.name ?? "",
      );
    }
    await this.ctx.storage.deleteAll();
  }

  private async indexHandoff(
    record: SessionRotationRecord,
    state: "pending" | "prepared",
  ): Promise<boolean> {
    try {
      return await this.env.PUNKS.getByName(
        record.punkId,
      ).recordAccountMergeHandoff({
        handoffId: this.ctx.id.name ?? "",
        punkId: record.punkId,
        kind: "session-renewal",
        state,
        expiresAt: record.confirmBy,
      });
    } catch {
      return false;
    }
  }

  private async read(): Promise<SessionRotationRecord | null> {
    return (
      (await this.ctx.storage.get<SessionRotationRecord>(RECORD_KEY)) ?? null
    );
  }
}
