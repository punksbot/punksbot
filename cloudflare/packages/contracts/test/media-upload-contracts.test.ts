import { describe, expect, it } from "vitest";

import registry from "../registry.json";
import desktopProfile from "../profiles/desktop-social-loop@1.json";
import { validateContract } from "../src/registry";

const workspaceId = "58975ca8-3b75-42c7-a13a-51c9d7306200";
const punkId = "00000000-0000-8000-8000-000000000001";
const uploadId = "018f6f4e-8f50-7c4a-8d2d-5d4f2d8a6301";
const commandId = "2a2e9e5e-bf3f-4f29-8f37-03ed6bb08001";
const sha256 = "a".repeat(64);

function validates(contract: string, value: unknown): boolean {
  return validateContract(contract as never, value).valid;
}

function createGrantCommand() {
  return {
    contract: "media-upload.grant-create@1",
    commandId,
    workspaceId,
    actor: { kind: "punk", punkId },
    payload: {
      purpose: "message_attachment",
      byteLength: 8_388_609,
      contentType: "image/png",
      sha256,
    },
  };
}

function uploadStatus(state: "uploading" | "candidate" = "uploading") {
  return {
    contract: "media-upload.status@1",
    uploadId,
    workspaceId,
    punkId,
    purpose: "message_attachment",
    byteLength: 8_388_609,
    contentType: "image/png",
    sha256,
    issuedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-26T00:15:00.000Z",
    partSize: 8_388_608,
    partCount: 2,
    state,
    uploadedParts:
      state === "candidate"
        ? [
            {
              partNumber: 1,
              byteLength: 8_388_608,
              sha256: "b".repeat(64),
            },
            { partNumber: 2, byteLength: 1, sha256: "c".repeat(64) },
          ]
        : [],
    candidate:
      state === "candidate"
        ? {
            mediaId: "118f6f4e-8f50-7c4a-8d2d-5d4f2d8a6302",
            byteLength: 8_388_609,
            contentType: "image/png",
            sha256,
            finalizedAt: "2026-08-26T00:04:00.000Z",
          }
        : null,
    failure: null,
  };
}

describe("granted R2 media upload contracts", () => {
  it("binds a grant request to one Punk, Workspace, purpose and integrity tuple", () => {
    const command = createGrantCommand();
    expect(
      validates("punks://contracts/media-upload.grant-create@1", command),
    ).toBe(true);

    for (const payload of [
      { ...command.payload, byteLength: 0 },
      { ...command.payload, byteLength: 268_435_457 },
      { ...command.payload, contentType: "application/x-unknown" },
      { ...command.payload, sha256: "A".repeat(64) },
      { ...command.payload, purpose: "arbitrary" },
    ]) {
      expect(
        validates("punks://contracts/media-upload.grant-create@1", {
          ...command,
          payload,
        }),
        JSON.stringify(payload),
      ).toBe(false);
    }
  });

  it("returns only a short upload-scoped credential and relative endpoints", () => {
    const grant = {
      contract: "media-upload.grant@1",
      status: uploadStatus(),
      credential: {
        scheme: "PunksUpload",
        token: `mug1.1787703300000.${"A".repeat(43)}`,
      },
      endpoints: {
        partUrlTemplate: `/api/v1/workspaces/${workspaceId}/media-uploads/${uploadId}/parts/{partNumber}`,
        finalizeUrl: `/api/v1/workspaces/${workspaceId}/media-uploads/${uploadId}/finalize`,
        statusUrl: `/api/v1/workspaces/${workspaceId}/media-uploads/${uploadId}`,
        abandonUrl: `/api/v1/workspaces/${workspaceId}/media-uploads/${uploadId}`,
      },
      replayed: false,
    };
    expect(validates("punks://contracts/media-upload.grant@1", grant)).toBe(
      true,
    );
    expect(JSON.stringify(grant)).not.toMatch(
      /accessKey|secretAccessKey|sessionToken|cloudflarestorage|bucket/i,
    );
  });

  it("types safe part replay, finalization, abandonment and observable state", () => {
    expect(
      validates("punks://contracts/media-upload.part@1", {
        contract: "media-upload.part@1",
        uploadId,
        partNumber: 1,
        byteLength: 8_388_608,
        sha256: "b".repeat(64),
        replayed: false,
      }),
    ).toBe(true);

    for (const contract of [
      "media-upload.finalize@1",
      "media-upload.abandon@1",
    ]) {
      expect(
        validates(`punks://contracts/${contract}`, {
          contract,
          commandId,
          workspaceId,
          uploadId,
          actor: { kind: "punk", punkId },
        }),
      ).toBe(true);
    }

    expect(
      validates("punks://contracts/media-upload.status@1", uploadStatus()),
    ).toBe(true);
    expect(
      validates(
        "punks://contracts/media-upload.status@1",
        uploadStatus("candidate"),
      ),
    ).toBe(true);
    expect(
      validates("punks://contracts/media-upload.status@1", {
        ...uploadStatus("candidate"),
        candidate: null,
      }),
    ).toBe(false);
  });

  it("generates every upload contract for TypeScript, Rust, Dart and OpenAPI", () => {
    const contracts = new Map(
      registry.contracts.map((contract) => [contract.id, contract]),
    );
    for (const name of [
      "media-upload.grant-create@1",
      "media-upload.grant@1",
      "media-upload.part@1",
      "media-upload.finalize@1",
      "media-upload.abandon@1",
      "media-upload.status@1",
    ]) {
      expect(contracts.get(`punks://contracts/${name}`)).toMatchObject({
        generationTargets: ["typescript", "rust", "dart", "openapi"],
      });
    }
  });

  it("keeps attachment delivery unavailable until T18-B and T18-C", () => {
    expect(desktopProfile.capabilities).not.toContain("attachments");
    expect(
      desktopProfile.operations.some(
        ({ requestContract, responseContract }) =>
          requestContract?.startsWith("media-upload.") === true ||
          responseContract?.startsWith("media-upload.") === true,
      ),
    ).toBe(false);
  });
});
