#!/usr/bin/env python3
"""Modo Foco lab, test 36 (2026-11-08): which moment is a labelling frame? Compare lab/frames/<clip>/<k>.jpg (the
frames the labels were made on) with this machine's decode of the same window at 30 fps (the chain of ball_detect.py)
around the tick: the --fps frame with the smallest pixel difference is the moment the label shows. Offset in ms
relative to the tick (frame 3k at 30 fps = the frame ball_detect.py analyses at 10 fps).

    python3 tools/lab/frame_sync.py --frames <dir with 00080.jpg ...> clip k [k ...]
"""
import argparse
import os
import subprocess
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_detect as bd  # noqa: E402
import evaluate as ev  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", required=True)
    ap.add_argument("--span", type=int, default=6, help="--fps frames on each side")
    ap.add_argument("--fps", type=int, default=30, help="the fine grid (a multiple of 10)")
    ap.add_argument("clip")
    ap.add_argument("ks", nargs="+", type=int)
    a = ap.parse_args()
    meta = ev.clip_meta(a.clip)
    video = os.path.join(ev.ROOT, meta["video"])
    W, H = bd.upright(video)
    ref = {k: cv2.imread(os.path.join(a.frames, f"{k:05d}.jpg")) for k in a.ks}
    ref = {k: v for k, v in ref.items() if v is not None}
    m = a.fps // 10
    want = {m * k + s: (k, s) for k in ref for s in range(-a.span, a.span + 1) if m * k + s >= 0}
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{meta['startMs'] / 1000}", "-i", video, "-t",
                            f"{meta['durMs'] / 1000}", "-vf", f"fps={a.fps}:start_time=0", "-f", "rawvideo", "-pix_fmt",
                            "bgr24", "-"], stdout=subprocess.PIPE)
    fb = W * H * 3
    diff = {k: {} for k in ref}
    j = 0
    while j <= max(want):
        buf = dec.stdout.read(fb)
        if len(buf) < fb:
            break
        if j in want:
            k, s = want[j]
            fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
            r = ref[k]
            fr = cv2.resize(fr, (r.shape[1], r.shape[0]), interpolation=cv2.INTER_AREA)
            diff[k][s] = float(np.mean(np.abs(fr.astype(np.int16) - r.astype(np.int16))))
        j += 1
    dec.kill()
    for k in sorted(diff):
        best = min(diff[k], key=diff[k].get)
        row = " ".join(f"{s:+d}:{diff[k][s]:.1f}" for s in sorted(diff[k]))
        print(f"{a.clip} k={k}: best {best:+d} ({best * 1000 / a.fps:+.0f} ms)   {row}")


if __name__ == "__main__":
    main()
