import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  FinishPasskeyCommand,
  PasskeyOptionsResponse,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import {
  clearPasskeyCookie,
  parseCookies,
  passkeyCookie,
  passkeyCookieName,
} from "./cookies";
import { bytesToBase64Url, hash, randomToken } from "./crypto";
import type { AuthEnv } from "./env";
import { json, problem, readJson } from "./http";
import type { PasskeyCeremony } from "./passkey-ceremony-do";
import {
  aggregateName,
  canonicalPunk,
  getActiveSession,
  newSession,
  sameOrigin,
} from "./session";

async function createCeremony(
  env: AuthEnv,
  purpose: PasskeyCeremony["purpose"],
  challenge: string,
  options: unknown,
  current: Awaited<ReturnType<typeof getActiveSession>>,
): Promise<Response> {
  const ceremonyId = crypto.randomUUID();
  const binding = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
  const ceremony: PasskeyCeremony = {
    purpose,
    challenge,
    browserBindingHash: await hash(binding),
    punkId: current?.record.punkId ?? null,
    sessionId: current?.record.sessionId ?? null,
    createdAt: now.toISOString(),
    expiresAt,
  };
  if (!(await env.PASSKEY_CEREMONIES.getByName(ceremonyId).create(ceremony))) {
    return problem(
      503,
      "temporarily_unavailable",
      "Passkey ceremony could not start",
    );
  }
  const response: PasskeyOptionsResponse = {
    ceremonyId,
    purpose,
    expiresAt,
    publicKey: options as Record<string, unknown>,
  };
  if (
    !validateContract("punks://contracts/auth.passkey-options@1", response)
      .valid
  ) {
    return problem(500, "internal", "Passkey options violated their contract");
  }
  return json(response, 201, {
    "set-cookie": passkeyCookie(ceremonyId, binding, 300),
  });
}

async function registrationOptions(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin passkey request is required");
  }
  const current = await getActiveSession(request, env);
  if (current === null) {
    return problem(
      401,
      "unauthenticated",
      "An active Punk session is required",
    );
  }
  if (
    current.record.recentReauthUntil === null ||
    Date.parse(current.record.recentReauthUntil) <= Date.now()
  ) {
    return problem(
      403,
      "forbidden",
      "A recent reauthentication is required before adding a passkey",
    );
  }
  const credentialIds = await env.PUNKS.getByName(
    current.record.punkId,
  ).passkeyCredentialIds();
  const options = await generateRegistrationOptions({
    rpName: env.WEBAUTHN_RP_NAME,
    rpID: env.WEBAUTHN_RP_ID,
    userID: new TextEncoder().encode(current.record.punkId),
    userName: `punk:${current.record.punkId}`,
    userDisplayName: current.punk.displayName,
    timeout: 300_000,
    attestationType: "none",
    excludeCredentials: credentialIds.map((id) => ({ id })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    supportedAlgorithmIDs: [-7, -257],
  });
  return createCeremony(
    env,
    "registration",
    options.challenge,
    options,
    current,
  );
}

async function authenticationOptions(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  if (!sameOrigin(request, env)) {
    return problem(403, "forbidden", "Same-origin passkey request is required");
  }
  const current = await getActiveSession(request, env);
  const options = await generateAuthenticationOptions({
    rpID: env.WEBAUTHN_RP_ID,
    timeout: 300_000,
    userVerification: "required",
  });
  return createCeremony(
    env,
    "authentication",
    options.challenge,
    options,
    current,
  );
}

async function beginCeremony(
  request: Request,
  env: AuthEnv,
  purpose: PasskeyCeremony["purpose"],
): Promise<
  | {
      ok: true;
      command: FinishPasskeyCommand;
      ceremony: PasskeyCeremony;
    }
  | { ok: false; response: Response }
> {
  if (!sameOrigin(request, env)) {
    return {
      ok: false,
      response: problem(
        403,
        "forbidden",
        "Same-origin passkey request is required",
      ),
    };
  }
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return {
      ok: false,
      response: problem(400, "invalid_input", "Passkey response is invalid"),
    };
  }
  if (
    !validateContract("punks://contracts/auth.passkey-finish@1", body).valid
  ) {
    return {
      ok: false,
      response: problem(
        400,
        "invalid_input",
        "Passkey response does not match its contract",
      ),
    };
  }
  const command = body as FinishPasskeyCommand;
  const binding = parseCookies(request).get(
    passkeyCookieName(command.ceremonyId),
  );
  if (binding === undefined) {
    return {
      ok: false,
      response: problem(
        400,
        "invalid_input",
        "Passkey browser binding is missing",
      ),
    };
  }
  const result = await env.PASSKEY_CEREMONIES.getByName(
    command.ceremonyId,
  ).begin(await hash(binding));
  if (!result.ok || result.ceremony.purpose !== purpose) {
    return {
      ok: false,
      response: problem(
        400,
        "invalid_input",
        "Passkey ceremony is invalid or consumed",
      ),
    };
  }
  return { ok: true, command, ceremony: result.ceremony };
}

async function finishRegistration(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const begun = await beginCeremony(request, env, "registration");
  if (!begun.ok) {
    return begun.response;
  }
  const current = await getActiveSession(request, env);
  if (
    current === null ||
    current.record.punkId !== begun.ceremony.punkId ||
    current.record.sessionId !== begun.ceremony.sessionId ||
    current.record.recentReauthUntil === null ||
    Date.parse(current.record.recentReauthUntil) <= Date.now()
  ) {
    return problem(
      403,
      "forbidden",
      "Passkey registration requires the reauthenticated Punk session",
    );
  }
  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
  try {
    verification = await verifyRegistrationResponse({
      response: begun.command.response as unknown as RegistrationResponseJSON,
      expectedChallenge: begun.ceremony.challenge,
      expectedOrigin: new URL(env.AUTH_BASE_URL).origin,
      expectedRPID: env.WEBAUTHN_RP_ID,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
  } catch {
    return problem(
      400,
      "invalid_input",
      "Passkey registration proof is invalid",
    );
  }
  if (!verification.verified || !verification.registrationInfo.userVerified) {
    return problem(
      400,
      "invalid_input",
      "Passkey registration was not verified",
    );
  }
  const { credential, credentialDeviceType, credentialBackedUp } =
    verification.registrationInfo;
  const subjectHash = await hash(`punks.passkey-subject.v1\n${credential.id}`);
  const emailHash = await hash(`punks.passkey-no-email.v1\n${credential.id}`);
  const credentialName = await aggregateName(
    "passkey-credential",
    credential.id,
  );
  const credentialObject = env.PASSKEY_CREDENTIALS.getByName(credentialName);
  const reserved = await credentialObject.reserve({
    credentialId: credential.id,
    punkId: current.record.punkId,
    subjectHash,
    publicKey: bytesToBase64Url(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? [],
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    transactionId: begun.command.ceremonyId,
    now: new Date().toISOString(),
  });
  if (!reserved.ok) {
    return problem(
      409,
      "identity_conflict",
      "Passkey is linked to another Punk",
    );
  }
  const linked = await env.PUNKS.getByName(current.record.punkId).linkPasskey({
    credentialId: credential.id,
    subjectHash,
    emailHash,
    now: new Date().toISOString(),
  });
  if (!linked.ok) {
    await credentialObject.release({
      punkId: current.record.punkId,
      transactionId: begun.command.ceremonyId,
    });
    return problem(
      503,
      "temporarily_unavailable",
      "Passkey could not be linked",
    );
  }
  if (
    !(await credentialObject.activate({
      punkId: current.record.punkId,
      transactionId: begun.command.ceremonyId,
    }))
  ) {
    return problem(
      503,
      "temporarily_unavailable",
      "Passkey activation is incomplete",
    );
  }
  return json({ verified: true, linked: true }, 200, {
    "set-cookie": clearPasskeyCookie(begun.command.ceremonyId),
  });
}

async function finishAuthentication(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const begun = await beginCeremony(request, env, "authentication");
  if (!begun.ok) {
    return begun.response;
  }
  const response = begun.command
    .response as unknown as AuthenticationResponseJSON;
  const credentialName = await aggregateName("passkey-credential", response.id);
  const verified = await env.PASSKEY_CREDENTIALS.getByName(
    credentialName,
  ).verifyAuthentication({
    ceremonyId: begun.command.ceremonyId,
    challenge: begun.ceremony.challenge,
    origin: new URL(env.AUTH_BASE_URL).origin,
    rpId: env.WEBAUTHN_RP_ID,
    response,
  });
  if (!verified.ok) {
    return problem(401, "unauthenticated", "Passkey authentication failed");
  }
  if (begun.ceremony.punkId !== null || begun.ceremony.sessionId !== null) {
    const current = await getActiveSession(request, env);
    if (
      current === null ||
      current.record.punkId !== begun.ceremony.punkId ||
      current.record.sessionId !== begun.ceremony.sessionId ||
      verified.punkId !== current.record.punkId
    ) {
      return problem(
        403,
        "forbidden",
        "Passkey reauthentication requires the originating Punk session",
      );
    }
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    if (
      !(await current.stub.markReauthenticated({
        sessionId: current.record.sessionId,
        punkId: current.record.punkId,
        until,
        authenticationMethod: "passkey",
        providerSubjectBindingHash: verified.subjectHash,
      }))
    ) {
      return problem(
        503,
        "temporarily_unavailable",
        "Passkey reauthentication could not be recorded",
      );
    }
    return json({ verified: true, session: current.record }, 200);
  }
  const punk = await env.PUNKS.getByName(verified.punkId).query();
  if (!punk.ok) {
    return problem(401, "unauthenticated", "Passkey Punk is unavailable");
  }
  const session = await newSession(env, canonicalPunk(punk.state));
  return json({ verified: true, session: session.value }, 200, {
    "set-cookie": session.cookie,
  });
}

export function routePasskeys(
  request: Request,
  env: AuthEnv,
  path: string,
): Promise<Response> | null {
  if (
    request.method === "POST" &&
    path === "/api/auth/v1/passkeys/register/options"
  ) {
    return registrationOptions(request, env);
  }
  if (
    request.method === "POST" &&
    path === "/api/auth/v1/passkeys/register/finish"
  ) {
    return finishRegistration(request, env);
  }
  if (
    request.method === "POST" &&
    path === "/api/auth/v1/passkeys/authenticate/options"
  ) {
    return authenticationOptions(request, env);
  }
  if (
    request.method === "POST" &&
    path === "/api/auth/v1/passkeys/authenticate/finish"
  ) {
    return finishAuthentication(request, env);
  }
  return null;
}
