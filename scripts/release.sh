#!/bin/bash
# Cut a release: bump the version everywhere, commit, tag vX.Y.Z, push, then pin packaging/PKGBUILD
# to that tag's tarball with a real checksum and a fresh .SRCINFO. Usage: scripts/release.sh 0.2.0
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

ver="${1:?usage: scripts/release.sh X.Y.Z}"
[[ "$ver" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "release.sh: version must look like 1.2.3" >&2; exit 1; }
[[ "$(git branch --show-current)" == "main" ]] || { echo "release.sh: switch to main first" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "release.sh: commit or stash your changes first" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$ver" >/dev/null && { echo "release.sh: tag v$ver already exists" >&2; exit 1; }
for tool in updpkgsums makepkg npm cargo curl; do
  command -v "$tool" >/dev/null || { echo "release.sh: $tool is missing (updpkgsums is in pacman-contrib)" >&2; exit 1; }
done

# --- version bump -------------------------------------------------------------------------------
npm version "$ver" --no-git-tag-version --allow-same-version >/dev/null  # package.json + package-lock.json
sed -i "s/^\(  \"version\": \)\".*\"/\1\"$ver\"/" src-tauri/tauri.conf.json
sed -i "0,/^version = \".*\"/s//version = \"$ver\"/" src-tauri/Cargo.toml
(cd src-tauri && cargo update --workspace --offline >/dev/null) # Cargo.lock entry for karatasi
git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
# Nothing to commit when the files already carry this version (e.g. the first release).
git diff --cached --quiet || git commit -q -m "Release v$ver"
git tag -a "v$ver" -m "Karatasi v$ver"
git push -q origin main "v$ver"
echo "tagged and pushed v$ver"

# --- pin the package to the tarball -------------------------------------------------------------
url="https://github.com/HemalR/karatasi/archive/refs/tags/v$ver.tar.gz"
for _ in $(seq 1 20); do
  curl -fsSL -o /dev/null "$url" && break
  sleep 3
done
cd packaging
sed -i "s/^pkgver=.*/pkgver=$ver/; s/^pkgrel=.*/pkgrel=1/" PKGBUILD
updpkgsums
makepkg --printsrcinfo > .SRCINFO
cd ..
git add packaging/PKGBUILD packaging/.SRCINFO
git commit -q -m "Package v$ver"
git push -q origin main
echo "packaging/PKGBUILD pinned to v$ver with checksum $(grep -m1 sha256sums packaging/PKGBUILD | cut -d"'" -f2 | cut -c1-12)…"
echo "the Release package workflow is now building the .pkg.tar.zst for the v$ver GitHub release:"
echo "  gh run watch"
