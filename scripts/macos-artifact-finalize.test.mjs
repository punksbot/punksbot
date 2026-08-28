import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const finalizer = resolve("scripts/macos-artifact-finalize.sh");
const target = "aarch64-apple-darwin";
const appName = "Punks Bot Staging.app";
const updaterName = `${appName}.tar.gz`;

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function fakeCommand(logName, body = "") {
  return `#!/usr/bin/env bash
set -euo pipefail
printf '${logName}|%s\\n' "$*" >> "$PUNKS_TEST_LOG"
${body}
`;
}

function fixture({ notaryStatus = "Accepted", duplicateApp = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "punks-macos-finalize-test-"));
  const workspace = join(root, "workspace");
  const runner = join(root, "runner");
  const fakeBin = join(root, "bin");
  const sourceRoot = join(workspace, "desktop", "src-tauri");
  const bundle = join(sourceRoot, "target", target, "release", "bundle");
  const macos = join(bundle, "macos");
  const dmg = join(bundle, "dmg");
  const app = join(macos, appName);
  const updater = join(macos, updaterName);
  const signature = `${updater}.sig`;
  const diskImage = join(dmg, "Punks_Bot_Staging_0.6.0_aarch64.dmg");
  const log = join(root, "commands.log");
  const apiKey = join(runner, "AuthKey_FAKEKEY123.p8");

  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(sourceRoot, "icons"), { recursive: true });
  mkdirSync(join(bundle, "share", "create-dmg", "support"), {
    recursive: true,
  });
  mkdirSync(dmg, { recursive: true });
  mkdirSync(runner, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(app, "Contents", "MacOS", "punks-bot-staging"), "app");
  writeFileSync(updater, "old-updater");
  writeFileSync(signature, "old-signature");
  writeFileSync(diskImage, "old-dmg");
  writeFileSync(join(sourceRoot, "icons", "dmg-background.png"), "background");
  writeFileSync(join(dmg, "icon.icns"), "icon");
  writeFileSync(apiKey, "private-key");
  writeFileSync(log, "");

  if (duplicateApp) {
    mkdirSync(join(macos, "Unexpected.app"));
  }

  writeFileSync(
    join(sourceRoot, "tauri.punks.conf.json"),
    JSON.stringify({ productName: "Punks Bot Staging" }),
  );
  writeFileSync(
    join(sourceRoot, "tauri.conf.json"),
    JSON.stringify({
      bundle: {
        icon: ["icons/icon.icns"],
        macOS: {
          dmg: {
            background: "icons/dmg-background.png",
            windowSize: { width: 660, height: 532 },
            appPosition: { x: 191, y: 330 },
            applicationFolderPosition: { x: 469, y: 330 },
          },
        },
      },
    }),
  );

  writeExecutable(
    join(dmg, "bundle_dmg.sh"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'dmg-builder|%s\\n' "$*" >> "$PUNKS_TEST_LOG"
previous=''
before_previous=''
for argument in "$@"; do
  before_previous="$previous"
  previous="$argument"
done
test -f "$previous/Contents/.punks-stapled"
printf 'rebuilt-dmg' > "$before_previous"
`,
  );

  writeExecutable(
    join(fakeBin, "xcrun"),
    fakeCommand(
      "xcrun",
      `if [[ "$1 $2" = "notarytool submit" ]]; then
  printf '%s\\n' '{"id":"11111111-1111-4111-8111-111111111111"}'
elif [[ "$1 $2" = "notarytool wait" ]]; then
  printf '%s\\n' '{"id":"11111111-1111-4111-8111-111111111111","status":"${notaryStatus}"}'
elif [[ "$1 $2" = "stapler staple" ]]; then
  subject="$3"
  if [[ -d "$subject" ]]; then
    touch "$subject/Contents/.punks-stapled"
  else
    printf '%s' '::stapled::' >> "$subject"
  fi
elif [[ "$1 $2" = "stapler validate" ]]; then
  subject="$3"
  if [[ -d "$subject" ]]; then
    test -f "$subject/Contents/.punks-stapled"
  else
    grep -F '::stapled::' "$subject" > /dev/null
  fi
else
  exit 91
fi`,
    ),
  );
  writeExecutable(
    join(fakeBin, "ditto"),
    fakeCommand("ditto", `printf "zip" > "\${@: -1}"`),
  );
  writeExecutable(join(fakeBin, "codesign"), fakeCommand("codesign"));
  writeExecutable(
    join(fakeBin, "pnpm"),
    fakeCommand(
      "pnpm",
      `updater="\${@: -1}"; printf "new-signature" > "\${updater}.sig"`,
    ),
  );
  writeExecutable(
    join(fakeBin, "tar"),
    fakeCommand("tar", 'exec /usr/bin/tar "$@"'),
  );

  const environment = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    APPLE_API_ISSUER: "11111111-1111-4111-8111-111111111111",
    APPLE_API_KEY: "FAKEKEY123",
    APPLE_API_KEY_PATH: apiKey,
    APPLE_SIGNING_IDENTITY: "Developer ID Application: Punks Bot (TEAMID1234)",
    GITHUB_WORKSPACE: workspace,
    PUNKS_NOTARY_TIMEOUT: "7m",
    PUNKS_TEST_LOG: log,
    RUNNER_TEMP: runner,
    TARGET: target,
    TAURI_SIGNING_PRIVATE_KEY: "updater-private-key",
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "updater-password",
  };

  return {
    root,
    workspace,
    app,
    updater,
    signature,
    diskImage,
    log,
    environment,
  };
}

function run(subject) {
  return spawnSync("bash", [finalizer], {
    cwd: subject.workspace,
    env: subject.environment,
    encoding: "utf8",
  });
}

function cleanup(subject) {
  rmSync(subject.root, { recursive: true, force: true });
}

test("finalizes the stapled app before rebuilding and notarizing its updater and DMG", () => {
  const subject = fixture();
  try {
    const result = run(subject);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Finalized notarized macOS artifacts/);
    assert.equal(readFileSync(subject.signature, "utf8"), "new-signature");
    assert.equal(
      readFileSync(subject.diskImage, "utf8"),
      "rebuilt-dmg::stapled::",
    );

    const listing = spawnSync("/usr/bin/tar", ["-tzf", subject.updater], {
      encoding: "utf8",
    });
    assert.equal(listing.status, 0, listing.stderr);
    assert.match(
      listing.stdout,
      new RegExp(
        `${appName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/Contents/\\.punks-stapled`,
      ),
    );

    const calls = readFileSync(subject.log, "utf8").trim().split("\n");
    const appSubmit = calls.findIndex(
      (line) =>
        line.startsWith("xcrun|notarytool submit") && line.includes(".zip"),
    );
    const appStaple = calls.findIndex(
      (line) =>
        line.startsWith("xcrun|stapler staple") && line.endsWith(appName),
    );
    const archive = calls.findIndex((line) => line.startsWith("tar|-czf"));
    const signer = calls.findIndex((line) => line.startsWith("pnpm|--dir"));
    const dmgBuilder = calls.findIndex((line) =>
      line.startsWith("dmg-builder|"),
    );
    const dmgSubmit = calls.findIndex(
      (line) =>
        line.startsWith("xcrun|notarytool submit") && line.includes(".dmg"),
    );
    const appWait = calls.findIndex((line) =>
      line.startsWith("xcrun|notarytool wait"),
    );
    assert.ok(
      0 <= appSubmit &&
        appSubmit < appStaple &&
        appSubmit < appWait &&
        appWait < appStaple &&
        appStaple < archive &&
        archive < signer &&
        signer < dmgBuilder &&
        dmgBuilder < dmgSubmit,
      calls.join("\n"),
    );
    assert.equal(
      calls.filter(
        (line) =>
          line.startsWith("xcrun|notarytool wait") &&
          line.includes("--timeout 7m"),
      ).length,
      2,
    );
  } finally {
    cleanup(subject);
  }
});

test("stops before replacing artifacts when Apple does not accept the app", () => {
  const subject = fixture({ notaryStatus: "In Progress" });
  try {
    const result = run(subject);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ended with status In Progress/);
    assert.equal(readFileSync(subject.updater, "utf8"), "old-updater");
    assert.equal(readFileSync(subject.signature, "utf8"), "old-signature");
    const calls = readFileSync(subject.log, "utf8");
    assert.doesNotMatch(calls, /^tar\|/m);
    assert.doesNotMatch(calls, /^pnpm\|/m);
    assert.doesNotMatch(calls, /^dmg-builder\|/m);
  } finally {
    cleanup(subject);
  }
});

test("rejects ambiguous application bundles before invoking native tools", () => {
  const subject = fixture({ duplicateApp: true });
  try {
    const result = run(subject);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expected exactly one application bundle/);
    assert.equal(readFileSync(subject.log, "utf8"), "");
  } finally {
    cleanup(subject);
  }
});
