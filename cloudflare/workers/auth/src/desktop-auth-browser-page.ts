import type { DesktopAuthStatusResponse } from "@punks/contracts";

import type { DesktopAuthFlowRecord } from "./desktop-auth-flow-do";

function browserHtml(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "permissions-policy":
        "publickey-credentials-get=(), publickey-credentials-create=()",
    },
  });
}

/** Explains a terminal browser ceremony without exposing its account data. */
export function expiredDesktopAuthPage(): Response {
  return browserHtml(
    `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connexion expirée</title>
<main><h1>Connexion expirée</h1>
<p>Cette demande de connexion n’est plus utilisable.</p>
<p>Revenez dans Punks Bot et relancez la connexion.</p></main>`,
    410,
  );
}

/** Renders an explicit account choice only within its authoritative deadline. */
export function confirmationPage(
  flowId: string,
  state: string,
  capability: string,
  displayName: string,
  expiresAt: string,
): Response {
  const lifetimeMs = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(lifetimeMs) || lifetimeMs <= 0) {
    return expiredDesktopAuthPage();
  }
  const escapedName = displayName
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return browserHtml(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmer le Compte Punks</title>
<main><section id="confirmation-choice"><h1>Créer mon Compte Punks</h1><p>Continuer comme ${escapedName}</p>
<p>Confirmez dans les <span id="remaining-seconds">${Math.ceil(lifetimeMs / 1_000)}</span> prochaines secondes. Passé ce délai, relancez la connexion depuis Punks Bot.</p>
<form id="account-confirmation" method="post" action="/api/auth/v1/desktop/browser">
<input type="hidden" name="flow" value="${flowId}">
<input type="hidden" name="state" value="${state}">
<input type="hidden" name="capability" value="${capability}">
<button type="submit">Créer mon Compte Punks</button></form></section>
<section id="confirmation-expired" hidden role="status"><h1>Connexion expirée</h1>
<p>Cette demande de connexion n’est plus utilisable.</p>
<p>Revenez dans Punks Bot et relancez la connexion.</p></section></main>
<script type="module">
const lifetimeMs=${Math.floor(lifetimeMs)};
// Count navigation time conservatively: a delayed page cannot restart its lifetime.
const navigationStartedAt=Date.now()-performance.now();
const form=document.getElementById("account-confirmation");
const choice=document.getElementById("confirmation-choice");
const expired=document.getElementById("confirmation-expired");
const remaining=document.getElementById("remaining-seconds");
const button=form.querySelector("button");
function update(){
  const elapsed=Math.max(Date.now()-navigationStartedAt,performance.now());
  const seconds=Math.max(0,Math.ceil((lifetimeMs-elapsed)/1000));
  remaining.textContent=String(seconds);
  if(seconds>0)return true;
  button.disabled=true;choice.hidden=true;expired.hidden=false;
  clearInterval(timer);return false;
}
const timer=setInterval(update,1000);
form.addEventListener("submit",event=>{if(!update())event.preventDefault();});
document.addEventListener("visibilitychange",update);
window.addEventListener("pageshow",update);
update();
</script>`);
}

export function existingBrowserSessionPage(input: {
  flowId: string;
  displayName: string;
  method: "google" | "github";
}): Response {
  const escapedName = input.displayName
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const methodLabel = input.method === "github" ? "GitHub" : "Google";
  return browserHtml(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Continuer dans Punks Bot</title><main><h1>Continuer comme ${escapedName} ?</h1>
<form method="post" action="/api/auth/v1/desktop/browser/session/confirm"><input type="hidden" name="flow" value="${input.flowId}"><button type="submit">Continuer comme ${escapedName}</button></form>
<form method="get" action="/api/auth/v1/desktop/browser"><input type="hidden" name="flow" value="${input.flowId}"><input type="hidden" name="useMethod" value="1"><button type="submit">Utiliser ${methodLabel} à la place</button></form></main>`);
}

export function desktopAuthDecision(
  flow: DesktopAuthFlowRecord,
): DesktopAuthStatusResponse["decision"] {
  const terminal = ["confirmed", "cancelled", "expired"].includes(flow.phase);
  return {
    oldSessionUsable:
      flow.currentSessionId !== null && flow.phase !== "confirmed",
    revokePreparedSession:
      (flow.phase === "cancelled" || flow.phase === "expired") &&
      flow.sessionId !== null,
    destroyWorkspaceContext:
      flow.phase === "confirmed" &&
      flow.currentSessionId !== null &&
      flow.intent !== "reauthenticate",
    retrySameRequest:
      !terminal && ["started", "ready", "delivering"].includes(flow.phase),
    freshHumanActionRequired:
      flow.phase === "browser_complete" ||
      flow.phase === "cancelled" ||
      flow.phase === "expired",
  };
}
