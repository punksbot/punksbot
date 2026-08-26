import {
  SELF,
  env,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";

const EXECUTION_ID = "919191919191:linux-x64:coupure:api-conversation";
const CANDIDATE_SHA = "91".repeat(20);
const DEPLOYMENT_ID = `sha256:${"92".repeat(32)}`;
const AUTHORIZATION = `Bearer ${env.OPERATOR_PROVISIONING_TOKEN}`;
const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const defaultMessageId = "00000000-0000-8000-8000-000000000058";

function businessProbe(
  input: {
    workspaceId?: string;
    workspaceSlug?: string;
    conversationId?: string;
    messageId?: string;
  } = {},
) {
  return {
    punkId: ownerPunkId,
    workspaceId: input.workspaceId ?? "00000000-0000-8000-8000-000000000059",
    workspaceSlug: input.workspaceSlug ?? "promotion-fixture",
    conversationId:
      input.conversationId ?? "00000000-0000-8000-8000-000000000060",
    messageId: input.messageId ?? defaultMessageId,
  };
}

async function prepareTargets() {
  const workspaceCommandId = crypto.randomUUID();
  const workspaceSlug = `fault-${workspaceCommandId.slice(0, 8)}`;
  const workspace = await SELF.fetch(
    "https://staging.punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        authorization: AUTHORIZATION,
        "content-type": "application/json",
        "idempotency-key": workspaceCommandId,
      },
      body: JSON.stringify({
        contract: "workspace.create@1",
        commandId: workspaceCommandId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: {
          slug: workspaceSlug,
          name: "Promotion fault target",
          visibility: "private",
        },
      }),
    },
  );
  expect(workspace.status).toBe(201);
  const workspaceId = (
    (await workspace.json()) as { workspace: { id: string } }
  ).workspace.id;
  const conversationCommandId = crypto.randomUUID();
  const conversation = await SELF.fetch(
    `https://staging.punks.bot/api/v1/workspaces/${workspaceId}/conversations`,
    {
      method: "POST",
      headers: {
        cookie: "__Host-punks_session=session-owner",
        "content-type": "application/json",
        "idempotency-key": conversationCommandId,
      },
      body: JSON.stringify({
        contract: "conversation.create@1",
        commandId: conversationCommandId,
        workspaceId,
        actor: { kind: "punk", punkId: ownerPunkId },
        payload: {
          name: "promotion-fault",
          type: "stream",
          visibility: "open",
        },
      }),
    },
  );
  expect(conversation.status).toBe(201);
  const conversationId = (
    (await conversation.json()) as { conversation: { id: string } }
  ).conversation.id;
  return { workspaceId, workspaceSlug, conversationId };
}

async function command(
  path: string,
  body: unknown,
  authorization = AUTHORIZATION,
) {
  return SELF.fetch(`https://staging.punks.bot${path}`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("promotion fault controller", () => {
  it("is observed through a distinct authenticated client boundary", async () => {
    const target = await prepareTargets();
    const identity = {
      executionId: "959595959595:linux-x64:coupure:api-conversation",
      candidateSha: CANDIDATE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      type: "coupure",
      authority: "api-conversation",
      target: {
        kind: "aggregate",
        id: target.conversationId,
        probe: businessProbe(target),
      },
    };
    expect(
      (
        await command("/api/internal/v1/promotion/faults/inject", {
          contract: "promotion.fault-inject@1",
          ...identity,
        })
      ).status,
    ).toBe(201);

    const observe = (cookie = "punks_session_dev=session-owner") =>
      SELF.fetch("https://staging.punks.bot/api/v1/promotion/faults/observe", {
        method: "POST",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({
          contract: "promotion.fault-observe@1",
          ...identity,
        }),
      });
    expect((await observe()).status).toBe(503);
    expect((await observe("")).status).toBe(401);
    const readConversation = () =>
      SELF.fetch(
        `https://staging.punks.bot/api/v1/workspaces/${target.workspaceId}/conversations/${target.conversationId}/messages?limit=1&direction=older`,
        { headers: { cookie: "punks_session_dev=session-owner" } },
      );
    expect((await readConversation()).status).toBe(503);

    for (const proof of [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
      "recu-resistant-pitr",
    ]) {
      expect(
        (
          await command("/api/internal/v1/promotion/faults/recover", {
            contract: "promotion.fault-recover@1",
            ...identity,
            proof,
          })
        ).status,
      ).toBe(200);
    }
    const recovered = await observe();
    expect(recovered.status).toBe(200);
    expect((await readConversation()).status).toBe(200);
    await expect(recovered.json()).resolves.toEqual({
      contract: "promotion.fault-observe@1",
      executionId: identity.executionId,
      authority: identity.authority,
      status: "recovered",
    });
  });

  it("injects one source-bound failure and only recovers after four receipts", async () => {
    const target = await prepareTargets();
    const identity = {
      executionId: EXECUTION_ID,
      candidateSha: CANDIDATE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      type: "coupure",
      authority: "api-conversation",
      target: {
        kind: "aggregate",
        id: target.conversationId,
        probe: businessProbe(target),
      },
    };
    const injected = await command("/api/internal/v1/promotion/faults/inject", {
      contract: "promotion.fault-inject@1",
      ...identity,
    });
    expect(injected.status).toBe(201);
    await expect(injected.json()).resolves.toMatchObject({
      receipt: {
        schema: "punks.promotion-fault-receipt.v1",
        phase: "injected",
        sequence: 1,
        ...identity,
      },
      authorityState: {
        schema: "punks.promotion-authority-fault-state.v1",
        executionId: identity.executionId,
        candidateSha: identity.candidateSha,
        stagingDeploymentId: identity.stagingDeploymentId,
        type: identity.type,
        authority: identity.authority,
        target: identity.target,
        phase: "injected",
        proof: null,
        sequence: 1,
        worker: "punks-api-staging",
        binding: "CONVERSATIONS",
        className: "ConversationDO",
      },
    });

    const failedProbe = await command(
      "/api/internal/v1/promotion/faults/probe",
      {
        contract: "promotion.fault-probe@1",
        executionId: EXECUTION_ID,
      },
    );
    expect(failedProbe.status).toBe(503);
    await expect(failedProbe.json()).resolves.toMatchObject({
      type: "https://punks.bot/problems/temporarily-unavailable",
      status: 503,
    });

    const proofs = [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
      "recu-resistant-pitr",
    ];
    for (const [index, proof] of proofs.entries()) {
      const recovery = await command(
        "/api/internal/v1/promotion/faults/recover",
        {
          contract: "promotion.fault-recover@1",
          ...identity,
          proof,
        },
      );
      expect(recovery.status).toBe(200);
      await expect(recovery.json()).resolves.toMatchObject({
        receipt: {
          phase: index === proofs.length - 1 ? "recovered" : "recovering",
          proof,
          sequence: index + 2,
        },
        authorityState: {
          executionId: identity.executionId,
          authority: identity.authority,
          phase: index === proofs.length - 1 ? "recovered" : "recovering",
          proof,
          sequence: index + 2,
          binding: "CONVERSATIONS",
          className: "ConversationDO",
        },
      });
    }

    const recoveredProbe = await command(
      "/api/internal/v1/promotion/faults/probe",
      {
        contract: "promotion.fault-probe@1",
        executionId: EXECUTION_ID,
      },
    );
    expect(recoveredProbe.status).toBe(200);
    await expect(recoveredProbe.json()).resolves.toMatchObject({
      status: "recovered",
      executionId: EXECUTION_ID,
    });
  });

  it("resumes after the controller committed the PITR Receipt but the caller was interrupted", async () => {
    const target = await prepareTargets();
    const identity = {
      executionId: "929292929292:linux-x64:coupure:api-conversation",
      candidateSha: CANDIDATE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      type: "coupure" as const,
      authority: "api-conversation",
      target: {
        kind: "aggregate" as const,
        id: target.conversationId,
        probe: businessProbe(target),
      },
    };
    expect(
      (
        await command("/api/internal/v1/promotion/faults/inject", {
          contract: "promotion.fault-inject@1",
          ...identity,
        })
      ).status,
    ).toBe(201);
    for (const proof of [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
    ]) {
      expect(
        (
          await command("/api/internal/v1/promotion/faults/recover", {
            contract: "promotion.fault-recover@1",
            ...identity,
            proof,
          })
        ).status,
      ).toBe(200);
    }

    const terminal = { ...identity, proof: "recu-resistant-pitr" as const };
    await expect(
      env.PROMOTION_FAULTS.getByName(identity.executionId).recover(terminal),
    ).resolves.toMatchObject({ phase: "recovered", proof: terminal.proof });
    await runInDurableObject(
      env.CONVERSATIONS.getByName(target.conversationId),
      async (_instance, state) => {
        await state.storage.delete("__punks_promotion_authority_fault_v1");
      },
    );

    const resumed = await command("/api/internal/v1/promotion/faults/recover", {
      contract: "promotion.fault-recover@1",
      ...terminal,
    });
    expect(resumed.status).toBe(200);
    await expect(resumed.json()).resolves.toMatchObject({
      receipt: { replayed: true, phase: "recovered" },
      authorityState: {
        phase: "recovered",
        proof: "recu-resistant-pitr",
        authority: identity.authority,
      },
    });
  });

  it("keeps the controller unavailable without the operator credential", async () => {
    const response = await command(
      "/api/internal/v1/promotion/faults/inject",
      {
        contract: "promotion.fault-inject@1",
        executionId: "unauthorized",
      },
      "Bearer invalid",
    );
    expect(response.status).toBe(403);
  });

  it("injects an Auth fault in the named Auth authority binding", async () => {
    const identity = {
      executionId: "969696969696:windows-x64:revocation:auth-session",
      candidateSha: CANDIDATE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      type: "revocation",
      authority: "auth-session",
      target: {
        kind: "aggregate",
        id: "33333333-3333-4333-8333-333333333333",
        probe: businessProbe(),
      },
    };
    const injected = await command("/api/internal/v1/promotion/faults/inject", {
      contract: "promotion.fault-inject@1",
      ...identity,
    });
    expect(injected.status).toBe(201);
    await expect(injected.json()).resolves.toMatchObject({
      authorityState: {
        ...identity,
        phase: "injected",
        worker: "punks-auth-staging",
        binding: "SESSIONS",
        className: "SessionDO",
      },
    });
  });

  it("injects service faults inside the Erasure and Attestation Workers", async () => {
    const services = [
      {
        authority: "erasure-registry",
        executionId: "979797979797:linux-x64:coupure:erasure-registry",
        worker: "punks-erasure-staging",
        binding: "ERASURE_REGISTRY",
        className: "ErasureRegistry",
      },
      {
        authority: "internal-event-signature",
        executionId:
          "989898989898:windows-x64:perte-autorite:internal-event-signature",
        worker: "punks-attestation-staging",
        binding: "ATTESTATION",
        className: "AttestationWorker",
      },
    ];
    for (const service of services) {
      const type = service.executionId.includes("perte-autorite")
        ? "perte-autorite"
        : "coupure";
      const identity = {
        executionId: service.executionId,
        candidateSha: CANDIDATE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        type,
        authority: service.authority,
        target: {
          kind: "service",
          id: service.authority,
          probe: businessProbe(),
        },
      };
      const injected = await command(
        "/api/internal/v1/promotion/faults/inject",
        { contract: "promotion.fault-inject@1", ...identity },
      );
      expect(injected.status).toBe(201);
      await expect(injected.json()).resolves.toMatchObject({
        authorityState: {
          ...identity,
          phase: "injected",
          worker: service.worker,
          binding: service.binding,
          className: service.className,
        },
      });
    }
  });

  it("rejects an unknown authority as invalid input before Durable Object RPC", async () => {
    const response = await command("/api/internal/v1/promotion/faults/inject", {
      contract: "promotion.fault-inject@1",
      executionId: "949494949494:linux-x64:coupure:unknown-authority",
      candidateSha: CANDIDATE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      type: "coupure",
      authority: "unknown-authority",
      target: {
        kind: "service",
        id: "unknown-authority",
        probe: businessProbe(),
      },
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "invalid_input",
    });
  });

  it("expires recovered controller state through its retention alarm", async () => {
    const target = await prepareTargets();
    const identity = {
      executionId: "939393939393:linux-x64:coupure:api-workspace",
      candidateSha: CANDIDATE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      type: "coupure",
      authority: "api-workspace",
      target: {
        kind: "aggregate",
        id: target.workspaceId,
        probe: businessProbe(target),
      },
    };
    expect(
      (
        await command("/api/internal/v1/promotion/faults/inject", {
          contract: "promotion.fault-inject@1",
          ...identity,
        })
      ).status,
    ).toBe(201);
    for (const proof of [
      "roll-forward",
      "rpo-logique-nul",
      "session-non-restauree",
      "recu-resistant-pitr",
    ]) {
      expect(
        (
          await command("/api/internal/v1/promotion/faults/recover", {
            contract: "promotion.fault-recover@1",
            ...identity,
            proof,
          })
        ).status,
      ).toBe(200);
    }

    const stub = env.PROMOTION_FAULTS.getByName(identity.executionId);
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const missing = await command("/api/internal/v1/promotion/faults/probe", {
      contract: "promotion.fault-probe@1",
      executionId: identity.executionId,
    });
    expect(missing.status).toBe(404);
  });
});
