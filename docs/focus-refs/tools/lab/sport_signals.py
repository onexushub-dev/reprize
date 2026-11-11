#!/usr/bin/env python3
"""Modo Foco lab, test 51: signals per clip from sport_probe.py, by sport.

    python3 tools/lab/sport_signals.py            # table + per-sport ranges
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

DIR = os.path.join(ev.ROOT, "lab", "tests", "sport", "t51")
GROUP = {"basquete": "basquete", "beachTennis": "beachTennis"}


def main_people(frames, H, W):
    """Per frame: the persons (score >= 0.4) at least 0.6 of the clip's 80th-percentile height, in px."""
    hs = [p[3] * H for f in frames for p in f["person"] if p[4] >= 0.4]
    if not hs:
        return [[] for _ in frames], None
    hmin = 0.6 * float(np.percentile(hs, 80))
    rows = [[p for p in f["person"] if p[4] >= 0.4 and p[3] * H >= hmin] for f in frames]
    allh = [p[3] * H for r in rows for p in r]
    return rows, float(np.median(allh)) if allh else None


def signals(d):
    W, H = d["size"]
    fr = d["frames"]
    rows, ph = main_people(fr, H, W)
    s = {"name": d["name"], "sport": d["sport"], "web": bool(d.get("web")), "people": ph,
         "npeople": float(np.median([len(r) for r in rows])) if rows else 0}
    for m in ("gym", "btpl"):
        tops = [max([c[4] for c in f[m]] or [0]) for f in fr]
        s[f"{m}_top"] = float(np.median(tops))
        s[f"{m}_hits"] = sum(t >= 0.5 for t in tops)
        sizes = [max(c[2] * W, c[3] * H) for f in fr for c in f[m] if c[4] >= 0.5]
        s[f"{m}_px"] = float(np.median(sizes)) if sizes else None
        s[f"{m}_ratio"] = (s[f"{m}_px"] / ph) if (sizes and ph) else None
    s["racket"] = sum(1 for f in fr if any(c[4] >= 0.4 for c in f["racket"]))
    cb = [max(c[2] * W, c[3] * H) for f in fr for c in f["ball"] if c[4] >= 0.4]
    s["coco_ball_ratio"] = (float(np.median(cb)) / ph) if (cb and ph) else None
    return s


def main():
    rows = [signals(json.load(open(os.path.join(DIR, f)))) for f in sorted(os.listdir(DIR)) if f.endswith(".json")]
    keys = ["gym_top", "gym_hits", "gym_ratio", "btpl_top", "btpl_hits", "btpl_ratio", "racket", "coco_ball_ratio",
            "npeople"]
    print("clip".ljust(36), " ".join(k[:9].rjust(9) for k in keys))
    order = {"basquete": 0, "beachTennis": 1}
    for r in sorted(rows, key=lambda r: (order.get(r["sport"], 2), r["sport"], r["name"])):
        cells = []
        for k in keys:
            v = r[k]
            cells.append("-".rjust(9) if v is None else (f"{v:9.3f}" if isinstance(v, float) else f"{v:9d}"))
        print((r["sport"][:5] + (" w " if r["web"] else "   ") + r["name"])[:36].ljust(36), " ".join(cells))
    json.dump(rows, open(os.path.join(ev.ROOT, "lab", "tests", "sport", "t51-signals.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
