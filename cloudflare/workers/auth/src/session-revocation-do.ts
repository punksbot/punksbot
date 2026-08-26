import { PromotionFaultableDurableObject } from "../../../shared/promotion-faultable-do";
import { canonicalJson, sha256Hex } from "@punks/core";

import type { AuthEnv } from "./env";

interface RevocationRecord {
  sessionId: string;
  expiresAt: string;
  revokedAt: string | null;
}

const RECORD_KEY = "desktop_session_revocation_v1";

/**
 * Opaque revoke-only authority. Possession can only revoke one Session; it
 * cannot authenticate, inspect identity, renew, or access a Workspace.
 */
export class SessionRevocationDO extends PromotionFaultableDurableObject<AuthEnv> {
  protected override async promotionRecoveryFingerprint(): Promise<string> {
    const current = await this.read();
    if (current === null) {
      throw new Error("promotion Session revocation target is missing");
    }
    return sha256Hex(canonicalJson(current));
  }

  async create(input: {
    sessionId: string;
    expiresAt: string;
  }): Promise<boolean> {
    const existing = await this.read();
    if (existing !== null) {
      return (
        existing.sessionId === input.sessionId &&
        existing.expiresAt === input.expiresAt
      );
    }
    if (Date.parse(input.expiresAt) <= Date.now()) return false;
    const record: RevocationRecord = { ...input, revokedAt: null };
    await this.ctx.storage.put(RECORD_KEY, record);
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.parse(input.expiresAt)));
    return true;
  }

  async revoke(): Promise<{ revoked: true; expired: boolean }> {
    await this.requirePromotionAuthorityAvailable();
    const record = await this.read();
    if (record === null) return { revoked: true, expired: true };
    const expired = Date.parse(record.expiresAt) <= Date.now();
    if (!expired && record.revokedAt === null) {
      await this.env.SESSIONS.getByName(record.sessionId).revoke();
      record.revokedAt = new Date().toISOString();
      await this.ctx.storage.put(RECORD_KEY, record);
    }
    return { revoked: true, expired };
  }

  /** Normal read of the revoke-only authority without exposing its capability. */
  async status(): Promise<{ exists: boolean; revoked: boolean }> {
    if (!(await this.promotionAuthorityIsAvailable())) {
      return { exists: false, revoked: false };
    }
    const record = await this.read();
    return {
      exists: record !== null,
      revoked: record?.revokedAt !== null && record?.revokedAt !== undefined,
    };
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  private async read(): Promise<RevocationRecord | null> {
    return (await this.ctx.storage.get<RevocationRecord>(RECORD_KEY)) ?? null;
  }
}
