#!/usr/bin/env python3
"""Test 21 videos: today's portrait Modo Foco | offline Savitzky-Golay on engine A | on engine B, side by side (9:16).

    python3 tools/lab/sg_render.py <clip> [--engines det-yolox-s-t5:players:1.5,mix-det-fuse5:hold:1.0]
Writes lab/tests/sg/<clip>.compare.mp4 (each panel 540x960, the clip's own fps, H.264).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402


def paths(name, specs):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    n = meta["count"]
    with open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")) as f:
        fc = json.load(f)
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    cur = fc["portrait"][off:off + n]
    n = min(n, len(cur))
    cw = cur[0][2]
    today = np.array([r[0] + r[2] / 2 for r in cur[:n]])
    out = [("Hoje (Modo Foco)", today)]
    for spec in specs:
        tag, fb, w = spec.split(":")
        with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{tag}.json")) as f:
            oc = json.load(f)
        tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
        balls = [None if b is None else b[0] for b in tr]
        tx = sg.target_x(balls, today, 10, fb)
        out.append((f"{tag} {fb} {w}s", sg.savgol(tx, int(round(float(w) / 0.1)))))
    return meta, cw, n, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--engines", default="det-yolox-s-t5:players:1.5,mix-det-fuse5:hold:1.0")
    a = ap.parse_args()
    meta, cw, n, cams = paths(a.clip, a.engines.split(","))
    video = os.path.join(ev.ROOT, meta["video"])
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"])
    W, H = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    pw, ph = 540, 960
    tmp = f"/tmp/{a.clip}.compare.tmp.mp4"  # outside the connected folder (no deletes there)
    out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (pw * len(cams), ph))
    grid = np.arange(n) * 0.1
    k = 0
    while True:
        t = k / fps
        if t > grid[-1]:
            break
        ok, fr = cap.read()
        if not ok:
            break
        panels = []
        for label, cx in cams:
            c = float(np.interp(t, grid, cx))
            x0 = int(round(min(max(c - cw / 2, 0), 1 - cw) * W))
            crop = cv2.resize(fr[:, x0:x0 + int(round(cw * W))], (pw, ph))
            cv2.putText(crop, label, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4, cv2.LINE_AA)
            cv2.putText(crop, label, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2, cv2.LINE_AA)
            panels.append(crop)
        out.write(np.hstack(panels))
        k += 1
    out.release()
    cap.release()
    dst = os.path.join(sg.OUT, f"{a.clip}.compare.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", dst], check=True)
    os.remove(tmp)
    print(dst, k, "frames")


if __name__ == "__main__":
    main()
