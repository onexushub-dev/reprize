#!/usr/bin/env python3
"""Field clips without the phone's files (2026-11-12/13): the inputs the lab's beach tennis pipeline reads, from
people_yolox.py's boxes (the stand-in for Vision): renders/<clip>.people.json ("tiled", top-left boxes per analysed
frame) and lab/tests/framing/<clip>.current.focus.json (today's Jogadores framing, focus_variant.py's FocusPath port,
tuning v15, as focus_quality.py).

    python3 tools/lab/field_inputs.py bt-campo-1112-c bt-campo-1112-d
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import focus_quality as fq  # noqa: E402


def main():
    for name in sys.argv[1:]:
        meta = ev.clip_meta(name)
        W, H = meta["size"]
        yx = json.load(open(os.path.join(ev.ROOT, "lab", "tests", "detect", f"{name}.people-yx.json")))
        samples = []
        for k, row in enumerate(yx["frames"]):
            if row is None:
                continue
            tiled = [[round(b[0] - b[2] / 2, 6), round(b[1] - b[3] / 2, 6), b[2], b[3], b[4]] for b in row]
            samples.append({"t": k * fq.STEP, "tiled": tiled, "full": []})
        json.dump({"samples": samples, "summary": {"source": "people_yolox.py (stand-in for Vision)"}, "trajectories": []},
                  open(os.path.join(ev.ROOT, "renders", f"{name}.people.json"), "w"))
        end = meta["count"] * fq.STEP
        out = {"v": 1, "startMs": 0, "stepMs": fq.STEP, "size": [W, H]}
        for asp in ("landscape", "portrait"):
            r = fq.framing(samples, W, H, 0, end, asp, every=1)
            out[asp] = [[round(float(x), 6) for x in row] for row in r]
        json.dump(out, open(os.path.join(ev.ROOT, "lab", "tests", "framing", f"{name}.current.focus.json"), "w"))
        print(name, len(samples), "people frames,", len(out["portrait"]), "framing rows")


if __name__ == "__main__":
    main()
