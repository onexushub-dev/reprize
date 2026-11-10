#!/usr/bin/env python3
"""Modo Foco lab, tests 17/19: YOLOX (Megvii, Apache-2.0) COCO checkpoints -> Core ML for FocusBench.

Input "image" (BGR, 0..255, side x side), output "output" [1, anchors, 85] = raw box + sigmoid objectness + sigmoid
classes (as the ONNX of the release, decode_in_inference off; FocusBench decodes). FP16, iOS 16. Needs the YOLOX
source (PyPI sdist yolox-0.3.0) and coremltools (the cloud workspace has both).

    python3 tools/lab/yolox_coreml.py --yolox /tmp/yxsrc/yolox-0.3.0 --name tiny
    -> lab/coreml/yolox_tiny.mlpackage

Test 34 (2026-11-08): `--ball ball_tiny_hn` converts the lab's one-class basketball detector instead
(lab/models/ball_tiny_hn.pth from ball_train_pub.py; output [1, anchors, 6], FocusBench reads the class column by the
output's width) -> lab/coreml/ball_tiny_hn.mlpackage.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
# depth, width, depthwise, input side (YOLOX's exps/default)
SIZES = {"s": (0.33, 0.50, False, 640), "tiny": (0.33, 0.375, False, 416), "nano": (0.33, 0.25, True, 416)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yolox", required=True, help="YOLOX source folder (with yolox/models)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--name", choices=sorted(SIZES), help="Megvii's COCO checkpoint lab/models/yolox_<name>.pth")
    g.add_argument("--ball", help="a one-class model of ball_train_pub.py, lab/models/<ball>.pth (YOLOX-Tiny)")
    a = ap.parse_args()
    sys.path.insert(0, a.yolox)
    import coremltools as ct
    import numpy as np
    import torch
    from yolox.models import YOLOX, YOLOPAFPN, YOLOXHead
    arch = "tiny" if a.ball else a.name
    stem = a.ball or f"yolox_{a.name}"
    classes = 1 if a.ball else 80
    depth, width, dw, side = SIZES[arch]
    act = "silu"
    m = YOLOX(YOLOPAFPN(depth, width, in_channels=[256, 512, 1024], act=act, depthwise=dw),
              YOLOXHead(classes, width, in_channels=[256, 512, 1024], act=act, depthwise=dw))
    ck = torch.load(os.path.join(ROOT, "lab", "models", f"{stem}.pth"), map_location="cpu", weights_only=True)
    m.load_state_dict(ck["model"] if "model" in ck else ck)
    m.eval()
    m.head.decode_in_inference = False
    x = torch.rand(1, 3, side, side) * 255
    with torch.no_grad():
        ref = m(x).numpy()
        tr = torch.jit.trace(m, x)
    ml = ct.convert(tr, inputs=[ct.ImageType(name="image", shape=(1, 3, side, side), scale=1.0,
                                             color_layout=ct.colorlayout.BGR)],
                    outputs=[ct.TensorType(name="output")], compute_precision=ct.precision.FLOAT16,
                    minimum_deployment_target=ct.target.iOS16, convert_to="mlprogram")
    if a.ball:
        ml.short_description = (f"{stem}: YOLOX-Tiny (Megvii, Apache-2.0) one class 'ball', fine-tuned in the "
                                f"Modo Foco lab, {side}x{side} BGR, raw output [1, N, 6]")
    else:
        ml.short_description = f"YOLOX-{a.name} COCO (Megvii, Apache-2.0), {side}x{side} BGR, raw output [1, N, 85]"
    out = os.path.join(ROOT, "lab", "coreml", f"{stem}.mlpackage")
    ml.save(out)
    # check against the ONNX of the release / of ball_train_pub.py export (same weights)
    import onnxruntime as ort
    s = ort.InferenceSession(os.path.join(ROOT, "lab", "models", f"{stem}.onnx"))
    o = s.run(None, {s.get_inputs()[0].name: x.numpy()})[0]
    print(out, "torch vs release ONNX max diff (objectness):", float(np.abs(ref[0, :, 4] - o[0, :, 4]).max()),
          "anchors", ref.shape[1])


if __name__ == "__main__":
    main()
