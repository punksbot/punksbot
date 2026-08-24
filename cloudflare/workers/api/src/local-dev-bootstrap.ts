import type {
  CreateConversationCommand,
  CreateWorkspaceCommand,
  PostMessageCommand,
} from "@punks/contracts";
import { WorkerEntrypoint } from "cloudflare:workers";

import type { ApiEnv } from "./env";
import { route } from "./router";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SESSION_COOKIE =
  /^punks_session_dev=[^;\r\n]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/;

const WORKSPACE_SLUG = "local";
const WORKSPACE_COMMAND_ID = "eb3124e5-7b1a-4d8e-bc54-47fb3c95f001";
const CONVERSATION_COMMAND_ID = "eb3124e5-7b1a-4d8e-bc54-47fb3c95f002";
const SEED_MESSAGES = [
  {
    commandId: "eb3124e5-7b1a-4d8e-bc54-47fb3c95f003",
    content: "Bienvenue dans Punks Bot.",
  },
  {
    commandId: "eb3124e5-7b1a-4d8e-bc54-47fb3c95f004",
    content: "Ce Workspace local est prêt pour développer la Punks UI.",
  },
  {
    commandId: "eb3124e5-7b1a-4d8e-bc54-47fb3c95f005",
    content:
      "Publiez un Message ici pour vérifier la persistance et le temps réel.",
  },
] as const;

type LocalDevBootstrapProps = {
  role: "punks-local-dev-bootstrap";
  environment: "local";
};

type LocalDevBootstrapInput = {
  punkId: string;
  sessionCookie: string;
};

function privateNotFound(): Response {
  return new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function validProps(
  value: unknown,
  environment: ApiEnv["ENVIRONMENT"],
): value is LocalDevBootstrapProps {
  if (
    environment !== "local" ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const props = value as Record<string, unknown>;
  return (
    exactKeys(props, ["role", "environment"]) &&
    props.role === "punks-local-dev-bootstrap" &&
    props.environment === "local"
  );
}

function validInput(value: unknown): value is LocalDevBootstrapInput {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const input = value as Record<string, unknown>;
  return (
    exactKeys(input, ["punkId", "sessionCookie"]) &&
    typeof input.punkId === "string" &&
    UUID.test(input.punkId) &&
    typeof input.sessionCookie === "string" &&
    SESSION_COOKIE.test(input.sessionCookie)
  );
}

function requestFailure(response: Response) {
  return {
    ok: false as const,
    code:
      response.status >= 500
        ? ("temporarily_unavailable" as const)
        : ("internal" as const),
  };
}

async function bodyRecord(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function nestedId(
  body: Record<string, unknown> | null,
  key: "workspace" | "conversation",
): string | null {
  const value = body?.[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && UUID.test(id) ? id : null;
}

/** Local-only capability that seeds the development Workspace authorities. */
export class LocalDevApiBootstrapService extends WorkerEntrypoint<
  ApiEnv,
  LocalDevBootstrapProps
> {
  override fetch(_request: Request): Response {
    return privateNotFound();
  }

  async bootstrap(input: unknown) {
    if (
      !validProps(this.ctx.props, this.env.ENVIRONMENT) ||
      !validInput(input)
    ) {
      return { ok: false as const, code: "invalid_request" as const };
    }
    const cookie = input.sessionCookie.split(";", 1)[0] ?? "";
    const workspaceCommand: CreateWorkspaceCommand = {
      contract: "workspace.create@1",
      commandId: WORKSPACE_COMMAND_ID,
      actor: { kind: "punk", punkId: input.punkId },
      payload: {
        slug: WORKSPACE_SLUG,
        name: "Punks Bot local",
        visibility: "private",
      },
    };
    const workspaceResponse = await route(
      new Request("https://punks.local/api/internal/v1/workspaces", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.env.OPERATOR_PROVISIONING_TOKEN}`,
          "content-type": "application/json",
          "idempotency-key": workspaceCommand.commandId,
        },
        body: JSON.stringify(workspaceCommand),
      }),
      this.env,
    );
    if (workspaceResponse.status !== 200 && workspaceResponse.status !== 201) {
      return requestFailure(workspaceResponse);
    }
    const workspaceId = nestedId(
      await bodyRecord(workspaceResponse),
      "workspace",
    );
    if (workspaceId === null) {
      return { ok: false as const, code: "internal" as const };
    }

    const conversationCommand: CreateConversationCommand = {
      contract: "conversation.create@1",
      commandId: CONVERSATION_COMMAND_ID,
      workspaceId,
      actor: { kind: "punk", punkId: input.punkId },
      payload: { name: "general", type: "stream", visibility: "open" },
    };
    const conversationResponse = await route(
      new Request(
        `https://punks.local/api/v1/workspaces/${workspaceId}/conversations`,
        {
          method: "POST",
          headers: {
            cookie,
            "content-type": "application/json",
            "idempotency-key": conversationCommand.commandId,
          },
          body: JSON.stringify(conversationCommand),
        },
      ),
      this.env,
    );
    if (
      conversationResponse.status !== 200 &&
      conversationResponse.status !== 201
    ) {
      return requestFailure(conversationResponse);
    }
    const conversationId = nestedId(
      await bodyRecord(conversationResponse),
      "conversation",
    );
    if (conversationId === null) {
      return { ok: false as const, code: "internal" as const };
    }

    for (const seed of SEED_MESSAGES) {
      const messageCommand: PostMessageCommand = {
        contract: "message.post@1",
        commandId: seed.commandId,
        workspaceId,
        conversationId,
        actor: { kind: "punk", punkId: input.punkId },
        payload: {
          content: seed.content,
          topic: null,
          replyToMessageId: null,
          broadcast: false,
          mentionedPunkIds: [],
          mediaIds: [],
        },
      };
      const messageResponse = await route(
        new Request(
          `https://punks.local/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/json",
              "idempotency-key": messageCommand.commandId,
            },
            body: JSON.stringify(messageCommand),
          },
        ),
        this.env,
      );
      if (messageResponse.status !== 200 && messageResponse.status !== 201) {
        return requestFailure(messageResponse);
      }
    }

    return {
      ok: true as const,
      coordinates: {
        workspaceSlug: WORKSPACE_SLUG,
        workspaceId,
        conversationId,
      },
    };
  }
}
