#!/usr/bin/env python3
"""Modo Foco lab: measure the app's Seguir a Bola camera on an exported 9:16 clip, against the same clip exported
without it (template matching, every 100 ms). Writes lab/tests/story/<clip>.appcam.json:
{"zoom": z, "rects": [[x, y, w, h] 0..1 of the original, or null], "match": [...]}.

    python3 tools/lab/app_camera.py <clip> <9:16 export>
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402


def read_frames(video, W, H, step_ms=100, dur_ms=None):
    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", video]
    if dur_ms:
        cmd += ["-t", f"{dur_ms / 1000}"]
    cmd += ["-vf", f"fps={1000 // step_ms}:start_time=0,scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    p = subprocess.run(cmd, capture_output=True, check=True)
    n = len(p.stdout) // (W * H)
    return np.frombuffer(p.stdout[: n * W * H], np.uint8).reshape(n, H, W)


def main():
    name, story = sys.argv[1], sys.argv[2]
    meta = ev.clip_meta(name)
    video = os.path.join(ev.ROOT, meta["video"])
    # the original at 960x540 (half of 1080p), the 9:16 export at 270x480
    OW, OH = 960, 540
    SW, SH = 270, 480
    orig = read_frames(video, OW, OH, dur_ms=meta["durMs"])
    st = read_frames(story, SW, SH, dur_ms=meta["durMs"])
    n = min(len(orig), len(st))
    # template: the story frame without its bottom 18% (the watermark) and edges
    def tmpl(fr, z):
        hcrop = OH / z  # crop height in original px
        s = hcrop / SH
        t = cv2.resize(fr, (max(8, int(round(SW * s))), max(8, int(round(SH * s)))), interpolation=cv2.INTER_AREA)
        th, tw = t.shape
        return t[int(0.04 * th): int(0.80 * th), int(0.05 * tw): int(0.95 * tw)], s, th, tw

    def best(k, z):
        t, s, th, tw = tmpl(st[k], z)
        if t.shape[0] > OH or t.shape[1] > OW:
            return -1, None
        r = cv2.matchTemplate(orig[k], t, cv2.TM_CCOEFF_NORMED)
        _, mv, _, ml = cv2.minMaxLoc(r)
        x0 = ml[0] - int(0.05 * tw)
        y0 = ml[1] - int(0.04 * th)
        return mv, (x0 / OW, y0 / OH, tw / OW, th / OH)

    # the clip's zoom: best mean match on a few frames
    probe = list(range(0, n, max(1, n // 8)))
    zs = np.round(np.arange(1.0, 2.25, 0.05), 2)
    score = {float(z): np.mean([best(k, z)[0] for k in probe]) for z in zs}
    z = max(score, key=score.get)
    rects, match = [], []
    for k in range(n):
        mv, r = best(k, z)
        match.append(round(float(mv), 3))
        rects.append([round(v, 4) for v in r] if r and mv >= 0.6 else None)
    out = os.path.join(ev.ROOT, "lab", "tests", "story", f"{name}.appcam.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"clip": name, "story": story, "zoom": z, "zoomScores": {str(k): round(v, 3) for k, v in score.items()},
               "rects": rects, "match": match}, open(out, "w"))
    print(f"zoom {z} (match {score[z]:.3f}); frames {n}; match min {min(match):.2f} median {np.median(match):.2f}")
    for k in range(n):
        r = rects[k]
        c = f"{r[0] + r[2] / 2:.3f}" if r else "  -  "
        print(f"{k / 10:4.1f}s cx {c} match {match[k]:.2f}")


if __name__ == "__main__":
    main()
