#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
key_script="scripts/desktop-release-cache-key.py"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/repo"
tracked_files=(
  "$key_script"
  Cargo.lock
  desktop/src-tauri/Cargo.lock
  rust-toolchain.toml
)
while IFS= read -r -d '' path; do
  tracked_files+=("$path")
done < <(git -C "$repo_root" ls-files -z '*Cargo.toml')
if [[ -f "$repo_root/.cargo/config.toml" ]]; then
  tracked_files+=(.cargo/config.toml)
fi
for path in "${tracked_files[@]}"; do
  mkdir -p "$tmp/repo/$(dirname "$path")"
  cp "$repo_root/$path" "$tmp/repo/$path"
done
cd "$tmp/repo"
git init -q
git add "${tracked_files[@]}"

args=(--platform Linux --target x86_64-unknown-linux-gnu --features mesh-llm --native-inputs ubuntu-24.04-mold)
original=$("$key_script" "${args[@]}")
python3 - <<'PY'
from pathlib import Path
import re

manifest = Path("desktop/src-tauri/Cargo.toml")
manifest_text = manifest.read_text()
package = re.search(r'(?ms)^\[package\]\n.*?^version = "([^"]+)"', manifest_text)
if package is None:
    raise SystemExit("desktop package version not found")
current_version = package.group(1)
manifest.write_text(
    manifest_text[: package.start(1)] + "9.8.7" + manifest_text[package.end(1) :]
)

lock = Path("desktop/src-tauri/Cargo.lock")
text = lock.read_text()
start = text.index('name = "desktop-shell"')
version = text.index(f'version = "{current_version}"', start)
lock.write_text(
    text[:version]
    + 'version = "9.8.7"'
    + text[version + len(f'version = "{current_version}"') :]
)
PY
version_only=$("$key_script" "${args[@]}")
[[ "$original" == "$version_only" ]] || { echo "desktop version changed cache key" >&2; exit 1; }
printf '\n# dependency input\n' >> crates/punks-acp/Cargo.toml
dependency_changed=$("$key_script" "${args[@]}")
[[ "$original" != "$dependency_changed" ]] || { echo "dependency manifest did not change cache key" >&2; exit 1; }
[[ "$original" == desktop-rust-release-v1-Linux-x86_64-unknown-linux-gnu-* ]] || { echo "unexpected key: $original" >&2; exit 1; }
echo "desktop release cache key contract passed"
