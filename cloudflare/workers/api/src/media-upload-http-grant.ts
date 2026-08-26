import type {
  CreateMediaUploadGrantCommand,
  MediaUploadGrant,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { prepareMediaUploadIntent } from "@punks/core";

import type { ApiEnv } from "./env";
import { authenticatedPunkSession, json, problem, readJson } from "./http";
import {
  callMediaUploadAuthority,
  currentMediaUploadSessionMatches,
  mediaUploadWorkspaceAccess,
  mediaUploadWorkspaceAccessProblem,
  publicMediaUploadStatus,
} from "./media-upload-http-shared";
import { mintMediaUploadGrantToken } from "./media-upload-security";
import type { MediaUploadInternalSnapshot } from "./media-upload-state";

function grantEndpoints(workspaceId: string, uploadId: string) {
  const base = `/api/v1/workspaces/${workspaceId}/media-uploads/${uploadId}`;
  return {
    partUrlTemplate: `${base}/parts/{partNumber}`,
    finalizeUrl: `${base}/finalize`,
    statusUrl: base,
    abandonUrl: base,
  };
}

async function grantedResponse(
  env: ApiEnv,
  snapshot: MediaUploadInternalSnapshot,
  replayed: boolean,
): Promise<Response> {
  const token = await mintMediaUploadGrantToken(
    env.MEDIA_UPLOAD_GRANT_KEY,
    snapshot,
  );
  if (token === null) {
    return problem(
      503,
      "temporarily_unavailable",
      "Media upload grant signer is unavailable",
      { retry: "later" },
    );
  }
  const body: MediaUploadGrant = {
    contract: "media-upload.grant@1",
    status: publicMediaUploadStatus(snapshot),
    credential: { scheme: "PunksUpload", token },
    endpoints: grantEndpoints(snapshot.workspaceId, snapshot.uploadId),
    replayed,
  };
  if (!validateContract("punks://contracts/media-upload.grant@1", body).valid) {
    return problem(500, "internal", "Media upload grant violated its contract");
  }
  return json(body, replayed ? 200 : 201, {
    "cache-control": "no-store",
    location: body.endpoints.statusUrl,
  });
}

export async function createMediaUploadGrant(
  request: Request,
  env: ApiEnv,
  workspaceId: string,
): Promise<Response> {
  const session = await authenticatedPunkSession(request, env);
  if (session === null) {
    return problem(401, "unauthenticated", "Punk authentication is required");
  }
  let body: unknown;
  try {
    body = await readJson(request, 8 * 1_024);
  } catch {
    return problem(
      400,
      "invalid_input",
      "Media upload grant command is invalid",
    );
  }
  if (
    !validateContract("punks://contracts/media-upload.grant-create@1", body)
      .valid
  ) {
    return problem(
      400,
      "invalid_input",
      "Media upload grant command is invalid",
    );
  }
  const command = body as CreateMediaUploadGrantCommand;
  if (command.workspaceId !== workspaceId) {
    return problem(404, "not_found", "Workspace not found");
  }
  if (command.actor.punkId !== session.punkId) {
    return problem(403, "forbidden", "Punk actor does not match the session");
  }
  if (request.headers.get("idempotency-key") !== command.commandId) {
    return problem(
      409,
      "idempotency_conflict",
      "Idempotency-Key must equal the upload intention commandId",
    );
  }
  const access = await mediaUploadWorkspaceAccess(
    env,
    workspaceId,
    session.punkId,
  );
  if (access !== "ok") return mediaUploadWorkspaceAccessProblem(access);

  const intent = await prepareMediaUploadIntent(command, Date.now());
  const authority = env.MEDIA_UPLOADS.getByName(intent.uploadId);
  const beginCall = await callMediaUploadAuthority(async () =>
    authority.beginGrant(intent),
  );
  if (!beginCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Upload grant authority result is ambiguous",
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
          "Upload intention was reused with different integrity coordinates",
        );
      case "in_progress":
        return problem(
          409,
          "command_in_progress",
          "Upload grant is in progress",
          { retry: "later", retryAfterMs: 1_000 },
        );
      case "expired":
        return problem(410, "upload_expired", "Upload intention expired");
      case "terminal":
        return problem(
          409,
          "upload_conflict",
          "Upload intention is already terminal",
        );
      case "invalid_request":
        return problem(500, "internal", "Upload authority rejected its route");
    }
  }
  if (begin.action === "ready") {
    return grantedResponse(env, begin.snapshot, true);
  }

  let multipart: R2MultipartUpload;
  try {
    multipart = await env.CONTENT_BUCKET.createMultipartUpload(
      begin.snapshot.stagingKey,
      {
        httpMetadata: {
          contentType: begin.snapshot.contentType,
          cacheControl: "no-store",
        },
        customMetadata: {
          "punks-schema": "media-upload-staging@1",
          "upload-id": begin.snapshot.uploadId,
          "expected-sha256": begin.snapshot.sha256,
        },
      },
    );
  } catch {
    await callMediaUploadAuthority(async () =>
      authority.failGrant({ attemptId: begin.attemptId }),
    );
    return problem(
      503,
      "storage_unavailable",
      "R2 media storage is unavailable",
      { retry: "same_command" },
    );
  }

  const stillAuthorized =
    (await currentMediaUploadSessionMatches(env, session)) &&
    (await mediaUploadWorkspaceAccess(env, workspaceId, session.punkId)) ===
      "ok";
  if (!stillAuthorized) {
    try {
      await multipart.abort();
    } catch {
      // R2 abort is retried by the platform lifecycle for this uncommitted MPU.
    }
    await callMediaUploadAuthority(async () =>
      authority.failGrant({ attemptId: begin.attemptId }),
    );
    return problem(403, "forbidden", "Upload grant authorization was revoked");
  }

  const commitCall = await callMediaUploadAuthority(async () =>
    authority.commitGrant({
      attemptId: begin.attemptId,
      r2UploadId: multipart.uploadId,
    }),
  );
  if (!commitCall.reached) {
    return problem(
      503,
      "upload_ambiguous",
      "Upload grant commit result is ambiguous",
      { retry: "same_command" },
    );
  }
  const committed = commitCall.value;
  if (!committed.ok) {
    try {
      await multipart.abort();
    } catch {
      // The unrecorded upload remains bounded by R2's incomplete-upload lifecycle.
    }
    return problem(
      503,
      "upload_ambiguous",
      "Upload grant result is ambiguous",
      { retry: "same_command" },
    );
  }
  return grantedResponse(env, committed.snapshot, false);
}
