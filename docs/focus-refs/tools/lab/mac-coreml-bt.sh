#!/bin/bash
# Modo Foco lab, ON THE MAC (test 48): the beach tennis ball detector into the app, as basketball's was: the .pth from
# mac-train-bt.sh -> Core ML (yolox_coreml.py --ball, FP16, iOS 16; needs the coremltools env lab/.venv-edgetam) ->
# compiled (xcrun coremlcompiler) into the pod's resources, app/modules/replay-camera/ios/Models/ball_tiny_btpl.mlmodelc
# (BallSport.beachTennis.modelId). Run it after Claude has checked the trained model.
#   cd docs/focus-refs && bash tools/lab/mac-coreml-bt.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
[ "$(uname -s)" = "Darwin" ] || { echo "Run this on the Mac (macOS)."; exit 1; }
PY=lab/.venv-edgetam/bin/python
NAME=${NAME:-ball_tiny_btpl}
[ -f "lab/models/$NAME.pth" ] || { echo "lab/models/$NAME.pth not found: run tools/lab/mac-train-bt.sh first."; exit 1; }
# the YOLOX source imports these (the training env has them, this one may not)
"$PY" -c "import loguru, thop, onnxruntime" 2>/dev/null || "$PY" -m pip install -q loguru thop onnxruntime
"$PY" tools/lab/yolox_coreml.py --yolox lab/src/yolox-0.3.0 --ball "$NAME"
OUT=../../app/modules/replay-camera/ios/Models
rm -rf "$OUT/$NAME.mlmodelc"
xcrun coremlcompiler compile "lab/coreml/$NAME.mlpackage" "$OUT/"
ls -la "$OUT/$NAME.mlmodelc"
echo "Done: $OUT/$NAME.mlmodelc. Tell Claude."
