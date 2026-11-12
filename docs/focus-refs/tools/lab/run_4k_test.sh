#!/bin/bash
# 4K test plan (docs/superpowers/plans/2026-11-12-4k-analysis-speed-test-plan.md): the whole lab run for a new phone
# dump, in one go (Victor's Mac; no time limit). Safe to re-run: finished detections are skipped.
#
#   cd docs/focus-refs
#   bash tools/lab/run_4k_test.sh raw-dump/<dump> --day YYYY-MM-DD [--after HH:MM] [--before HH:MM] [--sport beachTennis]
#
# 1. dump_inventory.py: inventory (lab/tests/4k/<dump>/inventory.md) + registers the ball-sport clips in clips.txt
# 2. ball_detect.py per clip with its sport's model: today (native size) and the candidate (scaled to 1920 wide)
# 3. ball_track.py for both, 4. agree_4k.py report per sport (lab/tests/4k/<dump>/report.*.md)
# 5. side-by-side videos with the app's camera (beach tennis: phone | lab today | lab candidate; basketball: Jogadores |
#    Bola today | Bola candidate) for clips with the phone's Jogadores file
# Labels: label new clips first (tools/lab/server.py) for precision / cover; without labels you get agreement + verdict.
set -euo pipefail
cd "$(dirname "$0")/../.."
PY="${PY:-lab/.venv/bin/python}"
THREADS="${THREADS:-4}"
CAND_WIDTH="${CAND_WIDTH:-1920}"
[ $# -ge 1 ] || { sed -n 2,13p "$0"; exit 1; }
DUMP_PATH="$1"; shift
DUMP="$(basename "$DUMP_PATH")"
"$PY" -c "import numpy, cv2, onnxruntime, PIL" 2>/dev/null || "$PY" -m pip install -q numpy opencv-python onnxruntime pillow

"$PY" tools/lab/dump_inventory.py "$DUMP_PATH" --register "$@"
LIST="lab/tests/4k/$DUMP/clips.list"
[ -s "$LIST" ] || { echo "no ball-sport clips in this dump (pass --sport for recordings never opened in the app)"; exit 0; }

model_of() { case "$1" in beachTennis) echo ball_tiny_btpl;; basquete) echo ball_tiny_gym;; *) echo "";; esac; }
short_of() { case "$1" in beachTennis) echo btpl;; basquete) echo gym;; esac; }
sport_of() { grep "^$1|" tools/lab/clips.txt | head -1 | cut -d'|' -f5; }

for SPORT in beachTennis basquete; do
  NAMES=()
  while read -r n; do [ -n "$n" ] && [ "$(sport_of "$n")" = "$SPORT" ] && NAMES+=("$n"); done < "$LIST"
  [ ${#NAMES[@]} -gt 0 ] || continue
  M="$(model_of "$SPORT")"; S="$(short_of "$SPORT")"
  A="$S-4kplan-native"; B="$S-4kplan-$CAND_WIDTH"
  echo "== $SPORT: ${#NAMES[@]} clips, model $M ($A vs $B)"
  "$PY" tools/lab/ball_detect.py --model "lab/models/$M.onnx" --tag "$A" --tile 416 --step 2 --threads "$THREADS" "${NAMES[@]}"
  "$PY" tools/lab/ball_detect.py --model "lab/models/$M.onnx" --tag "$B" --tile 416 --step 2 --threads "$THREADS" \
    --max-width "$CAND_WIDTH" "${NAMES[@]}"
  "$PY" tools/lab/ball_track.py --det "$A" "${NAMES[@]}" > /dev/null
  "$PY" tools/lab/ball_track.py --det "$B" "${NAMES[@]}" > /dev/null
  "$PY" tools/lab/agree_4k.py --dump "$DUMP" --a "$A" --b "$B" "${NAMES[@]}"
  # videos with the app's own camera per sport: beach tennis = cam_bt T52 (court lock, hitter kept whole), with the
  # phone's real Bola camera when it ran there; basketball = story camera C
  T52="a=0.3,b=30,hitbox=2,horizon=10,hitpad=0.02"
  for n in "${NAMES[@]}"; do
    [ -f "lab/tests/framing/$n.current.focus.json" ] || continue
    if [ "$SPORT" = "beachTennis" ]; then
      OUTV="lab/tests/story/$n.bt-compare-4kplan.mp4"
      [ -f "$OUTV" ] && continue
      APP=()
      [ -f "lab/tests/story/$n.appcam.json" ] && APP=(--var "Celular hoje=app")
      "$PY" tools/lab/bt_render.py "$n" ${APP[@]+"${APP[@]}"} --var "Lab hoje=det-$A@$T52" \
        --var "Lab candidata=det-$B@$T52" --out "$OUTV" > /dev/null || echo "video failed: $n"
    else
      [ -f "lab/tests/story/$n.story-compare-4kplan.mp4" ] && continue
      "$PY" tools/lab/story.py compare --clip "$n" --cam today --cam "C@1.0#det-$A" --cam "C@1.0#det-$B" \
        --suffix=-4kplan --labels "Jogadores" "Bola hoje" "Bola candidata" > /dev/null || echo "video failed: $n"
    fi
  done
done
echo "Done. Reports: lab/tests/4k/$DUMP/  Videos: lab/tests/story/*.story-compare-4kplan.mp4  Tell Claude."
