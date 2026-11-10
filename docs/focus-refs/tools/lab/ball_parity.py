#!/usr/bin/env python3
"""Seguir a Bola (spec 2026-11-09 §5): parity fixtures for the app's Swift port (ReplayCore BallPath / BallTrust /
BallCamera / BallZoom). For a few clips it writes the lab's inputs (the detector's candidates, today's Modo Foco
framing) and the lab's outputs (the ball path, the trusted points, camera C's 9:16 rects at the clip's zoom, and the
zoom of test 31's rule) into one JSON the Swift tests replay.

The camera and the zoom below are story.camera / story.auto_zoom on arrays (the same code, fed the given track instead
of a file); `check` asserts they still match story.py on each clip.

    python3 tools/lab/ball_parity.py --out ../../app/modules/replay-camera/ios/Core/Tests/ReplayCoreTests/Fixtures/ball-parity.json
    python3 tools/lab/ball_parity.py --out-bt ../../app/modules/replay-camera/ios/Core/Tests/ReplayCoreTests/Fixtures/ball-parity-bt.json
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
import cam_bt  # noqa: E402

# (clip, detections tag): our gym (held-out half-models), another court, a web clip
CLIPS = [("basket-app-1107-a", "bgym-n5"), ("basket-app-1107-d", "bgym-n5"), ("basket-ext-1109-b", "bgymall-n5"),
         ("yt1105-basket-a", "bgymX-n5")]
# Tests 46-49 (beach tennis, its own fixture file; basketball's above is unchanged): the next court (a-02), balls on
# the sand and short runs (b-02), a vertical clip and its zoom rule (yt-bt-06), a video screen (the stream), a clip the
# verdict turns down (bt-v-1029, recorded at 0.5x: the ball too small).
BT_CLIPS = [("bt-own-a-02", "btplA-n5"), ("bt-own-b-02", "btplB-n5"), ("yt-bt-06", "btplB-n5"),
            ("yt-bt-stream-1110", "btplB-n5"), ("bt-v-1029", "btplB-n5"),
            # Test 49: the next court's ball joined to the rally (a-10) and after the point (f-01), dropped by the
            # court lock of the main players
            ("bt-own-a-10", "btplA-n5"), ("bt-own-f-01", "btplB-n5"),
            # Test 49d: the rally's ball leaves the picture and the next court's volleyball is dropped by the ball's
            # own court lock
            ("bt-own-b-04", "btplB-n5"),
            # Test 49e: a lob goes out at the top and the path takes the next court's ball mid-frame
            ("bt-app-1110-f", "btpl-n5")]


def camera_rects(tr, today, W, H, zoom, smooth=None, aim=None):
    """story.camera for camera C on a trusted track `tr` (per 100 ms: (x, y) or None) and today's portrait rows.
    `smooth`: (a, b) instead of camera C's; `aim`: the target x per frame instead of the ball's (test 49)."""
    n = len(tr)
    wmax = min(1.0, (9 / 16) * H / W)
    hmax = min(1.0, (16 / 9) * W / H)
    w, h = wmax / zoom, hmax / zoom
    dz, a, b = story.CAMS["C"]
    if smooth is not None:
        a, b = smooth
    isball = np.array([p is not None for p in tr])
    cx0 = today[:, 0] + today[:, 2] / 2
    cy0 = today[:, 1] + today[:, 3] / 2
    rects = np.zeros((n, 4))
    rects[:, 2], rects[:, 3] = w, h
    tx = sg.target_x([None if p is None else p[0] for p in tr] if aim is None else aim, cx0, 10, "hold")
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
              min_share=0.35, cam_tr=None):
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
        r = camera_rects(tr if cam_tr is None else cam_tr, today, W, H, float(z))
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


_LOAD_TRUTH = ev.load_truth


def truth_or_empty(name, *args, **kw):
    """The clip's labels, or none (a clip without labels still has a size and a start)."""
    try:
        return _LOAD_TRUTH(name, *args, **kw)
    except FileNotFoundError:
        m = ev.clip_meta(name)
        return {"samples": {}, "size": m["size"], "startMs": m["startMs"], "video": m["video"], "prompts": []}


def bt_case(name, tag):
    """A beach tennis case: SPORT_P["beachTennis"] (still filter, screens), trusted, the camera's runs (story.RUN_SPORT),
    the sport's zoom (story.sport_zoom) and the verdict (ball_verdict) on arrays."""
    import ball_verdict as bv
    det = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "detect", f"{name}.{tag}.json")))
    meta = ev.clip_meta(name)
    sport = meta["sport"]
    P = dict(bt.P)
    P.update(bt.SPORT_P[sport])
    screens = bt.screen_boxes(name) if P.get("screen") else []
    pred, _ = bt.track(det, P)
    n = meta["count"]
    real = ev.load_truth
    ev.load_truth = truth_or_empty
    try:
        label_size = ev.load_truth(name)["size"]
        _, _, today, n2, W, H, orient = story.load(name)
    finally:
        ev.load_truth = real
    tr = hybrid.trusted({str(k): v for k, v in pred.items()}, n, label_size, sport)
    run = story.RUN_SPORT[sport]
    runs = story.keep_runs(tr, run["min_run"], run["gap"])
    # Test 49: the court lock by the main players, and the aim between the ball and the hitter (cam_bt.T49)
    people = cam_bt.people_rows(name, n)
    main = cam_bt.main_players(people)
    ball_court = cam_bt.keep_court(runs, cam_bt.T49["court"], run["gap"])
    players_court = cam_bt.keep_players_court(ball_court, main, cam_bt.T49["courtp"])
    T = cam_bt.T49
    cands = cam_bt.moving_candidates(det["frames"], screens, T["smin"])
    fol = cam_bt.keep_exits(players_court, T["exit"], cam_bt.BASE["back"], cam_bt.BASE["dx"], cands, T["step"],
                            aspect=H / W)
    fc = json.load(open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")))
    native = np.array(fc["landscape" if orient == "landscape" else "portrait"], dtype=float)
    assert n2 == n, (name, n2, n)
    zs = story.ZOOM_SPORT[sport]
    if orient == "landscape":
        zoom, parts = zs["landscape"], {}
    else:
        zoom, parts = auto_zoom(tr, today, native, W, H, False, max_upscale=zs["max_upscale_v"],
                                factor_v=zs["factor_v"], cam_tr=fol)
    aim = cam_bt.aim_x(fol, main, W, H, cam_bt.T49["blend"], cam_bt.BASE["near"])
    crop_w = min(1.0, (9 / 16) * H / W) / zoom
    near_only = [None if p is None else cam_bt.hitter(p, sorted(main[k], key=lambda b: -b[3])[:2], W, H, T["pairnear"])
                 for k, p in enumerate(fol)]
    aim = cam_bt.keep_pair(aim, fol, main, crop_w, T["pairpad"], int(T["pair"]), near_only)
    aim = cam_bt.glide(aim, fol, main, int(T["glide"]), T["courtp"])
    rects = camera_rects(fol, today, W, H, zoom, smooth=(cam_bt.T49["a"], cam_bt.T49["b"]), aim=aim)
    # the verdict on these arrays (ball_verdict.verdict)
    lim = bv.VERDICT[sport]
    h = bv.players_height(name)
    zmax = zs["landscape"] if orient == "landscape" else max(1.0, min(W, (9 / 16) * H) * zs["max_upscale_v"] / 1080.0)
    players = None if h is None else h * zmax
    share = float(np.mean([p is not None for p in fol]))
    sizes = [max(pred[k][4] * W, pred[k][5] * H) for k in range(n) if fol[k] is not None and pred.get(k)]
    src_w = int(round(float(np.mean(rects[:, 2])) * W))
    ball_px = float(np.median(sizes)) * 1080.0 / src_w if sizes else 0.0
    cx = rects[:, 0] + rects[:, 2] / 2
    pan = float(np.sum(np.abs(np.diff(cx)) / rects[1:, 2])) / (n / 100.0)
    if players is not None and players < lim["players_min"]:
        reason = "tooFar"
    elif share < lim["share_min"]:
        reason = "rarelyFound"
    elif ball_px < lim["ball_px_min"]:
        reason = "tooSmall"
    elif pan < lim["pan_min"]:
        reason = "still"
    else:
        reason = None
    r = lambda v: round(float(v), 7)  # noqa: E731
    return {
        "clip": name, "sport": sport, "detTag": tag, "params": {k: P[k] for k in sorted(P)},
        "detSize": det["size"], "step": det.get("step", 1), "labelSize": label_size, "videoSize": [W, H],
        "frames": det["frames"], "screens": [[r(x) for x in b] for b in screens],
        "playersHeight": h,
        "people": [[[r(x) for x in b] for b in row] for row in people],
        "todayPortrait": [[r(x) for x in row] for row in today.tolist()],
        "todayNative": [[r(x) for x in row] for row in native.tolist()],
        "expect": {
            "track": [None if pred.get(k) is None else [r(pred[k][0]), r(pred[k][1]), r(pred[k][4]), r(pred[k][5]),
                                                         r(pred[k][8])] for k in range(n)],
            "trusted": [None if p is None else [r(p[0]), r(p[1])] for p in tr],
            "runs": [None if p is None else [r(p[0]), r(p[1])] for p in runs],
            "ballCourt": [None if p is None else [r(p[0]), r(p[1])] for p in ball_court],
            "playersCourt": [None if p is None else [r(p[0]), r(p[1])] for p in players_court],
            "followed": [None if p is None else [r(p[0]), r(p[1])] for p in fol],
            "aim": [None if x is None else r(x) for x in aim],
            "zoom": zoom, "zoomParts": {k: r(v) for k, v in parts.items()},
            "rects": [[r(x) for x in row] for row in rects.tolist()],
            "verdict": {"reason": reason, "players": None if players is None else r(players), "share": r(share),
                        "ballPx": r(ball_px), "pan": r(pan)},
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
    ap.add_argument("--out-bt", help="the beach tennis fixture file (tests 46-47)")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    if a.out_bt:
        cases = [bt_case(c, t) for c, t in BT_CLIPS]
        with open(a.out_bt, "w") as f:
            json.dump({"source": "docs/focus-refs/tools/lab/ball_parity.py --out-bt (Modo Foco lab, tests 46-49)",
                       "cases": cases}, f, separators=(",", ":"))
        for c in cases:
            e = c["expect"]
            print(c["clip"], "zoom", e["zoom"], "screens", c["screens"], "trusted",
                  sum(p is not None for p in e["trusted"]), "followed", sum(p is not None for p in e["followed"]),
                  "verdict", e["verdict"])
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
