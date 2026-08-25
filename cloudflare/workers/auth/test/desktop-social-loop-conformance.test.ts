import { validateContract } from "@punks/contracts";
import operationCorpus from "../../../packages/contracts/conformance/desktop-social-loop-operations.json";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type BootstrapRpc = {
  bootstrap(): Promise<{
    ok: boolean;
    cookie?: string;
    session?: unknown;
  }>;
};

function bootstrapService(): BootstrapRpc {
  const factory =
    workerExports.LocalDevAuthBootstrapService as unknown as (options: {
      props: unknown;
    }) => BootstrapRpc;
  return factory({
    props: { role: "punks-local-dev-bootstrap", environment: "local" },
  });
}

describe("desktop-social-loop@1 Auth sous workerd", () => {
  it("exerce getSession et le démarrage desktop fermé sur le Worker et ses Durable Objects", async () => {
    const names = operationCorpus.operations.map(({ operation }) => operation);
    expect(names).toEqual(
      expect.arrayContaining([
        "getSession",
        "startDesktopAuthentication",
        "getDesktopAuthenticationStatus",
        "claimDesktopAuthentication",
        "confirmDesktopAuthentication",
        "cancelDesktopAuthentication",
        "renewDesktopSession",
        "revokeDesktopSession",
      ]),
    );

    const bootstrapped = await bootstrapService().bootstrap();
    expect(bootstrapped.ok).toBe(true);
    expect(
      validateContract("punks://contracts/auth.session@1", bootstrapped.session)
        .valid,
    ).toBe(true);
    const cookie = bootstrapped.cookie ?? "";

    const session = await workerExports.default.fetch(
      new Request("https://auth.punks.test/api/auth/v1/session", {
        headers: { cookie },
      }),
    );
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as { session: unknown };
    expect(
      validateContract("punks://contracts/auth.session@1", sessionBody.session)
        .valid,
    ).toBe(true);

    const startPayload = operationCorpus.operations.find(
      ({ operation }) => operation === "startDesktopAuthentication",
    )?.request?.payload;
    const started = await workerExports.default.fetch(
      new Request("https://auth.punks.test/api/auth/v1/desktop/start", {
        method: "POST",
        headers: {
          origin: "https://auth.punks.test",
          "sec-punks-desktop-environment": "local",
          "content-type": "application/json",
        },
        body: JSON.stringify(startPayload),
      }),
    );
    expect(started.status).toBe(201);
    expect(
      validateContract(
        "punks://contracts/desktop-auth.start@1",
        await started.json(),
      ).valid,
    ).toBe(true);
  });
});
