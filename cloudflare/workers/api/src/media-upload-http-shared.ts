import type { AuthSession, MediaUploadStatus } from "@punks/contracts";
import { validateContract } from "@punks/contracts";

import type { ApiEnv } from "./env";
import { json, problem } from "./http";
import { verifyMediaUploadGrantToken } from "./media-upload-security";
import type { MediaUploadInternalSnapshot } from "./media-upload-state";

type WorkspaceAccess = "ok" | "not_found" | "forbidden" | "unavailable";

export async function callMediaUploadAuthority<T>(
  operation: () => Promise<T>,
): Promise<{ reached: true; value: T } | { reached: false }> {
  try {
    return { reached: true, value: await operation() };
  } catch {
    return { reached: false };
  }
}

export async function mediaUploadWorkspaceAccess(
  env: ApiEnv,
  workspaceId: string,
  punkId: string,
): Promise<WorkspaceAccess> {
  try {
    const result = await env.WORKSPACES.getByName(workspaceId).authorize({
      workspaceId,
      punkId,
      permission: "workspace.read",
    });
    if (result.ok) return "ok";
    if (result.code === "not_found") return "not_found";
    if (result.code === "forbidden") return "forbidden";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export function mediaUploadWorkspaceAccessProblem(
  access: Exclude<WorkspaceAccess, "ok">,
): Response {
  switch (access) {
    case "not_found":
      return problem(404, "not_found", "Workspace not found");
    case "forbidden":
      return problem(403, "forbidden", "Workspace membership is required");
    case "unavailable":
      return problem(
        503,
        "temporarily_unavailable",
        "Workspace authority is unavailable",
        { retry: "later" },
      );
  }
}

export type MediaUploadSessionStatus = "ok" | "denied" | "unavailable";

export async function currentMediaUploadSessionStatus(
  env: ApiEnv,
  session: AuthSession,
): Promise<MediaUploadSessionStatus> {
  try {
    const current = await env.AUTH_SERVICE.resolveSessionId(session.sessionId);
    return current?.sessionId === session.sessionId &&
      current.punkId === session.punkId
      ? "ok"
      : "denied";
  } catch {
    return "unavailable";
  }
}

export async function currentMediaUploadSessionMatches(
  env: ApiEnv,
  session: AuthSession,
): Promise<boolean> {
  return (await currentMediaUploadSessionStatus(env, session)) === "ok";
}

export type MediaUploadAuthorizationStatus = "ok" | "denied" | "unavailable";

export async function mediaUploadFinalAuthorizationStatus(
  env: ApiEnv,
  session: AuthSession,
  snapshot: MediaUploadInternalSnapshot,
  token: string,
): Promise<MediaUploadAuthorizationStatus> {
  const currentSession = await currentMediaUploadSessionStatus(env, session);
  if (currentSession !== "ok") return currentSession;
  const currentWorkspaceAccess = await mediaUploadWorkspaceAccess(
    env,
    snapshot.workspaceId,
    session.punkId,
  );
  if (currentWorkspaceAccess === "unavailable") return "unavailable";
  if (currentWorkspaceAccess !== "ok") return "denied";
  return (await verifyMediaUploadGrantToken(
    env.MEDIA_UPLOAD_GRANT_KEY,
    snapshot,
    token,
  ))
    ? "ok"
    : "denied";
}

export function publicMediaUploadStatus(
  snapshot: MediaUploadInternalSnapshot,
): MediaUploadStatus {
  const state = snapshot.state === "granting" ? "uploading" : snapshot.state;
  const failure = (() => {
    switch (snapshot.failureCode) {
      case "storage_unavailable":
        return {
          code: "storage_unavailable" as const,
          retry: "later" as const,
        };
      case "hash_invalid":
        return { code: "hash_invalid" as const, retry: "new_intent" as const };
      case "conflict":
        return { code: "conflict" as const, retry: "never" as const };
      case "ambiguous":
        return {
          code: "ambiguous" as const,
          retry: "same_command" as const,
        };
      case "expired":
        return { code: "expired" as const, retry: "new_intent" as const };
      case "abandoned":
        return { code: "abandoned" as const, retry: "new_intent" as const };
      case "authorization_lost":
        return {
          code: "authorization_lost" as const,
          retry: "never" as const,
        };
      default:
        return null;
    }
  })();
  return {
    contract: "media-upload.status@1",
    uploadId: snapshot.uploadId,
    workspaceId: snapshot.workspaceId,
    punkId: snapshot.punkId,
    purpose: snapshot.purpose,
    byteLength: snapshot.byteLength,
    contentType: snapshot.contentType,
    sha256: snapshot.sha256,
    issuedAt: snapshot.issuedAt,
    expiresAt: snapshot.expiresAt,
    partSize: 8_388_608,
    partCount: snapshot.partCount,
    state,
    uploadedParts: snapshot.uploadedParts,
    candidate:
      state === "candidate" && snapshot.finalizedAt !== null
        ? {
            mediaId: snapshot.mediaId,
            byteLength: snapshot.byteLength,
            contentType: snapshot.contentType,
            sha256: snapshot.sha256,
            finalizedAt: snapshot.finalizedAt,
          }
        : null,
    failure,
  };
}

export function mediaUploadStatusResponse(
  snapshot: MediaUploadInternalSnapshot,
  status = 200,
): Response {
  const body = publicMediaUploadStatus(snapshot);
  if (
    !validateContract("punks://contracts/media-upload.status@1", body).valid
  ) {
    return problem(
      500,
      "internal",
      "Media upload status violated its contract",
    );
  }
  return json(body, status, { "cache-control": "no-store" });
}
