#!/usr/bin/env python3
"""Modo Foco lab, test 27 (2026-11-06): TrackNetV3 (MIT, github.com/qaz812345/TrackNetV3) as the ball detector, with
no retraining. TrackNet sees 8 consecutive frames plus the clip's median background and outputs a heatmap of the ball
per frame; it was trained on broadcast badminton (the shuttlecock), so this measures whether "many frames at once"
already finds a small, fast basketball better than a single-frame detector (YOLOX, tests 17 and 26).

Input: the clip's analysis window decoded at --fps (30, TrackNet's training rate), upright, RGB. Windows ("views"):
  full   the whole frame resized to 512x288 (TrackNet's input; a portrait frame is squashed 3.2x horizontally)
  tiles  16:9 windows at native scale: landscape = the whole frame; portrait = 4 windows of W x W*9/16 stacked with
         overlap (each view gets its own median background)
Output: lab/tests/detect/<clip>.<tag>.json in ball_detect.py's format ({"frames": [[[cx, cy, w, h, score], ...] per
100 ms frame]}, whole-frame 0..1), every heatmap blob whose peak >= --keep, score = peak; so det_report.py's ceiling and
ball_track.py read it unchanged. TrackNet's own answer (its predict.py: the largest-area blob above 0.5) is stored first
in each frame; "top" says per frame whether there is one (0) or not (-1).

Weights: lab/models/tracknetv3/ckpts/TrackNet_best.pt from the official README link, always loaded with
torch.load(..., weights_only=True) (a .pt is a pickle; weights_only refuses anything but tensors).

    python3 tools/lab/tracknet_eval.py --view tiles --tag tn3-tiles [clip ...]
    python3 tools/lab/tracknet_eval.py --report --tag tn3-tiles [clip ...]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "detect")
SRC = os.path.join(ev.ROOT, "lab", "src", "TrackNetV3")
CKPT = os.path.join(ev.ROOT, "lab", "models", "tracknetv3", "ckpts", "TrackNet_best.pt")
TW, TH, SEQ = 512, 288, 8


def upright(video):
    st = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json",
                                    video], capture_output=True, text=True, check=True).stdout)["streams"][0]
    W, H = st["width"], st["height"]
    rot = int(st.get("tags", {}).get("rotate", 0))
    for side in st.get("side_data_list", []):
        if "rotation" in side:
            rot = int(side["rotation"])
    if abs(rot) % 180 == 90:
        W, H = H, W
    return W, H


def load_model(threads):
    import torch
    torch.set_num_threads(threads)
    sys.path.insert(0, SRC)
    from model import TrackNet  # noqa: E402  (TrackNetV3's model.py: plain nn.Module definitions)
    ck = torch.load(CKPT, map_location="cpu", weights_only=True)
    p = ck["param_dict"]
    assert p["seq_len"] == SEQ and p["bg_mode"] == "concat", p
    m = TrackNet(in_dim=(SEQ + 1) * 3, out_dim=SEQ)
    m.load_state_dict(ck["model"])
    m.eval()
    return m


def views(W, H, mode):
    """[(x, y, w, h)] windows in frame px."""
    if mode == "full" or W >= H:
        return [(0, 0, W, H)]
    vh = int(round(W * 9 / 16))
    n = int(np.ceil((H - vh) / (vh * 0.75))) + 1  # >= 25% overlap
    return [(0, int(round(i * (H - vh) / (n - 1))), W, vh) for i in range(n)]


def decode(video, start_ms, dur_ms, fps, W, H, wins=None):
    """Frames (RGB). With wins = [(x, y, w, h)]: per window, the frames resized to TrackNet's 512x288 (only those are
    kept in memory: a 30 s portrait clip at full resolution would not fit)."""
    import cv2
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{start_ms / 1000}", "-i", video, "-t",
                            f"{dur_ms / 1000}", "-vf", f"fps={fps}:start_time=0", "-f", "rawvideo", "-pix_fmt", "rgb24",
                            "-"], stdout=subprocess.PIPE)
    fb = W * H * 3
    out = [] if wins is None else [[] for _ in wins]
    while True:
        b = dec.stdout.read(fb)
        if len(b) < fb:
            break
        f = np.frombuffer(b, np.uint8).reshape(H, W, 3)
        if wins is None:
            out.append(f)
        else:
            for lst, (vx, vy, vw, vh) in zip(out, wins):
                lst.append(cv2.resize(f[vy:vy + vh, vx:vx + vw], (TW, TH), interpolation=cv2.INTER_AREA))
    dec.wait()
    return out


def blobs(hm, keep):
    """Heatmap (TH, TW) 0..1 -> [(cx, cy, w, h, peak, area)] in heatmap px, for blobs above 0.5 or, failing that,
    above `keep` (TrackNet thresholds at 0.5; lower peaks are kept as weak candidates)."""
    import cv2
    out = []
    for thr in (0.5, keep) if keep < 0.5 else (0.5,):
        mask = (hm >= thr).astype(np.uint8)
        n, lab, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            peak = float(hm[lab == i].max())
            if thr < 0.5 and peak >= 0.5:
                continue  # already found at 0.5
            out.append((float(cent[i][0]), float(cent[i][1]), float(w), float(h), peak, int(area)))
    return out


def run_clip(model, name, tag, mode, fps, keep, batch):
    import cv2
    import torch
    meta = ev.clip_meta(name)
    video = os.path.join(ev.ROOT, meta["video"])
    W, H = upright(video)
    t0 = time.time()
    wins = views(W, H, mode)
    per_view = decode(video, meta["startMs"], meta["durMs"], fps, W, H, wins)
    nframes = len(per_view[0])
    n100 = meta["count"]
    want = {k: min(nframes - 1, int(round(k * 0.1 * fps))) for k in range(n100)}  # 100 ms grid -> frame index
    need = set(want.values())
    per = {i: [] for i in need}  # frame index -> candidates in frame px
    top = {i: None for i in need}
    for (vx, vy, vw, vh), small in zip(wins, per_view):
        idx = np.linspace(0, len(small) - 1, min(len(small), 120)).astype(int)
        med = np.median(np.stack([small[i] for i in idx]), 0).astype(np.uint8)
        medc = np.moveaxis(med, -1, 0).astype(np.float32) / 255.0
        starts = list(range(0, len(small), SEQ))
        for b0 in range(0, len(starts), batch):
            xs, seqs = [], []
            for s in starts[b0:b0 + batch]:
                ids = [min(s + j, len(small) - 1) for j in range(SEQ)]  # pad the tail with the last frame
                if not any(i in need for i in ids[: len(small) - s]):
                    continue
                x = np.concatenate([medc] + [np.moveaxis(small[i], -1, 0).astype(np.float32) / 255.0 for i in ids])
                xs.append(x)
                seqs.append(ids)
            if not xs:
                continue
            with torch.no_grad():
                y = model(torch.from_numpy(np.stack(xs))).numpy()  # (B, SEQ, TH, TW), sigmoid
            for ids, hms in zip(seqs, y):
                seen = set()
                for i, hm in zip(ids, hms):
                    if i not in need or i in seen:
                        continue
                    seen.add(i)
                    sx, sy = vw / TW, vh / TH
                    for cx, cy, w, h, peak, area in blobs(hm, keep):
                        c = (vx + cx * sx, vy + cy * sy, w * sx, h * sy, peak, area * sx * sy)
                        per[i].append(c)
                        if peak >= 0.5 and (top[i] is None or c[5] > top[i][5]):
                            top[i] = c
    secs = time.time() - t0
    R = 0.012 * max(W, H)  # the same blob seen by two overlapping views -> keep the stronger one
    out, tops = [], []
    for k in range(n100):
        i = want[k]
        cand = sorted(per[i], key=lambda c: -c[4])
        keep_ = []
        for c in cand:
            if all((c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 > R * R for d in keep_):
                keep_.append(c)
        t = top[i]
        if t is not None:  # TrackNet's own answer first
            keep_ = [t] + [c for c in keep_ if (c[0] - t[0]) ** 2 + (c[1] - t[1]) ** 2 > R * R]
        tops.append(0 if t is not None else -1)
        out.append([[round(c[0] / W, 4), round(c[1] / H, 4), round(max(c[2], 1) / W, 4), round(max(c[3], 1) / H, 4),
                     round(c[4], 3)] for c in keep_])
    os.makedirs(OUT, exist_ok=True)
    json.dump({"clip": name, "tag": tag, "size": [W, H], "view": mode, "views": len(views(W, H, mode)), "fps": fps,
               "keep": keep, "seconds": round(secs, 1), "decoded": nframes, "frames": out, "top": tops},
              open(os.path.join(OUT, f"{name}.{tag}.json"), "w"))
    return nframes, secs


def report(tag, clips):
    """Per clip on the labelled samples: the ceiling (some blob within the lab radius of the labelled ball; any blob
    kept, and blobs >= 0.5 only), how often TrackNet gives an answer, how often that answer is on the ball, and its
    false alarms (an answer where the label says no ball). Writes lab/tests/detect/report.<tag>.md."""
    lines = [f"TrackNetV3 without retraining ({tag}) vs YOLOX-Tiny two stages (tiny-n-a3k2), basketball", "",
             "| Clip | pts | ceiling: any blob | ceiling: blob >= 0.5 | TrackNet answer given | on the ball | "
             "false alarm | YOLOX-Tiny ceiling | s |", "|---|---|---|---|---|---|---|---|---|"]
    for name in clips:
        p = os.path.join(OUT, f"{name}.{tag}.json")
        if not os.path.exists(p):
            continue
        d = json.load(open(p))
        t = ev.load_truth(name)
        R = ev.radius_px(t["size"])
        yp = os.path.join(OUT, f"{name}.tiny-n-a3k2.json")
        y = json.load(open(yp))["frames"] if os.path.exists(yp) else None
        pts = hit = hit5 = given = on = fa = nb = ypts = yhit = 0
        for ms, g in t["samples"].items():
            k = ms // 100
            if k >= len(d["frames"]):
                continue
            fr = d["frames"][k]
            ans = d["top"][k] == 0
            if isinstance(g, tuple):
                pts += 1
                hit += any(ev._dist_px(c[:2], g, t["size"]) <= R for c in fr)
                hit5 += any(c[4] >= 0.5 and ev._dist_px(c[:2], g, t["size"]) <= R for c in fr)
                given += ans
                on += ans and ev._dist_px(fr[0][:2], g, t["size"]) <= R
                if y is not None and k < len(y) and y[k] is not None:
                    ypts += 1
                    yhit += any(ev._dist_px(c[:2], g, t["size"]) <= R for c in y[k])
            else:
                nb += 1
                fa += ans
        f = lambda n, m: "—" if not m else f"{100 * n / m:.0f}%"  # noqa: E731
        lines.append(f"| {name} | {pts} | {f(hit, pts)} | {f(hit5, pts)} | {f(given, pts)} | {f(on, pts)} | "
                     f"{f(fa, nb)} | {f(yhit, ypts)} | {d['seconds']:.0f} |")
    text = "\n".join(lines) + "\n"
    print(text)
    open(os.path.join(OUT, f"report.{tag}.md"), "w").write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="only write the report of existing results")
    ap.add_argument("--tag", required=True)
    ap.add_argument("--view", choices=["full", "tiles"], default="tiles")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--keep", type=float, default=0.1, help="keep blobs whose heatmap peak >= this (score = peak)")
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--threads", type=int, default=2)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    if a.report:
        report(a.tag, a.clips)
        return
    model = load_model(a.threads)
    for name in a.clips:
        if os.path.exists(os.path.join(OUT, f"{name}.{a.tag}.json")) and not a.force:
            print(name, "done already", flush=True)
            continue
        n, secs = run_clip(model, name, a.tag, a.view, a.fps, a.keep, a.batch)
        print(f"{name}: {n} frames decoded, {secs:.0f} s", flush=True)


if __name__ == "__main__":
    main()
