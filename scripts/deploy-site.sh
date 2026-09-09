#!/bin/bash
# Publish site/ to Cloudflare Pages (project "karatasi", served at karatasi.app). Needs a one-time
# `wrangler login` on the Cloudflare account that owns the domain.
set -euo pipefail
cd "$(dirname "$0")/.."
wrangler pages deploy site --project-name karatasi --branch main --commit-dirty=true
