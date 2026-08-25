import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import YAML from "yaml";

const workflowPath = resolve(".github/workflows/punks-desktop-candidate.yml");
const windowsSignerPath = resolve("scripts/windows-artifact-sign.ps1");
const windowsSignerTestPath = resolve("scripts/windows-artifact-sign.test.ps1");
const windowsSigningConfigPath = resolve(
  "desktop/src-tauri/tauri.punks.windows-signing.conf.json",
);
const expectedMatrix = [
  {
    platform: "macos-arm64",
    runner: "macos-15",
    target: "aarch64-apple-darwin",
    bundles: "app,dmg",
  },
  {
    platform: "macos-x64",
    runner: "macos-15-intel",
    target: "x86_64-apple-darwin",
    bundles: "app,dmg",
  },
  {
    platform: "linux-x64",
    runner: "ubuntu-24.04",
    target: "x86_64-unknown-linux-gnu",
    bundles: "appimage,deb",
  },
  {
    platform: "windows-x64",
    runner: "windows-2025",
    target: "x86_64-pc-windows-msvc",
    bundles: "nsis,msi",
  },
];
const appleMatrix = expectedMatrix.slice(0, 2);
const expectedPlatforms = expectedMatrix.map(({ platform }) => platform);
const applePlatforms = appleMatrix.map(({ platform }) => platform);
const expectedJobs = [
  "aggregate",
  "attest_candidate",
  "attest_legs",
  "build",
  "gates",
  "preflight",
  "verify_staging",
];
const readPermissions = { contents: "read" };
const buildPermissions = { contents: "read", "id-token": "write" };
const attestPermissions = {
  "artifact-metadata": "write",
  contents: "read",
  attestations: "write",
  "id-token": "write",
};
const publishPermissions = {
  "artifact-metadata": "write",
  contents: "write",
  attestations: "write",
  "id-token": "write",
};
const artifactSigningAction =
  "azure/artifact-signing-action@c7ab2a863ab5f9a846ddb8265964877ef296ee82";
const azureLoginAction = "azure/login@f5d393ae46f8fde4be8b75f32e3fc50e654ad0ca";
const allowedSecretSteps = {
  PUNKS_CLOUDFLARE_API_TOKEN: ["verify_staging/observe_staging"],
  PUNKS_APPLE_CERTIFICATE: ["build/import_apple"],
  PUNKS_APPLE_CERTIFICATE_PASSWORD: ["build/import_apple"],
  PUNKS_APPLE_API_ISSUER: ["build/build_macos"],
  PUNKS_APPLE_API_KEY: ["build/build_macos"],
  PUNKS_APPLE_API_PRIVATE_KEY: ["build/build_macos"],
  PUNKS_AZURE_TENANT_ID: ["build/azure_login"],
  PUNKS_AZURE_CLIENT_ID: ["build/azure_login"],
  PUNKS_AZURE_SUBSCRIPTION_ID: ["build/azure_login"],
  PUNKS_LINUX_GPG_PRIVATE_KEY: ["build/import_linux"],
  PUNKS_LINUX_GPG_PASSPHRASE: ["build/build_linux", "build/verify_linux"],
  PUNKS_TAURI_SIGNING_PRIVATE_KEY: [
    "build/build_macos",
    "build/build_linux",
    "build/refresh_windows_updater",
  ],
  PUNKS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD: [
    "build/build_macos",
    "build/build_linux",
    "build/refresh_windows_updater",
  ],
};

function workflowExpression(name) {
  return ["$", "{{ ", name, " }}"].join("");
}

const buildMatrixExpression = workflowExpression(
  `fromJSON(inputs.validation_scope == 'apple-only' && '${JSON.stringify(appleMatrix)}' || '${JSON.stringify(expectedMatrix)}')`,
);
const attestMatrixExpression = workflowExpression(
  `fromJSON(inputs.validation_scope == 'apple-only' && '${JSON.stringify(applePlatforms)}' || '${JSON.stringify(expectedPlatforms)}')`,
);

const githubShaExpression = workflowExpression("github.sha");
const githubTokenExpression = workflowExpression("github.token");
const sourceShaExpression = workflowExpression("inputs.source_sha");
const appleCertificateExpression = workflowExpression(
  "secrets.PUNKS_APPLE_CERTIFICATE",
);
const finalCandidateArtifactName = [
  "punks-desktop-candidate-",
  sourceShaExpression,
].join("");

function loadWorkflow() {
  return YAML.parse(readFileSync(workflowPath, "utf8"));
}

function loadWindowsSigningConfig() {
  return JSON.parse(readFileSync(windowsSigningConfigPath, "utf8"));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function same(actual, expected, message) {
  invariant(
    JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected)),
    message,
  );
}

function workflowStep(job, id) {
  const matches = (job.steps ?? []).filter((candidate) => candidate.id === id);
  invariant(matches.length === 1, "missing or duplicate step " + id);
  const selected = matches[0];
  invariant(
    selected["continue-on-error"] === undefined,
    id + " cannot continue on error",
  );
  invariant(
    selected.if !== false && selected.if !== "false",
    id + " is disabled",
  );
  return selected;
}

function requireRun(step, fragments) {
  invariant(typeof step.run === "string", step.id + " must execute commands");
  for (const fragment of fragments) {
    invariant(step.run.includes(fragment), step.id + " misses " + fragment);
  }
}

function requireRunOrder(step, fragments) {
  requireRun(step, fragments);
  let previousIndex = -1;
  for (const fragment of fragments) {
    const index = step.run.indexOf(fragment, previousIndex + 1);
    invariant(index > previousIndex, step.id + " misorders " + fragment);
    previousIndex = index;
  }
}

function validateWindowsSigner(source) {
  const executableSource = source
    .replace(/<#[\s\S]*?#>/g, "")
    .replace(/^\s*#.*$/gm, "");
  for (const fragment of [
    '"PUNKS_WINDOWS_MAIN_BINARY"',
    '"PUNKS_WINDOWS_RELEASE_ROOT"',
    '"PUNKS_WINDOWS_SIGNING_LEDGER"',
    '"PUNKS_WINDOWS_NSIS_TEMP"',
    "[IO.FileAttributes]::ReparsePoint",
    '"nsis\\x64\\plugins\\x86-unicode\\nsisdl.dll"',
    '"wix\\x64\\wix\\wixuiextension.dll"',
    "$nsisPluginPaths -contains $relativeReleasePath",
    "$wixExtensionPaths -contains $relativeReleasePath",
    '$artifact.Name -match "^nst[0-9A-F]{4}\\.tmp$"',
    "$artifactParent.Equals($nsisTemp, [StringComparison]::OrdinalIgnoreCase)",
    '"patched-main"',
    '"nsis-plugin"',
    '"wix-extension"',
    '"nsis-uninstaller"',
    '"nsis-installer"',
    '"msi-installer"',
    "Import-Module ArtifactSigning -RequiredVersion 0.1.8",
    "Files = $resolvedPath",
    'FileDigest = "SHA256"',
    'TimestampRfc3161 = "http://timestamp.acs.microsoft.com"',
    'TimestampDigest = "SHA256"',
    "ExcludeEnvironmentCredential = $true",
    "ExcludeAzureCliCredential = $false",
    "ExcludeInteractiveBrowserCredential = $true",
    "Invoke-ArtifactSigning @parameters",
    "Get-AuthenticodeSignature -LiteralPath $resolvedPath",
    "TimeStamperCertificate",
    "if ($ekuOids -notcontains $requiredEku)",
    "[IO.File]::AppendAllText",
  ]) {
    invariant(
      executableSource.includes(fragment),
      "Windows custom signer is missing " + fragment,
    );
  }
  invariant(
    executableSource.match(/^\s*Invoke-ArtifactSigning @parameters\s*$/gm)
      ?.length === 1,
    "Windows custom signer must invoke the HSM exactly once",
  );
  invariant(
    !/Invoke-Expression|\biex\b/i.test(executableSource),
    "Windows custom signer executes dynamic PowerShell",
  );
  const classify = executableSource.indexOf("$role = if");
  const invoke = executableSource.indexOf("Invoke-ArtifactSigning @parameters");
  const verify = executableSource.indexOf(
    "Get-AuthenticodeSignature -LiteralPath $resolvedPath",
  );
  const record = executableSource.indexOf("[IO.File]::AppendAllText");
  invariant(
    classify < invoke && invoke < verify && verify < record,
    "Windows custom signer orders allowlist, HSM, verification or ledger incorrectly",
  );
}

function validateWindowsSigningConfig(config) {
  same(
    config,
    {
      $schema: "https://schema.tauri.app/config/2",
      bundle: {
        createUpdaterArtifacts: false,
        windows: {
          signCommand: {
            cmd: "pwsh",
            args: [
              "-NoLogo",
              "-NoProfile",
              "-NonInteractive",
              "-File",
              "../../scripts/windows-artifact-sign.ps1",
              "%1",
            ],
          },
        },
      },
    },
    "static Windows Tauri signing config changed",
  );
}

function requireCheckout(job) {
  const checkout = workflowStep(job, "checkout");
  invariant(
    checkout.uses ===
      "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
    "checkout action is not pinned",
  );
  same(
    checkout.with,
    {
      ref: githubShaExpression,
      "fetch-depth": 1,
      "persist-credentials": false,
    },
    "checkout must use github.sha",
  );
}

function requireCleanInstall(job, name) {
  const clean = workflowStep(job, "clean_source");
  const install = workflowStep(job, "install");
  invariant(
    job.steps.indexOf(clean) < job.steps.indexOf(install),
    name + " cleanliness must precede install",
  );
  requireRun(clean, [
    'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"',
    "git diff --exit-code",
    "git diff --cached --exit-code",
    "git status --porcelain=v1 --untracked-files=all",
  ]);
  invariant(!clean.run.includes("--untracked-files=no"), name + " hides files");
  invariant(
    install.run === "pnpm install --frozen-lockfile --ignore-scripts",
    name + " must disable lifecycle scripts",
  );
}

function collectSecretReferences(workflow) {
  const expression = /\$\{\{\s*secrets\.([A-Z0-9_]+)\s*\}\}/g;
  const references = [];
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    const jobScope = JSON.stringify({
      env: job.env,
      environment: job.environment,
      permissions: job.permissions,
    });
    for (const match of jobScope.matchAll(expression)) {
      references.push({ jobName, stepId: null, secret: match[1] });
    }
    for (const selected of job.steps ?? []) {
      for (const match of JSON.stringify(selected).matchAll(expression)) {
        references.push({
          jobName,
          stepId: selected.id ?? null,
          secret: match[1],
        });
      }
    }
  }
  return references;
}

function requireAttestationVerification(step) {
  requireRun(step, [
    "gh attestation verify",
    '--repo "$GITHUB_REPOSITORY"',
    "--signer-workflow",
    '--source-digest "$SOURCE_SHA"',
    '--source-ref "$GITHUB_REF"',
    "--deny-self-hosted-runners",
    '--bundle "$ATTESTATION_BUNDLE"',
    "--format json",
  ]);
}

function validateWorkflow(workflow) {
  same(
    workflow.permissions,
    readPermissions,
    "workflow permissions are excessive",
  );
  same(
    Object.keys(workflow.jobs ?? {}).sort(),
    expectedJobs,
    "job graph is not closed",
  );
  invariant(
    workflow.on?.workflow_dispatch?.inputs?.source_sha?.required === true,
    "source_sha is optional",
  );
  invariant(
    workflow.on?.workflow_dispatch?.inputs?.staging_deployment_id?.required ===
      true,
    "staging deployment is optional",
  );
  same(
    workflow.on?.workflow_dispatch?.inputs?.validation_scope,
    {
      default: "apple-only",
      description:
        "Build only the two Apple legs, or the complete four-platform candidate",
      options: ["apple-only", "full-candidate"],
      required: true,
      type: "choice",
    },
    "validation scope can silently claim a full candidate",
  );

  const {
    preflight,
    gates,
    verify_staging,
    build,
    attest_legs,
    aggregate,
    attest_candidate,
  } = workflow.jobs;
  same(preflight.permissions, readPermissions, "preflight permissions");
  invariant(!preflight.environment, "preflight can access an environment");
  requireRun(workflowStep(preflight, "validate_inputs"), [
    '[[ "$SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]]',
    '[[ "$STAGING_DEPLOYMENT_ID" =~ ^sha256:[0-9a-f]{64}$ ]]',
    'test "$SOURCE_SHA" = "$GITHUB_SHA"',
    'test "$REF_PROTECTED" = "true"',
  ]);
  requireCheckout(preflight);
  requireRun(workflowStep(preflight, "clean_source"), [
    "git status --porcelain=v1 --untracked-files=all",
  ]);

  invariant(gates.needs === "preflight", "gates bypass preflight");
  same(gates.permissions, readPermissions, "gates permissions");
  invariant(!gates.environment, "gates can access signing secrets");
  requireCheckout(gates);
  requireCleanInstall(gates, "gates");
  const dartSetup = workflowStep(gates, "setup_dart");
  invariant(
    dartSetup.uses ===
      "dart-lang/setup-dart@65eb853c7ba17dde3be364c3d2858773e7144260",
    "gates do not pin the approved Dart setup action",
  );
  invariant(
    dartSetup.with?.sdk === "3.10.8",
    "gates do not pin the exact Dart SDK",
  );
  requireRun(workflowStep(gates, "linux_dependencies"), [
    "apt-get update",
    "apt-get install -y --no-install-recommends",
    "libgtk-3-dev",
    "libwebkit2gtk-4.1-dev",
    "pkg-config",
  ]);
  const setupPlaywright = workflowStep(gates, "setup_playwright");
  requireRun(setupPlaywright, [
    "pnpm --dir desktop exec playwright install chromium",
  ]);
  invariant(
    gates.steps.indexOf(workflowStep(gates, "install")) <
      gates.steps.indexOf(setupPlaywright) &&
      gates.steps.indexOf(setupPlaywright) <
        gates.steps.indexOf(workflowStep(gates, "run_gates")),
    "Playwright installation must precede the public capability gate",
  );
  requireRun(workflowStep(gates, "run_gates"), [
    "scripts/punks-desktop-candidate-workflow.test.mjs",
    "scripts/candidate/*.test.mjs",
    "pnpm migration:check",
    "pnpm cloudflare:check",
    "pnpm --dir desktop check:punks-candidate",
    "pnpm --dir desktop check:punks-product",
    "pnpm --dir desktop test:e2e:punks-capabilities",
    "node scripts/check-punks-rust.mjs",
    'tauri_config="$(jq -c . desktop/src-tauri/tauri.punks.conf.json)"',
    'export TAURI_CONFIG="$tauri_config"',
    "c.bundle.externalBin.length !== 0",
    "cargo check",
    "--no-default-features",
    "--features punks-desktop-social-loop",
  ]);

  invariant(
    verify_staging.needs === "gates",
    "staging verification bypasses gates",
  );
  same(
    verify_staging.permissions,
    readPermissions,
    "staging verification permissions",
  );
  invariant(
    verify_staging.environment === "punks-staging-promotion",
    "staging verification lacks protected environment",
  );
  requireCheckout(verify_staging);
  const observeStaging = workflowStep(verify_staging, "observe_staging");
  requireRun(observeStaging, [
    "staging-deployment-proof.mjs",
    "--account-id 3a391620584c792dbbd8cfa148d7634a",
    '--source-sha "$SOURCE_SHA"',
    "validateStagingDeploymentProof",
    "proof.deploymentId !== expectedDeploymentId",
  ]);
  invariant(
    observeStaging.env?.CLOUDFLARE_API_TOKEN ===
      workflowExpression("secrets.PUNKS_CLOUDFLARE_API_TOKEN"),
    "remote staging observation lacks its protected token",
  );
  const uploadStagingProof = workflowStep(
    verify_staging,
    "upload_staging_proof",
  );
  invariant(
    uploadStagingProof.with?.name ===
      "punks-staging-deployment-proof-" + sourceShaExpression &&
      uploadStagingProof.with?.path === "staging-deployment-proof.json" &&
      uploadStagingProof.with?.["retention-days"] === 1,
    "remote staging proof artifact is not exact and short-lived",
  );

  invariant(
    build.needs === "verify_staging",
    "build bypasses remote staging verification",
  );
  same(
    build.permissions,
    buildPermissions,
    "build cannot mint Azure OIDC tokens or has excessive permissions",
  );
  invariant(
    build.environment === "punks-staging-promotion",
    "build lacks protected environment",
  );
  same(
    build.strategy?.matrix?.include,
    buildMatrixExpression,
    "platform matrix changed",
  );
  requireCheckout(build);
  requireCleanInstall(build, "build");
  const unixRunner = workflowStep(build, "prepare_cargo_runner_unix");
  const windowsRunner = workflowStep(build, "prepare_cargo_runner_windows");
  requireRun(unixRunner, [
    'exec cargo "$@" --locked --no-default-features',
    "chmod 0700",
  ]);
  requireRun(windowsRunner, [
    "cargo %* --locked --no-default-features",
    "punks-cargo-runner.cmd",
  ]);
  requireRun(workflowStep(build, "import_apple"), [
    "Developer ID Application",
    "Keychain Access > My Certificates",
    'echo "team_id=$team_id"',
  ]);
  requireRun(workflowStep(build, "verify_linux"), [
    "validator_status=$?",
    "validator_status != 0 && validator_status != 1",
    "Signatures found with key fingerprints: $PUNKS_LINUX_GPG_KEY_ID",
  ]);
  const firstSecretStep = Math.min(
    build.steps.indexOf(workflowStep(build, "import_apple")),
    build.steps.indexOf(workflowStep(build, "import_linux")),
    build.steps.indexOf(workflowStep(build, "azure_login")),
  );
  invariant(
    build.steps.indexOf(unixRunner) < firstSecretStep &&
      build.steps.indexOf(windowsRunner) < firstSecretStep,
    "Cargo runners must exist before signing secrets",
  );
  for (const [id, runnerOutput] of [
    ["build_macos", "prepare_cargo_runner_unix.outputs.path"],
    ["build_linux", "prepare_cargo_runner_unix.outputs.path"],
    ["build_windows", "prepare_cargo_runner_windows.outputs.path"],
  ]) {
    const selected = workflowStep(build, id);
    requireRun(selected, [
      "pnpm --dir desktop tauri build",
      '--runner "$CARGO_RUNNER"',
      "--features punks-desktop-social-loop",
      "--config src-tauri/tauri.punks.conf.json",
    ]);
    invariant(
      !selected.run.includes("-- --locked --no-default-features"),
      id + " forwards fake Cargo flags",
    );
    invariant(
      !selected.run.includes("--no-default-features"),
      id + " must delegate default-feature control to its runner",
    );
    invariant(
      String(selected.env?.CARGO_RUNNER).includes(runnerOutput),
      id + " uses the wrong Cargo runner",
    );
  }
  requireRun(workflowStep(build, "build_macos"), [
    'notarytool submit "$dmg"',
    "--wait --output-format json",
    "jq -er '.status'",
    'stapler staple "$dmg"',
  ]);
  const buildWindows = workflowStep(build, "build_windows");
  invariant(
    !buildWindows.run.includes("WINDOWS_SIGNING_CONFIG") &&
      !buildWindows.run.includes("certificateThumbprint") &&
      buildWindows.run.includes("--no-bundle"),
    "Windows build still depends on an exportable PFX",
  );
  const azureLogin = workflowStep(build, "azure_login");
  invariant(
    azureLogin.uses === azureLoginAction &&
      azureLogin.if === "runner.os == 'Windows'",
    "Windows signing does not use the pinned Azure OIDC login action",
  );
  same(
    azureLogin.with,
    {
      "client-id": workflowExpression("secrets.PUNKS_AZURE_CLIENT_ID"),
      "tenant-id": workflowExpression("secrets.PUNKS_AZURE_TENANT_ID"),
      "subscription-id": workflowExpression(
        "secrets.PUNKS_AZURE_SUBSCRIPTION_ID",
      ),
    },
    "Azure OIDC login contract changed",
  );
  const artifactSigningAuth = {
    endpoint: workflowExpression("vars.PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT"),
    "signing-account-name": workflowExpression(
      "vars.PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT",
    ),
    "certificate-profile-name": workflowExpression(
      "vars.PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE",
    ),
    "file-digest": "SHA256",
    "timestamp-rfc3161": "http://timestamp.acs.microsoft.com",
    "timestamp-digest": "SHA256",
    "exclude-environment-credential": true,
    "exclude-workload-identity-credential": true,
    "exclude-managed-identity-credential": true,
    "exclude-shared-token-cache-credential": true,
    "exclude-visual-studio-credential": true,
    "exclude-visual-studio-code-credential": true,
    "exclude-azure-cli-credential": false,
    "exclude-azure-powershell-credential": true,
    "exclude-azure-developer-cli-credential": true,
    "exclude-interactive-browser-credential": true,
  };
  const windowsReleaseDirectory =
    workflowExpression("github.workspace") +
    "\\desktop\\src-tauri\\target\\" +
    workflowExpression("matrix.target") +
    "\\release";
  const signWindowsBinary = workflowStep(build, "sign_windows_binary");
  invariant(
    signWindowsBinary.uses === artifactSigningAction &&
      signWindowsBinary.if === "runner.os == 'Windows'",
    "Windows binary does not use the pinned HSM-backed Artifact Signing action",
  );
  invariant(
    build.steps.indexOf(azureLogin) < build.steps.indexOf(signWindowsBinary),
    "Windows Artifact Signing runs before the Azure OIDC login",
  );
  same(
    signWindowsBinary.with,
    {
      ...artifactSigningAuth,
      files: windowsReleaseDirectory + "\\punks-bot-staging.exe",
    },
    "Windows binary Artifact Signing contract changed",
  );
  const bundleWindows = workflowStep(build, "bundle_windows");
  invariant(
    build.steps.indexOf(azureLogin) < build.steps.indexOf(bundleWindows),
    "Windows bundling runs before the Azure OIDC login",
  );
  same(
    bundleWindows.env,
    {
      PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT: workflowExpression(
        "vars.PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT",
      ),
      PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT: workflowExpression(
        "vars.PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT",
      ),
      PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE: workflowExpression(
        "vars.PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE",
      ),
      PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU: workflowExpression(
        "vars.PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU",
      ),
    },
    "Windows in-bundler signing environment changed",
  );
  requireRun(bundleWindows, [
    "PUNKS_WINDOWS_SIGNING_LEDGER",
    "PUNKS_WINDOWS_NSIS_TEMP",
    "$env:TEMP = $nsisTemp",
    "$env:TMP = $nsisTemp",
    '"patched-main" = 2',
    '"nsis-plugin" = 5',
    '"wix-extension" = 2',
    '"nsis-uninstaller" = 1',
    '"nsis-installer" = 1',
    '"msi-installer" = 1',
    "$entries.Count -ne 12",
    "scripts/windows-artifact-sign.ps1",
    "src-tauri/tauri.punks.windows-signing.conf.json",
    "Assert-ExactRolePaths",
    "standaloneDigestBeforeBundle",
    "standaloneDigestAfterBundle",
    "$standaloneDigestAfterBundle -ne $standaloneDigestBeforeBundle",
    "did not restore the standalone HSM-signed Windows executable",
    "expectedNsisPlugins",
    "expectedWixExtensions",
    '"^nst[0-9A-F]{4}\\.tmp$"',
    "pnpm --dir desktop tauri bundle",
    "--features punks-desktop-social-loop",
    "--target $env:TARGET",
    "--bundles $env:BUNDLES",
    "--config src-tauri/tauri.punks.conf.json",
    "--config src-tauri/tauri.punks.windows-signing.conf.json",
  ]);
  requireRunOrder(bundleWindows, [
    '$nsisTemp = Join-Path $env:RUNNER_TEMP "punks-nsis-temp"',
    "New-Item -ItemType Directory -Path $nsisTemp",
    "$env:PUNKS_WINDOWS_NSIS_TEMP = $nsisTemp",
    "$env:TEMP = $nsisTemp",
    "$env:TMP = $nsisTemp",
    "pnpm --dir desktop tauri bundle",
  ]);
  invariant(
    !bundleWindows.run.includes("--no-sign") &&
      !bundleWindows.run.includes("ConvertTo-Json") &&
      !bundleWindows.run.includes("signCommand = @{") &&
      !bundleWindows.run.includes("cmd ="),
    "Windows bundler bypasses the static post-patch signing contract",
  );
  validateWindowsSigningConfig(loadWindowsSigningConfig());
  const windowsSigner = readFileSync(windowsSignerPath, "utf8");
  validateWindowsSigner(windowsSigner);
  const windowsSignerTest = workflowStep(build, "test_windows_signer");
  requireRun(windowsSignerTest, [
    "scripts/windows-artifact-sign.test.ps1",
    "Windows Artifact Signing behavioral contract failed",
  ]);
  invariant(
    readFileSync(windowsSignerTestPath, "utf8").includes(
      "Windows Artifact Signing behavioral contract OK",
    ),
    "Windows signer behavioral test harness is missing",
  );
  const prepareWindowsInstallers = workflowStep(
    build,
    "prepare_windows_installers",
  );
  requireRun(prepareWindowsInstallers, [
    "Get-ChildItem $bundle -Recurse -File",
    'Get-ChildItem "$bundle/nsis"',
    'Get-ChildItem "$bundle/msi"',
    "Compare-Object",
    "ReparsePoint",
  ]);
  invariant(
    !build.steps.some((step) => step.id === "sign_windows_installers"),
    "Windows installers bypass Tauri's post-patch signing hooks",
  );
  const refreshWindowsUpdater = workflowStep(build, "refresh_windows_updater");
  requireRun(refreshWindowsUpdater, [
    "TAURI_SIGNING_PRIVATE_KEY",
    "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
    'Get-ChildItem "$bundle/nsis"',
    'Get-ChildItem "$bundle/msi"',
    '$signaturePath = "$($artifact.FullName).sig"',
    "tauri signer sign",
    "Test-Path $signaturePath",
  ]);
  invariant(
    build.steps.indexOf(buildWindows) <
      build.steps.indexOf(windowsSignerTest) &&
      build.steps.indexOf(windowsSignerTest) <
        build.steps.indexOf(signWindowsBinary) &&
      build.steps.indexOf(signWindowsBinary) <
        build.steps.indexOf(bundleWindows) &&
      build.steps.indexOf(bundleWindows) <
        build.steps.indexOf(prepareWindowsInstallers) &&
      build.steps.indexOf(prepareWindowsInstallers) <
        build.steps.indexOf(refreshWindowsUpdater),
    "Windows binary, installers and updater signatures are ordered incorrectly",
  );
  const dist = workflowStep(build, "verify_product_dist");
  requireRun(dist, ["pnpm --dir desktop check:punks-product-dist"]);
  const nativeArtifact = workflowStep(build, "verify_native_artifact");
  requireRun(nativeArtifact, [
    "punks-bot-staging",
    '[[ "$RUNNER_OS" = "Windows" ]]',
    'node scripts/check-punks-rust.mjs --binary "$binary"',
  ]);
  invariant(
    Math.min(build.steps.indexOf(dist), build.steps.indexOf(nativeArtifact)) >
      Math.max(
        build.steps.indexOf(workflowStep(build, "build_macos")),
        build.steps.indexOf(workflowStep(build, "build_linux")),
        build.steps.indexOf(workflowStep(build, "build_windows")),
        build.steps.indexOf(bundleWindows),
        build.steps.indexOf(refreshWindowsUpdater),
      ),
    "artifact proof precedes the exact build",
  );
  requireRun(workflowStep(build, "verify_macos"), [
    "*.app.tar.gz.sig",
    'codesign --verify --deep --strict --verbose=2 "$app"',
    'codesign --verify --strict --verbose=2 "$dmg"',
    "Authority=$EXPECTED_IDENTITY",
    "TeamIdentifier=$EXPECTED_TEAM_ID",
    "Timestamp=",
    'spctl --assess --type execute --verbose=2 "$app"',
    'spctl --assess --type open --context context:primary-signature --verbose=2 "$dmg"',
    'stapler validate "$app"',
    'stapler validate "$dmg"',
  ]);
  requireRun(workflowStep(build, "verify_linux"), [
    "*.AppImage.sig",
    "Validation result: validation successful",
    "$PUNKS_LINUX_GPG_KEY_ID",
    "--detach-sign",
    '--verify "${deb}.asc" "$deb"',
  ]);
  const verifyWindows = workflowStep(build, "verify_windows");
  same(
    verifyWindows.env,
    {
      EXPECTED_IDENTITY_EKU: workflowExpression(
        "vars.PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU",
      ),
    },
    "Windows durable identity input changed",
  );
  requireRun(verifyWindows, [
    "$native.Count -ne 1",
    "$nsis.Count -ne 1",
    "$msi.Count -ne 1",
    "Get-AuthenticodeSignature",
    '"1.3.6.1.5.5.7.3.3"',
    '"1.3.6.1.4.1.311.97.1.0"',
    "$expectedIdentityEku",
    "$nativeThumbprint",
    "TimeStamperCertificate",
    "Start-Process -FilePath $nsis[0].FullName",
    'Get-ChildItem $nsisInstall -Recurse -File -Filter "punks-bot-staging.exe"',
    'Get-ChildItem $nsisInstall -Recurse -File -Filter "uninstall.exe"',
    "Start-Process -FilePath msiexec.exe",
    'Get-ChildItem $msiInstall -Recurse -File -Filter "punks-bot-staging.exe"',
    "NSISdl.dll",
    "WixUIExtension.dll",
    "$toolDlls.Count -ne 7",
    "$signedArtifacts.Count -ne 13",
    "$patchedDigests.Count -ne 2",
    "$installedDigests.Count -ne 2",
    '($patchedDigests -join ",") -ne ($installedDigests -join ",")',
    "Installed NSIS/MSI executables do not match the two HSM-signed patched variants",
  ]);
  requireRun(workflowStep(build, "verify_updater"), [
    "minisign -Vm",
    "*.app.tar.gz",
    "*.AppImage",
    "*.exe",
    "*.msi",
  ]);
  requireRun(workflowStep(build, "stage_leg"), [
    "scripts/candidate/artifacts.mjs collect",
  ]);
  invariant(
    !build.steps.some((selected) =>
      String(selected.uses ?? "").startsWith("actions/attest@"),
    ),
    "build mints an attestation",
  );

  const secretReferences = collectSecretReferences(workflow);
  const observedSecrets = new Set();
  for (const reference of secretReferences) {
    const location = reference.jobName + "/" + reference.stepId;
    invariant(
      allowedSecretSteps[reference.secret]?.includes(location),
      reference.secret + " leaked to " + location,
    );
    observedSecrets.add(reference.secret);
  }
  same(
    [...observedSecrets].sort(),
    Object.keys(allowedSecretSteps).sort(),
    "required signing secret set changed",
  );

  invariant(attest_legs.needs === "build", "leg attestation bypasses builds");
  same(
    attest_legs.permissions,
    attestPermissions,
    "leg attestation permissions",
  );
  same(
    attest_legs.strategy?.matrix?.platform,
    attestMatrixExpression,
    "leg attestation matrix changed",
  );
  requireAttestationVerification(
    workflowStep(attest_legs, "verify_leg_attestation"),
  );
  invariant(
    aggregate.needs === "attest_legs",
    "aggregate bypasses verified legs",
  );
  invariant(
    aggregate.if === "inputs.validation_scope == 'full-candidate'",
    "Apple-only validation can publish a four-platform candidate",
  );
  same(aggregate.permissions, readPermissions, "aggregate permissions");
  const aggregateDownload = workflowStep(aggregate, "download_attested_legs");
  invariant(
    aggregateDownload.with?.path === "candidate-input/legs",
    "aggregate input must be separate from create-only output",
  );
  const aggregateStep = workflowStep(aggregate, "aggregate_candidate");
  const stagingProofDownload = workflowStep(
    aggregate,
    "download_staging_proof",
  );
  invariant(
    stagingProofDownload.with?.name ===
      "punks-staging-deployment-proof-" + sourceShaExpression &&
      stagingProofDownload.with?.path === "candidate-input/staging",
    "aggregate does not consume the protected remote staging proof",
  );
  requireRun(aggregateStep, [
    "scripts/candidate/artifacts.mjs aggregate",
    "--input candidate-input/legs",
    "--output candidate",
    "--staging-proof candidate-input/staging/staging-deployment-proof.json",
    '--release-tag "punks-staging-${SOURCE_SHA}"',
    '--source-ref "$GITHUB_REF"',
    "--signer-workflow",
  ]);
  invariant(
    aggregateStep.env?.GH_TOKEN === githubTokenExpression,
    "aggregate cannot cryptographically verify leg attestations",
  );
  invariant(
    attest_candidate.needs === "aggregate",
    "final attestation bypasses aggregate",
  );
  same(
    attest_candidate.permissions,
    publishPermissions,
    "final attestation permissions",
  );
  requireAttestationVerification(
    workflowStep(attest_candidate, "verify_candidate_attestation"),
  );
  const stageDraft = workflowStep(attest_candidate, "stage_immutable_draft");
  requireRun(stageDraft, [
    'RELEASE_TAG="punks-staging-${SOURCE_SHA}"',
    'gh release view "$RELEASE_TAG"',
    ".isDraft == true",
    'gh release create "$RELEASE_TAG"',
    '--target "$SOURCE_SHA"',
    "--draft",
    'gh release upload "$RELEASE_TAG"',
    "--clobber",
    "candidate/release-assets/*",
    "candidate/aggregate-manifest.json",
    "candidate/staging-deployment-proof.json",
    "candidate/punks-candidate-aggregate.sigstore.json",
  ]);
  invariant(
    stageDraft.env?.GH_TOKEN === githubTokenExpression,
    "draft staging lacks repository authentication",
  );
  invariant(
    !stageDraft.run.includes("--draft=false") &&
      !stageDraft.run.includes("--latest"),
    "candidate workflow activates an unpromoted draft",
  );
  const verifyFinal = workflowStep(attest_candidate, "verify_staged_draft");
  requireRun(verifyFinal, [
    'gh release view "$RELEASE_TAG"',
    "--json isDraft,isPrerelease,tagName,targetCommitish,assets",
    'jq -e --arg tag "$RELEASE_TAG" --arg sha "$SOURCE_SHA"',
    ".isDraft == true",
    ".isPrerelease == false",
    ".targetCommitish == $sha",
    "candidate/release-assets",
    "staging-deployment-proof.json",
  ]);
  invariant(
    attest_candidate.steps.indexOf(stageDraft) >
      attest_candidate.steps.indexOf(
        workflowStep(attest_candidate, "verify_candidate_attestation"),
      ) &&
      attest_candidate.steps.indexOf(verifyFinal) >
        attest_candidate.steps.indexOf(stageDraft),
    "draft must be staged only after attestation and then verified",
  );

  const uploadSteps = Object.entries(workflow.jobs).flatMap(([jobName, job]) =>
    (job.steps ?? [])
      .filter((selected) =>
        String(selected.uses ?? "").startsWith("actions/upload-artifact@"),
      )
      .map((selected) => ({ jobName, selected })),
  );
  const finalUploads = uploadSteps.filter(
    ({ selected }) => selected.with?.name === finalCandidateArtifactName,
  );
  invariant(
    finalUploads.length === 1 &&
      finalUploads[0].jobName === "attest_candidate" &&
      finalUploads[0].selected.id === "upload_final_candidate",
    "there must be exactly one aggregate final candidate",
  );
  for (const { jobName, selected } of uploadSteps) {
    if (selected.id === "upload_final_candidate") {
      invariant(selected.with["retention-days"] === 30, "final retention");
    } else {
      invariant(
        selected.with["retention-days"] === 1,
        jobName + "/" + selected.id + " exposes a long-lived partial candidate",
      );
      invariant(
        /leg|unattested|deployment-proof/.test(selected.with.name),
        jobName + "/" + selected.id + " looks final",
      );
    }
  }

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    invariant(
      job.if !== "always()",
      jobName + " runs after a failed dependency",
    );
    for (const selected of job.steps ?? []) {
      if (!selected.uses) continue;
      invariant(
        /^[^@\s]+@[0-9a-f]{40}$/.test(selected.uses),
        jobName + "/" + selected.id + " action is not SHA-pinned",
      );
    }
  }
}

test("the parsed workflow satisfies the complete candidate security contract", () => {
  assert.doesNotThrow(() => validateWorkflow(loadWorkflow()));
});

const mutations = [
  {
    name: "workflow-level OIDC permission",
    change(workflow) {
      workflow.permissions["id-token"] = "write";
    },
    error: /workflow permissions/,
  },
  {
    name: "source SHA no longer equals github.sha",
    change(workflow) {
      const step = workflowStep(workflow.jobs.preflight, "validate_inputs");
      step.run = step.run.replace(
        'test "$SOURCE_SHA" = "$GITHUB_SHA"',
        'test -n "$SOURCE_SHA"',
      );
    },
    error: /misses test "\$SOURCE_SHA" = "\$GITHUB_SHA"/,
  },
  {
    name: "checkout accepts an input ref",
    change(workflow) {
      workflowStep(workflow.jobs.build, "checkout").with.ref =
        sourceShaExpression;
    },
    error: /checkout must use github.sha/,
  },
  {
    name: "untracked files are hidden",
    change(workflow) {
      const step = workflowStep(workflow.jobs.gates, "clean_source");
      step.run = step.run.replace(
        "--untracked-files=all",
        "--untracked-files=no",
      );
    },
    error: /misses git status|hides files/,
  },
  {
    name: "dependency lifecycle scripts are enabled",
    change(workflow) {
      workflowStep(workflow.jobs.build, "install").run =
        "pnpm install --frozen-lockfile";
    },
    error: /disable lifecycle scripts/,
  },
  {
    name: "Punks native source gate is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.gates, "run_gates");
      step.run = step.run.replace("node scripts/check-punks-rust.mjs", "true");
    },
    error: /check-punks-rust/,
  },
  {
    name: "Punks capability bundle gate is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.gates, "run_gates");
      step.run = step.run.replace(
        "pnpm --dir desktop test:e2e:punks-capabilities",
        "true",
      );
    },
    error: /test:e2e:punks-capabilities/,
  },
  {
    name: "Playwright Chromium setup is removed",
    change(workflow) {
      workflowStep(workflow.jobs.gates, "setup_playwright").run = "true";
    },
    error: /setup_playwright misses/,
  },
  {
    name: "build loses OIDC permission",
    change(workflow) {
      delete workflow.jobs.build.permissions["id-token"];
    },
    error: /Azure OIDC tokens|build permissions/,
  },
  {
    name: "signing secret is hoisted to job scope",
    change(workflow) {
      workflow.jobs.build.env.LEAK = appleCertificateExpression;
    },
    error: /leaked to build\/null/,
  },
  {
    name: "Unix Cargo runner drops no-default-features",
    change(workflow) {
      const step = workflowStep(
        workflow.jobs.build,
        "prepare_cargo_runner_unix",
      );
      step.run = step.run.replace(" --no-default-features", "");
    },
    error: /prepare_cargo_runner_unix misses/,
  },
  {
    name: "Tauri forwards fake trailing Cargo flags",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "build_linux");
      step.run += "\n-- --locked --no-default-features";
    },
    error: /forwards fake Cargo flags/,
  },
  {
    name: "Tauri build bypasses strict runner",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "build_windows");
      step.run = step.run.replace('--runner "$CARGO_RUNNER"', "");
    },
    error: /misses --runner/,
  },
  {
    name: "Punks feature is removed from a build",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "build_macos");
      step.run = step.run.replace(
        "--features punks-desktop-social-loop",
        "--features buzz-desktop",
      );
    },
    error: /punks-desktop-social-loop/,
  },
  {
    name: "isolated dist proof is disabled",
    change(workflow) {
      workflowStep(workflow.jobs.build, "verify_product_dist").if = "false";
    },
    error: /verify_product_dist is disabled/,
  },
  {
    name: "isolated native proof is disabled",
    change(workflow) {
      workflowStep(workflow.jobs.build, "verify_native_artifact").if = "false";
    },
    error: /verify_native_artifact is disabled/,
  },
  {
    name: "Windows HSM signer is replaced by an unpinned action",
    change(workflow) {
      workflowStep(workflow.jobs.build, "sign_windows_binary").uses =
        "azure/artifact-signing-action@v2";
    },
    error: /pinned HSM-backed Artifact Signing action/,
  },
  {
    name: "Windows post-patch Tauri signer is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "bundle_windows");
      step.run = step.run.replaceAll(
        "src-tauri/tauri.punks.windows-signing.conf.json",
        "src-tauri/ignored-signing.conf.json",
      );
    },
    error: /tauri.punks.windows-signing.conf.json/,
  },
  {
    name: "Windows signer behavioral test is disabled",
    change(workflow) {
      workflowStep(workflow.jobs.build, "test_windows_signer").if = "false";
    },
    error: /test_windows_signer is disabled/,
  },
  {
    name: "Windows NSIS temporary signing root is unbound",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "bundle_windows");
      step.run = step.run.replace(
        "$env:TEMP = $nsisTemp",
        "$env:IGNORED_TEMP = $nsisTemp",
      );
    },
    error: /misses \$env:TEMP = \$nsisTemp/,
  },
  {
    name: "Tauri standalone restoration check is disabled",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "bundle_windows");
      step.run = step.run.replace(
        "$standaloneDigestAfterBundle -ne $standaloneDigestBeforeBundle",
        "$false",
      );
    },
    error: /standaloneDigestAfterBundle -ne \$standaloneDigestBeforeBundle/,
  },
  {
    name: "installed patched variants are no longer matched to the ledger",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "verify_windows");
      step.run = step.run.replace(
        '($patchedDigests -join ",") -ne ($installedDigests -join ",")',
        "$false",
      );
    },
    error: /patchedDigests -join/,
  },
  {
    name: "explicit DMG notarization is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "build_macos");
      step.run = step.run.replace("notarytool submit", "echo skipped");
    },
    error: /notarytool submit/,
  },
  {
    name: "DMG stapler validation is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "verify_macos");
      step.run = step.run.replace(
        'xcrun stapler validate "$dmg"',
        "echo skipped",
      );
    },
    error: /stapler validate "\$dmg"/,
  },
  {
    name: "Windows installer allowlist preflight is removed",
    change(workflow) {
      const step = workflowStep(
        workflow.jobs.build,
        "prepare_windows_installers",
      );
      step.run = step.run.replace("Compare-Object", "Write-Output");
    },
    error: /Compare-Object/,
  },
  {
    name: "Windows durable signer identity check is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "verify_windows");
      step.env.EXPECTED_IDENTITY_EKU = workflowExpression(
        "vars.IGNORED_IDENTITY_EKU",
      );
    },
    error: /durable identity input/,
  },
  {
    name: "Windows updater signature refresh is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "refresh_windows_updater");
      step.run = step.run.replace("tauri signer sign", "echo skipped");
    },
    error: /tauri signer sign/,
  },
  {
    name: "Windows timestamp check is removed",
    change(workflow) {
      const step = workflowStep(workflow.jobs.build, "verify_windows");
      step.run = step.run.replace("TimeStamperCertificate", "IgnoredTimestamp");
    },
    error: /TimeStamperCertificate/,
  },
  {
    name: "one native platform is removed",
    change(workflow) {
      workflow.jobs.build.strategy.matrix.include =
        buildMatrixExpression.replace(
          JSON.stringify(expectedMatrix),
          JSON.stringify(expectedMatrix.slice(0, -1)),
        );
    },
    error: /platform matrix/,
  },
  {
    name: "leg attestation verification is disabled",
    change(workflow) {
      workflowStep(workflow.jobs.attest_legs, "verify_leg_attestation").if =
        "false";
    },
    error: /verify_leg_attestation is disabled/,
  },
  {
    name: "aggregate bypasses verified leg attestations",
    change(workflow) {
      workflow.jobs.aggregate.needs = "build";
    },
    error: /aggregate bypasses/,
  },
  {
    name: "aggregate input overlaps create-only output",
    change(workflow) {
      workflowStep(
        workflow.jobs.aggregate,
        "download_attested_legs",
      ).with.path = "candidate/legs";
    },
    error: /separate from create-only output/,
  },
  {
    name: "aggregate omits source-ref attestation policy",
    change(workflow) {
      const step = workflowStep(workflow.jobs.aggregate, "aggregate_candidate");
      step.run = step.run.replace('--source-ref "$GITHUB_REF"', "");
    },
    error: /source-ref/,
  },
  {
    name: "final attestation bypasses aggregation",
    change(workflow) {
      workflow.jobs.attest_candidate.needs = "build";
    },
    error: /final attestation bypasses/,
  },
  {
    name: "partial leg is presented as the final candidate",
    change(workflow) {
      workflowStep(workflow.jobs.build, "upload_leg").with.name =
        finalCandidateArtifactName;
    },
    error: /exactly one aggregate final candidate/,
  },
  {
    name: "remote staging observation is removed",
    change(workflow) {
      workflowStep(workflow.jobs.verify_staging, "observe_staging").run =
        "true";
    },
    error: /observe_staging misses/,
  },
  {
    name: "candidate draft is activated before promotion",
    change(workflow) {
      workflowStep(
        workflow.jobs.attest_candidate,
        "stage_immutable_draft",
      ).run += '\ngh release edit "$RELEASE_TAG" --draft=false --latest';
    },
    error: /activates an unpromoted draft/,
  },
];

for (const mutation of mutations) {
  test("workflow mutation is rejected: " + mutation.name, () => {
    const workflow = structuredClone(loadWorkflow());
    mutation.change(workflow);
    assert.throws(() => validateWorkflow(workflow), mutation.error);
  });
}

test("the static Windows Tauri signing config is exact", () => {
  assert.doesNotThrow(() =>
    validateWindowsSigningConfig(loadWindowsSigningConfig()),
  );
});

const windowsSigningConfigMutations = [
  {
    name: "PowerShell is replaced by cmd.exe",
    change(config) {
      config.bundle.windows.signCommand.cmd = "cmd.exe";
    },
  },
  {
    name: "the File switch is removed",
    change(config) {
      config.bundle.windows.signCommand.args =
        config.bundle.windows.signCommand.args.filter(
          (argument) => argument !== "-File",
        );
    },
  },
  {
    name: "the signer path is moved after the artifact",
    change(config) {
      config.bundle.windows.signCommand.args.reverse();
    },
  },
  {
    name: "Tauri updater artifacts are emitted before Authenticode",
    change(config) {
      config.bundle.createUpdaterArtifacts = true;
    },
  },
];

for (const mutation of windowsSigningConfigMutations) {
  test("Windows signing config mutation is rejected: " + mutation.name, () => {
    const config = structuredClone(loadWindowsSigningConfig());
    mutation.change(config);
    assert.throws(
      () => validateWindowsSigningConfig(config),
      /static Windows Tauri signing config changed/,
    );
  });
}

const signerMutations = [
  {
    name: "HSM invocation is commented out",
    change(source) {
      return source.replace(
        "Invoke-ArtifactSigning @parameters",
        "# Invoke-ArtifactSigning @parameters",
      );
    },
    error: /Invoke-ArtifactSigning/,
  },
  {
    name: "HSM invocation is replaced by a matching string",
    change(source) {
      return source.replace(
        "Invoke-ArtifactSigning @parameters",
        'Write-Output "Invoke-ArtifactSigning @parameters"',
      );
    },
    error: /invoke the HSM exactly once/,
  },
  {
    name: "DLL role predicate is widened",
    change(source) {
      return source.replace(
        "$nsisPluginPaths -contains $relativeReleasePath",
        '$relativeReleasePath.EndsWith(".dll")',
      );
    },
    error: /nsisPluginPaths -contains/,
  },
  {
    name: "HSM input is replaced by the main binary",
    change(source) {
      return source.replace("Files = $resolvedPath", "Files = $mainBinary");
    },
    error: /Files = \$resolvedPath/,
  },
  {
    name: "NSIS temporary parent is widened to RUNNER_TEMP",
    change(source) {
      return source.replace(
        "$artifactParent.Equals($nsisTemp, [StringComparison]::OrdinalIgnoreCase)",
        "Test-ContainedPath -Child $resolvedPath -Parent $runnerTemp",
      );
    },
    error: /artifactParent\.Equals\(\$nsisTemp/,
  },
  {
    name: "durable EKU rejection is inverted",
    change(source) {
      return source.replace(
        "if ($ekuOids -notcontains $requiredEku)",
        "if ($ekuOids -contains $requiredEku)",
      );
    },
    error: /notcontains/,
  },
  {
    name: "reparse-point guard is removed",
    change(source) {
      return source.replaceAll("[IO.FileAttributes]::ReparsePoint", "0");
    },
    error: /ReparsePoint/,
  },
  {
    name: "signature timestamp guard is removed",
    change(source) {
      return source.replace("TimeStamperCertificate", "IgnoredTimestamp");
    },
    error: /TimeStamperCertificate/,
  },
];

test("the Windows custom signer satisfies its fail-closed contract", () => {
  assert.doesNotThrow(() =>
    validateWindowsSigner(readFileSync(windowsSignerPath, "utf8")),
  );
});

for (const mutation of signerMutations) {
  test("Windows signer mutation is rejected: " + mutation.name, () => {
    const source = mutation.change(readFileSync(windowsSignerPath, "utf8"));
    assert.throws(() => validateWindowsSigner(source), mutation.error);
  });
}
