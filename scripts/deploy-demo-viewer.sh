#!/usr/bin/env bash
# Build + deploy the MIMPS viewer WITH the multi-modality Demo enabled.
#
# Wraps the canonical deploy (1_platform/scripts/deploy-viewer-vps.sh) with the
# three demo-specific steps so a redeploy is one command and never regresses to
# "demo off / no data":
#   1. build on node >=20 (node 18 fails: "crypto is not defined");
#   2. STRIP the share-alike IXI brain set from dist/ (CC-BY-SA → never host) —
#      idempotent, a no-op on a machine without the local brain DICOMs;
#   3. enable window.config.blackvoxelDemo in the emitted app-config.js (the repo
#      default stays dark/false; only the deployed build flips it on).
#
# The redistributable CC0 chest + limb DICOMs ARE committed (so a clean build
# keeps them); the brain set is generated locally by models/demo_data converters
# and is shown only in a local screen-share (never deployed). Backend lanes
# (/inference/limb, /inference/brainage) are deployed separately; until then the
# viewer degrades to each lane's honest message (limb "no model", brain "N/A").
#
# Usage: NODE20=/opt/homebrew/opt/node@20/bin ./scripts/deploy-demo-viewer.sh [--skip-build]
set -euo pipefail

MIMPS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$MIMPS_DIR"
DIST=platform/app/dist
NODE20="${NODE20:-/opt/homebrew/opt/node@20/bin}"

if [[ "${1:-}" != "--skip-build" ]]; then
  echo "==> Building viewer (node $("$NODE20/node" --version 2>/dev/null || echo '?'))..."
  rm -rf "$DIST"
  ( cd platform/app && PATH="$NODE20:$PATH" APP_CONFIG=config/blackvoxel.js yarn build:viewer )
fi
[[ -f "$DIST/index.html" ]] || { echo "no $DIST/index.html — build failed"; exit 1; }

echo "==> Stripping share-alike IXI brain set from dist (never host CC-BY-SA)..."
rm -rf "$DIST"/demo/studies/brain-ixi-* || true
# Rebuild the deploy manifest to the redistributable subset actually present.
if [[ -f "$DIST/demo/demo-manifest.json" ]]; then
  python3 - "$DIST/demo/demo-manifest.json" <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["studies"] = [s for s in m.get("studies", []) if s.get("expected_class") != "brain_mri"]
json.dump(m, open(p, "w"), indent=2, ensure_ascii=False)
print(f"   deploy manifest: {[s['study_id'] for s in m['studies']]}")
PY
fi

echo "==> Enabling the Demo button in the emitted app-config.js..."
perl -i -pe 's/blackvoxelDemo:\{enabled:!1/blackvoxelDemo:{enabled:!0/' "$DIST/app-config.js"
grep -q 'blackvoxelDemo:{enabled:!0' "$DIST/app-config.js" || { echo "failed to enable demo flag"; exit 1; }

echo "==> Deploying (rsync via the canonical script)..."
bash ../1_platform/scripts/deploy-viewer-vps.sh --skip-build "$@"
echo "==> Demo viewer deployed."
