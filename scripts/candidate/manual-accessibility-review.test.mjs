import assert from "node:assert/strict";
import test from "node:test";

import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { manualAccessibilityForPlatform } from "./manual-accessibility-review.mjs";

const SOURCE_SHA = "ab".repeat(20);
const PLATFORMS = ["macos-arm64", "macos-x64", "linux-x64", "windows-x64"];

function review() {
  return {
    schema: "punks.manual-accessibility-review.v1",
    candidateSha: SOURCE_SHA,
    reviewer: "codex-independent-review",
    reviewedAt: "2026-08-26T16:00:00.000Z",
    platforms: Object.fromEntries(
      PLATFORMS.map((platform, index) => [
        platform,
        {
          artifactSha256: String(index + 1).repeat(64),
          criteria: Object.fromEntries(
            MATRICE_ACCESSIBILITE.map((criterion) => [
              criterion,
              `${criterion} reviewed on ${platform}`,
            ]),
          ),
        },
      ]),
    ),
  };
}

test("projects one independent review bound to all four exact artifacts", () => {
  const value = review();
  const manual = manualAccessibilityForPlatform(value, {
    candidateSha: SOURCE_SHA,
    platform: "linux-x64",
    artifactSha256: "3".repeat(64),
  });
  assert.deepEqual(
    Object.keys(manual).sort(),
    [...MATRICE_ACCESSIBILITE].sort(),
  );
  assert.deepEqual(manual.clavier, [
    {
      tool: "independent-installed-artifact-review",
      reviewer: "codex-independent-review",
      observation:
        "clavier reviewed on linux-x64 · reviewed 2026-08-26T16:00:00.000Z",
    },
  ]);
});

test("rejects another source, artifact, incomplete matrix or unbounded reviewer", () => {
  const wrongSource = review();
  wrongSource.candidateSha = "cd".repeat(20);
  assert.throws(
    () =>
      manualAccessibilityForPlatform(wrongSource, {
        candidateSha: SOURCE_SHA,
        platform: "linux-x64",
        artifactSha256: "3".repeat(64),
      }),
    /candidate/i,
  );

  const wrongArtifact = review();
  assert.throws(
    () =>
      manualAccessibilityForPlatform(wrongArtifact, {
        candidateSha: SOURCE_SHA,
        platform: "linux-x64",
        artifactSha256: "f".repeat(64),
      }),
    /artifact/i,
  );

  const incomplete = review();
  delete incomplete.platforms["windows-x64"].criteria.focus;
  assert.throws(
    () =>
      manualAccessibilityForPlatform(incomplete, {
        candidateSha: SOURCE_SHA,
        platform: "linux-x64",
        artifactSha256: "3".repeat(64),
      }),
    /matrix/i,
  );

  const reviewer = review();
  reviewer.reviewer = "x".repeat(201);
  assert.throws(
    () =>
      manualAccessibilityForPlatform(reviewer, {
        candidateSha: SOURCE_SHA,
        platform: "linux-x64",
        artifactSha256: "3".repeat(64),
      }),
    /reviewer/i,
  );
});
