import type { AuthEnv } from "../src/env";

/** Seeds the actual source/grant protocol for Account Merge authority tests. */
export async function confirmedReauthGrant(
  env: AuthEnv,
  input: {
    sessionId: string;
    punkId: string;
  },
) {
  const handoffId = crypto.randomUUID();
  const source = env.DESKTOP_AUTH_FLOWS.getByName(handoffId);
  const now = Date.now();
  if (
    !(await source.create({
      flowId: handoffId,
      intent: "reauthenticate",
      method: "google",
      purpose: "link_github",
      workspaceOwnershipTransfer: null,
      verifierCommitment: "A".repeat(43),
      environment: env.ENVIRONMENT,
      currentSessionId: input.sessionId,
      currentPunkId: input.punkId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 600_000).toISOString(),
    })) ||
    !(await source.ready({
      punkId: input.punkId,
      outcomeCode: "reauthenticated",
    }))
  ) {
    throw new Error("Reauthentication source fixture unavailable");
  }
  const claimed = await source.claim("A".repeat(43));
  if (
    !claimed.ok ||
    claimed.kind !== "reauthorization" ||
    claimed.flow.authorizationExpiresAt === null
  ) {
    throw new Error("Reauthentication claim fixture unavailable");
  }
  const authorizationId = claimed.authorizationId;
  const expiresAt = claimed.flow.authorizationExpiresAt;
  if (
    !(await env.DESKTOP_REAUTH_GRANTS.getByName(authorizationId).create({
      authorizationId,
      ...input,
      targetMethod: "link_github",
      workspaceOwnershipTransfer: null,
      handoffId,
      expiresAt,
    })) ||
    (await source.confirmed({
      deliveryId: claimed.deliveryId,
      sessionId: input.sessionId,
    })) === null
  ) {
    throw new Error("Confirmed reauthentication fixture unavailable");
  }
  return { authorizationId, expiresAt };
}
