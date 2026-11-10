#!/usr/bin/env python3
"""Test 45b (2026-11-09): the own clips' training crops with EVERY real ball marked, not only the one in play.

Test 45: fine-tuning the public beach tennis model with arena B's crops made it worse on arena A (detector ceiling
82 -> 54%): arena B (a class at night) has dozens of balls lying on the sand, and only the ball in play is labelled,
so the crops taught "a ball on the sand is not a ball" (the "not a ball" crops around the old detector's false
candidates were mostly those balls). The detector should find every ball; the path's still filter drops the lying
ones. Here a model (the public one) looks at each own crop at native scale and its confident balls (score >=
--min-score, after NMS) are added as positives; a crop that had no ball and gets one becomes a positive.

    python3 tools/lab/own_relabel.py --model lab/models/ball_tiny_btpub.onnx bt-own-a-01 ...
      -> lab/train/btpl-<clip>/items.json (the crops stay in lab/train/<clip>/)
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ball_detect as bd  # noqa: E402
import ball_train_pub as bt  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--min-score", type=float, default=0.4)
    ap.add_argument("--near", type=float, default=8.0, help="px: a found ball this close to a labelled one is that one")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    import cv2
    det = bd.Yolox(a.model, threads=2)
    for clip in a.clips:
        src = json.load(open(os.path.join(bt.TRAIN, clip, "items.json")))
        out, added, turned = [], 0, 0
        for it in src["items"]:
            img = cv2.imread(os.path.join(bt.TRAIN, clip, it["file"]))
            boxes = [list(b) for b in it["boxes"]]
            if img is not None:
                found = bd.nms(det.run([img], a.min_score)[0])
                for cx, cy, w, h, s in found:
                    if max(w, h) > 40:  # not a ball at the crops' scale
                        continue
                    if all(np.hypot(cx - b[0], cy - b[1]) > a.near for b in boxes):
                        boxes.append([cx, cy, max(w, 3.0), max(h, 3.0)])
                        added += 1
                        turned += 1 if not it["boxes"] and len(boxes) == 1 else 0
            out.append({"file": os.path.join("..", clip, it["file"]), "boxes": boxes})
        d = os.path.join(bt.TRAIN, f"btpl-{clip}")
        os.makedirs(d, exist_ok=True)
        json.dump({"clip": f"btpl-{clip}", "src": clip, "model": os.path.basename(a.model), "items": out},
                  open(os.path.join(d, "items.json"), "w"))
        npos = sum(1 for i in out if i["boxes"])
        print(f"btpl-{clip}: {len(out)} crops, {npos} with a ball ({sum(1 for i in src['items'] if i['boxes'])} before);"
              f" {added} balls added, {turned} 'not a ball' crops had one", flush=True)


if __name__ == "__main__":
    main()
