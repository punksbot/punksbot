# Punks desktop signing handoff

The protected GitHub environment is `punks-staging-promotion`. Candidate builds
remain drafts until the staging proof, installed-app evidence, promotion dossier
and tranche receipt all exist for the same source SHA.

The workflow has two explicit dispatch scopes:

- `apple-only` builds, notarizes, staples and attests only `macos-arm64` and
  `macos-x64`. It is the default validation scope while Windows Artifact
  Signing remains deferred. It never aggregates, drafts or publishes a
  four-platform candidate.
- `full-candidate` retains the closed four-platform contract and is the only
  scope allowed to aggregate and stage a candidate release.

The maintainer decision of 2026-08-24 permits Apple-only evidence to unblock
the current ticket sequence. This exception must be recorded as an explicit
Windows deferral; an Apple-only run is never evidence that Windows signing or a
complete four-platform candidate passed.

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
      --repo mabzadev/punksbot --env punks-staging-promotion
printf '%s' "$APPLE_P12_PASSWORD" \
  | gh secret set PUNKS_APPLE_CERTIFICATE_PASSWORD \
      --repo mabzadev/punksbot --env punks-staging-promotion
printf '%s' "$APPLE_API_ISSUER" \
  | gh secret set PUNKS_APPLE_API_ISSUER \
      --repo mabzadev/punksbot --env punks-staging-promotion
printf '%s' "$APPLE_API_KEY_ID" \
  | gh secret set PUNKS_APPLE_API_KEY \
      --repo mabzadev/punksbot --env punks-staging-promotion
gh secret set PUNKS_APPLE_API_PRIVATE_KEY \
  --repo mabzadev/punksbot --env punks-staging-promotion \
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

After the final GitHub owner/repository name is known, bind the Entra
application to the exact environment subject
`repo:<owner>/<repo>:environment:punks-staging-promotion`. Install the three
non-secret Azure identifiers as protected environment secrets:

```sh
printf '%s' "$AZURE_TENANT_ID" \
  | gh secret set PUNKS_AZURE_TENANT_ID \
      --repo mabzadev/punksbot --env punks-staging-promotion
printf '%s' "$AZURE_CLIENT_ID" \
  | gh secret set PUNKS_AZURE_CLIENT_ID \
      --repo mabzadev/punksbot --env punks-staging-promotion
printf '%s' "$AZURE_SUBSCRIPTION_ID" \
  | gh secret set PUNKS_AZURE_SUBSCRIPTION_ID \
      --repo mabzadev/punksbot --env punks-staging-promotion
```

Install the four non-secret resource coordinates as protected environment
variables:

```sh
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT \
  --body "$AZURE_ARTIFACT_SIGNING_ENDPOINT" \
  --repo mabzadev/punksbot --env punks-staging-promotion
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT \
  --body "$AZURE_ARTIFACT_SIGNING_ACCOUNT" \
  --repo mabzadev/punksbot --env punks-staging-promotion
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE \
  --body "$AZURE_ARTIFACT_SIGNING_PROFILE" \
  --repo mabzadev/punksbot --env punks-staging-promotion
gh variable set PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU \
  --body "$AZURE_ARTIFACT_SIGNING_IDENTITY_EKU" \
  --repo mabzadev/punksbot --env punks-staging-promotion
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
gh secret list --repo mabzadev/punksbot
gh secret list --repo mabzadev/punksbot --env punks-staging-promotion
gh variable list --repo mabzadev/punksbot --env punks-staging-promotion
```

At this handoff, the Tauri updater and Linux GPG secrets already exist at
repository scope. GitHub cannot reveal or copy those values. To narrow them to
the protected environment, re-enter the same four values there and only then
delete the repository-scoped duplicates:

- `PUNKS_TAURI_SIGNING_PRIVATE_KEY`
- `PUNKS_TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- `PUNKS_LINUX_GPG_PRIVATE_KEY`
- `PUNKS_LINUX_GPG_PASSPHRASE`
