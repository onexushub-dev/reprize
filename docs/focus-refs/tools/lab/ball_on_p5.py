#!/usr/bin/env python3
"""4K test plan, candidate 4 on Bola (2026-11-12): Seguir a Bola fed by Jogadores at 5 fps instead of 10.

Bola reads the Jogadores file: today's framing (where the ball is lost) and the person boxes (beach tennis head rule,
hitter kept whole, court lock; basketball shirt rule). For each clip with a 5 fps simulation (focus_fps.py) this makes
an alias clip <clip>-p5 that is the same video and the same ball detections (tag --det, default the 4K→1920 candidate)
with the 5 fps Jogadores file, runs the lab path, and compares with the clip on its 10 fps Jogadores file:
verdict, labelled precision / cover, the followed ball (agreement) and the app's beach tennis camera (cam_bt T52).
Nothing goes to the app. Writes lab/tests/focusfps/report-bola.<det>.md.

    python3 tools/lab/ball_on_p5.py [--det btpl-4kplan-1920] [clip ...]
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import ball_parity as bp  # noqa: E402

ev.load_truth = bp.truth_or_empty
import ball_gate as G  # noqa: E402
import ball_verdict as bv  # noqa: E402
import bt_render as br  # noqa: E402

FPS = os.path.join(ev.ROOT, "lab", "tests", "focusfps")
DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
T52 = "a=0.3,b=30,hitbox=2,horizon=10,hitpad=0.02"


def register(name, det):
    alias = f"{name}-p5"
    rows = [l.rstrip("\n") for l in open(os.path.join(HERE, "clips.txt"))]
    row = next((l for l in rows if l.split("|")[0] == name), None)
    if row is None:
        return None
    if not any(l.split("|")[0] == alias for l in rows):
        with open(os.path.join(HERE, "clips.txt"), "a") as f:
            f.write(alias + row[len(name):] + "\n")
    p5 = json.load(open(os.path.join(FPS, f"{name}.p5.focus.json")))
    json.dump(p5, open(os.path.join(ev.ROOT, "lab", "tests", "framing", f"{alias}.current.focus.json"), "w"))
    samples = [{"t": p5["startMs"] + k * p5["stepMs"], "tiled": [b[:4] + [1.0] for b in row_]}
               for k, row_ in enumerate(p5["people"])]
    json.dump({"samples": samples, "trajectories": [], "summary": {"tilesFixed": True,
              "medianHeightTiled": p5.get("playersHeight"), "note": "Jogadores at 5 fps (ball_on_p5.py)"}},
              open(os.path.join(ev.ROOT, "renders", f"{alias}.people.json"), "w"))
    d = json.load(open(os.path.join(DET, f"{name}.{det}.json")))
    d["clip"] = alias
    json.dump(d, open(os.path.join(DET, f"{alias}.{det}.json"), "w"))
    lab = os.path.join(ev.ROOT, "labels", f"{name}.ball.json")
    if os.path.exists(lab) and not os.path.exists(os.path.join(ev.ROOT, "labels", f"{alias}.ball.json")):
        shutil.copyfile(lab, os.path.join(ev.ROOT, "labels", f"{alias}.ball.json"))
    return alias


def verdict(name, track):
    try:
        r = bv.verdict(name, track)
    except Exception as e:
        return f"error {type(e).__name__}"
    if r is None:
        return "—"
    return ("apply" if r["ok"] else f"no: {r['why']}") + f" ({r.get('ball_px', 0):.0f} px)"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", default="btpl-4kplan-1920")
    ap.add_argument("--no-track", action="store_true", help="the tracks are made already")
    ap.add_argument("--out", default=None, help="report file name (default report-bola.<det>.md)")
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    names = a.clips or sorted(os.path.basename(p)[:-len(".p5.focus.json")] for p in glob.glob(os.path.join(FPS, "*.p5.focus.json")))
    names = [n for n in names if os.path.exists(os.path.join(DET, f"{n}.{a.det}.json"))]
    pairs = [(n, register(n, a.det)) for n in names]
    pairs = [(n, al) for n, al in pairs if al]
    if not a.no_track:
      subprocess.run([sys.executable, os.path.join(HERE, "ball_track.py"), "--det", a.det] + [al for _, al in pairs]
                   + [n for n, _ in pairs], check=True, stdout=subprocess.DEVNULL)
    track = f"det-{a.det}"
    lines = ["| clip | verdict 10 fps | verdict 5 fps | ball followed: same point | camera centre diff mean / max | labels: prec / cover 10 → 5 |",
             "|---|---|---|---|---|---|"]
    lab10, lab5, cams, changed = [], [], [], 0
    for n, al in pairs:
        oc = lambda c: json.load(open(os.path.join(ev.ROOT, "lab", "tests", "oneclick", f"{c}.ball.{track}.json")))["pred_one"]  # noqa: E731
        t10, t5 = oc(n), oc(al)
        W, H = ev.clip_meta(n)["size"]
        either = both = 0
        for k in set(t10) | set(t5):
            p, q = t10.get(k), t5.get(k)
            if not p and not q:
                continue
            either += 1
            if p and q and math.hypot((p[0] - q[0]) * W, (p[1] - q[1]) * H) <= 0.02 * max(W, H):
                both += 1
        v10, v5 = verdict(n, track), verdict(al, track)
        changed += v10.split(" (")[0] != v5.split(" (")[0]
        N = ev.clip_meta(n)["count"]
        cam = "—"
        if ev.clip_meta(n)["sport"] == "beachTennis":
            try:
                r10, _ = br.rects_of(n, f"{track}@{T52}", N)
                r5, _ = br.rects_of(al, f"{track}@{T52}", N)
                m = min(len(r10), len(r5))
                dc = np.abs((r10[:m, 0] + r10[:m, 2] / 2) - (r5[:m, 0] + r5[:m, 2] / 2))
                cams.append((dc.mean(), dc.max()))
                cam = f"{dc.mean():.1%} / {dc.max():.1%}"
            except Exception as e:
                cam = f"error {type(e).__name__}"
        lab = "—"
        if os.path.exists(os.path.join(ev.ROOT, "labels", f"{n}.ball.json")):
            g10, g5 = G.signals(n, track, track), G.signals(al, track, track)
            lab10.append(g10)
            lab5.append(g5)
            f = lambda v: "—" if v is None else f"{v:.0%}"  # noqa: E731
            lab = f"{f(g10.get('prec'))} / {f(g10.get('cover'))} → {f(g5.get('prec'))} / {f(g5.get('cover'))}"
        lines.append(f"| {n} | {v10} | {v5} | {both / either if either else 0:.0%} | {cam} | {lab} |")
    if cams:
        c = np.array(cams)
        lines += ["", f"{len(pairs)} clips: verdict changed on {changed}; beach tennis camera centre diff mean "
                      f"{c[:, 0].mean():.1%} of the frame width (worst moment {c[:, 1].max():.1%})."]
    text = "\n".join(lines) + "\n"
    open(os.path.join(FPS, a.out or f"report-bola.{a.det}.md"), "w").write(text)
    print(text)


if __name__ == "__main__":
    main()
