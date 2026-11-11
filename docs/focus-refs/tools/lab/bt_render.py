#!/usr/bin/env python3
"""Modo Foco lab, test 52: side-by-side 9:16 panels of a beach tennis clip — the app's measured camera
(app_camera.py) and cam_bt.py variants on given ball tracks. Clips without labels are allowed.

    python3 tools/lab/bt_render.py bt-app-1111-a --var "Hoje (app)=app" --var "T49f=det-t52-base@" \
        --var "cabeca=det-t52-h15@a=0.5,b=50,hitbox=2"
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
import ball_parity as bp  # noqa: E402
import cam_bt  # noqa: E402
import evaluate as ev  # noqa: E402

ev.load_truth = bp.truth_or_empty
SHIP = "blend=0.4,a=1,b=100,courtp=0.2,court=0.25,pair=1,pairpad=0,exit=0.05,own=1,smin=0.5,step=0.08,pairnear=0.25,glide=6"


def rects_of(name, spec, n):
    if spec == "app":
        r = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "story", f"{name}.appcam.json")))["rects"]
        r = [x if x is not None else r[i - 1] for i, x in enumerate(r)]
        return np.array((r + [r[-1]] * n)[:n], dtype=float), None
    track, _, kv = spec.partition("@")
    v = dict(cam_bt.BASE)
    for item in filter(None, (SHIP + ("," + kv if kv else "")).split(",")):
        k, _, x = item.partition("=")
        v[k] = float(x)
    zr = cam_bt.story.sport_zoom(name, track)
    _, _, _, rects, _, _, tr, _ = cam_bt.camera(name, track, zr[0] if zr else 1.0, v)
    return rects, tr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--var", action="append", required=True)
    ap.add_argument("--out")
    a = ap.parse_args()
    meta = ev.clip_meta(a.clip)
    video = os.path.join(ev.ROOT, meta["video"])
    W, H = bp.story.source_size(meta)
    n = meta["count"]
    vs = [x.split("=", 1) for x in a.var]
    rs = [rects_of(a.clip, spec, n) for _, spec in vs]
    PW, PH = 300, 534
    fps = 30
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", video, "-t", f"{n / 10}", "-vf", f"fps={fps}",
                            "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    out = a.out or os.path.join(ev.ROOT, "lab", "tests", "story", f"{a.clip}.bt-compare-t52.mp4")
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s",
                            f"{PW * len(vs)}x{PH + 36}", "-r", str(fps), "-i", "-", "-c:v", "libx264", "-preset",
                            "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    f = 0
    while True:
        buf = dec.stdout.read(W * H * 3)
        if len(buf) < W * H * 3:
            break
        fr = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        t = f / fps
        k = min(n - 1, int(t * 10))
        k2 = min(n - 1, k + 1)
        u = t * 10 - k
        panels = []
        for (title, _), (R, tr) in zip(vs, rs):
            x, y, w, h = (1 - u) * R[k] + u * R[k2]
            crop = cv2.resize(fr[int(y * H):int((y + h) * H), int(x * W):int((x + w) * W)], (PW, PH),
                              interpolation=cv2.INTER_AREA)
            head = np.zeros((36, PW, 3), np.uint8)
            cv2.putText(head, title, (6, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)
            panels.append(np.vstack([head, crop]))
        img = np.hstack(panels)
        cv2.putText(img, f"{t:.1f}s", (PW * len(vs) - 60, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (200, 200, 200), 1)
        enc.stdin.write(img.tobytes())
        f += 1
    dec.kill()
    enc.stdin.close()
    enc.wait()
    print(out)


if __name__ == "__main__":
    main()
