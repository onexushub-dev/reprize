#!/usr/bin/env python3
"""Modo Foco lab, test 19 (2026-11-06): a cheaper ball detector. The phone bench of test 17 measured ~9 detector
inferences per frame (whole frame + 640 px tiles) = 53.8 s per 30 s clip, 2x the two EdgeTAM passes. Here: the whole
frame always, plus only K tiles chosen online (causal: from earlier frames only) around where the ball should be
(last ball + speed); when the ball is lost, the tiles nearest the centre of today's Modo Foco crop (the players).

Offline simulation, no new inference with tiles: a candidate of the full run (`yolox-s-t5`, whole + all tiles, NMS)
is kept when it is in the whole-frame-only run (`yolox-s-w5`) or inside a chosen tile (an object inside a tile is
assumed found by that tile, as in the full run). Output: a ball_detect-style file `<clip>.<out>.json` (then
ball_track.py / low_fps.py fuse / det_report.py as in test 17) with "inferences" = 1 + tiles used per frame.

    python3 tools/lab/roi_tiles.py --k 2 --out yolox-s-r2 [clip ...]
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
import hybrid as hb  # noqa: E402
from ball_detect import tiles  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")


def players_centres(name, n):
    """Centre (0..1) of today's Modo Foco crop per 100 ms frame of the clip, or None."""
    meta = ev.clip_meta(name)
    p = os.path.join(hb.OUT, f"{name}.current.focus.json")
    if not os.path.exists(p):
        return [None] * n
    fc = json.load(open(p))
    W, H = fc["size"]
    aspect = "portrait" if H > W else "landscape"
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    cur = fc[aspect][off:off + n]
    out = [(r[0] + r[2] / 2, r[1] + r[3] / 2) for r in cur]
    return out + [None] * (n - len(out))


def anchor_track(full, A):
    """Two-stage (the clip is processed after recording, so not causal): all tiles on every A-th analysed frame,
    ball_track.py's path over those frames only, interpolated to every frame = where to put the tiles in between."""
    import ball_track as BT
    step = full.get("step", 1)
    fr = [f if (f is not None and (i // step) % A == 0) else None for i, f in enumerate(full["frames"])]
    pred, _ = BT.track(dict(full, frames=fr, step=step * A), BT.P)
    return pred


def simulate(name, k, src, whole, out, gate, lost_after, acq, scan=0, anchor=0, guide=None):
    full = json.load(open(os.path.join(DET, f"{name}.{src}.json")))
    wh = json.load(open(os.path.join(DET, f"{name}.{whole}.json")))
    W, H = full["size"]
    TS = full.get("tile", 640)  # tile side of the full run (test 19: 416 for Tiny with native tiles)
    T = tiles(W, H, TS)
    L = max(W, H)
    n = len(full["frames"])
    centres = players_centres(name, n)
    pos = vel = None
    age = 0
    frames, used = [], []
    track_a = anchor_track(full, anchor) if anchor else None
    if guide:  # another ball track (EdgeTAM's, run anyway in the mix) says where to put the tiles
        g = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "oneclick", f"{name}.ball.{guide}.json")))["pred_one"]
        if track_a is None:
            track_a = {int(kk): v for kk, v in g.items()}
            anchor = 10 ** 9  # no anchor frame except frame 0
        else:  # anchors where the anchor path has no ball
            for kk, v in g.items():
                if track_a.get(int(kk)) is None and v is not None:
                    track_a[int(kk)] = v
    rr = 0  # round robin over the tiles for the scanning slots
    for i in range(n):
        fr = full["frames"][i]
        if fr is None:
            frames.append(None)
            continue
        w0 = wh["frames"][i] if i < len(wh["frames"]) else None
        w0 = w0 or []
        step = full.get("step", 1)
        if track_a is not None and (i // step) % anchor == 0:
            frames.append(fr)  # anchor frame: all the tiles
            used.append(len(T))
            continue
        if track_a is not None:
            g = track_a.get(i)
            if g is None:
                g = track_a.get(str(i))
            tgt = (g[0], g[1]) if g is not None else centres[i]
        # where to look (from earlier frames only)
        elif pos is not None and age <= lost_after:
            tgt = (pos[0] + vel[0] * (age + 1), pos[1] + vel[1] * (age + 1)) if vel is not None else pos
        else:
            pos = vel = None
            tgt = centres[i]
        chosen = []
        if tgt is not None and k > 0:
            px, py = tgt[0] * W, tgt[1] * H
            order = sorted(T, key=lambda t: math.hypot(t[0] + TS / 2 - px, t[1] + TS / 2 - py))
            chosen = order[:k - scan] if scan < k else []
        # scanning slots: the other tiles in turn, so a ball anywhere is seen within len(T) / scan frames
        for _ in range(min(scan, k)):
            for _try in range(len(T)):
                t = T[rr % len(T)]
                rr += 1
                if t not in chosen:
                    chosen.append(t)
                    break
        used.append(len(chosen))

        def inside(c):
            x, y = c[0] * W, c[1] * H
            return any(tx <= x < tx + TS and ty <= y < ty + TS for tx, ty in chosen)

        def dup(c):
            return any(abs(c[0] - d[0]) * W < 4 and abs(c[1] - d[1]) * H < 4 for d in w0)

        keep = list(w0) + [c for c in fr if inside(c) and not dup(c)]
        frames.append(keep)
        # update the online estimate (only to choose the next tiles; the ball path itself is ball_track.py's)
        best = None
        if pos is not None:
            r = gate * (age + 1)
            for c in keep:
                d = math.hypot((c[0] - pos[0]) * W, (c[1] - pos[1]) * H) / L
                if d <= r and (best is None or c[4] - d > best[4] - best[5]):
                    best = (c[0], c[1], c[2], c[3], c[4], d)
        else:
            for c in keep:
                if c[4] >= acq and (best is None or c[4] > best[4]):
                    best = (c[0], c[1], c[2], c[3], c[4], 0)
        if best is not None:
            if pos is not None:
                vel = ((best[0] - pos[0]) / (age + 1), (best[1] - pos[1]) / (age + 1))
            pos = (best[0], best[1])
            age = 0
        else:
            age += 1
    inf = 1 + (sum(used) / len(used) if used else 0)
    json.dump({"clip": name, "tag": f"roi k={k} scan={scan}", "size": [W, H], "tiles": len(T), "conf": full["conf"],
               "step": full.get("step", 1), "inferences": round(inf, 2), "frames": frames},
              open(os.path.join(DET, f"{name}.{out}.json"), "w"))
    return len(T), inf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=2, help="tiles per analysed frame besides the whole frame")
    ap.add_argument("--src", default="yolox-s-t5")
    ap.add_argument("--whole", default="yolox-s-w5")
    ap.add_argument("--out", required=True)
    ap.add_argument("--gate", type=float, default=0.15, help="long sides per analysed frame the ball may move")
    ap.add_argument("--lost-after", type=int, default=5, help="analysed frames without the ball before going back to the players")
    ap.add_argument("--acq", type=float, default=0.3, help="score to (re)take a ball when lost")
    ap.add_argument("--anchor", type=int, default=0, help="all tiles on every A-th analysed frame, tiles around that path between")
    ap.add_argument("--guide", default=None, help="oneclick ball track tag to put the tiles around")
    ap.add_argument("--scan", type=int, default=0, help="of the K tiles, how many scan the frame in turn")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    for name in a.clips:
        if not os.path.exists(os.path.join(DET, f"{name}.{a.whole}.json")):
            print(name, "no whole-frame run")
            continue
        nt, inf = simulate(name, a.k, a.src, a.whole, a.out, a.gate, a.lost_after, a.acq, a.scan, a.anchor, a.guide)
        print(f"{name}: {nt} tiles in the full run, {inf:.2f} inferences per analysed frame -> {a.out}")


if __name__ == "__main__":
    main()
