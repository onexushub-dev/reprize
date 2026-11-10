#!/bin/bash
# Modo Foco lab, ON THE MAC: the players' boxes (Vision, the app's person detector: tools/vision-probe.swift) for clips
# that have none yet, so today's Modo Foco framing (focus_variant.py --preset acao --boxes tiled) can be computed for
# them (test 46c: the story camera's fallback on Victor's beach tennis clips). Skips clips already done.
#   cd docs/focus-refs && bash tools/lab/mac-people.sh [clip ...]      # default: all bt-own-* clips in clips.txt
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "$(uname -s)" = "Darwin" ] || { echo "Run this on the Mac (macOS)."; exit 1; }
[ -x lab/vision-probe ] || swiftc -O tools/vision-probe.swift -o lab/vision-probe
if [ $# -gt 0 ]; then CLIPS=("$@"); else CLIPS=($(grep '^bt-own-' tools/lab/clips.txt | cut -d'|' -f1)); fi
mkdir -p renders
for c in "${CLIPS[@]}"; do
  video=$(grep "^$c|" tools/lab/clips.txt | cut -d'|' -f2)
  [ -n "$video" ] && [ -f "$video" ] || { echo "MISSING $c ($video)"; continue; }
  if [ -f "renders/$c.people.json" ]; then echo "skip $c"; continue; fi
  echo "== $c"
  lab/vision-probe "$video" "renders/$c.people.json"
done
echo "Done. Tell Claude."
