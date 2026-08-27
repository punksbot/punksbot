import type { DesktopAuthStatusResponse } from "@punks/contracts";

import type { DesktopAuthFlowRecord } from "./desktop-auth-flow-do";

function browserHtml(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy":
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "permissions-policy":
        "publickey-credentials-get=(self), publickey-credentials-create=(self)",
    },
  });
}

export function confirmationPage(
  flowId: string,
  state: string,
  capability: string,
  displayName: string,
): Response {
  const escapedName = displayName
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return browserHtml(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmer le Compte Punks</title>
<main><h1>Créer mon Compte Punks</h1><p>Continuer comme ${escapedName}</p>
<form method="post" action="/api/auth/v1/desktop/browser/confirm">
<input type="hidden" name="flow" value="${flowId}">
<input type="hidden" name="state" value="${state}">
<input type="hidden" name="capability" value="${capability}">
<button type="submit">Créer mon Compte Punks</button></form></main>`);
}

export function existingBrowserSessionPage(input: {
  flowId: string;
  displayName: string;
  method: "google" | "github" | "passkey";
}): Response {
  const escapedName = input.displayName
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const methodLabel =
    input.method === "github"
      ? "GitHub"
      : input.method === "google"
        ? "Google"
        : "une passkey";
  return browserHtml(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Continuer dans Punks Bot</title><main><h1>Continuer comme ${escapedName} ?</h1>
<form method="post" action="/api/auth/v1/desktop/browser/session/confirm"><input type="hidden" name="flow" value="${input.flowId}"><button type="submit">Continuer comme ${escapedName}</button></form>
<form method="get" action="/api/auth/v1/desktop/browser"><input type="hidden" name="flow" value="${input.flowId}"><input type="hidden" name="useMethod" value="1"><button type="submit">Utiliser ${methodLabel} à la place</button></form></main>`);
}

export function passkeyPage(input: {
  flowId: string;
  purpose: "authentication" | "registration";
  publicKey: Record<string, unknown>;
}): Response {
  const payload = JSON.stringify(input).replaceAll("<", "\\u003c");
  return browserHtml(`<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Passkey Punks</title><main><h1>Passkey Punks</h1><p id="status">Vérification en cours…</p></main>
<script type="module">
const input=${payload};
const bytes=(value)=>Uint8Array.from(atob(value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=")),c=>c.charCodeAt(0));
const b64=(value)=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/g,"");
const publicKey={...input.publicKey,challenge:bytes(input.publicKey.challenge)};
if(publicKey.user)publicKey.user={...publicKey.user,id:bytes(publicKey.user.id)};
if(publicKey.excludeCredentials)publicKey.excludeCredentials=publicKey.excludeCredentials.map(x=>({...x,id:bytes(x.id)}));
const credential=await navigator.credentials[input.purpose==="registration"?"create":"get"]({publicKey});
const response={id:credential.id,rawId:b64(credential.rawId),type:credential.type,clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:b64(credential.response.clientDataJSON),...(input.purpose==="registration"?{attestationObject:b64(credential.response.attestationObject),transports:credential.response.getTransports?.()??[]}:{authenticatorData:b64(credential.response.authenticatorData),signature:b64(credential.response.signature),userHandle:credential.response.userHandle?b64(credential.response.userHandle):null})}};
const result=await fetch("/api/auth/v1/desktop/browser/passkey/complete",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({flowId:input.flowId,response})});
const body=await result.json(); if(!result.ok)throw new Error("Passkey refused"); location.href=body.completionUrl;
</script>`);
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
