#!/usr/bin/env python3
"""Modo Foco lab, test 17: from per-frame ball candidates (ball_detect.py) to ONE ball track, offline.

1. Shape: drop candidates bigger than 6% of the long side or longer than 2.5:1.
2. Still things out: a candidate with another candidate within still_r of the long side in >= still_share of the
   analysed frames within +-still_win is a ball lying, a lamp, a logo (detectors keep finding it); per sport (SPORT_P,
   test 35: basketball 0.5, the others 0.2).
3. Tracklets: candidates linked frame to frame (nearest first) within 8% of the long side per 100 ms of gap, a gap up to
   0.6 s; a tracklet needs 3 detections and must move (its points spread over >= 3% of the long side).
4. The ball per frame: the tracklet covering that frame with the highest sum of scores (a real ball in play is found
   again and again along a path; a false one flickers).
5. Back to the 100 ms grid (low_fps.upsample) and written as a oneclick-style track (lab/tests/oneclick/
   <clip>.ball.<tag>.json, [cx, cy, x, y, w, h, area, main] per frame) so hybrid.py / ball_gate.py frame and score it.

    python3 tools/lab/ball_track.py --det yolox-s-t5 [clip ...]
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import low_fps  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
ONECLICK = os.path.join(ev.ROOT, "lab", "tests", "oneclick")
P = dict(box_max=0.06, aspect_max=2.5, still_r=0.02, still_share=0.2, still_win=20, link=0.08, gap=6, min_len=3,
         min_spread=0.03, conf=0.05,
         # dp=1: the ball per frame by dynamic programming over all the candidates (best total score along a path that
         # moves like a ball: at most vmax long sides per 100 ms, a cost per long side moved, a frame without the ball
         # costs nothing), instead of the tracklets
         dp=1.0, s0=0.05, vmax=0.12, move_cost=1.0, dp_gap=10, still_cost=0.05,
         # test 39: dp=2 adds a motion model (the Kalman idea, offline): the state is (candidate, previous candidate), so
         # a step costs acc_cost x its distance from where the ball's velocity on the previous step would put it
         # (constant velocity; on top of move_cost x distance); only the dp_topk strongest candidates per frame.
         # fill=1: the frames a path skips (behind the railing, behind a player; at most dp_gap) get the straight line
         # between the two points around them (a smoother through the gap) instead of no ball.
         acc_cost=0.0, dp_topk=8, fill=0.0,
         # test 47b: screen=1 leaves out the candidates inside a video screen (screen_boxes); 0 = off
         screen=0.0,
         # test 47c: near > 0 weighs the candidates by where today's Modo Foco frames the play (its crop in the video's
         # own orientation, lab/tests/framing/<clip>.current.focus.json): a candidate more than `near` frame widths left
         # or right of that crop has its score x near_w (0 = dropped). Up and down are free (lobs). near_916=1: its 9:16
         # crop (the players' centre) instead. 0 = off: on the 19 own clips the native crop changes nothing (it spans
         # 70-90% of the width) and the 9:16 one costs cover (+0.1 x0.5: 90.6 -> 86.9%, b-01 98 -> 53%: today's framing
         # frames people off the rally in a class) for 6 fewer of 192 ball points shown far from a rally.
         near=0.0, near_w=0.5, near_916=0.0)
# test 35 (2026-11-08): per sport. Basketball with its own detector (tests 28/32): the still-object filter at 0.2 threw
# away the real ball while it was held or dribbled in place (13% of the labelled points); at 0.5 a spare ball, the rim
# or a painted ball (there on nearly every frame) are still left out. The other sports keep test 17's values for now.
# Test 46 (2026-11-09): beach tennis with its own detector (btpl): the still radius at 0.6% of the long side (~12 px at
# 1080p) instead of 2%: a ball lying on the sand is found within a few px of the same spot, while 2% (38 px) also caught
# the ball in play passing near one (16% of arena A's labelled points); share 0.3 (middle of the 0.004-0.01 / 0.2-0.4
# plateau). Path cover 69 -> 78% on arena A, 81 -> 85% on arena B before the trust change of hybrid.py (r_det).
SPORT_P = {"basquete": dict(still_share=0.5), "beachTennis": dict(still_r=0.006, still_share=0.3, screen=1.0)}
# Test 47b (2026-11-10, a tournament stream: the path followed round things inside the video on the venue's LED
# screen): a screen is a region whose content changes all the time and ALL AT ONCE (cuts, moving pictures), unlike the
# sand (never) or a player (part of a region at a time). On the clip's frames, 160 px wide, every 2nd 100 ms frame: a
# pixel is active when it changes by > 12 grey levels from the previous frame; a connected active region (>= 0.2% of
# the frame, active share > 0.12) is a screen when its bounding box is >= SCREEN_FILL active and >= half of the box
# changes at once on >= SCREEN_SYNC of the frame steps. Calibration (9 clips): the LED screen fill 0.85 / sync 0.19;
# players' regions fill <= 0.81 with sync <= 0.08 and sync <= 0.08 with fill <= 0.67. A screen's box is also >= SCREEN_AREA
# of the frame (the LED screen 3.4%; a strip at bt-own-b-08's right edge, 0.5%, passed fill and sync).
SCREEN_FILL, SCREEN_SYNC, SCREEN_AREA = 0.75, 0.12, 0.015
_SCREENS = {}


def play_span(clip, n, step, narrow=False):
    """Per 100 ms frame of the detections: (x0, x1) of today's Modo Foco crop in the video's own orientation (narrow:
    its 9:16 crop), or None."""
    p = os.path.join(ev.ROOT, "lab", "tests", "framing", f"{clip}.current.focus.json")
    if not os.path.exists(p):
        return None
    fc = json.load(open(p))
    if "stub" in fc:
        return None
    W, H = fc["size"]
    rows = fc["portrait"] if narrow else (fc["landscape"] if W >= H else fc["portrait"])
    meta = ev.clip_meta(clip)
    off = int(round((meta["startMs"] - fc["startMs"]) / fc["stepMs"]))
    out = []
    for k in range(n):
        j = off + k
        out.append((rows[j][0], rows[j][0] + rows[j][2]) if 0 <= j < len(rows) else None)
    return out


def screen_boxes(clip):
    """Video screens in the clip as [(x0, y0, x1, y1)] in 0..1 (lab/frames/<clip>/), cached; [] without frames."""
    if clip in _SCREENS:
        return _SCREENS[clip]
    import glob
    import cv2
    files = sorted(glob.glob(os.path.join(ev.ROOT, "lab", "frames", clip, "*.jpg")))[::2]
    boxes = []
    if len(files) >= 3:
        g = []
        for f in files:
            im = cv2.imread(f)
            h = int(im.shape[0] * 160 / im.shape[1])
            g.append(cv2.resize(im, (160, h), interpolation=cv2.INTER_AREA).astype(np.float32).mean(2))
        d = np.abs(np.diff(np.stack(g), axis=0)) > 12
        act = d.mean(0)
        H, W = act.shape
        n, _, st, _ = cv2.connectedComponentsWithStats((act > 0.12).astype(np.uint8), 8)
        for i in range(1, n):
            x, y, w, h, area = st[i]
            if area < 0.002 * W * H:
                continue
            fill = float((act[y:y + h, x:x + w] > 0.12).mean())
            sync = float((d[:, y:y + h, x:x + w].reshape(d.shape[0], -1).mean(1) > 0.5).mean())
            if fill >= SCREEN_FILL and sync >= SCREEN_SYNC and w * h >= SCREEN_AREA * W * H:
                boxes.append((float(x / W), float(y / H), float((x + w) / W), float((y + h) / H)))
    _SCREENS[clip] = boxes
    return boxes


def track(det, P):
    W, H = det["size"]
    L = max(W, H)
    frames = det["frames"]
    n = len(frames)
    step = det.get("step", 1)
    an = [k for k in range(n) if frames[k] is not None]
    screens = screen_boxes(det["clip"]) if P.get("screen") and det.get("clip") else []
    play = play_span(det["clip"], n, step, bool(P["near_916"])) if P.get("near") and det.get("clip") else None
    # 1. shape and score
    cand = {}
    for k in an:
        cs = []
        for cx, cy, w, h, s in frames[k]:
            wp, hp = w * W, h * H
            if s < P["conf"] or max(wp, hp) > P["box_max"] * L or max(wp, hp) / max(1e-6, min(wp, hp)) > P["aspect_max"]:
                continue
            if any(x0 <= cx <= x1 and y0 <= cy <= y1 for x0, y0, x1, y1 in screens):
                continue
            if play is not None and play[k] is not None and not (play[k][0] - P["near"] <= cx <= play[k][1] + P["near"]):
                if P["near_w"] <= 0:
                    continue
                s = s * P["near_w"]
            cs.append((cx, cy, w, h, s))
        cand[k] = cs
    # 2. still things
    def d(a, b):
        return math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H) / L
    moving = {}
    for k in an:
        near = [q for q in an if q != k and abs(q - k) <= P["still_win"]]
        keep = []
        for c in cand[k]:
            hits = sum(1 for q in near if any(d(c, o) <= P["still_r"] for o in cand[q]))
            if near and hits >= P["still_share"] * len(near):
                continue
            keep.append(c)
        moving[k] = keep
    if P["dp"] >= 2:
        return dp2_track(an, moving, W, H, n, step, P)
    if P["dp"]:
        return dp_track(an, moving, W, H, n, step, P)
    # 3. tracklets
    tracks = []  # each: {"pts": {k: cand}, "last": k}
    for k in an:
        open_ = [t for t in tracks if k - t["last"] <= P["gap"]]
        pairs = []
        for j, c in enumerate(moving[k]):
            for ti, t in enumerate(open_):
                lc = t["pts"][t["last"]]
                dist = d(c, lc)
                if dist <= P["link"] * (k - t["last"]):
                    pairs.append((dist, j, ti))
        used_c, used_t = set(), set()
        for dist, j, ti in sorted(pairs):
            if j in used_c or ti in used_t:
                continue
            used_c.add(j)
            used_t.add(ti)
            open_[ti]["pts"][k] = moving[k][j]
            open_[ti]["last"] = k
        for j, c in enumerate(moving[k]):
            if j not in used_c:
                tracks.append({"pts": {k: c}, "last": k})
    good = []
    for t in tracks:
        pts = list(t["pts"].values())
        if len(pts) < P["min_len"]:
            continue
        xs = [p[0] * W for p in pts]
        ys = [p[1] * H for p in pts]
        spread = max(max(xs) - min(xs), max(ys) - min(ys)) / L
        if spread < P["min_spread"]:
            continue
        t["score"] = sum(p[4] for p in pts)
        t["first"] = min(t["pts"])
        good.append(t)
    # 4. the ball per frame: the best tracklet covering it (its span), its own point or nothing in a gap
    chosen = {}
    for t in sorted(good, key=lambda t: -t["score"]):
        a, b = t["first"], t["last"]
        if any(k in chosen for k in range(a, b + 1) if k in t["pts"]):
            # a weaker tracklet only fills frames nobody claimed
            pass
        for k, c in t["pts"].items():
            if k not in chosen:
                chosen[k] = c
    pred = {}
    for k in an:
        c = chosen.get(k)
        if c is None:
            pred[k] = None
            continue
        cx, cy, w, h, s = c
        pred[k] = [cx, cy, cx - w / 2, cy - h / 2, w, h, round(math.pi / 4 * w * h, 7), 1.0, s]
    off = an[0] % step if an else 0
    return low_fps.upsample(pred, n, step, off) if step > 1 else pred, len(good)


def dp_track(an, moving, W, H, n, step, P):
    """Viterbi over the analysed frames: state = (frame, candidate); a path may skip up to dp_gap 100 ms frames
    (frames without the ball). Gain = score - s0 per frame on the ball, minus move_cost x distance (long sides), minus
    still_cost when it does not move (a ball in play moves); a jump above vmax x gap is not allowed."""
    L = max(W, H)
    nodes = [(k, j) for k in an for j in range(len(moving[k]))]
    best, back = {}, {}
    idx = {k: i for i, k in enumerate(an)}
    for k in an:
        for j, c in enumerate(moving[k]):
            g = c[4] - P["s0"]
            b, bp = g, None  # start a path here
            i = idx[k]
            for q in an[max(0, i - int(P["dp_gap"] / step) - 1):i]:
                if k - q > P["dp_gap"]:
                    continue
                for jj, cc in enumerate(moving[q]):
                    if (q, jj) not in best:
                        continue
                    d = math.hypot((c[0] - cc[0]) * W, (c[1] - cc[1]) * H) / L
                    if d > P["vmax"] * (k - q):
                        continue
                    v = best[(q, jj)] + g - P["move_cost"] * d - (P["still_cost"] if d < 0.005 * (k - q) else 0)
                    if v > b:
                        b, bp = v, (q, jj)
            best[(k, j)] = b
            back[(k, j)] = bp
    # the best path ends anywhere; then the remaining frames get the next best disjoint paths (several rallies)
    chosen = {}
    used = set()
    links = []
    while True:
        cands = [(v, key) for key, v in best.items() if key not in used and key[0] not in chosen]
        if not cands:
            break
        v, key = max(cands)
        if v <= 0.5:
            break
        path = []
        while key is not None and key not in used and key[0] not in chosen:
            path.append(key)
            key = back[key]
        if len(path) < P["min_len"]:
            for kk in path:
                used.add(kk)
            continue
        for kk in path:
            chosen[kk[0]] = moving[kk[0]][kk[1]]
            used.add(kk)
        fr = sorted(kk[0] for kk in path)
        links += [(a, b) for a, b in zip(fr, fr[1:]) if b - a > step]
        # nodes of frames now taken can no longer be used
        for key2 in list(best):
            if key2[0] in chosen:
                used.add(key2)
    return finish(an, chosen, n, step, P, links)


def finish(an, chosen, n, step, P, links=()):
    """chosen {analysed frame: candidate} -> the track; links: (a, b) frames a path joins directly over a gap."""
    pred = {}
    for k in an:
        c = chosen.get(k)
        if c is None:
            pred[k] = None
            continue
        cx, cy, w, h, s = c
        pred[k] = [cx, cy, cx - w / 2, cy - h / 2, w, h, round(math.pi / 4 * w * h, 7), 1.0, s]
    if P.get("fill"):
        for a, b in links:
            ca, cb = chosen[a], chosen[b]
            for k in an:
                if a < k < b and pred.get(k) is None:
                    f = (k - a) / (b - a)
                    cx, cy = ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f
                    w, h = ca[2] + (cb[2] - ca[2]) * f, ca[3] + (cb[3] - ca[3]) * f
                    pred[k] = [cx, cy, cx - w / 2, cy - h / 2, w, h, round(math.pi / 4 * w * h, 7), 1.0, 0.0]
    off = an[0] % step if an else 0
    return (low_fps.upsample(pred, n, step, off) if step > 1 else pred), len(chosen)


def dp2_track(an, moving, W, H, n, step, P):
    """Test 39: Viterbi with a constant-velocity motion model. State = (node, previous node) on the path; gain as
    dp_track, minus acc_cost x the distance between the candidate and the point the previous step's velocity
    predicts."""
    L = max(W, H)
    cand = {k: sorted(moving[k], key=lambda c: -c[4])[: int(P["dp_topk"])] for k in an}
    idx = {k: i for i, k in enumerate(an)}

    def dist(a, b):
        return math.hypot((a[0] - b[0]) * W, (a[1] - b[1]) * H) / L

    best, back = {}, {}  # (node, prev node or None) -> value, previous state
    states = {}  # node -> [(state, value)] of the states ending in it
    for k in an:
        i = idx[k]
        prevs = [q for q in an[max(0, i - int(P["dp_gap"] / step) - 1):i] if k - q <= P["dp_gap"]]
        for j, c in enumerate(cand[k]):
            g = c[4] - P["s0"]
            node = (k, j)
            best[(node, None)] = g
            back[(node, None)] = None
            for q in prevs:
                for jj, cc in enumerate(cand[q]):
                    pn = (q, jj)
                    d = dist(c, cc)
                    if d > P["vmax"] * (k - q):
                        continue
                    step_cost = P["move_cost"] * d + (P["still_cost"] if d < 0.005 * (k - q) else 0)
                    bv, bs = None, None
                    for st, v0 in states.get(pn, ()):
                        pp = st[1]
                        if pp is None:
                            acc = 0.0
                        else:
                            cp = cand[pp[0]][pp[1]]
                            t0 = q - pp[0]
                            px = cc[0] + (cc[0] - cp[0]) * (k - q) / t0
                            py = cc[1] + (cc[1] - cp[1]) * (k - q) / t0
                            acc = dist(c, (px, py))
                        v = v0 + g - step_cost - P["acc_cost"] * acc
                        if bv is None or v > bv:
                            bv, bs = v, st
                    if bv is None:
                        continue
                    best[(node, pn)] = bv
                    back[(node, pn)] = bs
        for j in range(len(cand[k])):
            node = (k, j)
            states[node] = [((node, pn), best[(node, pn)])
                            for pn in [None] + [(q, jj) for q in prevs for jj in range(len(cand[q]))]
                            if (node, pn) in best]
    chosen, links, used = {}, [], set()
    while True:
        cs = [(v, st) for st, v in best.items() if st not in used and st[0][0] not in chosen]
        if not cs:
            break
        v, st = max(cs)
        if v <= 0.5:
            break
        path = []
        while st is not None and st[0][0] not in chosen and st not in used:
            path.append(st[0])
            used.add(st)
            st = back[st]
        if len(path) < P["min_len"]:
            continue
        path.reverse()
        for a, b in zip(path, path[1:]):
            if b[0] - a[0] > step:
                links.append((a[0], b[0]))
        for nd in path:
            chosen[nd[0]] = cand[nd[0]][nd[1]]
        for st2 in list(best):
            if st2[0][0] in chosen:
                used.add(st2)
    return finish(an, chosen, n, step, P, links)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", required=True, help="ball_detect.py tag")
    ap.add_argument("--tag", default=None, help="output track tag (default det-<det>)")
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    for item in a.set:
        k, _, v = item.partition("=")
        P[k] = type(P[k])(float(v))
    tag = a.tag or f"det-{a.det}"
    forced = {item.partition("=")[0] for item in a.set}
    base = dict(P)
    for name in a.clips:
        P.clear()
        P.update(base)
        for k, v in SPORT_P.get(ev.clip_meta(name)["sport"], {}).items():
            if k not in forced:  # --set wins
                P[k] = v
        p = os.path.join(DET, f"{name}.{a.det}.json")
        if not os.path.exists(p):
            print(name, "no detections")
            continue
        det = json.load(open(p))
        pred, ntr = track(det, P)
        n = len(det["frames"])
        json.dump({"clip": name, "mode": "ball", "frames": n, "fps": 10, "source": f"ball_track.py {a.det}",
                   "params": P, "pred_one": {str(k): pred.get(k) for k in range(n)}},
                  open(os.path.join(ONECLICK, f"{name}.ball.{tag}.json"), "w"), separators=(",", ":"))
        has = sum(1 for v in pred.values() if v is not None)
        print(f"{name}: {ntr} tracklets, ball in {100 * has / max(n, 1):.0f}% of frames -> {tag}")


if __name__ == "__main__":
    main()
