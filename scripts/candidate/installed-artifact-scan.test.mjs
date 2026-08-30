import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildInstalledArtifactScan,
  run,
  validateInstalledArtifactScan,
} from "./installed-artifact-scan.mjs";

const PLATFORM = "linux-x64";
const SOURCE_SHA = "7e".repeat(20);
const previousProduct = String.fromCharCode(98, 117, 122, 122);

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "punks-installed-scan-"));
  const installedRoot = join(root, "installation");
  const nativeRoot = join(installedRoot, "usr", "bin");
  const resourceRoot = join(installedRoot, "usr", "lib", "punks-bot");
  mkdirSync(nativeRoot, { recursive: true });
  mkdirSync(resourceRoot, { recursive: true });
  const nativeBinary = join(nativeRoot, "punks-bot-staging");
  const installedArtifact = join(
    root,
    `punks-desktop-${PLATFORM}-${SOURCE_SHA}.AppImage`,
  );
  const embeddedAssets = join(root, "embedded-assets.json");
  const output = join(root, "artifact-scan.json");
  writeFileSync(nativeBinary, "isolated native executable\n");
  writeFileSync(
    join(resourceRoot, "desktop-entry.desktop"),
    "[Desktop Entry]\n",
  );
  symlinkSync("usr/bin/punks-bot-staging", join(installedRoot, "AppRun"));
  writeFileSync(installedArtifact, "signed updater artifact\n");
  writeFileSync(embeddedAssets, `${JSON.stringify(frontendProof())}\n`);
  return {
    root,
    installedRoot,
    nativeBinary,
    installedArtifact,
    embeddedAssets,
    output,
  };
}

function frontendProof() {
  const core = {
    schema: "punks.embedded-asset-manifest.v1",
    product: "punks-frontend",
    mode: "embedded-runtime",
    files: [
      { path: "assets/index.js", size: 31, sha256: "b".repeat(64) },
      { path: "index.html", size: 29, sha256: "a".repeat(64) },
    ],
    forbiddenMarkers: [],
  };
  return {
    ...core,
    sha256: sha256(
      Buffer.from(JSON.stringify({ schema: core.schema, files: core.files })),
    ),
  };
}

test("scans the exact updater, complete installation and embedded runtime assets", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  const scanned = [];
  const report = buildInstalledArtifactScan(
    {
      platform: PLATFORM,
      candidateSha: SOURCE_SHA,
      nativeBinary: input.nativeBinary,
      installedArtifact: input.installedArtifact,
      installedRoot: input.installedRoot,
      embeddedAssets: input.embeddedAssets,
      output: input.output,
    },
    {
      scanNative(path) {
        const content = readFileSync(path);
        scanned.push(path);
        return {
          name: path.split("/").at(-1),
          size: content.length,
          sha256: sha256(content),
        };
      },
    },
  );

  assert.deepEqual(
    scanned.map((path) => path.split("/").at(-1)),
    ["punks-bot-staging", `punks-desktop-${PLATFORM}-${SOURCE_SHA}.AppImage`],
  );
  assert.equal(report.artifact.sha256, sha256("signed updater artifact\n"));
  assert.equal(report.native.sha256, sha256("isolated native executable\n"));
  assert.deepEqual(report.frontend, frontendProof());
  assert.deepEqual(
    report.installation.files.map(({ path }) => path),
    ["usr/bin/punks-bot-staging", "usr/lib/punks-bot/desktop-entry.desktop"],
  );
  assert.equal(
    report.installation.files.find(
      ({ path }) => path === "usr/bin/punks-bot-staging",
    ).sha256,
    report.native.sha256,
  );
  assert.deepEqual(report.installation.links, [
    { path: "AppRun", target: "usr/bin/punks-bot-staging" },
  ]);
  assert.deepEqual(report.forbiddenMarkers, [
    `${previousProduct}-media`,
    "native_websocket",
    previousProduct,
    "nostr",
    "relay",
    "huddle",
  ]);
  assert.deepEqual(
    validateInstalledArtifactScan(
      JSON.parse(readFileSync(input.output, "utf8")),
      {
        platform: PLATFORM,
        candidateSha: SOURCE_SHA,
        artifactSha256: report.artifact.sha256,
      },
    ),
    report,
  );
});

test("rejects legacy bytes, existing output and any report/skip CLI", (t) => {
  const input = fixture();
  t.after(() => rmSync(input.root, { recursive: true, force: true }));
  writeFileSync(input.nativeBinary, `legacy ${previousProduct} runtime\n`);
  assert.throws(
    () =>
      buildInstalledArtifactScan({
        platform: PLATFORM,
        candidateSha: SOURCE_SHA,
        nativeBinary: input.nativeBinary,
        installedArtifact: input.installedArtifact,
        installedRoot: input.installedRoot,
        embeddedAssets: input.embeddedAssets,
        output: input.output,
      }),
    new RegExp(`forbidden marker ${previousProduct}`, "i"),
  );

  assert.throws(
    () =>
      run([
        "--platform",
        PLATFORM,
        "--source-sha",
        SOURCE_SHA,
        "--native-binary",
        input.nativeBinary,
        "--installed-artifact",
        input.installedArtifact,
        "--installed-root",
        input.installedRoot,
        "--embedded-assets",
        input.embeddedAssets,
        "--output",
        input.output,
        "--report",
        "forged.json",
      ]),
    /exact installed artifact scan CLI arguments/i,
  );
});
