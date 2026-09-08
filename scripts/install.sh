#!/bin/bash
# Build Karatasi for production and install it to ~/.local/bin, restarting the running instance.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"

npm run build
# `tauri build` enables the custom-protocol feature, which is what makes the binary serve the
# bundled frontend instead of the Vite dev URL. A plain `cargo build --release` does not.
npx tauri build --no-bundle

install -Dm755 src-tauri/target/release/karatasi "$HOME/.local/bin/karatasi"
if pgrep -x karatasi >/dev/null; then
  pkill -x karatasi
  sleep 0.5
fi
setsid uwsm-app -- "$HOME/.local/bin/karatasi" start >/dev/null 2>&1 &
echo "installed $HOME/.local/bin/karatasi and restarted it in the background"
