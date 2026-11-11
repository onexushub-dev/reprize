#!/usr/bin/env python3
"""Modo Foco lab, test 50 (2026-11-10): where Seguir a Bola (basketball) loses a fast pass. Per 100 ms frame of a clip:
the detector's best candidates (analysed frames), the ball path (`ball_track.track`, basketball's numbers), the trusted
points (`hybrid.trusted`), and the app's measured camera (`app_camera.py`), side by side.

    python3 tools/lab/pass_diag.py basket-app-1110-a [--tag bgymall-n5]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_track as bt  # noqa: E402
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402


def path_and_trusted(name, tag, overrides=None):
    det = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "detect", f"{name}.{tag}.json")))
    meta = ev.clip_meta(name)
    P = dict(bt.P)
    P.update(bt.SPORT_P.get(meta["sport"], {}))
    P.update(dict(person_ratio=0.0))  # the path before test 50 unless asked
    P.update(overrides or {})
    saved = dict(bt.P)
    bt.P.clear()
    bt.P.update(P)
    try:
        pred, _ = bt.track(det, bt.P)
    finally:
        bt.P.clear()
        bt.P.update(saved)
    n = meta["count"]
    tr = hybrid.trusted({str(k): v for k, v in pred.items()}, n, meta["size"], meta["sport"])
    return det, pred, tr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("clip")
    ap.add_argument("--tag", default="bgymall-n5")
    a = ap.parse_args()
    det, pred, tr = path_and_trusted(a.clip, a.tag)
    cam = None
    p = os.path.join(ev.ROOT, "lab", "tests", "story", f"{a.clip}.appcam.json")
    if os.path.exists(p):
        cam = json.load(open(p))["rects"]
    n = len(tr)
    print(" t    app cam [x0..x1]   path (x,y,score)      trusted     candidates >= 0.3 (x,y,s)")
    for k in range(n):
        fr = det["frames"][k] if k < len(det["frames"]) else None
        cands = "" if fr is None else " ".join(f"({c[0]:.2f},{c[1]:.2f},{c[4]:.2f})" for c in fr if c[4] >= 0.3)
        pp = pred.get(k)
        ps = f"({pp[0]:.3f},{pp[1]:.3f},{pp[8]:.2f})" if pp is not None else "        -          "
        ts = f"({tr[k][0]:.3f},{tr[k][1]:.3f})" if tr[k] is not None else "      -      "
        cs = "" if not cam or cam[k] is None else f"[{cam[k][0]:.3f}..{cam[k][0] + cam[k][2]:.3f}]"
        inside = ""
        if cam and cam[k] is not None and pp is not None:
            inside = " in " if cam[k][0] <= pp[0] <= cam[k][0] + cam[k][2] else " OUT"
        print(f"{k / 10:4.1f} {cs:18s} {ps} {ts}{inside} {'*' if fr is not None else ' '} {cands}")


if __name__ == "__main__":
    main()
