#!/usr/bin/env python3
"""Modo Foco lab, test 28 videos (2026-11-07): test 24's calm camera (sg_lazy3.py, unchanged) driven by the ball of
  - today's best path: COCO YOLOX-Tiny two stages + EdgeTAM from a tap (mix-tiny-n-a3k2)
  - the basketball YOLOX-Tiny of test 28 + EdgeTAM from a tap (mix-bpub-n-a3k2)
  - the basketball YOLOX-Tiny alone, no tap (det-bpub-n-a3k2)
next to today's Modo Foco (players only). Each panel's label carries its "ball inside the crop" share on the labelled
samples (sg_lazy2.score). The videos show 3 panels: Modo Foco today | today's ball (with a tap) | the basketball
detector with no tap (the trained + EdgeTAM camera is within 0-3 points of today's mix, so it adds nothing to see). Output lab/tests/sg/<clip>.lazy3-t28.mp4 (vertical clip -> 9:16 panels side by side,
horizontal -> 16:9 panels stacked) and lab/tests/sg/lazy3-summary-t28.md.

    python3 tools/lab/compare28.py [clip ...]            # summary only
    python3 tools/lab/compare28.py --render [clip ...]   # + videos
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sg_lazy2 as l2  # noqa: E402
import sg_lazy3 as l3  # noqa: E402

ENGINES = [("mix-tiny-n-a3k2", "Hoje: YOLOX COCO + EdgeTAM"), ("mix-bpub-n-a3k2", "Treinado + EdgeTAM"),
           ("det-bpub-n-a3k2", "Treinado, sem toque")]
CLIPS = ["basket-rp-1105-h", "yt1105-basket-a", "basket-rp-1105-v-b", "yt-basket-04", "basket-rp-1105-v-a",
         "basket-v-01", "yt1105-basket-b"]


def scores(name):
    meta, truth, n, cur, asp = l3.load(name, "native")
    out = [("Modo Foco hoje", l2.score(l3.today_rects(name, "native"), truth, n))]
    for tag, label in ENGINES:
        out.append((label, l2.score(l3.rects_for(name, tag, meta, truth, n, cur), truth, n)))
    return asp, truth, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", action="store_true")
    ap.add_argument("clips", nargs="*")
    a = ap.parse_args()
    clips = a.clips or CLIPS
    lines = ["# Test 28 videos — calm camera (test 24) driven by today's ball vs the basketball detector", "",
             "Ball inside the crop on the labelled samples; direction changes per 10 s in brackets.", "",
             "| Clip | Output | pts | Modo Foco today | " + " | ".join(lbl for _, lbl in ENGINES) + " |",
             "|---|---|---|---|" + "---|" * len(ENGINES)]
    for name in clips:
        asp, truth, sc = scores(name)
        lines.append(f"| {name} | {asp} | {sc[0][1]['pts']} | "
                     + " | ".join(f"{s['in']:.0%} ({s['flips']:.1f})" for _, s in sc) + " |")
        print(lines[-1], flush=True)
        if a.render:  # the trained + EdgeTAM camera is within 0-3 points of today's mix: left out of the videos
            l2.ENGINES = [(tag, f"{label} - bola {s['in']:.0%}") for (tag, label), (_, s) in zip(ENGINES, sc[1:])
                          if tag != "mix-bpub-n-a3k2"]
            l3.ONLY = None
            l3.render(name, "native", "-t28")
    os.makedirs(l3.OUT, exist_ok=True)
    with open(os.path.join(l3.OUT, "lazy3-summary-t28.md"), "w") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
