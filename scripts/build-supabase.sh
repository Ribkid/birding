#!/usr/bin/env bash
# Rebuild vendor/supabase/supabase.js: one ESM file, no CDN, cached by the service worker.
set -euo pipefail
VER=2.117.3
OUT="$(cd "$(dirname "$0")/.." && pwd)/vendor/supabase/supabase.js"
TMP="$(mktemp -d)"
cd "$TMP"
npm init -y >/dev/null
npm i -s "@supabase/supabase-js@$VER" esbuild@0.24.2 >/dev/null
echo "export { createClient } from '@supabase/supabase-js';" > entry.js
npx esbuild entry.js --bundle --format=esm --minify --platform=browser --target=es2020 --legal-comments=eof --outfile=out.js
mkdir -p "$(dirname "$OUT")"
{ echo "// @supabase/supabase-js $VER, bundled with esbuild 0.24.2 (scripts/build-supabase.sh). MIT licence."; cat out.js; } > "$OUT"
echo "Wrote $OUT"
