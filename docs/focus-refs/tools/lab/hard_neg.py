#!/usr/bin/env python3
"""Modo Foco lab, test 32 (2026-11-08): "not a ball" examples for the basketball detector, after
basket-app-1107-a (test 31) showed test 28's model following a bald head and a yellow shirt for ~3 s while the real
ball was dribbled low elsewhere.

  public  heads and torsos of the public dataset's "person" boxes (cvsense, CC BY 4.0), cut at the scale the ball
          crops use (a head 8-32 px), as 320x320 crops; a ball box that falls inside a crop is kept as a positive box
          -> lab/train/neg-<name>/items.json
  mine    the detector's own false candidates on our LABELLED clips: score >= --min-score and farther than 3 lab radii
          from the labelled ball, on frames where the label says where the ball is, except still objects (seen at the
          same place on >= 30% of the labelled frames: spare balls on the floor, the rim) -> lab/train/fp-<clip>/
          items.json (per clip, so ball_train_pub.py --fp adds only the training fold's clips)
  heads   the head filter (test 32B): candidates inside the head zone of a person box (Vision people, the boxes today's
          Modo Foco already has) get their score x --factor; a candidate above the head (a shot) is untouched
          -> lab/tests/detect/<clip>.<out>.json

    python3 tools/lab/hard_neg.py public --src lab/datasets/basketball_detection-lbacg --name lbacg
    python3 tools/lab/hard_neg.py mine --tag bpub-n5 basket-rp-1105-v-a ...
    python3 tools/lab/hard_neg.py heads --det bpub-n-a3k2 --out bpub-hf-n-a3k2 clip ...
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_train_pub as bt  # noqa: E402
import evaluate as ev  # noqa: E402

DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
CROP = bt.CROP
# Vision people file per clip (renders/<x>.people.json); files made before 2026-10-28 have broken "tiled" boxes
PEOPLE = {"basket-rp-1105-h": "basket-rp-1105-h", "basket-rp-1105-v-a": "basket-rp-1105-v-a",
          "basket-rp-1105-v-b": "basket-rp-1105-v-b", "yt-basket-04": "yt-FVUuK2ZGQtw-1m",
          "yt1105-basket-a": "yt1105-basket-a", "yt1105-basket-b": "yt1105-basket-b",
          "basket-app-1107-a": "basket-app-1107-a", "basket-app-1107-b": "basket-app-1107-b",
          "basket-app-1107-c": "basket-app-1107-c", "basket-app-1107-d": "basket-app-1107-d"}


def cmd_public(a):
    import cv2
    rng = random.Random(1)
    d = os.path.join(bt.TRAIN, f"neg-{a.name}")
    os.makedirs(d, exist_ok=True)
    items = []
    for split, ann, read in bt.coco_sets(a.src):
        cats = {c["id"]: c["name"].lower() for c in ann["categories"]}
        by = {}
        for an in ann["annotations"]:
            by.setdefault(an["image_id"], []).append((cats[an["category_id"]], an["bbox"]))
        imgs = ann["images"]
        rng.shuffle(imgs)
        for im in imgs:
            if len(items) >= a.limit:
                break
            objs = by.get(im["id"], [])
            # upright people only: the dataset rotates a third of its images by 90 degrees, and on a rotated person the
            # top of the box is not the head
            people = [b for c, b in objs if c == "person" and b[3] > 40 and b[3] > 1.3 * b[2]]
            balls = [b for c, b in objs if c == "ball"]
            if not people:
                continue
            img = cv2.imdecode(np.frombuffer(read(im["file_name"]), np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            H0, W0 = img.shape[:2]
            p = rng.choice(people)
            part = rng.random()
            # a head is ~1/7 of the person's height; a torso point at ~35% of it
            cxo = p[0] + p[2] / 2
            cyo = p[1] + p[3] * (0.07 if part < 0.6 else 0.35)
            head = p[3] / 7
            s = min(max(rng.uniform(*bt.BALL_PX) / max(head, 1.0), 0.08), 2.0)
            big = cv2.resize(img, (max(1, int(W0 * s)), max(1, int(H0 * s))),
                             interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
            x0 = int(cxo * s - rng.uniform(0.2, 0.8) * CROP)
            y0 = int(cyo * s - rng.uniform(0.2, 0.8) * CROP)
            crop = np.full((CROP, CROP, 3), 114, np.uint8)
            sx0, sy0 = max(x0, 0), max(y0, 0)
            sx1, sy1 = min(x0 + CROP, big.shape[1]), min(y0 + CROP, big.shape[0])
            if sx1 <= sx0 or sy1 <= sy0:
                continue
            crop[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = big[sy0:sy1, sx0:sx1]
            boxes = []
            for b in balls:  # a real ball inside the crop stays a positive
                bx, by_ = (b[0] + b[2] / 2) * s - x0, (b[1] + b[3] / 2) * s - y0
                if 0 <= bx < CROP and 0 <= by_ < CROP and max(b[2], b[3]) * s >= 3:
                    boxes.append([bx, by_, max(b[2] * s, 3.0), max(b[3] * s, 3.0)])
            fn = f"{len(items):06d}-{'h' if part < 0.6 else 't'}.jpg"
            cv2.imwrite(os.path.join(d, fn), crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
            items.append({"file": fn, "boxes": boxes})
    json.dump({"clip": f"neg-{a.name}", "src": a.src, "items": items}, open(os.path.join(d, "items.json"), "w"))
    print(f"neg-{a.name}: {len(items)} crops ({sum(1 for i in items if not i['boxes'])} without a ball)")


def cmd_mine(a):
    import cv2
    for name in a.clips:
        meta = ev.clip_meta(name)
        truth = ev.load_truth(name)
        R = ev.radius_px(truth["size"])
        frames = json.load(open(os.path.join(DET, f"{name}.{a.tag}.json")))["frames"]
        labelled = [(ms // 100, g) for ms, g in truth["samples"].items()
                    if isinstance(g, tuple) and ms // 100 < len(frames) and frames[ms // 100]]
        everywhere = [c for k, _ in labelled for c in frames[k]]

        def static(c):
            """Seen at the same place on >= 30% of the labelled frames: a spare ball lying on the floor, the rim, a
            lamp — still objects the ball path already ignores; a spare ball IS a ball, so it is not taught as one."""
            near = sum(1 for o in everywhere if ev._dist_px(o[:2], c[:2], truth["size"]) <= R)
            return near >= 0.3 * len(labelled)

        want = {}
        skipped = 0
        for k, g in labelled:
            bad = [c for c in frames[k] if c[4] >= a.min_score and ev._dist_px(c[:2], g, truth["size"]) > 3 * R]
            keep = [c for c in bad if not static(c)]
            skipped += len(bad) - len(keep)
            if keep:
                want[k] = keep
        d = os.path.join(bt.TRAIN, f"fp-{name}")
        os.makedirs(d, exist_ok=True)
        items = []
        cap = cv2.VideoCapture(os.path.join(ev.ROOT, meta["video"]))
        for k, bad in sorted(want.items()):
            cap.set(cv2.CAP_PROP_POS_MSEC, meta["startMs"] + k * 100)
            ok, fr = cap.read()
            if not ok:
                continue
            H, W = fr.shape[:2]
            g = truth["samples"][k * 100]
            for c in bad:
                x, y = c[0] * W, c[1] * H
                x0 = int(min(max(x - CROP / 2, 0), W - CROP))
                y0 = int(min(max(y - CROP / 2, 0), H - CROP))
                crop = fr[y0:y0 + CROP, x0:x0 + CROP]
                if crop.shape[:2] != (CROP, CROP):
                    continue
                boxes = []
                gx, gy = g[0] * W - x0, g[1] * H - y0  # the real ball, if it falls in the crop
                if 0 <= gx < CROP and 0 <= gy < CROP:
                    boxes.append([gx, gy, 0.015 * max(W, H), 0.015 * max(W, H)])
                fn = f"{len(items):05d}.jpg"
                cv2.imwrite(os.path.join(d, fn), crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
                items.append({"file": fn, "boxes": boxes, "score": c[4], "k": k})
        cap.release()
        json.dump({"clip": f"fp-{name}", "tag": a.tag, "items": items}, open(os.path.join(d, "items.json"), "w"))
        print(f"fp-{name}: {len(items)} false candidates (score >= {a.min_score}) on {len(want)} labelled frames; "
              f"{skipped} still ones left out")


def people_at(name, n):
    """Per 100 ms frame of the clip's window: person boxes [x, y, w, h] (top-left, normalized), or None."""
    pf = PEOPLE.get(name)
    if not pf:
        return None
    p = os.path.join(ev.ROOT, "renders", f"{pf}.people.json")
    if not os.path.exists(p):
        return None
    d = json.load(open(p))
    key = "tiled" if (d.get("summary") or {}).get("tilesFixed") else "full"
    samples = d["samples"]
    ts = np.array([s["t"] for s in samples])
    start = ev.clip_meta(name)["startMs"]
    out = []
    for k in range(n):
        i = int(np.argmin(np.abs(ts - (start + k * 100))))
        out.append(samples[i][key] if abs(ts[i] - (start + k * 100)) <= 150 else [])
    return out


def in_head(c, b):
    """Candidate centre inside the head zone of person box b: the top ~22% of the box, its middle 80% in x (a ball held
    or shot ABOVE the head is outside)."""
    x, y, w, h = b[:4]
    return x + 0.1 * w <= c[0] <= x + 0.9 * w and y - 0.03 * h <= c[1] <= y + 0.22 * h


def cmd_heads(a):
    for name in a.clips:
        src = json.load(open(os.path.join(DET, f"{name}.{a.det}.json")))
        frames = src["frames"]
        ppl = people_at(name, len(frames))
        hit = tot = 0
        out = []
        for k, fr in enumerate(frames):
            if fr is None or ppl is None:
                out.append(fr)
                continue
            new = []
            for c in fr:
                tot += 1
                if any(in_head(c, b) for b in ppl[k] if b[3] >= 0.05):
                    hit += 1
                    c = c[:4] + [round(c[4] * a.factor, 4)] + c[5:]
                new.append(c)
            out.append(new)
        src["frames"] = out
        src["head_filter"] = {"factor": a.factor, "people": PEOPLE.get(name), "down": hit, "of": tot}
        json.dump(src, open(os.path.join(DET, f"{name}.{a.out}.json"), "w"))
        print(f"{name}: {hit}/{tot} candidates on a head" + ("" if ppl is not None else " (no people file: unchanged)"))


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("public")
    p.add_argument("--src", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--limit", type=int, default=5000)
    p = sub.add_parser("mine")
    p.add_argument("--tag", required=True)
    p.add_argument("--min-score", type=float, default=0.2)
    p.add_argument("clips", nargs="+")
    p = sub.add_parser("heads")
    p.add_argument("--det", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--factor", type=float, default=0.3)
    p.add_argument("clips", nargs="+")
    a = ap.parse_args()
    {"public": cmd_public, "mine": cmd_mine, "heads": cmd_heads}[a.cmd](a)


if __name__ == "__main__":
    main()
