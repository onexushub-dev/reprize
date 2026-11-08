#!/usr/bin/env bash
# Modo Foco lab, test 28: score a ball detector (one-class or COCO ONNX) the way test 19 / 26 did, on the basketball
# clips: 416 tiles + whole frame at 5 fps, two stages (a3k2), the DP ball path, the mix with EdgeTAM, det_report.
#   bash tools/lab/ball_eval28.sh lab/models/ball_tiny_pub.onnx bpub [clip ...]
# -> lab/tests/detect/<clip>.<tag>-{n5,w5,n-a3k2}.json, lab/tests/oneclick/<clip>.ball.{det,mix}-<tag>-n-a3k2.json,
#    lab/tests/detect/report.{det,mix}-<tag>.md
set -euo pipefail
cd "$(dirname "$0")/../.."
MODEL=$1; TAG=$2; shift 2
CLIPS=${*:-"basket-rp-1105-v-a basket-rp-1105-v-b basket-rp-1105-h basket-v-01 yt-basket-04 yt1105-basket-a yt1105-basket-b"}
THREADS=${THREADS:-2}
python3 tools/lab/ball_detect.py --model "$MODEL" --tag "$TAG-n5" --tile 416 --step 2 --threads "$THREADS" $CLIPS
python3 tools/lab/ball_detect.py --model "$MODEL" --tag "$TAG-w5" --no-tiles --step 2 --threads "$THREADS" $CLIPS
python3 tools/lab/roi_tiles.py --src "$TAG-n5" --whole "$TAG-w5" --anchor 3 --k 2 --out "$TAG-n-a3k2" $CLIPS
python3 tools/lab/ball_track.py --det "$TAG-n-a3k2" $CLIPS
python3 tools/lab/low_fps.py fuse --p2 "det-$TAG-n-a3k2" --p1 edgetam-fuse5 --out "mix-$TAG-n-a3k2" $CLIPS
python3 tools/lab/det_report.py --det "$TAG-n-a3k2" --track "det-$TAG-n-a3k2" --name "det-$TAG" $CLIPS
python3 tools/lab/det_report.py --det "$TAG-n-a3k2" --track "mix-$TAG-n-a3k2" --name "mix-$TAG" $CLIPS
