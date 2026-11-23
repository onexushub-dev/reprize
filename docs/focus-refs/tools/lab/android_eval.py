#!/usr/bin/env python3
"""Modo Foco lab, Android: the evaluation on a phone (plan 2026-11-16, task 12), with the app's Diagnóstico buttons.

    push   <handoff dir>            the clips and clips.txt to the dev app's <external files>/eval/ (adb)
    ref    <handoff dir> <models>   the reference detections: the same frames, regions and decoding as the app, through
                                    Victor's ONNX on the Mac, written as <clip>.ref.balldet.json and pushed. Then tap
                                    "Referência (Mac)": the app frames each clip again with these detections and the
                                    phone's own people, so the two framings differ only by the ball detector's path.
    pull   <handoff dir> <out dir>  results and framing files back from the phone
    report <handoff dir> <out dir>  per clip: times, ball inside the 9:16 crop on the labels (phone / reference), how far
                                    the phone's crop is from the reference's; Markdown on stdout, report.json in <out dir>

Order: push -> "Avaliar clipes (Android)" -> ref -> "Referência (Mac)" -> pull -> report.
Needs adb, numpy, opencv-python-headless, onnxruntime. Run with python -I. Videos and results stay out of git.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys

import numpy as np

PKG = "app.reprize.dev"
REMOTE = f"/sdcard/Android/data/{PKG}/files/eval"
SIDE = 416
TILE = 416
MODELS = {"basquete": "ball_tiny_gym", "beachTennis": "ball_tiny_btpl"}


def clips(handoff: str):
    for line in open(os.path.join(handoff, "clips.txt")):
        if not line.strip() or line.startswith("#"):
            continue
        name, video, start, dur, sport, labels = line.strip().split("|")
        yield dict(name=name, video=video, start=float(start), end=float(start) + float(dur), sport=sport,
                   labels=None if labels == "-" else os.path.join(handoff, labels))


def adb(*args: str) -> None:
    subprocess.run(["adb", *args], check=True)


def side(path: str, ext: str) -> str:
    return os.path.splitext(path)[0] + ext


# ---- the app's detection, in numpy (BallDetect.kt / RegionRender.kt)

def starts(n: int, tile: int = TILE, overlap: int = 80) -> list[int]:
    if n <= tile:
        return [0]
    k = math.ceil((n - overlap) / (tile - overlap))
    return [int(np.rint(i * (n - tile) / (k - 1))) for i in range(k)]


def regions(w: int, h: int):
    out = [(0, 0, min(SIDE / w, SIDE / h))]
    for y0 in starts(h):
        for x0 in starts(w):
            out.append((x0, y0, SIDE / TILE))
    return out


def render(frame: np.ndarray, region) -> np.ndarray:
    import cv2
    x0, y0, s = region
    h, w = frame.shape[:2]
    whole = x0 == 0 and y0 == 0 and s == min(SIDE / w, SIDE / h)
    src = frame if whole else frame[y0:y0 + TILE, x0:x0 + TILE]
    out = np.full((SIDE, SIDE, 3), 114, dtype=np.float32)
    if s == 1.0:
        out[:src.shape[0], :src.shape[1]] = src
        return out
    nw, nh = int(math.floor(src.shape[1] * s + 0.5)), int(math.floor(src.shape[0] * s + 0.5))
    out[:nh, :nw] = cv2.resize(src, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return out


ANCH = None


def anchors():
    global ANCH
    if ANCH is None:
        g = []
        for stride in (8, 16, 32):
            n = SIDE // stride
            for y in range(n):
                for x in range(n):
                    g.append((x, y, stride))
        ANCH = np.array(g, dtype=np.float32)
    return ANCH


def decode(out: np.ndarray, region) -> list[list[float]]:
    x0, y0, s = region
    a = anchors()
    sc = out[:, 4] * out[:, 5]
    keep = (out[:, 4] >= 0.05) & (sc >= 0.05)
    o, a = out[keep], a[keep]
    cx = (o[:, 0] + a[:, 0]) * a[:, 2] / s + x0
    cy = (o[:, 1] + a[:, 1]) * a[:, 2] / s + y0
    bw = np.exp(o[:, 2]) * a[:, 2] / s
    bh = np.exp(o[:, 3]) * a[:, 2] / s
    return [list(map(float, v)) for v in zip(cx, cy, bw, bh, sc[keep])]


def nms(boxes, iou=0.5):
    order = sorted(range(len(boxes)), key=lambda i: (-boxes[i][4], i))
    keep = []
    for i in order:
        v = boxes[i]
        ok = True
        for k in keep:
            ix = max(0.0, min(v[0] + v[2] / 2, k[0] + k[2] / 2) - max(v[0] - v[2] / 2, k[0] - k[2] / 2))
            iy = max(0.0, min(v[1] + v[3] / 2, k[1] + k[3] / 2) - max(v[1] - v[3] / 2, k[1] - k[3] / 2))
            u = v[2] * v[3] + k[2] * k[3] - ix * iy
            if u > 0 and ix * iy / u > iou:
                ok = False
                break
        if ok:
            keep.append(v)
    return keep


def ball_size(w: int, h: int, max_w: int = 1920):
    if not (max(w, h) > max_w):
        return w, h
    s = max_w / max(w, h)
    return int(math.floor(w * s / 2 + 0.5) * 2), int(math.floor(h * s / 2 + 0.5) * 2)


def reference(handoff: str, models: str) -> None:
    import cv2
    import onnxruntime as ort
    sessions = {}
    for c in clips(handoff):
        model = MODELS.get(c["sport"])
        if model is None:
            continue
        if model not in sessions:
            sessions[model] = ort.InferenceSession(os.path.join(models, f"{model}.onnx"), providers=["CPUExecutionProvider"])
        sess = sessions[model]
        name_in = sess.get_inputs()[0].name
        cap = cv2.VideoCapture(os.path.join(handoff, c["video"]))
        rows = max(0, math.ceil((c["end"] - c["start"]) / 100 - 1e-9))
        ticks = [c["start"] + k * 100 for k in range(0, rows, 2)]
        frames, ti = [], 0
        W = H = None
        while ti < len(ticks):
            ok, f = cap.read()
            if not ok:
                break
            t = cap.get(cv2.CAP_PROP_POS_MSEC)
            H, W = f.shape[:2]
            while ti < len(ticks) and t >= ticks[ti] + 100 - 0.5:
                ti += 1
            if ti < len(ticks) and t >= ticks[ti] - 0.5:
                dw, dh = ball_size(W, H)
                img = f if (dw, dh) == (W, H) else cv2.resize(f, (dw, dh), interpolation=cv2.INTER_AREA)
                boxes = []
                for r in regions(dw, dh):
                    out = sess.run(None, {name_in: render(img, r).transpose(2, 0, 1)[None]})[0][0]
                    boxes += decode(out, r)
                cands = [[round(b[0] / dw, 4), round(b[1] / dh, 4), round(b[2] / dw, 4), round(b[3] / dh, 4), round(b[4], 3)]
                         for b in nms(boxes)]
                frames.append({"t": round(t, 3), "c": cands})
                ti += 1
        cap.release()
        dw, dh = ball_size(W, H)
        key = model if (dw, dh) == (W, H) else f"{model}@1920"
        out = side(os.path.join(handoff, c["video"]), ".ref.balldet.json")
        json.dump({"v": 1, "model": key, "size": [W, H], "frames": frames}, open(out, "w"))
        adb("push", out, f"{REMOTE}/{os.path.dirname(c['video'])}/")
        print(f"{c['name']}: {len(frames)} frames, {sum(len(f['c']) for f in frames)} candidates -> {os.path.basename(out)}")


# ---- the report

def inside_share(ball_file: str, labels: str, start: float) -> tuple[float, int]:
    f = json.load(open(ball_file))
    rects = f["portrait"]
    lab = json.load(open(labels))["samples"]
    hits = n = 0
    for ms, v in lab.items():
        if not (isinstance(v, list) and len(v) == 2):
            continue
        k = int(round((float(ms) - start) / 100))
        if not (0 <= k < len(rects)):
            continue
        x, y, w, h = rects[k]
        n += 1
        hits += x <= v[0] <= x + w and y <= v[1] <= y + h
    return (hits / n if n else float("nan")), n


def report(handoff: str, out: str) -> None:
    rows = []
    for c in clips(handoff):
        base = os.path.join(out, os.path.splitext(c["video"])[0])
        res = os.path.join(out, c["name"] + ".result.json")  # LabEval writes results at the folder's top
        if not os.path.exists(res):
            continue
        r = json.load(open(res))
        row = {"clip": c["name"], "sport": c["sport"], "cut_s": (c["end"] - c["start"]) / 1000,
               "jog_s": r["focus"]["elapsedMs"] / 1000, "ball_s": r["ball"]["elapsedMs"] / 1000,
               "verdict": r["ball"]["verdict"], "zoom": r["ball"]["zoom"], "share": r["ball"]["ballShare"],
               "thermal": f"{r['thermalBefore']}->{r['thermalAfter']}", "stages": r["ball"]["stages"]}
        if "resume" in r:
            row["resume"] = r["resume"]
        phone, ref = base + ".eval.ball.json", base + ".ref.ball.json"
        if c["labels"]:
            row["in_phone"], row["labels"] = inside_share(phone, c["labels"], c["start"])
            if os.path.exists(ref):
                row["in_ref"], _ = inside_share(ref, c["labels"], c["start"])
        if os.path.exists(ref):
            a = np.array(json.load(open(phone))["portrait"])
            b = np.array(json.load(open(ref))["portrait"])
            n = min(len(a), len(b))
            d = np.abs((a[:n, 0] + a[:n, 2] / 2) - (b[:n, 0] + b[:n, 2] / 2))
            row["dx_mean"], row["dx_max"] = float(d.mean()), float(d.max())
        rows.append(row)
    json.dump(rows, open(os.path.join(out, "report.json"), "w"), indent=2)
    fmt = lambda v, p="{:.0%}": "-" if v is None or (isinstance(v, float) and math.isnan(v)) else p.format(v)
    print("| Clip | Cut | Jogadores | Bola | Ball in crop (phone / ref) | Crop centre vs ref (mean / max) | Zoom | Verdict |")
    print("|---|---|---|---|---|---|---|---|")
    for r in rows:
        print(f"| {r['clip']} | {r['cut_s']:.1f} s | {r['jog_s']:.1f} s | {r['ball_s']:.1f} s | "
              f"{fmt(r.get('in_phone'))} / {fmt(r.get('in_ref'))} | "
              f"{fmt(r.get('dx_mean'), '{:.3f}')} / {fmt(r.get('dx_max'), '{:.3f}')} | {r['zoom']} | {r['verdict'] or 'ok'} |")
    for sport in sorted({r["sport"] for r in rows}):
        rs = [r for r in rows if r["sport"] == sport]
        cut = sum(r["cut_s"] for r in rs)
        print(f"\n{sport}: {len(rs)} clips, {cut:.0f} s of cut; Jogadores {sum(r['jog_s'] for r in rs) / cut:.1f} s and "
              f"Bola {sum(r['ball_s'] for r in rs) / cut:.1f} s per second of cut")
        lab = [r for r in rs if "in_phone" in r and not math.isnan(r["in_phone"])]
        if lab:
            tot = sum(r["labels"] for r in lab)
            ph = sum(r["in_phone"] * r["labels"] for r in lab) / tot
            msg = f"ball inside the 9:16 crop on {tot} labelled points: phone {ph:.1%}"
            lr = [r for r in lab if "in_ref" in r]
            if lr:
                msg += f", reference {sum(r['in_ref'] * r['labels'] for r in lr) / sum(r['labels'] for r in lr):.1%}"
            print(msg)
    for r in rows:
        if "resume" in r:
            print(f"resume on {r['clip']}: {r['resume']}")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["push", "ref", "pull", "report"])
    p.add_argument("handoff")
    p.add_argument("extra", nargs="?")
    a = p.parse_args()
    if a.cmd == "push":
        subprocess.run(["adb", "shell", "mkdir", "-p", REMOTE], check=True)
        for c in clips(a.handoff):
            d = os.path.dirname(c["video"])
            subprocess.run(["adb", "shell", "mkdir", "-p", f"{REMOTE}/{d}"], check=True)
            adb("push", os.path.join(a.handoff, c["video"]), f"{REMOTE}/{d}/")
        adb("push", os.path.join(a.handoff, "clips.txt"), f"{REMOTE}/")
    elif a.cmd == "ref":
        reference(a.handoff, a.extra or os.path.join(a.handoff, "models"))
    elif a.cmd == "pull":
        # the JSON files only (the videos are already here)
        files = subprocess.run(["adb", "shell", "find", REMOTE, "-name", "*.json"], check=True, capture_output=True,
                               text=True).stdout.split()
        for f in files:
            dest = os.path.join(a.extra, os.path.relpath(f, REMOTE))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            adb("pull", f, dest)
    else:
        report(a.handoff, a.extra)


if __name__ == "__main__":
    sys.exit(main())
