#!/usr/bin/env python3
"""Modo Foco lab, test 51 (2026-11-10): which sport is a recording, with no question to the player? Victor: the app
must pick Seguir a Bola's model by itself (basketball or beach tennis); every other sport gets Modo Foco only.

Per clip, K frames spread over its window: both of the app's ball detectors (`ball_tiny_gym`, `ball_tiny_btpl`: the
whole frame + every 416 px tile, as the phone runs them) and YOLOX-Tiny COCO (person, sports ball, tennis racket; the
lab's stand-in for Vision's people, plus two classes the app does not have, measured only). Writes
lab/tests/sport/t51/<clip>.json. Clips: clips.txt and the web references in refs/ (ref-*), measured only.

    python3 tools/lab/sport_probe.py [--k 6] [--limit N] [name ...]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_detect as bd  # noqa: E402
import evaluate as ev  # noqa: E402

OUT = os.path.join(ev.ROOT, "lab", "tests", "sport", "t51")
REF_SPORT = {"basket": "basquete", "beach": "beachTennis", "beachvolei": "voleiPraia", "futvolei": "futevolei",
             "society": "society", "tabletennis": "tenisMesa", "tennis": "tenis", "volei": "volei"}


def clips():
    rows = []
    seen_videos = set()
    for line in open(os.path.join(HERE, "clips.txt")):
        if not line.strip() or line.startswith("#"):
            continue
        name, video, start, dur, sport = line.strip().split("|")[:5]
        rows.append({"name": name, "video": video, "startMs": int(start), "durMs": int(dur), "sport": sport})
        seen_videos.add(video)
    for f in sorted(os.listdir(os.path.join(ev.ROOT, "refs"))):
        m = re.match(r"ref-([a-z]+)-(\d+)-", f)
        if not m or f"refs/{f}" in seen_videos:
            continue
        rows.append({"name": f"ref-{m.group(1)}-{m.group(2)}", "video": f"refs/{f}", "startMs": 0, "durMs": 30000,
                     "sport": REF_SPORT.get(m.group(1), m.group(1)), "web": True})
    return rows


def frame_at(video, t, W, H):
    p = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1", "-f",
                        "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True)
    if len(p.stdout) < W * H * 3:
        return None
    return np.frombuffer(p.stdout[: W * H * 3], np.uint8).reshape(H, W, 3)


def detect(det, fr, tile):
    H, W = fr.shape[:2]
    T = bd.tiles(W, H, tile)
    res = det.run([fr] + [fr[y:y + tile, x:x + tile] for x, y in T], 0.05)
    cand = list(res[0])
    for (x, y), rr in zip(T, res[1:]):
        cand += [(cx + x, cy + y, w, h, s) for cx, cy, w, h, s in rr]
    return [[round(cx / W, 4), round(cy / H, 4), round(w / W, 4), round(h / H, 4), round(s, 3)]
            for cx, cy, w, h, s in bd.nms(cand)]


class Coco(bd.Yolox):
    """YOLOX COCO with three classes kept: person (0), sports ball (32), tennis racket (38)."""

    def run3(self, imgs, conf):
        out = {0: [], 32: [], 38: []}
        for cls in out:
            self.cls = cls
            out[cls] = self.run(imgs, conf)
        return out


def coco(det, fr):
    H, W = fr.shape[:2]
    T = bd.tiles(W, H, 640)
    crops = [fr] + [fr[y:y + 640, x:x + 640] for x, y in T]
    res = {}
    for cls, name in ((0, "person"), (32, "ball"), (38, "racket")):
        det.cls = cls
        rr = det.run(crops, 0.25)
        cand = list(rr[0])
        for (x, y), r in zip(T, rr[1:]):
            cand += [(cx + x, cy + y, w, h, s) for cx, cy, w, h, s in r]
        res[name] = [[round(cx / W, 4), round(cy / H, 4), round(w / W, 4), round(h / H, 4), round(s, 3)]
                     for cx, cy, w, h, s in bd.nms(cand)]
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="at most N new clips this run")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("names", nargs="*")
    a = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    models = os.path.join(ev.ROOT, "lab", "models")
    gym = bd.Yolox(os.path.join(models, "ball_tiny_gym.onnx"), a.threads)
    btpl = bd.Yolox(os.path.join(models, "ball_tiny_btpl.onnx"), a.threads)
    cc = bd.Yolox(os.path.join(models, "yolox_tiny.onnx"), a.threads)
    done = 0
    for c in clips():
        if a.names and c["name"] not in a.names:
            continue
        out = os.path.join(OUT, f"{c['name']}.json")
        if os.path.exists(out):
            continue
        video = os.path.join(ev.ROOT, c["video"])
        if not os.path.exists(video):
            print("missing", c["name"])
            continue
        W, H = bd.upright(video)
        dur = float(json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                               "json", video], capture_output=True, text=True).stdout)["format"]["duration"])
        t0 = c["startMs"] / 1000
        t1 = min(dur, t0 + c["durMs"] / 1000)
        ts = [t0 + (t1 - t0) * (i + 0.5) / a.k for i in range(a.k)]
        frames = []
        for t in ts:
            fr = frame_at(video, t, W, H)
            if fr is None:
                continue
            frames.append({"t": round(t, 2), "gym": detect(gym, fr, 416), "btpl": detect(btpl, fr, 416),
                           **coco(cc, fr)})
        json.dump({**c, "size": [W, H], "frames": frames}, open(out, "w"))
        print(c["name"], c["sport"], len(frames), flush=True)
        done += 1
        if a.limit and done >= a.limit:
            break


if __name__ == "__main__":
    main()
