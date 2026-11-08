#!/usr/bin/env python3
"""Modo Foco lab, test 33 (2026-11-08): a basketball detector trained only on OUR recordings. Our hand labels are few
(test 18: not enough), so the app's unlabelled basketball recordings (clips/basket-*.mp4, dumped from the app) get
automatic labels ("pseudo-labels") from a teacher detector, kept only where the teacher is sure:

  clips    print clips.txt rows "own-<file>" for the app recordings in clips/ (minus --exclude)
  crops    per clip: the teacher's ball path (ball_track.py on --det) at each analysed frame; a frame counts when a
           candidate with score >= --min-score sits within the lab radius of the path's point (the path and a strong
           detection agree) and the point is not a still object (spare ball, painted ball, rim: seen at the same place
           on >= 30% of the clip's analysed frames). 320 px native crops like test 18's: the ball at a random offset
           + about one crop per two balls with no candidate >= 0.3 in it -> lab/train/pl-<clip>/items.json

The images are ours; the labels come from the teacher (test 33b: ball_tiny_hn, trained on the public dataset), so
the result still depends on that dataset indirectly — see README test 33.

    python3 tools/lab/pseudo_label.py clips --exclude basket-v-corner-normal-01 >> tools/lab/clips.txt
    python3 tools/lab/pseudo_label.py crops --det bhn-n5 --track det-bhn-n5 own-basket-h-side-low-normal-01 ...
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import random
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
TRACKS = os.path.join(ev.ROOT, "lab", "tests", "oneclick")
TRAIN = os.path.join(ev.ROOT, "lab", "train")
CROP = 320


def cmd_clips(a):
    for p in sorted(glob.glob(os.path.join(ev.ROOT, "clips", "basket-*.mp4"))):
        stem = os.path.splitext(os.path.basename(p))[0]
        if stem in a.exclude:
            continue
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p],
                                   capture_output=True, text=True, check=True).stdout)
        print(f"own-{stem}|clips/{stem}.mp4|0|{int(dur * 1000) // 100 * 100 - 100}|basquete")


def cmd_crops(a):
    import cv2
    rng = random.Random(0)
    for name in a.clips:
        meta = ev.clip_meta(name)
        frames = json.load(open(os.path.join(DET, f"{name}.{a.det}.json")))["frames"]
        path = json.load(open(os.path.join(TRACKS, f"{name}.ball.{a.track}.json")))["pred_one"]
        cap = cv2.VideoCapture(os.path.join(ev.ROOT, meta["video"]))
        W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        ok, fr0 = cap.read()
        if ok:
            H, W = fr0.shape[:2]  # upright size as decoded (OpenCV applies the rotation)
        R = ev.radius_px([W, H])
        analysed = [k for k, f in enumerate(frames) if f is not None]
        strong = [c for k in analysed for c in frames[k] if c[4] >= a.min_score]

        def dist(p, q):
            return float(np.hypot((p[0] - q[0]) * W, (p[1] - q[1]) * H))

        def still(p):
            return sum(1 for c in strong if dist(c, p) <= R) >= 0.3 * len(analysed)

        want = []
        for k in analysed:
            p = path.get(str(k))
            if not p:
                continue
            best = max((c for c in frames[k] if c[4] >= a.min_score and dist(c, p) <= R), key=lambda c: c[4],
                       default=None)
            if best is not None and not still(best):
                want.append((k, best))
        rng.shuffle(want)
        want = sorted(want[: a.per_clip])
        d = os.path.join(TRAIN, f"pl-{name}")
        os.makedirs(d, exist_ok=True)
        items = []
        for k, b in want:
            cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"] + k * 100)
            ok, fr = cap.read()
            if not ok:
                continue
            H, W = fr.shape[:2]
            bx, by, bw, bh = b[0] * W, b[1] * H, max(b[2] * W, 3.0), max(b[3] * H, 3.0)
            x0 = int(min(max(bx - rng.uniform(0.15, 0.85) * CROP, 0), W - CROP))
            y0 = int(min(max(by - rng.uniform(0.15, 0.85) * CROP, 0), H - CROP))
            fn = f"{k:04d}-p.jpg"
            cv2.imwrite(os.path.join(d, fn), fr[y0:y0 + CROP, x0:x0 + CROP], [cv2.IMWRITE_JPEG_QUALITY, 92])
            items.append({"file": fn, "boxes": [[bx - x0, by - y0, bw, bh]], "score": b[4], "k": k})
            if rng.random() < a.neg:  # a crop with nothing the teacher would call a ball
                busy = [c for c in frames[k] if c[4] >= 0.3]
                for _ in range(20):
                    nx, ny = rng.randint(0, W - CROP), rng.randint(0, H - CROP)
                    if all(not (nx - 8 <= c[0] * W <= nx + CROP + 8 and ny - 8 <= c[1] * H <= ny + CROP + 8)
                           for c in busy + [b]):
                        fn = f"{k:04d}-n.jpg"
                        cv2.imwrite(os.path.join(d, fn), fr[ny:ny + CROP, nx:nx + CROP], [cv2.IMWRITE_JPEG_QUALITY, 92])
                        items.append({"file": fn, "boxes": []})
                        break
        cap.release()
        json.dump({"clip": f"pl-{name}", "teacher": {"det": a.det, "track": a.track, "min_score": a.min_score},
                   "items": items}, open(os.path.join(d, "items.json"), "w"))
        npos = sum(1 for i in items if i["boxes"])
        print(f"pl-{name}: {npos} balls of {len(analysed)} analysed frames, {len(items) - npos} crops without", flush=True)


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("clips")
    p.add_argument("--exclude", type=lambda s: s.split(","), default=[])
    p = sub.add_parser("crops")
    p.add_argument("--det", required=True)
    p.add_argument("--track", required=True)
    p.add_argument("--min-score", type=float, default=0.5)
    p.add_argument("--per-clip", type=int, default=200)
    p.add_argument("--neg", type=float, default=0.5)
    p.add_argument("clips", nargs="+")
    a = ap.parse_args()
    {"clips": cmd_clips, "crops": cmd_crops}[a.cmd](a)


if __name__ == "__main__":
    main()
