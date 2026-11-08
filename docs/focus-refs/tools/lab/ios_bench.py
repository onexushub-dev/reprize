#!/usr/bin/env python3
"""Modo Foco lab, iPhone step 2: the FocusBench test app (tools/lab/ios-bench), its data and its results.

FocusBench is a throwaway iOS app, separate from Lance, that runs the four EdgeTAM Core ML models of step 1 with the
same tracking loop as coreml_export.py's `track`, on the ROI crops of a few clips, and times every model on the phone.

    # on the Mac, before building the app in Xcode: models + clips -> ios-bench/FocusBench/Data/ (not in git)
    lab/.venv-edgetam/bin/python tools/lab/ios_bench.py prepare
    # after a run on the phone: put the exported .json files in lab/tests/ios/, then
    lab/.venv-edgetam/bin/python tools/lab/ios_bench.py results

`results` scores each phone track as the Mac runs were scored (share of the clip in ball mode with the round-6
filters, hits on the labelled clips, agreement with the Mac's Core ML track) and saves it as a oneclick track
(`edgetam-ios-<device>-<units>-roi40b`), so hybrid.py can render its framing video.
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import shutil
import subprocess
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import evaluate as ev  # noqa: E402
import server as S  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "ios-bench", "FocusBench", "Data")
COREML = os.path.join(ev.ROOT, "lab", "coreml")
TESTS = os.path.join(ev.ROOT, "lab", "tests")
CLIPS = ("yt-basket-04", "bt-wa-1028", "yt-bt-06")
REFS = ("coreml_ne_fp16", "official")


def load_masks(path):
    z = np.load(path)
    h, w = z["shape"]
    bits = np.unpackbits(z["bits"], axis=-1)[..., :w].astype(bool)
    return {int(f): bits[i] for i, f in enumerate(z["frames"])}


def seed_in_crop(clip, variant):
    from oneclick import roi_point

    truth = ev.load_truth(clip)
    seed = [p for p in truth["prompts"] if not p.get("neg")][0]
    with open(os.path.join(ev.FRAMES, f"{clip}@{variant}", "roi.json")) as f:
        roi = json.load(f)
    k = int(round(seed["ms"] / 100))
    return roi_point(seed, roi, k), k, roi, seed


def cmd_prepare(a):
    with open(os.path.join(COREML, "edgetam_constants.json")) as f:
        if "attention.partial" not in json.load(f).get("self_test", {}):
            sys.exit("lab/coreml holds the old models: run `EXPORT=1 bash tools/lab/coreml-mac.sh` first")
    if os.path.isdir(DATA):
        shutil.rmtree(DATA)
    os.makedirs(DATA)
    for k in ("encoder", "attention", "decoder", "memory"):
        shutil.copytree(os.path.join(COREML, f"edgetam_{k}.mlpackage"), os.path.join(DATA, f"edgetam_{k}.mlpackage"))
    variants = sorted(x[len("edgetam_attention_"):-len(".mlpackage")] for x in os.listdir(COREML)
                      if x.startswith("edgetam_attention_") and x.endswith(".mlpackage"))
    for v in variants:  # export --only attention --variants: probed side by side in the app
        shutil.copytree(os.path.join(COREML, f"edgetam_attention_{v}.mlpackage"),
                        os.path.join(DATA, f"edgetam_attention_{v}.mlpackage"))
    shutil.copy(os.path.join(COREML, "edgetam_constants.json"), DATA)
    # lab test 17: the per-frame ball detector (YOLOX-S COCO, made in the cloud workspace with coremltools)
    # test 19: also YOLOX-Tiny / Nano (tools/lab/yolox_coreml.py)
    # test 34: and the lab's one-class ball detectors (yolox_coreml.py --ball ball_tiny_hn -> ball_tiny_hn.mlpackage)
    balls = sorted(x[:-len(".mlpackage")] for x in os.listdir(COREML) if x.startswith("ball_") and x.endswith(".mlpackage"))
    for name in ("yolox_s", "yolox_tiny", "yolox_nano", *balls):
        if os.path.isdir(os.path.join(COREML, f"{name}.mlpackage")):
            shutil.copytree(os.path.join(COREML, f"{name}.mlpackage"), os.path.join(DATA, f"{name}.mlpackage"))
    done = []
    for clip in a.clips:
        src = os.path.join(ev.FRAMES, f"{clip}@{a.variant}")
        if not os.path.isdir(src):
            print(f"skip {clip}: no {src}")
            continue
        seed, s, roi, seed_whole = seed_in_crop(clip, a.variant)
        if seed["kind"] != "point":
            print(f"skip {clip}: box seed (the app takes a click)")
            continue
        names = sorted(x for x in os.listdir(src) if x.endswith(".jpg"))
        for i, x in enumerate(names):
            shutil.copy(os.path.join(src, x), os.path.join(DATA, f"{clip}_{i:05d}.jpg"))
        refs = {}
        for r in REFS:
            p = os.path.join(TESTS, "coreml", f"{clip}@{a.variant}", f"{r}.npz")
            if os.path.exists(p):
                m = load_masks(p)
                refs[r] = [S.summarize(m[f], m[f].shape[1], m[f].shape[0]) if f in m else None
                           for f in range(len(names))]
        meta = ev.clip_meta(clip)
        # one pass (lab test 12): today's framing centre per frame (roi.py's "p" guide) and the Mac's one-pass track
        import hybrid as hb
        import roi as R

        pcx, pcy, _ = R.guide_path(clip, "p", None)
        players = [[round(float(x), 4), round(float(y), 4)] for x, y in zip(pcx, pcy)]
        one = os.path.join(TESTS, "oneclick", f"{clip}.ball.edgetam-torch-fp16-roi40f.json")
        if os.path.exists(one):
            with open(one) as f:
                po = json.load(f)["pred_one"]
            refs["single_mac"] = [po.get(str(i)) for i in range(len(names))]
        # the clip's window as a video, upright (ffmpeg applies the rotation), for the soak test's AVAssetReader
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{meta['startMs'] / 1000}",
                        "-i", os.path.join(ev.ROOT, meta["video"]), "-t", f"{meta['durMs'] / 1000}", "-an",
                        "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart", os.path.join(DATA, f"{clip}.mp4")], check=True)
        with open(os.path.join(DATA, f"{clip}.clip.json"), "w") as f:
            json.dump({"name": clip, "variant": a.variant, "sport": meta["sport"], "frames": len(names),
                       "side": roi["side"], "seedFrame": s, "seedXY": [round(seed["xy"][0], 5), round(seed["xy"][1], 5)],
                       "seedXYWhole": [round(seed_whole["xy"][0], 5), round(seed_whole["xy"][1], 5)],
                       "video": f"{clip}.mp4", "roiSize": roi["size"], "rois": roi["rois"], "players": players,
                       "racket": meta["sport"] in hb.RACKET_SPORTS,
                       "refs": refs}, f, separators=(",", ":"))
        done.append(clip)
        print(f"{clip}: {len(names)} frames of {roi['side']} px, click on frame {s}", flush=True)
    with open(os.path.join(DATA, "bench.json"), "w") as f:
        json.dump({"clips": done, "attentionVariants": variants}, f)
    mb = sum(os.path.getsize(os.path.join(r, x)) for r, _, fs in os.walk(DATA) for x in fs) / 1e6
    print(f"Data ready ({mb:.0f} MB): open tools/lab/ios-bench/FocusBench.xcodeproj in Xcode")


def agreement(a, b, side):
    d, mism = [], 0
    for p, q in zip(a, b):
        if (p is None) != (q is None):
            mism += 1
        elif p is not None:
            d.append(math.hypot((p[0] - q[0]) * side, (p[1] - q[1]) * side))
    return {"centroid_px_median": round(float(np.median(d)), 2) if d else None,
            "centroid_px_p95": round(float(np.percentile(d, 95)), 2) if d else None, "presence_mismatch": mism}


def passes(rows):
    """Median per-frame time of each pass over the soak's clips (rows of the optimised bench only)."""
    out = []
    for k in ("pass1Ms", "pass2Ms"):
        got = [x[k] for x in rows if isinstance(x.get(k), dict)]
        if not got:
            return "—"
        med = lambda key: float(np.median([g.get(key, 0) for g in got]))  # noqa: E731
        out.append(f"{med('frame'):.0f} ({med('prep'):.0f}, {med('loop'):.1f})")
    return " / ".join(out)


def work_ms(rows):
    """The last column: the ball passes, or (test 13, mode peopleflow) Vision flow + scaling ms per tick."""
    if "detS" in rows[0]:
        det = (f"detector {np.median([x['detS'] for x in rows]):.1f} s per clip "
               f"(model {np.median([x['detMs']['model'] for x in rows]):.1f} ms, prep "
               f"{np.median([x['detMs']['prep'] for x in rows]):.1f} ms per region"
               + (f", {np.median([x['detRegions'] for x in rows]):.1f} regions per frame" if "detRegions" in rows[0] else "")
               + ")")
        return det + ("; " + passes(rows) if "pass1S" in rows[0] else "")
    if "flowMsMedian" in rows[0]:
        return (f"flow {np.median([x['flowMsMedian'] for x in rows]):.1f} ms + scale "
                f"{np.median([x['flowScaleMsMedian'] for x in rows]):.1f} ms per tick")
    return passes(rows)


def cmd_results(a):
    from coreml_export import judge
    from oneclick import roi_back

    for p in sorted(glob.glob(os.path.join(TESTS, "ios", "probe.*.txt"))):
        print(open(p).read())
    soaks = sorted(glob.glob(os.path.join(TESTS, "ios", "soak.*.json")))
    if soaks:
        print("| Device | Work | Units | Brightness | Clips | Minutes | Battery used | Per clip | s per clip (first → last) "
              "| Heat at the end | vs Mac (pass 2, px / mismatches) | ms per frame, pass 1 / pass 2 (prep, loop) |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for p in soaks:
            with open(p) as f:
                r = json.load(f)
            rows = r["rows"]
            if not rows:
                continue
            used = rows[0]["batteryBefore"] - rows[-1]["batteryAfter"]
            mac = [x for x in rows if "vsMacPx" in x]
            macs = f"{np.median([x['vsMacPx'] for x in mac]):.1f} / {np.median([x['vsMacMismatch'] for x in mac]):.0f}" if mac else "—"
            states = {x["batteryState"] for x in rows}
            note = "" if states == {"unplugged"} else f" ({', '.join(sorted(states))}!)"
            print(f"| {r['device']} | {r['mode']} | {r['units']} | {r['brightness']} | {len(rows)} | {rows[-1]['elapsedMin']} "
                  f"| {used:.0f}%{note} | {used / len(rows):.2f}% | {rows[0]['seconds']} → {rows[-1]['seconds']} "
                  f"| {rows[-1]['thermalAfter']} | {macs} | {work_ms(rows)} |")
        print()
    files = sorted(p for p in glob.glob(os.path.join(TESTS, "ios", "*.json")) if not os.path.basename(p).startswith("soak."))
    if not files and soaks:
        return
    if not files:
        sys.exit("no phone results in lab/tests/ios/ (export them from FocusBench: Share, or Files > FocusBench)")
    rows = []
    for p in files:
        with open(p) as f:
            r = json.load(f)
        clip, variant = r["clip"], r.get("variant", "roi40b")
        with open(os.path.join(ev.FRAMES, f"{clip}@{variant}", "roi.json")) as f:
            roi = json.load(f)
        with open(os.path.join(DATA, f"{clip}.clip.json")) as f:
            cj = json.load(f)
        track = r["track"]
        if r.get("limitFrames"):
            rows.append((r, None, {}, None))
            continue
        pred_one = {str(i): (None if v is None else roi_back(v, roi, i)) for i, v in enumerate(track)}
        truth = ev.load_truth(clip)
        j = judge(clip, truth, pred_one)
        units = r["units"]
        tag = f"edgetam-ios-{r['device'].replace(',', '_')}-{units}-{variant}"
        with open(os.path.join(TESTS, "oneclick", f"{clip}.ball.{tag}.json"), "w") as f:
            json.dump({"clip": clip, "mode": "ball", "frames": len(track), "fps": 10, "source": "FocusBench " + p,
                       "pred_one": pred_one}, f, separators=(",", ":"))
        agree = {k: agreement(track, v, cj["side"]) for k, v in cj.get("refs", {}).items()}
        rows.append((r, j, agree, tag))
    print("| Device | Units | Clip | ms/frame (median) | encoder | attention | decoder | memory | prep+loop | "
          "first load s | Ball mode | On the ball | vs Mac Core ML (px, mismatches) | Thermal |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r, j, agree, tag in rows:
        m = r["msPerCall"]
        if j is None:
            j = {}
        mode = "quick run" if r.get("limitFrames") else f"{100 * j['ball_mode']:.0f}%"
        mac = agree.get("coreml_ne_fp16")
        mac = f"{mac['centroid_px_median']}, {mac['presence_mismatch']}" if mac else "—"
        hit = f"{100 * j['recall']:.0f}%" if j.get("recall") is not None else "—"
        print(f"| {r['device']} | {r['units']} | {r['clip']} | {r['msPerFrame']['median']} | {m['encoder']['median']} "
              f"| {m['attention']['median']} | {m['decoder']['median']} | {m['memory']['median']} "
              f"| {r['msPrep']['median'] + r['msLoop']['median']:.1f} | {sum(r['loadSeconds'].values()):.1f} "
              f"| {mode} | {hit} | {mac} | {' -> '.join(r['thermal'])} |")
    print("\nframing video of a phone track: lab/.venv/bin/python tools/lab/hybrid.py --model <tag> --tag v6-ios "
          "--render <clip>; tags:", ", ".join(sorted({t for *_, t in rows if t})))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare", help="copy the Core ML models and the clips' ROI frames into the app's Data folder")
    p.add_argument("clips", nargs="*", default=list(CLIPS))
    p.add_argument("--variant", default="roi40b")
    sub.add_parser("results", help="score the phone runs in lab/tests/ios/")
    a = ap.parse_args()
    if a.cmd == "prepare" and not a.clips:
        a.clips = list(CLIPS)
    {"prepare": cmd_prepare, "results": cmd_results}[a.cmd](a)


if __name__ == "__main__":
    main()
