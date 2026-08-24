[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Contract {
  param(
    [Parameter(Mandatory = $true)]
    [bool]$Condition,
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  if (-not $Condition) {
    throw $Message
  }
}

$signerPath = (Resolve-Path (Join-Path $PSScriptRoot "windows-artifact-sign.ps1")).Path
$testRoot = Join-Path ([IO.Path]::GetTempPath()) "punks-windows-signer-$([guid]::NewGuid().ToString('N'))"
$workspaceRoot = Join-Path $testRoot "workspace"
$releaseRoot = Join-Path $workspaceRoot "desktop/src-tauri/target/x86_64-pc-windows-msvc/release"
$runnerTemp = Join-Path $testRoot "runner"
$nsisTemp = Join-Path $runnerTemp "punks-nsis-temp"
$ledgerPath = Join-Path $runnerTemp "punks-windows-signing-ledger.jsonl"
$hsmLogPath = Join-Path $runnerTemp "fake-hsm.log"
$moduleRoot = Join-Path $testRoot "modules"
$moduleVersionRoot = Join-Path $moduleRoot "ArtifactSigning/0.1.8"
$mainBinary = Join-Path $releaseRoot "punks-bot-staging.exe"
$identityEku = "1.3.6.1.4.1.311.97.42.7"

$environmentNames = @(
  "PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE",
  "PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU",
  "PUNKS_WINDOWS_MAIN_BINARY",
  "PUNKS_WINDOWS_RELEASE_ROOT",
  "PUNKS_WINDOWS_SIGNING_LEDGER",
  "PUNKS_WINDOWS_NSIS_TEMP",
  "GITHUB_WORKSPACE",
  "RUNNER_TEMP",
  "PUNKS_WINDOWS_FAKE_HSM_LOG",
  "PUNKS_WINDOWS_FAKE_EXPECTED_FILE",
  "PUNKS_WINDOWS_FAKE_SIGNATURE_MODE"
)
$savedEnvironment = @{}
foreach ($name in $environmentNames) {
  $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name)
}
$savedModulePath = $env:PSModulePath

function Write-TestFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $parent = Split-Path -Parent $Path
  [void](New-Item -ItemType Directory -Path $parent -Force)
  [IO.File]::WriteAllBytes($Path, [byte[]](0x4d, 0x5a, 0x90, 0x00))
  return (Resolve-Path -LiteralPath $Path).Path
}

function Reset-ProofFiles {
  [IO.File]::WriteAllText($ledgerPath, "")
  [IO.File]::WriteAllText($hsmLogPath, "")
  $env:PUNKS_WINDOWS_FAKE_SIGNATURE_MODE = "valid"
}

function HsmCalls {
  return @(
    Get-Content -LiteralPath $hsmLogPath |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )
}

function LedgerEntries {
  return @(
    Get-Content -LiteralPath $ledgerPath |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      ForEach-Object { $_ | ConvertFrom-Json }
  )
}

function Assert-AllowedRole {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Role
  )

  Reset-ProofFiles
  $env:PUNKS_WINDOWS_FAKE_EXPECTED_FILE = $Path
  $beforeDigest = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  & $signerPath $Path
  $calls = @(HsmCalls)
  $entries = @(LedgerEntries)
  $afterDigest = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
  Assert-Contract ($calls.Count -eq 1) "Allowed role $Role did not invoke the HSM exactly once"
  Assert-Contract (
    [IO.Path]::GetFullPath($calls[0]).Equals(
      [IO.Path]::GetFullPath($Path),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) "Fake HSM received a path other than the requested artifact"
  Assert-Contract ($afterDigest -ne $beforeDigest) "Fake HSM did not mutate the signed artifact"
  Assert-Contract ($entries.Count -eq 1) "Allowed role $Role did not emit exactly one ledger entry"
  Assert-Contract ($entries[0].role -eq $Role) "Allowed path was classified as $($entries[0].role), expected $Role"
  Assert-Contract (
    [IO.Path]::GetFullPath($entries[0].path).Equals(
      [IO.Path]::GetFullPath($Path),
      [StringComparison]::OrdinalIgnoreCase
    )
  ) "Ledger path differs from the exact HSM input"
  Assert-Contract (
    $entries[0].sha256 -eq $afterDigest
  ) "Ledger digest was not computed from the post-signature artifact"
}

function Assert-Rejected {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$MessagePattern,
    [Parameter(Mandatory = $true)][int]$ExpectedHsmCalls,
    [string]$SignatureMode = "valid"
  )

  Reset-ProofFiles
  $env:PUNKS_WINDOWS_FAKE_SIGNATURE_MODE = $SignatureMode
  $caught = $null
  try {
    & $Action
  } catch {
    $caught = $_
  }
  Assert-Contract ($null -ne $caught) "Expected signer rejection did not occur"
  Assert-Contract (
    $caught.Exception.Message -match $MessagePattern
  ) "Signer rejected for an unexpected reason: $($caught.Exception.Message)"
  Assert-Contract (
    @(HsmCalls).Count -eq $ExpectedHsmCalls
  ) "Rejected signer case invoked the HSM an unexpected number of times"
  Assert-Contract (@(LedgerEntries).Count -eq 0) "Rejected signer case emitted a ledger entry"
}

try {
  [void](New-Item -ItemType Directory -Path $moduleVersionRoot, $releaseRoot, $runnerTemp, $nsisTemp -Force)
  [IO.File]::WriteAllText($ledgerPath, "")
  [IO.File]::WriteAllText($hsmLogPath, "")

  $moduleManifest = @'
@{
  RootModule = 'ArtifactSigning.psm1'
  ModuleVersion = '0.1.8'
  GUID = 'af425b9d-4fb4-43fb-a721-53754297da16'
  FunctionsToExport = @('Invoke-ArtifactSigning')
}
'@
  $moduleImplementation = @'
function Invoke-ArtifactSigning {
  [CmdletBinding()]
  param(
    [string]$Endpoint,
    [string]$CodeSigningAccountName,
    [string]$CertificateProfileName,
    [string[]]$Files,
    [string]$FileDigest,
    [string]$TimestampRfc3161,
    [string]$TimestampDigest,
    [bool]$ExcludeEnvironmentCredential,
    [bool]$ExcludeWorkloadIdentityCredential,
    [bool]$ExcludeManagedIdentityCredential,
    [bool]$ExcludeSharedTokenCacheCredential,
    [bool]$ExcludeVisualStudioCredential,
    [bool]$ExcludeVisualStudioCodeCredential,
    [bool]$ExcludeAzureCliCredential,
    [bool]$ExcludeAzurePowerShellCredential,
    [bool]$ExcludeAzureDeveloperCliCredential,
    [bool]$ExcludeInteractiveBrowserCredential
  )
  $expectedContract = [ordered]@{
    Endpoint = 'https://example.invalid'
    CodeSigningAccountName = 'fake-account'
    CertificateProfileName = 'fake-profile'
    FileDigest = 'SHA256'
    TimestampRfc3161 = 'http://timestamp.acs.microsoft.com'
    TimestampDigest = 'SHA256'
    ExcludeEnvironmentCredential = $true
    ExcludeWorkloadIdentityCredential = $true
    ExcludeManagedIdentityCredential = $true
    ExcludeSharedTokenCacheCredential = $true
    ExcludeVisualStudioCredential = $true
    ExcludeVisualStudioCodeCredential = $true
    ExcludeAzureCliCredential = $false
    ExcludeAzurePowerShellCredential = $true
    ExcludeAzureDeveloperCliCredential = $true
    ExcludeInteractiveBrowserCredential = $true
  }
  foreach ($expected in $expectedContract.GetEnumerator()) {
    if ($PSBoundParameters[$expected.Key] -ne $expected.Value) {
      throw "Fake HSM received an invalid $($expected.Key) parameter"
    }
  }
  if ($Files.Count -ne 1) {
    throw 'Fake HSM requires exactly one input file'
  }
  $actualFile = (Resolve-Path -LiteralPath $Files[0]).Path
  $expectedFile = (Resolve-Path -LiteralPath $env:PUNKS_WINDOWS_FAKE_EXPECTED_FILE).Path
  if (-not $actualFile.Equals($expectedFile, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Fake HSM received a file other than the requested artifact'
  }
  [IO.File]::AppendAllText($actualFile, '::fake-authenticode::')
  [IO.File]::AppendAllText(
    $env:PUNKS_WINDOWS_FAKE_HSM_LOG,
    $actualFile + [Environment]::NewLine
  )
}
Export-ModuleMember -Function Invoke-ArtifactSigning
'@
  [IO.File]::WriteAllText(
    (Join-Path $moduleVersionRoot "ArtifactSigning.psd1"),
    $moduleManifest
  )
  [IO.File]::WriteAllText(
    (Join-Path $moduleVersionRoot "ArtifactSigning.psm1"),
    $moduleImplementation
  )
  $env:PSModulePath = "$moduleRoot$([IO.Path]::PathSeparator)$savedModulePath"

  function global:Get-AuthenticodeSignature {
    param([Parameter(Mandatory = $true)][string]$LiteralPath)

    $oids = [System.Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.5.5.7.3.3"))
    [void]$oids.Add([System.Security.Cryptography.Oid]::new("1.3.6.1.4.1.311.97.1.0"))
    if ($env:PUNKS_WINDOWS_FAKE_SIGNATURE_MODE -ne "wrong-eku") {
      [void]$oids.Add(
        [System.Security.Cryptography.Oid]::new(
          $env:PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU
        )
      )
    }
    $eku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new(
      $oids,
      $false
    )
    return [pscustomobject]@{
      Status = if ($env:PUNKS_WINDOWS_FAKE_SIGNATURE_MODE -eq "invalid") {
        "HashMismatch"
      } else {
        "Valid"
      }
      TimeStamperCertificate = if (
        $env:PUNKS_WINDOWS_FAKE_SIGNATURE_MODE -eq "missing-timestamp"
      ) {
        $null
      } else {
        [pscustomobject]@{ Thumbprint = "FAKE-TIMESTAMP" }
      }
      SignerCertificate = [pscustomobject]@{
        Extensions = @($eku)
        Thumbprint = "FAKE-SIGNER"
      }
    }
  }

  $env:PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT = "https://example.invalid"
  $env:PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT = "fake-account"
  $env:PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE = "fake-profile"
  $env:PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU = $identityEku
  $env:PUNKS_WINDOWS_MAIN_BINARY = $mainBinary
  $env:PUNKS_WINDOWS_RELEASE_ROOT = $releaseRoot
  $env:PUNKS_WINDOWS_SIGNING_LEDGER = $ledgerPath
  $env:PUNKS_WINDOWS_NSIS_TEMP = $nsisTemp
  $env:GITHUB_WORKSPACE = $workspaceRoot
  $env:RUNNER_TEMP = $runnerTemp
  $env:PUNKS_WINDOWS_FAKE_HSM_LOG = $hsmLogPath
  $env:PUNKS_WINDOWS_FAKE_SIGNATURE_MODE = "valid"

  $allowedPaths = [ordered]@{
    "patched-main" = @($mainBinary)
    "nsis-plugin" = @(
      (Join-Path $releaseRoot "nsis/x64/Plugins/x86-unicode/NSISdl.dll"),
      (Join-Path $releaseRoot "nsis/x64/Plugins/x86-unicode/StartMenu.dll"),
      (Join-Path $releaseRoot "nsis/x64/Plugins/x86-unicode/System.dll"),
      (Join-Path $releaseRoot "nsis/x64/Plugins/x86-unicode/nsDialogs.dll"),
      (Join-Path $releaseRoot "nsis/x64/Plugins/x86-unicode/additional/nsis_tauri_utils.dll")
    )
    "wix-extension" = @(
      (Join-Path $releaseRoot "wix/x64/wix/WixUIExtension.dll"),
      (Join-Path $releaseRoot "wix/x64/wix/WixUtilExtension.dll")
    )
    "nsis-installer" = @((Join-Path $releaseRoot "bundle/nsis/Punks.Bot_0.1.0_x64-setup.exe"))
    "msi-installer" = @((Join-Path $releaseRoot "bundle/msi/Punks.Bot_0.1.0_x64_en-US.msi"))
    "nsis-uninstaller" = @((Join-Path $nsisTemp "nstA42F.tmp"))
  }
  foreach ($role in $allowedPaths.Keys) {
    foreach ($path in $allowedPaths[$role]) {
      [void](Write-TestFile $path)
      Assert-AllowedRole $path $role
    }
  }

  $unexpectedDll = Write-TestFile (Join-Path $releaseRoot "unexpected.dll")
  Assert-Rejected { & $signerPath $unexpectedDll } "outside the closed Windows artifact roles" 0
  $misplacedPlugin = Write-TestFile (Join-Path $releaseRoot "nsis/x64/NSISdl.dll")
  Assert-Rejected { & $signerPath $misplacedPlugin } "outside the closed Windows artifact roles" 0
  $unexpectedExe = Write-TestFile (Join-Path $releaseRoot "unexpected.exe")
  Assert-Rejected { & $signerPath $unexpectedExe } "outside the closed Windows artifact roles" 0
  $wrongTemporaryName = Write-TestFile (Join-Path $nsisTemp "uninstaller.tmp")
  Assert-Rejected { & $signerPath $wrongTemporaryName } "outside the closed Windows artifact roles" 0
  $otherTemporaryRoot = Join-Path $runnerTemp "other-temp"
  $misplacedTemporary = Write-TestFile (Join-Path $otherTemporaryRoot "nstA42F.tmp")
  Assert-Rejected { & $signerPath $misplacedTemporary } "outside the closed Windows artifact roles" 0
  $nestedTemporary = Write-TestFile (Join-Path $nsisTemp "nested/nstA42F.tmp")
  Assert-Rejected { & $signerPath $nestedTemporary } "outside the closed Windows artifact roles" 0

  $savedEndpoint = $env:PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT
  $env:PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT = $null
  Assert-Rejected { & $signerPath $mainBinary } "Missing required Artifact Signing environment value" 0
  $env:PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT = $savedEndpoint

  $env:PUNKS_WINDOWS_FAKE_EXPECTED_FILE = $mainBinary
  Assert-Rejected { & $signerPath $mainBinary } "invalid signature" 1 "invalid"
  Assert-Rejected { & $signerPath $mainBinary } "without a timestamp" 1 "missing-timestamp"
  Assert-Rejected { & $signerPath $mainBinary } "wrong identity or usage EKU" 1 "wrong-eku"

  Write-Output "Windows Artifact Signing behavioral contract OK"
} finally {
  Remove-Module ArtifactSigning -Force -ErrorAction SilentlyContinue
  Remove-Item Function:\global:Get-AuthenticodeSignature -Force -ErrorAction SilentlyContinue
  $env:PSModulePath = $savedModulePath
  foreach ($name in $environmentNames) {
    [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name])
  }
  if (Test-Path -LiteralPath $testRoot) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
  }
}

# Expected negative signer probes invoke native commands that deliberately
# return 1. Reset the automatic process status after every assertion passed so
# callers observe the test suite's result instead of the final probe's result.
$global:LASTEXITCODE = 0
