import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  canonicalJson,
  CANONICAL_STAGING_ACCOUNT_ID,
  CANONICAL_STAGING_WORKER_NAMES,
  sourceShaAnnotation,
  STAGING_DEPLOYMENT_PROOF_SCHEMA,
} from "../../cloudflare/scripts/staging-deployment-proof.mjs";
import { PREUVES_RECUPERATION } from "../promotion-resilience-lib.mjs";
import { aggregateCandidate, collectPlatformLeg, run } from "./artifacts.mjs";
import { assignedResilienceScenarios } from "./resilience-observation.mjs";

const SOURCE_SHA = "a".repeat(40);
const STAGING_PROOF_MATERIAL = {
  schema: STAGING_DEPLOYMENT_PROOF_SCHEMA,
  accountId: CANONICAL_STAGING_ACCOUNT_ID,
  environment: "staging",
  sourceSha: SOURCE_SHA,
  observer: "cloudflare-remote",
  workers: CANONICAL_STAGING_WORKER_NAMES.map((name, index) => ({
    name,
    versionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sourceShaAnnotation: sourceShaAnnotation(SOURCE_SHA),
    deploymentId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  })),
};
const DEPLOYMENT_ID = `sha256:${createHash("sha256")
  .update(canonicalJson(STAGING_PROOF_MATERIAL), "utf8")
  .digest("hex")}`;
const AUTHORITIES = JSON.parse(
  readFileSync(
    new URL("../../cloudflare/promotion-profiles.json", import.meta.url),
    "utf8",
  ),
).profiles[0].authorities.map(({ id }) => id);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}
const REPOSITORY = "mabzadev/punksbot";
const SOURCE_REF = "refs/heads/main";
const SIGNER_WORKFLOW =
  "github.com/mabzadev/punksbot/.github/workflows/punks-desktop-candidate.yml";
const TARGETS = {
  "macos-arm64": "aarch64-apple-darwin",
  "macos-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "windows-x64": "x86_64-pc-windows-msvc",
};

function write(path, content = "signed artifact\n") {
  writeFileSync(path, content, { flag: "wx" });
}

function createBundle(root, platform) {
  const bundle = join(root, "bundle-" + platform);
  if (platform.startsWith("macos-")) {
    mkdirSync(join(bundle, "macos", "Punks Bot.app"), { recursive: true });
    mkdirSync(join(bundle, "dmg"), { recursive: true });
    write(join(bundle, "macos", "Punks Bot.app.tar.gz"));
    write(join(bundle, "macos", "Punks Bot.app.tar.gz.sig"), "minisign\n");
    write(join(bundle, "dmg", "Punks Bot.dmg"));
  } else if (platform === "linux-x64") {
    mkdirSync(join(bundle, "appimage"), { recursive: true });
    mkdirSync(join(bundle, "deb"), { recursive: true });
    write(join(bundle, "appimage", "Punks Bot.AppImage"));
    write(join(bundle, "appimage", "Punks Bot.AppImage.sig"), "minisign\n");
    write(join(bundle, "deb", "punks-bot.deb"));
    write(join(bundle, "deb", "punks-bot.deb.asc"), "gpg\n");
  } else {
    mkdirSync(join(bundle, "nsis"), { recursive: true });
    mkdirSync(join(bundle, "msi"), { recursive: true });
    write(join(bundle, "nsis", "Punks Bot-setup.exe"));
    write(join(bundle, "nsis", "Punks Bot-setup.exe.sig"), "minisign\n");
    write(join(bundle, "msi", "Punks Bot.msi"));
    write(join(bundle, "msi", "Punks Bot.msi.sig"), "minisign\n");
  }
  return bundle;
}

function nativeProof(platform) {
  if (platform.startsWith("macos-")) {
    return {
      schema: "punks.desktop-native-proof.v1",
      platform,
      verified: true,
      identity: "Developer ID Application: Punks Bot (ABCDEFGHIJ)",
      teamId: "ABCDEFGHIJ",
      timestamped: true,
      notarized: true,
    };
  }
  if (platform === "windows-x64") {
    return {
      schema: "punks.desktop-native-proof.v1",
      platform,
      verified: true,
      identity: "CN=Punks Bot",
      thumbprint: "A".repeat(40),
      timestamped: true,
    };
  }
  return {
    schema: "punks.desktop-native-proof.v1",
    platform,
    verified: true,
    identity: "679E2A9FF88BDB4E33E2CACFD9C8C48D021DCFDB",
    timestamped: false,
    embeddedAppImageSignature: true,
    detachedDebSignature: true,
  };
}

function createInstalledEvidence(root, platform, withRecovery = false) {
  const evidence = join(root, `evidence-${platform}`);
  const shaRoot = join(evidence, "sha256");
  mkdirSync(shaRoot, { recursive: true });
  const subjectContent = Buffer.from(`transcript:${platform}\n`);
  const subjectSha256 = createHash("sha256")
    .update(subjectContent)
    .digest("hex");
  const subjectPath = `sha256/${subjectSha256}-driver-transcript.json`;
  write(join(evidence, subjectPath), subjectContent);
  const proof = {
    schema: "punks.promotion-proof.v1",
    id: `transcript/${platform}`,
    candidateSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    result: "vert",
    plateforme: platform,
    data: {
      subjectSha256,
      schema: "punks.installed-social-loop-transcript.v1",
    },
  };
  const proofContent = Buffer.from(`${JSON.stringify(proof)}\n`);
  const proofSha256 = createHash("sha256").update(proofContent).digest("hex");
  const proofPath = `sha256/${proofSha256}-transcript-${platform}.json`;
  write(join(evidence, proofPath), proofContent);
  const references = [
    {
      id: proof.id,
      chemin: proofPath,
      sha256: proofSha256,
      sujet: { chemin: subjectPath, sha256: subjectSha256 },
    },
  ];
  if (withRecovery) {
    const add = (id, data, subject) => {
      const digest = sha256(subject);
      const safe = id.replaceAll(/[^a-z0-9.-]/giu, "-");
      const observedPath = `sha256/${digest}-${safe}-subject.json`;
      write(join(evidence, observedPath), subject);
      const document = Buffer.from(
        `${JSON.stringify({
          schema: "punks.promotion-proof.v1",
          id,
          candidateSha: SOURCE_SHA,
          stagingDeploymentId: DEPLOYMENT_ID,
          result: "vert",
          plateforme: platform,
          data: { ...data, subjectSha256: digest },
        })}\n`,
      );
      const documentDigest = sha256(document);
      const documentPath = `sha256/${documentDigest}-${safe}.json`;
      write(join(evidence, documentPath), document);
      const reference = {
        id,
        chemin: documentPath,
        sha256: documentDigest,
        sujet: { chemin: observedPath, sha256: digest },
      };
      references.push(reference);
      return reference;
    };
    for (const { type, authority } of assignedResilienceScenarios(
      platform,
      AUTHORITIES,
    )) {
      const capture = Buffer.from(`fault:${type}:${platform}:${authority}\n`);
      const fault = add(
        `faute/${type}/${authority}`,
        {
          autorite: authority,
          plateforme: platform,
          executionId: `fault-${type}-${platform}-${authority}`,
          sha256Artefact: "aa".repeat(32),
          transcriptSha256: subjectSha256,
          captureSha256: sha256(capture),
        },
        capture,
      );
      for (const recovery of PREUVES_RECUPERATION) {
        const observed = Buffer.from(
          `recovery:${recovery}:${type}:${platform}:${authority}\n`,
        );
        add(
          `recuperation/${recovery}/${type}/${authority}`,
          {
            type,
            autorite: authority,
            plateforme: platform,
            executionId: `fault-${type}-${platform}-${authority}`,
            fauteSha256: fault.sha256,
            sha256Artefact: "aa".repeat(32),
            captureSha256: sha256(capture),
          },
          observed,
        );
      }
    }
  }
  write(
    join(evidence, "index.json"),
    `${JSON.stringify({
      schema: "punks.promotion-evidence-index.v1",
      preuves: references,
    })}\n`,
  );
  const networkProof = join(evidence, "network-proof.json");
  write(
    networkProof,
    `${JSON.stringify({
      schema: "punks.installed-network-proof.v1",
      platform,
      candidateSha: SOURCE_SHA,
      stagingDeploymentId: DEPLOYMENT_ID,
      transcriptSha256: subjectSha256,
      network: { requests: [] },
    })}\n`,
  );
  return { evidence, networkProof };
}

function sigstoreBundle() {
  return {
    mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
    dsseEnvelope: {
      payload: Buffer.from("{}").toString("base64"),
      signatures: [{ keyid: "", sig: "ZmFrZQ==" }],
    },
    verificationMaterial: {
      certificate: { rawBytes: "ZmFrZQ==" },
      tlogEntries: [],
    },
  };
}

function createFakeGh(root, succeeds = true) {
  const path = join(root, succeeds ? "gh-success" : "gh-failure");
  write(
    path,
    [
      "#!/usr/bin/env node",
      succeeds
        ? "process.stdout.write(JSON.stringify([{ verificationResult: { verified: true } }]));"
        : 'process.stderr.write("verification rejected\\n"); process.exit(1);',
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o700);
  return path;
}

function createOutputRacingFakeGh(root, output) {
  const path = join(root, "gh-output-racing");
  write(
    path,
    [
      "#!/usr/bin/env node",
      'const { existsSync, mkdirSync, writeFileSync } = require("node:fs");',
      `const output = ${JSON.stringify(output)};`,
      'if (!existsSync(output)) { mkdirSync(output); writeFileSync(output + "/foreign.txt", "concurrent owner\\n"); }',
      "process.stdout.write(JSON.stringify([{ verificationResult: { verified: true } }]));",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o700);
  return path;
}

function fileSha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function createRacingFakeGh(root, input) {
  const expectedSubjects = new Set();
  const expectedBundles = new Set();
  for (const platform of Object.keys(TARGETS)) {
    const platformRoot = join(input, platform);
    const manifestPath = join(platformRoot, "platform-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    expectedSubjects.add(fileSha256(manifestPath));
    expectedSubjects.add(fileSha256(join(platformRoot, "native-proof.json")));
    expectedSubjects.add(
      fileSha256(join(platformRoot, "evidence", "index.json")),
    );
    expectedSubjects.add(
      fileSha256(join(platformRoot, "evidence", "network-proof.json")),
    );
    for (const evidence of manifest.installedEvidence.files) {
      expectedSubjects.add(fileSha256(join(platformRoot, evidence.path)));
    }
    for (const artifact of manifest.artifacts) {
      expectedSubjects.add(fileSha256(join(platformRoot, artifact.path)));
    }
    expectedBundles.add(
      fileSha256(join(platformRoot, "provenance.sigstore.json")),
    );
  }

  const firstRoot = join(input, "macos-arm64");
  const firstManifestPath = join(firstRoot, "platform-manifest.json");
  const firstManifest = JSON.parse(readFileSync(firstManifestPath, "utf8"));
  const firstArtifactPath = join(firstRoot, firstManifest.artifacts[0].path);
  const firstBundlePath = join(firstRoot, "provenance.sigstore.json");
  const marker = join(root, "race-triggered");
  const path = join(root, "gh-racing");
  write(
    path,
    [
      "#!/usr/bin/env node",
      'const { createHash } = require("node:crypto");',
      'const { existsSync, readFileSync, writeFileSync } = require("node:fs");',
      `const marker = ${JSON.stringify(marker)};`,
      `const originals = ${JSON.stringify([firstManifestPath, firstArtifactPath, firstBundlePath])};`,
      `const expectedSubjects = new Set(${JSON.stringify([...expectedSubjects])});`,
      `const expectedBundles = new Set(${JSON.stringify([...expectedBundles])});`,
      'const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");',
      "const valueAfter = (name) => process.argv[process.argv.indexOf(name) + 1];",
      'if (!existsSync(marker)) { for (const original of originals) writeFileSync(original, "replaced during gh verification\\n"); writeFileSync(marker, "done\\n"); }',
      'const artifact = process.argv[process.argv.indexOf("verify") + 1];',
      'const bundle = valueAfter("--bundle");',
      'if (!expectedSubjects.has(digest(artifact)) || !expectedBundles.has(digest(bundle))) { process.stderr.write("gh reopened replaced bytes\\n"); process.exit(1); }',
      "process.stdout.write(JSON.stringify([{ verificationResult: { verified: true } }]));",
      "",
    ].join("\n"),
  );
  chmodSync(path, 0o700);
  return { path, firstArtifactPath, firstManifest };
}

function collectLeg(root, platform, withRecovery = false) {
  const proofPath = join(root, "proof-" + platform + ".json");
  write(proofPath, JSON.stringify(nativeProof(platform)));
  const output = join(root, "collected-" + platform);
  const installed = createInstalledEvidence(root, platform, withRecovery);
  const manifest = collectPlatformLeg({
    platform,
    target: TARGETS[platform],
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    bundle: createBundle(root, platform),
    nativeProof: proofPath,
    installedProof: installed.evidence,
    networkProof: installed.networkProof,
    output,
  });
  return { manifest, output };
}

function createAggregateFixture(root, withRecovery = false) {
  const input = join(root, "legs");
  mkdirSync(input);
  for (const platform of Object.keys(TARGETS)) {
    const { output } = collectLeg(root, platform, withRecovery);
    cpSync(join(output, platform), join(input, platform), {
      recursive: true,
      errorOnExist: true,
    });
    write(
      join(input, platform, "provenance.sigstore.json"),
      JSON.stringify(sigstoreBundle()),
    );
  }
  const output = join(root, "candidate");
  return { input, output };
}

function aggregateOptions(root, overrides = {}, withRecovery = false) {
  const fixture = createAggregateFixture(root, withRecovery);
  const stagingProof = join(root, "staging-deployment-proof.json");
  write(
    stagingProof,
    JSON.stringify({ ...STAGING_PROOF_MATERIAL, deploymentId: DEPLOYMENT_ID }),
  );
  return {
    ...fixture,
    stagingProof,
    sourceSha: SOURCE_SHA,
    stagingDeploymentId: DEPLOYMENT_ID,
    repository: REPOSITORY,
    releaseTag: "punks-staging-" + SOURCE_SHA,
    sourceRef: SOURCE_REF,
    signerWorkflow: SIGNER_WORKFLOW,
    ghBinary: createFakeGh(root),
    ...overrides,
  };
}

test("collect closes each platform layout and hashes every copied artifact", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-collect-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));

  for (const platform of Object.keys(TARGETS)) {
    const { manifest, output } = collectLeg(root, platform);
    assert.equal(manifest.platform, platform);
    assert.equal(manifest.sourceSha, SOURCE_SHA);
    assert.equal(manifest.stagingDeploymentId, DEPLOYMENT_ID);
    assert.ok(manifest.artifacts.length >= 3);
    assert.match(manifest.installedEvidence.index.sha256, /^[0-9a-f]{64}$/);
    assert.match(manifest.installedEvidence.network.sha256, /^[0-9a-f]{64}$/);
    assert.ok(
      readFileSync(
        join(output, platform, manifest.installedEvidence.index.path),
      ).length > 0,
    );
    for (const artifact of manifest.artifacts) {
      assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
      assert.ok(artifact.name.includes(SOURCE_SHA));
      assert.ok(readFileSync(join(output, platform, artifact.path)).length > 0);
    }
  }
});

test("collect rejects extra layout entries, identity mismatch and existing output", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-collect-closed-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const platform = "linux-x64";
  const bundle = createBundle(root, platform);
  write(join(bundle, "appimage", "unexpected.txt"));
  const proofPath = join(root, "proof.json");
  const installed = createInstalledEvidence(root, platform);
  write(proofPath, JSON.stringify(nativeProof(platform)));

  assert.throws(
    () =>
      collectPlatformLeg({
        platform,
        target: TARGETS[platform],
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        bundle,
        nativeProof: proofPath,
        installedProof: installed.evidence,
        networkProof: installed.networkProof,
        output: join(root, "output"),
      }),
    /Unexpected artifact layout/,
  );
  assert.throws(
    () =>
      collectPlatformLeg({
        platform,
        target: "aarch64-apple-darwin",
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        bundle,
        nativeProof: proofPath,
        installedProof: installed.evidence,
        networkProof: installed.networkProof,
        output: join(root, "wrong-target"),
      }),
    /do not match/,
  );
  assert.throws(
    () =>
      collectPlatformLeg({
        platform,
        target: TARGETS[platform],
        sourceSha: "not-a-sha",
        stagingDeploymentId: DEPLOYMENT_ID,
        bundle,
        nativeProof: proofPath,
        installedProof: installed.evidence,
        networkProof: installed.networkProof,
        output: join(root, "wrong-source"),
      }),
    /40 lowercase hex/,
  );
  assert.throws(
    () =>
      collectPlatformLeg({
        platform,
        target: TARGETS[platform],
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: "sha256:bad",
        bundle,
        nativeProof: proofPath,
        installedProof: installed.evidence,
        networkProof: installed.networkProof,
        output: join(root, "wrong-deployment"),
      }),
    /deployment ID/,
  );

  const validRoot = mkdtempSync(join(tmpdir(), "punks-create-only-"));
  context.after(() => rmSync(validRoot, { force: true, recursive: true }));
  const collected = collectLeg(validRoot, "macos-arm64");
  const secondInput = join(validRoot, "second-input");
  mkdirSync(secondInput);
  const secondEvidence = createInstalledEvidence(secondInput, "macos-arm64");
  assert.throws(
    () =>
      collectPlatformLeg({
        platform: "macos-arm64",
        target: TARGETS["macos-arm64"],
        sourceSha: SOURCE_SHA,
        stagingDeploymentId: DEPLOYMENT_ID,
        bundle: createBundle(secondInput, "macos-arm64"),
        nativeProof: join(validRoot, "proof-macos-arm64.json"),
        installedProof: secondEvidence.evidence,
        networkProof: secondEvidence.networkProof,
        output: collected.output,
      }),
    /already exists/,
  );
});

test("collect refuses a destination created after validation without touching its contents", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-collect-output-race-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const platform = "linux-x64";
  const proofPath = join(root, "proof.json");
  const output = join(root, "candidate-leg");
  write(proofPath, JSON.stringify(nativeProof(platform)));

  assert.throws(
    () =>
      collectPlatformLeg(
        {
          platform,
          target: TARGETS[platform],
          sourceSha: SOURCE_SHA,
          stagingDeploymentId: DEPLOYMENT_ID,
          bundle: createBundle(root, platform),
          nativeProof: proofPath,
          installedProof: createInstalledEvidence(root, platform).evidence,
          networkProof: join(
            root,
            `evidence-${platform}`,
            "network-proof.json",
          ),
          output,
        },
        {
          beforeOutputCreate() {
            mkdirSync(output);
            write(join(output, "foreign.txt"), "concurrent owner\n");
          },
        },
      ),
    /already exists/,
  );
  assert.equal(
    readFileSync(join(output, "foreign.txt"), "utf8"),
    "concurrent owner\n",
  );
  assert.deepEqual(readdirSync(output), ["foreign.txt"]);
});

test("aggregate verifies four Sigstore legs and prepares immutable latest.json", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-aggregate-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const options = aggregateOptions(root);
  const { aggregate, latest } = aggregateCandidate(options);

  assert.equal(aggregate.platforms.length, 4);
  assert.equal(aggregate.stagingDeploymentId, DEPLOYMENT_ID);
  assert.match(aggregate.stagingProof.sha256, /^[0-9a-f]{64}$/);
  assert.match(
    aggregate.promotionEvidence.platformIndex.sha256,
    /^[0-9a-f]{64}$/,
  );
  assert.equal(aggregate.promotionEvidence.network.length, 4);
  const platformIndex = JSON.parse(
    readFileSync(
      join(options.output, aggregate.promotionEvidence.platformIndex.path),
      "utf8",
    ),
  );
  assert.equal(platformIndex.schema, "punks.promotion-evidence-index.v1");
  assert.deepEqual(
    platformIndex.preuves.map(({ id }) => id).sort(),
    Object.keys(TARGETS)
      .map((platform) => `transcript/${platform}`)
      .sort(),
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(options.output, "staging-deployment-proof.json"),
        "utf8",
      ),
    ),
    { ...STAGING_PROOF_MATERIAL, deploymentId: DEPLOYMENT_ID },
  );
  assert.deepEqual(Object.keys(latest.platforms).sort(), [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
  ]);
  for (const platform of Object.values(latest.platforms)) {
    assert.match(
      platform.url,
      new RegExp("/punks-staging-" + SOURCE_SHA + "/"),
    );
    assert.doesNotMatch(platform.url, /\/latest\//);
    assert.ok(platform.signature.length > 0);
  }
  assert.equal(
    readFileSync(join(options.output, "release-assets", "latest.json"), "utf8"),
    readFileSync(
      join(options.output, "release-assets", "latest-" + SOURCE_SHA + ".json"),
      "utf8",
    ),
  );
  assert.throws(() => aggregateCandidate(options), /already exists/);
});

test("aggregate separates observed recovery proofs and closes their captures", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-aggregate-recovery-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const options = aggregateOptions(root, {}, true);

  aggregateCandidate(options);

  const recovery = JSON.parse(
    readFileSync(
      join(options.output, "promotion-evidence", "recovery-index.json"),
      "utf8",
    ),
  );
  const ids = recovery.preuves.map(({ id }) => id);
  assert.equal(
    ids.filter((id) => id.startsWith("faute/")).length,
    AUTHORITIES.length * 3,
  );
  assert.equal(
    ids.filter((id) => id.startsWith("recuperation/")).length,
    AUTHORITIES.length * 3 * PREUVES_RECUPERATION.length + 1,
  );
  assert.ok(ids.includes("recuperation/captures"));
  assert.ok(ids.includes("gate/fautes-injectees"));

  const platform = JSON.parse(
    readFileSync(
      join(options.output, "promotion-evidence", "platform-index.json"),
      "utf8",
    ),
  );
  assert.equal(
    platform.preuves.some(
      ({ id }) => id.startsWith("faute/") || id.startsWith("recuperation/"),
    ),
    false,
  );
});

test("aggregate verifies and copies the exact bytes read before gh can replace inputs", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-aggregate-race-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const options = aggregateOptions(root);
  const racing = createRacingFakeGh(root, options.input);
  const selected = racing.firstManifest.artifacts[0];
  const expectedContent = readFileSync(racing.firstArtifactPath);
  options.ghBinary = racing.path;

  const { aggregate } = aggregateCandidate(options);

  assert.equal(
    fileSha256(join(options.output, "release-assets", selected.name)),
    createHash("sha256").update(expectedContent).digest("hex"),
  );
  assert.equal(
    aggregate.releaseAssets.find(({ name }) => name === selected.name).sha256,
    createHash("sha256").update(expectedContent).digest("hex"),
  );
});

test("aggregate rejects a forged or mismatched staging deployment proof", (context) => {
  for (const mutation of ["digest", "source", "symlink"]) {
    const root = mkdtempSync(
      join(tmpdir(), `punks-staging-proof-${mutation}-`),
    );
    context.after(() => rmSync(root, { force: true, recursive: true }));
    const options = aggregateOptions(root);
    if (mutation === "digest") {
      const proof = JSON.parse(readFileSync(options.stagingProof, "utf8"));
      proof.deploymentId = `sha256:${"0".repeat(64)}`;
      writeFileSync(options.stagingProof, JSON.stringify(proof));
    } else if (mutation === "source") {
      const proof = JSON.parse(readFileSync(options.stagingProof, "utf8"));
      proof.sourceSha = "c".repeat(40);
      writeFileSync(options.stagingProof, JSON.stringify(proof));
    } else {
      const target = options.stagingProof;
      const link = join(root, "staging-proof-link.json");
      symlinkSync(target, link);
      options.stagingProof = link;
    }
    assert.throws(
      () => aggregateCandidate(options),
      /proof|identity|digest|regular file/,
      mutation,
    );
  }
});

test("aggregate output is create-only even when the directory is empty", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-aggregate-create-only-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const options = aggregateOptions(root);
  mkdirSync(options.output);

  assert.throws(
    () => aggregateCandidate(options),
    /Candidate aggregate output already exists/,
  );
});

test("aggregate refuses a destination created during verification without accepting foreign contents", (context) => {
  const root = mkdtempSync(join(tmpdir(), "punks-aggregate-output-race-"));
  context.after(() => rmSync(root, { force: true, recursive: true }));
  const options = aggregateOptions(root);
  options.ghBinary = createOutputRacingFakeGh(root, options.output);

  assert.throws(
    () => aggregateCandidate(options),
    /Candidate aggregate output already exists/,
  );
  assert.equal(
    readFileSync(join(options.output, "foreign.txt"), "utf8"),
    "concurrent owner\n",
  );
  assert.deepEqual(readdirSync(options.output), ["foreign.txt"]);
});

test("aggregate rejects self-declared provenance and failed GitHub verification", (context) => {
  const selfDeclaredRoot = mkdtempSync(join(tmpdir(), "punks-self-declared-"));
  context.after(() =>
    rmSync(selfDeclaredRoot, { force: true, recursive: true }),
  );
  const selfDeclared = aggregateOptions(selfDeclaredRoot);
  writeFileSync(
    join(selfDeclared.input, "linux-x64", "provenance.sigstore.json"),
    JSON.stringify({ verified: true }),
  );
  assert.throws(
    () => aggregateCandidate(selfDeclared),
    /not a Sigstore bundle/,
  );

  const failedRoot = mkdtempSync(join(tmpdir(), "punks-gh-failure-"));
  context.after(() => rmSync(failedRoot, { force: true, recursive: true }));
  const failed = aggregateOptions(failedRoot);
  failed.ghBinary = createFakeGh(failedRoot, false);
  assert.throws(
    () => aggregateCandidate(failed),
    /GitHub attestation verification failed/,
  );
});

test("the real artifact CLI exposes no verifier binary or unknown option", () => {
  assert.throws(
    () => run(["aggregate", "--gh-binary", "/tmp/faux-gh"]),
    /unknown option --gh-binary/i,
  );
  assert.throws(
    () => run(["collect", "--inconnue", "valeur"]),
    /unknown option --inconnue/i,
  );
});

test("aggregate rejects hash, source, deployment and duplicate-coordinate mutations", (context) => {
  for (const mutation of ["hash", "source", "deployment", "duplicate"]) {
    const root = mkdtempSync(
      join(tmpdir(), "punks-mutation-" + mutation + "-"),
    );
    context.after(() => rmSync(root, { force: true, recursive: true }));
    const options = aggregateOptions(root);
    const platformRoot = join(options.input, "windows-x64");
    const manifestPath = join(platformRoot, "platform-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (mutation === "hash") {
      writeFileSync(
        join(platformRoot, manifest.artifacts[0].path),
        "tampered\n",
      );
    } else if (mutation === "source") {
      manifest.sourceSha = "c".repeat(40);
      writeFileSync(manifestPath, JSON.stringify(manifest));
    } else if (mutation === "deployment") {
      manifest.stagingDeploymentId = "sha256:" + "d".repeat(64);
      writeFileSync(manifestPath, JSON.stringify(manifest));
    } else {
      manifest.artifacts.push({ ...manifest.artifacts[0] });
      writeFileSync(manifestPath, JSON.stringify(manifest));
    }

    assert.throws(
      () => aggregateCandidate(options),
      /mismatch|duplicate|Invalid platform manifest/,
      mutation,
    );
  }
});
