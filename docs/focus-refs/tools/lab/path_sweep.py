#!/usr/bin/env python3
"""Modo Foco lab, test 46 (2026-11-09): score ball_track.py parameter sets on a fold-honest set of clips in one pass.

For each parameter set (a "name:k=v,k=v" argument), every clip is tracked in memory with ball_track.track (SPORT_P of
the clip's sport first, then the set's values) and scored as ball_gate.signals does (hybrid.trusted + ball mode, the
labelled points): pooled precision (hits / points the track gives a ball, in ball mode) and cover (hits / points),
per group and over all clips, plus the worst clips.

    python3 tools/lab/path_sweep.py --group A:btplA-n5:bt-own-a-01..10 --group B:btplB-n5:bt-own-b-01..09 \
        base: still_share=0.5 "dp2:dp=2,acc_cost=1" "norack:t.racket=0"
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_track as bt  # noqa: E402
import evaluate as ev  # noqa: E402
import hybrid as hb  # noqa: E402


def expand(spec):
    """bt-own-a-01..10 -> bt-own-a-01 ... bt-own-a-10; comma lists allowed."""
    out = []
    for part in spec.split(","):
        m = re.match(r"^(.*?)(\d+)\.\.(\d+)$", part)
        if m:
            w = len(m.group(2))
            out += [f"{m.group(1)}{i:0{w}d}" for i in range(int(m.group(2)), int(m.group(3)) + 1)]
        elif part:
            out.append(part)
    return out


def score(name, pred, sport):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    n, size = meta["count"], truth["size"]
    t2 = hb.trusted({str(k): v for k, v in pred.items()}, n, size, sport)
    mode = np.zeros(n, bool)
    for a, b in hb.ball_mode(t2, size):
        mode[a:b + 1] = True
    R = ev.radius_px(size)
    pts = [(t // 100, v) for t, v in truth["samples"].items() if isinstance(v, tuple) and t // 100 < n]
    with_ball = [(k, v) for k, v in pts if mode[k] and t2[k] is not None]
    hits = sum(1 for k, v in with_ball if ev._dist_px(t2[k], v, size) <= R)
    return len(pts), len(with_ball), hits


def parse_set(s):
    """name:k=v,... ; a key t.<k> sets hybrid.T[k] (the trust rules) for this set."""
    name, _, kv = s.partition(":")
    vals, tvals = {}, {}
    for item in filter(None, kv.split(",")):
        k, _, v = item.partition("=")
        if k.startswith("t."):
            if k[2:] not in hb.T:
                raise SystemExit(f"unknown trust parameter {k[2:]}")
            tvals[k[2:]] = float(v)
        elif k not in bt.P:
            raise SystemExit(f"unknown parameter {k}")
        else:
            vals[k] = float(v)
    return name or kv, vals, tvals


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", action="append", required=True, help="label:det_tag:clips")
    ap.add_argument("--worst", type=int, default=4)
    ap.add_argument("--clips", action="store_true", help="print every clip's cover")
    ap.add_argument("sets", nargs="+")
    a = ap.parse_args()
    groups = []
    for g in a.group:
        label, det_tag, spec = g.split(":", 2)
        clips = expand(spec)
        dets = {c: json.load(open(os.path.join(bt.DET, f"{c}.{det_tag}.json"))) for c in clips}
        groups.append((label, clips, dets))
    sports = {c: ev.clip_meta(c)["sport"] for _, clips, _ in groups for c in clips}
    base = dict(bt.P)
    tbase = dict(hb.T)
    head = "| set | " + " | ".join(f"{g[0]}: prec / cover" for g in groups) + " | all: prec / cover | worst |"
    print(head)
    print("|---|" + "---|" * (len(groups) + 2))
    for s in a.sets:
        sname, vals, tvals = parse_set(s)
        hb.T.clear()
        hb.T.update(tbase)
        hb.T.update({k: type(tbase[k])(v) for k, v in tvals.items()})
        cells, tot, per = [], [0, 0, 0], []
        for label, clips, dets in groups:
            acc = [0, 0, 0]
            for c in clips:
                P = dict(base)
                P.update(bt.SPORT_P.get(sports[c], {}))
                P.update(vals)
                for k in ("still_win", "gap", "min_len", "dp_gap", "dp_topk"):
                    P[k] = type(base[k])(P[k])
                pred, _ = bt.track(dets[c], P)
                r = score(c, pred, sports[c])
                per.append((r[2] / r[0] if r[0] else 0, c))
                for i in range(3):
                    acc[i] += r[i]
                    tot[i] += r[i]
            cells.append(f"{100 * acc[2] / max(1, acc[1]):.0f}% / {100 * acc[2] / max(1, acc[0]):.0f}%")
        per.sort()
        worst = ", ".join(f"{c[-4:]} {100 * v:.0f}%" for v, c in per[: a.worst])
        print(f"| {sname} | " + " | ".join(cells) +
              f" | {100 * tot[2] / max(1, tot[1]):.1f}% / {100 * tot[2] / max(1, tot[0]):.1f}% | {worst} |", flush=True)
        if a.clips:
            print("    " + " ".join(f"{c[-4:]}:{100 * v:.0f}" for v, c in sorted(per, key=lambda x: x[1])))


if __name__ == "__main__":
    main()
