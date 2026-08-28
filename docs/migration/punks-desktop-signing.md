# Punks desktop signing handoff

The protected GitHub environment is `punks-staging-promotion`. Candidate builds
remain drafts until the staging proof, installed-app evidence, promotion dossier
and tranche receipt all exist for the same source SHA.

The workflow has two explicit dispatch scopes:

- `apple-only` builds, notarizes, staples and attests only `macos-arm64` and
  `macos-x64`. It is a diagnostic scope only. It never aggregates, drafts,
  publishes or unblocks a four-platform candidate.
- `full-candidate` retains the closed four-platform contract and is the only
  scope allowed to aggregate and stage a candidate release.

Only one green `full-candidate` run that exercises every installed artifact,
assembles and validates the complete dossier, publishes every immutable proof
and activates the exact verified draft as the non-prerelease GitHub `Latest`
release can unblock the ticket sequence. That final state is what makes the
configured `/releases/latest/download/latest.json` updater endpoint observable.
An Apple-only run is never evidence that Windows signing or a complete
four-platform candidate passed.

## Protected staging fixture and installed driver

The full candidate additionally requires three protected environment secrets.
They are never exposed to the renderer or copied into a proof:

- `PUNKS_PROMOTION_SESSION` — one fresh JSON bundle for the dedicated staging
  Compte Punks, containing its `__Host-punks_session` cookie, bounded metadata
  and revoke-only capability in the closed shape accepted by
  `punks-promotion-session`. The Auth Worker issues it only through the
  operator-protected staging endpoint and binds it to the exact candidate in
  `source_sha`;
- `PUNKS_OPERATOR_PROVISIONING_TOKEN` — the narrow operator credential used
  only to create or replay the source-bound promotion Workspace and drive the
  operator-only authority fault boundary;
- `PUNKS_LIVE_AUTH_MATRIX` — four terminal flow identifiers in the closed
  Google/GitHub × success/cancellation matrix. Every flow is created
  only after the final SHA is deployed and is bound at creation to that SHA and
  the exact staging deployment. The value contains no cookie, verifier,
  provider credential or authentication secret.

The workflow snapshots both values into create-once runner files (`0600` where
the host supports POSIX modes), immediately unsets their environment variables,
installs the Session in the operating-system credential store, and creates the
bounded fixture through public staging contracts. It deletes the Session bundle
before starting the installed driver and attempts the same deletion plus
credential cleanup again on every exit. The resulting fixture contains
coordinates only:
one Workspace, one topic-required Stream, 52 root Messages and one Reply. It
is safe to include in the driver input and contains neither cookie nor operator
credential; the driver and installed application inherit neither raw secret.
The operator file remains readable only by the outer driver process until its
installed observer closes, then is deleted. It never enters Tauri's environment.
The subsequent evidence-sealing step is a separate process boundary: only that
step receives the read-only Cloudflare token needed to reobserve the seven
deployed Worker versions after the installed transcript has closed.

After the installed run, `installed-artifact-scan.mjs` reads the exact native
executable, updater artifact, complete extracted installation and embedded
runtime-asset manifest with the closed legacy-marker policy. Its raw report
becomes a content-addressed subject for that platform; the aggregate scan cites
all four reports, and the final dossier recomputes their hashes against the
candidate manifest instead of accepting a platform/hash/size declaration.

`exercise-installed-social-loop.mjs` accepts no transcript, driver path,
remote adapter or skip flag. The reviewed platform driver must install and
exercise the exact updater artifact, emit UI/IPC/public-contract observations,
and produce its assigned fault/recovery observations. The macOS adapter builds
its reviewed XCTest bundle and then runs it with `test-without-building`
against the extracted `.app`; Linux and Windows use `tauri-driver` against the
installed native executable. Each adapter starts the platform's real screen
reader (VoiceOver, Orca or the SHA-256-verified portable NVDA) around the whole
installed action and requires a create-only raw log that names the Punks
application. The installed drivers then launch a second independent
Tauri-driver or XCTest process over the same installed bytes, with a fresh
native screen-reader process and separate IPC, network, asset and interaction
logs. That process repeats native Tab focus traversal, the compiled 200% text
zoom ceiling, runtime reduced-motion rules, axe/XCTest trees and contrast
captures. Its `manual` observations cite the exact artifact and all five
second-pass log hashes; the platform leg is then covered by GitHub OIDC
provenance. An external human review remains additive when it exists, but
cannot replace or reattribute this independent exact-byte pass.

The startup FOLLOW corpus remains a lower diagnostic only. Promotion consumes
a separate IPC record: the exact Rust client captures real Accepted, Changes,
Ready and post-ready frames received from staging, then derives all ten
adversarial verdicts inside the installed binary. Duplicate, gap, divergence
and crash-before/after-ACK controls use the real captured cursor and payload,
not an embedded fixture. Distributed Session revocation/reconnect remains an
independent live observation. The installed trace is restricted to one native
`operationId`, so concurrent subscriptions cannot be spliced together.

The promotion Session is delivered by exactly one of the three successful
system-browser flows in the live Auth matrix; the helper stores that exact Session
in the operating-system credential store before launch. The proof is read from
the terminal `DesktopAuthFlowDO` and binds provider callback, returned OAuth
state, browser binding, provider PKCE, native verifier, Punk and Session to the
exact Auth Worker version, source SHA and staging deployment. The live Worker
requires success and explicit cancellation for Google and GitHub, and
also performs wrong-state, wrong-browser-binding, wrong-native-PKCE and
retired-passkey-method refusal probes. The closed proof is
`punks.live-staging-auth-matrix-proof.v3`, requested with
`promotion.auth-matrix-proof@3`; old three-provider matrices are rejected.
The compiled ceremony matrix remains diagnostic and cannot replace this proof.

The promotion fault receipt controller remains operator-only for injection and
recovery, but it does not synthesize an authority failure. The T1 matrix contains
only authorities addressed by the installed story; OAuth-internal claims and
transactions are covered by the live Auth proof. Injection is written through
the named binding into the exact Punk, Session, revocation, Workspace, slug,
Conversation or Message-content aggregate from the staging fixture, or into the
Worker-level Erasure/Attestation service target.
The separate Session-authenticated native command then calls that authority RPC;
while the fault is active, the RPC fails from inside the named authority. The
operator token is never inherited by Tauri or its WebView. Each fault remains
closed through the three intermediate recovery receipts and the authority RPC
reopens only after its terminal recovery state. Every recovery recomputes the
real aggregate-state fingerprint and rejects any RPO drift. Every evidence
record includes target, fingerprint, Worker, binding and class. The partition covers
every fault/authority coordinate exactly once across Linux and Windows, while
both macOS legs remain dedicated to their architecture-specific XCTest and
VoiceOver evidence.

After the immutable promotion pair is published, but before the draft can
become `Latest`, `punks.operational-release-head.v1` materializes two signed
executions. Expansion closes `E0…E4`; activation closes `A0…A4`. Every positive
segment, step Reçu, `etape-fermee`, `phase-fermee` and transition Reçu is
chained, content-addressed and signed by both anchored Ed25519 approvers. The
head is published create-only with the draft and in both locked Punks R2
buckets; a missing or reordered step keeps the draft inactive. Timestamps,
conclusions, job IDs and step numbers come from the exact current GitHub Actions
run attempt. Each Reçu also embeds the canonical ten-surface Cloudflare
topology, exact Workers percentages, Workflows/generation, desktop hashes,
bookmarks, DLQ/outboxes/incidents and all 36 production budgets recalculated
with their raw sample counts and required dimensions. A locally generated
timestamp, a self-declared green metric or an insufficient Wilson sample cannot
activate the draft. The candidate calls the provider-owned
`punks-operational-observation.yml` workflow twice. Before any platform can
exercise destructive Session loss, its backend phase reobserves the seven
Workers and performs 10,000 real HTTPS observations against each closed public
authority (`/api/health`, `/api/auth/v1/session`, `/api/v1/punk`), then attests
the secretless report. After all four installed legs are independently
attested, the final phase verifies that report and the exact four-platform
aggregate, derives the closed 43-source set without accepting caller-supplied
samples, and attests every source under the provider workflow's GitHub OIDC
identity for `punksbot/punksbot`, `staging` and the exact source SHA. It
recalculates the v4 manifest and publishes all leaves, the provider bundle and
both manifests under the Indefinite locks. The manifest hash is returned through
the reusable-workflow output and consumed by the same candidate run; no
preconfigured observation variable is accepted. The candidate then rereads the
manifest, bundle and subjects
byte-for-byte from both R2 copies under an Indefinite lock covering the
`operational-observations/` prefix, then verifies every source against that
provider bundle with `gh attestation verify`. Its separate aggregate OIDC bundle
attests incorporation into the exact dossier but never replaces provider
provenance. Legacy v3 manifests, an absent provider bundle, a candidate
self-attestation, a digest or an `observer` label alone are rejected.

Never paste a private key, certificate password or API token into an issue,
commit, workflow input or terminal transcript. Feed values directly to
`gh secret set` over standard input.

## Apple

Create or obtain these two independent materials from the Apple Developer team:

1. A **Developer ID Application** certificate with its private key, exported
   from Keychain Access as a password-protected PKCS#12 (`.p12`). A development,
   App Store distribution or installer-only certificate does not satisfy the
   workflow's Gatekeeper identity check. Apple requires the team's Account
   Holder to create this certificate.
2. A **team** App Store Connect API key (`.p8`), not an individual key, with a
   role that can submit Developer ID builds for notarization, plus its issuer ID
   and key ID. Apple's `notarytool` does not support individual API keys.

Use Apple's official [Developer ID certificate
guide](https://developer.apple.com/help/account/certificates/create-developer-id-certificates)
and [App Store Connect API
guide](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api)
for those two operations.

Install them without printing their contents:

```sh
base64 < DeveloperIDApplication.p12 | tr -d '\n' \
  | gh secret set PUNKS_APPLE_CERTIFICATE \
      --repo punksbot/punksbot --env punks-staging-promotion
printf '%s' "$APPLE_P12_PASSWORD" \
  | gh secret set PUNKS_APPLE_CERTIFICATE_PASSWORD \
      --repo punksbot/punksbot --env punks-staging-promotion
printf '%s' "$APPLE_API_ISSUER" \
  | gh secret set PUNKS_APPLE_API_ISSUER \
      --repo punksbot/punksbot --env punks-staging-promotion
printf '%s' "$APPLE_API_KEY_ID" \
  | gh secret set PUNKS_APPLE_API_KEY \
      --repo punksbot/punksbot --env punks-staging-promotion
gh secret set PUNKS_APPLE_API_PRIVATE_KEY \
  --repo punksbot/punksbot --env punks-staging-promotion \
  < AuthKey_${APPLE_API_KEY_ID}.p8
```

The workflow imports the `.p12` into an ephemeral keychain, extracts the exact
`Developer ID Application: … (TEAMID)` identity, signs both macOS architectures,
lets Tauri notarize and staple each `.app`, then explicitly submits and staples
each DMG with `notarytool`. It requires `codesign`, Gatekeeper and stapler
verification on both the app and disk image.

## Windows

Do not buy or export a production code-signing PFX for this workflow. The
CA/Browser Forum requires publicly trusted code-signing private keys issued
since 1 June 2023 to remain in a qualifying hardware crypto module. Punks uses
Microsoft Azure Artifact Signing (formerly Trusted Signing), whose Public Trust
profile keeps the key in its managed HSM and exposes only a signing operation to
the Windows runner.

The governing requirements and setup references are the [CA/Browser Forum Code
Signing Baseline
Requirements](https://cabforum.org/working-groups/code-signing/requirements/),
Microsoft's [Artifact Signing
quickstart](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart),
[resource and role
reference](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-resources-roles),
and the pinned [Azure Artifact Signing GitHub
Action](https://github.com/Azure/artifact-signing-action).

Provision the service:

1. Create an Azure Artifact Signing account in a supported region.
2. Complete a **Public** organization or individual identity validation.
3. Create a **Public Trust** certificate profile.
4. Create a Microsoft Entra application, grant its service principal the
   `Artifact Signing Certificate Profile Signer` role at the narrowest
   practical scope, and configure a GitHub Actions federated identity for the
   final repository/environment. Do not create a client secret.
5. Record the subscription ID, tenant ID, client ID, regional endpoint, account
   name and certificate profile name.
6. Sign one disposable executable with that profile, inspect its certificate,
   and record the exact subscriber identity validation EKU. It starts with
   `1.3.6.1.4.1.311.97.` but is not the generic Public Trust marker
   `1.3.6.1.4.1.311.97.1.0`:

   ```powershell
   $certificate = (Get-AuthenticodeSignature .\signed-sample.exe).SignerCertificate
   $identityEku = @(
     $certificate.EnhancedKeyUsageList.ObjectId |
       Where-Object {
         $_ -like "1.3.6.1.4.1.311.97.*" -and
         $_ -ne "1.3.6.1.4.1.311.97.1.0"
       }
   )
   if ($identityEku.Count -ne 1) {
     throw "Expected one durable Artifact Signing identity EKU"
   }
   $identityEku[0]
   ```

   This OID is public identity metadata, not a credential. Microsoft renews the
   leaf signing certificate daily, so its subject, public key and thumbprint are
   not durable values to pin.

Bind the Entra application to the exact environment subject
`repo:punksbot/punksbot:environment:punks-staging-promotion`. Install the three
non-secret Azure identifiers as protected environment secrets:

```sh
printf '%s' "$AZURE_TENANT_ID" \
  | gh secret set PUNKS_AZURE_TENANT_ID \
      --repo punksbot/punksbot --env punks-staging-promotion
printf '%s' "$AZURE_CLIENT_ID" \
  | gh secret set PUNKS_AZURE_CLIENT_ID \
      --repo punksbot/punksbot --env punks-staging-promotion
printf '%s' "$AZURE_SUBSCRIPTION_ID" \
  | gh secret set PUNKS_AZURE_SUBSCRIPTION_ID \
      --repo punksbot/punksbot --env punks-staging-promotion
```

Install the four non-secret resource coordinates as protected environment
variables:

```sh
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT \
  --body "$AZURE_ARTIFACT_SIGNING_ENDPOINT" \
  --repo punksbot/punksbot --env punks-staging-promotion
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT \
  --body "$AZURE_ARTIFACT_SIGNING_ACCOUNT" \
  --repo punksbot/punksbot --env punks-staging-promotion
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE \
  --body "$AZURE_ARTIFACT_SIGNING_PROFILE" \
  --repo punksbot/punksbot --env punks-staging-promotion
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU \
  --body "$AZURE_ARTIFACT_SIGNING_IDENTITY_EKU" \
  --repo punksbot/punksbot --env punks-staging-promotion
```

The workflow builds the native executable without bundling and signs that
standalone binary through the pinned HSM-backed action. Tauri patches a separate
copy of the executable for each NSIS/MSI bundle type, so its custom `signCommand`
invokes the same managed service after every patch and while generating the NSIS
uninstaller; Tauri also invokes it on the completed NSIS and MSI containers.
The signer refuses paths outside the six closed artifact roles before contacting the
HSM. It additionally permits and signs exactly the five NSIS plugin DLLs and two
WiX extension DLLs used by the pinned Tauri CLI, and rejects any other DLL. The
static Tauri overlay
`desktop/src-tauri/tauri.punks.windows-signing.conf.json` fixes the complete
`pwsh -File … %1` command structurally instead of generating it from workflow
text. Every HSM call is appended to a create-once ledger. The workflow requires
exactly two patched-main signatures, five NSIS plugin signatures, two WiX
extension signatures and one each for the NSIS uninstaller, NSIS installer and
MSI installer. It then compares every stable path and digest to the exact
allowlist and validates that exactly the two expected installer outputs exist.
Tauri restores the standalone executable after each bundle, so the workflow
first proves that its pre/post-bundle digest is unchanged; after installing NSIS
and administratively extracting MSI, it matches the two installed executable
digests exactly to the two transient `patched-main` ledger digests.
NSIS creates its intermediate uninstaller below `%TEMP%`. The workflow binds
both `TEMP` and `TMP` to a fresh dedicated directory below `RUNNER_TEMP` and
passes that exact root to the custom signer. This keeps the temporary
`nstXXXX.tmp` PE file inside the same closed path contract as the release tree.
Before real credentials are exposed, the Windows leg executes
`scripts/windows-artifact-sign.test.ps1` against a fake version-pinned
Artifact Signing module. The behavioral harness proves every permitted role,
one HSM call per file, and fail-closed behavior for missing configuration,
unexpected paths, invalid signatures, missing timestamps and wrong EKUs.
Because Authenticode changes the installer bytes, it regenerates their Tauri
updater signatures afterwards. Finally, it silently installs NSIS, performs an
MSI administrative extraction, and verifies the standalone executable, both
installer containers, both installed executable variants and the NSIS
uninstaller. Every checked file must have a valid Code Signing EKU, the Public
Trust marker, the exact durable subscriber identity EKU and an RFC 3161
timestamp. The standalone executable's short-lived certificate thumbprint is
retained only as audit data. A self-signed or privately trusted PFX remains
suitable only for isolated testing and does not satisfy this candidate
workflow. See Microsoft's [certificate management
guide](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-certificate-management)
for the daily renewal and durable identity EKU contract.

## Remote staging proof

The same environment also needs `PUNKS_CLOUDFLARE_API_TOKEN`, scoped to read
Worker scripts, versions and deployments for the canonical Punks account. The
workflow reobserves Cloudflare remotely and refuses an arbitrary or stale
deployment digest.

After every value is installed, list names and timestamps without reading any
secret value:

```sh
gh secret list --repo punksbot/punksbot
gh secret list --repo punksbot/punksbot --env punks-staging-promotion
gh variable list --repo punksbot/punksbot --env punks-staging-promotion
```

At this handoff, the Tauri updater and Linux GPG secrets already exist at
repository scope. GitHub cannot reveal or copy those values. To narrow them to
the protected environment, re-enter the same four values there and only then
delete the repository-scoped duplicates:

- `PUNKS_TAURI_SIGNING_PRIVATE_KEY`
- `PUNKS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `PUNKS_LINUX_GPG_PRIVATE_KEY`
- `PUNKS_LINUX_GPG_PASSPHRASE`
