#!/usr/bin/env python3
"""Seguir a Bola (spec 2026-11-09 §5): parity fixtures for the app's Swift port (ReplayCore BallPath / BallTrust /
BallCamera / BallZoom). For a few clips it writes the lab's inputs (the detector's candidates, today's Modo Foco
framing) and the lab's outputs (the ball path, the trusted points, camera C's 9:16 rects at the clip's zoom, and the
zoom of test 31's rule) into one JSON the Swift tests replay.

The camera and the zoom below are story.camera / story.auto_zoom on arrays (the same code, fed the given track instead
of a file); `check` asserts they still match story.py on each clip.

    python3 tools/lab/ball_parity.py --out ../../app/modules/replay-camera/ios/Core/Tests/ReplayCoreTests/Fixtures/ball-parity.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_track as bt  # noqa: E402
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402
import sg_lazy3 as l3  # noqa: E402
import story  # noqa: E402

# (clip, detections tag): our gym (held-out half-models), another court, a web clip
CLIPS = [("basket-app-1107-a", "bgym-n5"), ("basket-app-1107-d", "bgym-n5"), ("basket-ext-1109-b", "bgymall-n5"),
         ("yt1105-basket-a", "bgymX-n5")]


def camera_rects(tr, today, W, H, zoom):
    """story.camera for camera C on a trusted track `tr` (per 100 ms: (x, y) or None) and today's portrait rows."""
    n = len(tr)
    wmax = min(1.0, (9 / 16) * H / W)
    hmax = min(1.0, (16 / 9) * W / H)
    w, h = wmax / zoom, hmax / zoom
    dz, a, b = story.CAMS["C"]
    isball = np.array([p is not None for p in tr])
    cx0 = today[:, 0] + today[:, 2] / 2
    cy0 = today[:, 1] + today[:, 3] / 2
    rects = np.zeros((n, 4))
    rects[:, 2], rects[:, 3] = w, h
    tx = sg.target_x([None if p is None else p[0] for p in tr], cx0, 10, "hold")
    if w < 0.999:
        cx = l3.band_path(tx - dz * w, tx + dz * w, np.where(isball, 1.0, l3.WFB), cx0, 0.0, a, b)
    else:
        cx = np.full(n, 0.5)
    rects[:, 0] = np.clip(cx, w / 2, 1 - w / 2) - w / 2
    if h < 0.999:
        by = l3.bridged([None if p is None else p[1] for p in tr])
        lo = np.array([-np.inf if v is None else v - (0.5 - l3.BOTTOM) * h for v in by])
        hi = np.array([np.inf if v is None else v + (0.5 - l3.TOP) * h for v in by])
        cy = l3.band_path(lo, hi, np.ones(n), cy0, l3.WA, a, b)
    else:
        cy = np.full(n, 0.5)
    rects[:, 1] = np.clip(cy, h / 2, 1 - h / 2) - h / 2
    return rects


def auto_zoom(tr, today, native, W, H, landscape, max_upscale=2.2, factor_h=1.0, factor_v=1.2, miss=0.03,
              min_share=0.35):
    """story.auto_zoom on arrays: min(content, quality, ball safety) with the guard."""
    wmax_px = min(W, (9 / 16) * H)
    z_quality = max(1.0, wmax_px * max_upscale / 1080.0)
    today_z = float(np.median(1 / np.maximum(native[:, 2], native[:, 3])))
    z_content = max(1.0, today_z * (factor_h if landscape else factor_v))
    top = min(z_quality, z_content)
    share = float(np.mean([p is not None for p in tr]))
    if share < min_share:
        safe = 1.0 if landscape else max(1.0, today_z)
        top = min(top, safe)
    pts = [(i, p) for i, p in enumerate(tr) if p is not None]
    z_ball = 1.0
    for z in np.arange(1.0, top + 1e-6, 0.05):
        r = camera_rects(tr, today, W, H, float(z))
        out = sum(1 for i, p in pts if not (r[i, 0] <= p[0] <= r[i, 0] + r[i, 2] and r[i, 1] <= p[1] <= r[i, 1] + r[i, 3]))
        if (out / len(pts) if pts else 0.0) <= miss:
            z_ball = float(z)
        else:
            break
    z = min(top, z_ball) if z_ball < top else top
    return round(z, 2), {"content": z_content, "quality": z_quality, "ball": z_ball, "share": share}


def case(name, tag):
    det = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "detect", f"{name}.{tag}.json")))
    meta = ev.clip_meta(name)
    P = dict(bt.P)
    P.update(bt.SPORT_P.get(meta["sport"], {}))
    saved = dict(bt.P)
    bt.P.clear()
    bt.P.update(P)
    try:
        pred, _ = bt.track(det, bt.P)
    finally:
        bt.P.clear()
        bt.P.update(saved)
    n = meta["count"]
    label_size = ev.load_truth(name)["size"]
    tr = hybrid.trusted({str(k): v for k, v in pred.items()}, n, label_size, meta["sport"])
    _, _, today, n2, W, H, orient = story.load(name)
    fc = json.load(open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")))
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    native = np.array(fc["landscape" if orient == "landscape" else "portrait"], dtype=float)
    assert n2 == n, (name, n2, n)
    zoom, parts = auto_zoom(tr, today, native, W, H, orient == "landscape")
    rects = camera_rects(tr, today, W, H, zoom)
    r = lambda v: round(float(v), 7)  # noqa: E731
    return {
        "clip": name, "detTag": tag, "params": {k: P[k] for k in sorted(P)},
        "detSize": det["size"], "step": det.get("step", 1), "labelSize": label_size, "videoSize": [W, H],
        "frames": det["frames"],
        "todayPortrait": [[r(x) for x in row] for row in today.tolist()],
        "todayNative": [[r(x) for x in row] for row in native.tolist()], "todayNativeOffset": off,
        "expect": {
            "track": [None if pred.get(k) is None else [r(pred[k][0]), r(pred[k][1]), r(pred[k][4]), r(pred[k][5]),
                                                         r(pred[k][8])] for k in range(n)],
            "trusted": [None if p is None else [r(p[0]), r(p[1])] for p in tr],
            "zoom": zoom, "zoomParts": {k: r(v) for k, v in parts.items()},
            "rects": [[r(x) for x in row] for row in rects.tolist()],
        },
    }


def check():
    """camera_rects / auto_zoom here == story.camera / story.auto_zoom on the clips' own tracks."""
    for name, tag in CLIPS:
        track_tag = {"bgym-n5": "det-t38-bgym", "bgymall-n5": "det-t40-bgymall", "bgymX-n5": "det-t39o-base"}[tag]
        meta, truth, n, ref, W, H, _ = story.camera(name, "C", 1.2, track_tag)
        oc = json.load(open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{track_tag}.json")))
        tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
        mine = camera_rects(tr, story.load(name)[2], W, H, 1.2)
        print(name, "camera max diff vs story.camera:", float(np.abs(mine - ref).max()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.check:
        check()
    if a.out:
        cases = [case(c, t) for c, t in CLIPS]
        with open(a.out, "w") as f:
            json.dump({"source": "docs/focus-refs/tools/lab/ball_parity.py (Modo Foco lab, tests 35-42)",
                       "cases": cases}, f, separators=(",", ":"))
        for c in cases:
            e = c["expect"]
            print(c["clip"], "zoom", e["zoom"], {k: round(v, 3) for k, v in e["zoomParts"].items()},
                  "ball frames", sum(p is not None for p in e["track"]), "trusted", sum(p is not None for p in e["trusted"]))


if __name__ == "__main__":
    main()
