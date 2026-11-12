#!/usr/bin/env python3
"""Analysis plan 2026-11-12, I1, gate G4: Jogadores analysed over the CUT plus a margin instead of the whole clip.
Is the framing inside the cut the same? Simulated from stored people (renders/<clip>.people.json, the Mac's Vision run
with the app's tiles) and the clip's own framing file, with focus_variant.py (the port of the app's FocusPath), at
5 fps as the app analyses today. The cut is the middle third of the analysed range (a 30 s clip cut to 10 s).

Per clip: centre shift and size change inside the cut (share of the frame), whole range vs cut + margin.

    python3 tools/lab/focus_cut.py [--margin 2000] [clip ...]
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

TUNING = dict(fv.STANDARD, activity=1.0, activeSpread=1.0, zoomIn=1.1)  # FocusTuning.action, v15


def framing(samples, W, H, start, end, step, every=2):
    """Rows from `start` (the app's file: row k at start + k x step), people from the frames a 5 fps run would use."""
    frames = [(s["t"], [tuple(b[:4]) for b in s["tiled"]]) for s in samples]
    frames = [f for f in frames if start - 0.5 <= f[0] < end]
    frames = frames[::every]
    grid = fv.grid(frames, start, end, step)
    aspect = "landscape" if W >= H else "portrait"
    r = fv.compute(grid, W, H, aspect, True, TUNING)
    return np.array(r) if r else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--margin", type=float, default=2000)
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    names = a.clips or sorted(os.path.basename(p)[:-len(".people.json")]
                              for p in glob.glob(os.path.join(ev.ROOT, "renders", "*.people.json")))
    rows, agg, skipped = [], [], 0
    for n in names:
        fp = os.path.join(ev.ROOT, "lab", "tests", "framing", f"{n}.current.focus.json")
        pp = os.path.join(ev.ROOT, "renders", f"{n}.people.json")
        if not (os.path.exists(fp) and os.path.exists(pp)):
            skipped += 1
            continue
        app = json.load(open(fp))
        samples = json.load(open(pp))["samples"]
        if not samples or "tiled" not in samples[0]:
            skipped += 1
            continue
        W, H = app["size"]
        start, step = app["startMs"], app["stepMs"]
        nrows = len(app.get("landscape") or []) or len(app.get("portrait") or [])
        end = start + nrows * step
        if end - start < 9000:
            skipped += 1
            continue
        third = round((end - start) / 3 / step) * step
        c0, c1 = start + third, end - third
        full = framing(samples, W, H, start, end, step)
        m0, m1 = max(start, c0 - a.margin), min(end, c1 + a.margin)
        part = framing(samples, W, H, m0, m1, step)
        if full is None or part is None:
            rows.append(f"| {n} | no framing in {'both' if full is None and part is None else 'one'} | | |")
            if (full is None) != (part is None):
                agg.append((1.0, 1.0, 1.0, 1.0))
            continue
        fi = full[int(round((c0 - start) / step)):int(round((c1 - start) / step))]
        pi = part[int(round((c0 - m0) / step)):int(round((c0 - m0) / step)) + len(fi)]
        k = min(len(fi), len(pi))
        fi, pi = fi[:k], pi[:k]
        dc = np.maximum(np.abs((fi[:, 0] + fi[:, 2] / 2) - (pi[:, 0] + pi[:, 2] / 2)),
                        np.abs((fi[:, 1] + fi[:, 3] / 2) - (pi[:, 1] + pi[:, 3] / 2)))
        ds = np.abs(pi[:, 2] - fi[:, 2]) / fi[:, 2]
        agg.append((dc.mean(), dc.max(), ds.mean(), ds.max()))
        rows.append(f"| {n} | {(end - start) / 1000:.0f} s → {(c1 - c0) / 1000:.0f} s | {dc.mean():.1%} / {dc.max():.1%} | "
                    f"{ds.mean():.1%} / {ds.max():.1%} |")
    g = np.array(agg) if agg else np.zeros((0, 4))
    head = [f"Margin {a.margin / 1000:.1f} s. {len(agg)} clips ({skipped} skipped: no people file, no framing file or "
            "under 9 s).",
            f"Centre shift: mean {g[:, 0].mean():.2%}, median of the clips' max {np.median(g[:, 1]):.1%}, worst "
            f"{g[:, 1].max():.1%}; clips with max over 2%: {int((g[:, 1] > 0.02).sum())}, over 5%: "
            f"{int((g[:, 1] > 0.05).sum())}.",
            f"Size change: mean {g[:, 2].mean():.2%}, worst {g[:, 3].max():.1%}; clips with max over 5%: "
            f"{int((g[:, 3] > 0.05).sum())}.", "",
            "| clip | range → cut | centre shift mean / max | size change mean / max |", "|---|---|---|---|"]
    text = "\n".join(head + rows) + "\n"
    out = os.path.join(ev.ROOT, "lab", "tests", "focusfps", f"cut-m{int(a.margin)}.md")
    open(out, "w").write(text)
    print("\n".join(head[:3]))
    print("report:", out)


if __name__ == "__main__":
    main()
