#!/usr/bin/env python3
"""Modo Foco lab, framing test: today's Modo Foco (players) vs a HYBRID that frames the ball while SAM 2 is sure of it
and goes back to today's framing when it is not (Victor's idea, 2026-11-03).

Inputs per clip (all already in docs/focus-refs/lab/tests/):
- framing/<clip>.current.focus.json   today's framing (focus_variant.py --preset acao = FocusTuning.action, v15)
- oneclick/<clip>.ball.<model>.json   SAM 2 one-click ball track (oneclick.py), no human fixes

Hybrid, per 100 ms frame (the analysis runs after the save, so it can look both ways in time):
1. Trust the ball when SAM 2 has a mask the size and shape of a ball, that did not jump impossibly far from the last
   trusted position, and that is not lying still (a ball on the floor) over ±1 s.
2. Ball mode starts after `enter` trusted frames in a row, survives gaps up to `hold` frames (the position is
   interpolated across them), and ends after that.
3. Ball rect: the zoom cap of today's framing, centred on the smoothed ball, kept inside the picture.
4. The two rects are blended by the ball-mode share, smoothed over ~0.5 s, so the camera eases in and out (and,
   offline, starts moving a little before the switch).

Scores on the labelled ball points (ground truth): ball inside the crop, how far from the crop's centre, mean zoom,
camera jerk; plus the share of time in ball mode. Renders a comparison video (whole picture with both crops and the
SAM 2 ball | today | hybrid).

    cd docs/focus-refs && python3 tools/lab/hybrid.py [--render] [--model tiny] [clip ...]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate as ev  # noqa: E402

TESTS = os.path.join(ev.ROOT, "lab", "tests")
OUT = os.path.join(TESTS, "framing")

T = dict(area_max=0.003, aspect_max=3.0, jump_frac=0.09, still_frac=0.012, still_win=10,
         enter=3, hold=2, ball_sigma=2.0, ramp_in=5, ramp_out=2, final_sigma=1.0, ball_zoom=2.0)
# Round 1 (2026-11-03, first videos): hold=4, blend = Gaussian σ 2.5 frames both ways, ball zoom = today's cap.
# Round 2 (Victor's review): leave the ball faster when it is lost (hold 2, ramp out 0.2 s; ramp in stays 0.5 s),
# and zoom closer while the ball is trusted (2x).
ROUND1 = dict(hold=4, ramp_in=0, ramp_out=0, blend_sigma=2.5, ball_zoom=0.0)
# Round 3 (Victor's review of the rally clip, 2026-11-03): no camera bobbing on bounces (basketball dribbles, a ball
# hitting the sand). The camera's height follows the HIGHEST the ball has been in the last `v_past` frames (and the next
# `v_future`, offline): it rises with a throw or a lob at once, and comes down only when the ball stays low, at most
# `v_down_max` frame heights per second. Horizontal is unchanged.
# Also: a ball lost for up to `hold` frames and found again is bridged (the camera glides from where it was lost to
# where it comes back) instead of dropping back to the players for a moment, which made a vertical jolt in the rally
# clip (25-28 s); longer losses (end of a point, a serve) still go back to the players in 0.2 s (round 2).
T.update(vert=1, v_past=8, v_future=3, v_down_max=0.2, v_up_max=1.0, v_sigma=4.0, hold=10)
ROUND2 = dict(vert=0, hold=2)
# Round 4 (Victor: the camera rose more than needed on shots and long passes over the top): v_frame, see
# vertical_camera. Round 3 = the same without it.
T.update(v_frame=1, v_top=0.15, v_bottom=0.10)
ROUND3 = dict(v_frame=0)
# Round 5: racket-sport filters (see trusted). Round 4 = the same without them.
T.update(racket=1, r_aspect_max=2.0, r_fill_min=0.6, r_area_jump=2.5, r_confirm=6, r_slow_path=0.10, r_slow_win=5,
         r_slow_run=6)
ROUND4 = dict(racket=0, box_max_frac=1.0, fill_min=0.0)
T.update(box_max_frac=0.06, fill_min=0.45)
# Round 6 (2026-11-03, EdgeTAM on ROI crops): a mask in pieces is not the ball (largest piece < main_min of it);
# the jump allowed after a gap stops growing at jump_cap frames; a gap is bridged only if the ball comes back near.
T.update(main_min=0.7, jump_cap=8, bridge_near=1)  # cap 4 cut real volleyball serves and spikes
ROUND5 = dict(main_min=0.0, jump_cap=10 ** 6, bridge_near=0)
# Test 12 (Victor, 2026-11-04, volleyball: the drop back to the players after a lost ball is abrupt): `ease` = 1 shapes
# the ramps in and out as smoothstep (slow start, slow end) instead of a straight line; try with a longer ramp_out,
# e.g. --set ease=1 --set ramp_out=7. Off by default (round 6 unchanged).
T.update(ease=0)
# Test 17 (Victor, 2026-11-05, mixed detector + EdgeTAM videos: "on lobs the camera goes too high and loses the players"):
# v_keep > 0 caps how high the ball rect may go: the players' centre (today's framing) stays at least v_keep of the
# crop's height above its bottom edge; on a high lob the ball may leave the top instead. 0 = off (round 6).
T.update(v_keep=0.0)
# Test 19 (Victor, 2026-11-06, bt-rz-1105-v with the Tiny detector: the ball found in short bursts makes the zoom open
# and close quickly): min_seg > 0 drops ball segments shorter than min_seg frames (100 ms each), so a short find does
# not zoom in; zoom_rate > 0 limits how fast the crop's size may change (zoom factor per second, both ways), the centre
# unchanged. 0 = off (round 6).
T.update(min_seg=0, zoom_rate=0.0)


def gauss(values, sigma):
    v = np.asarray(values, dtype=float)
    if sigma <= 0 or len(v) < 2:
        return v
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(v, (r, r), mode="edge")
    return np.convolve(pad, k, mode="valid")


# Sports where the ball is not held during play: the round-5 filters apply (named after the racket sports they were
# made for; volleyball added 2026-11-03: the ball is only held between rallies, and heads look like balls).
RACKET_SPORTS = {"beachTennis", "tenis", "padel", "tenisMesa", "volei", "voleiPraia", "futevolei"}


def trusted(pred, n, size, sport=None):
    """Per frame: (x, y) when SAM 2's mask looks like the ball, else None.

    Round 5 (racket sports, Victor's review of bt-wa-1028: SAM 2 slid onto a racket at 9.6 s and at the end):
    - shape: rounder (aspect <= r_aspect_max, fill >= r_fill_min; the racket face with its handle is not)
    - identity: a mask that suddenly GROWS (area vs the median of the last masks, x r_area_jump) means SAM 2 slid onto
      something bigger (racket, hand); from there it must move like a ball for r_confirm frames in a row, or shrink at
      once back to a ball's size (SAM 2 often finds the ball again by itself)
    - in play: a mask that moves less than r_slow_path frame long sides over ±r_slow_win frames, for r_slow_run frames
      or more, is not a ball in a rally (a racket held while waiting). Not for basketball, where the ball is held.
    """
    W, H = size
    L = max(W, H)
    racket = bool(T["racket"]) and sport in RACKET_SPORTS
    aspect_max = T["r_aspect_max"] if racket else T["aspect_max"]
    raw, areas = [], []
    for i in range(n):
        p = pred.get(str(i))
        if p is None or p[6] > T["area_max"] or p[6] <= 0:
            raw.append(None)
            areas.append(None)
            continue
        wpx, hpx = p[4] * W, p[5] * H
        fill = p[6] * W * H / max(1.0, wpx * hpx)
        # every sport (2026-11-03, app basketball exports): a mask that spilled onto a player is too big for a ball
        # or thin inside its own box
        main = p[7] if len(p) > 7 else 1.0  # share of the mask in its largest piece (newer runs)
        if max(wpx, hpx) > T["box_max_frac"] * L or fill < T["fill_min"] or main < T["main_min"]:
            raw.append(None)
            areas.append(None)
            continue
        if max(wpx, hpx) / max(1e-6, min(wpx, hpx)) > aspect_max or (racket and fill < T["r_fill_min"]):
            raw.append(None)
            areas.append(None)
            continue
        raw.append((p[0], p[1]))
        areas.append(p[6])

    def path_len(seq_pts, i):
        win = [seq_pts[j] for j in range(max(0, i - T["r_slow_win"]), min(n, i + T["r_slow_win"] + 1))
               if seq_pts[j] is not None]
        if len(win) < 4:
            return None
        pl = sum(math.hypot((b[0] - a[0]) * W, (b[1] - a[1]) * H) for a, b in zip(win, win[1:])) / L
        return pl * (2 * T["r_slow_win"]) / (len(win) - 1)

    if racket:
        # identity changes (area jumps) and re-confirmation
        kept, recent, suspect, run = list(raw), [], False, []
        reacq = set()
        for i in range(n):
            if raw[i] is None:
                continue
            a_ = areas[i]
            if recent:
                med = sorted(recent[-5:])[len(recent[-5:]) // 2]
                ratio = a_ / med
                if ratio > T["r_area_jump"]:
                    suspect, run, recent = True, [], []  # grew at once: a racket, a hand, a head
                elif ratio < 1 / T["r_area_jump"]:
                    if suspect:
                        suspect, run = False, []  # shrank at once while suspect: back on the (smaller) ball
                        reacq.add(i)
                    recent = []
            recent.append(a_)
            if suspect:
                pl = path_len(raw, i)
                ok = pl is not None and pl >= T["r_slow_path"]
                run = run + [i] if ok else []
                if len(run) >= T["r_confirm"]:
                    suspect = False  # the run becomes trusted from here on
                    run = []
                else:
                    kept[i] = None
        raw = kept
    else:
        reacq = set()
    # jumps: compared with the last kept position, allowing more distance across gaps (not where the ball was just
    # found again: the last kept position may be the racket it slid onto)
    out, last, last_i = [], None, None
    for i, p in enumerate(raw):
        if p is not None and last is not None and i not in reacq:
            d = math.hypot((p[0] - last[0]) * W, (p[1] - last[1]) * H) / L
            if d > T["jump_frac"] * min(i - last_i, T["jump_cap"]):
                p = None
        out.append(p)
        if p is not None:
            last, last_i = p, i
    # still: a ball lying on the floor (or a light) stays within still_frac over ±still_win frames
    res = list(out)
    for i, p in enumerate(out):
        if p is None:
            continue
        win = [q for q in out[max(0, i - T["still_win"]):i + T["still_win"] + 1] if q is not None]
        if len(win) >= T["still_win"]:
            spread = max(math.hypot((q[0] - p[0]) * W, (q[1] - p[1]) * H) for q in win) / L
            if spread < T["still_frac"]:
                res[i] = None
    if racket:
        slow = [False] * n
        for i in range(n):
            if res[i] is not None:
                pl = path_len(res, i)
                slow[i] = pl is not None and pl < T["r_slow_path"]
        i = 0
        while i < n:
            if not slow[i]:
                i += 1
                continue
            j = i
            while j + 1 < n and (slow[j + 1] or res[j + 1] is None) and j + 1 - i < 1000:
                j += 1
            if sum(slow[i:j + 1]) >= T["r_slow_run"]:
                for k in range(i, j + 1):
                    res[k] = None
            i = j + 1
    return res


def ball_mode(tr, size=None):
    """Segments [a, b] of ball mode, with positions filled across short gaps (bridged only when the ball comes back
    near where it was lost, if `size` is given)."""
    n = len(tr)
    ok = [p is not None for p in tr]
    segs, i = [], 0
    while i < n:
        if not ok[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and ok[j + 1]:
            j += 1
        segs.append([i, j])
        i = j + 1
    merged = []
    for s in segs:
        near = True
        if merged and size is not None and T["bridge_near"]:
            a, b = tr[merged[-1][1]], tr[s[0]]
            gap = s[0] - merged[-1][1]
            d = math.hypot((a[0] - b[0]) * size[0], (a[1] - b[1]) * size[1]) / max(size)
            near = d <= T["jump_frac"] * min(gap, T["jump_cap"])
        if merged and near and s[0] - merged[-1][1] - 1 <= T["hold"]:
            merged[-1][1] = s[1]
        else:
            merged.append(list(s))
    return [s for s in merged if sum(ok[s[0]:s[1] + 1]) >= T["enter"] and s[1] - s[0] + 1 >= T["min_seg"]]


def vertical_camera(by, segs, players=None, h=None):
    """Camera height inside ball segments (small y = high in the picture), then down-moves limited in speed, then a
    light smoothing. Rises at once, ignores bounces.
    Round 3: the crop's centre follows the ball's highest point over the window (the ball centred when high).
    Round 4 (`v_frame`): the crop stays as close as it can to the players' height (today's framing) and moves only as
    much as needed to keep the ball's highest point `v_top` of the crop below its top edge (and its lowest point
    `v_bottom` above the bottom edge): a shot or a lob ends near the top of the frame, not in its middle."""
    out = by.copy()
    dt = 0.1
    for a, b in segs:
        top = np.array([np.nanmin(by[max(a, k - T["v_past"]):min(b, k + T["v_future"]) + 1]) for k in range(a, b + 1)])
        if T["v_frame"] and players is not None:
            bot = np.array([np.nanmax(by[max(a, k - T["v_past"]):min(b, k + T["v_future"]) + 1]) for k in range(a, b + 1)])
            env = np.empty_like(top)
            for j, k in enumerate(range(a, b + 1)):
                py = players[k][1] + players[k][3] / 2
                hi = top[j] + h / 2 - T["v_top"] * h      # lowest centre that still shows the high point
                lo = bot[j] - h / 2 + T["v_bottom"] * h   # highest centre that still shows the low point
                env[j] = hi if lo > hi else min(max(py, lo), hi)
        else:
            env = top
        if T["v_keep"] and players is not None:
            for j, k in enumerate(range(a, b + 1)):
                py = players[k][1] + players[k][3] / 2
                env[j] = max(env[j], py - h / 2 + T["v_keep"] * h)  # y grows downwards: not higher than this
        y = np.empty_like(env)
        y[0] = env[0]
        for k in range(1, len(env)):
            step = env[k] - y[k - 1]  # > 0: the camera would go down
            y[k] = y[k - 1] + min(step, T["v_down_max"] * dt) if step > 0 else y[k - 1] + max(step, -T["v_up_max"] * dt)
        out[a:b + 1] = gauss(y, T["v_sigma"])
    return out


def ramp(x):
    """Blend weight along a ramp (x from 1 at the ball segment to 0 at the players): straight, or smoothstep."""
    return x * x * (3 - 2 * x) if T["ease"] else x


def hybrid_rects(players, tr, size, zoom):
    n = len(players)
    W, H = size
    segs = ball_mode(tr, size)
    mode = np.zeros(n)
    bx, by = np.full(n, np.nan), np.full(n, np.nan)
    for a, b in segs:
        idx = [k for k in range(a, b + 1) if tr[k] is not None]
        xs = np.interp(range(a, b + 1), idx, [tr[k][0] for k in idx])
        ys = np.interp(range(a, b + 1), idx, [tr[k][1] for k in idx])
        bx[a:b + 1] = gauss(xs, T["ball_sigma"])
        by[a:b + 1] = gauss(ys, T["ball_sigma"])
        mode[a:b + 1] = 1
    bz = T["ball_zoom"] or zoom
    if T["vert"]:
        by = vertical_camera(by, segs, players, 1 / bz)
    # extend the ball position a little outside each segment so the blend has a target while it ramps
    sym = T.get("blend_sigma", 0) and not T["ramp_in"] and not T["ramp_out"]
    pad = int(3 * T["blend_sigma"]) if sym else max(T["ramp_in"], T["ramp_out"])
    for a, b in segs:
        for k in range(max(0, a - pad), a):
            if np.isnan(bx[k]):
                bx[k], by[k] = bx[a], by[a]
        for k in range(b + 1, min(n, b + 1 + pad)):
            if np.isnan(bx[k]):
                bx[k], by[k] = bx[b], by[b]
    if sym:
        w = gauss(mode, T["blend_sigma"])
    else:
        # ramp in over ramp_in frames before the ball segment (offline: the camera starts early), out over ramp_out
        w = mode.copy()
        for a, b in segs:
            for k in range(1, T["ramp_in"] + 1):
                if a - k >= 0:
                    w[a - k] = max(w[a - k], ramp(1 - k / (T["ramp_in"] + 1)))
            for k in range(1, T["ramp_out"] + 1):
                if b + k < n:
                    w[b + k] = max(w[b + k], ramp(1 - k / (T["ramp_out"] + 1)))
    w[np.isnan(bx)] = 0
    rw, rh = 1 / bz, 1 / bz
    out = []
    for k in range(n):
        P = players[k]
        if w[k] <= 1e-3:
            out.append(list(P))
            continue
        cx = min(max(bx[k], rw / 2), 1 - rw / 2)
        cy = min(max(by[k], rh / 2), 1 - rh / 2)
        B = [cx - rw / 2, cy - rh / 2, rw, rh]
        out.append([P[j] * (1 - w[k]) + B[j] * w[k] for j in range(4)])
    arr = np.array(out)
    for j in range(4):
        arr[:, j] = gauss(arr[:, j], T["final_sigma"])
    arr[:, 2] = np.clip(arr[:, 2], 1 / max(zoom, bz), 1)
    arr[:, 3] = np.clip(arr[:, 3], 1 / max(zoom, bz), 1)
    if T["zoom_rate"] > 0:  # limit the zoom speed (on the log of the size: the same feel zooming in and out)
        for j in (2, 3):
            lz = np.log(arr[:, j])
            step = math.log(1 + T["zoom_rate"]) * 0.1
            fw, bw = lz.copy(), lz.copy()
            for k in range(1, n):
                fw[k] = min(max(lz[k], fw[k - 1] - step), fw[k - 1] + step)
            for k in range(n - 2, -1, -1):
                bw[k] = min(max(fw[k], bw[k + 1] - step), bw[k + 1] + step)
            cx = arr[:, j - 2] + arr[:, j] / 2
            arr[:, j] = np.exp(bw)
            arr[:, j - 2] = cx - arr[:, j] / 2
    arr[:, 0] = np.clip(arr[:, 0], 0, 1 - arr[:, 2])
    arr[:, 1] = np.clip(arr[:, 1], 0, 1 - arr[:, 3])
    return arr.tolist(), mode, segs


def scores(rects, truth, size):
    W, H = size
    inside, cdist = 0, []
    pts = 0
    for t, v in truth["samples"].items():
        if not isinstance(v, tuple):
            continue
        i = t // 100
        if i >= len(rects):
            continue
        x, y, w, h = rects[i]
        pts += 1
        if x <= v[0] <= x + w and y <= v[1] <= y + h:
            inside += 1
        cdist.append(math.hypot((v[0] - (x + w / 2)) / w, (v[1] - (y + h / 2)) / h))
    zooms = [1 / r[2] for r in rects]
    # vertical bobbing: direction changes of the crop's height that move more than 0.4% of the frame per 100 ms
    ys = np.array([r[1] + r[3] / 2 for r in rects])
    dy = np.diff(ys)
    sig = [np.sign(d) for d in dy if abs(d) > 0.004]
    flips = sum(1 for p, q in zip(sig, sig[1:]) if p != q)
    cx = np.array([r[0] + r[2] / 2 for r in rects]) * W / max(W, H)
    cy = np.array([r[1] + r[3] / 2 for r in rects]) * H / max(W, H)
    acc = np.hypot(np.diff(cx, 2), np.diff(cy, 2)) / 0.1 ** 2  # frame long sides / s²
    return {"points": pts, "ball_in_crop": inside / pts if pts else None,
            "ball_off_centre": float(np.median(cdist)) if cdist else None,
            "zoom": float(np.mean(zooms)), "jerk_p95": float(np.percentile(acc, 95)) if len(acc) else 0.0,
            "v_flips_per_10s": flips / (len(rects) / 100.0)}


def rect_at(t_ms, rects):
    pos = t_ms / 100.0
    if pos <= 0:
        return rects[0]
    if pos >= len(rects) - 1:
        return rects[-1]
    i = int(pos)
    f = pos - i
    return [rects[i][k] + (rects[i + 1][k] - rects[i][k]) * f for k in range(4)]


def render(name, meta, cur, hyb, tr, mode, truth, out_path, labels=("Modo Foco atual", "Hibrido (bola)"),
           legend="laranja: atual  verde: hibrido  ponto: bola do SAM 2  anel: gabarito"):
    import cv2

    video = os.path.join(ev.ROOT, meta["video"])
    # the video's own upright size (the labels' size is the 1280 px frames'; same shape, not the same pixels)
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                    video], capture_output=True, text=True, check=True).stdout)["streams"][0]
    W, H = st["width"], st["height"]
    rot = int(st.get("tags", {}).get("rotate", 0))
    for side in st.get("side_data_list", []):
        if "rotation" in side:
            rot = int(side["rotation"])
    if abs(rot) % 180 == 90:
        W, H = H, W
    num, den = st["r_frame_rate"].split("/")
    fps = float(num) / float(den)
    keep = 2 if fps > 40 else 1
    ofps = fps / keep
    portrait = H > W
    if portrait:
        ph = 960
        pw = round(W * ph / H) // 2 * 2
        size_out = (pw * 3, ph)
    else:
        pw, ph = 1280, 720
        size_out = (1280, 720 + 360)
    dur = meta["durMs"] / 1000
    dec = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", f"{meta['startMs'] / 1000:.3f}", "-i", video, "-t",
                            f"{dur:.3f}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s",
                            f"{size_out[0]}x{size_out[1]}", "-r", f"{ofps}", "-i", "-", "-c:v", "libx264", "-preset",
                            "veryfast", "-crf", "26", "-pix_fmt", "yuv420p", out_path], stdin=subprocess.PIPE)
    fb = W * H * 3
    n = 0
    font = cv2.FONT_HERSHEY_SIMPLEX

    def text(img, s, org, scale=0.6):
        cv2.putText(img, s, org, font, scale, (0, 0, 0), 4, cv2.LINE_AA)
        cv2.putText(img, s, org, font, scale, (255, 255, 255), 2, cv2.LINE_AA)

    def crop(frame, r, w, h):
        x0, y0 = int(round(r[0] * W)), int(round(r[1] * H))
        x1, y1 = int(round((r[0] + r[2]) * W)), int(round((r[1] + r[3]) * H))
        c = frame[max(0, y0):min(H, y1), max(0, x0):min(W, x1)]
        return cv2.resize(c, (w, h), interpolation=cv2.INTER_AREA)

    while True:
        buf = dec.stdout.read(fb)
        if len(buf) < fb:
            break
        if n % keep:
            n += 1
            continue
        frame = np.frombuffer(buf, np.uint8).reshape(H, W, 3)
        t = n * 1000 / fps
        rc, rh_ = rect_at(t, cur), rect_at(t, hyb)
        i = min(int(round(t / 100)), len(tr) - 1)
        if portrait:
            left = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
            s = ph / H
        else:
            left = cv2.resize(frame, (pw, ph), interpolation=cv2.INTER_AREA)
            s = ph / H
        for r, col in ((rc, (0, 165, 255)), (rh_, (63, 242, 214))):
            cv2.rectangle(left, (int(r[0] * W * s), int(r[1] * H * s)),
                          (int((r[0] + r[2]) * W * s), int((r[1] + r[3]) * H * s)), col, 3)
        g = truth["samples"].get(int(round(t / 200)) * 200)
        if isinstance(g, tuple):
            cv2.circle(left, (int(g[0] * W * s), int(g[1] * H * s)), 14, (255, 255, 255), 2, cv2.LINE_AA)
        if tr[i] is not None:
            cv2.circle(left, (int(tr[i][0] * W * s), int(tr[i][1] * H * s)), 6, (63, 242, 214), -1, cv2.LINE_AA)
        text(left, f"{t / 1000:4.1f}s  {'BOLA' if mode[i] else 'jogadores'}", (12, 28))
        text(left, legend, (12, ph - 14), 0.45)
        if portrait:
            a = crop(frame, rc, pw, ph)
            b = crop(frame, rh_, pw, ph)
            text(a, labels[0], (12, 28))
            text(b, labels[1], (12, 28))
            img = np.hstack([left, a, b])
        else:
            a = crop(frame, rc, 640, 360)
            b = crop(frame, rh_, 640, 360)
            text(a, labels[0], (12, 28))
            text(b, labels[1], (12, 28))
            img = np.vstack([left, np.hstack([a, b])])
        enc.stdin.write(np.ascontiguousarray(img).tobytes())
        n += 1
    enc.stdin.close()
    enc.wait()
    dec.wait()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="tiny")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--round1", action="store_true", help="the first round's values (before Victor's review)")
    ap.add_argument("--round2", action="store_true", help="round 2: no vertical rule (tag v2)")
    ap.add_argument("--round3", action="store_true", help="round 3: the ball centred vertically (tag v3)")
    ap.add_argument("--round4", action="store_true", help="round 4: no racket-sport filters (tag v4)")
    ap.add_argument("--round5", action="store_true", help="round 5: before the round-6 rules (tag v5)")
    ap.add_argument("--set", action="append", default=[], help="tuning value, e.g. ball_zoom=2.2 or hold=1")
    ap.add_argument("--tag", default="v6", help="suffix of the output files (round 1 had none)")
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    if a.round1:
        T.update(ROUND1)
        T.update(ROUND2)
    if a.round1 or a.round2 or a.round3 or a.round4 or a.round5:
        T.update(ROUND5)
        if a.round5 and a.tag == "v6":
            a.tag = "v5"
    if a.round1 or a.round2 or a.round3 or a.round4:
        T.update(ROUND4)
        if a.round4 and a.tag == "v6":
            a.tag = "v4"
    if a.round2 or a.round1:
        T.update(ROUND3)
    if a.round2:
        T.update(ROUND2)
        if a.tag == "v6":
            a.tag = "v2"
    if a.round3:
        T.update(ROUND3)
        if a.tag == "v6":
            a.tag = "v3"
    for item in a.set:
        k, _, v = item.partition("=")
        if k not in T:
            raise SystemExit(f"unknown value {k}; known: {', '.join(T)}")
        T[k] = float(v) if isinstance(T[k], float) else int(float(v))
    tag = "" if a.round1 else (("." + a.tag) if a.tag else "")
    names = a.clips or [n for n in ev.labelled_clips("ball")
                        if os.path.exists(os.path.join(TESTS, "oneclick", f"{n}.ball.{a.model}.json"))]
    os.makedirs(OUT, exist_ok=True)
    lines = ["| Clip | Points | Ball in crop: today | hybrid | Off centre: today | hybrid | Zoom: today | hybrid "
             "| Jerk p95: today | hybrid | Vertical flips/10 s: today | hybrid | Ball mode |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for name in names:
        meta = ev.clip_meta(name)
        truth = ev.load_truth(name)
        with open(os.path.join(OUT, f"{name}.current.focus.json")) as f:
            fc = json.load(f)
        aspect = "portrait" if truth["size"][1] > truth["size"][0] else "landscape"
        off = int(round((meta["startMs"] - fc["startMs"]) / 100))
        n = meta["count"]
        cur = fc[aspect][off:off + n]
        with open(os.path.join(TESTS, "oneclick", f"{name}.ball.{a.model}.json")) as f:
            oc = json.load(f)
        tr = trusted(oc["pred_one"], n, truth["size"], meta["sport"])
        zoom = max(1 / r[2] for r in cur)  # today's cap on this clip
        hyb, mode, segs = hybrid_rects(cur, tr, truth["size"], zoom)
        sc, sh = scores(cur, truth, truth["size"]), scores(hyb, truth, truth["size"])
        with open(os.path.join(OUT, f"{name}.hybrid{tag}.focus.json"), "w") as f:
            json.dump({"v": 1, "stepMs": 100, "startMs": meta["startMs"], "size": truth["size"],
                       aspect: [[round(v, 4) for v in r] for r in hyb], "tuning": T, "zoom": zoom,
                       "ballSegments": segs}, f)
        oc_ = lambda v: "—" if v is None else f"{v:.2f}"  # noqa: E731
        line = (f"| {name} | {sc['points']} | {ev.fmt(sc['ball_in_crop'])} | {ev.fmt(sh['ball_in_crop'])} "
                f"| {oc_(sc['ball_off_centre'])} | {oc_(sh['ball_off_centre'])} | {sc['zoom']:.2f}x | {sh['zoom']:.2f}x "
                f"| {sc['jerk_p95']:.2f} | {sh['jerk_p95']:.2f} | {sc['v_flips_per_10s']:.1f} | {sh['v_flips_per_10s']:.1f} "
                f"| {100 * mode.mean():.0f}% |")
        lines.append(line)
        print(line, flush=True)
        if a.render:
            path = os.path.join(OUT, f"{name}.compare{tag}.mp4")
            render(name, meta, cur, hyb, tr, mode, truth, path)
            print("  video:", os.path.relpath(path, ev.ROOT), flush=True)
    with open(os.path.join(OUT, f"summary-{a.model}{tag}.md"), "w") as f:
        f.write("# Framing: today vs hybrid (ball while SAM 2 is sure)\n\n"
                "Off centre: median distance ball to crop centre, in crop sizes (0 = centred, 0.5 = at the edge).\n"
                "Jerk p95: camera acceleration, frame long sides / s².\n\n" + "\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
