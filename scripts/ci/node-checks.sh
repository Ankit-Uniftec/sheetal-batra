#!/usr/bin/env bash
# Runs the self-check scripts and .mjs tests that Jest does not pick up.
# Used by CI (.github/workflows/ci.yml) and runnable locally: bash scripts/ci/node-checks.sh
set -uo pipefail

# Not runnable yet, with the reason. Remove a line once the test runs.
SKIP=(
  # Imports ./addr.mjs, which does not exist: buildDeliveryAddress lives unexported
  # inside src/pdf/WarehouseOrderPdf.js. Needs that helper extracted first.
  "src/pdf/deliveryAddress.test.mjs"
)

# The Shopify mapper tests import ./mapper.mjs, compiled from the Deno TypeScript source.
MAPPER_DIR=supabase/functions/shopify-order-sync
TMP=$(mktemp -d)
npx --yes -p typescript@5.6.3 tsc "$MAPPER_DIR/mapper.ts" --outDir "$TMP" \
  --target es2022 --module esnext --skipLibCheck --noEmitOnError false >/dev/null 2>&1 || true
if [ ! -f "$TMP/mapper.js" ]; then
  echo "FAIL  could not compile $MAPPER_DIR/mapper.ts"
  exit 1
fi
cp "$TMP/mapper.js" "$MAPPER_DIR/mapper.mjs"
trap 'rm -f "$MAPPER_DIR/mapper.mjs"; rm -rf "$TMP"' EXIT

failed=0
while IFS= read -r f; do
  if printf '%s\n' "${SKIP[@]}" | grep -qx "$f"; then
    echo "SKIP  $f"
    continue
  fi
  if out=$(node "$f" 2>&1); then
    echo "PASS  $f"
  else
    echo "FAIL  $f"
    echo "$out" | tail -20
    failed=1
  fi
done < <(git ls-files '*.selfcheck.js' '*.test.mjs' | sort)

exit $failed
