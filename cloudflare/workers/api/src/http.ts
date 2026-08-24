import type { AuthSession, PunksProblem } from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import type { ApiEnv } from "./env";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export function json(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(jsonHeaders);
  for (const [name, value] of new Headers(headers)) {
    responseHeaders.set(name, value);
  }
  return Response.json(value, { status, headers: responseHeaders });
}

export function problem(
  status: number,
  code: PunksProblem["code"],
  title: string,
  options: {
    correlationId?: string;
    detail?: string;
    retry?: PunksProblem["retry"];
    retryAfterMs?: number;
  } = {},
): Response {
  const body: PunksProblem = {
    type: `https://punks.bot/problems/${code.replaceAll("_", "-")}`,
    title,
    status,
    code,
    correlationId: options.correlationId ?? crypto.randomUUID(),
    retry: options.retry ?? (status >= 500 ? "later" : "never"),
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: options.retryAfterMs }),
  };
  return json(body, status, { "cache-control": "no-store" });
}

function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function isOperator(request: Request, expectedToken: string): boolean {
  if (typeof expectedToken !== "string" || expectedToken.length < 32) {
    return false;
  }
  const authorization = request.headers.get("authorization");
  if (authorization === null || !authorization.startsWith("Bearer ")) {
    return false;
  }
  return constantTimeEqual(
    authorization.slice("Bearer ".length),
    expectedToken,
  );
}

export async function authenticatedPunkSession(
  request: Request,
  env: ApiEnv,
): Promise<AuthSession | null> {
  const cookie = request.headers.get("cookie");
  if (cookie === null || cookie.length > 8_192) {
    return null;
  }
  let session: AuthSession | null;
  try {
    session = await env.AUTH_SERVICE.resolveSessionCookie(cookie);
  } catch {
    return null;
  }
  if (
    session === null ||
    !validateContract("punks://contracts/auth.session@1", session).valid
  ) {
    return null;
  }
  return session;
}

export async function authenticatedPunkId(
  request: Request,
  env: ApiEnv,
): Promise<string | null> {
  return (await authenticatedPunkSession(request, env))?.punkId ?? null;
}

export async function readJson(
  request: Request,
  maximumBytes = 64_000,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBytes) {
    throw new RangeError("Request body is too large");
  }
  if (request.body === null) {
    throw new TypeError("Request body is required");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("Request body is too large");
      throw new RangeError("Request body is too large");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
  ) as unknown;
}
