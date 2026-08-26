import type { ApiEnv } from "./env";
import { isOperator, json, problem, readJson } from "./http";

const SHA1 = /^[0-9a-f]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COOKIE = /^__Host-punks_session=[^;\s]{32,256}$/;
const CAPABILITY = /^[A-Za-z0-9_-]{43,128}$/;

function exactKeys(value: object, expected: string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function validSession(value: unknown): boolean {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value, [
      "source_sha",
      "cookie",
      "metadata",
      "revoke_capability",
      "revoke_expires_at_seconds",
    ])
  ) {
    return false;
  }
  const bundle = value as Record<string, unknown>;
  const metadata = bundle.metadata;
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !exactKeys(metadata, [
      "session_id",
      "punk_id",
      "expires_at_seconds",
      "last_renewed_at_seconds",
    ])
  ) {
    return false;
  }
  const session = metadata as Record<string, unknown>;
  return (
    typeof bundle.source_sha === "string" &&
    SHA1.test(bundle.source_sha) &&
    typeof bundle.cookie === "string" &&
    COOKIE.test(bundle.cookie) &&
    typeof session.session_id === "string" &&
    UUID.test(session.session_id) &&
    typeof session.punk_id === "string" &&
    UUID.test(session.punk_id) &&
    Number.isSafeInteger(session.expires_at_seconds) &&
    (session.expires_at_seconds as number) >
      Math.floor(Date.now() / 1_000) + 300 &&
    session.last_renewed_at_seconds === null &&
    typeof bundle.revoke_capability === "string" &&
    CAPABILITY.test(bundle.revoke_capability) &&
    bundle.revoke_expires_at_seconds === session.expires_at_seconds
  );
}

export async function routePromotionSession(
  request: Request,
  env: ApiEnv,
  path: string,
): Promise<Response | null> {
  if (path !== "/api/internal/v1/promotion/session") return null;
  if (env.PROMOTION_SESSION_ISSUANCE_ENABLED !== "true") {
    return problem(404, "not_found", "Resource not found");
  }
  if (!isOperator(request, env.OPERATOR_PROVISIONING_TOKEN)) {
    return problem(403, "forbidden", "Operator Session issuance is forbidden");
  }
  if (request.method !== "POST") {
    return problem(405, "invalid_input", "POST is required");
  }
  let value: unknown;
  try {
    value = await readJson(request, 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Promotion Session request is invalid",
    );
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value, ["contract", "sourceSha"]) ||
    Reflect.get(value, "contract") !== "promotion.session-issue@1" ||
    typeof Reflect.get(value, "sourceSha") !== "string" ||
    !SHA1.test(Reflect.get(value, "sourceSha"))
  ) {
    return problem(
      400,
      "invalid_input",
      "Promotion Session request is invalid",
    );
  }
  const sourceSha = Reflect.get(value, "sourceSha") as string;
  let session: Awaited<
    ReturnType<ApiEnv["AUTH_SERVICE"]["issuePromotionSession"]>
  >;
  try {
    session = await env.AUTH_SERVICE.issuePromotionSession({ sourceSha });
  } catch {
    return problem(
      503,
      "temporarily_unavailable",
      "Promotion Session authority is unavailable",
    );
  }
  if (!validSession(session)) {
    return problem(
      503,
      "temporarily_unavailable",
      "Promotion Session authority returned an invalid bundle",
    );
  }
  if (session?.source_sha !== sourceSha) {
    return problem(
      503,
      "temporarily_unavailable",
      "Promotion Session belongs to another source",
    );
  }
  return json({ sourceSha, session }, 201, { "cache-control": "no-store" });
}
