import type {
  DesktopSessionRenewConfirmRequest,
  DesktopSessionRenewConfirmedResponse,
  DesktopSessionRenewPrepareRequest,
  DesktopSessionRenewPreparedResponse,
  DesktopSessionRevokeRequest,
  DesktopSessionRevokeResponse,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import { sessionToken } from "./cookies";
import type { AuthEnv } from "./env";
import { json, problem, readJson } from "./http";
import {
  aggregateName,
  getActiveSession,
  prepareDesktopSessionForToken,
  sameDesktopDistribution,
} from "./session";

const RENEWAL_THRESHOLD_SECONDS = 7 * 24 * 3_600;
const RENEWAL_MIN_INTERVAL_SECONDS = 24 * 3_600;

function isRequest<T extends { message: string }>(
  value: T,
): value is T & { message: "request" } {
  return value.message === "request";
}

async function body<T>(request: Request, contract: string): Promise<T | null> {
  try {
    const value = await readJson(request);
    return validateContract(contract as never, value).valid
      ? (value as T)
      : null;
  } catch {
    return null;
  }
}

function valid(contract: string, value: unknown): boolean {
  return validateContract(contract as never, value).valid;
}

export async function renewDesktopSession(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await body<
    DesktopSessionRenewPrepareRequest | DesktopSessionRenewConfirmRequest
  >(request, "punks://contracts/desktop-session.renew@1");
  if (command === null || !isRequest(command)) {
    return problem(400, "invalid_input", "Desktop renewal is invalid");
  }
  const rotationName = await aggregateName(
    "session-rotation",
    command.commandId,
  );
  const rotation = env.SESSION_ROTATIONS.getByName(rotationName);
  if (command.action === "prepare") {
    const current = await getActiveSession(request, env);
    if (current === null) {
      return problem(401, "unauthenticated", "No active desktop Session");
    }
    const due = await current.stub.beginRenewal({
      commandId: command.commandId,
      now: Date.now(),
      thresholdSeconds: RENEWAL_THRESHOLD_SECONDS,
      minIntervalSeconds: RENEWAL_MIN_INTERVAL_SECONDS,
    });
    if (!due.ok) {
      return problem(
        due.code === "too_recent" || due.code === "in_progress" ? 429 : 409,
        due.code === "too_recent" || due.code === "in_progress"
          ? "command_in_progress"
          : "idempotency_conflict",
        `Session rotation is ${due.code}`,
      );
    }
    const record = await rotation.create({
      commandId: command.commandId,
      oldSessionId: current.record.sessionId,
      punkId: current.record.punkId,
    });
    if (record === null) {
      return problem(409, "idempotency_conflict", "Rotation command conflicts");
    }
    const prepared = await prepareDesktopSessionForToken(
      env,
      current.punk,
      record.newSessionToken,
      record.createdAt,
    );
    if (
      (await rotation.prepared({
        rotationId: record.rotationId,
        newSessionId: prepared.value.sessionId,
      })) === null ||
      !(await env.SESSION_REVOCATIONS.getByName(
        await aggregateName("session-revocation", record.revokeCapability),
      ).create({
        sessionId: prepared.value.sessionId,
        expiresAt: prepared.value.expiresAt,
      }))
    ) {
      return problem(
        503,
        "temporarily_unavailable",
        "Session rotation is incomplete",
      );
    }
    const response: DesktopSessionRenewPreparedResponse = {
      contract: "desktop-session.renew@1",
      message: "response",
      action: "prepared",
      commandId: command.commandId,
      rotationId: record.rotationId,
      session: prepared.value,
      revokeCapability: {
        token: record.revokeCapability,
        expiresAt: prepared.value.expiresAt,
      },
      confirmBy: record.confirmBy,
    };
    return valid("punks://contracts/desktop-session.renew@1", response)
      ? json(response, 200, { "set-cookie": prepared.cookie })
      : problem(500, "internal", "Rotation response is invalid");
  }
  const token = sessionToken(request, env);
  if (token === null) {
    return problem(
      401,
      "unauthenticated",
      "Prepared Session cookie is required",
    );
  }
  const newSessionId = await aggregateName("session", token);
  const record = await rotation.confirmation({
    commandId: command.commandId,
    rotationId: command.rotationId,
    newSessionId,
  });
  if (record === null || record.newSessionId === null) {
    return problem(
      409,
      "idempotency_conflict",
      "Rotation confirmation conflicts",
    );
  }
  if (
    !(await env.SESSIONS.getByName(record.newSessionId).activatePrepared(
      record.newSessionId,
    ))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Rotated Session is unavailable",
    );
  }
  await env.SESSIONS.getByName(record.oldSessionId).revoke();
  const confirmed = await rotation.confirmed({
    commandId: command.commandId,
    rotationId: command.rotationId,
  });
  if (confirmed === null || confirmed.confirmedAt === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Rotation confirmation was not recorded",
    );
  }
  const response: DesktopSessionRenewConfirmedResponse = {
    contract: "desktop-session.renew@1",
    message: "response",
    action: "confirmed",
    commandId: command.commandId,
    rotationId: command.rotationId,
    sessionId: record.newSessionId,
    confirmedAt: confirmed.confirmedAt,
  };
  return valid("punks://contracts/desktop-session.renew@1", response)
    ? json(response)
    : problem(500, "internal", "Rotation confirmation response is invalid");
}

export async function revokeDesktopSession(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameDesktopDistribution(request, env)) {
    return problem(403, "forbidden", "Pinned desktop origin is required");
  }
  const command = await body<DesktopSessionRevokeRequest>(
    request,
    "punks://contracts/desktop-session.revoke@1",
  );
  if (command === null || !isRequest(command)) {
    return problem(400, "invalid_input", "Desktop revocation is invalid");
  }
  const result = await env.SESSION_REVOCATIONS.getByName(
    await aggregateName("session-revocation", command.capability),
  ).revoke();
  const response: DesktopSessionRevokeResponse = {
    contract: "desktop-session.revoke@1",
    message: "response",
    ...result,
  };
  return valid("punks://contracts/desktop-session.revoke@1", response)
    ? json(response)
    : problem(500, "internal", "Desktop revocation response is invalid");
}
