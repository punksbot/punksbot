import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export async function smokeApi(
  baseUrl,
  environment,
  fetchImplementation = fetch,
) {
  const url = new URL("/api/health", baseUrl).toString();
  const response = await fetchImplementation(url, {
    headers: { accept: "application/json" },
  });
  const payload = await response.json().catch(() => null);
  const exact =
    response.ok &&
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Object.keys(payload).sort().join(",") === "environment,service,status" &&
    payload.service === "punks-api" &&
    payload.environment === environment &&
    payload.status === "ok";
  if (!exact) {
    throw new Error(`unexpected local health response (${response.status})`);
  }
  return payload;
}

export async function smokeLocal(baseUrl, fetchImplementation = fetch) {
  return smokeApi(baseUrl, "local", fetchImplementation);
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === modulePath) {
  const baseUrl = process.argv[2] ?? "http://127.0.0.1:8787";
  const result = await smokeLocal(baseUrl);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
