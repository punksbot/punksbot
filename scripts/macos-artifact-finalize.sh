#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'macOS artifact finalization failed: %s\n' "$1" >&2
  exit 1
}

require_environment() {
  local name="$1"
  [[ -n "${!name:-}" ]] || fail "missing required environment value: $name"
}

require_one() {
  local root="$1"
  local kind="$2"
  local pattern="$3"
  local artifact_type="$4"
  local count
  local path

  count="$(find "$root" -maxdepth 1 -name "$pattern" -type "$artifact_type" | wc -l | tr -d ' ')"
  [[ "$count" = "1" ]] || fail "expected exactly one $kind under $root, found $count"
  path="$(find "$root" -maxdepth 1 -name "$pattern" -type "$artifact_type")"
  [[ ! -L "$path" ]] || fail "$kind must not be a symbolic link"
  printf '%s\n' "$path"
}

notarize_and_staple() {
  local submission="$1"
  local subject="$2"
  local label="$3"
  local submit_result="$temporary_root/${label}-notarization-submit.json"
  local wait_result="$temporary_root/${label}-notarization-wait.json"
  local status
  local submission_id
  local wait_status

  xcrun notarytool submit "$submission" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --no-wait --output-format json > "$submit_result"

  submission_id="$(jq -er '.id | select(type == "string")' "$submit_result")"
  [[ "$submission_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || fail "$label notarization returned an invalid submission ID"
  printf '%s notarization submitted (%s)\n' "$label" "$submission_id"

  set +e
  xcrun notarytool wait "$submission_id" \
    --key "$APPLE_API_KEY_PATH" \
    --key-id "$APPLE_API_KEY" \
    --issuer "$APPLE_API_ISSUER" \
    --timeout "$notary_timeout" --output-format json > "$wait_result"
  wait_status=$?
  set -e
  if (( wait_status != 0 )); then
    status="$(jq -r '.status // "unknown"' "$wait_result" 2>/dev/null || printf unknown)"
    fail "$label notarization $submission_id wait exited $wait_status with status $status"
  fi

  status="$(jq -er '.status' "$wait_result")"
  [[ "$status" = "Accepted" ]] || fail "$label notarization $submission_id ended with status $status"
  printf '%s notarization accepted (%s)\n' "$label" "$submission_id"
  xcrun stapler staple "$subject"
  xcrun stapler validate "$subject"
}

for required_name in \
  APPLE_API_ISSUER \
  APPLE_API_KEY \
  APPLE_API_KEY_PATH \
  APPLE_SIGNING_IDENTITY \
  GITHUB_WORKSPACE \
  RUNNER_TEMP \
  TARGET \
  TAURI_SIGNING_PRIVATE_KEY \
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD
do
  require_environment "$required_name"
done

case "$TARGET" in
  aarch64-apple-darwin | x86_64-apple-darwin) ;;
  *) fail "unsupported Apple target: $TARGET" ;;
esac

notary_timeout="${PUNKS_NOTARY_TIMEOUT:-120m}"
[[ "$notary_timeout" =~ ^[1-9][0-9]*(s|m|h)?$ ]] || fail "invalid PUNKS_NOTARY_TIMEOUT"

updater_private_key="$TAURI_SIGNING_PRIVATE_KEY"
updater_private_key_password="$TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
unset TAURI_SIGNING_PRIVATE_KEY_PATH

workspace_root="$(cd "$GITHUB_WORKSPACE" && pwd -P)"
runner_temp="$(cd "${RUNNER_TEMP:?RUNNER_TEMP is required}" && pwd -P)"
api_key_directory="$(cd "$(dirname "$APPLE_API_KEY_PATH")" && pwd -P)"
api_key_path="$api_key_directory/$(basename "$APPLE_API_KEY_PATH")"
[[ -f "$api_key_path" && ! -L "$api_key_path" ]] || fail "Apple API key must be one regular file"
case "$api_key_path" in
  "$runner_temp"/*) ;;
  *) fail "Apple API key must remain under RUNNER_TEMP" ;;
esac
APPLE_API_KEY_PATH="$api_key_path"
export APPLE_API_KEY_PATH

bundle_root="$workspace_root/desktop/src-tauri/target/$TARGET/release/bundle"
macos_root="$bundle_root/macos"
dmg_root="$bundle_root/dmg"
[[ -d "$macos_root" && ! -L "$macos_root" ]] || fail "missing canonical macOS bundle directory"
[[ -d "$dmg_root" && ! -L "$dmg_root" ]] || fail "missing canonical DMG bundle directory"

app="$(require_one "$macos_root" "application bundle" '*.app' d)"
updater="$(require_one "$macos_root" "updater archive" '*.app.tar.gz' f)"
updater_signature="$(require_one "$macos_root" "updater signature" '*.app.tar.gz.sig' f)"
dmg="$(require_one "$dmg_root" "disk image" '*.dmg' f)"

temporary_root="$(mktemp -d "$runner_temp/punks-macos-finalize.XXXXXX")"
trap 'rm -rf -- "$temporary_root"' EXIT

app_name="$(basename "$app")"
app_zip="$temporary_root/${app_name%.app}.zip"
ditto -c -k --keepParent --sequesterRsrc "$app" "$app_zip"
notarize_and_staple "$app_zip" "$app" app

updater_temporary="$temporary_root/$(basename "$updater")"
COPYFILE_DISABLE=1 tar -czf "$updater_temporary" -C "$macos_root" "$app_name"
archive_listing="$temporary_root/updater-archive.txt"
tar -tzf "$updater_temporary" > "$archive_listing"
grep -Fx "$app_name/" "$archive_listing" > /dev/null
awk -v prefix="$app_name/" '
  index($0, prefix) != 1 || $0 ~ /(^|\/)\.\.($|\/)/ { exit 1 }
  END { if (NR == 0) exit 1 }
' "$archive_listing" || fail "rebuilt updater archive escaped its application root"
mv -f "$updater_temporary" "$updater"
TAURI_SIGNING_PRIVATE_KEY="$updater_private_key" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$updater_private_key_password" \
  pnpm --dir "$workspace_root/desktop" tauri signer sign "$updater"
unset updater_private_key updater_private_key_password
[[ -f "$updater_signature" && ! -L "$updater_signature" ]] || fail "Tauri did not recreate the updater signature"

base_config="$workspace_root/desktop/src-tauri/tauri.conf.json"
punks_config="$workspace_root/desktop/src-tauri/tauri.punks.conf.json"
product_name="$(jq -er '.productName | select(type == "string" and length > 0)' "$punks_config")"
app_x="$(jq -er '.bundle.macOS.dmg.appPosition.x | numbers' "$base_config")"
app_y="$(jq -er '.bundle.macOS.dmg.appPosition.y | numbers' "$base_config")"
applications_x="$(jq -er '.bundle.macOS.dmg.applicationFolderPosition.x | numbers' "$base_config")"
applications_y="$(jq -er '.bundle.macOS.dmg.applicationFolderPosition.y | numbers' "$base_config")"
window_width="$(jq -er '.bundle.macOS.dmg.windowSize.width | numbers' "$base_config")"
window_height="$(jq -er '.bundle.macOS.dmg.windowSize.height | numbers' "$base_config")"
background_relative="$(jq -er '.bundle.macOS.dmg.background | select(type == "string" and length > 0)' "$base_config")"
icon_relative="$(jq -er '[.bundle.icon[] | select(endswith(".icns"))] | if length == 1 then .[0] else error("expected one ICNS icon") end' "$base_config")"
background="$workspace_root/desktop/src-tauri/$background_relative"
volume_icon="$dmg_root/$(basename "$icon_relative")"
dmg_script="$dmg_root/bundle_dmg.sh"
[[ -f "$background" && ! -L "$background" ]] || fail "missing canonical DMG background"
[[ -f "$volume_icon" && ! -L "$volume_icon" ]] || fail "missing generated DMG volume icon"
[[ -f "$dmg_script" && -x "$dmg_script" && ! -L "$dmg_script" ]] || fail "missing generated Tauri DMG builder"

dmg_name="$(basename "$dmg")"
rebuilt_dmg="$macos_root/$dmg_name"
[[ ! -e "$rebuilt_dmg" ]] || fail "refusing to overwrite an unexpected DMG in the macOS bundle directory"
(
  cd "$macos_root"
  "$dmg_script" \
    --volname "$product_name" \
    --icon "$app_name" "$app_x" "$app_y" \
    --app-drop-link "$applications_x" "$applications_y" \
    --window-size "$window_width" "$window_height" \
    --hide-extension "$app_name" \
    --background "$background" \
    --volicon "$volume_icon" \
    --skip-jenkins \
    "$dmg_name" "$app_name"
)
[[ -f "$rebuilt_dmg" && ! -L "$rebuilt_dmg" ]] || fail "Tauri DMG builder did not recreate the disk image"
mv -f "$rebuilt_dmg" "$dmg"
codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
notarize_and_staple "$dmg" "$dmg" dmg

codesign --verify --deep --strict --verbose=2 "$app"
codesign --verify --strict --verbose=2 "$dmg"
printf 'Finalized notarized macOS artifacts for %s\n' "$TARGET"
