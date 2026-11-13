#!/usr/bin/env python3
"""Stage 2 follow-up (2026-11-12), lab item 1: is Jogadores framed over the CUT as good as over the whole clip?
Gate G4 (focus_cut.py) only said "different"; this measures better or worse inside the cut, on the ball-labelled
clips that have stored people (renders/<clip>.people.json, the Mac's Vision run with the app's tiles):

- ball in crop: labelled ball points inside the crop (the action is in the picture),
- people in crop: share of the people boxes' centres inside the crop,
- pan p95 (frame sizes / s) and turns / 10 s: FramingMotion's numbers (the Diagnóstico's),

for the native-orientation Modo Foco crop and, on horizontal clips, the 9:16 crop (story / reels). Framing by
focus_variant.py (the port of the app's FocusPath, tuning v15, 5 fps). The cut is the middle half of the clip.

    python3 tools/lab/focus_quality.py [--margins 0,1000,2000] [clip ...]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import evaluate as ev  # noqa: E402
import focus_variant as fv  # noqa: E402

TUNING = dict(fv.STANDARD, activity=1.0, activeSpread=1.0, zoomIn=1.1)  # FocusTuning.action, v15
STEP = 100


def framing(samples, W, H, start, end, aspect, every=2):
    frames = [(s["t"], [tuple(b[:4]) for b in s["tiled"]]) for s in samples]
    frames = [f for f in frames if start - 0.5 <= f[0] < end][::every]
    if not frames:
        return None
    grid = fv.grid(frames, start, end, STEP)
    r = fv.compute(grid, W, H, aspect, True, TUNING)
    return np.array(r) if r else None


def motion(rects):
    """FramingMotion.stats, in Python."""
    if rects is None or len(rects) < 2:
        return 0.0, 0.0
    speeds = np.zeros(len(rects) - 1)
    flips = 0
    for axis in range(2):
        if rects[:, 2 + axis].min() >= 0.999:
            continue
        c = rects[:, axis] + rects[:, 2 + axis] / 2
        speeds = np.maximum(speeds, np.abs(np.diff(c)) / (STEP / 1000))
        last, ref = 0.0, c[0]
        for p in c[1:]:
            d = p - ref
            if abs(d) >= 0.02:
                s = 1.0 if d > 0 else -1.0
                if last != 0 and s != last:
                    flips += 1
                last, ref = s, p
            elif last != 0 and d * last > 0:
                ref = p
    return float(np.percentile(speeds, 95)), flips * 10000 / (len(rects) * STEP)


def inside(r, x, y, pad=0.0):
    return r[0] - pad <= x <= r[0] + r[2] + pad and r[1] - pad <= y <= r[1] + r[3] + pad


def score(rects, r0, c0, c1, truth, samples):
    """Rows of `rects` start at r0 (ms); scores the cut [c0, c1)."""
    if rects is None:
        return None
    rows = {int(round(r0 + i * STEP)): rects[i] for i in range(len(rects))}
    keys = [k for k in sorted(rows) if c0 <= k < c1]
    if not keys:
        return None
    sub = np.array([rows[k] for k in keys])
    ball_in = ball_n = 0
    for t, p in truth["samples"].items():
        if not isinstance(p, tuple) or not (c0 <= t < c1):
            continue
        k = int(round((t - r0) / STEP)) * STEP + int(r0)
        k = min(rows, key=lambda q: abs(q - t)) if k not in rows else k
        ball_n += 1
        ball_in += inside(rows[k], p[0], p[1], 0.01)
    ppl_in = ppl_n = 0
    for s in samples:
        t = s["t"]
        if not (c0 <= t < c1):
            continue
        k = min(rows, key=lambda q: abs(q - t))
        for b in s["tiled"]:
            ppl_n += 1
            ppl_in += inside(rows[k], b[0] + b[2] / 2, b[1] + b[3] / 2)
    pan, turns = motion(sub)
    return dict(ball_in=ball_in, ball_n=ball_n, ppl_in=ppl_in, ppl_n=ppl_n, pan=pan, turns=turns, rows=len(sub))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--margins", default="0,1000,2000")
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    margins = [int(m) for m in a.margins.split(",")]
    names = a.clips or [c for c in ev.labelled_clips("ball")
                        if os.path.exists(os.path.join(ev.ROOT, "renders", f"{c}.people.json"))]
    per = {}  # (aspect, variant) -> list of scores
    lines = []
    for n in names:
        meta = ev.clip_meta(n)
        W, H = meta["size"]
        samples = json.load(open(os.path.join(ev.ROOT, "renders", f"{n}.people.json")))["samples"]
        if not samples or "tiled" not in samples[0]:
            continue
        truth = ev.load_truth(n)
        end = max(s["t"] for s in samples) + STEP
        start = 0
        if end - start < 6000:
            continue
        c0 = int(round((start + (end - start) * 0.25) / STEP)) * STEP
        c1 = int(round((start + (end - start) * 0.75) / STEP)) * STEP
        aspects = ["landscape", "portrait"] if W >= H else ["portrait"]
        for asp in aspects:
            native = (asp == "landscape") == (W >= H)
            tag = "native" if native else "9:16"
            res = {"whole": score(framing(samples, W, H, start, end, asp), start, c0, c1, truth, samples)}
            for m in margins:
                m0, m1 = max(start, c0 - m), min(end, c1 + m)
                res[f"cut+{m // 1000}s"] = score(framing(samples, W, H, m0, m1, asp), m0, c0, c1, truth, samples)
            for k, v in res.items():
                if v is not None:
                    per.setdefault((tag, k), []).append((n, v))
            w = res["whole"]
            if w and w["ball_n"]:
                cells = []
                for k in res:
                    v = res[k]
                    cells.append("—" if v is None or not v["ball_n"] else
                                 f"{100 * v['ball_in'] / v['ball_n']:.0f}% / {v['pan']:.2f} / {v['turns']:.1f}")
                lines.append(f"| {n} | {tag} | {w['ball_n']} | " + " | ".join(cells) + " |")
    variants = ["whole"] + [f"cut+{m // 1000}s" for m in margins]
    out = ["Lab item 1 (2026-11-12): Jogadores framed over the whole clip vs over the cut (+ margin). Cut = the clip's "
           "middle half. Scores inside the cut.", ""]
    for tag in ("native", "9:16"):
        out += [f"**{tag}**", "", "| variant | clips | ball in crop | people in crop | pan p95 (mean) | turns/10 s (mean) | "
                "clips with ball in crop −5 pts or more vs whole |", "|---|---|---|---|---|---|---|"]
        base = {n: v for n, v in per.get((tag, "whole"), [])}
        for k in variants:
            rows = per.get((tag, k), [])
            if not rows:
                continue
            bi = sum(v["ball_in"] for _, v in rows) / max(1, sum(v["ball_n"] for _, v in rows))
            pi = sum(v["ppl_in"] for _, v in rows) / max(1, sum(v["ppl_n"] for _, v in rows))
            worse = sum(1 for n, v in rows if n in base and base[n]["ball_n"] and v["ball_n"]
                        and v["ball_in"] / v["ball_n"] < base[n]["ball_in"] / base[n]["ball_n"] - 0.05)
            out.append(f"| {k} | {len(rows)} | {100 * bi:.1f}% | {100 * pi:.1f}% | {np.mean([v['pan'] for _, v in rows]):.3f} | "
                       f"{np.mean([v['turns'] for _, v in rows]):.2f} | {worse} |")
        out.append("")
    out += ["Per clip: ball in crop / pan p95 / turns per 10 s", "",
            "| clip | crop | ball pts | " + " | ".join(variants) + " |", "|---|---|---|" + "---|" * len(variants)] + lines
    path = os.path.join(ev.ROOT, "lab", "tests", "focusfps", "focus-quality.md")
    open(path, "w").write("\n".join(out) + "\n")
    print("\n".join(out[:20]))
    print("report:", path)


if __name__ == "__main__":
    main()
