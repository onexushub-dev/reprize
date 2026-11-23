#!/usr/bin/env python3
"""Modo Foco lab, Android Jogadores on LiteRT (2026-11-16): what the app needs to decode EfficientDet-Lite0 as MediaPipe does.

    anchors <model.tflite> <out.bin>         the model's fixed anchors (MediaPipe DETECTOR_METADATA) as float32 LE,
                                             19206 × (y_center, x_center, h, w), 0..1 of the model's square
    fixture <model.tflite> <anchors.bin> <clip.mp4> <out.json>
                                             test vectors for the Kotlin port: the warp-linear shrink of a small
                                             synthetic picture, and real model outputs on frames of a clip (the anchors
                                             with a person score >= 0.3) with the people they decode to after NMS

MediaPipe's ObjectDetector (source read 2026-11-16): stretch to 320 × 320 (OpenCV warpAffine, bilinear, no half-pixel
offset, border replicate), uint8 0..255, boxes YXHW, centre = raw × anchor size + anchor centre, size = exp(raw) ×
anchor size, score = the allowed class (person) as given (no sigmoid), threshold before NMS, hard NMS at IoU > 0.3
class-agnostic, at most `max_results` after it. On 22 clips × 3 frames (whole frame and a tile) this finds 98% of
MediaPipe-on-the-Mac's people and MediaPipe finds 98% of these.
Needs: numpy, opencv-python-headless, ai-edge-litert, mediapipe (anchors only).
"""
import json
import sys

import cv2
import numpy as np


def anchors(model: str, out: str) -> None:
    from mediapipe.tasks.metadata import metadata_schema_py_generated as ms
    from mediapipe.tasks.metadata import object_detector_metadata_schema_py_generated as od
    from tensorflow.lite.python import schema_py_generated as tfl
    data = open(model, "rb").read()
    m = tfl.Model.GetRootAsModel(data, 0)
    buf = next(m.Buffers(m.Metadata(i).Buffer()).DataAsNumpy().tobytes() for i in range(m.MetadataLength())
               if m.Metadata(i).Name() == b"TFLITE_METADATA")
    sg = ms.ModelMetadata.GetRootAsModelMetadata(buf, 0).SubgraphMetadata(0)
    raw = next(sg.CustomMetadata(c).DataAsNumpy().tobytes() for c in range(sg.CustomMetadataLength())
               if sg.CustomMetadata(c).Name() == b"DETECTOR_METADATA")
    fa = od.ObjectDetectorOptions.GetRootAsObjectDetectorOptions(raw, 0).SsdAnchorsOptions().FixedAnchorsSchema()
    a = np.array([[fa.Anchors(k).YCenter(), fa.Anchors(k).XCenter(), fa.Anchors(k).Height(), fa.Anchors(k).Width()]
                  for k in range(fa.AnchorsLength())], dtype="<f4")
    a.tofile(out)
    print(out, a.shape)


def warp(img: np.ndarray, x0=0, y0=0, w=None, h=None) -> np.ndarray:
    h = h or img.shape[0]; w = w or img.shape[1]
    m = np.array([[320 / w, 0, -x0 * 320 / w], [0, 320 / h, -y0 * 320 / h]], np.float32)
    return cv2.warpAffine(img, m, (320, 320), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def iou(a, b):
    ix = max(0, min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])); iy = max(0, min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1]))
    u = a[2] * a[3] + b[2] * b[3] - ix * iy
    return ix * iy / u if u > 0 else 0


def fixture(model: str, anchors_bin: str, clip: str, out: str) -> None:
    from ai_edge_litert.interpreter import Interpreter
    A = np.fromfile(anchors_bin, dtype="<f4").reshape(-1, 4)
    it = Interpreter(model_path=model); it.allocate_tensors()
    inp = it.get_input_details()[0]
    bo = [o for o in it.get_output_details() if o["shape"][-1] == 4][0]
    co = [o for o in it.get_output_details() if o["shape"][-1] == 90][0]
    # the shrink: a 7 × 5 RGB picture with known values, sampled at a few output pixels
    small = np.array([[[(x * 37 + y * 11 + c * 5) % 256 for c in range(3)] for x in range(7)] for y in range(5)], np.uint8)
    ws = warp(small)
    picks = [(0, 0), (1, 0), (45, 0), (46, 64), (100, 200), (319, 319), (160, 160), (300, 10)]
    shrink = {"w": 7, "h": 5, "pixels": [[int((x * 37 + y * 11 + c * 5) % 256) for c in range(3)] for y in range(5) for x in range(7)],
              "samples": [[u, v] + ws[v, u].tolist() for u, v in picks]}
    cases = []
    cap = cv2.VideoCapture(clip)
    for t in (300, 2300, 4300):
        cap.set(cv2.CAP_PROP_POS_MSEC, t); ok, f = cap.read()
        f = cv2.cvtColor(cv2.resize(f, (1280, 720)), cv2.COLOR_BGR2RGB)
        it.set_tensor(inp["index"], warp(f)[None]); it.invoke()
        b = it.get_tensor(bo["index"])[0]; s = it.get_tensor(co["index"])[0][:, 0]
        k = np.where(s >= 0.3)[0]
        ty, tx, th, tw = b[k].T
        cy = A[k, 0] + ty * A[k, 2]; cx = A[k, 1] + tx * A[k, 3]; hh = np.exp(th) * A[k, 2]; ww = np.exp(tw) * A[k, 3]
        d = np.stack([cx - ww / 2, cy - hh / 2, ww, hh, s[k]], 1)
        order = np.argsort(-d[:, 4], kind="stable"); kept = []
        for i in order:
            if all(iou(d[i], q) <= 0.3 for q in kept): kept.append(d[i])
        cases.append({"t": t, "anchors": [[int(i)] + b[i].tolist() + [float(s[i])] for i in k],
                      "people": [[float(v) for v in q] for q in kept[:30]]})
    json.dump({"shrink": shrink, "cases": cases}, open(out, "w"))
    print(out, [len(c["people"]) for c in cases])


if __name__ == "__main__":
    if sys.argv[1] == "anchors":
        anchors(sys.argv[2], sys.argv[3])
    else:
        fixture(*sys.argv[2:6])
