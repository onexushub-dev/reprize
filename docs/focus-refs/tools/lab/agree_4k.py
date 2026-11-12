#!/usr/bin/env python3
"""4K test plan (docs/superpowers/plans/2026-11-12-4k-analysis-speed-test-plan.md), steps 4-5: today's ball analysis
(tag A, e.g. frames at native size) against a candidate (tag B, e.g. 4K scaled to 1920) on every clip of a dump, with or
without labels:
  - agreement: frames where both tracks have the ball within 2% of the long side, of the frames either has it;
  - labelled clips (labels/<clip>.ball.json): detector ceiling and the track's precision / cover for A and B
    (det_report's numbers);
  - the verdict (ball_verdict.py) for A and B next to the phone's (inventory.json);
  - detector time per analysed frame (the lab's CPU: compare A with B, not with the phone).
Writes lab/tests/4k/<dump>/report.<A>-vs-<B>.md.

    python3 tools/lab/agree_4k.py --dump 2026-11-11-4k --a btpl-4kplan-native --b btpl-4kplan-1920
(tags are detector tags; the tracks are det-<tag>; the sport's model is in the tag only by convention)
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import ball_gate as G  # noqa: E402
import ball_verdict as bv  # noqa: E402
import det_report as dr  # noqa: E402
import ball_parity as bp  # noqa: E402

# clips without labels still get the verdict (their truth is empty); labelled clips read their labels as before
ev.load_truth = bp.truth_or_empty

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
ONECLICK = os.path.join(ev.ROOT, "lab", "tests", "oneclick")


def track(name, tag):
    p = os.path.join(ONECLICK, f"{name}.ball.det-{tag}.json")
    return json.load(open(p))["pred_one"] if os.path.exists(p) else None


def agreement(name, a, b):
    ta, tb = track(name, a), track(name, b)
    if ta is None or tb is None:
        return None
    W, H = ev.clip_meta(name)["size"]
    R = 0.02 * max(W, H)
    either = both = 0
    for k in set(ta) | set(tb):
        pa, pb = ta.get(k), tb.get(k)
        if not pa and not pb:
            continue
        either += 1
        if pa and pb and math.hypot((pa[0] - pb[0]) * W, (pa[1] - pb[1]) * H) <= R:
            both += 1
    return both / either if either else None


def det_speed(name, tag):
    p = os.path.join(DET, f"{name}.{tag}.json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    n = sum(1 for f in d["frames"] if f is not None)
    return d["seconds"] / n if n else None


def labelled(name, tag):
    if not os.path.exists(os.path.join(ev.ROOT, "labels", f"{name}.ball.json")):
        return None
    try:
        pts, ceil = dr.ceiling(name, tag)
        g = G.signals(name, f"det-{tag}", f"det-{tag}")
        return {"pts": pts, "ceil": ceil, "prec": g.get("prec"), "cover": g.get("cover")}
    except Exception as e:  # a missing file: reported, not fatal
        return {"error": str(e)}


def verdict(name, tag):
    if not os.path.exists(os.path.join(ev.ROOT, "lab", "tests", "framing", f"{name}.current.focus.json")):
        return "— (no Jogadores file from the phone)"
    try:
        r = bv.verdict(name, f"det-{tag}")
    except Exception as e:
        return f"error: {type(e).__name__}"
    if r is None:
        return "no verdict (sport)"
    px = r.get("ball_px")
    return ("apply" if r["ok"] else f"no: {r['why']}") + (f" ({px:.0f} px)" if px is not None else "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dump", required=True, help="the dump folder name (lab/tests/4k/<dump>/inventory.json)")
    ap.add_argument("--a", required=True, help="detector tag of today's analysis")
    ap.add_argument("--b", required=True, help="detector tag of the candidate")
    ap.add_argument("clips", nargs="*", help="default: every registered clip of the dump")
    a = ap.parse_args()
    out = os.path.join(ev.ROOT, "lab", "tests", "4k", a.dump)
    inv = {r["name"]: r for r in json.load(open(os.path.join(out, "inventory.json"))) if r["name"]}
    names = a.clips or list(inv)
    rows, lab = [], {"A": [], "B": []}
    tally = {}
    for n in names:
        if track(n, a.a) is None or track(n, a.b) is None:
            continue
        r = inv.get(n, {})
        phone = r.get("bola") or "-"
        if r.get("bola_reason"):
            phone += f" ({r['bola_reason']})"
        la, lb = labelled(n, a.a), labelled(n, a.b)
        for key, v in (("A", la), ("B", lb)):
            if v and "error" not in v:
                lab[key].append(v)
        sa, sb = det_speed(n, a.a), det_speed(n, a.b)
        ag = agreement(n, a.a, a.b)
        fmt = lambda v: "—" if v is None else f"{v:.0%}"  # noqa: E731
        lcol = "—"
        if la and lb and "error" not in la and "error" not in lb:
            lcol = (f"{la['pts']} pts: ceil {fmt(la['ceil'])} → {fmt(lb['ceil'])}, prec {fmt(la['prec'])} → "
                    f"{fmt(lb['prec'])}, cover {fmt(la['cover'])} → {fmt(lb['cover'])}")
        va, vb = verdict(n, a.a), verdict(n, a.b)
        key = (r.get("size", "?"), va.split(" (")[0], vb.split(" (")[0])
        tally[key] = tally.get(key, 0) + 1
        rows.append(f"| {n} | {r.get('size', '?')} | {fmt(ag)} | {lcol} | {phone} | {va} | "
                    f"{vb} | {'—' if sa is None else f'{sa:.2f}'} → {'—' if sb is None else f'{sb:.2f}'} s |")

    def total(vs, k):
        num = sum(v["pts"] * v[k] for v in vs if v.get(k) is not None)
        den = sum(v["pts"] for v in vs if v.get(k) is not None)
        return f"{num / den:.1%}" if den else "—"
    with open(os.path.join(out, f"report.{a.a}-vs-{a.b}.md"), "w") as f:
        f.write(f"# {a.dump}: {a.a} (A) vs {a.b} (B)\n\n")
        f.write("| clip | size | agreement A/B | labels (A → B) | phone | verdict A | verdict B | detector s/frame (lab CPU) |\n")
        f.write("|---|---|---|---|---|---|---|---|\n")
        f.write("\n".join(rows) + "\n\n")
        pts = sum(v["pts"] for v in lab["A"])
        f.write(f"Labelled total ({pts} pts, weighted): ceiling {total(lab['A'], 'ceil')} → {total(lab['B'], 'ceil')}, "
                f"precision {total(lab['A'], 'prec')} → {total(lab['B'], 'prec')}, "
                f"cover {total(lab['A'], 'cover')} → {total(lab['B'], 'cover')}\n\n")
        f.write("Verdicts (size: A → B: clips)\n\n")
        for (size, va, vb), k in sorted(tally.items()):
            f.write(f"- {size}: {va} → {vb}: {k}\n")
    print(os.path.join(out, f"report.{a.a}-vs-{a.b}.md"))


if __name__ == "__main__":
    main()
