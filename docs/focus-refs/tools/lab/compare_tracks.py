#!/usr/bin/env python3
"""Modo Foco lab, test 19: two ball framings side by side (hybrid.py focus files), e.g. the test 17 mix (YOLOX-S, all
tiles) vs the test 19 mix (YOLOX-Tiny, 416 tiles, two stages), both with v_keep=0.2.

    python3 tools/lab/compare_tracks.py --a mix-keep --b mix-tiny --model-b mix-tiny-n-a3k2 [clip ...]
    -> lab/tests/framing/<clip>.compare.<a>-vs-<b>.mp4
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402
import hybrid as hb  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", default="mix-keep", help="hybrid.py tag shown first (orange)")
    ap.add_argument("--b", default="mix-tiny", help="hybrid.py tag shown second (green)")
    ap.add_argument("--model-b", default="mix-tiny-n-a3k2", help="ball track of b (dot and BOLA label)")
    ap.add_argument("--label-a", default="S, todos os recortes")
    ap.add_argument("--label-b", default="Tiny, 2 etapas")
    ap.add_argument("clips", nargs="+")
    a = ap.parse_args()
    for name in a.clips:
        meta = ev.clip_meta(name)
        truth = ev.load_truth(name)
        aspect = "portrait" if truth["size"][1] > truth["size"][0] else "landscape"
        ra = json.load(open(os.path.join(hb.OUT, f"{name}.hybrid.{a.a}.focus.json")))[aspect]
        rb = json.load(open(os.path.join(hb.OUT, f"{name}.hybrid.{a.b}.focus.json")))[aspect]
        n = meta["count"]
        oc = json.load(open(os.path.join(hb.TESTS, "oneclick", f"{name}.ball.{a.model_b}.json")))
        tr = hb.trusted(oc["pred_one"], n, truth["size"], meta["sport"])
        mode = [tr[i] is not None for i in range(n)]
        out = os.path.join(hb.OUT, f"{name}.compare.{a.a}-vs-{a.b}.mp4")
        hb.render(name, meta, ra, rb, tr, mode, truth, out, labels=(a.label_a, a.label_b),
                  legend=f"laranja: {a.label_a}  verde: {a.label_b}  ponto: bola ({a.label_b})  anel: gabarito")
        print(name, "->", os.path.relpath(out, ev.ROOT), flush=True)


if __name__ == "__main__":
    main()
