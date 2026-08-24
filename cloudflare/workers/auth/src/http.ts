import type { PunksProblem } from "@punks/contracts";

const baseHeaders = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

export function json(
  value: unknown,
  status = 200,
  headers?: HeadersInit,
): Response {
  const responseHeaders = new Headers(baseHeaders);
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  for (const [name, value] of new Headers(headers)) {
    responseHeaders.append(name, value);
  }
  return Response.json(value, { status, headers: responseHeaders });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers(baseHeaders);
  headers.set("location", location);
  for (const cookie of cookies) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { status: 303, headers });
}

export function problem(
  status: number,
  code: PunksProblem["code"],
  title: string,
  detail?: string,
): Response {
  const body: PunksProblem = {
    type: `https://punks.bot/problems/${code.replaceAll("_", "-")}`,
    title,
    status,
    code,
    correlationId: crypto.randomUUID(),
    retry: status >= 500 ? "later" : "never",
    ...(detail === undefined ? {} : { detail }),
  };
  return json(body, status);
}

export async function readJson(request: Request): Promise<unknown> {
  const maximumBytes = 16_384;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > maximumBytes || request.body === null) {
    throw new RangeError("Invalid request body");
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
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
