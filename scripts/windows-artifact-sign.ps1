[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateNotNullOrEmpty()]
  [string]$Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$requiredEnvironment = @(
  "PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT",
  "PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT",
  "PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE",
  "PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU",
  "PUNKS_WINDOWS_MAIN_BINARY",
  "PUNKS_WINDOWS_RELEASE_ROOT",
  "PUNKS_WINDOWS_SIGNING_LEDGER",
  "PUNKS_WINDOWS_NSIS_TEMP",
  "GITHUB_WORKSPACE",
  "RUNNER_TEMP"
)
foreach ($name in $requiredEnvironment) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required Artifact Signing environment value: $name"
  }
}

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$artifact = Get-Item -LiteralPath $resolvedPath
if ($artifact.PSIsContainer) {
  throw "Artifact Signing accepts a file, not a directory"
}
if ($artifact.Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw "Artifact Signing refuses reparse points"
}

function Test-ContainedPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Child,
    [Parameter(Mandatory = $true)]
    [string]$Parent
  )

  $relative = [IO.Path]::GetRelativePath($Parent, $Child)
  $parentPrefix = "..$([IO.Path]::DirectorySeparatorChar)"
  return (
    $relative -ne ".." -and
    -not $relative.StartsWith($parentPrefix, [StringComparison]::Ordinal) -and
    -not [IO.Path]::IsPathRooted($relative)
  )
}

$mainBinary = (Resolve-Path -LiteralPath $env:PUNKS_WINDOWS_MAIN_BINARY).Path
$releaseRoot = (Resolve-Path -LiteralPath $env:PUNKS_WINDOWS_RELEASE_ROOT).Path
$ledgerPath = (Resolve-Path -LiteralPath $env:PUNKS_WINDOWS_SIGNING_LEDGER).Path
$workspaceRoot = (Resolve-Path -LiteralPath $env:GITHUB_WORKSPACE).Path
$runnerTemp = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$nsisTemp = (Resolve-Path -LiteralPath $env:PUNKS_WINDOWS_NSIS_TEMP).Path
$expectedMainBinary = Join-Path $releaseRoot "punks-bot-staging.exe"
$expectedLedgerPath = Join-Path $runnerTemp "punks-windows-signing-ledger.jsonl"
$expectedNsisTemp = Join-Path $runnerTemp "punks-nsis-temp"
if (-not $mainBinary.Equals($expectedMainBinary, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The Windows main-binary contract does not name punks-bot-staging.exe"
}
if (-not $ledgerPath.Equals($expectedLedgerPath, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The Windows signing ledger is outside its canonical runner path"
}
if (-not $nsisTemp.Equals($expectedNsisTemp, [StringComparison]::OrdinalIgnoreCase)) {
  throw "The NSIS temporary signing root is outside its canonical runner path"
}
if (-not (Test-ContainedPath -Child $releaseRoot -Parent $workspaceRoot)) {
  throw "The generated Windows release tree is outside GITHUB_WORKSPACE"
}
$ledger = Get-Item -LiteralPath $ledgerPath
if ($ledger.PSIsContainer -or $ledger.Attributes -band [IO.FileAttributes]::ReparsePoint) {
  throw "Artifact Signing ledger must be one regular file"
}
$nsisTempItem = Get-Item -LiteralPath $nsisTemp
if (
  -not $nsisTempItem.PSIsContainer -or
  $nsisTempItem.Attributes -band [IO.FileAttributes]::ReparsePoint -or
  -not (Test-ContainedPath -Child $nsisTemp -Parent $runnerTemp)
) {
  throw "NSIS temporary signing root must be one real directory under RUNNER_TEMP"
}

$nsisRoot = Join-Path $releaseRoot "bundle/nsis"
$msiRoot = Join-Path $releaseRoot "bundle/msi"
$relativeReleasePath = if (Test-ContainedPath -Child $resolvedPath -Parent $releaseRoot) {
  [IO.Path]::GetRelativePath($releaseRoot, $resolvedPath).Replace("/", "\").ToLowerInvariant()
} else {
  $null
}
$nsisPluginPaths = @(
  "nsis\x64\plugins\x86-unicode\nsisdl.dll",
  "nsis\x64\plugins\x86-unicode\startmenu.dll",
  "nsis\x64\plugins\x86-unicode\system.dll",
  "nsis\x64\plugins\x86-unicode\nsdialogs.dll",
  "nsis\x64\plugins\x86-unicode\additional\nsis_tauri_utils.dll"
)
$wixExtensionPaths = @(
  "wix\x64\wix\wixuiextension.dll",
  "wix\x64\wix\wixutilextension.dll"
)
$artifactParent = [IO.Path]::GetDirectoryName($resolvedPath)
$role = if ($resolvedPath.Equals($mainBinary, [StringComparison]::OrdinalIgnoreCase)) {
  "patched-main"
} elseif (
  $null -ne $relativeReleasePath -and
  $nsisPluginPaths -contains $relativeReleasePath
) {
  "nsis-plugin"
} elseif (
  $null -ne $relativeReleasePath -and
  $wixExtensionPaths -contains $relativeReleasePath
) {
  "wix-extension"
} elseif (
  $artifactParent.Equals($nsisRoot, [StringComparison]::OrdinalIgnoreCase) -and
  $artifact.Name -like "*-setup.exe"
) {
  "nsis-installer"
} elseif (
  $artifactParent.Equals($msiRoot, [StringComparison]::OrdinalIgnoreCase) -and
  $artifact.Extension -ieq ".msi"
) {
  "msi-installer"
} elseif (
  $artifactParent.Equals($nsisTemp, [StringComparison]::OrdinalIgnoreCase) -and
  $artifact.Name -match "^nst[0-9A-F]{4}\.tmp$"
) {
  "nsis-uninstaller"
} else {
  throw "Tauri requested signing outside the closed Windows artifact roles"
}

$expectedIdentityEku = $env:PUNKS_AZURE_ARTIFACT_SIGNING_IDENTITY_EKU
if (
  $expectedIdentityEku -notmatch "^1\.3\.6\.1\.4\.1\.311\.97\.(?:[0-9]+\.)*[0-9]+$" -or
  $expectedIdentityEku -eq "1.3.6.1.4.1.311.97.1.0"
) {
  throw "The exact Artifact Signing durable identity EKU is required"
}

Import-Module ArtifactSigning -RequiredVersion 0.1.8

$parameters = @{
  Endpoint = $env:PUNKS_AZURE_ARTIFACT_SIGNING_ENDPOINT
  CodeSigningAccountName = $env:PUNKS_AZURE_ARTIFACT_SIGNING_ACCOUNT
  CertificateProfileName = $env:PUNKS_AZURE_ARTIFACT_SIGNING_PROFILE
  Files = $resolvedPath
  FileDigest = "SHA256"
  TimestampRfc3161 = "http://timestamp.acs.microsoft.com"
  TimestampDigest = "SHA256"
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
Invoke-ArtifactSigning @parameters

$signature = Get-AuthenticodeSignature -LiteralPath $resolvedPath
if ($signature.Status -ne "Valid") {
  throw "Artifact Signing produced an invalid signature: $resolvedPath"
}
if ($null -eq $signature.TimeStamperCertificate) {
  throw "Artifact Signing produced a signature without a timestamp: $resolvedPath"
}
$ekuExtensions = @(
  $signature.SignerCertificate.Extensions |
    Where-Object { $_.Oid.Value -eq "2.5.29.37" }
)
if ($ekuExtensions.Count -ne 1) {
  throw "Artifact Signing produced no unique extended key usage extension"
}
$eku = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]$ekuExtensions[0]
$ekuOids = @($eku.EnhancedKeyUsages | ForEach-Object { $_.Value })
foreach ($requiredEku in @(
  "1.3.6.1.5.5.7.3.3",
  "1.3.6.1.4.1.311.97.1.0",
  $expectedIdentityEku
)) {
  if ($ekuOids -notcontains $requiredEku) {
    throw "Artifact Signing produced the wrong identity or usage EKU"
  }
}

$entry = [ordered]@{
  role = $role
  path = $resolvedPath
  sha256 = (Get-FileHash -LiteralPath $resolvedPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$entryJson = $entry | ConvertTo-Json -Compress
$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::AppendAllText(
  $ledgerPath,
  $entryJson + [Environment]::NewLine,
  $utf8NoBom
)
