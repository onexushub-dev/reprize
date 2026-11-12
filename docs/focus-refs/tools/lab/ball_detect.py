#!/usr/bin/env python3
"""Modo Foco lab, test 17 (2026-11-05): find the ball in every 100 ms frame with a COCO-trained object detector (no
tap, no training): YOLOX (Megvii, Apache-2.0, ONNX from its GitHub release), class "sports ball". Small balls: the
detector also runs on native-resolution 640 px tiles (like the 9 tiles of today's Modo Foco), merged by NMS.

Output per clip: lab/tests/detect/<clip>.<tag>.json = {"frames": [[[cx, cy, w, h, score], ...] per 100 ms frame]},
whole-frame 0..1 coordinates, all candidates above --conf (the choice of THE ball is ball_track.py's job).

    python3 tools/lab/ball_detect.py --model lab/models/yolox_s.onnx --tag yolox-s-t [clip ...]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "detect")
BALL = 32  # COCO "sports ball"


def upright(video):
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                    video], capture_output=True, text=True, check=True).stdout)["streams"][0]
    W, H = st["width"], st["height"]
    rot = int(st.get("tags", {}).get("rotate", 0))
    for side in st.get("side_data_list", []):
        if "rotation" in side:
            rot = int(side["rotation"])
    if abs(rot) % 180 == 90:
        W, H = H, W
    return W, H


class Yolox:
    def __init__(self, path, threads=2):
        import onnxruntime as ort
        o = ort.SessionOptions()
        o.intra_op_num_threads = threads
        self.s = ort.InferenceSession(path, o, providers=["CPUExecutionProvider"])
        self.name = self.s.get_inputs()[0].name
        # COCO models: 85 outputs (class 32 = sports ball); our fine-tuned ball models (test 18): 6 (one class)
        self.cls = 0 if self.s.get_outputs()[0].shape[-1] == 6 else BALL
        self.size = int(self.s.get_inputs()[0].shape[-1])  # 640 (S, L) or 416 (Tiny, Nano)
        grids, strides = [], []
        for st in (8, 16, 32):
            n = self.size // st
            yy, xx = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
            grids.append(np.stack([xx, yy], -1).reshape(-1, 2))
            strides.append(np.full((n * n, 1), st))
        self.grid = np.concatenate(grids).astype(np.float32)
        self.stride = np.concatenate(strides).astype(np.float32)

    def run(self, imgs, conf):
        """imgs: list of HxWx3 BGR uint8 (any size <= anything); returns per image [(x, y, w, h, score)] in its px."""
        S = self.size
        batch, ratios = [], []
        for im in imgs:
            h, w = im.shape[:2]
            r = min(S / h, S / w)
            import cv2
            rs = cv2.resize(im, (int(w * r), int(h * r)), interpolation=cv2.INTER_LINEAR) if r != 1 else im
            pad = np.full((S, S, 3), 114, np.uint8)
            pad[:rs.shape[0], :rs.shape[1]] = rs
            batch.append(pad.transpose(2, 0, 1))
            ratios.append(r)
        out = []
        for b, r in zip(batch, ratios):  # the ONNX export has batch 1
            p = self.s.run(None, {self.name: b[None].astype(np.float32)})[0][0]
            xy = (p[:, :2] + self.grid) * self.stride
            wh = np.exp(p[:, 2:4]) * self.stride
            score = p[:, 4] * p[:, 5 + self.cls]
            k = score >= conf
            res = [(float(x / r), float(y / r), float(w_ / r), float(h_ / r), float(s_))
                   for (x, y), (w_, h_), s_ in zip(xy[k], wh[k], score[k])]
            out.append(res)
        return out


def tiles(W, H, T=640, overlap=80):
    def starts(n):
        if n <= T:
            return [0]
        k = int(np.ceil((n - overlap) / (T - overlap)))
        return [int(round(i * (n - T) / (k - 1))) for i in range(k)]
    return [(x, y) for y in starts(H) for x in starts(W)]


def nms(c, iou=0.5):
    c = sorted(c, key=lambda v: -v[4])
    keep = []
    for v in c:
        ok = True
        for k in keep:
            ix = max(0, min(v[0] + v[2] / 2, k[0] + k[2] / 2) - max(v[0] - v[2] / 2, k[0] - k[2] / 2))
            iy = max(0, min(v[1] + v[3] / 2, k[1] + k[3] / 2) - max(v[1] - v[3] / 2, k[1] - k[3] / 2))
            u = v[2] * v[3] + k[2] * k[3] - ix * iy
            if u > 0 and ix * iy / u > iou:
                ok = False
                break
        if ok:
            keep.append(v)
    return keep


def run_clip(det, name, tag, conf, use_tiles, limit=None, step=1, tile=640, max_width=None):
    meta = ev.clip_meta(name)
    video = os.path.join(ev.ROOT, meta["video"])
    W, H = upright(video)
    # 2026-11-12 plan (candidate 1): a frame wider than max_width is scaled down to it before the tiles (4K -> 1920)
    scale = ""
    if max_width and max(W, H) > max_width:
        f = max_width / max(W, H)
        W, H = int(round(W * f / 2)) * 2, int(round(H * f / 2)) * 2
        scale = f",scale={W}:{H}:flags=area"
    n = meta["count"] if limit is None else min(limit, meta["count"])
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{meta['startMs'] / 1000}", "-i", video, "-t",
                            f"{meta['durMs'] / 1000}", "-vf", "fps=10:start_time=0" + scale, "-f", "rawvideo", "-pix_fmt",
                            "bgr24", "-"], stdout=subprocess.PIPE)
    fb = W * H * 3
    T = tiles(W, H, tile) if use_tiles else []
    frames = []
    t0 = time.time()
    for k in range(n):
        buf = dec.stdout.read(fb)
        if len(buf) < fb:
            break
        if k % step:
            frames.append(None)  # not analysed (--step)
            continue
        fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        crops = [fr] + [fr[y:y + tile, x:x + tile] for x, y in T]
        res = det.run(crops, conf)
        cand = list(res[0])
        for (x, y), rr in zip(T, res[1:]):
            cand += [(cx + x, cy + y, w, h, s) for cx, cy, w, h, s in rr]
        cand = nms(cand)
        frames.append([[round(cx / W, 4), round(cy / H, 4), round(w / W, 4), round(h / H, 4), round(s, 3)]
                       for cx, cy, w, h, s in cand])
    dec.kill()
    secs = time.time() - t0
    os.makedirs(OUT, exist_ok=True)
    json.dump({"clip": name, "tag": tag, "size": [W, H], "max_width": max_width, "tiles": len(T), "tile": tile, "model_size": det.size, "conf": conf, "seconds": round(secs, 1),
               "step": step,
               "frames": frames}, open(os.path.join(OUT, f"{name}.{tag}.json"), "w"))
    return len(frames), secs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--conf", type=float, default=0.05)
    ap.add_argument("--no-tiles", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--tile", type=int, default=640, help="tile side in video px (resized to the model's input)")
    ap.add_argument("--step", type=int, default=1, help="analyse every STEP-th 100 ms frame (2 = 5 fps)")
    ap.add_argument("--max-width", type=int, default=None, help="scale frames wider than this down first (4K -> 1920)")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    det = Yolox(a.model, a.threads)
    for name in a.clips:
        if os.path.exists(os.path.join(OUT, f"{name}.{a.tag}.json")) and a.limit is None:
            print(name, "done already", flush=True)
            continue
        n, secs = run_clip(det, name, a.tag, a.conf, not a.no_tiles, a.limit, a.step, a.tile, a.max_width)
        print(f"{name}: {n} frames in {secs:.0f} s ({1000 * secs * a.step / max(n, 1):.0f} ms/analysed frame)", flush=True)


if __name__ == "__main__":
    main()
