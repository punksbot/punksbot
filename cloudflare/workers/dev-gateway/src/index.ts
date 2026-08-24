const UUID_V8 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REQUEST_BYTES = 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type WakeRequest = {
  installationId: string;
  conversationId: string;
  messageId: string;
};

type WakeResult =
  | { ok: true; wakeId: string }
  | {
      ok: false;
      code:
        | "invalid_request"
        | "not_found"
        | "authority_revoked"
        | "conflict"
        | "temporarily_unavailable"
        | "internal";
    };

type DevGatewayEnv = CloudflareBindings & {
  API: Fetcher;
  AUTH: Fetcher;
  AUTH_DEV_BOOTSTRAP: {
    bootstrap(): Promise<unknown>;
  };
  API_DEV_BOOTSTRAP: {
    bootstrap(input: {
      punkId: string;
      sessionCookie: string;
    }): Promise<unknown>;
  };
  BOT_WAKE_TRIGGER: {
    offerWake(input: WakeRequest): Promise<WakeResult>;
  };
  PUNKS_UI_ORIGIN: string;
};

function json(
  payload: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

function problem(
  status: number,
  code: "invalid_input" | "forbidden" | "temporarily_unavailable" | "internal",
  title: string,
  options: { retry: "never" | "later"; retryAfterMs?: number },
) {
  return json(
    {
      type: `https://punks.bot/problems/${code.replaceAll("_", "-")}`,
      title,
      status,
      code,
      correlationId: crypto.randomUUID(),
      retry: options.retry,
      ...(options.retryAfterMs === undefined
        ? {}
        : { retryAfterMs: options.retryAfterMs }),
    },
    status,
  );
}

type LocalSession = {
  sessionId: string;
  punkId: string;
  authenticatedAt: string;
  expiresAt: string;
  recentReauthUntil: string | null;
  punk: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
  };
};

type AuthBootstrapResult = {
  ok: true;
  session: LocalSession;
  cookie: string;
};

type BootstrapFailure = {
  ok: false;
  code: "invalid_request" | "temporarily_unavailable" | "internal";
};

type ApiBootstrapResult = {
  ok: true;
  coordinates: {
    workspaceSlug: string;
    workspaceId: string;
    conversationId: string;
  };
};

function exactKeys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function exactLocalSession(value: unknown): value is LocalSession {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const session = value as Record<string, unknown>;
  const punk = session.punk;
  if (
    !exactKeys(session, [
      "sessionId",
      "punkId",
      "authenticatedAt",
      "expiresAt",
      "recentReauthUntil",
      "punk",
    ]) ||
    typeof punk !== "object" ||
    punk === null ||
    Array.isArray(punk)
  ) {
    return false;
  }
  const punkRecord = punk as Record<string, unknown>;
  return (
    exactKeys(punkRecord, ["id", "displayName", "avatarUrl"]) &&
    typeof session.sessionId === "string" &&
    UUID.test(session.sessionId) &&
    typeof session.punkId === "string" &&
    UUID.test(session.punkId) &&
    validTimestamp(session.authenticatedAt) &&
    validTimestamp(session.expiresAt) &&
    (session.recentReauthUntil === null ||
      validTimestamp(session.recentReauthUntil)) &&
    punkRecord.id === session.punkId &&
    typeof punkRecord.displayName === "string" &&
    (punkRecord.avatarUrl === null || typeof punkRecord.avatarUrl === "string")
  );
}

function exactAuthBootstrapResult(
  value: unknown,
): value is AuthBootstrapResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    exactKeys(result, ["ok", "session", "cookie"]) &&
    result.ok === true &&
    exactLocalSession(result.session) &&
    typeof result.cookie === "string" &&
    /^punks_session_dev=[^;\r\n]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax$/.test(
      result.cookie,
    )
  );
}

function exactBootstrapFailure(value: unknown): value is BootstrapFailure {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    exactKeys(result, ["ok", "code"]) &&
    result.ok === false &&
    typeof result.code === "string" &&
    ["invalid_request", "temporarily_unavailable", "internal"].includes(
      result.code,
    )
  );
}

function bootstrapAuthorityFailure(value: BootstrapFailure) {
  if (value.code === "temporarily_unavailable") {
    return problem(
      503,
      "temporarily_unavailable",
      "Local bootstrap authority is temporarily unavailable",
      { retry: "later", retryAfterMs: 1_000 },
    );
  }
  return problem(
    500,
    "internal",
    "Local bootstrap authority returned an invalid result",
    { retry: "later" },
  );
}

function unavailableBootstrapAuthority() {
  return problem(
    503,
    "temporarily_unavailable",
    "Local bootstrap authority is temporarily unavailable",
    { retry: "later", retryAfterMs: 1_000 },
  );
}

function exactApiBootstrapResult(value: unknown): value is ApiBootstrapResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  const coordinates = result.coordinates;
  if (
    !exactKeys(result, ["ok", "coordinates"]) ||
    result.ok !== true ||
    coordinates === null ||
    typeof coordinates !== "object" ||
    Array.isArray(coordinates)
  ) {
    return false;
  }
  const record = coordinates as Record<string, unknown>;
  return (
    exactKeys(record, ["workspaceSlug", "workspaceId", "conversationId"]) &&
    typeof record.workspaceSlug === "string" &&
    /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])$/.test(record.workspaceSlug) &&
    typeof record.workspaceId === "string" &&
    UUID.test(record.workspaceId) &&
    typeof record.conversationId === "string" &&
    UUID.test(record.conversationId)
  );
}

async function bootstrapLocal(request: Request, env: DevGatewayEnv) {
  if (request.method !== "POST") {
    return problem(405, "invalid_input", "Local bootstrap requires POST", {
      retry: "never",
    });
  }
  if (request.headers.get("origin") !== env.PUNKS_UI_ORIGIN) {
    return problem(
      403,
      "forbidden",
      "The configured Punks UI origin is required",
      { retry: "never" },
    );
  }
  let auth: unknown;
  try {
    auth = await env.AUTH_DEV_BOOTSTRAP.bootstrap();
  } catch {
    return unavailableBootstrapAuthority();
  }
  if (exactBootstrapFailure(auth)) {
    return bootstrapAuthorityFailure(auth);
  }
  if (!exactAuthBootstrapResult(auth)) {
    return problem(
      500,
      "internal",
      "Local bootstrap authority returned an invalid result",
      { retry: "later" },
    );
  }
  let api: unknown;
  try {
    api = await env.API_DEV_BOOTSTRAP.bootstrap({
      punkId: auth.session.punkId,
      sessionCookie: auth.cookie,
    });
  } catch {
    return unavailableBootstrapAuthority();
  }
  if (exactBootstrapFailure(api)) {
    return bootstrapAuthorityFailure(api);
  }
  if (!exactApiBootstrapResult(api)) {
    return problem(
      500,
      "internal",
      "Local bootstrap authority returned an invalid result",
      { retry: "later" },
    );
  }
  return json({ session: auth.session, coordinates: api.coordinates }, 200, {
    "set-cookie": auth.cookie,
  });
}

function diagnosticPage() {
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const contentSecurityPolicy = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
  ].join("; ");
  const body = `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Punks Bot local — diagnostic</title>
    <style nonce="${nonce}">
      :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
      body { max-width: 48rem; margin: 0 auto; padding: 2rem 1rem 4rem; background: #101014; color: #f4f4f5; }
      h1 { margin-bottom: .25rem; }
      section { margin-top: 1.5rem; padding: 1rem; border: 1px solid #3f3f46; border-radius: .75rem; background: #18181b; }
      .notice { color: #fbbf24; }
      a { color: #93c5fd; }
      label { display: block; margin-top: .75rem; font-weight: 600; }
      input { box-sizing: border-box; width: 100%; margin-top: .25rem; padding: .6rem; border: 1px solid #52525b; border-radius: .4rem; background: #09090b; color: inherit; }
      button { margin-top: 1rem; padding: .6rem .9rem; border: 0; border-radius: .4rem; background: #2563eb; color: white; font-weight: 700; cursor: pointer; }
      pre { overflow: auto; min-height: 3rem; padding: .75rem; border-radius: .4rem; background: #09090b; white-space: pre-wrap; }
      [data-state="ok"] { color: #86efac; }
      [data-state="error"] { color: #fca5a5; }
    </style>
  </head>
  <body>
    <main>
      <h1>Punks Bot local</h1>
      <p class="notice"><strong>Cette page de diagnostic locale n’est pas la Punks UI produit.</strong></p>
      <p>Ce gateway expose le backend Cloudflare local pour les vérifications techniques.</p>

      <section aria-labelledby="health-title">
        <h2 id="health-title">État backend / API</h2>
        <p><a href="/api/health">Ouvrir la réponse brute de /api/health</a></p>
        <pre id="health-result" role="status">Vérification en cours…</pre>
      </section>

      <section aria-labelledby="wake-title">
        <h2 id="wake-title">Tester un Réveil de Bot</h2>
        <p>Cette couture de développement exige des UUIDv8 correspondant à des ressources locales existantes.</p>
        <form id="wake-form" action="/__dev/bot-wakes" method="post">
          <label for="installation-id">Installation de Bot</label>
          <input id="installation-id" name="installationId" required autocomplete="off" placeholder="xxxxxxxx-xxxx-8xxx-8xxx-xxxxxxxxxxxx">
          <label for="conversation-id">Conversation</label>
          <input id="conversation-id" name="conversationId" required autocomplete="off" placeholder="xxxxxxxx-xxxx-8xxx-8xxx-xxxxxxxxxxxx">
          <label for="message-id">Message</label>
          <input id="message-id" name="messageId" required autocomplete="off" placeholder="xxxxxxxx-xxxx-8xxx-8xxx-xxxxxxxxxxxx">
          <button type="submit">Proposer le Réveil</button>
        </form>
        <pre id="wake-result" role="status">Aucune requête envoyée.</pre>
      </section>
    </main>
    <script nonce="${nonce}">
      const showResponse = async (target, response) => {
        const text = await response.text();
        let value = text;
        try { value = JSON.stringify(JSON.parse(text), null, 2); } catch {}
        target.dataset.state = response.ok ? "ok" : "error";
        target.textContent = "HTTP " + response.status + "\\n" + value;
      };

      const healthResult = document.querySelector("#health-result");
      fetch("/api/health", { headers: { accept: "application/json" }, cache: "no-store" })
        .then((response) => showResponse(healthResult, response))
        .catch((error) => {
          healthResult.dataset.state = "error";
          healthResult.textContent = "API inaccessible : " + String(error);
        });

      const wakeForm = document.querySelector("#wake-form");
      const wakeResult = document.querySelector("#wake-result");
      wakeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        wakeResult.dataset.state = "";
        wakeResult.textContent = "Envoi en cours…";
        const values = new FormData(wakeForm);
        const body = {
          installationId: values.get("installationId"),
          conversationId: values.get("conversationId"),
          messageId: values.get("messageId"),
        };
        try {
          const response = await fetch(wakeForm.action, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify(body),
          });
          await showResponse(wakeResult, response);
        } catch (error) {
          wakeResult.dataset.state = "error";
          wakeResult.textContent = "Requête impossible : " + String(error);
        }
      });
    </script>
  </body>
</html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": contentSecurityPolicy,
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    },
  });
}

function exactWakeRequest(value: unknown): value is WakeRequest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort().join(",") !==
    "conversationId,installationId,messageId"
  ) {
    return false;
  }
  return (
    typeof record.installationId === "string" &&
    UUID_V8.test(record.installationId) &&
    typeof record.conversationId === "string" &&
    UUID_V8.test(record.conversationId) &&
    typeof record.messageId === "string" &&
    UUID_V8.test(record.messageId)
  );
}

function exactWakeResult(value: unknown): value is WakeResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true) {
    return (
      Object.keys(record).sort().join(",") === "ok,wakeId" &&
      typeof record.wakeId === "string" &&
      UUID_V8.test(record.wakeId)
    );
  }
  return (
    record.ok === false &&
    Object.keys(record).sort().join(",") === "code,ok" &&
    typeof record.code === "string" &&
    [
      "invalid_request",
      "not_found",
      "authority_revoked",
      "conflict",
      "temporarily_unavailable",
      "internal",
    ].includes(record.code)
  );
}

function failureStatus(code: Exclude<WakeResult, { ok: true }>["code"]) {
  switch (code) {
    case "invalid_request":
      return 400;
    case "not_found":
      return 404;
    case "authority_revoked":
      return 403;
    case "conflict":
      return 409;
    case "temporarily_unavailable":
      return 503;
    case "internal":
      return 500;
  }
}

async function offerWake(request: Request, env: DevGatewayEnv) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json") ||
    !Number.isFinite(contentLength) ||
    contentLength > MAX_REQUEST_BYTES
  ) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  if (!exactWakeRequest(input)) {
    return json({ ok: false, code: "invalid_request" }, 400);
  }
  const result = await env.BOT_WAKE_TRIGGER.offerWake(input);
  if (!exactWakeResult(result)) {
    return json({ ok: false, code: "internal" }, 500);
  }
  return result.ok
    ? json(result, 202)
    : json(result, failureStatus(result.code));
}

export default {
  async fetch(request: Request, env: DevGatewayEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return diagnosticPage();
    }
    if (url.pathname === "/__dev/bot-wakes") {
      if (request.method !== "POST") {
        return json({ ok: false, code: "method_not_allowed" }, 405);
      }
      return offerWake(request, env);
    }
    if (url.pathname === "/__dev/bootstrap") {
      return bootstrapLocal(request, env);
    }
    if (url.pathname.startsWith("/__dev/")) {
      return json({ ok: false, code: "not_found" }, 404);
    }
    if (url.pathname === "/api/auth" || url.pathname.startsWith("/api/auth/")) {
      return env.AUTH.fetch(request);
    }
    return env.API.fetch(request);
  },
} satisfies ExportedHandler<DevGatewayEnv>;
