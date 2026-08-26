import { MATRICE_ACCESSIBILITE } from "../promotion-resilience-lib.mjs";
import { PLATEFORMES } from "../release-graph-lib.mjs";

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const REVIEWER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{1,198}[A-Za-z0-9])?$/u;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function fail(message) {
  throw new Error(`manual accessibility review rejected: ${message}`);
}

function exactKeys(value, expected, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !==
      JSON.stringify([...expected].sort())
  ) {
    fail(`${label} has an unexpected shape`);
  }
}

/**
 * Projects the manual observations for one leg only after the review proves
 * the exact candidate and complete four-artifact matrix.
 */
export function manualAccessibilityForPlatform(
  review,
  { candidateSha, platform, artifactSha256 },
) {
  exactKeys(
    review,
    ["schema", "candidateSha", "reviewer", "reviewedAt", "platforms"],
    "review",
  );
  if (
    review.schema !== "punks.manual-accessibility-review.v1" ||
    !SHA1.test(candidateSha ?? "") ||
    review.candidateSha !== candidateSha
  ) {
    fail("review belongs to another candidate");
  }
  if (
    typeof review.reviewer !== "string" ||
    !REVIEWER.test(review.reviewer) ||
    review.reviewer.length > 200
  ) {
    fail("reviewer identity is invalid");
  }
  if (
    typeof review.reviewedAt !== "string" ||
    !TIMESTAMP.test(review.reviewedAt) ||
    !Number.isFinite(Date.parse(review.reviewedAt))
  ) {
    fail("review timestamp is invalid");
  }
  exactKeys(review.platforms, PLATEFORMES, "four-platform review");
  for (const selectedPlatform of PLATEFORMES) {
    const selected = review.platforms[selectedPlatform];
    exactKeys(
      selected,
      ["artifactSha256", "criteria"],
      `review ${selectedPlatform}`,
    );
    if (!SHA256.test(selected.artifactSha256 ?? "")) {
      fail(`review ${selectedPlatform} artifact digest is invalid`);
    }
    exactKeys(
      selected.criteria,
      MATRICE_ACCESSIBILITE,
      `review ${selectedPlatform} matrix`,
    );
    for (const criterion of MATRICE_ACCESSIBILITE) {
      const observation = selected.criteria[criterion];
      if (
        typeof observation !== "string" ||
        observation.trim() !== observation ||
        observation.length === 0 ||
        observation.length > 500
      ) {
        fail(`review ${selectedPlatform} matrix ${criterion} is invalid`);
      }
    }
  }
  if (!PLATEFORMES.includes(platform)) fail("review platform is invalid");
  const selected = review.platforms[platform];
  if (selected.artifactSha256 !== artifactSha256) {
    fail(`review ${platform} belongs to another artifact`);
  }
  return Object.fromEntries(
    MATRICE_ACCESSIBILITE.map((criterion) => [
      criterion,
      [
        {
          tool: "independent-installed-artifact-review",
          reviewer: review.reviewer,
          observation: `${selected.criteria[criterion]} · reviewed ${review.reviewedAt}`,
        },
      ],
    ]),
  );
}
