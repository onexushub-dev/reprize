#!/usr/bin/env python3
"""Modo Foco lab, test 49b (2026-11-10): beach tennis camera variants for Seguir a Bola. Victor: in beach tennis the
ball crosses the court fast and is rarely in a player's hands, so following the ball as closely as in basketball cuts
the player about to hit it (seen with the camera on the court's diagonals). Variants of story camera C:
  dz    dead zone around the target, share of the crop width (C: 0.10)
  a, b  smoothing, first and second differences (C: 3, 300; camera A: 10, 1000)
  lead  aim where the target will be `lead` 100 ms frames later (the analysis is offline, the future is known)
  blend aim between the ball and the main player nearest to it (0 = the ball, 0.5 = halfway)

Scores per clip (no labels needed except `ball`): ball in the crop (labels, when the clip has them), the followed ball
points in the crop, the HITTER fully inside the crop (the main player nearest to the ball when the ball is near a
player, and at the hits: the frames where the ball turns), and the pan on screen (crop widths per 10 s) with its
95th-percentile speed. Main players: Vision boxes (renders/<clip>.people.json, tiled) at least 0.6 of the clip's
80th-percentile box height (the near court; the next court's people are smaller).

    python3 tools/lab/cam_bt.py --track det-t49-btpl clip ... --var "C:" --var "calm:dz=0.2,a=10,b=1000" ...
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
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402
import sg_lazy2 as l2  # noqa: E402
import sg_lazy3 as l3  # noqa: E402
import story  # noqa: E402

MAIN_SHARE = 0.6
# Test 49 as shipped for beach tennis (the app's BallSport.beachTennis camera): 49b-c + the ball's court lock (49d)
# and the near pair kept whole where the ball allows (49c, Victor's choice after the long rallies), and a ball
# gone out at the top only taken back at the top (49e), our ball looked for among the candidates meanwhile, the
# target going on the ball's way where it is lost, the pair kept only near it (49f; 1x, Victor)
T49 = dict(blend=0.4, a=1.0, b=100.0, courtp=0.2, court=0.25, pair=1.0, pairpad=0.0,
           exit=0.05, own=1.0, smin=0.5, step=0.08, pairnear=0.25, glide=6.0)
# Test 52 as shipped (Victor, 2026-11-11): T49f + a faster camera and the player about to hit kept whole (the path's
# head rule is ball_track.SPORT_P["beachTennis"]).
T52 = dict(T49, a=0.3, b=30.0, hitbox=2.0, horizon=10.0, hitpad=0.02)
BASE = dict(dz=0.10, a=3.0, b=300.0, lead=0, blend=0.0, near=0.25, court=0.0, courtp=0.0, pair=0.0, pairpad=0.03, exit=0.0,
            back=0.2, dx=0.25, own=0.0, smin=0.5, step=0.08, hitall=0.0,
            pairnear=0.0, glide=0.0,
            # test 52: hitbox 1 = keep the next hitter whole where the ball allows, 2 = even if the ball leaves; horizon
            # frames ahead; hitpad crop widths around the player
            hitbox=0.0, horizon=10.0, hitpad=0.02)


def runs_of(tr, gap=4):
    """(first, last) frames of the runs of points (a run ends where the next point is more than `gap` frames away)."""
    out, start, last = [], None, None
    for k, p in enumerate(tr):
        if p is None:
            continue
        if start is None or k - last > gap:
            if start is not None:
                out.append((start, last))
            start = k
        last = k
    if start is not None:
        out.append((start, last))
    return out


def moving_candidates(frames, screens, smin, still=0.01):
    """Per frame, the detector's candidates (x, y) with score >= smin, not inside a video screen and not still (no
    candidate within `still` at the previous or next analysed frame: lamps, logos, balls lying on the sand)."""
    n = len(frames)
    keyed = [k for k in range(n) if frames[k] is not None]
    out = [[] for _ in range(n)]
    for i, k in enumerate(keyed):
        nb = [frames[keyed[j]] for j in (i - 1, i + 1) if 0 <= j < len(keyed)]
        for c in frames[k]:
            if c[4] < smin:
                continue
            if any(x0 <= c[0] <= x1 and y0 <= c[1] <= y1 for x0, y0, x1, y1 in screens):
                continue
            if any(abs(d[0] - c[0]) <= still and abs(d[1] - c[1]) <= still for f in nb for d in f):
                continue
            out[k].append((c[0], c[1]))
    return out


def keep_exits(tr, top, back=0.2, dx=0.25, cands=None, step=0.08, lost=4, aspect=1.0):
    """Test 49e: a ball that goes out at the top can only come back at the top. A point still rising that, at its speed,
    is within `top` of the top edge 2 frames later is going out; the points after it are dropped until one is back
    within `back` of the top edge and `dx` frame widths of where it went out. (bt-app-1110-f: a lob leaves the picture
    and the path takes the next court's ball, mid-frame, until ours comes down.) 0 = off.

    49f, `cands` (per frame, the detector's moving candidates): while the path is dropped, our ball is looked for among
    them: one back at the top (within `back`, `dx` from where it went out) is taken, then followed from candidate to
    candidate (the nearest within `step` long sides per 100 ms frame, at most 2 frames' worth; `aspect` = height / width
    of the picture). Going out at the top again, or `lost` frames without it, it is looked for at the top again, from
    where it was last seen. The path is taken back where it comes back at the top near our ball."""
    if top <= 0:
        return tr
    sx, sy = (1.0, aspect) if aspect <= 1 else (1.0 / aspect, 1.0)  # 0..1 coordinates -> long sides
    dist = lambda a, b: math.hypot((a[0] - b[0]) * sx, (a[1] - b[1]) * sy)  # noqa: E731

    def going_out(q, kq, c, kc):
        vy = (c[1] - q[1]) / (kc - kq)
        return vy < -0.01 and c[1] + 2 * vy < top

    out = list(tr)
    state, gx, prev, own = "path", 0.0, None, None  # own = (frame, (x, y))
    for k, p in enumerate(tr):
        if state != "path":
            ref = gx if state == "gone" else own[1][0]
            if p is not None and p[1] <= back and abs(p[0] - ref) <= dx:
                state, own = "path", None  # back: checked below like any path point (it may be going out again)
        if state == "path":
            if p is not None:
                if prev is not None and k - prev <= 2 and going_out(tr[prev], prev, p, k):
                    state, gx = "gone", p[0]
                prev = k
            continue
        out[k] = None
        if cands is None:
            continue
        if state == "own" and k - own[0] > lost:
            state, gx, own = "gone", own[1][0], None
        if state == "gone":
            ok = [c for c in cands[k] if c[1] <= back and abs(c[0] - gx) <= dx]
            if ok:
                c = min(ok, key=lambda c: abs(c[0] - gx))
                state, own, out[k] = "own", (k, c), c
        else:
            ok = [c for c in cands[k] if dist(c, own[1]) <= step * min(k - own[0], 2)]
            if ok:
                c = min(ok, key=lambda c: dist(c, own[1]))
                out[k] = c
                if going_out(own[1], own[0], c, k):
                    state, gx, own = "gone", c[0], None
                else:
                    own = (k, c)
    return out


def keep_players_court(tr, people, margin):
    """Test 49a, by the players: the court is where the main players are (the 5-95% of their box centres' x over the
    clip); a ball point more than `margin` frame widths outside is another court's. 0 = off."""
    if margin <= 0:
        return tr
    xs = [b[0] + b[2] / 2 for row in people for b in row]
    if len(xs) < 20:
        return tr
    lo, hi = float(np.percentile(xs, 5)) - margin, float(np.percentile(xs, 95)) + margin
    return [p if p is None or lo <= p[0] <= hi else None for p in tr]


def keep_court(tr, margin, gap=4):
    """Test 49a: the longest run (the rally) gives the court's x range (its points' 5-95%); a run whose median x, or a
    point whose x, is more than `margin` frame widths outside that range is another court's ball and is dropped.
    0 = off."""
    if margin <= 0:
        return tr
    rs = runs_of(tr, gap)
    if len(rs) < 2:
        return tr
    count = lambda r: sum(1 for k in range(r[0], r[1] + 1) if tr[k] is not None)  # noqa: E731
    main = max(rs, key=count)
    xs = [tr[k][0] for k in range(main[0], main[1] + 1) if tr[k] is not None]
    lo, hi = float(np.percentile(xs, 5)) - margin, float(np.percentile(xs, 95)) + margin
    out = list(tr)
    for r in rs:
        if r == main:
            continue
        mx = float(np.median([tr[k][0] for k in range(r[0], r[1] + 1) if tr[k] is not None]))
        if not lo <= mx <= hi:
            for k in range(r[0], r[1] + 1):
                out[k] = None
    # points too: another court's ball found right after a point is often joined to the rally's run (a-02, a-10)
    for k, p in enumerate(out):
        if p is not None and not lo <= p[0] <= hi:
            out[k] = None
    return out


def people_rows(name, n):
    """Per 100 ms frame of the clip: every person box [x, y, w, h] (0..1, top-left) Vision found ("tiled", the app's
    detector: whole frame + ScanTiles, merged), as the app's Modo Foco file keeps them ("people")."""
    p = os.path.join(ev.ROOT, "renders", f"{name}.people.json")
    rows = [[] for _ in range(n)]
    if not os.path.exists(p):
        return rows
    d = json.load(open(p))
    meta = ev.clip_meta(name)
    for s in d["samples"]:
        k = int(round((s["t"] - meta["startMs"]) / 100))
        if 0 <= k < n:
            rows[k] = [b[:4] for b in s.get("tiled", [])]
    return rows


def main_players(rows, share=MAIN_SHARE):
    """The main players: boxes at least `share` of the 80th-percentile box height over the clip (the players on the
    court, not the people around it)."""
    hs = [b[3] for row in rows for b in row]
    if not hs:
        return [[] for _ in rows]
    hmin = share * float(np.percentile(hs, 80))
    return [[b for b in row if b[3] >= hmin] for row in rows]


def players(name, n):
    """Per 100 ms frame: the main players' boxes [x, y, w, h] (0..1, top-left), from Vision."""
    return main_players(people_rows(name, n))


def aim_x(tr, people, W, H, blend, near):
    """Test 49b: the camera's target x per frame, between the ball and the main player nearest to it (`hitter`)."""
    xs = [None if p is None else p[0] for p in tr]
    if blend <= 0:
        return xs
    for k, p in enumerate(tr):
        hb = hitter(p, people[k], W, H, near)
        if hb is not None and xs[k] is not None:
            xs[k] = (1 - blend) * xs[k] + blend * (hb[0] + hb[2] / 2)
    return xs


def hitter(ball, boxes, W, H, near):
    """The main player nearest to the ball (centre distance in long sides), if within `near`."""
    if ball is None or not boxes:
        return None
    L = max(W, H)
    best = None
    for b in boxes:
        cx, cy = b[0] + b[2] / 2, b[1] + b[3] / 2
        d = math.hypot((cx - ball[0]) * W, (cy - ball[1]) * H) / L
        if best is None or d < best[0]:
            best = (d, b)
    return best[1] if best and best[0] <= near else None


def glide(xs, tr, people, frames, margin):
    """49f: where the ball is lost in flight, the target keeps going the way the ball was going for up to `frames`
    frames (its x speed from its last two points), within the main players' court (5-95% of their x, +- `margin`), so
    the camera turns to the side the ball went to (the defence) instead of waiting where it was last seen."""
    mx = [b[0] + b[2] / 2 for row in people for b in row]
    lo, hi = (float(np.percentile(mx, 5)) - margin, float(np.percentile(mx, 95)) + margin) if len(mx) >= 20 else (0, 1)
    out = list(xs)
    n = len(xs)
    k = 0
    while k < n:
        if xs[k] is not None and k + 1 < n and xs[k + 1] is None:
            j = k - 1
            while j >= 0 and k - j <= 2 and tr[j] is None:
                j -= 1
            if j >= 0 and k - j <= 2 and tr[j] is not None and tr[k] is not None:
                vx = (tr[k][0] - tr[j][0]) / (k - j)
                m = k + 1
                while m < n and xs[m] is None and m - k <= frames:
                    out[m] = min(max(out[k] + vx * (m - k), lo), hi)
                    m += 1
        k += 1
    return out


def turns_of(tr, min_dv=0.004):
    """Frames where the ball's x direction turns (a hit or a bounce), as `scores` counts them."""
    n = len(tr)
    vx = [None] * n
    for k in range(1, n):
        if tr[k] is not None and tr[k - 1] is not None:
            vx[k] = tr[k][0] - tr[k - 1][0]
    return [k for k in range(2, n) if vx[k] is not None and vx[k - 1] is not None and vx[k] * vx[k - 1] < 0
            and abs(vx[k] - vx[k - 1]) > min_dv]


def hit_boxes(tr, people, W, H, near, horizon, back=2):
    """Test 52: per frame, the box of the main player who plays the ball next: at the next turn of the ball within
    `horizon` frames (the analysis is offline), the main player nearest to the ball there (within `near` long
    sides); the turn just past (`back` frames) still counts. None where no such hit is close."""
    n = len(tr)
    hits = []
    for t in turns_of(tr):
        hb = hitter(tr[t], people[t], W, H, near)
        if hb is not None:
            hits.append((t, hb))
    out = [None] * n
    j = 0
    for k in range(n):
        while j < len(hits) and hits[j][0] < k - back:
            j += 1
        if j < len(hits) and hits[j][0] - k <= horizon:
            out[k] = hits[j][1]
    return out


def keep_box(xs, tr, boxes, w, pad, ball_first=True):
    """Test 52: move the target so the given box (the player about to hit) stays whole (+ `pad` crop widths) with the
    ball inside the crop too; where both cannot fit, the ball wins (`ball_first`) or the player does."""
    out = list(xs)
    for k, x in enumerate(xs):
        b = boxes[k]
        if x is None or b is None:
            continue
        left, right = b[0] - pad * w, b[0] + b[2] + pad * w
        lo, hi = right - w / 2, left + w / 2
        if tr[k] is not None:
            blo, bhi = tr[k][0] - w / 2, tr[k][0] + w / 2
            if max(lo, blo) <= min(hi, bhi):
                lo, hi = max(lo, blo), min(hi, bhi)
            elif ball_first:
                continue
        if lo <= hi:
            out[k] = min(max(x, lo), hi)
    return out


def keep_pair(xs, tr, people, w, pad, mode=1, near_only=None):
    """Test 49c: move the target, when it can be done without losing the ball, so both near players stay whole.

    The near pair is the two tallest main boxes. The target is clipped into the centres that keep both boxes
    (plus `pad` crop widths) and the ball (with the same pad) inside the crop; if no such centre exists the
    target is left alone (the ball wins).
    """
    out = list(xs)
    for k, x in enumerate(xs):
        if x is None or tr[k] is None:
            continue
        bs = sorted(people[k], key=lambda b: -b[3])[:2]
        if len(bs) < 2:
            continue
        if near_only is not None and near_only[k] is None:
            continue  # 49f: the ball is away from the near players (on its way to the other side): follow it
        left = min(b[0] for b in bs) - pad * w
        right = max(b[0] + b[2] for b in bs) + pad * w
        bx = tr[k][0]
        if mode >= 2:
            # Aim at the near pair's centre; the ball (with pad) must stay inside the crop.
            pc = (min(b[0] for b in bs) + max(b[0] + b[2] for b in bs)) / 2
            out[k] = min(max(pc, bx - w / 2 + pad * w), bx + w / 2 - pad * w)
            continue
        lo = max(right - w / 2, bx - w / 2 + pad * w)
        hi = min(left + w / 2, bx + w / 2 - pad * w)
        if lo <= hi:
            out[k] = min(max(x, lo), hi)
    return out


def camera(name, track, zoom, v):
    meta, truth, today, n, W, H, orient = story.load(name)
    wmax = min(1.0, (9 / 16) * H / W)
    hmax = min(1.0, (16 / 9) * W / H)
    w, h = wmax / zoom, hmax / zoom
    oc = json.load(open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{track}.json")))
    run = story.RUN_SPORT.get(meta["sport"], story.RUN_OFF)
    tr = story.keep_runs(hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"]), run["min_run"], run["gap"])
    tr = keep_court(tr, v["court"], run["gap"])
    people = players(name, n)
    tr = keep_players_court(tr, people, v["courtp"])
    cands = None
    if v["own"] > 0:
        det = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "detect", f"{name}.{oc['source'].split()[-1]}.json")))
        import ball_track as bt
        cands = moving_candidates(det["frames"], bt.screen_boxes(name) if meta["sport"] == "beachTennis" else [],
                                  v["smin"])
    tr = keep_exits(tr, v["exit"], v["back"], v["dx"], cands, v["step"], aspect=H / W)
    hitters = people
    if v["hitall"] > 0:
        # 49f: the far players (smaller than the main ones) can be the hitter too: every box inside the main players' court
        mx = [b[0] + b[2] / 2 for row in people for b in row]
        if len(mx) >= 20:
            lo, hi = float(np.percentile(mx, 5)) - v["courtp"], float(np.percentile(mx, 95)) + v["courtp"]
            hitters = [[b for b in row if lo <= b[0] + b[2] / 2 <= hi] for row in people_rows(name, n)]
    xs = aim_x(tr, hitters, W, H, v["blend"], v["near"])
    if v["pair"] > 0:
        near_only = None
        if v["pairnear"] > 0:
            near_only = [None if p is None else hitter(p, sorted(people[k], key=lambda b: -b[3])[:2], W, H, v["pairnear"])
                         for k, p in enumerate(tr)]
        xs = keep_pair(xs, tr, people, w, v["pairpad"], v["pair"], near_only)
    if v["glide"] > 0:
        xs = glide(xs, tr, people, v["glide"], v["courtp"])
    if v["hitbox"] > 0:
        # test 52: the player about to hit kept whole (the ball inside too where both fit)
        boxes = hit_boxes(tr, people, W, H, v["near"], int(v["horizon"]))
        xs = keep_box(xs, tr, boxes, w, v["hitpad"], ball_first=v["hitbox"] < 2)
    isball = np.array([p is not None for p in tr])
    cx0 = today[:, 0] + today[:, 2] / 2
    cy0 = today[:, 1] + today[:, 3] / 2
    tx = sg.target_x(xs, cx0, 10, "hold")
    lead = int(v["lead"])
    if lead > 0:
        tx = np.concatenate([tx[lead:], np.repeat(tx[-1:], lead)])
        isball = np.concatenate([isball[lead:], np.repeat(isball[-1:], lead)])
    rects = np.zeros((n, 4))
    rects[:, 2], rects[:, 3] = w, h
    if w < 0.999:
        cx = l3.band_path(tx - v["dz"] * w, tx + v["dz"] * w, np.where(isball, 1.0, l3.WFB), cx0, 0.0, v["a"], v["b"])
    else:
        cx = np.full(n, 0.5)
    rects[:, 0] = np.clip(cx, w / 2, 1 - w / 2) - w / 2
    if h < 0.999:
        by = l3.bridged([None if p is None else p[1] for p in tr])
        lo = np.array([-np.inf if q is None else q - (0.5 - l3.BOTTOM) * h for q in by])
        hi = np.array([np.inf if q is None else q + (0.5 - l3.TOP) * h for q in by])
        cy = l3.band_path(lo, hi, np.ones(n), cy0, l3.WA, v["a"], v["b"])
    else:
        cy = np.full(n, 0.5)
    rects[:, 1] = np.clip(cy, h / 2, 1 - h / 2) - h / 2
    return meta, truth, n, rects, W, H, tr, people


def scores(name, track, zoom, v):
    meta, truth, n, rects, W, H, tr, people = camera(name, track, zoom, v)
    s = l2.score(rects, truth, n)
    inside = lambda k, x: rects[k, 0] <= x <= rects[k, 0] + rects[k, 2]  # noqa: E731
    pts = [(k, p) for k, p in enumerate(tr) if p is not None]
    self_in = np.mean([inside(k, p[0]) for k, p in pts]) if pts else None
    whole = lambda k, b: rects[k, 0] <= b[0] and b[0] + b[2] <= rects[k, 0] + rects[k, 2]  # noqa: E731
    hit_all, hit_turn = [], []
    vx = [None] * n
    for k in range(1, n):
        if tr[k] is not None and tr[k - 1] is not None:
            vx[k] = tr[k][0] - tr[k - 1][0]
    turns = {k for k in range(2, n) if vx[k] is not None and vx[k - 1] is not None and vx[k] * vx[k - 1] < 0
             and abs(vx[k] - vx[k - 1]) > 0.004}
    for k, p in pts:
        hb = hitter(p, people[k], W, H, BASE["near"])
        if hb is None:
            continue
        hit_all.append(whole(k, hb))
        if any(abs(k - t) <= 2 for t in turns):
            hit_turn.append(whole(k, hb))
    # test 52: the near players only (the two tallest main boxes) when one of them is the hitter at a hit
    near_turn = []
    for k, p in pts:
        if not any(abs(k - t) <= 2 for t in turns):
            continue
        pair = sorted(people[k], key=lambda b: -b[3])[:2]
        hb = hitter(p, pair, W, H, BASE["near"])
        if hb is not None:
            near_turn.append(whole(k, hb))
    # test 52: the same from the LABELLED ball (not the track the camera follows): at the labelled hits (the labelled
    # ball's x direction turns), the main player nearest to it whole in the crop; and the near pair's one
    lab = sorted((t, v) for t, v in truth["samples"].items() if isinstance(v, tuple))
    lhit, lnear = [], []
    for i in range(1, len(lab) - 1):
        (t0, p0), (t1, p1), (t2, p2) = lab[i - 1], lab[i], lab[i + 1]
        if t1 - t0 > 200 or t2 - t1 > 200:
            continue
        v0, v1 = p1[0] - p0[0], p2[0] - p1[0]
        if v0 * v1 >= 0 or abs(v1 - v0) < 0.01:
            continue
        k = t1 // 100
        if k >= n:
            continue
        hb = hitter(p1, people[k], W, H, BASE["near"])
        if hb is not None:
            lhit.append(whole(k, hb))
            pair = sorted(people[k], key=lambda b: -b[3])[:2]
            if any(b is hb for b in pair):
                lnear.append(whole(k, hb))
    cx = rects[:, 0] + rects[:, 2] / 2
    sp = np.abs(np.diff(cx)) / rects[1:, 2] * 10  # crop widths per second
    return {"lhit": lhit, "lnear": lnear,
            "near": np.mean(near_turn) if near_turn else None, "nnear": len(near_turn), "ball": s["in"], "pts": s["pts"], "self": self_in, "hit": np.mean(hit_all) if hit_all else None,
            "nhit": len(hit_all), "turn": np.mean(hit_turn) if hit_turn else None, "nturn": len(hit_turn),
            "pan": float(np.sum(sp)) / 10 / (n / 100.0), "fast": float(np.percentile(sp, 95)) if len(sp) else 0}


def parse_var(s):
    name, _, kv = s.partition(":")
    v = dict(BASE)
    for item in filter(None, kv.split(",")):
        k, _, x = item.partition("=")
        v[k] = float(x)
    return name, v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", action="append", required=True, help="tag, or clip-prefix=tag (first match wins)")
    ap.add_argument("--var", action="append", required=True)
    ap.add_argument("--clips-detail", action="store_true")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()

    def track_of(c):
        for t in a.track:
            if "=" in t:
                pre, _, tag = t.partition("=")
                if c.startswith(pre):
                    return tag
            else:
                return t
        raise SystemExit(f"no track for {c}")

    print("| variant | ball in crop (labels) | ball (own points) | hitter whole: all / at hits | pan | fast pan (95%) |")
    print("|---|---|---|---|---|---|")
    for spec in a.var:
        name, v = parse_var(spec)
        acc = dict(bi=0.0, bp=0, self=[], hit=[], hw=0, turn=[], tw=0, pan=[], fast=[], near=[], nw=0, lhit=[], lnear=[])
        detail = []
        for c in a.clips:
            zr = story.sport_zoom(c, track_of(c))
            z = zr[0] if zr else 1.0
            r = scores(c, track_of(c), z, v)
            if r["ball"] is not None:
                acc["bi"] += r["ball"] * r["pts"]
                acc["bp"] += r["pts"]
            if r["self"] is not None:
                acc["self"].append(r["self"])
            if r["hit"] is not None:
                acc["hit"].append(r["hit"] * r["nhit"])
                acc["hw"] += r["nhit"]
            if r["turn"] is not None:
                acc["turn"].append(r["turn"] * r["nturn"])
                acc["tw"] += r["nturn"]
            if r["near"] is not None:
                acc["near"].append(r["near"] * r["nnear"])
                acc["nw"] += r["nnear"]
            acc["lhit"] += r["lhit"]
            acc["lnear"] += r["lnear"]
            acc["pan"].append(r["pan"])
            acc["fast"].append(r["fast"])
            detail.append(f"{c[-5:]} {sum(r['lhit'])}/{len(r['lhit'])}")
        f = lambda x: "—" if x is None else f"{100 * x:.1f}%"  # noqa: E731
        print(f"| {name} | {f(acc['bi'] / acc['bp'] if acc['bp'] else None)} | {f(np.mean(acc['self']))} | "
              f"{f(sum(acc['hit']) / acc['hw'] if acc['hw'] else None)} / "
              f"{f(sum(acc['turn']) / acc['tw'] if acc['tw'] else None)} | {np.mean(acc['pan']):.1f} | "
              f"{np.mean(acc['fast']):.2f} | near hitter at hits "
              f"{f(sum(acc['near']) / acc['nw'] if acc['nw'] else None)} ({acc['nw']}) | LABELLED hits: hitter whole "
              f"{f(np.mean(acc['lhit']) if acc['lhit'] else None)} ({len(acc['lhit'])}), near player "
              f"{f(np.mean(acc['lnear']) if acc['lnear'] else None)} ({len(acc['lnear'])}) |", flush=True)
        if a.clips_detail:
            print("    " + ", ".join(detail))


if __name__ == "__main__":
    main()
