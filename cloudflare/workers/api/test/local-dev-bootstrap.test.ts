import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const OWNER_PUNK_ID = "00000000-0000-8000-8000-000000000001";
const SESSION_COOKIE =
  "punks_session_dev=session-owner; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax";

type BootstrapRpc = {
  fetch(request: Request): Promise<Response>;
  bootstrap(input: unknown): Promise<unknown>;
};

function bootstrapService(props: unknown): BootstrapRpc {
  const factory =
    workerExports.LocalDevApiBootstrapService as unknown as (options: {
      props: unknown;
    }) => BootstrapRpc;
  return factory({ props });
}

const props = {
  role: "punks-local-dev-bootstrap",
  environment: "local",
};

describe("local development API bootstrap", () => {
  it("creates and replays one private Workspace with a Conversation and seed Messages", async () => {
    const service = bootstrapService(props);
    const input = { punkId: OWNER_PUNK_ID, sessionCookie: SESSION_COOKIE };

    const first = (await service.bootstrap(input)) as {
      ok: boolean;
      coordinates: {
        workspaceSlug: string;
        workspaceId: string;
        conversationId: string;
      };
    };
    expect(first).toMatchObject({
      ok: true,
      coordinates: { workspaceSlug: "local" },
    });
    expect(first.coordinates.workspaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(first.coordinates.conversationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(first)).not.toContain("operator-test-token");
    expect(JSON.stringify(first)).not.toContain("session-owner");

    await expect(service.bootstrap(input)).resolves.toEqual(first);

    const cookie = SESSION_COOKIE.split(";")[0] ?? "";
    const workspace = await workerExports.default.fetch(
      new Request(
        `https://punks.bot/api/v1/workspaces/${first.coordinates.workspaceSlug}`,
        { headers: { cookie } },
      ),
    );
    expect(workspace.status).toBe(200);
    await expect(workspace.json()).resolves.toMatchObject({
      workspace: {
        id: first.coordinates.workspaceId,
        slug: "local",
        name: "Punks Bot local",
        visibility: "private",
      },
    });

    const conversation = await workerExports.default.fetch(
      new Request(
        `https://punks.bot/api/v1/workspaces/${first.coordinates.workspaceId}/conversations/${first.coordinates.conversationId}`,
        { headers: { cookie } },
      ),
    );
    expect(conversation.status).toBe(200);
    await expect(conversation.json()).resolves.toMatchObject({
      conversation: {
        id: first.coordinates.conversationId,
        workspaceId: first.coordinates.workspaceId,
        name: "general",
        type: "stream",
      },
    });

    const history = await workerExports.default.fetch(
      new Request(
        `https://punks.bot/api/v1/workspaces/${first.coordinates.workspaceId}/conversations/${first.coordinates.conversationId}/messages`,
        { headers: { cookie } },
      ),
    );
    expect(history.status).toBe(200);
    const historyBody = (await history.json()) as {
      items: Array<{ content: string }>;
    };
    expect(historyBody.items.map(({ content }) => content)).toEqual([
      "Bienvenue dans Punks Bot.",
      "Ce Workspace local est prêt pour développer la Punks UI.",
      "Publiez un Message ici pour vérifier la persistance et le temps réel.",
    ]);
  });

  it("fails closed for malformed input or non-local capability props", async () => {
    const validInput = {
      punkId: OWNER_PUNK_ID,
      sessionCookie: SESSION_COOKIE,
    };
    const invalidCalls: Array<[unknown, unknown]> = [
      [undefined, validInput],
      [
        { role: "punks-local-dev-bootstrap", environment: "staging" },
        validInput,
      ],
      [props, null],
      [props, { ...validInput, operatorToken: "expose" }],
      [props, { ...validInput, punkId: "not-a-punk" }],
      [props, { ...validInput, sessionCookie: "session-owner" }],
    ];

    for (const [serviceProps, input] of invalidCalls) {
      await expect(
        bootstrapService(serviceProps).bootstrap(input),
      ).resolves.toEqual({
        ok: false,
        code: "invalid_request",
      });
    }
  });

  it("has no HTTP surface of its own", async () => {
    const response = await bootstrapService(props).fetch(
      new Request("https://punks.bot/__dev/bootstrap"),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
