#!/usr/bin/env python3
"""Modo Foco lab, test 35 (2026-11-08): where does the ball get lost between "a candidate is on the ball" (the detector
ceiling) and "the track is on the ball" (cover)? Per labelled point on an analysed frame where some candidate is on the
ball, the first stage that loses it:

  shape    the ball's candidate(s) dropped by ball_track's shape filter (too big / too long)
  still    dropped by the still-object filter
  wrong    the path is on another candidate (score of the ball's candidate vs the chosen one is reported)
  none     the path has no ball on that frame although the ball's candidate survived the filters
  trusted  the path is on the ball but hybrid.trusted drops the point
  mode     on the ball and trusted, but outside the ball-mode segments
  hit      counted in cover

    python3 tools/lab/path_diag.py --det bhn-n5 --track det-bhn-n5 [clip ...]
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_track as bt  # noqa: E402
import evaluate as ev  # noqa: E402
import hybrid as hb  # noqa: E402

CLIPS7 = ["basket-rp-1105-v-a", "basket-rp-1105-v-b", "basket-rp-1105-h", "basket-v-01", "yt-basket-04",
          "yt1105-basket-a", "yt1105-basket-b"]


def stages(det, P):
    """ball_track's filters, kept per stage: {k: (all, shaped, moving)}."""
    W, H = det["size"]
    L = max(W, H)
    frames = det["frames"]
    an = [k for k in range(len(frames)) if frames[k] is not None]
    shaped = {}
    for k in an:
        cs = []
        for cx, cy, w, h, s in frames[k]:
            wp, hp = w * W, h * H
            if s < P["conf"] or max(wp, hp) > P["box_max"] * L or max(wp, hp) / max(1e-6, min(wp, hp)) > P["aspect_max"]:
                continue
            cs.append((cx, cy, w, h, s))
        shaped[k] = cs

    def d(a, b):
        return math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H) / L
    moving = {}
    for k in an:
        near = [q for q in an if q != k and abs(q - k) <= P["still_win"]]
        keep = []
        for c in shaped[k]:
            hits = sum(1 for q in near if any(d(c, o) <= P["still_r"] for o in shaped[q]))
            if near and hits >= P["still_share"] * len(near):
                continue
            keep.append(c)
        moving[k] = keep
    return an, shaped, moving


def diag(name, det_tag, track_tag):
    det = json.load(open(os.path.join(bt.DET, f"{name}.{det_tag}.json")))
    tr = json.load(open(os.path.join(bt.ONECLICK, f"{name}.ball.{track_tag}.json")))
    P = dict(bt.P)
    P.update({k: v for k, v in tr.get("params", {}).items() if k in P})
    truth = ev.load_truth(name)
    size = truth["size"]
    R = ev.radius_px(size)
    meta = ev.clip_meta(name)
    n = meta["count"]
    an, shaped, moving = stages(det, P)
    pred = tr["pred_one"]
    t2 = hb.trusted(pred, n, size, meta["sport"])
    mode = [False] * n
    for a, b in hb.ball_mode(t2, size):
        for k in range(a, b + 1):
            mode[k] = True
    on = lambda c, g: ev._dist_px(c[:2], g, size) <= R  # noqa: E731
    out = collections.Counter()
    notes = []
    for ms, g in truth["samples"].items():
        k = ms // 100
        if not isinstance(g, tuple) or k >= len(det["frames"]) or det["frames"][k] is None:
            continue
        out["pts"] += 1
        if not any(on(c, g) for c in det["frames"][k]):
            out["blind"] += 1
            continue
        p = pred.get(str(k))
        if p is not None and on(p, g):
            if t2[k] is None:
                out["trusted"] += 1
            elif not mode[k]:
                out["mode"] += 1
            else:
                out["hit"] += 1
            continue
        if not any(on(c, g) for c in shaped.get(k, [])):
            out["shape"] += 1
        elif not any(on(c, g) for c in moving.get(k, [])):
            out["still"] += 1
        elif p is None:
            out["none"] += 1
            bs = max(c[4] for c in moving[k] if on(c, g))
            notes.append(f"{k / 10:.1f}s none (ball cand {bs:.2f})")
        else:
            out["wrong"] += 1
            bs = max(c[4] for c in moving[k] if on(c, g))
            notes.append(f"{k / 10:.1f}s wrong (ball cand {bs:.2f}, chosen {p[8] if len(p) > 8 else 0:.2f})")
    return out, notes


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", required=True)
    ap.add_argument("--track", required=True)
    ap.add_argument("-v", action="store_true")
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    keys = ["blind", "shape", "still", "wrong", "none", "trusted", "mode", "hit"]
    tot = collections.Counter()
    print("| clip | pts | " + " | ".join(keys) + " |")
    print("|---|---|" + "---|" * len(keys))
    for c in a.clips or CLIPS7:
        o, notes = diag(c, a.det, a.track)
        tot.update(o)
        print(f"| {c} | {o['pts']} | " + " | ".join(f"{100 * o[k] / o['pts']:.0f}%" for k in keys) + " |")
        if a.v:
            print("   ", "; ".join(notes))
    print(f"| all | {tot['pts']} | " + " | ".join(f"{100 * tot[k] / tot['pts']:.0f}%" for k in keys) + " |")


if __name__ == "__main__":
    main()
