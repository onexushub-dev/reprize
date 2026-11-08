#!/usr/bin/env python3
"""Modo Foco lab, test 21: the offline Savitzky-Golay framing on every ball engine the lab has (9:16 output).

The idea from test 20's script, applied to the lab's ball tracks instead of YOLOv8n: since the clip is framed after
recording, the camera path can look ahead as well as back (a centred Savitzky-Golay filter: no lag, it starts moving
before the ball does).

Per clip (the 11 horizontal labelled clips, 100 ms grid, 9:16 crop of the full height, as today's portrait framing):
1. The ball per frame from an engine's track (lab/tests/oneclick/<clip>.ball.<tag>.json), kept only where
   hybrid.trusted() says it looks like a ball (same filter as Foco na Bola).
2. Gaps up to --bridge s between two trusted balls: straight line between them.
3. Longer gaps (fallback "players"): today's Modo Foco portrait crop centre (lab/tests/framing/<clip>.current.focus.json);
   fallback "hold": the last ball (what test 20's script did).
4. Savitzky-Golay, centred, polyorder 2, window --win s; crop clamped to the frame.

Engines: the tags in ENGINES, "labels" (the hand labels themselves: the ceiling of this framing), "today" (today's
portrait Modo Foco, unchanged) and "centre" (a fixed centred crop).

Scores on the labelled visible balls: ball in crop; camera speed p95 (frame widths/s); direction changes per 10 s
(pan reversals bigger than 2% of the frame width, i.e. the camera going back and forth).

    python3 tools/lab/sg_framing.py [--win 0.5,1.0,1.5] [--bridge 1.0] [--fallback players,hold]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402

TESTS = os.path.join(ev.ROOT, "lab", "tests")
OUT = os.path.join(TESTS, "sg")
CLIPS = ["basket-rp-1105-h", "bt-rz-1105-a", "bt-rz-1105-b", "yt-basket-04", "yt1105-basket-a", "yt1105-basket-b",
         "yt1105-bt", "yt1105-futevolei", "yt1105-volei-a", "yt1105-volei-b", "yt1105-voleipraia"]
ENGINES = {
    "det-yolox-s-t5": "YOLOX-S + tiles, no tap (test 17)",
    "det-tiny-n-a3k2": "YOLOX-Tiny, cheap tiles, no tap (test 19)",
    "edgetam-fuse5": "EdgeTAM, 1 tap, 2 passes 5 fps (Foco na Bola, test 14/15)",
    "mix-det-fuse5": "YOLOX-S + EdgeTAM mixed (test 17)",
    "mix-tiny-n-a3k2": "YOLOX-Tiny + EdgeTAM mixed (test 19)",
}


def savgol(y: np.ndarray, win: int, order: int = 2) -> np.ndarray:
    """Centred Savitzky-Golay (no scipy on the Mac's python), edges padded with the edge value."""
    win = max(order + 2, win | 1)
    h = win // 2
    A = np.vander(np.arange(-h, h + 1), order + 1, increasing=True)
    c = np.linalg.pinv(A)[0]
    yp = np.concatenate([np.full(h, y[0]), y, np.full(h, y[-1])])
    return np.convolve(yp, c[::-1], mode="valid")


def target_x(balls, fallback_x, bridge, mode):
    n = len(balls)
    x = np.array(fallback_x, dtype=float)
    idx = [i for i in range(n) if balls[i] is not None]
    for i in idx:
        x[i] = balls[i]
    for a, b in zip(idx, idx[1:]):
        if 1 < b - a <= bridge:
            x[a + 1:b] = np.linspace(balls[a], balls[b], b - a + 1)[1:-1]
        elif b - a > bridge and mode == "hold":
            x[a + 1:b] = balls[a]
    if mode == "hold" and idx:
        x[idx[-1] + 1:] = balls[idx[-1]]
    return x


def score(cx, cw, truth, n, step=0.1):
    pts = inside = 0
    for t, v in truth["samples"].items():
        i = t // 100
        if not isinstance(v, tuple) or i >= n:
            continue
        pts += 1
        x0 = min(max(cx[i] - cw / 2, 0), 1 - cw)
        inside += x0 <= v[0] <= x0 + cw
    left = np.clip(cx - cw / 2, 0, 1 - cw)
    v = np.diff(left) / step
    # direction changes: reversals of the pan between turning points at least 2% of the frame apart
    flips, last, ref = 0, 0, left[0]
    for p in left[1:]:
        d = p - ref
        if abs(d) >= 0.02:
            s = 1 if d > 0 else -1
            if last and s != last:
                flips += 1
            last, ref = s, p
        elif last and (p - ref) * last > 0:
            ref = p
    return {"pts": pts, "in": inside / pts if pts else None, "speed": float(np.percentile(np.abs(v), 95)),
            "flips": flips * 100 / n}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--win", default="0.5,1.0,1.5")
    ap.add_argument("--bridge", type=float, default=1.0)
    ap.add_argument("--fallback", default="players,hold")
    a = ap.parse_args()
    wins = [float(w) for w in a.win.split(",")]
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for name in CLIPS:
        meta = ev.clip_meta(name)
        truth = ev.load_truth(name)
        W, H = truth["size"]
        n = meta["count"]
        with open(os.path.join(TESTS, "framing", f"{name}.current.focus.json")) as f:
            fc = json.load(f)
        off = int(round((meta["startMs"] - fc["startMs"]) / 100))
        cur = fc["portrait"][off:off + n]
        n = min(n, len(cur))
        cw = cur[0][2]
        today = np.array([r[0] + r[2] / 2 for r in cur[:n]])
        rows.append({"clip": name, "engine": "today", "win": None, "fallback": None, **score(today, cw, truth, n)})
        rows.append({"clip": name, "engine": "centre", "win": None, "fallback": None,
                     **score(np.full(n, 0.5), cw, truth, n)})
        tracks = {}
        for tag in ENGINES:
            p = os.path.join(TESTS, "oneclick", f"{name}.ball.{tag}.json")
            if os.path.exists(p):
                with open(p) as f:
                    oc = json.load(f)
                tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
                tracks[tag] = [None if b is None else b[0] for b in tr]
        lab = [None] * n
        for t, v in truth["samples"].items():
            if isinstance(v, tuple) and t // 100 < n:
                lab[t // 100] = v[0]
        tracks["labels"] = lab
        for tag, balls in tracks.items():
            for fb in a.fallback.split(","):
                for w in wins:
                    tx = target_x(balls, today, int(round(a.bridge / 0.1)), fb)
                    sx = savgol(tx, int(round(w / 0.1)))
                    r = {"clip": name, "engine": tag, "win": w, "fallback": fb, **score(sx, cw, truth, n),
                         "ballShare": sum(b is not None for b in balls) / n}
                    rows.append(r)
    with open(os.path.join(OUT, "scores.json"), "w") as f:
        json.dump(rows, f, indent=0)

    def mean(sel, k):
        v = [r[k] for r in rows if sel(r) and r[k] is not None]
        return sum(v) / len(v) if v else None

    lines = [f"# Test 21 — offline Savitzky-Golay 9:16 framing per ball engine (bridge {a.bridge} s)", "",
             "Means over the 11 horizontal labelled clips.", "",
             "| Engine | Fallback | Window | Ball in crop | Speed p95 (widths/s) | Direction changes /10 s |",
             "|---|---|---|---|---|---|"]
    for eng in ["today", "centre"]:
        s = lambda r, e=eng: r["engine"] == e  # noqa: E731
        lines.append(f"| {eng} | — | — | {mean(s, 'in'):.0%} | {mean(s, 'speed'):.2f} | {mean(s, 'flips'):.1f} |")
    for eng in list(ENGINES) + ["labels"]:
        for fb in a.fallback.split(","):
            for w in wins:
                s = lambda r, e=eng, f=fb, ww=w: r["engine"] == e and r["fallback"] == f and r["win"] == ww  # noqa
                if mean(s, "in") is None:
                    continue
                lines.append(f"| {eng} | {fb} | {w:.1f} s | {mean(s, 'in'):.0%} | {mean(s, 'speed'):.2f} "
                             f"| {mean(s, 'flips'):.1f} |")
    lines += ["", "Per clip, ball in crop (fallback players):", ""]
    for w in wins:
        hdr = ["today", "centre"] + list(ENGINES) + ["labels"]
        lines += [f"Window {w:.1f} s", "", "| Clip | " + " | ".join(hdr) + " |", "|" + "---|" * (len(hdr) + 1)]
        for name in CLIPS:
            cells = []
            for e in hdr:
                m = [r for r in rows if r["clip"] == name and r["engine"] == e
                     and (e in ("today", "centre") or (r["win"] == w and r["fallback"] == "players"))]
                cells.append(f"{m[0]['in']:.0%}" if m and m[0]["in"] is not None else "—")
            lines.append(f"| {name} | " + " | ".join(cells) + " |")
        lines.append("")
    with open(os.path.join(OUT, "summary.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
