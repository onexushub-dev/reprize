#!/usr/bin/env python3
"""Test 43 (2026-11-09): can the app tell a basketball clip from the other sports by itself, so Seguir a Bola needs no
question about the sport?

43a: Apple's scene classifier (lab/tests/sport/t43a.json, from sport_classify.swift): per clip, the highest confidence
     of each label over its 3 frames; how well "basketball" (and the other sports' labels) separate the sports.
43b: the app's detector (ball_tiny_gym, all tiles, 5 fps) and path: the share of the clip's 100 ms frames with a trusted
     ball (what Seguir a Bola follows), basketball vs the other sports.

    python3 tools/lab/sport_report.py
"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_track as bt  # noqa: E402
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")


def report_43a():
    d = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "sport", "t43a.json")))
    rows = []
    for c in d["clips"]:
        best = {}
        for fr in c["frames"]:
            for k, v in fr["labels"].items():
                best[k] = max(best.get(k, 0), v)
        rows.append((c["clip"], c["sport"], best))
    basket = [r for r in rows if r[1] == "basquete"]
    other = [r for r in rows if r[1] != "basquete"]
    print(f"43a: {len(basket)} basketball clips, {len(other)} other sports")
    labels = sorted({k for r in rows for k in r[2]})
    out = []
    for lab in labels:
        b = np.array([r[2].get(lab, 0) for r in basket]); o = np.array([r[2].get(lab, 0) for r in other])
        out.append((lab, (b >= 0.1).mean(), (o >= 0.1).mean(), b.mean(), o.mean()))
    print("label: share of clips >= 0.1 (basketball / other), mean confidence (basketball / other)")
    for lab, bp, op, bm, om in sorted(out, key=lambda x: -(abs(x[1] - x[2])))[:15]:
        print(f"  {lab:18s} {bp:5.0%} / {op:5.0%}   {bm:.3f} / {om:.3f}")
    for t in (0.05, 0.1, 0.2, 0.3, 0.5):
        tp = np.mean([r[2].get("basketball", 0) >= t for r in basket]); fp = np.mean([r[2].get("basketball", 0) >= t for r in other])
        print(f"  rule basketball >= {t}: basketball clips found {tp:.0%}, other sports taken for basketball {fp:.0%}")
    sports = ["volleyball", "tennis", "beach_volleyball", "soccer", "football", "ping_pong", "badminton"]
    sp = [s for s in sports if s in labels]
    for t in (0.2, 0.3, 0.5):
        tn = np.mean([max(r[2].get(s, 0) for s in sp) >= t for r in other]); fn = np.mean([max(r[2].get(s, 0) for s in sp) >= t for r in basket])
        print(f"  rule another sport's label ({'/'.join(sp)}) >= {t}: other sports caught {tn:.0%}, basketball taken for another {fn:.0%}")
    return rows


def tag_for(name):
    for t in ("bgymall-n5", "bgym-n5", "bgymX-n5"):
        if os.path.exists(os.path.join(DET, f"{name}.{t}.json")):
            return t
    return None


def report_43b(rows):
    out = []
    P = dict(bt.P); P.update(bt.SPORT_P["basquete"])
    for name, sport, _ in rows:
        tag = tag_for(name)
        if not tag:
            continue
        det = json.load(open(os.path.join(DET, f"{name}.{tag}.json")))
        saved = dict(bt.P); bt.P.clear(); bt.P.update(P)
        try:
            pred, _ = bt.track(det, bt.P)
        finally:
            bt.P.clear(); bt.P.update(saved)
        n = len(det["frames"])
        tr = hybrid.trusted({str(k): v for k, v in pred.items()}, n, det["size"], "basquete")
        share = float(np.mean([p is not None for p in tr]))
        path = float(np.mean([pred.get(k) is not None for k in range(n)]))
        scores = [pred[k][8] for k in range(n) if pred.get(k) is not None]
        out.append((name, sport, share, path, float(np.median(scores)) if scores else 0.0))
    b = [r for r in out if r[1] == "basquete"]; o = [r for r in out if r[1] != "basquete"]
    print(f"\n43b: {len(b)} basketball clips, {len(o)} other sports (trusted share / path share / median path score)")
    for r in sorted(out, key=lambda r: (r[1] != "basquete", -r[2])):
        print(f"  {r[0]:24s} {r[1]:11s} {r[2]:5.0%} {r[3]:5.0%} {r[4]:.2f}")
    for t in (0.1, 0.2, 0.3, 0.35, 0.4, 0.5):
        tp = np.mean([r[2] >= t for r in b]); fp = np.mean([r[2] >= t for r in o])
        print(f"  rule trusted share >= {t:.2f}: basketball kept {tp:.0%}, other sports kept {fp:.0%}")
    return out


if __name__ == "__main__":
    rows = report_43a()
    res = report_43b(rows)
    json.dump({"43b": res}, open(os.path.join(ev.ROOT, "lab", "tests", "sport", "t43b.json"), "w"))
