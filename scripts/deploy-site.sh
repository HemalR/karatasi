#!/bin/bash
# Publish site/ to Cloudflare as the "karatasi" Worker with static assets (wrangler.toml), served
# at karatasi.app. Needs a one-time `wrangler login` on the Cloudflare account that owns the domain.
set -euo pipefail
cd "$(dirname "$0")/.."
wrangler deploy
