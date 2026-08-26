import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../src/env";
import { aggregateName, resolveActivePunk } from "../src/session";

const authEnv = env as AuthEnv;

describe("absorbed Account Session recovery", () => {
  it("returns account_merged for a Session restored after the terminal receipt", async () => {
    const token = "restored-absorbed-session-token-0000000000000000";
    const sessionId = await aggregateName("session", token);
    const absorbedPunkId = crypto.randomUUID();
    const survivorPunkId = crypto.randomUUID();
    const now = new Date().toISOString();
    await expect(
      authEnv.PUNKS.getByName(absorbedPunkId).provision({
        punkId: absorbedPunkId,
        identity: {
          profile: {
            provider: "github",
            subject: "restored-absorbed",
            verifiedEmail: "restored-absorbed@example.test",
            displayName: "Restored absorbed Punk",
            avatarUrl: null,
            username: "restored-absorbed",
          },
          subjectHash: "a".repeat(64),
          emailHash: "b".repeat(64),
        },
        now,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      authEnv.PUNKS.getByName(survivorPunkId).provision({
        punkId: survivorPunkId,
        identity: {
          profile: {
            provider: "google",
            subject: "surviving-account",
            verifiedEmail: "surviving-account@example.test",
            displayName: "Surviving Punk",
            avatarUrl: null,
            username: "surviving-account",
          },
          subjectHash: "d".repeat(64),
          emailHash: "e".repeat(64),
        },
        now,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      authEnv.SESSIONS.getByName(sessionId).create({
        sessionId,
        punkId: absorbedPunkId,
        authenticatedAt: now,
        expiresAt: "2099-01-01T00:00:00.000Z",
        recentReauthUntil: null,
      }),
    ).resolves.toBe(true);
    await expect(
      authEnv.ACCOUNT_MERGE_RECEIPTS.recordAccountMergeReceipt({
        receiptId: crypto.randomUUID(),
        intentId: crypto.randomUUID(),
        planId: crypto.randomUUID(),
        planDigest: "c".repeat(64),
        commitCommandId: crypto.randomUUID(),
        survivorPunkId,
        absorbedPunkId,
        accountRevisions: { survivor: 2, absorbed: 1 },
        recoveryDescriptor: "{}",
      }),
    ).resolves.toMatchObject({ ok: true });

    const response = await SELF.fetch(
      "https://auth.punks.test/api/auth/v1/session",
      { headers: { cookie: `punks_session_dev=${token}` } },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "account_merged",
      retry: "never",
    });
    await expect(
      authEnv.PUNKS.getByName(absorbedPunkId).query(),
    ).resolves.toEqual({ ok: false, code: "inactive" });
    await expect(
      resolveActivePunk(authEnv, absorbedPunkId),
    ).resolves.toMatchObject({ id: survivorPunkId, status: "active" });
  });
});
