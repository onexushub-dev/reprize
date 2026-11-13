#!/usr/bin/env python3
"""Motion-gated tiles (tests 53 / 54): the fixture that keeps the app's port (ReplayCore `BallMotion`) equal to
motion_tiles.py. Small synthetic thumbnails (noise, two moving blobs, one that appears and stays) go through the same
functions as the lab run; the tiles that would run on each analysed frame are written with them.

    python3 tools/lab/motion_parity.py            # writes the fixture
    python3 tools/lab/motion_parity.py --check    # compares with the one in the app
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import motion_tiles as mt  # noqa: E402

OUT = os.path.join(HERE, "..", "..", "..", "..", "app", "modules", "replay-camera", "ios", "Core", "Tests",
                   "ReplayCoreTests", "Fixtures", "ball-motion.json")
W, H, T = 1920, 1080, 416
TW, TH = 96, 54
THR, MIN_PX = 20.0, 2


def thumbs(n=12, seed=7):
    rng = np.random.default_rng(seed)
    base = rng.integers(60, 120, size=(TH, TW))
    out = []
    for k in range(n):
        f = base + rng.integers(-6, 7, size=(TH, TW))  # sensor noise, under the threshold
        x, y = 8 + 6 * k, 10 + 2 * k                    # a ball crossing the picture
        f[y:y + 3, x:x + 3] = 250
        x2 = 80 - 3 * k                                 # a slower one, the other way, lower down
        f[40:43, x2:x2 + 2] = 5
        if k >= 5:
            f[25:29, 50:54] = 240                       # something that appears and stays (changes once)
        out.append(np.clip(f, 0, 255))
    return np.array(out).astype(np.int16)


def active(F, mode="and", hold=1, step=1):
    TL = mt.tiles(W, H, T)
    sx, sy = TW / W, TH / H
    rects = [(int(x * sx), int(y * sy), int(np.ceil(min(x + T, W) * sx)), int(np.ceil(min(y + T, H) * sy)))
             for x, y in TL]
    n = len(F)
    rows, prev = [], set()
    for k in range(n):
        a = mt.box3(np.abs(F[k] - F[max(k - step, 0)])) > THR
        b = mt.box3(np.abs(F[k] - F[min(k + step, n - 1)])) > THR
        m = b if k - step < 0 else a if k + step > n - 1 else (a & b) if mode == "and" else (a | b)
        now = {i for i, (x0, y0, x1, y1) in enumerate(rects) if int(m[y0:y1, x0:x1].sum()) >= MIN_PX}
        rows.append({"changed": int(m.sum()), "now": sorted(now), "run": sorted(now | prev if hold else now)})
        prev = now
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    F = thumbs()
    fixture = {"frame": [W, H], "tile": T, "thumb": [TW, TH], "threshold": THR, "minPixels": MIN_PX,
               "thumbs": [f.flatten().tolist() for f in F], "rows": active(F)}
    text = json.dumps(fixture, separators=(",", ":"))
    if a.check:
        same = os.path.exists(OUT) and open(OUT).read() == text
        print("fixture matches" if same else "FIXTURE DIFFERS")
        sys.exit(0 if same else 1)
    open(OUT, "w").write(text)
    print("wrote", os.path.normpath(OUT), len(text), "bytes;", "tiles run per frame:", [len(r["run"]) for r in fixture["rows"]])


if __name__ == "__main__":
    main()
