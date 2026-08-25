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
      return existing.commandId === input.commandId &&
        existing.oldSessionId === input.oldSessionId &&
        existing.punkId === input.punkId
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
    return record;
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
    return record;
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
    await this.ctx.storage.deleteAll();
  }

  private async read(): Promise<SessionRotationRecord | null> {
    return (
      (await this.ctx.storage.get<SessionRotationRecord>(RECORD_KEY)) ?? null
    );
  }
}
