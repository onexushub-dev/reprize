#!/usr/bin/env python3
"""Modo Foco lab, Android: the ball detectors (YOLOX-Tiny ONNX) as TFLite for the app, and a check against the ONNX.

    convert <model.onnx> <out.tflite>
        onnxsim (folds the shape arithmetic: without it the graph keeps dynamic tensors and the GPU delegate refuses it)
        -> onnx2tf (flatbuffer_direct, with a SavedModel) -> float32 TFLite, then fp16 weights through the TF converter.
        Keeps the fp16 file when it loads and its check passes, else the float32 one. Input NHWC [1, 416, 416, 3]
        float32 BGR 0-255; output [1, 6, 3549].

    check <model.onnx> <model.tflite> <clips.txt> [--frames 40] [--sport basquete]
        On frames at labelled times (<clip>.ball.json, ball visible): the 416 tile centred on the ball and the whole
        frame letterboxed top-left over grey 114, through both models. Prints candidates (score >= 0.05) in each, how
        many ONNX candidates with score >= 0.1 have a TFLite one at IoU >= 0.9, and the largest score difference.
        Exit 1 unless every such candidate matches and the largest score difference is under 0.02.

Needs: onnx onnxsim onnx2tf tensorflow tf_keras onnxruntime ai-edge-litert opencv-python-headless numpy.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

SIDE = 416
CONF = 0.05


def anchors(side: int = SIDE) -> np.ndarray:
    g = []
    for stride in (8, 16, 32):
        n = side // stride
        for y in range(n):
            for x in range(n):
                g.append((x, y, stride))
    return np.array(g, dtype=np.float32)


ANCHORS = anchors()


def decode(out: np.ndarray) -> np.ndarray:
    """[3549, 6] raw rows -> [k, 5] boxes cx, cy, w, h, score in model px, score >= CONF."""
    s = out[:, 4] * out[:, 5]
    keep = (out[:, 4] >= CONF) & (s >= CONF)
    a = ANCHORS[keep]
    o = out[keep]
    cx = (o[:, 0] + a[:, 0]) * a[:, 2]
    cy = (o[:, 1] + a[:, 1]) * a[:, 2]
    w = np.exp(o[:, 2]) * a[:, 2]
    h = np.exp(o[:, 3]) * a[:, 2]
    return np.stack([cx, cy, w, h, s[keep]], axis=1)


def iou(a, b) -> float:
    ix = max(0.0, min(a[0] + a[2] / 2, b[0] + b[2] / 2) - max(a[0] - a[2] / 2, b[0] - b[2] / 2))
    iy = max(0.0, min(a[1] + a[3] / 2, b[1] + b[3] / 2) - max(a[1] - a[3] / 2, b[1] - b[3] / 2))
    u = a[2] * a[3] + b[2] * b[3] - ix * iy
    return ix * iy / u if u > 0 else 0.0


class Onnx:
    def __init__(self, path: str):
        import onnxruntime as ort
        self.s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.name = self.s.get_inputs()[0].name

    def run(self, bgr: np.ndarray) -> np.ndarray:
        return self.s.run(None, {self.name: bgr.astype(np.float32).transpose(2, 0, 1)[None]})[0][0]


class Lite:
    def __init__(self, path: str):
        from ai_edge_litert.interpreter import Interpreter
        self.it = Interpreter(model_path=path)
        self.it.allocate_tensors()
        self.i = self.it.get_input_details()[0]
        self.o = self.it.get_output_details()[0]
        for t in self.it.get_tensor_details():
            if -1 in list(t["shape_signature"]):
                raise SystemExit(f"{path}: dynamic tensor {t['name']} {t['shape_signature']}")

    def run(self, bgr: np.ndarray) -> np.ndarray:
        self.it.set_tensor(self.i["index"], bgr.astype(np.float32)[None])
        self.it.invoke()
        out = self.it.get_tensor(self.o["index"])[0]
        return out.T if out.shape[0] == 6 else out


def letterbox(frame: np.ndarray) -> np.ndarray:
    import cv2
    h, w = frame.shape[:2]
    r = min(SIDE / w, SIDE / h)
    nw, nh = int(round(w * r)), int(round(h * r))
    out = np.full((SIDE, SIDE, 3), 114, dtype=np.uint8)
    out[:nh, :nw] = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return out


def tile_at(frame: np.ndarray, x: float, y: float) -> np.ndarray:
    h, w = frame.shape[:2]
    x0 = int(min(max(x * w - SIDE / 2, 0), max(0, w - SIDE)))
    y0 = int(min(max(y * h - SIDE / 2, 0), max(0, h - SIDE)))
    out = np.full((SIDE, SIDE, 3), 114, dtype=np.uint8)
    t = frame[y0:y0 + SIDE, x0:x0 + SIDE]
    out[:t.shape[0], :t.shape[1]] = t
    return out


def frames_at(video: str, times_ms: list[float]):
    import cv2
    cap = cv2.VideoCapture(video)
    for t in times_ms:
        cap.set(cv2.CAP_PROP_POS_MSEC, t)
        ok, f = cap.read()
        if ok:
            yield t, f  # OpenCV gives BGR, upright (it applies the rotation tag)
    cap.release()


def check(onnx_path: str, tflite_path: str, clips_txt: str, frames: int, sport: str | None) -> bool:
    base = os.path.dirname(os.path.abspath(clips_txt))
    a, b = Onnx(onnx_path), Lite(tflite_path)
    n_frames = n_on = n_lt = n_strong = n_match = 0
    worst = 0.0
    clips = []
    for line in open(clips_txt):
        if not line.strip() or line.startswith("#"):
            continue
        name, video, _start, _dur, sp, labels = line.strip().split("|")
        if labels == "-" or (sport and sp != sport):
            continue
        clips.append((name, os.path.join(base, video), os.path.join(base, labels)))
    per_clip = max(1, frames // max(1, len(clips)))
    for name, video, labels in clips:
        # a sample is [x, y] with the ball visible, or a word ("out") without it
        samples = {k: v for k, v in json.load(open(labels))["samples"].items() if isinstance(v, list) and len(v) == 2}
        keys = sorted(samples, key=float)
        pick = [keys[int(i * len(keys) / per_clip)] for i in range(min(per_clip, len(keys)))]
        times = [float(k) for k in pick]
        for t, f in frames_at(video, times):
            x, y = samples[str(pick[times.index(t)])]
            for img in (tile_at(f, x, y), letterbox(f)):
                ra, rb = a.run(img), b.run(img)
                sa = ra[:, 4] * ra[:, 5]
                sb = rb[:, 4] * rb[:, 5]
                worst = max(worst, float(np.abs(sa - sb).max()))
                ca, cb = decode(ra), decode(rb)
                n_on += len(ca)
                n_lt += len(cb)
                for c in ca:
                    if c[4] < 0.1:
                        continue
                    n_strong += 1
                    if any(iou(c, d) >= 0.9 for d in cb):
                        n_match += 1
            n_frames += 1
    print(f"{os.path.basename(tflite_path)}: {n_frames} frames ({2 * n_frames} inputs), candidates onnx {n_on} / tflite {n_lt}, "
          f"score >= 0.1 matched {n_match}/{n_strong}, largest score difference {worst:.5f}")
    return n_frames > 0 and n_strong > 0 and n_match == n_strong and worst < 0.02


def convert(onnx_path: str, out: str, clips_txt: str | None, sport: str | None) -> None:
    import onnx
    import onnxsim
    import tensorflow as tf
    work = tempfile.mkdtemp(prefix="android_tflite_")
    try:
        model, ok = onnxsim.simplify(onnx.load(onnx_path))
        if not ok:
            raise SystemExit("onnxsim could not check the simplified model")
        sim = os.path.join(work, "m.onnx")
        onnx.save(model, sim)
        subprocess.run([sys.executable, "-m", "onnx2tf", "-i", sim, "-o", os.path.join(work, "tf"), "-fdosm", "-n"],
                       check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        f32 = os.path.join(work, "tf", "m_float32.tflite")
        Lite(f32)  # fails on a dynamic tensor
        conv = tf.lite.TFLiteConverter.from_saved_model(os.path.join(work, "tf"))
        conv.optimizations = [tf.lite.Optimize.DEFAULT]
        conv.target_spec.supported_types = [tf.float16]
        f16 = os.path.join(work, "m_fp16.tflite")
        open(f16, "wb").write(conv.convert())
        chosen = f32
        try:
            Lite(f16)
            if clips_txt is None or check(onnx_path, f16, clips_txt, 40, sport):
                chosen = f16
            else:
                print("fp16 weights fail the check: keeping float32")
        except Exception as e:  # noqa: BLE001
            print(f"fp16 weights do not load ({e}): keeping float32")
        shutil.copyfile(chosen, out)
        print(f"{out}: {'fp16 weights' if chosen == f16 else 'float32'}, {os.path.getsize(out) / 1e6:.1f} MB")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> None:
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("convert")
    c.add_argument("onnx")
    c.add_argument("out")
    c.add_argument("--clips", help="clips.txt: check the fp16 file before keeping it")
    c.add_argument("--sport")
    k = sub.add_parser("check")
    k.add_argument("onnx")
    k.add_argument("tflite")
    k.add_argument("clips")
    k.add_argument("--frames", type=int, default=40)
    k.add_argument("--sport")
    a = p.parse_args()
    if a.cmd == "convert":
        convert(a.onnx, a.out, a.clips, a.sport)
    else:
        sys.exit(0 if check(a.onnx, a.tflite, a.clips, a.frames, a.sport) else 1)


if __name__ == "__main__":
    main()
