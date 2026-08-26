import { exports as workerExports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "../src/env";
import { aggregateName } from "../src/session";

const authEnv = env as AuthEnv;
const SOURCE_SHA = "ab".repeat(20);

describe("PunkSessionService promotion Session issuance", () => {
  it("issues one active, revoke-only desktop Session without widening its bundle", async () => {
    const bundle = await workerExports.PunkSessionService.issuePromotionSession(
      {
        sourceSha: SOURCE_SHA,
      },
    );

    expect(bundle).not.toBeNull();
    expect(Object.keys(bundle ?? {}).sort()).toEqual(
      [
        "cookie",
        "metadata",
        "revoke_capability",
        "revoke_expires_at_seconds",
        "source_sha",
      ].sort(),
    );
    expect(bundle?.cookie).toMatch(/^__Host-punks_session=[^;\s]{32,256}$/);
    expect(bundle?.source_sha).toBe(SOURCE_SHA);
    expect(bundle?.metadata).toMatchObject({
      session_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      punk_id: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      ),
      last_renewed_at_seconds: null,
    });
    expect(bundle?.revoke_capability).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(bundle?.revoke_expires_at_seconds).toBe(
      bundle?.metadata.expires_at_seconds,
    );

    await expect(
      workerExports.PunkSessionService.resolveSessionCookie(
        bundle?.cookie ?? "",
      ),
    ).resolves.toMatchObject({
      sessionId: bundle?.metadata.session_id,
      punkId: bundle?.metadata.punk_id,
    });

    const revocation = authEnv.SESSION_REVOCATIONS.getByName(
      await aggregateName(
        "session-revocation",
        bundle?.revoke_capability ?? "",
      ),
    );
    await expect(revocation.revoke()).resolves.toEqual({
      revoked: true,
      expired: false,
    });
    await expect(
      workerExports.PunkSessionService.resolveSessionCookie(
        bundle?.cookie ?? "",
      ),
    ).resolves.toBeNull();
  });

  it("rejects an unbound source identity before creating a Session", async () => {
    for (const sourceSha of [
      "",
      "a".repeat(39),
      "A".repeat(40),
      `${SOURCE_SHA} `,
    ]) {
      await expect(
        workerExports.PunkSessionService.issuePromotionSession({ sourceSha }),
      ).resolves.toBeNull();
    }
  });
});
