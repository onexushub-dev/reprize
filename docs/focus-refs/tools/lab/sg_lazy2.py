#!/usr/bin/env python3
"""Modo Foco lab, test 23: test 22's calm camera on the app clips, horizontal AND vertical (x and y), 1-tap engines.

Victor picked "1 toque - zona 0.20" from test 22 (YOLOX-S + EdgeTAM, dead zone 0.20, a 10, b 1000) on 2 app clips +
2 YouTube clips. Here: every labelled app clip, and EdgeTAM alone (edgetam-fuse5, 2.5x cheaper on the phone) next to it.

Crop size per frame = today's portrait Modo Foco crop (vertical sources: today's zoom; horizontal: 9:16 of the full
height). Its centre on each axis = sg_lazy.lazy_path on that axis (target: trusted ball, 1 s gaps bridged, else the last
ball, weight 0.2; dead zone dz x the crop size on that axis). Ball in crop counts x and y.

    python3 tools/lab/sg_lazy2.py                 # scores -> lab/tests/sg/lazy2-summary.md
    python3 tools/lab/sg_lazy2.py --render <clip> # today | EdgeTAM alone | YOLOX-S + EdgeTAM -> lab/tests/sg/<clip>.lazy2.mp4
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
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402
import sg_lazy  # noqa: E402

OUT = os.path.join(sg.TESTS, "sg")
APP_CLIPS = ["bt-rz-1105-a", "bt-rz-1105-b", "basket-rp-1105-h",  # horizontal
             "bt-rz-1105-v", "bt-0AE39B33", "bt-E5003B6B", "basket-v-01", "basket-rp-1105-v-a", "basket-rp-1105-v-b"]
ENGINES = [("edgetam-fuse5", "So EdgeTAM"), ("mix-det-fuse5", "YOLOX-S + EdgeTAM")]
DZ, A, B, WFB = 0.20, 10.0, 1000.0, 0.2


def load(name):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    n = meta["count"]
    with open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")) as f:
        fc = json.load(f)
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    cur = np.array(fc["portrait"][off:off + n], dtype=float)
    n = min(n, len(cur))
    return meta, truth, n, cur[:n]


def lazy_rects(name, tag, meta, truth, n, cur):
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{tag}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    isball = np.array([p is not None for p in tr])
    w = np.where(isball, 1.0, WFB)
    rects = cur.copy()
    for ax in (0, 1):
        size = cur[:, 2 + ax]
        if size.min() >= 0.999:  # full frame on this axis: nothing to move
            continue
        today_c = cur[:, ax] + size / 2
        balls = [None if p is None else p[ax] for p in tr]
        t = sg.target_x(balls, today_c, 10, "hold")
        c = sg_lazy.lazy_path(t, w, DZ * float(size.mean()), A, B)
        c = np.clip(c, size / 2, 1 - size / 2)
        rects[:, ax] = c - size / 2
    return rects


def score(rects, truth, n):
    pts = inside = 0
    for t, v in truth["samples"].items():
        i = t // 100
        if not isinstance(v, tuple) or i >= n:
            continue
        x, y, w, h = rects[i]
        pts += 1
        inside += (x <= v[0] <= x + w) and (y <= v[1] <= y + h)
    flips = 0
    for ax in (0, 1):
        if rects[:, 2 + ax].min() < 0.999:
            c = rects[:, ax] + rects[:, 2 + ax] / 2
            flips += sg.score(c, 0.0, {"samples": {}}, n)["flips"]
    return {"pts": pts, "in": inside / pts if pts else None, "flips": flips}


def summary():
    lines = ["# Test 23 — calm 1-tap camera on the app clips (dz 0.20, a 10, b 1000, hold)", "",
             "| Clip | Source | Labels | Ball in crop: today | EdgeTAM alone | YOLOX-S + EdgeTAM "
             "| Direction changes /10 s: today | EdgeTAM | mix |", "|---|---|---|---|---|---|---|---|---|"]
    rows = []
    for name in APP_CLIPS:
        meta, truth, n, cur = load(name)
        st = score(cur, truth, n)
        res = [score(lazy_rects(name, tag, meta, truth, n, cur), truth, n) for tag, _ in ENGINES]
        src = "vertical" if truth["size"][1] > truth["size"][0] else "horizontal"
        rows.append((st, res))
        lines.append(f"| {name} | {src} | {st['pts']} | {st['in']:.0%} | {res[0]['in']:.0%} | {res[1]['in']:.0%} "
                     f"| {st['flips']:.1f} | {res[0]['flips']:.1f} | {res[1]['flips']:.1f} |")
        print(lines[-1], flush=True)
    m = lambda f: sum(f(r) for r in rows) / len(rows)  # noqa: E731
    lines.append(f"| **mean** | | | {m(lambda r: r[0]['in']):.0%} | {m(lambda r: r[1][0]['in']):.0%} "
                 f"| {m(lambda r: r[1][1]['in']):.0%} | {m(lambda r: r[0]['flips']):.1f} "
                 f"| {m(lambda r: r[1][0]['flips']):.1f} | {m(lambda r: r[1][1]['flips']):.1f} |")
    with open(os.path.join(OUT, "lazy2-summary.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(lines[-1])


def render(name):
    import cv2
    meta, truth, n, cur = load(name)
    cams = [("Hoje (Modo Foco)", cur)] + [(label, lazy_rects(name, tag, meta, truth, n, cur)) for tag, label in ENGINES]
    cap = cv2.VideoCapture(os.path.join(ev.ROOT, meta["video"]))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"])
    pw, ph = 540, 960
    tmp = f"/tmp/{name}.lazy2.tmp.mp4"
    out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (pw * len(cams), ph))
    grid = np.arange(n) * 0.1
    k = 0
    while k / fps <= grid[-1]:
        ok, fr = cap.read()
        if not ok:
            break
        H, W = fr.shape[:2]
        panels = []
        for label, r in cams:
            x, y, w, h = (float(np.interp(k / fps, grid, r[:, j])) for j in range(4))
            x0, y0 = int(round(x * W)), int(round(y * H))
            crop = fr[y0:y0 + max(2, int(round(h * H))), x0:x0 + max(2, int(round(w * W)))]
            crop = cv2.resize(crop, (pw, ph))
            for col, th in (((0, 0, 0), 4), ((255, 255, 255), 2)):
                cv2.putText(crop, label, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, col, th, cv2.LINE_AA)
            panels.append(crop)
        out.write(np.hstack(panels))
        k += 1
    out.release()
    cap.release()
    dst = os.path.join(OUT, f"{name}.lazy2.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", dst], check=True)
    os.remove(tmp)
    print(dst, k, "frames", W, "x", H)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", default=None)
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    render(a.render) if a.render else summary()


if __name__ == "__main__":
    main()
