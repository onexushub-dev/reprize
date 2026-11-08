#!/usr/bin/env python3
"""Modo Foco lab, test 22: a calm 9:16 camera from the ball, offline: dead zone + smoothest path.

Victor on test 21's videos: the camera looked uncontrolled and abrupt. Here the camera does NOT chase the ball: it stays
still while the ball is inside a central band of the crop and moves only as much as needed to keep it there, along the
smoothest path that does so (offline, the whole clip known in advance):

    minimise   sum_i w_i * dist(c_i, [t_i - d, t_i + d])^2  +  a * sum (c_i - c_{i-1})^2  +  b * sum (c_{i+1} - 2c_i + c_{i-1})^2

c = crop centre, t = target (sg_framing.target_x: trusted ball, 1 s gaps bridged, longer gaps hold / players),
d = dead zone half-width (--dz, share of the crop width), w = 1 on a ball, --wfb on fallback frames.
Solved by active-set iterations (the band term is quadratic only where c is outside it). Then clamped to the frame.

    python3 tools/lab/sg_lazy.py [--engines det-yolox-s-t5,mix-det-fuse5] [--dz 0.15,0.25] [--a 1,10] [--b 100,1000,10000]
    python3 tools/lab/sg_lazy.py --render <clip> --pick det-yolox-s-t5:0.25:10:1000,mix-det-fuse5:0.25:10:1000
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

OUT = os.path.join(sg.TESTS, "sg")


def lazy_path(t, w, d, a, b, iters=30):
    n = len(t)
    D1 = np.diff(np.eye(n), 1, axis=0)
    D2 = np.diff(np.eye(n), 2, axis=0)
    R = a * D1.T @ D1 + b * D2.T @ D2 + 1e-6 * np.eye(n)
    c = t.copy()
    for _ in range(iters):
        lo, hi = t - d, t + d
        out = (c < lo) | (c > hi)
        y = np.clip(c, lo, hi)
        Wd = np.diag(np.where(out, w, 0.0))
        c_new = np.linalg.solve(Wd + R, Wd @ y + 1e-6 * c)
        if np.max(np.abs(c_new - c)) < 1e-5:
            c = c_new
            break
        c = c_new
    return c


def clip_inputs(name, tag, fallback):
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
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{tag}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    balls = [None if p is None else p[0] for p in tr]
    tx = sg.target_x(balls, today, 10, fallback)
    isball = np.array([p is not None for p in balls])
    return meta, truth, n, cw, today, tx, isball


def camera(tx, isball, cw, dz, a, b, wfb):
    w = np.where(isball, 1.0, wfb)
    c = lazy_path(tx, w, dz * cw, a, b)
    return np.clip(c, cw / 2, 1 - cw / 2)


def sweep(a_):
    rows = []
    for name in sg.CLIPS:
        for tag in a_.engines.split(","):
            meta, truth, n, cw, today, tx, isball = clip_inputs(name, tag, a_.fallback)
            for dz in [float(x) for x in a_.dz.split(",")]:
                for aa in [float(x) for x in a_.a.split(",")]:
                    for bb in [float(x) for x in a_.b.split(",")]:
                        c = camera(tx, isball, cw, dz, aa, bb, a_.wfb)
                        rows.append({"clip": name, "engine": tag, "dz": dz, "a": aa, "b": bb,
                                     **sg.score(c, cw, truth, n)})
        print(name, flush=True)
    with open(os.path.join(OUT, "lazy-scores.json"), "w") as f:
        json.dump(rows, f)
    keys = sorted({(r["engine"], r["dz"], r["a"], r["b"]) for r in rows})
    lines = [f"# Test 22 — dead zone + smoothest path (fallback {a_.fallback}, fallback weight {a_.wfb})", "",
             "Means over the 11 horizontal labelled clips. Today's portrait Modo Foco: 61% / 0.06 / 2.3.", "",
             "| Engine | Dead zone | a | b | Ball in crop | Speed p95 (widths/s) | Direction changes /10 s |",
             "|---|---|---|---|---|---|---|"]
    for k in keys:
        rs = [r for r in rows if (r["engine"], r["dz"], r["a"], r["b"]) == k]
        m = lambda f: sum(r[f] for r in rs) / len(rs)  # noqa: E731
        lines.append(f"| {k[0]} | {k[1]:.2f} | {k[2]:g} | {k[3]:g} | {m('in'):.0%} | {m('speed'):.2f} | {m('flips'):.1f} |")
    with open(os.path.join(OUT, "lazy-summary.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def render(a_):
    import cv2
    name = a_.render
    cams = []
    for i, spec in enumerate(a_.pick.split(",")):
        tag, dz, aa, bb = spec.split(":")
        meta, truth, n, cw, today, tx, isball = clip_inputs(name, tag, a_.fallback)
        if i == 0:
            cams.append(("Hoje (Modo Foco)", today))
        short = {"det-yolox-s-t5": "Sem toque", "mix-det-fuse5": "1 toque"}.get(tag, tag)
        cams.append((f"{short} - zona {float(dz):.2f}", camera(tx, isball, cw, float(dz), float(aa), float(bb), a_.wfb)))
    video = os.path.join(ev.ROOT, meta["video"])
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"])
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    pw, ph = 540, 960
    tmp = f"/tmp/{name}.lazy.tmp.mp4"
    out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, (pw * len(cams), ph))
    grid = np.arange(n) * 0.1
    k = 0
    while k / fps <= grid[-1]:
        ok, fr = cap.read()
        if not ok:
            break
        panels = []
        for label, cx in cams:
            c = float(np.interp(k / fps, grid, cx))
            x0 = int(round(min(max(c - cw / 2, 0), 1 - cw) * W))
            crop = cv2.resize(fr[:, x0:x0 + int(round(cw * W))], (pw, ph))
            for col, th in (((0, 0, 0), 4), ((255, 255, 255), 2)):
                cv2.putText(crop, label, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, col, th, cv2.LINE_AA)
            panels.append(crop)
        out.write(np.hstack(panels))
        k += 1
    out.release()
    cap.release()
    dst = os.path.join(OUT, f"{name}.lazy.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", dst], check=True)
    os.remove(tmp)
    print(dst)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engines", default="det-yolox-s-t5,mix-det-fuse5")
    ap.add_argument("--fallback", default="hold")
    ap.add_argument("--wfb", type=float, default=0.2)
    ap.add_argument("--dz", default="0.10,0.20,0.30")
    ap.add_argument("--a", default="1,10")
    ap.add_argument("--b", default="100,1000,10000")
    ap.add_argument("--render", default=None)
    ap.add_argument("--pick", default="det-yolox-s-t5:0.20:10:1000,mix-det-fuse5:0.20:10:1000")
    a_ = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    render(a_) if a_.render else sweep(a_)


if __name__ == "__main__":
    main()
