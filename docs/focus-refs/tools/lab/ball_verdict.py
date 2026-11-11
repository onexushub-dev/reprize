#!/usr/bin/env python3
"""Modo Foco lab, test 47a (2026-11-10): is Seguir a Bola worth applying to this clip? Victor: we do not know how
people will record, so the mode must be offered / applied only where it gives the expected quality (camera movement,
picture), for every sport with its own limits.

Two steps, from signals the phone has (no labels):
  before  (free: today's Modo Foco analysis already ran Vision): the players' median height in the 9:16 output at the
          largest zoom the sport allows. Too small = recorded too far (a 0.5x lens, the far end of a big court): the ball
          is a few px and the camera would hardly move -> not offered, no ball analysis run.
  after   (the ball analysis): ball share (trusted points after the run filter, of the frames), the ball's median size in
          the 9:16 output at the clip's zoom, and the camera's movement on screen (crop widths per 10 s) -> applied only
          when all three clear the sport's limits; else the clip stays on today's Modo Foco.
Limits per sport in VERDICT; a sport without an entry gets no verdict (None: today's behaviour, e.g. basketball).

    python3 tools/lab/ball_verdict.py --track det-t46-btplB clip [clip ...]
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
import hybrid as hb  # noqa: E402
import story  # noqa: E402

# Beach tennis, calibrated on 30 clips (test 47a): the far / static ones Victor or the labels reject (bt-v-1029 0.5x,
# bt-rz-1105-v, bt-wa-1028, yt1105-bt) fall out, the 19 own arena clips stay in except bt-own-a-06 (camera 0.4: the
# ball stays in the middle, the 9:16 crop hardly needs to move).
VERDICT = {"beachTennis": dict(players_min=0.10, share_min=0.25, ball_px_min=16.0, pan_min=0.6)}


def players_height(name):
    """The players' median height as a share of the frame height (Vision, the app's detector), or None."""
    p = os.path.join(ev.ROOT, "renders", f"{name}.people.json")
    if not os.path.exists(p):
        return None
    sm = json.load(open(p)).get("summary", {})
    return sm.get("medianHeightTiled") if sm.get("tilesFixed") else sm.get("medianHeightFull")


def max_zoom(name):
    """The largest zoom the sport's story rule allows for this clip (horizontal fixed, vertical capped by quality)."""
    meta, truth, today, n, W, H, orient = story.load(name)
    zs = story.ZOOM_SPORT.get(meta["sport"])
    if orient == "landscape":
        return zs["landscape"] if zs else 1.0
    wmax_px = min(W, (9 / 16) * H)
    return max(1.0, wmax_px * (zs["max_upscale_v"] if zs else 2.2) / 1080.0)


def verdict(name, track):
    meta = ev.clip_meta(name)
    lim = VERDICT.get(meta["sport"])
    if lim is None:
        return None
    m, truth, today, n, W, H, orient = story.load(name)
    out = {"clip": name, "sport": meta["sport"], "orient": orient}
    # before: players in the output at the largest zoom (crop height = H / zoom for both orientations at these zooms)
    h = players_height(name)
    out["players"] = None if h is None else h * max_zoom(name)
    if out["players"] is not None and out["players"] < lim["players_min"]:
        out.update(ok=False, why="too far (players)")
        return out
    # after: the ball analysis
    oc = json.load(open(os.path.join(story.sg.TESTS, "oneclick", f"{name}.ball.{track}.json")))
    run = story.RUN_SPORT.get(meta["sport"], story.RUN_OFF)
    t2 = story.keep_runs(hb.trusted(oc["pred_one"], n, [W, H], meta["sport"]), run["min_run"], run["gap"])
    out["share"] = float(np.mean([p is not None for p in t2]))
    zr = story.sport_zoom(name, track)
    zoom = zr[0] if zr else story.auto_zoom(name, engine=track)[0]
    _, t_, n2, r, W2, H2, _ = story.camera(name, "C", zoom, track)
    s = story.scores(t_, n2, r, W2, H2)
    raw = oc["pred_one"]
    sizes = [max(raw[str(k)][4] * W, raw[str(k)][5] * H) for k in range(n) if t2[k] is not None and raw.get(str(k))]
    out["zoom"] = zoom
    out["ball_px"] = (float(np.median(sizes)) * 1080.0 / s["src_w"]) if sizes else 0.0
    out["pan"] = s["screen"]
    why = []
    if out["share"] < lim["share_min"]:
        why.append("ball rarely found")
    if out["ball_px"] < lim["ball_px_min"]:
        why.append("ball too small")
    if out["pan"] < lim["pan_min"]:
        why.append("camera would hardly move")
    out.update(ok=not why, why=", ".join(why) or "ok")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--track", required=True, help="the ball track tag (ball_track.py)")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    f = lambda v, fmt: "—" if v is None else format(v, fmt)  # noqa: E731
    print("| clip | o | players in 9:16 | ball share | ball px in 9:16 | zoom | camera pan | **Seguir a Bola** |")
    print("|---|---|---|---|---|---|---|---|")
    for c in a.clips:
        r = verdict(c, a.track)
        if r is None:
            print(f"| {c} | | | | | | | no verdict for this sport (today's behaviour) |")
            continue
        print(f"| {c} | {r['orient'][0].upper()} | {f(r.get('players'), '.0%')} | {f(r.get('share'), '.0%')} | "
              f"{f(r.get('ball_px'), '.0f')} | {f(r.get('zoom'), '.2f')} | {f(r.get('pan'), '.1f')} | "
              f"**{'sim' if r['ok'] else 'não'}** ({r['why']}) |")


if __name__ == "__main__":
    main()
