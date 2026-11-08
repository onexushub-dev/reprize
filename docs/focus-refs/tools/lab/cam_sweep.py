#!/usr/bin/env python3
"""Modo Foco lab, test 29 (2026-11-07): a camera that MOVES with the ball. Test 24's calm camera (sg_lazy3.py) barely
moves on basketball: today's crop is 61-87% of the frame width (zoom 1.15-1.65x), so it has 13-39% of the width to
travel, and the 0.20 dead zone + heavy smoothing hold it still. This sweeps, offline:
  zoom   crop = min(today's crop, 1/zoom) in both orientations, centred where today's is (None = today's crop)
  dz     dead zone: the camera moves only when the ball leaves centre +- dz * crop width
  a, b   smoothing (1st / 2nd difference weights of sg_lazy3.band_path; test 24 = 10 / 1000)
  lead   anticipation: the x target is the ball `lead` s ahead (the replay is processed after the fact)
y as test 24 (players' height, rises only to keep the ball inside with a margin). Ball: the basketball detector of
test 28 alone, no tap (det-bpub-n-a3k2), or another oneclick track (--engine).

Scores per clip on the labelled samples: ball inside the crop, direction changes per 10 s (sg_lazy2.score), how far
the camera travels (sum of |dx| of the crop centre, in frame widths per 10 s), and how centred the ball is (mean
|ball x - crop centre x| / crop width: 0 = centred, 0.5 = on the edge). px = the output's short side when the
clip was recorded at 1080p (1080 * crop share: 540 = a 540p picture scaled up).

    python3 tools/lab/cam_sweep.py sweep                       # -> lab/tests/sg/cam-sweep-t29.md
    python3 tools/lab/cam_sweep.py render --clip yt1105-basket-a --cfg z2.0-dz0.10-s3-l0.4 [--cfg ...]
"""
from __future__ import annotations

import argparse
import itertools
import json
import os
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import hybrid  # noqa: E402
import sg_framing as sg  # noqa: E402
import sg_lazy2 as l2  # noqa: E402
import sg_lazy3 as l3  # noqa: E402

CLIPS = ["basket-rp-1105-h", "yt1105-basket-a", "yt1105-basket-b", "yt-basket-04", "basket-rp-1105-v-a",
         "basket-rp-1105-v-b", "basket-v-01"]
SMOOTH = {"s10": (10.0, 1000.0), "s3": (3.0, 300.0), "s1": (1.0, 100.0)}


def parse(cfg):
    """'z2.0-dz0.10-s3-l0.4' -> dict (z 'today' = today's crop)."""
    out = {}
    for part in cfg.split("-"):
        if part.startswith("dz"):
            out["dz"] = float(part[2:])
        elif part.startswith("z"):
            out["zoom"] = None if part[1:] == "today" else float(part[1:])
        elif part.startswith("s"):
            out["smooth"] = part
        elif part.startswith("l"):
            out["lead"] = float(part[1:])
    return out


def name_of(zoom, dz, smooth, lead):
    return f"z{'today' if zoom is None else f'{zoom:.2f}'}-dz{dz:.2f}-{smooth}-l{lead:.1f}"


def camera(name, engine, zoom, dz, smooth, lead):
    meta = ev.clip_meta(name)
    truth = ev.load_truth(name)
    n = meta["count"]
    with open(os.path.join(sg.TESTS, "framing", f"{name}.current.focus.json")) as f:
        fc = json.load(f)
    asp = "portrait" if truth["size"][1] > truth["size"][0] else "landscape"
    off = int(round((meta["startMs"] - fc["startMs"]) / 100))
    cur = np.array(fc[asp][off:off + n], dtype=float)
    n = min(n, len(cur))
    cur = cur[:n]
    if zoom:
        cx, cy = cur[:, 0] + cur[:, 2] / 2, cur[:, 1] + cur[:, 3] / 2
        w = np.minimum(cur[:, 2], 1 / zoom)
        h = np.minimum(cur[:, 3], 1 / zoom)
        cur = np.stack([np.clip(cx, w / 2, 1 - w / 2) - w / 2, np.clip(cy, h / 2, 1 - h / 2) - h / 2, w, h], 1)
    with open(os.path.join(sg.TESTS, "oneclick", f"{name}.ball.{engine}.json")) as f:
        oc = json.load(f)
    tr = hybrid.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
    L = int(round(lead * 10))
    if L:  # aim where the ball will be L frames (100 ms) later, when it is known then
        tr = [tr[i + L] if i + L < n and tr[i + L] is not None and tr[i] is not None else tr[i] for i in range(n)]
    isball = np.array([p is not None for p in tr])
    a, b = SMOOTH[smooth]
    rects = cur.copy()
    w_, cx_today = cur[:, 2], cur[:, 0] + cur[:, 2] / 2
    if w_.min() < 0.999:
        tx = sg.target_x([None if p is None else p[0] for p in tr], cx_today, 10, "hold")
        cx = l3.band_path(tx - dz * w_.mean(), tx + dz * w_.mean(), np.where(isball, 1.0, l3.WFB), cx_today, 0.0, a, b)
        cx = np.clip(cx, w_ / 2, 1 - w_ / 2)
        rects[:, 0] = cx - w_ / 2
    h_, cy_today = cur[:, 3], cur[:, 1] + cur[:, 3] / 2
    if h_.min() < 0.999:
        by = l3.bridged([None if p is None else p[1] for p in tr])
        lo = np.array([-np.inf if v is None else v - (0.5 - l3.BOTTOM) * h for v, h in zip(by, h_)])
        hi = np.array([np.inf if v is None else v + (0.5 - l3.TOP) * h for v, h in zip(by, h_)])
        cy = l3.band_path(lo, hi, np.ones(n), cy_today, l3.WA, a, b)
        cy = np.clip(cy, h_ / 2, 1 - h_ / 2)
        rects[:, 1] = cy - h_ / 2
    return meta, truth, n, rects, asp


def scores(truth, n, rects):
    s = l2.score(rects, truth, n)
    cx = rects[:, 0] + rects[:, 2] / 2
    travel = float(np.abs(np.diff(cx)).sum()) / (n / 100.0)  # frame widths per 10 s
    off = [abs(v[0] - cx[t // 100]) / rects[t // 100, 2] for t, v in truth["samples"].items()
           if isinstance(v, tuple) and t // 100 < n]  # empty for a clip without labels
    return {"in": s["in"], "flips": s["flips"], "travel": travel, "off": float(np.mean(off)) if off else None,
            "px": int(round(1080 * float(np.mean(rects[:, 2]))))}  # short side at 1080p


def cmd_sweep(a):
    rows = []
    zooms = [None, 1.5, 1.75, 2.0]
    for zoom, dz, smooth, lead in itertools.product(zooms, [0.20, 0.10, 0.05], ["s10", "s3", "s1"], [0.0, 0.4]):
        per = [scores(*camera(c, a.engine, zoom, dz, smooth, lead)[1:4]) for c in a.clips]
        m = {k: float(np.mean([p[k] for p in per])) for k in ("in", "flips", "travel", "off", "px")}
        m["in_min"] = min(p["in"] for p in per)
        rows.append((name_of(zoom, dz, smooth, lead), m, per))
    today = [scores(*l3.load(c, "native")[1:3], l3.today_rects(c, "native")) for c in a.clips]
    mt = {k: float(np.mean([p[k] for p in today])) for k in ("in", "flips", "travel", "off", "px")}
    lines = [f"# Test 29 — camera movement sweep, ball = {a.engine}, {len(a.clips)} basketball clips", "",
             "Means over the clips. in = ball inside the crop (worst clip in brackets); flips = direction changes "
             "/10 s; travel = crop centre path, frame widths /10 s; off = |ball - centre| / crop width (0 centred, "
             "0.5 edge); px = output short side from a 1080p recording (540 = 540p scaled up).", "",
             "| Config | in (worst) | flips | travel | off | px |", "|---|---|---|---|---|---|",
             f"| Modo Foco today (players) | {mt['in']:.0%} ({min(p['in'] for p in today):.0%}) | {mt['flips']:.1f} "
             f"| {mt['travel']:.2f} | {mt['off']:.2f} | {mt['px']:.0f} |"]
    for cfg, m, _ in rows:
        lines.append(f"| {cfg} | {m['in']:.0%} ({m['in_min']:.0%}) | {m['flips']:.1f} | {m['travel']:.2f} "
                     f"| {m['off']:.2f} | {m['px']:.0f} |")
    os.makedirs(l3.OUT, exist_ok=True)
    p = os.path.join(l3.OUT, f"cam-sweep-t29{a.suffix}.md")
    open(p, "w").write("\n".join(lines) + "\n")
    json.dump({"engine": a.engine, "clips": a.clips, "today": today,
               "rows": [{"cfg": c, "mean": m, "per": per} for c, m, per in rows]},
              open(os.path.join(l3.OUT, f"cam-sweep-t29{a.suffix}.json"), "w"))
    print("\n".join(lines[:8]))
    print(f"... {len(rows)} configs -> {os.path.relpath(p, ev.ROOT)}")


def cmd_render(a):
    import cv2
    name = a.clip
    meta, truth, n, _, asp = l3.load(name, "native")
    today = l3.today_rects(name, "native")
    pct = lambda s: "" if s["in"] is None else f" - bola {s['in']:.0%}"  # noqa: E731  (clips without labels: no %)
    cams = [(f"Hoje (Modo Foco){pct(scores(truth, n, today))}", today)]
    for cfg in a.cfg:
        p = parse(cfg)
        r = camera(name, a.engine, p.get("zoom"), p["dz"], p["smooth"], p["lead"])[3]
        s = scores(truth, n, r)
        label = a.labels[len(cams) - 1] if a.labels else cfg
        cams.append((f"{label}{pct(s)}", r))
    cap = cv2.VideoCapture(os.path.join(ev.ROOT, meta["video"]))
    fps = cap.get(cv2.CAP_PROP_FPS)
    cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"])
    portrait = asp == "portrait"
    pw, ph = (540, 960) if portrait else (960, 540)
    size = (pw * len(cams), ph) if portrait else (pw * 2, ph * ((len(cams) + 1) // 2))
    tmp = os.path.join(l3.OUT, f".{name}.t29.tmp.mp4")
    out = cv2.VideoWriter(tmp, cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    grid = np.arange(n) * 0.1
    k = 0
    while k / fps <= grid[-1]:
        ok, fr = cap.read()
        if not ok:
            break
        H, W = fr.shape[:2]
        panels = []
        for label, r in cams:
            x, y, w, h = (float(np.interp(k / fps, grid, r[:, j])) for j in range(4))
            x0, y0 = int(round(x * W)), int(round(y * H))
            crop = cv2.resize(fr[y0:y0 + max(2, int(round(h * H))), x0:x0 + max(2, int(round(w * W)))], (pw, ph))
            for col, th in (((0, 0, 0), 4), ((255, 255, 255), 2)):
                cv2.putText(crop, label, (12, 34), cv2.FONT_HERSHEY_SIMPLEX, 0.8, col, th, cv2.LINE_AA)
            panels.append(crop)
        if portrait:
            frame = np.hstack(panels)
        else:  # 2 columns
            if len(panels) % 2:
                panels.append(np.zeros_like(panels[0]))
            frame = np.vstack([np.hstack(panels[i:i + 2]) for i in range(0, len(panels), 2)])
        out.write(frame)
        k += 1
    out.release()
    cap.release()
    dst = os.path.join(l3.OUT, f"{name}.cam-t29.mp4")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", tmp, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                    "-pix_fmt", "yuv420p", dst], check=True)
    os.remove(tmp)
    print(dst, k, "frames", asp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["sweep", "render"])
    ap.add_argument("--engine", default="det-bpub-n-a3k2")
    ap.add_argument("--clips", nargs="+", default=CLIPS)
    ap.add_argument("--suffix", default="")
    ap.add_argument("--clip")
    ap.add_argument("--cfg", action="append", default=[])
    ap.add_argument("--labels", nargs="*", default=None)
    a = ap.parse_args()
    {"sweep": cmd_sweep, "render": cmd_render}[a.cmd](a)


if __name__ == "__main__":
    main()
