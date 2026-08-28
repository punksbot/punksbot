import { describe, expect, it } from "vitest";
import { runInDurableObject } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";

import { route } from "../src/router";
import { getActiveSession } from "../src/session";
import {
  authEnv,
  claim,
  completeOAuth,
  confirm,
  nativeHeaders,
  origin,
  provisionIdentity,
  readyGoogle,
  reauthenticateFor,
  sessionCookie,
  startDesktop,
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

  it.each([
    "google",
    "passkey",
  ])("revalidates the %s origin of a previously sealed desktop grant", async (method) => {
    const subject = `retired-grant-${crypto.randomUUID()}`;
    const owner = await provisionIdentity(subject);
    const reauth = await reauthenticateFor(
      subject,
      owner.cookie,
      "link_google",
    );
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    await runInDurableObject(
      authEnv.DESKTOP_AUTH_FLOWS.getByName(reauth.started.flowId),
      async (_instance, state) => {
        const record = await state.storage.get<Record<string, unknown>>(
          "desktop_auth_flow_v1",
        );
        if (record === undefined)
          throw new Error("Legacy reauthentication fixture absent");
        await state.storage.put("desktop_auth_flow_v1", { ...record, method });
      },
    );
    const link = await startDesktop({
      intent: "link_google",
      method: "google",
      session: owner.cookie,
      authorizationId: reauth.authorizationId,
    });
    expect(link.response.status).toBe(method === "google" ? 201 : 409);
    const session = await route(
      new Request(`${origin}/api/auth/v1/session`, {
        headers: { ...nativeHeaders, cookie: owner.cookie },
      }),
      authEnv,
    );
    expect(session.status).toBe(200);
  });

  it.each([
    "google",
    "github",
    "passkey",
  ])("only preserves a recent %s reauthentication if it is still supported", async (method) => {
    const owner = await provisionIdentity(
      `retired-freshness-${crypto.randomUUID()}`,
    );
    const request = new Request(`${origin}/api/auth/v1/session`, {
      headers: { cookie: owner.cookie },
    });
    const active = await getActiveSession(request, authEnv);
    if (active === null) throw new Error("Active Session fixture absent");
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    expect(
      await active.stub.markReauthenticated({
        sessionId: active.record.sessionId,
        punkId: owner.punkId,
        until,
        authenticationMethod: "google",
        providerSubjectBindingHash: "a".repeat(64),
      }),
    ).toBe(true);
    await runInDurableObject(active.stub, async (_instance, state) => {
      const proof = await state.storage.get<Record<string, unknown>>(
        "account_merge_reauth_v1",
      );
      if (proof === undefined)
        throw new Error("Reauthentication proof fixture absent");
      await state.storage.put("account_merge_reauth_v1", {
        ...proof,
        authenticationMethod: method,
      });
    });
    const link = await route(
      new Request(`${origin}/api/auth/v1/start`, {
        method: "POST",
        headers: {
          origin,
          cookie: owner.cookie,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contract: "auth.start@1",
          provider: "google",
          intent: "link",
          returnTo: "/inbox",
        }),
      }),
      authEnv,
    );
    expect(link.status).toBe(method === "passkey" ? 403 : 201);
    const persisted = await active.stub.get();
    expect(persisted?.sessionId).toBe(active.record.sessionId);
    expect(persisted?.recentReauthUntil).toBe(
      method === "passkey" ? null : until,
    );
  });

  it("retires an in-flight legacy link with no OAuth grant provenance without losing its active Session", async () => {
    const subject = `retired-link-${crypto.randomUUID()}`;
    const owner = await provisionIdentity(subject);
    const reauth = await reauthenticateFor(
      subject,
      owner.cookie,
      "link_google",
    );
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    const link = await startDesktop({
      intent: "link_google",
      method: "google",
      session: owner.cookie,
      authorizationId: reauth.authorizationId,
    });
    if (link.started === null) throw new Error("Link fixture absent");
    await completeOAuth(link.started, `${subject}-linked`);
    const delivered = await claim(link.started);
    expect(delivered.status).toBe(200);
    const preparedCookie = sessionCookie(delivered);
    const body = (await delivered.json()) as { deliveryId: string };
    await runInDurableObject(
      authEnv.DESKTOP_AUTH_FLOWS.getByName(link.started.flowId),
      async (_instance, state) => {
        const record = await state.storage.get<Record<string, unknown>>(
          "desktop_auth_flow_v1",
        );
        if (record === undefined) throw new Error("Legacy link fixture absent");
        delete record.reauthenticationMethod;
        await state.storage.put("desktop_auth_flow_v1", record);
      },
    );
    expect((await confirm(link.started, body.deliveryId)).status).toBe(409);
    for (const [cookie, expectedStatus] of [
      [owner.cookie, 200],
      [preparedCookie, 401],
    ] as const) {
      expect(
        (
          await route(
            new Request(`${origin}/api/auth/v1/session`, {
              headers: { ...nativeHeaders, cookie },
            }),
            authEnv,
          )
        ).status,
      ).toBe(expectedStatus);
    }
  });

  it("allows only one consumer after the OAuth grant source is revalidated", async () => {
    const subject = `grant-race-${crypto.randomUUID()}`;
    const owner = await provisionIdentity(subject);
    const reauth = await reauthenticateFor(
      subject,
      owner.cookie,
      "link_google",
    );
    expect((await confirm(reauth.started, reauth.deliveryId)).status).toBe(200);
    const attempts = await Promise.all(
      [0, 1].map(() =>
        startDesktop({
          intent: "link_google",
          method: "google",
          session: owner.cookie,
          authorizationId: reauth.authorizationId,
        }),
      ),
    );
    expect(attempts.map(({ response }) => response.status).sort()).toEqual([
      201, 409,
    ]);
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
