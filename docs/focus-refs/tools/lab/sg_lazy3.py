#!/usr/bin/env python3
"""Modo Foco lab, test 24: test 23's calm camera, fixed after Victor's review (2026-11-06).

1. The camera sat too high on some clips (bt-0AE39B33): on y it followed the ball and, when a lob was lost up high,
   held there. Now on y the camera stays at today's height (the players) and moves only as much as needed to keep the
   ball inside the crop with a margin (15% of the crop height below its top edge, 10% above its bottom), the rule of
   hybrid.py round 4. No ball -> back to the players' height (no "hold" on y). x is test 23's dead zone, unchanged.
2. Output in the orientation the clip was recorded in, as the app does (vertical source -> 9:16, horizontal -> 16:9
   from today's landscape crop); --aspect portrait keeps test 23's 9:16 for every clip.

Optimisation per axis (offline, sg_lazy's active-set least squares, generalised):
    min  sum_i w_i dist(c_i, [lo_i, hi_i])^2 + wa sum_i (c_i - anchor_i)^2 + a sum (dc)^2 + b sum (d2c)^2
x: band = ball +- dz*w, anchor none (target as test 22: bridged ball, else last ball at weight 0.2)
y: band = [ball - (0.5 - 0.10) h, ball + (0.5 - 0.15) h] on trusted / bridged balls only, anchor = today's centre y

    python3 tools/lab/sg_lazy3.py [--aspect native|portrait]
    python3 tools/lab/sg_lazy3.py --render <clip> [--aspect native|portrait]
    python3 tools/lab/sg_lazy3.py [--render <clip>] --zoom 1.5 --suffix -z15   # 16:9 at a fixed 1.5x (test 25)
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
import sg_lazy2 as l2  # noqa: E402

OUT = os.path.join(sg.TESTS, "sg")
DZ, A, B, WFB = 0.20, 10.0, 1000.0, 0.2
TOP, BOTTOM, WA = 0.15, 0.10, 0.05


def band_path(lo, hi, w, anchor, wa, a, b, iters=40):
    n = len(lo)
    D1 = np.diff(np.eye(n), 1, axis=0)
    D2 = np.diff(np.eye(n), 2, axis=0)
    R = a * D1.T @ D1 + b * D2.T @ D2 + (wa + 1e-6) * np.eye(n)
    rhs0 = (wa + 1e-6) * anchor
    c = np.where(np.isfinite(lo), (np.nan_to_num(lo) + np.nan_to_num(hi)) / 2, anchor)
    for _ in range(iters):
        out = (c < lo) | (c > hi)
        y = np.clip(c, lo, hi)
        wd = np.where(out, w, 0.0)
        c_new = np.linalg.solve(np.diag(wd) + R, wd * np.nan_to_num(y) + rhs0)
        done = np.max(np.abs(c_new - c)) < 1e-5
        c = c_new
        if done:
            break
    return c


ONLY = None  # --only <engine tag>: render today | that engine only
ZOOM = None  # --zoom: fixed crop zoom for 16:9 output (crop = 1/zoom of the frame, centred where today's is)


def load(name, aspect):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    n = meta["count"]
    with open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")) as f:
        fc = json.load(f)
    if aspect == "native":
        aspect = "portrait" if truth["size"][1] > truth["size"][0] else "landscape"
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    cur = np.array(fc[aspect][off:off + n], dtype=float)
    n = min(n, len(cur))
    cur = cur[:n]
    if ZOOM and aspect == "landscape":
        size = np.minimum(cur[:, 2], 1 / ZOOM)
        cx, cy = cur[:, 0] + cur[:, 2] / 2, cur[:, 1] + cur[:, 3] / 2
        cx = np.clip(cx, size / 2, 1 - size / 2)
        cy = np.clip(cy, size / 2, 1 - size / 2)
        cur = np.stack([cx - size / 2, cy - size / 2, size, size], axis=1)
    return meta, truth, n, cur, aspect


def bridged(vals, gap=10):
    """Ball coordinate per frame with gaps up to `gap` frames filled by a straight line; None elsewhere."""
    out = list(vals)
    idx = [i for i, v in enumerate(vals) if v is not None]
    for p, q in zip(idx, idx[1:]):
        if 1 < q - p <= gap:
            for j, v in enumerate(np.linspace(vals[p], vals[q], q - p + 1)[1:-1]):
                out[p + 1 + j] = float(v)
    return out


def rects_for(name, tag, meta, truth, n, cur):
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{tag}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    isball = np.array([p is not None for p in tr])
    rects = cur.copy()
    # x: test 22/23's dead zone around the (bridged, else held) ball
    w_, cx_today = cur[:, 2], cur[:, 0] + cur[:, 2] / 2
    if w_.min() < 0.999:
        tx = sg.target_x([None if p is None else p[0] for p in tr], cx_today, 10, "hold")
        cx = band_path(tx - DZ * w_.mean(), tx + DZ * w_.mean(), np.where(isball, 1.0, WFB), cx_today, 0.0, A, B)
        cx = np.clip(cx, w_ / 2, 1 - w_ / 2)
        rects[:, 0] = cx - w_ / 2
    # y: players' height, rise only as far as the ball needs
    h_, cy_today = cur[:, 3], cur[:, 1] + cur[:, 3] / 2
    if h_.min() < 0.999:
        by = bridged([None if p is None else p[1] for p in tr])
        lo = np.array([-np.inf if v is None else v - (0.5 - BOTTOM) * h for v, h in zip(by, h_)])
        hi = np.array([np.inf if v is None else v + (0.5 - TOP) * h for v, h in zip(by, h_)])
        cy = band_path(lo, hi, np.ones(n), cy_today, WA, A, B)
        cy = np.clip(cy, h_ / 2, 1 - h_ / 2)
        rects[:, 1] = cy - h_ / 2
    return rects


def today_rects(name, aspect):
    global ZOOM
    z, ZOOM = ZOOM, None
    try:
        return load(name, aspect)[3]
    finally:
        ZOOM = z


def summary(aspect, suffix=""):
    lines = [f"# Test 24 — calm 1-tap camera, y at the players' height, output aspect {aspect}", "",
             "| Clip | Output | Labels | Ball in crop: today | EdgeTAM alone | YOLOX-S + EdgeTAM "
             "| Direction changes /10 s: today | EdgeTAM | mix | Crop centre y, mean: today | EdgeTAM | mix |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    rows = []
    for name in l2.APP_CLIPS:
        meta, truth, n, cur, asp = load(name, aspect)
        today = today_rects(name, aspect)
        st = l2.score(today, truth, n)
        rs = [rects_for(name, tag, meta, truth, n, cur) for tag, _ in l2.ENGINES]
        res = [l2.score(r, truth, n) for r in rs]
        cy = [float(np.mean(r[:, 1] + r[:, 3] / 2)) for r in [today] + rs]
        rows.append((st, res))
        lines.append(f"| {name} | {asp} | {st['pts']} | {st['in']:.0%} | {res[0]['in']:.0%} | {res[1]['in']:.0%} "
                     f"| {st['flips']:.1f} | {res[0]['flips']:.1f} | {res[1]['flips']:.1f} "
                     f"| {cy[0]:.2f} | {cy[1]:.2f} | {cy[2]:.2f} |")
        print(lines[-1], flush=True)
    m = lambda f: sum(f(r) for r in rows) / len(rows)  # noqa: E731
    lines.append(f"| **mean** | | | {m(lambda r: r[0]['in']):.0%} | {m(lambda r: r[1][0]['in']):.0%} "
                 f"| {m(lambda r: r[1][1]['in']):.0%} | {m(lambda r: r[0]['flips']):.1f} "
                 f"| {m(lambda r: r[1][0]['flips']):.1f} | {m(lambda r: r[1][1]['flips']):.1f} | | | |")
    with open(os.path.join(OUT, f"lazy3-summary-{aspect}{suffix}.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print(lines[-1])


def render(name, aspect, suffix=""):
    import cv2
    meta, truth, n, cur, asp = load(name, aspect)
    engines = [e for e in l2.ENGINES if ONLY is None or e[0] == ONLY]
    cams = [("Hoje (Modo Foco)", today_rects(name, aspect))] + [
        ("1 toque - zona 0.20" if ONLY else label, rects_for(name, tag, meta, truth, n, cur)) for tag, label in engines]
    cap = cv2.VideoCapture(os.path.join(ev.ROOT, meta["video"]))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"])
    portrait = asp == "portrait"
    pw, ph = (540, 960) if portrait else (960, 540)
    size = (pw * len(cams), ph) if portrait else (pw, ph * len(cams))
    tmp = f"/tmp/{name}.lazy3.tmp.mp4"
    out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
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
            crop = cv2.resize(fr[y0:y0 + max(2, int(round(h * H))), x0:x0 + max(2, int(round(w * W)))], (pw, ph))
            for col, th in (((0, 0, 0), 4), ((255, 255, 255), 2)):
                cv2.putText(crop, label, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, col, th, cv2.LINE_AA)
            panels.append(crop)
        out.write(np.hstack(panels) if portrait else np.vstack(panels))
        k += 1
    out.release()
    cap.release()
    dst = os.path.join(OUT, f"{name}.lazy3{suffix}.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", dst], check=True)
    os.remove(tmp)
    print(dst, k, "frames", asp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", default=None)
    ap.add_argument("--aspect", default="native")
    ap.add_argument("--zoom", type=float, default=None)
    ap.add_argument("--suffix", default="")
    ap.add_argument("--only", default=None)
    a = ap.parse_args()
    global ZOOM, ONLY
    ZOOM, ONLY = a.zoom, a.only
    os.makedirs(OUT, exist_ok=True)
    render(a.render, a.aspect, a.suffix) if a.render else summary(a.aspect, a.suffix)


if __name__ == "__main__":
    main()
