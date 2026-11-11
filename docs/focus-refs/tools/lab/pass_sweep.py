#!/usr/bin/env python3
"""Modo Foco lab, test 50 (2026-11-10): Seguir a Bola (basketball) on fast passes. Victor's field clip
basket-app-1110-a (= basket-app-1108-a exported again by the app): on a long pass across the court the 9:16 camera
lost the ball and the receiver for ~1 s. This sweeps the ball path (`size_cost`: the ball keeps its size from one point
to the next) and the camera's smoothing (camera C: a 3, b 300) on every labelled basketball clip, scored by:

  in      labelled ball points inside the 9:16 crop
  pass    the same on the points from the end of a fast move (>= 0.15 frame widths within 0.6 s) to 0.8 s after it
          (the receiver and what he does next)
  outrun  longest run of labelled ball points outside the crop (s)
  pan     crop centre movement on screen, crop widths per 10 s; flips = direction changes per 10 s

The zoom is the clip's auto zoom with today's path and camera (test 31's rule) where today's Modo Foco file exists,
1.2x otherwise (what the app chose on 1110-a), the same for every variant of a clip.

    python3 tools/lab/pass_sweep.py [--paths 0,0.5,1] [--cams 3:300,1:100] [--clips ...]
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_parity as bp  # noqa: E402
import ball_track as bt  # noqa: E402
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402
import sg_lazy2 as l2  # noqa: E402
import story  # noqa: E402
import cam_bt  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "story")
# (clip, detections, labels): held-out folds for our gym (test 38), the app's model on other courts (test 40) and the
# field clip (the app's model, labels of the same footage)
CLIPS = ([(f"basket-app-1107-{c}", "bgym-n5", None) for c in "abcd"]
         + [(f"basket-app-1108-{c}", "bgym-n5", None) for c in "abcdefgh"]
         + [(f"basket-ext-1109-{c}", "bgymall-n5", None) for c in "abcdefghijk"]
         + [(c, "bgymX-n5", None) for c in ("basket-rp-1105-h", "basket-rp-1105-v-a", "basket-rp-1105-v-b",
                                             "basket-v-01", "yt-basket-04", "yt1105-basket-a", "yt1105-basket-b")]
         + [("basket-app-1110-a", "bgymall-n5", "basket-app-1108-a")])
PASS_DX, PASS_MS, AFTER_MS = 0.15, 600, 800


def track(name, tag, label, over):
    det = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "detect", f"{name}.{tag}.json")))
    meta = ev.clip_meta(name)
    P = dict(bt.P)
    P.update(bt.SPORT_P.get(meta["sport"], {}))
    P.update(dict(person_ratio=0.0))  # test 50's "base" is the path before it (SPORT_P now has the shirt rule)
    P.update(over)
    saved = dict(bt.P)
    bt.P.clear()
    bt.P.update(P)
    try:
        pred, _ = bt.track(det, bt.P)
    finally:
        bt.P.clear()
        bt.P.update(saved)
    n = meta["count"]
    truth = ev.load_truth(label or name)
    tr = hybrid.trusted({str(k): v for k, v in pred.items()}, n, truth["size"], meta["sport"])
    return meta, truth, tr, n


def today_of(name, n, W, H):
    p = os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")
    wmax = min(1.0, (9 / 16) * H / W)
    hmax = min(1.0, (16 / 9) * W / H)
    if not os.path.exists(p):
        row = [(1 - wmax) / 2, (1 - hmax) / 2, wmax, hmax]
        return np.array([row] * n), None
    fc = json.load(open(p))
    meta = ev.clip_meta(name)
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    today = np.array(fc["portrait"][off:off + n], dtype=float)
    if len(today) < n:
        today = np.vstack([today, np.repeat(today[-1:], n - len(today), 0)])
    orient = "portrait" if H > W else "landscape"
    native = np.array(fc["landscape" if orient == "landscape" else "portrait"], dtype=float)
    return today, native


def pass_points(truth):
    """Labelled ms where a fast move ended up to AFTER_MS before."""
    pts = {t: v for t, v in truth["samples"].items() if isinstance(v, tuple)}
    ts = sorted(pts)
    ends = []
    for i, t2 in enumerate(ts):
        for t1 in ts[:i]:
            if t2 - t1 <= PASS_MS and abs(pts[t2][0] - pts[t1][0]) >= PASS_DX:
                ends.append(t2)
                break
    return {t for t in ts if any(0 <= t - e <= AFTER_MS for e in ends)}


def holder(people, k, v, W, H, near=0.12):
    """The person whose box centre is nearest to the ball (within `near` long sides), or None."""
    if people is None:
        return None
    for kk in (k, k - 1, k + 1):
        if 0 <= kk < len(people) and people[kk] is not None:
            L = max(W, H)
            best = None
            for b in people[kk]:
                d = ((b[0] - v[0]) * W) ** 2 + ((b[1] - v[1]) * H) ** 2
                d = d ** 0.5 / L
                if d <= near and (best is None or d < best[0]):
                    best = (d, b)
            return None if best is None else best[1]
    return None


def score(rects, truth, n, fast, people=None, W=1, H=1):
    ins, fin, run, worst = [], [], 0, 0
    hold, hfast = [], []
    for t in sorted(truth["samples"]):
        v = truth["samples"][t]
        i = t // 100
        if not isinstance(v, tuple) or i >= n:
            continue
        x, y, w, h = rects[i]
        ok = (x <= v[0] <= x + w) and (y <= v[1] <= y + h)
        ins.append(ok)
        if t in fast:
            fin.append(ok)
        hb = holder(people, i, v, W, H)
        if hb is not None:
            whole = x - 0.01 <= hb[0] - hb[2] / 2 and hb[0] + hb[2] / 2 <= x + w + 0.01
            hold.append(whole)
            if t in fast:
                hfast.append(whole)
        run = 0 if ok else run + 1
        worst = max(worst, run)
    s = l2.score(rects, truth, n)
    cx = rects[:, 0] + rects[:, 2] / 2
    pan = float(np.sum(np.abs(np.diff(cx)) / rects[1:, 2])) / (n / 100.0)
    return {"in": float(np.mean(ins)) if ins else None, "pass": float(np.mean(fin)) if fin else None,
            "npass": len(fin), "outrun": worst * 0.2, "pan": pan, "flips": s["flips"],
            "hold": hold, "hfast": hfast}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--paths", default="base|size_cost=1,size_free=0.3",
                    help="path variants separated by |: base or k=v,k=v (ball_track.P overrides)")
    ap.add_argument("--cams", default="3:300,1:100,1:30")
    ap.add_argument("--clips", nargs="*")
    ap.add_argument("--name", default="t50")
    a = ap.parse_args()
    paths = [p for p in a.paths.split("|")]
    cams = [tuple(float(v) for v in c.split(":")) for c in a.cams.split(",")]
    clips = [c for c in CLIPS if not a.clips or c[0] in a.clips]
    rows = []
    for name, tag, label in clips:
        meta = ev.clip_meta(name)
        W, H = story.source_size(meta)
        base = None
        for sc in paths:
            over = {} if sc == "base" else {k: float(v) for k, v in (kv.split("=") for kv in sc.split(","))}
            _, truth, tr, n = track(name, tag, label, over)
            today, native = today_of(name, n, W, H)
            if base is None:
                if native is not None:
                    zoom, _ = bp.auto_zoom(tr, today, native, W, H, W >= H)
                else:
                    zoom = 1.2
                base = zoom
                fast = pass_points(truth)
            for cam in cams:
                aim = None
                if len(cam) > 2 and cam[2] > 0:
                    pr = bt.people_rows(name) or []
                    rows100 = []
                    for k in range(n):
                        src = pr[k] if k < len(pr) and pr[k] is not None else (pr[k - 1] if 0 < k <= len(pr) and pr[k - 1] is not None else [])
                        rows100.append([[b[0] - b[2] / 2, b[1] - b[3] / 2, b[2], b[3]] for b in src])
                    aim = cam_bt.aim_x(tr, cam_bt.main_players(rows100), W, H, cam[2], 0.25)
                r = bp.camera_rects(tr, today, W, H, base, smooth=cam[:2], aim=aim)
                s = score(r, truth, n, fast, bt.people_rows(name), W, H)
                rows.append({"clip": name, "size_cost": sc, "cam": ":".join(f"{c:g}" for c in cam), "zoom": base,
                             "share": float(np.mean([p is not None for p in tr])), **s})
        print(name, f"zoom {base}", flush=True)
    os.makedirs(OUT, exist_ok=True)
    json.dump([{k: v for k, v in r.items() if k not in ("hold", "hfast")} for r in rows],
              open(os.path.join(OUT, f"pass-sweep-{a.name}.json"), "w"), indent=1)
    keys = list(dict.fromkeys((r["size_cost"], r["cam"]) for r in rows))
    print("\n| path | camera a:b | ball in crop | at passes (n) | holder whole: all / at passes | worst out-run s (mean / max) | pan | flips |")
    print("|---|---|---|---|---|---|---|---|")
    for sc, cam in keys:
        rs = [r for r in rows if r["size_cost"] == sc and r["cam"] == cam]
        ins = [r["in"] for r in rs if r["in"] is not None]
        npass = sum(r["npass"] for r in rs)
        pw = sum((r["pass"] or 0) * r["npass"] for r in rs) / max(1, npass)
        ha = [v for r in rs for v in r["hold"]]
        hf = [v for r in rs for v in r["hfast"]]
        print(f"| {sc} | {cam} | {np.mean(ins):.1%} | {pw:.1%} ({npass}) | {np.mean(ha):.1%} / {np.mean(hf):.1%} ({len(hf)}) | "
              f"{np.mean([r['outrun'] for r in rs]):.2f} / {max(r['outrun'] for r in rs):.1f} | "
              f"{np.mean([r['pan'] for r in rs]):.2f} | {np.mean([r['flips'] for r in rs]):.1f} |")
    print("\nper clip (in / pass / outrun):")
    for name in dict.fromkeys(r["clip"] for r in rows):
        cells = []
        for sc, cam in keys:
            r = next(x for x in rows if x["clip"] == name and x["size_cost"] == sc and x["cam"] == cam)
            p = "-" if r["pass"] is None else f"{r['pass']:.0%}"
            cells.append(f"{r['in']:.0%}/{p}/{r['outrun']:.1f}")
        print(f"{name:20s} " + "  ".join(cells))


if __name__ == "__main__":
    main()
