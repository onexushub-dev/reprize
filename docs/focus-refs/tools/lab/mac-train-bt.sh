#!/bin/bash
# Modo Foco lab, ON THE MAC: the beach tennis ball detector for the app (test 48), trained on Victor's Mac with the
# lab's PyTorch env (lab/.venv; the cloud workspace has no PyTorch). Same recipe as test 45b:
#   1. btpub  : YOLOX-Tiny 416 from COCO, public sets (CC BY 4.0) + "not a ball" crops, 3,000 iterations
#   2. btplA2 : btpub + arena B's crops with every ball marked (btpl-bt-own-b-*), 1,000 it. -> scored on arena A by
#               Claude to check the recipe reproduces test 45b's btplA (ceiling 94%, path cover 90% with T46)
#   3. btpl   : btpub + BOTH arenas' crops (btpl-bt-own-*), 1,000 it. -> the app's beach tennis model
# Each step writes lab/models/ball_tiny_<name>.pth and .onnx; a step already done is skipped. Keep the Mac awake.
#   cd docs/focus-refs && bash tools/lab/mac-train-bt.sh 2>&1 | tee lab/train-bt.log
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "$(uname -s)" = "Darwin" ] || { echo "Run this on the Mac (macOS)."; exit 1; }
PY=lab/.venv/bin/python
[ -x "$PY" ] || { echo "lab/.venv not found (tools/lab/setup-mac.sh makes it)."; exit 1; }
"$PY" -c "import loguru, thop, onnx" 2>/dev/null || "$PY" -m pip install -q loguru thop onnx
"$PY" -c "import sys; sys.path.insert(0, 'lab/src/yolox-0.3.0'); from yolox.models import YOLOX; import torch, cv2; print('torch', torch.__version__, 'ok')"
T=$(sysctl -n hw.perflevel0.physicalcpu 2>/dev/null || sysctl -n hw.physicalcpu)
PUB=pub-bt01,pub-bt02,neg-bt01
B=$(ls -d lab/train/btpl-bt-own-b-* | xargs -n1 basename | paste -sd, -)
ALL=$(ls -d lab/train/btpl-bt-own-* | xargs -n1 basename | paste -sd, -)
run() {  # name, then train options
  local name=$1; shift
  # done = its .pth (training needs it; an older .onnx alone, as btpub's from test 45, does not count)
  if [ -f "lab/models/ball_tiny_$name.pth" ]; then
    echo "skip $name training (done)"
  else
    echo "== $name ($(date +%H:%M))"
    "$PY" tools/lab/ball_train_pub.py train --model tiny --out "$name" --threads "$T" "$@"
  fi
  if [ ! -f "lab/models/ball_tiny_$name.onnx" ] || [ "lab/models/ball_tiny_$name.pth" -nt "lab/models/ball_tiny_$name.onnx" ]; then
    "$PY" tools/lab/ball_train_pub.py export --model tiny --out "$name"
  fi
}
run btpub --sets "$PUB" --iters 3000
run btplA2 --init ball_tiny_btpub --sets "$PUB" --extra "$B" --iters 1000
run btpl --init ball_tiny_btpub --sets "$PUB" --extra "$ALL" --iters 1000
echo "Done ($(date +%H:%M)). Tell Claude."
