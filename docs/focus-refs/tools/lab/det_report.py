#!/usr/bin/env python3
"""Test 17 report: per clip, detector ceiling (a candidate on the labelled ball), the ball track's prec / cover
(ball_gate.py's ground-truth numbers) and ball mode, next to EdgeTAM's fused track (test 15) and v6 at 10 fps.

    python3 tools/lab/det_report.py --det yolox-s-t5 --track det-yolox-s-t5 [clip ...]
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import ball_gate as G  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")


def ceiling(name, det):
    d = json.load(open(os.path.join(DET, f"{name}.{det}.json")))
    t = ev.load_truth(name)
    R = ev.radius_px(t["size"])
    pts = hit = 0
    for ms, g in t["samples"].items():
        k = ms // 100
        if not isinstance(g, tuple) or k >= len(d["frames"]) or d["frames"][k] is None:
            continue
        pts += 1
        if any(ev._dist_px(c[:2], g, t["size"]) <= R for c in d["frames"][k]):
            hit += 1
    return pts, (hit / pts if pts else None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", required=True)
    ap.add_argument("--track", required=True)
    ap.add_argument("--name", default=None)
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    f = lambda v: "—" if v is None else f"{100 * v:.0f}%"  # noqa: E731
    lines = [f"Detector {a.det}, track {a.track} vs EdgeTAM fused (edgetam-fuse5, test 15)", "",
             "| Clip | pts | detector ceiling | track: mode / prec / cover / gate | EdgeTAM fused: mode / prec / cover / gate |",
             "|---|---|---|---|---|"]
    for c in a.clips:
        if not os.path.exists(os.path.join(DET, f"{c}.{a.det}.json")):
            continue
        pts, ceil = ceiling(c, a.det)
        r = G.signals(c, a.track, a.track)
        cell = f"{f(r['mode'])} / {f(r.get('prec'))} / {f(r.get('cover'))} / {'sim' if r['eligible'] else 'não'}"
        try:
            e = G.signals(c, "edgetam-5fps", "edgetam-fuse5")
            ecell = f"{f(e['mode'])} / {f(e.get('prec'))} / {f(e.get('cover'))} / {'sim' if e['eligible'] else 'não'}"
        except FileNotFoundError:
            ecell = "—"
        lines.append(f"| {c} | {pts} | {f(ceil)} | {cell} | {ecell} |")
    text = "\n".join(lines) + "\n"
    print(text)
    out = os.path.join(ev.ROOT, "lab", "tests", "detect", f"report.{a.name or a.track}.md")
    open(out, "w").write(text)


if __name__ == "__main__":
    main()
