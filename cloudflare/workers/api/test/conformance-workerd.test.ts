import type {
  AddMessageReactionCommand,
  PostMessageCommand,
  RemoveMessageReactionCommand,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import operationCorpus from "../../../packages/contracts/conformance/desktop-social-loop-operations.json";
import followCorpus from "../../../packages/contracts/conformance/desktop-social-loop-follow.json";
import validationCorpus from "../../../packages/contracts/conformance/desktop-social-loop-validation.json";
import { env, SELF } from "cloudflare:test";
import { exports as workerExports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import type { ApiEnv } from "../src/env";
import { route } from "../src/router";
import {
  type BackendSemanticEvent,
  type BackendSemanticScenario,
  backendContractAccepted,
  observeBackendScenario,
} from "../src/semantic-observer";

const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const sessionCookie = "punks_session_dev=session-owner";

type BootstrapRpc = {
  bootstrap(input: unknown): Promise<unknown>;
};

function bootstrapService(): BootstrapRpc {
  const factory =
    workerExports.LocalDevApiBootstrapService as unknown as (options: {
      props: unknown;
    }) => BootstrapRpc;
  return factory({
    props: { role: "punks-local-dev-bootstrap", environment: "local" },
  });
}

function corpusExpected(operation: string, stimulus: string) {
  const expected = operationCorpus.operations
    .find((candidate) => candidate.operation === operation)
    ?.cases.find((testCase) => testCase.stimulus === stimulus)?.expect;
  if (expected === undefined) {
    throw new Error(`missing corpus case ${operation}/${stimulus}`);
  }
  return expected;
}

describe("corpus commun desktop-social-loop@1 sous workerd", () => {
  it("dérive la trace des événements et non du nom de fixture", () => {
    expect(
      observeBackendScenario({
        operation: "postMessage",
        caseName: "success",
        owner: "workspace",
        kind: "mutation",
        events: [{ type: "emit" }, { type: "cancel", phase: "in_flight" }],
      }),
    ).toMatchObject({ outcome: "reject", failureKind: "ambiguous" });
    expect(
      observeBackendScenario({
        operation: "postMessage",
        caseName: "cancel_in_flight",
        owner: "workspace",
        kind: "mutation",
        events: [{ type: "complete" }],
      }),
    ).toMatchObject({ outcome: "ok", failureKind: null });
  });

  it("refuse un ACK sémantique avant livraison et confirmation", () => {
    expect(
      observeBackendScenario({
        operation: "confirmFollowBatch",
        caseName: "ack-premature",
        owner: "workspace",
        kind: "local-orchestration",
        events: [{ type: "ack", cursor: 6 }],
      }).ack,
    ).toBe("suppressed");
  });

  it("rejoue indépendamment les contrats de chacune des 18 opérations", () => {
    expect(operationCorpus.operations).toHaveLength(18);
    for (const operation of operationCorpus.operations) {
      for (const testCase of operation.cases) {
        const actual = observeBackendScenario({
          operation: operation.operation,
          caseName: testCase.name,
          owner: operation.owner as BackendSemanticScenario["owner"],
          kind: operation.kind as BackendSemanticScenario["kind"],
          events: testCase.events as BackendSemanticEvent[],
          diagnostic: testCase.diagnostic,
        });
        expect(actual, `${operation.operation}/${testCase.name}`).toEqual(
          testCase.expect,
        );
        expect(Object.keys(testCase.expect).sort()).toEqual([
          "ack",
          "case",
          "deliveries",
          "failureKind",
          "generation",
          "operation",
          "outcome",
          "phase",
          "recoveryDecision",
          "rendererConfirmation",
        ]);
      }
    }
    const normalized = operationCorpus.operations.flatMap((operation) =>
      operation.cases.map((testCase) =>
        observeBackendScenario({
          operation: operation.operation,
          caseName: testCase.name,
          owner: operation.owner as BackendSemanticScenario["owner"],
          kind: operation.kind as BackendSemanticScenario["kind"],
          events: testCase.events as BackendSemanticEvent[],
          diagnostic: testCase.diagnostic,
        }),
      ),
    );
    expect(JSON.stringify(normalized)).not.toContain(
      operationCorpus.forbiddenMarkers[0],
    );
    for (const trace of followCorpus.traces) {
      for (const step of trace.steps) {
        if (step.operation === "frame") {
          expect(
            validateContract(
              "punks://contracts/conversation.follow-server-frame@1",
              step.frame,
            ).valid,
            trace.name,
          ).toBe(true);
        }
      }
    }
  });

  it("rejoue sous workerd les payloads et problèmes fermés historiques", () => {
    for (const testCase of validationCorpus.cases) {
      if (testCase.kind === "cursor") {
        const contract =
          testCase.operation === "getTimeline"
            ? "punks://contracts/message.history@1"
            : "punks://contracts/workspace.list@1";
        const payload =
          testCase.operation === "getTimeline"
            ? {
                contract: "message.history@1",
                workspaceId: ownerPunkId,
                conversationId: ownerPunkId,
                cursor: testCase.cursor,
                limit: 50,
              }
            : {
                contract: "workspace.list@1",
                cursor: testCase.cursor,
                limit: 50,
              };
        const valid = backendContractAccepted(contract, payload);
        expect(valid ? "ok" : "reject", testCase.name).toBe(
          testCase.expect.outcome,
        );
        continue;
      }
      if (testCase.kind === "closed_error") {
        const trace = observeBackendScenario({
          operation: testCase.operation,
          caseName: testCase.name,
          owner: "workspace",
          kind: "mutation",
          events: [{ type: "problem", payload: testCase.problem }],
        });
        expect(trace.outcome, testCase.name).toBe(testCase.expect.outcome);
        expect(trace.failureKind, testCase.name).toBe(
          testCase.expect.failureKind,
        );
        continue;
      }
      const valid = backendContractAccepted(
        testCase.contract ?? "",
        testCase.payload,
      );
      expect(valid ? "ok" : "reject", testCase.name).toBe(
        testCase.expect.outcome,
      );
    }
  });

  it("traverse les routes, bindings et Durable Objects réels, idempotence comprise", async () => {
    const bootstrap = (await bootstrapService().bootstrap({
      punkId: ownerPunkId,
      sessionCookie:
        "punks_session_dev=session-owner; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax",
    })) as {
      ok: boolean;
      coordinates: {
        workspaceSlug: string;
        workspaceId: string;
        conversationId: string;
      };
    };
    expect(bootstrap.ok).toBe(true);
    const { workspaceSlug, workspaceId, conversationId } =
      bootstrap.coordinates;

    const compatibility = await route(
      new Request("https://punks.bot/api/v1/desktop/compatibility", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          operationCorpus.operations.find(
            ({ operation }) => operation === "checkCompatibility",
          )?.request?.payload,
        ),
      }),
      {
        ...(env as ApiEnv),
        DESKTOP_SOCIAL_LOOP_ENABLED: "true",
      } as unknown as ApiEnv,
    );
    expect(compatibility.status).toBe(200);
    expect(
      validateContract(
        "punks://contracts/desktop.compatibility-response@1",
        await compatibility.json(),
      ).valid,
    ).toBe(true);

    const directoryEnv = {
      ...(env as ApiEnv),
      PROJECTION_DIRECTORY: {
        async listWorkspaceCandidates() {
          return [{ workspaceId }];
        },
        async listConversationCandidates() {
          return [{ workspaceId, conversationId }];
        },
      },
    } as unknown as ApiEnv;
    const workspaces = await route(
      new Request("https://punks.bot/api/v1/workspaces?limit=50", {
        headers: { cookie: sessionCookie },
      }),
      directoryEnv,
    );
    expect(workspaces.status).toBe(200);
    expect(
      validateContract(
        "punks://contracts/workspace.list-response@1",
        await workspaces.json(),
      ).valid,
    ).toBe(true);
    const streams = await route(
      new Request(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations?limit=50`,
        { headers: { cookie: sessionCookie } },
      ),
      directoryEnv,
    );
    expect(streams.status).toBe(200);
    expect(
      validateContract(
        "punks://contracts/conversation.list-response@1",
        await streams.json(),
      ).valid,
    ).toBe(true);

    const workspace = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceSlug}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(workspace.status).toBe(200);
    const stream = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(stream.status).toBe(200);
    const history = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
      { headers: { cookie: sessionCookie } },
    );
    expect(history.status).toBe(200);

    const postCommand: PostMessageCommand = {
      contract: "message.post@1",
      commandId: "50000000-0000-8000-8000-000000000001",
      workspaceId,
      conversationId,
      actor: { kind: "punk", punkId: ownerPunkId },
      payload: {
        content: "Conformité workerd réelle",
        replyToMessageId: null,
        broadcast: false,
        topic: null,
        mentionedPunkIds: [],
        mediaIds: [],
      },
    };
    const post = () =>
      SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: {
            cookie: sessionCookie,
            "content-type": "application/json",
            "idempotency-key": postCommand.commandId,
          },
          body: JSON.stringify(postCommand),
        },
      );
    const first = await post();
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      message: { id: string; cursor: number };
      replayed: boolean;
    };
    expect(firstBody.replayed).toBe(false);
    expect(firstBody.replayed ? "replayed" : "ok").toBe(
      corpusExpected("postMessage", "success").outcome,
    );
    const replay = await post();
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as {
      message: { id: string };
      replayed: boolean;
    };
    expect(replayBody).toMatchObject({
      message: { id: firstBody.message.id },
      replayed: true,
    });
    expect(replayBody.replayed ? "replayed" : "ok").toBe(
      corpusExpected("postMessage", "replayed_response").outcome,
    );

    const thread = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages?threadRootMessageId=${firstBody.message.id}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(thread.status).toBe(200);
    expect(
      validateContract(
        "punks://contracts/message.history-response@1",
        await thread.json(),
      ).valid,
    ).toBe(true);

    const reactionBase = {
      workspaceId,
      conversationId,
      messageId: firstBody.message.id,
      actor: { kind: "punk" as const, punkId: ownerPunkId },
      payload: { reaction: "🔥" },
    };
    const add: AddMessageReactionCommand = {
      ...reactionBase,
      contract: "message.reaction-add@1",
      commandId: "50000000-0000-8000-8000-000000000002",
    };
    const remove: RemoveMessageReactionCommand = {
      ...reactionBase,
      contract: "message.reaction-remove@1",
      commandId: "50000000-0000-8000-8000-000000000003",
    };
    const mutateReaction = async (
      action: "add" | "remove",
      command: AddMessageReactionCommand | RemoveMessageReactionCommand,
    ) => {
      const response = await SELF.fetch(
        `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/messages/${firstBody.message.id}/reactions/${action}`,
        {
          method: "POST",
          headers: {
            cookie: sessionCookie,
            "content-type": "application/json",
            "idempotency-key": command.commandId,
          },
          body: JSON.stringify(command),
        },
      );
      expect([200, 201]).toContain(response.status);
      const body = (await response.json()) as {
        effect: "added" | "removed" | "unchanged";
        replayed: boolean;
      };
      expect(
        validateContract(
          "punks://contracts/message.reaction-mutation-response@1",
          body,
        ).valid,
      ).toBe(true);
      return body;
    };
    const added = await mutateReaction("add", add);
    expect(added).toMatchObject({ effect: "added", replayed: false });
    expect(added.replayed ? "replayed" : "ok").toBe(
      corpusExpected("addReaction", "success").outcome,
    );
    const noOpAdd: AddMessageReactionCommand = {
      ...add,
      commandId: "50000000-0000-8000-8000-000000000004",
    };
    const unchanged = await mutateReaction("add", noOpAdd);
    expect(unchanged).toMatchObject({ effect: "unchanged", replayed: false });
    expect(unchanged.effect === "unchanged" ? "noop" : "ok").toBe(
      corpusExpected("addReaction", "authoritative_noop").outcome,
    );
    const replayedAdd = await mutateReaction("add", add);
    expect(replayedAdd.replayed).toBe(true);
    expect(replayedAdd.replayed ? "replayed" : "ok").toBe(
      corpusExpected("addReaction", "replayed_response").outcome,
    );
    const removed = await mutateReaction("remove", remove);
    expect(removed).toMatchObject({ effect: "removed", replayed: false });

    const checkpointResponse = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(checkpointResponse.status).toBe(200);
    const checkpointBody = (await checkpointResponse.json()) as {
      conversation: { cursor: number };
    };
    const followCheckpoint = checkpointBody.conversation.cursor;

    const authors = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/authors/resolve`,
      {
        method: "POST",
        headers: { cookie: sessionCookie, "content-type": "application/json" },
        body: JSON.stringify({
          contract: "author.resolve@1",
          workspaceId,
          authors: [{ kind: "punk", punkId: ownerPunkId }],
        }),
      },
    );
    expect(authors.status).toBe(200);
    expect(
      validateContract(
        "punks://contracts/author.resolve-response@1",
        await authors.json(),
      ).valid,
    ).toBe(true);

    const followed = await SELF.fetch(
      `https://punks.bot/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/follow?afterCursor=${followCheckpoint}`,
      {
        headers: {
          cookie: sessionCookie,
          origin: "https://punks.bot",
          upgrade: "websocket",
          "sec-websocket-protocol": "punks.follow.v1",
        },
      },
    );
    const socket = followed.webSocket;
    expect(socket).not.toBeNull();
    if (socket !== null) {
      const readyFrame = new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent) => {
          try {
            const frame = JSON.parse(String(event.data)) as {
              type?: string;
            };
            if (frame.type === "ready") {
              socket.removeEventListener("message", onMessage);
              resolve();
            } else if (
              frame.type === "resync-required" ||
              frame.type === "conversation-unavailable"
            ) {
              socket.removeEventListener("message", onMessage);
              reject(
                new Error(`FOLLOW expected ready, received ${frame.type}`),
              );
            }
          } catch (error) {
            socket.removeEventListener("message", onMessage);
            reject(error);
          }
        };
        socket.addEventListener("message", onMessage);
      });
      const changesFrame = new Promise<Record<string, unknown>>(
        (resolve, reject) => {
          const onMessage = (event: MessageEvent) => {
            try {
              const frame = JSON.parse(String(event.data)) as unknown;
              expect(
                validateContract(
                  "punks://contracts/conversation.follow-server-frame@1",
                  frame,
                ).valid,
              ).toBe(true);
              if (
                typeof frame === "object" &&
                frame !== null &&
                "type" in frame &&
                frame.type === "changes"
              ) {
                socket.removeEventListener("message", onMessage);
                resolve(frame as Record<string, unknown>);
              } else if (
                typeof frame === "object" &&
                frame !== null &&
                "type" in frame &&
                (frame.type === "resync-required" ||
                  frame.type === "conversation-unavailable")
              ) {
                socket.removeEventListener("message", onMessage);
                reject(
                  new Error(`FOLLOW expected changes, received ${frame.type}`),
                );
              }
            } catch (error) {
              socket.removeEventListener("message", onMessage);
              reject(error);
            }
          };
          socket.addEventListener("message", onMessage);
        },
      );
      socket.accept();
      await Promise.race([
        readyFrame,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("FOLLOW ready timeout")), 5_000),
        ),
      ]);
      const liveAdd: AddMessageReactionCommand = {
        ...add,
        commandId: "50000000-0000-8000-8000-000000000005",
      };
      await mutateReaction("add", liveAdd);
      const frame = await Promise.race([
        changesFrame,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("FOLLOW changes frame timeout")),
            5_000,
          ),
        ),
      ]);
      const throughCursor = frame.throughCursor;
      expect(typeof throughCursor).toBe("number");
      if (typeof throughCursor !== "number") {
        throw new TypeError("FOLLOW changes frame omitted throughCursor");
      }
      const observed = observeBackendScenario({
        operation: "confirmFollowBatch",
        caseName: "real-workerd-handoff",
        owner: "workspace",
        kind: "local-orchestration",
        events: [
          {
            type: "delivery",
            contract: "punks://contracts/conversation.follow-server-frame@1",
            payload: frame,
            deliveryId: "delivery:workerd",
          },
          { type: "renderer", state: "confirmed" },
          { type: "ack", cursor: throughCursor },
        ],
      });
      expect(observed.rendererConfirmation).toBe("confirmed");
      expect(observed.ack).toBe(`sent:cursor:${throughCursor}`);
      const ack = {
        schemaVersion: 1,
        type: "ack",
        throughCursor,
      };
      expect(
        validateContract(
          "punks://contracts/conversation.follow-client-frame@1",
          ack,
        ).valid,
      ).toBe(true);
      socket.send(JSON.stringify(ack));
      socket.close(1000, "conformance-complete");
    }
  });

  it("exerce la redaction sur une vraie réponse Worker", async () => {
    const marker = operationCorpus.forbiddenMarkers[0];
    const response = await SELF.fetch(
      "https://punks.bot/api/v1/desktop/compatibility",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...operationCorpus.operations[0]?.request?.payload,
          forbiddenSecret: marker,
        }),
      },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(marker);
  });
});
