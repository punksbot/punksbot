import type {
  AbandonMediaUploadCommand,
  FinalizeMediaUploadCommand,
  MediaUploadPart,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { expectedMediaUploadPartSize } from "@punks/core";

import type { ApiEnv } from "./env";
import { authenticatedPunkSession, json, problem, readJson } from "./http";
import { createMediaUploadGrant } from "./media-upload-http-grant";
import {
  callMediaUploadAuthority,
  currentMediaUploadSessionMatches as currentSessionMatches,
  mediaUploadFinalAuthorizationStatus as finalAuthorizationStatus,
  mediaUploadStatusResponse as statusResponse,
  mediaUploadWorkspaceAccess as workspaceAccess,
  mediaUploadWorkspaceAccessProblem as workspaceAccessProblem,
} from "./media-upload-http-shared";
import {
  candidateObjectMatches,
  hashMediaUploadStream,
  hexBytes,
  stagingObjectMatches,
} from "./media-upload-integrity";
import {
  mediaUploadGrantToken,
  verifyMediaUploadGrantToken,
} from "./media-upload-security";
import type { MediaUploadInternalSnapshot } from "./media-upload-state";

async function getStatus(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  uploadId: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  const inspectCall = await callMediaUploadAuthority(async () =>
    env.MEDIA_UPLOADS.getByName(uploadId).inspect(),
  );
  if (!inspectCall.reached) {
    return problem(
      503,
      "storage_unavailable",
      "Media upload authority is unavailable",
      { retry: "later" },
    );
  }
  const snapshot = inspectCall.value;
  if (
    snapshot === null ||
    snapshot.uploadId !== uploadId ||
    snapshot.workspaceId !== workspaceId
  ) {
    return problem(404, "not_found", "Media upload not found");
  }
  if (snapshot.punkId !== session.punkId) {
    return problem(403, "forbidden", "Media upload belongs to another Punk");
  }
  const access = await workspaceAccess(env, workspaceId, session.punkId);
  if (access !== "ok") return workspaceAccessProblem(access);
  return statusResponse(snapshot);
}

async function finalizeUpload(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  uploadId: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 4 * 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Media upload finalize command is invalid",
    );
  }
  if (
    !validateContract("punks://contracts/media-upload.finalize@1", body).valid
  ) {
    return problem(
      400,
      "invalid_input",
      "Media upload finalize command is invalid",
    );
  }
  const command = body as FinalizeMediaUploadCommand;
  if (command.workspaceId !== workspaceId || command.uploadId !== uploadId) {
    return problem(404, "not_found", "Media upload not found");
  }
  if (command.actor.punkId !== session.punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  if (request.headers.get("idempotency-key") !== command.commandId) {
    return problem(
      409,
      "idempotency_conflict",
      "Idempotency-Key must equal the finalize commandId",
    );
  }

  const authority = env.MEDIA_UPLOADS.getByName(uploadId);
  const inspectCall = await callMediaUploadAuthority(async () =>
    authority.inspect(),
  );
  if (!inspectCall.reached) {
    return problem(
      503,
      "storage_unavailable",
      "Media upload authority is unavailable",
      { retry: "later" },
    );
  }
  const initial = inspectCall.value;
  if (
    initial === null ||
    initial.workspaceId !== workspaceId ||
    initial.uploadId !== uploadId
  ) {
    return problem(404, "not_found", "Media upload not found");
  }
  if (initial.punkId !== session.punkId) {
    return problem(403, "forbidden", "Media upload belongs to another Punk");
  }
  const token = mediaUploadGrantToken(request);
  if (
    token === null ||
    !(await verifyMediaUploadGrantToken(
      env.MEDIA_UPLOAD_GRANT_KEY,
      initial,
      token,
    ))
  ) {
    return problem(
      403,
      "forbidden",
      "Media upload grant is invalid or expired",
    );
  }
  const access = await workspaceAccess(env, workspaceId, session.punkId);
  if (access !== "ok") return workspaceAccessProblem(access);

  const beginCall = await callMediaUploadAuthority(async () =>
    authority.beginFinalize({
      workspaceId,
      punkId: session.punkId,
      commandId: command.commandId,
    }),
  );
  if (!beginCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload finalization authority result is ambiguous",
      { retry: "same_command" },
    );
  }
  const begin = beginCall.value;
  if (!begin.ok) {
    switch (begin.code) {
      case "idempotency_conflict":
        return problem(
          409,
          "idempotency_conflict",
          "Finalize command conflicts with the active upload intention",
        );
      case "in_progress":
        return problem(
          409,
          "command_in_progress",
          "Media upload finalization is in progress",
          { retry: "later", retryAfterMs: 1_000 },
        );
      case "expired":
        return problem(410, "upload_expired", "Media upload grant expired");
      case "parts_missing":
        return problem(
          409,
          "upload_conflict",
          "Media upload is missing one or more granted parts",
          { retry: "same_command" },
        );
      case "rejected":
        if (begin.snapshot.failureCode === "authorization_lost") {
          return problem(
            403,
            "forbidden",
            "Media upload authorization was revoked",
          );
        }
        return problem(
          422,
          begin.snapshot.failureCode === "hash_invalid"
            ? "upload_hash_invalid"
            : "upload_conflict",
          "Media upload was rejected",
        );
      case "not_uploading":
        return problem(
          409,
          "upload_conflict",
          "Media upload is not finalizable",
        );
      case "invalid_request":
        return problem(
          500,
          "internal",
          "Media upload authority rejected its route",
        );
    }
  }
  if (begin.action === "replay") {
    const replayAuthorization = await finalAuthorizationStatus(
      env,
      session,
      begin.snapshot,
      token,
    );
    if (replayAuthorization === "unavailable") {
      return problem(
        503,
        "temporarily_unavailable",
        "Media upload authorization is temporarily unavailable",
        { retry: "later" },
      );
    }
    if (replayAuthorization === "denied") {
      return problem(
        403,
        "forbidden",
        "Media upload authorization was revoked",
      );
    }
    return statusResponse(begin.snapshot, 200);
  }

  const releaseFinalize = async (
    failureCode: "ambiguous" | "storage_unavailable" | "authorization_lost",
  ): Promise<"committed" | "superseded" | "unavailable"> => {
    const released = await callMediaUploadAuthority(async () =>
      authority.releaseFinalize({
        attemptId: begin.attemptId,
        failureCode,
      }),
    );
    if (!released.reached) return "unavailable";
    return released.value.ok ? "committed" : "superseded";
  };
  const ambiguous = async (title: string): Promise<Response> => {
    await releaseFinalize("ambiguous");
    return problem(503, "upload_ambiguous", title, { retry: "same_command" });
  };
  const storageUnavailable = async (title: string): Promise<Response> => {
    if ((await releaseFinalize("storage_unavailable")) !== "committed") {
      return problem(503, "upload_ambiguous", title, {
        retry: "same_command",
      });
    }
    return problem(503, "storage_unavailable", title, { retry: "later" });
  };
  const finalAuthorizationProblem = async (): Promise<Response | null> => {
    const status = await finalAuthorizationStatus(
      env,
      session,
      begin.snapshot,
      token,
    );
    if (status === "ok") return null;
    const released = await releaseFinalize(
      status === "unavailable" ? "ambiguous" : "authorization_lost",
    );
    if (released !== "committed") {
      return problem(
        503,
        "upload_ambiguous",
        "Media upload authorization result is ambiguous",
        { retry: "same_command" },
      );
    }
    return status === "unavailable"
      ? problem(
          503,
          "temporarily_unavailable",
          "Media upload authorization is temporarily unavailable",
          { retry: "later" },
        )
      : problem(403, "forbidden", "Media upload authorization was revoked");
  };

  let candidate: R2Object | null;
  try {
    candidate = await env.CONTENT_BUCKET.head(begin.snapshot.candidateKey);
  } catch {
    return storageUnavailable("R2 candidate lookup is unavailable");
  }
  if (
    candidate !== null &&
    !candidateObjectMatches(candidate, begin.snapshot)
  ) {
    const rejectCall = await callMediaUploadAuthority(async () =>
      authority.rejectFinalize({
        attemptId: begin.attemptId,
        code: "conflict",
      }),
    );
    if (!rejectCall.reached || !rejectCall.value.ok) {
      return ambiguous("Media candidate conflict result is ambiguous");
    }
    return problem(409, "upload_conflict", "Media candidate key is occupied");
  }

  if (candidate === null) {
    let staging: R2ObjectBody | null;
    try {
      staging = await env.CONTENT_BUCKET.get(begin.snapshot.stagingKey);
    } catch {
      return storageUnavailable("R2 staging lookup is unavailable");
    }
    if (staging === null) {
      try {
        await env.CONTENT_BUCKET.resumeMultipartUpload(
          begin.snapshot.stagingKey,
          begin.snapshot.r2UploadId ?? "",
        ).complete(begin.parts);
      } catch {
        // Completion can succeed remotely while its response is lost. Re-read below.
      }
      try {
        staging = await env.CONTENT_BUCKET.get(begin.snapshot.stagingKey);
      } catch {
        return storageUnavailable("R2 staging recovery is unavailable");
      }
      if (staging === null) {
        return ambiguous("Media upload completion result is ambiguous");
      }
    }
    if (!stagingObjectMatches(staging, begin.snapshot)) {
      const rejectCall = await callMediaUploadAuthority(async () =>
        authority.rejectFinalize({
          attemptId: begin.attemptId,
          code: "conflict",
        }),
      );
      if (!rejectCall.reached || !rejectCall.value.ok) {
        return ambiguous("Staging rejection result is ambiguous");
      }
      try {
        await env.CONTENT_BUCKET.delete(begin.snapshot.stagingKey);
      } catch {
        // The alarm retries deletion of rejected staging data.
      }
      return problem(
        409,
        "upload_conflict",
        "Staging object violated its grant",
      );
    }

    let integrity: { byteLength: number; sha256: string } | null;
    try {
      integrity = await hashMediaUploadStream(
        staging.body,
        begin.snapshot.byteLength,
      );
    } catch {
      return storageUnavailable("Media upload integrity verification failed");
    }
    if (
      integrity === null ||
      integrity.byteLength !== begin.snapshot.byteLength ||
      integrity.sha256 !== begin.snapshot.sha256
    ) {
      const rejectCall = await callMediaUploadAuthority(async () =>
        authority.rejectFinalize({
          attemptId: begin.attemptId,
          code: "hash_invalid",
        }),
      );
      if (!rejectCall.reached || !rejectCall.value.ok) {
        return ambiguous("Media hash rejection result is ambiguous");
      }
      try {
        await env.CONTENT_BUCKET.delete(begin.snapshot.stagingKey);
      } catch {
        // The alarm retries deletion of rejected staging data.
      }
      return problem(
        422,
        "upload_hash_invalid",
        "Media upload SHA-256 does not match its grant",
      );
    }

    const authorizationProblem = await finalAuthorizationProblem();
    if (authorizationProblem !== null) return authorizationProblem;
    const publishCall = await callMediaUploadAuthority(async () =>
      authority.authorizeCandidatePublish({ attemptId: begin.attemptId }),
    );
    if (!publishCall.reached) {
      return ambiguous("Media candidate publication fence is ambiguous");
    }
    if (!publishCall.value.ok) {
      return ambiguous(
        "Media candidate publication authorization result is ambiguous",
      );
    }

    let source: R2ObjectBody | null;
    try {
      source = await env.CONTENT_BUCKET.get(begin.snapshot.stagingKey);
    } catch {
      return storageUnavailable("R2 staging re-read is unavailable");
    }
    const checksum = hexBytes(begin.snapshot.sha256);
    if (source === null || checksum === null) {
      return ambiguous(
        "Verified staging object disappeared before publication",
      );
    }
    try {
      candidate = await env.CONTENT_BUCKET.put(
        begin.snapshot.candidateKey,
        source.body,
        {
          onlyIf: new Headers({ "if-none-match": "*" }),
          httpMetadata: {
            contentType: begin.snapshot.contentType,
            cacheControl: "no-store",
          },
          customMetadata: {
            "punks-schema": "media-candidate@1",
            "upload-id": begin.snapshot.uploadId,
            "media-id": begin.snapshot.mediaId,
            "verified-sha256": begin.snapshot.sha256,
          },
          sha256: checksum,
        },
      );
      if (candidate === null) {
        candidate = await env.CONTENT_BUCKET.head(begin.snapshot.candidateKey);
      }
    } catch {
      return storageUnavailable("R2 candidate publication is unavailable");
    }
    if (
      candidate === null ||
      !candidateObjectMatches(candidate, begin.snapshot)
    ) {
      return ambiguous("Media candidate publication result is ambiguous");
    }
  }

  const authorizationProblem = await finalAuthorizationProblem();
  if (authorizationProblem !== null) return authorizationProblem;
  const finalizedAt = new Date().toISOString();
  const commitCall = await callMediaUploadAuthority(async () =>
    authority.commitFinalize({
      attemptId: begin.attemptId,
      finalizedAt,
    }),
  );
  if (!commitCall.reached) {
    return ambiguous("Media candidate commit result is ambiguous");
  }
  const committed = commitCall.value;
  if (!committed.ok) {
    return ambiguous("Media candidate commit result is ambiguous");
  }
  try {
    await env.CONTENT_BUCKET.delete(begin.snapshot.stagingKey);
  } catch {
    // Candidate state is terminal; the alarm removes staging without touching it.
  }
  return statusResponse(committed.snapshot, 201);
}

async function abandonUpload(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  uploadId: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 4 * 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Media upload abandon command is invalid",
    );
  }
  if (
    !validateContract("punks://contracts/media-upload.abandon@1", body).valid
  ) {
    return problem(
      400,
      "invalid_input",
      "Media upload abandon command is invalid",
    );
  }
  const command = body as AbandonMediaUploadCommand;
  if (command.workspaceId !== workspaceId || command.uploadId !== uploadId) {
    return problem(404, "not_found", "Media upload not found");
  }
  if (command.actor.punkId !== session.punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  if (request.headers.get("idempotency-key") !== command.commandId) {
    return problem(
      409,
      "idempotency_conflict",
      "Idempotency-Key must equal the abandon commandId",
    );
  }
  const authority = env.MEDIA_UPLOADS.getByName(uploadId);
  const inspectCall = await callMediaUploadAuthority(async () =>
    authority.inspect(),
  );
  if (!inspectCall.reached) {
    return problem(
      503,
      "storage_unavailable",
      "Media upload authority is unavailable",
      { retry: "later" },
    );
  }
  const initial = inspectCall.value;
  if (
    initial === null ||
    initial.workspaceId !== workspaceId ||
    initial.uploadId !== uploadId
  ) {
    return problem(404, "not_found", "Media upload not found");
  }
  if (initial.punkId !== session.punkId) {
    return problem(403, "forbidden", "Media upload belongs to another Punk");
  }
  const token = mediaUploadGrantToken(request);
  if (
    token === null ||
    !(await verifyMediaUploadGrantToken(
      env.MEDIA_UPLOAD_GRANT_KEY,
      initial,
      token,
    ))
  ) {
    return problem(
      403,
      "forbidden",
      "Media upload grant is invalid or expired",
    );
  }
  const access = await workspaceAccess(env, workspaceId, session.punkId);
  if (access !== "ok") return workspaceAccessProblem(access);

  const beginCall = await callMediaUploadAuthority(async () =>
    authority.beginAbandon({
      workspaceId,
      punkId: session.punkId,
      commandId: command.commandId,
    }),
  );
  if (!beginCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload abandonment authority result is ambiguous",
      { retry: "same_command" },
    );
  }
  const begin = beginCall.value;
  if (!begin.ok) {
    switch (begin.code) {
      case "idempotency_conflict":
        return problem(
          409,
          "idempotency_conflict",
          "Abandon command conflicts with the upload intention",
        );
      case "in_progress":
        return problem(
          409,
          "command_in_progress",
          "Media cleanup is in progress",
          {
            retry: "later",
            retryAfterMs: 1_000,
          },
        );
      case "expired":
        return problem(410, "upload_expired", "Media upload already expired");
      case "finalized":
        return problem(
          409,
          "upload_conflict",
          "A finalized media candidate cannot be abandoned",
        );
      case "invalid_request":
        return problem(
          500,
          "internal",
          "Media upload authority rejected its route",
        );
    }
  }
  if (begin.action === "replay") return statusResponse(begin.snapshot);

  if (begin.snapshot.r2UploadId !== null) {
    try {
      await env.CONTENT_BUCKET.resumeMultipartUpload(
        begin.snapshot.stagingKey,
        begin.snapshot.r2UploadId,
      ).abort();
    } catch {
      // A completed or already-aborted MPU is reconciled by object deletion.
    }
  }
  try {
    await env.CONTENT_BUCKET.delete([
      begin.snapshot.stagingKey,
      begin.snapshot.candidateKey,
    ]);
  } catch {
    await callMediaUploadAuthority(async () =>
      authority.deferCleanup({ attemptId: begin.attemptId }),
    );
    return problem(
      503,
      "storage_unavailable",
      "R2 media cleanup is unavailable",
      {
        retry: "later",
      },
    );
  }
  const commitCall = await callMediaUploadAuthority(async () =>
    authority.commitAbandon({ attemptId: begin.attemptId }),
  );
  if (!commitCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload abandonment result is ambiguous",
      { retry: "same_command" },
    );
  }
  const committed = commitCall.value;
  if (!committed.ok) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload abandonment result is ambiguous",
      { retry: "same_command" },
    );
  }
  return statusResponse(committed.snapshot);
}

function mediaPartResponse(
  snapshot: MediaUploadInternalSnapshot,
  partNumber: number,
  byteLength: number,
  sha256: string,
  replayed: boolean,
): Response {
  const body: MediaUploadPart = {
    contract: "media-upload.part@1",
    uploadId: snapshot.uploadId,
    partNumber,
    byteLength,
    sha256,
    replayed,
  };
  if (!validateContract("punks://contracts/media-upload.part@1", body).valid) {
    return problem(500, "internal", "Media upload part violated its contract");
  }
  return json(body, replayed ? 200 : 201, { "cache-control": "no-store" });
}

async function putPart(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
  uploadId: string,
  rawPartNumber: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  if (!/^[1-9][0-9]*$/u.test(rawPartNumber)) {
    return problem(400, "invalid_input", "Media upload part number is invalid");
  }
  const partNumber = Number(rawPartNumber);
  const declaredLength = Number(request.headers.get("content-length"));
  const partSha256 = request.headers.get("x-punks-part-sha256");
  if (
    request.body === null ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    partSha256 === null ||
    !/^[0-9a-f]{64}$/u.test(partSha256)
  ) {
    return problem(
      400,
      "invalid_input",
      "Media upload part length and SHA-256 are required",
    );
  }

  const authority = env.MEDIA_UPLOADS.getByName(uploadId);
  const inspectCall = await callMediaUploadAuthority(async () =>
    authority.inspect(),
  );
  if (!inspectCall.reached) {
    return problem(
      503,
      "storage_unavailable",
      "Media upload authority is unavailable",
      { retry: "later" },
    );
  }
  const snapshot = inspectCall.value;
  if (
    snapshot === null ||
    snapshot.uploadId !== uploadId ||
    snapshot.workspaceId !== workspaceId
  ) {
    return problem(404, "not_found", "Media upload not found");
  }
  if (snapshot.punkId !== session.punkId) {
    return problem(403, "forbidden", "Media upload belongs to another Punk");
  }
  const token = mediaUploadGrantToken(request);
  if (
    token === null ||
    !(await verifyMediaUploadGrantToken(
      env.MEDIA_UPLOAD_GRANT_KEY,
      snapshot,
      token,
    ))
  ) {
    return problem(
      403,
      "forbidden",
      "Media upload grant is invalid or expired",
    );
  }
  const expectedLength = expectedMediaUploadPartSize(
    snapshot.byteLength,
    partNumber,
  );
  if (expectedLength === null || expectedLength !== declaredLength) {
    return problem(
      400,
      "invalid_input",
      "Media upload part does not match the granted layout",
    );
  }
  const access = await workspaceAccess(env, workspaceId, session.punkId);
  if (access !== "ok") return workspaceAccessProblem(access);

  const beginCall = await callMediaUploadAuthority(async () =>
    authority.beginPart({
      workspaceId,
      punkId: session.punkId,
      partNumber,
      byteLength: declaredLength,
      sha256: partSha256,
    }),
  );
  if (!beginCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload part authority result is ambiguous",
      { retry: "same_command" },
    );
  }
  const begin = beginCall.value;
  if (!begin.ok) {
    switch (begin.code) {
      case "idempotency_conflict":
        return problem(
          409,
          "idempotency_conflict",
          "Media upload part conflicts with its first accepted identity",
        );
      case "in_progress":
        return problem(
          409,
          "command_in_progress",
          "Media upload part is in progress",
          {
            retry: "later",
            retryAfterMs: 1_000,
          },
        );
      case "expired":
        return problem(403, "forbidden", "Media upload grant expired");
      case "not_uploading":
        return problem(
          409,
          "idempotency_conflict",
          "Media upload is not writable",
        );
      case "invalid_request":
        return problem(
          500,
          "internal",
          "Media upload authority rejected its route",
        );
    }
  }
  if (begin.action === "replay") {
    return mediaPartResponse(
      snapshot,
      partNumber,
      declaredLength,
      partSha256,
      true,
    );
  }

  const fixedLength = new FixedLengthStream(expectedLength);
  const [uploadResult, bodyResult] = await Promise.allSettled([
    env.CONTENT_BUCKET.resumeMultipartUpload(
      begin.stagingKey,
      begin.r2UploadId,
    ).uploadPart(partNumber, fixedLength.readable),
    request.body.pipeTo(fixedLength.writable),
  ]);
  if (uploadResult.status === "rejected" || bodyResult.status === "rejected") {
    await callMediaUploadAuthority(async () =>
      authority.failPart({ partNumber, attemptId: begin.attemptId }),
    );
    return uploadResult.status === "rejected"
      ? problem(
          503,
          "storage_unavailable",
          "R2 media part upload is unavailable",
          { retry: "same_command" },
        )
      : problem(400, "invalid_input", "Media upload part length is invalid");
  }
  const uploaded = uploadResult.value;

  const stillAuthorized =
    (await currentSessionMatches(env, session)) &&
    (await workspaceAccess(env, workspaceId, session.punkId)) === "ok" &&
    (await verifyMediaUploadGrantToken(
      env.MEDIA_UPLOAD_GRANT_KEY,
      snapshot,
      token,
    ));
  if (!stillAuthorized) {
    await callMediaUploadAuthority(async () =>
      authority.failPart({ partNumber, attemptId: begin.attemptId }),
    );
    return problem(403, "forbidden", "Media upload authorization was revoked");
  }
  const commitCall = await callMediaUploadAuthority(async () =>
    authority.commitPart({
      partNumber,
      attemptId: begin.attemptId,
      etag: uploaded.etag,
    }),
  );
  if (!commitCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload part commit result is ambiguous",
      { retry: "same_command" },
    );
  }
  const committed = commitCall.value;
  if (!committed.ok) {
    return problem(
      503,
      "upload_ambiguous",
      "Media upload part result is ambiguous",
      { retry: "same_command" },
    );
  }
  return mediaPartResponse(
    snapshot,
    partNumber,
    declaredLength,
    partSha256,
    false,
  );
}

export async function routeMediaUpload(
  request: Request,
  env: ApiEnv,
  path: string,
): Promise<Response | null> {
  const finalize = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/media-uploads\/([^/]+)\/finalize$/,
  );
  if (
    request.method === "POST" &&
    finalize?.[1] !== undefined &&
    finalize[2] !== undefined
  ) {
    return finalizeUpload(
      request,
      env,
      decodeURIComponent(finalize[1]),
      decodeURIComponent(finalize[2]),
    );
  }
  const part = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/media-uploads\/([^/]+)\/parts\/([^/]+)$/,
  );
  if (
    request.method === "PUT" &&
    part?.[1] !== undefined &&
    part[2] !== undefined &&
    part[3] !== undefined
  ) {
    return putPart(
      request,
      env,
      decodeURIComponent(part[1]),
      decodeURIComponent(part[2]),
      decodeURIComponent(part[3]),
    );
  }
  const collection = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/media-uploads$/,
  );
  if (request.method === "POST" && collection?.[1] !== undefined) {
    return createMediaUploadGrant(
      request,
      env,
      decodeURIComponent(collection[1]),
    );
  }
  const status = path.match(
    /^\/api\/v1\/workspaces\/([^/]+)\/media-uploads\/([^/]+)$/,
  );
  if (
    request.method === "GET" &&
    status?.[1] !== undefined &&
    status[2] !== undefined
  ) {
    return getStatus(
      request,
      env,
      decodeURIComponent(status[1]),
      decodeURIComponent(status[2]),
    );
  }
  if (
    request.method === "DELETE" &&
    status?.[1] !== undefined &&
    status[2] !== undefined
  ) {
    return abandonUpload(
      request,
      env,
      decodeURIComponent(status[1]),
      decodeURIComponent(status[2]),
    );
  }
  return null;
}
