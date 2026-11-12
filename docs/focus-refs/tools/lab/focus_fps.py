#!/usr/bin/env python3
"""4K test plan, candidate 4 (2026-11-12): Jogadores (Modo Foco) analysed at 5 fps instead of 10, simulated from the
phone's own analysis. The phone's Jogadores file keeps the person boxes it found every 100 ms ("people"); dropping
every other row is what a 5 fps analysis would have seen. The framing is recomputed with focus_variant.py (the line-by-
line port of the app's FocusPath; checked identical to the phone's file first) on the app's 100 ms grid, which holds
the last people seen between analysed frames (FocusGrid.samples), exactly as the app would.

Per clip: the parity check (10 fps recomputed vs the phone), and 5 fps vs 10 fps: crop centre shift and size change
(share of the frame), and smoothness (mean |second difference| of the centre, x1000: higher = jerkier).
Writes lab/tests/focusfps/<clip>.p5.focus.json and lab/tests/focusfps/report.md.

    python3 tools/lab/focus_fps.py [clip ...]     # default: every clip with renders/<clip>.people.json + its focus file
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import evaluate as ev  # noqa: E402
import focus_variant as fv  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "focusfps")
TUNING = dict(fv.STANDARD, activity=1.0, activeSpread=1.0, zoomIn=1.1)  # --preset acao (FocusTuning.action, v15)


def framing(samples_people, app, keep):
    W, H = app["size"]
    start, step = app["startMs"], app["stepMs"]
    rows = len(app["landscape"]) or len(app["portrait"])
    end = start + rows * step
    frames = [(s["t"], [tuple(b[:4]) for b in s["tiled"]]) for k, s in enumerate(samples_people) if keep(k)]
    frames = [f for f in frames if start - 0.5 <= f[0] < end]
    grid = fv.grid(frames, start, end, step)
    aspect = "landscape" if W >= H else "portrait"
    r = fv.compute(grid, W, H, aspect, True, TUNING)
    framing.last = {"grid": grid, "other": fv.compute(grid, W, H, "portrait" if aspect == "landscape" else "landscape",
                                                       False, TUNING) if r else None}
    return aspect, (np.array(r) if r else None)


def smooth(r):
    c = r[:, 0] + r[:, 2] / 2
    return float(np.mean(np.abs(np.diff(c, 2)))) * 1000 if len(c) > 2 else 0.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    names = a.clips or sorted(os.path.basename(p)[:-len(".people.json")]
                              for p in glob.glob(os.path.join(ev.ROOT, "renders", "*-1111-*.people.json")))
    os.makedirs(OUT, exist_ok=True)
    lines = ["| clip | parity 10 fps vs phone (max) | centre shift mean / max | size change mean / max | "
             "smoothness 10 → 5 fps |", "|---|---|---|---|---|"]
    agg = []
    for n in names:
        fp = os.path.join(ev.ROOT, "lab", "tests", "framing", f"{n}.current.focus.json")
        pp = os.path.join(ev.ROOT, "renders", f"{n}.people.json")
        if not (os.path.exists(fp) and os.path.exists(pp)):
            continue
        app = json.load(open(fp))
        samples = json.load(open(pp))["samples"]
        aspect, r10 = framing(samples, app, lambda k: True)
        _, r5 = framing(samples, app, lambda k: k % 2 == 0)
        if r10 is None or r5 is None:
            lines.append(f"| {n} | no framing (too few people) | | | |")
            continue
        # the 5 fps grid can end a row early (its last analysed frame is up to 200 ms before the end): the last framing
        # is held, as an app reading every other frame would have to
        if len(r5) < len(r10):
            r5 = np.vstack([r5, np.repeat(r5[-1:], len(r10) - len(r5), axis=0)])
        r5 = r5[:len(r10)]
        ref = np.array(app[aspect])
        m = min(len(ref), len(r10))
        parity = float(np.max(np.abs(ref[:m] - r10[:m])))
        dc = np.abs((r5[:, 0] + r5[:, 2] / 2) - (r10[:, 0] + r10[:, 2] / 2))
        dy = np.abs((r5[:, 1] + r5[:, 3] / 2) - (r10[:, 1] + r10[:, 3] / 2))
        shift = np.maximum(dc, dy)
        size = np.abs(r5[:, 2] - r10[:, 2]) / r10[:, 2]
        s10, s5 = smooth(r10), smooth(r5)
        agg.append((shift.mean(), shift.max(), size.mean(), size.max(), s10, s5))
        other = "portrait" if aspect == "landscape" else "landscape"
        o5 = list(framing.last["other"] or [])
        o5 = (o5 + [o5[-1]] * (len(r10) - len(o5)))[:len(r10)] if o5 else []
        # the people rows a 5 fps analysis would keep (the boxes last seen, per 100 ms row): Bola reads them
        g5 = [p for _, p in framing.last["grid"]]
        g5 = (g5 + [g5[-1]] * (len(r10) - len(g5)))[:len(r10)] if g5 else []
        json.dump({"v": 1, "stepMs": app["stepMs"], "startMs": app["startMs"], "size": app["size"],
                   aspect: [[fv.r4(v) for v in row] for row in r5], other: [[fv.r4(v) for v in row] for row in o5],
                   "people": [[list(b) for b in row] for row in g5], "playersHeight": app.get("playersHeight"),
                   "note": "5 fps simulation (focus_fps.py)"},
                  open(os.path.join(OUT, f"{n}.p5.focus.json"), "w"))
        lines.append(f"| {n} | {parity:.4f} | {shift.mean():.1%} / {shift.max():.1%} | {size.mean():.1%} / "
                     f"{size.max():.1%} | {s10:.2f} → {s5:.2f} |")
    if agg:
        g = np.array(agg)
        lines += ["", f"{len(agg)} clips: centre shift mean {g[:, 0].mean():.1%} (worst clip max {g[:, 1].max():.1%}), "
                      f"size change mean {g[:, 2].mean():.1%} (worst {g[:, 3].max():.1%}), smoothness "
                      f"{g[:, 4].mean():.2f} → {g[:, 5].mean():.2f}. Shifts are shares of the frame (1% of a 4K width "
                      "= 38 px)."]
    text = "\n".join(lines) + "\n"
    open(os.path.join(OUT, "report.md"), "w").write(text)
    print(text)


if __name__ == "__main__":
    main()
