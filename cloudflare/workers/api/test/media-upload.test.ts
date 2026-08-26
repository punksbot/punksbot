import type {
  AbandonMediaUploadCommand,
  CreateMediaUploadGrantCommand,
  CreateWorkspaceCommand,
  FinalizeMediaUploadCommand,
  MediaUploadGrant,
  MediaUploadPart,
  MediaUploadStatus,
} from "@punks/contracts";
import { validateContract } from "@punks/contracts";
import { env, runDurableObjectAlarm, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";

import type { ApiEnv } from "../src/env";
import { routeMediaUpload } from "../src/media-upload-http";

const operatorAuthorization = {
  authorization:
    "Bearer operator-test-token-00000000000000000000000000000000000000000000",
};
const ownerPunkId = "00000000-0000-8000-8000-000000000001";
const otherPunkId = "00000000-0000-8000-8000-000000000002";
const ownerCookie = "__Host-punks_session=session-owner";
const revocableCookie = "__Host-punks_session=session-revocable";
const revocableSessionId = "33333333-3333-8333-8333-333333333333";

async function createWorkspace(owner = ownerPunkId): Promise<string> {
  const command: CreateWorkspaceCommand = {
    contract: "workspace.create@1",
    commandId: crypto.randomUUID(),
    actor: { kind: "punk", punkId: owner },
    payload: {
      slug: `media-${crypto.randomUUID().slice(0, 8)}`,
      name: "Media Upload Workspace",
      visibility: "private",
    },
  };
  const response = await SELF.fetch(
    "https://punks.bot/api/internal/v1/workspaces",
    {
      method: "POST",
      headers: {
        ...operatorAuthorization,
        "content-type": "application/json",
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
  expect(response.status, await response.clone().text()).toBe(201);
  return ((await response.json()) as { workspace: { id: string } }).workspace
    .id;
}

function grantCommand(
  workspaceId: string,
  commandId: string = crypto.randomUUID(),
  payload: Partial<CreateMediaUploadGrantCommand["payload"]> = {},
  punkId = ownerPunkId,
): CreateMediaUploadGrantCommand {
  return {
    contract: "media-upload.grant-create@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      purpose: "message_attachment",
      byteLength: 8_388_609,
      contentType: "image/png",
      sha256: "a".repeat(64),
      ...payload,
    },
  };
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function uploadPart(
  grant: MediaUploadGrant,
  partNumber: number,
  bytes: Uint8Array,
  partSha256: string,
  token = grant.credential.token,
  cookie = ownerCookie,
): Promise<Response> {
  const path = grant.endpoints.partUrlTemplate.replace(
    "{partNumber}",
    `${partNumber}`,
  );
  return SELF.fetch(`https://punks.bot${path}`, {
    method: "PUT",
    headers: {
      authorization: `PunksUpload ${token}`,
      "content-length": `${bytes.byteLength}`,
      cookie,
      "x-punks-part-sha256": partSha256,
    },
    body: Uint8Array.from(bytes).buffer,
  });
}

async function finalizeUpload(
  grant: MediaUploadGrant,
  commandId = crypto.randomUUID(),
  punkId = ownerPunkId,
  cookie = ownerCookie,
): Promise<Response> {
  const command: FinalizeMediaUploadCommand = {
    contract: "media-upload.finalize@1",
    commandId,
    workspaceId: grant.status.workspaceId,
    uploadId: grant.status.uploadId,
    actor: { kind: "punk", punkId },
  };
  return SELF.fetch(`https://punks.bot${grant.endpoints.finalizeUrl}`, {
    method: "POST",
    headers: {
      authorization: `PunksUpload ${grant.credential.token}`,
      "content-type": "application/json",
      cookie,
      "idempotency-key": commandId,
    },
    body: JSON.stringify(command),
  });
}

async function abandonUpload(
  grant: MediaUploadGrant,
  commandId = crypto.randomUUID(),
): Promise<Response> {
  const command: AbandonMediaUploadCommand = {
    contract: "media-upload.abandon@1",
    commandId,
    workspaceId: grant.status.workspaceId,
    uploadId: grant.status.uploadId,
    actor: { kind: "punk", punkId: ownerPunkId },
  };
  return SELF.fetch(`https://punks.bot${grant.endpoints.abandonUrl}`, {
    method: "DELETE",
    headers: {
      authorization: `PunksUpload ${grant.credential.token}`,
      "content-type": "application/json",
      cookie: ownerCookie,
      "idempotency-key": commandId,
    },
    body: JSON.stringify(command),
  });
}

async function createGrant(
  command: CreateMediaUploadGrantCommand,
  cookie = ownerCookie,
): Promise<Response> {
  return SELF.fetch(
    `https://punks.bot/api/v1/workspaces/${command.workspaceId}/media-uploads`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "idempotency-key": command.commandId,
      },
      body: JSON.stringify(command),
    },
  );
}

async function prepareExistingCandidateForRevocablePunk(): Promise<MediaUploadGrant> {
  const workspaceId = await createWorkspace(otherPunkId);
  const bytes = new TextEncoder().encode("candidate awaiting final authority");
  const sha256 = await digestHex(bytes);
  const grantResponse = await createGrant(
    grantCommand(
      workspaceId,
      crypto.randomUUID(),
      { byteLength: bytes.byteLength, sha256 },
      otherPunkId,
    ),
    revocableCookie,
  );
  expect(grantResponse.status, await grantResponse.clone().text()).toBe(201);
  const grant = (await grantResponse.json()) as MediaUploadGrant;
  expect(
    (
      await uploadPart(
        grant,
        1,
        bytes,
        sha256,
        grant.credential.token,
        revocableCookie,
      )
    ).status,
  ).toBe(201);

  const authority = env.MEDIA_UPLOADS.getByName(grant.status.uploadId);
  const snapshot = await authority.inspect();
  if (snapshot === null) throw new TypeError("Upload intent is absent");
  const checksum = Uint8Array.from({ length: 32 }, (_, index) =>
    Number.parseInt(sha256.slice(index * 2, index * 2 + 2), 16),
  );
  const candidate = await env.CONTENT_BUCKET.put(
    snapshot.candidateKey,
    Uint8Array.from(bytes).buffer,
    {
      onlyIf: new Headers({ "if-none-match": "*" }),
      httpMetadata: {
        contentType: snapshot.contentType,
        cacheControl: "no-store",
      },
      customMetadata: {
        "punks-schema": "media-candidate@1",
        "upload-id": snapshot.uploadId,
        "media-id": snapshot.mediaId,
        "verified-sha256": snapshot.sha256,
      },
      sha256: checksum,
    },
  );
  expect(candidate).not.toBeNull();
  return grant;
}

describe("granted R2 media uploads", () => {
  it("creates and replays one short grant bound to its immutable intention", async () => {
    const workspaceId = await createWorkspace();
    const command = grantCommand(workspaceId);

    const first = await createGrant(command);
    expect(first.status, await first.clone().text()).toBe(201);
    const granted = (await first.json()) as MediaUploadGrant;
    expect(
      validateContract("punks://contracts/media-upload.grant@1", granted),
    ).toEqual({ valid: true });
    expect(granted.status).toMatchObject({
      workspaceId,
      punkId: ownerPunkId,
      purpose: "message_attachment",
      byteLength: command.payload.byteLength,
      contentType: command.payload.contentType,
      sha256: command.payload.sha256,
      partSize: 8_388_608,
      partCount: 2,
      state: "uploading",
    });
    expect(granted.credential.token.length).toBeLessThanOrEqual(80);
    expect(granted.endpoints.partUrlTemplate).toContain("/parts/{partNumber}");
    expect(granted.replayed).toBe(false);

    const replay = await createGrant(command);
    expect(replay.status, await replay.clone().text()).toBe(200);
    const replayed = (await replay.json()) as MediaUploadGrant;
    expect(replayed.status.uploadId).toBe(granted.status.uploadId);
    expect(replayed.credential.token).toBe(granted.credential.token);
    expect(replayed.replayed).toBe(true);

    const changed = grantCommand(workspaceId, command.commandId);
    changed.payload.sha256 = "b".repeat(64);
    const conflict = await createGrant(changed);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
      retry: "never",
    });
  });

  it("replays an identical part safely and rejects a conflicting replacement", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("one bounded media part");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    expect(grantResponse.status).toBe(201);
    const grant = (await grantResponse.json()) as MediaUploadGrant;

    const first = await uploadPart(grant, 1, bytes, sha256);
    expect(first.status, await first.clone().text()).toBe(201);
    const uploaded = (await first.json()) as MediaUploadPart;
    expect(
      validateContract("punks://contracts/media-upload.part@1", uploaded),
    ).toEqual({ valid: true });
    expect(uploaded).toMatchObject({
      uploadId: grant.status.uploadId,
      partNumber: 1,
      byteLength: bytes.byteLength,
      sha256,
      replayed: false,
    });

    const replay = await uploadPart(grant, 1, bytes, sha256);
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });

    const conflictBytes = new Uint8Array(bytes.byteLength).fill(0x78);
    const conflict = await uploadPart(
      grant,
      1,
      conflictBytes,
      await digestHex(conflictBytes),
    );
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const forged = await uploadPart(grant, 1, bytes, sha256, "A".repeat(62));
    expect(forged.status).toBe(403);
  });

  it("verifies the assembled object before publishing one idempotent candidate", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("integrity checked candidate");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        contentType: "text/plain",
        sha256,
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(grant, 1, bytes, sha256)).status).toBe(201);

    const finalizeCommandId = crypto.randomUUID();
    const finalized = await finalizeUpload(grant, finalizeCommandId);
    expect(finalized.status, await finalized.clone().text()).toBe(201);
    const candidate = (await finalized.json()) as MediaUploadStatus;
    expect(
      validateContract("punks://contracts/media-upload.status@1", candidate),
    ).toEqual({ valid: true });
    expect(candidate).toMatchObject({
      uploadId: grant.status.uploadId,
      state: "candidate",
      candidate: {
        byteLength: bytes.byteLength,
        contentType: "text/plain",
        sha256,
      },
      failure: null,
    });

    const statusResponse = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toMatchObject({
      state: "candidate",
      candidate: { mediaId: candidate.candidate?.mediaId },
    });

    const replay = await finalizeUpload(grant, finalizeCommandId);
    expect(replay.status, await replay.clone().text()).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      state: "candidate",
      candidate: { mediaId: candidate.candidate?.mediaId },
    });
  });

  it("reauthorizes a stale Session before committing an existing candidate", async () => {
    const grant = await prepareExistingCandidateForRevocablePunk();
    const auth = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      setSessionRevoked(sessionId: string, revoked: boolean): Promise<void>;
    };
    await auth.setSessionRevoked(revocableSessionId, true);
    try {
      const commandId = crypto.randomUUID();
      const finalized = await finalizeUpload(
        grant,
        commandId,
        otherPunkId,
        revocableCookie,
      );
      expect(finalized.status, await finalized.clone().text()).toBe(403);
      await expect(finalized.json()).resolves.toMatchObject({
        code: "forbidden",
      });

      const status = await SELF.fetch(
        `https://punks.bot${grant.endpoints.statusUrl}`,
        { headers: { cookie: revocableCookie } },
      );
      expect(status.status, await status.clone().text()).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        state: "rejected",
        candidate: null,
        failure: { code: "authorization_lost", retry: "never" },
      });

      await expect(
        env.MEDIA_UPLOADS.getByName(grant.status.uploadId).beginFinalize({
          workspaceId: grant.status.workspaceId,
          punkId: otherPunkId,
          commandId,
        }),
      ).resolves.toMatchObject({
        ok: false,
        code: "rejected",
        snapshot: { failureCode: "authorization_lost" },
      });

      const replay = await finalizeUpload(
        grant,
        commandId,
        otherPunkId,
        revocableCookie,
      );
      expect(replay.status, await replay.clone().text()).toBe(403);
      await expect(replay.json()).resolves.toMatchObject({ code: "forbidden" });
    } finally {
      await auth.setSessionRevoked(revocableSessionId, false);
    }
  });

  it("reauthorizes a terminal replay without altering its candidate", async () => {
    const grant = await prepareExistingCandidateForRevocablePunk();
    const commandId = crypto.randomUUID();
    const finalized = await finalizeUpload(
      grant,
      commandId,
      otherPunkId,
      revocableCookie,
    );
    expect(finalized.status, await finalized.clone().text()).toBe(201);
    const candidate = (await finalized.json()) as MediaUploadStatus;

    const auth = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      setSessionRevoked(sessionId: string, revoked: boolean): Promise<void>;
    };
    await auth.setSessionRevoked(revocableSessionId, true);
    try {
      const replay = await finalizeUpload(
        grant,
        commandId,
        otherPunkId,
        revocableCookie,
      );
      expect(replay.status, await replay.clone().text()).toBe(403);
      await expect(replay.json()).resolves.toMatchObject({ code: "forbidden" });
    } finally {
      await auth.setSessionRevoked(revocableSessionId, false);
    }

    const status = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: revocableCookie } },
    );
    expect(status.status, await status.clone().text()).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      state: "candidate",
      candidate: { mediaId: candidate.candidate?.mediaId },
      failure: null,
    });
  });

  it("keeps a transient Session authority outage recoverable", async () => {
    const grant = await prepareExistingCandidateForRevocablePunk();
    const auth = env.AUTH_SERVICE as typeof env.AUTH_SERVICE & {
      setSessionUnavailable(
        sessionId: string,
        unavailable: boolean,
      ): Promise<void>;
    };
    await auth.setSessionUnavailable(revocableSessionId, true);
    try {
      const finalized = await finalizeUpload(
        grant,
        crypto.randomUUID(),
        otherPunkId,
        revocableCookie,
      );
      expect(finalized.status, await finalized.clone().text()).toBe(503);
      await expect(finalized.json()).resolves.toMatchObject({
        code: "temporarily_unavailable",
        retry: "later",
      });

      const status = await SELF.fetch(
        `https://punks.bot${grant.endpoints.statusUrl}`,
        { headers: { cookie: revocableCookie } },
      );
      expect(status.status, await status.clone().text()).toBe(200);
      await expect(status.json()).resolves.toMatchObject({
        state: "finalizing",
        candidate: null,
        failure: { code: "ambiguous", retry: "same_command" },
      });
    } finally {
      await auth.setSessionUnavailable(revocableSessionId, false);
    }
  });

  it("rejects a mismatched content hash without publishing a candidate", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("bytes that violate the grant");
    const partSha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        contentType: "text/plain",
        sha256: "f".repeat(64),
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(grant, 1, bytes, partSha256)).status).toBe(201);

    const finalizeCommandId = crypto.randomUUID();
    const rejected = await finalizeUpload(grant, finalizeCommandId);
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      code: "upload_hash_invalid",
      retry: "never",
    });

    const status = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      state: "rejected",
      candidate: null,
      failure: { code: "hash_invalid", retry: "new_intent" },
    });

    const replay = await finalizeUpload(grant, finalizeCommandId);
    expect(replay.status).toBe(422);
    await expect(replay.json()).resolves.toMatchObject({
      code: "upload_hash_invalid",
    });
  });

  it("abandons and cleans an unfinished upload without deleting a finalized candidate", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("abandoned upload bytes");
    const sha256 = await digestHex(bytes);
    const abandonedGrantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const abandonedGrant =
      (await abandonedGrantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(abandonedGrant, 1, bytes, sha256)).status).toBe(
      201,
    );

    const abandonCommandId = crypto.randomUUID();
    const abandoned = await abandonUpload(abandonedGrant, abandonCommandId);
    expect(abandoned.status, await abandoned.clone().text()).toBe(200);
    await expect(abandoned.json()).resolves.toMatchObject({
      state: "abandoned",
      candidate: null,
      failure: { code: "abandoned", retry: "new_intent" },
    });
    const abandonReplay = await abandonUpload(abandonedGrant, abandonCommandId);
    expect(abandonReplay.status).toBe(200);
    await expect(abandonReplay.json()).resolves.toMatchObject({
      state: "abandoned",
    });
    expect((await finalizeUpload(abandonedGrant)).status).toBe(409);

    const finalizedGrantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const finalizedGrant =
      (await finalizedGrantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(finalizedGrant, 1, bytes, sha256)).status).toBe(
      201,
    );
    expect((await finalizeUpload(finalizedGrant)).status).toBe(201);

    const refused = await abandonUpload(finalizedGrant);
    expect(refused.status).toBe(409);
    await expect(refused.json()).resolves.toMatchObject({
      code: "upload_conflict",
    });
    const stillCandidate = await SELF.fetch(
      `https://punks.bot${finalizedGrant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    await expect(stillCandidate.json()).resolves.toMatchObject({
      state: "candidate",
      candidate: { sha256 },
    });
  });

  it("expires an unfinished intention through its Durable Object alarm", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("expiring media bytes");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(grant, 1, bytes, sha256)).status).toBe(201);

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.parse(grant.status.expiresAt) + 1);
      await expect(
        runDurableObjectAlarm(
          env.MEDIA_UPLOADS.getByName(grant.status.uploadId),
        ),
      ).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }

    const status = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      state: "expired",
      candidate: null,
      failure: { code: "expired", retry: "new_intent" },
    });
  });

  it("reports R2 loss as a typed recoverable storage failure", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("R2 unavailable boundary");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    const authority = env.MEDIA_UPLOADS.getByName(grant.status.uploadId);
    const snapshot = await authority.inspect();
    expect(snapshot?.r2UploadId).not.toBeNull();
    if (snapshot?.r2UploadId === null || snapshot === null) return;
    await env.CONTENT_BUCKET.resumeMultipartUpload(
      snapshot.stagingKey,
      snapshot.r2UploadId,
    ).abort();

    const unavailable = await uploadPart(grant, 1, bytes, sha256);
    expect(unavailable.status).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "storage_unavailable",
      retry: "same_command",
    });
  });

  it("keeps a finalization storage outage distinct in recovery status", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("recoverable R2 finalization loss");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(grant, 1, bytes, sha256)).status).toBe(201);

    const command: FinalizeMediaUploadCommand = {
      contract: "media-upload.finalize@1",
      commandId: crypto.randomUUID(),
      workspaceId,
      uploadId: grant.status.uploadId,
      actor: { kind: "punk", punkId: ownerPunkId },
    };
    // cloudflare:test types Service bindings generically even though this
    // fixture provides every ApiEnv RPC refinement inside workerd.
    const workerdEnv = env as typeof env & ApiEnv;
    // Every binding remains workerd-backed; only the otherwise unreachable R2
    // outage is injected at the typed binding method consumed by this route.
    const unavailableBucket = new Proxy(workerdEnv.CONTENT_BUCKET, {
      get(target, property, receiver) {
        if (property === "head") {
          return async () => {
            throw new Error("simulated R2 outage");
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const unavailableEnv = new Proxy(workerdEnv, {
      get(target, property, receiver) {
        return property === "CONTENT_BUCKET"
          ? unavailableBucket
          : Reflect.get(target, property, receiver);
      },
    });
    const unavailable = await routeMediaUpload(
      new Request(`https://punks.bot${grant.endpoints.finalizeUrl}`, {
        method: "POST",
        headers: {
          authorization: `PunksUpload ${grant.credential.token}`,
          "content-type": "application/json",
          cookie: ownerCookie,
          "idempotency-key": command.commandId,
        },
        body: JSON.stringify(command),
      }),
      unavailableEnv,
      grant.endpoints.finalizeUrl,
    );
    if (unavailable === null) throw new TypeError("Media route was not found");
    expect(unavailable.status, await unavailable.clone().text()).toBe(503);
    await expect(unavailable.json()).resolves.toMatchObject({
      code: "storage_unavailable",
      retry: "later",
    });

    const status = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    await expect(status.json()).resolves.toMatchObject({
      state: "finalizing",
      failure: { code: "storage_unavailable", retry: "later" },
    });
  });

  it("does not claim that a superseded finalization release was persisted", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("superseded release fence");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(grant, 1, bytes, sha256)).status).toBe(201);

    const authority = env.MEDIA_UPLOADS.getByName(grant.status.uploadId);
    const begun = await authority.beginFinalize({
      workspaceId,
      punkId: ownerPunkId,
      commandId: crypto.randomUUID(),
    });
    expect(begun).toMatchObject({ ok: true, action: "finalize" });
    if (!begun.ok || begun.action !== "finalize") return;
    await expect(
      authority.rejectFinalize({
        attemptId: crypto.randomUUID(),
        code: "conflict",
      }),
    ).resolves.toEqual({ ok: false, code: "superseded" });
    await expect(
      authority.releaseFinalize({
        attemptId: crypto.randomUUID(),
        failureCode: "storage_unavailable",
      }),
    ).resolves.toEqual({ ok: false, code: "superseded" });

    const status = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    await expect(status.json()).resolves.toMatchObject({
      state: "finalizing",
      failure: { code: "ambiguous", retry: "same_command" },
    });
    await authority.releaseFinalize({ attemptId: begun.attemptId });
  });

  it("exposes and recovers an ambiguous finalization through status", async () => {
    const workspaceId = await createWorkspace();
    const bytes = new TextEncoder().encode("ambiguous then recovered");
    const sha256 = await digestHex(bytes);
    const grantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: bytes.byteLength,
        sha256,
      }),
    );
    const grant = (await grantResponse.json()) as MediaUploadGrant;
    expect((await uploadPart(grant, 1, bytes, sha256)).status).toBe(201);

    const commandId = crypto.randomUUID();
    const authority = env.MEDIA_UPLOADS.getByName(grant.status.uploadId);
    const begun = await authority.beginFinalize({
      workspaceId,
      punkId: ownerPunkId,
      commandId,
    });
    expect(begun).toMatchObject({ ok: true, action: "finalize" });
    if (!begun.ok || begun.action !== "finalize") return;

    const ambiguousStatus = await SELF.fetch(
      `https://punks.bot${grant.endpoints.statusUrl}`,
      { headers: { cookie: ownerCookie } },
    );
    await expect(ambiguousStatus.json()).resolves.toMatchObject({
      state: "finalizing",
      failure: { code: "ambiguous", retry: "same_command" },
    });

    await authority.releaseFinalize({ attemptId: begun.attemptId });
    const recovered = await finalizeUpload(grant, commandId);
    expect(recovered.status, await recovered.clone().text()).toBe(201);
    await expect(recovered.json()).resolves.toMatchObject({
      state: "candidate",
      failure: null,
    });
  });

  it("assembles out-of-order multipart data without crossing upload intentions", async () => {
    const workspaceId = await createWorkspace();
    const firstPart = new Uint8Array(8_388_608).fill(0x61);
    const lastPart = Uint8Array.of(0x62);
    const complete = new Uint8Array(firstPart.byteLength + lastPart.byteLength);
    complete.set(firstPart);
    complete.set(lastPart, firstPart.byteLength);
    const completeSha256 = await digestHex(complete);

    const firstGrantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: complete.byteLength,
        sha256: completeSha256,
      }),
    );
    const firstGrant = (await firstGrantResponse.json()) as MediaUploadGrant;
    const otherGrantResponse = await createGrant(
      grantCommand(workspaceId, crypto.randomUUID(), {
        byteLength: complete.byteLength,
        sha256: completeSha256,
      }),
    );
    const otherGrant = (await otherGrantResponse.json()) as MediaUploadGrant;

    const crossed = await uploadPart(
      firstGrant,
      2,
      lastPart,
      await digestHex(lastPart),
      otherGrant.credential.token,
    );
    expect(crossed.status).toBe(403);

    expect(
      (await uploadPart(firstGrant, 2, lastPart, await digestHex(lastPart)))
        .status,
    ).toBe(201);
    expect(
      (await uploadPart(firstGrant, 1, firstPart, await digestHex(firstPart)))
        .status,
    ).toBe(201);

    const finalized = await finalizeUpload(firstGrant);
    expect(finalized.status, await finalized.clone().text()).toBe(201);
    await expect(finalized.json()).resolves.toMatchObject({
      state: "candidate",
      candidate: {
        byteLength: complete.byteLength,
        sha256: completeSha256,
      },
      uploadedParts: [
        { partNumber: 1, byteLength: firstPart.byteLength },
        { partNumber: 2, byteLength: lastPart.byteLength },
      ],
    });
  });
});
