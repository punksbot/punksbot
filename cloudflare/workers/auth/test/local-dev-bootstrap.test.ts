import { validateContract } from "@punks/contracts";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { sessionToken } from "../src/cookies";
import type { AuthEnv } from "../src/env";

const LOCAL_PUNK_ID = "019913d8-1254-811e-8c0f-43aac49f3b21";

type BootstrapRpc = {
  fetch(request: Request): Promise<Response>;
  bootstrap(): Promise<unknown>;
};

function bootstrapService(props: unknown): BootstrapRpc {
  const factory =
    workerExports.LocalDevAuthBootstrapService as unknown as (options: {
      props: unknown;
    }) => BootstrapRpc;
  return factory({ props });
}

describe("local development Auth bootstrap", () => {
  it("creates and replays one usable opaque Punk session", async () => {
    const service = bootstrapService({
      role: "punks-local-dev-bootstrap",
      environment: "local",
    });

    const first = (await service.bootstrap()) as {
      ok: boolean;
      session: Record<string, unknown>;
      cookie: string;
    };
    expect(first.ok).toBe(true);
    expect(first.session).toMatchObject({
      punkId: LOCAL_PUNK_ID,
      recentReauthUntil: null,
      punk: {
        id: LOCAL_PUNK_ID,
        displayName: "Punk local",
        avatarUrl: null,
      },
    });
    expect(
      validateContract("punks://contracts/auth.session@1", first.session),
    ).toEqual({ valid: true });
    expect(first.cookie).toMatch(
      /^punks_session_dev=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/,
    );
    expect(JSON.stringify(first.session)).not.toContain(
      first.cookie.split(";")[0]?.split("=")[1],
    );

    const replay = await service.bootstrap();
    expect(replay).toEqual(first);

    const session = await workerExports.default.fetch(
      new Request("https://auth.punks.test/api/auth/v1/session", {
        headers: { cookie: first.cookie },
      }),
    );
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toEqual({ session: first.session });
  });

  it("accepts the HTTP development cookie only in the local environment", () => {
    const development = new Request("http://localhost:1420", {
      headers: { cookie: "punks_session_dev=local-token" },
    });
    const hosted = new Request("https://staging.punks.bot", {
      headers: { cookie: "__Host-punks_session=hosted-token" },
    });

    expect(sessionToken(development, { ENVIRONMENT: "local" } as AuthEnv)).toBe(
      "local-token",
    );
    expect(
      sessionToken(development, { ENVIRONMENT: "staging" } as AuthEnv),
    ).toBeNull();
    expect(sessionToken(hosted, { ENVIRONMENT: "staging" } as AuthEnv)).toBe(
      "hosted-token",
    );
  });

  it("fails closed unless exact local-only capability props are present", async () => {
    for (const props of [
      undefined,
      {},
      { role: "punks-local-dev-bootstrap" },
      { role: "punks-local-dev-bootstrap", environment: "staging" },
      { role: "other", environment: "local" },
      {
        role: "punks-local-dev-bootstrap",
        environment: "local",
        exposeToken: true,
      },
    ]) {
      await expect(bootstrapService(props).bootstrap()).resolves.toEqual({
        ok: false,
        code: "invalid_request",
      });
    }
  });

  it("has no HTTP surface of its own", async () => {
    const response = await bootstrapService({
      role: "punks-local-dev-bootstrap",
      environment: "local",
    }).fetch(new Request("https://auth.punks.test/__dev/bootstrap"));

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
