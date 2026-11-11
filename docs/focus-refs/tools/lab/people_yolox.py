#!/usr/bin/env python3
"""Modo Foco lab, test 50: person boxes per analysed frame with YOLOX-Tiny COCO (class "person"), as a stand-in for the
app's Vision boxes (the Modo Foco file's "people") on clips without them. Whole frame + 640 px tiles, NMS 0.5, score
>= 0.3. Writes lab/tests/detect/<clip>.people-yx.json = {"size": [W, H], "frames": [[[cx, cy, w, h, s], ...] | null]}
on the same 100 ms grid (every --step-th frame).

    python3 tools/lab/people_yolox.py [--step 2] clip ...
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_detect as bd  # noqa: E402
import evaluate as ev  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", type=int, default=2)
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    det = bd.Yolox(os.path.join(ev.ROOT, "lab", "models", "yolox_tiny.onnx"), a.threads)
    det.cls = 0  # COCO person
    for name in a.clips:
        out = os.path.join(bd.OUT, f"{name}.people-yx.json")
        if os.path.exists(out):
            print("skip", name)
            continue
        meta = ev.clip_meta(name)
        video = os.path.join(ev.ROOT, meta["video"])
        W, H = bd.upright(video)
        n = meta["count"]
        dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{meta['startMs'] / 1000}", "-i", video,
                                "-t", f"{meta['durMs'] / 1000}", "-vf", "fps=10:start_time=0", "-f", "rawvideo",
                                "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
        T = bd.tiles(W, H, 640)
        frames = []
        for k in range(n):
            buf = dec.stdout.read(W * H * 3)
            if len(buf) < W * H * 3:
                break
            if k % a.step:
                frames.append(None)
                continue
            fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
            res = det.run([fr] + [fr[y:y + 640, x:x + 640] for x, y in T], 0.3)
            cand = list(res[0])
            for (x, y), rr in zip(T, res[1:]):
                cand += [(cx + x, cy + y, w, h, s) for cx, cy, w, h, s in rr]
            cand = bd.nms(cand, 0.5)
            frames.append([[round(cx / W, 4), round(cy / H, 4), round(w / W, 4), round(h / H, 4), round(s, 3)]
                           for cx, cy, w, h, s in cand])
        dec.kill()
        json.dump({"clip": name, "size": [W, H], "step": a.step, "frames": frames}, open(out, "w"))
        print(name, len(frames), flush=True)


if __name__ == "__main__":
    main()
