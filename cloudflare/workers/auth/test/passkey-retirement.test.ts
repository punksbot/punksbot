import { describe, expect, it } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";

import { route } from "../src/router";
import {
  authEnv,
  claim,
  confirm,
  nativeHeaders,
  origin,
  provisionIdentity,
  readyGoogle,
  sessionCookie,
  status,
} from "./desktop-ceremony-helpers";

describe("retired passkey authentication", () => {
  it.each([
    { intent: "sign_in", method: "passkey" },
    { intent: "register_passkey", method: "passkey" },
    { intent: "reauthenticate", method: "google", purpose: "register_passkey" },
  ])("rejects the retired desktop request $intent/$method", async (request) => {
    const response = await route(
      new Request(`${origin}/api/auth/v1/desktop/start`, {
        method: "POST",
        headers: { ...nativeHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          contract: "desktop-auth.start@1",
          message: "request",
          verifierCommitment: "v".repeat(43),
          ...request,
        }),
      }),
      authEnv,
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_input" });
  });

  it.each([
    "/api/auth/v1/passkeys/register/options",
    "/api/auth/v1/passkeys/register/finish",
    "/api/auth/v1/passkeys/authenticate/options",
    "/api/auth/v1/passkeys/authenticate/finish",
    "/api/auth/v1/desktop/browser/passkey/complete",
  ])("does not expose the retired route %s", async (path) => {
    const response = await route(
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: { ...nativeHeaders, "content-type": "application/json" },
        body: "{}",
      }),
      authEnv,
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ code: "not_found" });
  });

  it("does not claim a passkey flow restored from storage", async () => {
    const started = await readyGoogle(`retired-${crypto.randomUUID()}`);
    const stub = authEnv.DESKTOP_AUTH_FLOWS.getByName(started.flowId);
    await runInDurableObject(stub, async (_instance, state) => {
      const record = await state.storage.get<Record<string, unknown>>(
        "desktop_auth_flow_v1",
      );
      if (record === undefined) throw new Error("Legacy flow fixture absent");
      await state.storage.put("desktop_auth_flow_v1", {
        ...record,
        method: "passkey",
        outcomeCode: "passkey_authenticated",
      });
    });
    expect((await claim(started)).status).toBe(409);
    expect((await status(started)).status).toBe(404);
  });

  it("revokes a prepared legacy passkey Session instead of activating it", async () => {
    const started = await readyGoogle(
      `retired-delivery-${crypto.randomUUID()}`,
    );
    const delivered = await claim(started);
    expect(delivered.status).toBe(200);
    const cookie = sessionCookie(delivered);
    const body = (await delivered.json()) as { deliveryId: string };
    const stub = authEnv.DESKTOP_AUTH_FLOWS.getByName(started.flowId);
    await runInDurableObject(stub, async (_instance, state) => {
      const record = await state.storage.get<Record<string, unknown>>(
        "desktop_auth_flow_v1",
      );
      if (record === undefined) throw new Error("Legacy flow fixture absent");
      await state.storage.put("desktop_auth_flow_v1", {
        ...record,
        method: "passkey",
        outcomeCode: "passkey_authenticated",
      });
    });
    expect((await confirm(started, body.deliveryId)).status).toBe(409);
    const session = await route(
      new Request(`${origin}/api/auth/v1/session`, {
        headers: { ...nativeHeaders, cookie },
      }),
      authEnv,
    );
    expect(session.status).toBe(401);
  });

  it("keeps retired identity history out of the active account profile", async () => {
    const owner = await provisionIdentity(
      `retired-profile-${crypto.randomUUID()}`,
    );
    const punk = authEnv.PUNKS.getByName(owner.punkId);
    await runInDurableObject(punk, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ state_json: string }>(
          "SELECT state_json FROM punk_state WHERE singleton = 1",
        )
        .toArray()[0];
      if (row === undefined) throw new Error("Legacy Punk fixture absent");
      const record = JSON.parse(row.state_json);
      record.identities.push({
        provider: "passkey",
        subjectHash: "a".repeat(64),
        emailHash: "b".repeat(64),
        verifiedEmail: null,
        username: null,
        credentialId: "retired-credential",
        linkedAt: new Date().toISOString(),
      });
      state.storage.sql.exec(
        "UPDATE punk_state SET state_json = ? WHERE singleton = 1",
        JSON.stringify(record),
      );
    });
    const profile = await workerExports.PunkSessionService.getPunkProfile(
      owner.punkId,
    );
    expect(profile?.identities.map((identity) => identity.provider)).toEqual([
      "google",
    ]);
    const historical = await punk.query();
    expect(
      historical.ok &&
        historical.state.identities.some(
          (identity) => identity.provider === "passkey",
        ),
    ).toBe(true);
  });

  it("prunes retired ceremony handoffs and refuses to register new ones", async () => {
    const owner = await provisionIdentity(
      `retired-index-${crypto.randomUUID()}`,
    );
    const punk = authEnv.PUNKS.getByName(owner.punkId);
    const handoffId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await expect(
      punk.recordAccountMergeHandoff({
        handoffId,
        punkId: owner.punkId,
        kind: "passkey-ceremony",
        state: "pending",
        expiresAt,
      }),
    ).resolves.toBe(false);
    await runInDurableObject(punk, (_instance, state) => {
      state.storage.sql.exec(
        "INSERT INTO account_merge_handoff_inventory (handoff_id, kind, state, expires_at) VALUES (?, 'passkey-ceremony', 'pending', ?)",
        handoffId,
        expiresAt,
      );
    });
    const inventory = await punk.accountMergeInventory();
    expect(
      inventory.handoffs.some((handoff) => handoff.kind === "passkey-ceremony"),
    ).toBe(false);
  });
});
