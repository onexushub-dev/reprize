#!/usr/bin/env python3
"""Modo Foco lab, test 50: side-by-side 9:16 panels of a clip — the app's measured camera (app_camera.py) and lab
variants (path overrides + camera smoothing) — with the labelled ball as a small ring.

    python3 tools/lab/pass_render.py basket-app-1110-a --label basket-app-1108-a \
        --var "Hoje (app)=app" --var "Câmera rápida=base@1:100" --var "Rápida + sem camisa=person_ratio=0.3,person_asp=1.35@1:100"
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
import evaluate as ev  # noqa: E402
import pass_sweep as ps  # noqa: E402
import story  # noqa: E402


def rects_for(name, tag, label, spec, n, W, H, zoom):
    if spec == "app":
        r = json.load(open(os.path.join(ps.OUT, f"{name}.appcam.json")))["rects"]
        r = [x if x is not None else r[i - 1] for i, x in enumerate(r)]
        return np.array(r[:n], dtype=float)
    path, _, cam = spec.partition("@")
    over = {} if path == "base" else {k: float(v) for k, v in (kv.split("=") for kv in path.split(","))}
    _, truth, tr, _ = ps.track(name, tag, label, over)
    today, _ = ps.today_of(name, n, W, H)
    a, b = (float(v) for v in cam.split(":")[:2])
    return bp.camera_rects(tr, today, W, H, zoom, smooth=(a, b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--tag", default="bgymall-n5")
    ap.add_argument("--label")
    ap.add_argument("--zoom", type=float, default=1.2)
    ap.add_argument("--var", action="append", required=True, help="Title=app or Title=<path>@a:b")
    ap.add_argument("--out")
    a = ap.parse_args()
    meta = ev.clip_meta(a.clip)
    video = os.path.join(ev.ROOT, meta["video"])
    W, H = story.source_size(meta)
    n = meta["count"]
    truth = ev.load_truth(a.label or a.clip)
    vars_ = [v.split("=", 1) for v in a.var]
    rects = [rects_for(a.clip, a.tag, a.label, spec, n, W, H, a.zoom) for _, spec in vars_]
    PW, PH = 360, 640
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                    "stream=avg_frame_rate", "-of", "json", video], capture_output=True,
                                   text=True).stdout)["streams"][0]["avg_frame_rate"]
    num, _, den = st.partition("/")
    fps = float(num) / float(den or 1)
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-i", video, "-t", f"{n / 10}", "-f", "rawvideo",
                            "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    out = a.out or os.path.join(ps.OUT, f"{a.clip}.pass-compare-t50.mp4")
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s",
                            f"{PW * len(vars_)}x{PH + 40}", "-r", f"{fps}", "-i", "-", "-c:v", "libx264", "-preset",
                            "veryfast", "-crf", "22", "-pix_fmt", "yuv420p", out], stdin=subprocess.PIPE)
    pts = {t: v for t, v in truth["samples"].items() if isinstance(v, tuple)}
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
        tl = int(round(t * 5)) * 200
        ball = pts.get(tl) if abs(t * 1000 - tl) < 70 else None
        for (title, _), R in zip(vars_, rects):
            x, y, w, h = (1 - u) * R[k] + u * R[k2]
            x0, y0, x1, y1 = int(x * W), int(y * H), int((x + w) * W), int((y + h) * H)
            crop = cv2.resize(fr[max(0, y0):y1, max(0, x0):x1], (PW, PH), interpolation=cv2.INTER_AREA)
            if ball is not None:
                bx, by = (ball[0] - x) / w * PW, (ball[1] - y) / h * PH
                inside = 0 <= bx < PW and 0 <= by < PH
                if inside:
                    cv2.circle(crop, (int(bx), int(by)), 16, (0, 255, 0), 2)
                else:
                    cv2.rectangle(crop, (0, 0), (PW - 1, PH - 1), (0, 0, 255), 6)
            head = np.zeros((40, PW, 3), np.uint8)
            cv2.putText(head, title, (8, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
            panels.append(np.vstack([head, crop]))
        img = np.hstack(panels)
        cv2.putText(img, f"{t:.1f}s", (PW * len(vars_) - 70, 27), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1)
        enc.stdin.write(img.tobytes())
        f += 1
    dec.kill()
    enc.stdin.close()
    enc.wait()
    print(out)


if __name__ == "__main__":
    main()
