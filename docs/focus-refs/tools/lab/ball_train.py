#!/usr/bin/env python3
"""Modo Foco lab, test 18 (2026-11-05): fine-tune YOLOX-S (Apache-2.0, COCO weights from its GitHub release) to find
THE ball of our sports, with the lab's labels (labels/<clip>.ball.json: ball centres every 200 ms).

- dataset: per labelled ball, the frame decoded at full resolution; the ball's box size from the closest EdgeTAM mask
  or COCO-detector box within the lab's radius (else the clip's median size); 320 px crops around the ball (random
  offset, 2 per ball) + 320 px crops without the ball (random, and around the COCO detector's false candidates:
  balls lying, lamps), saved as JPEG + one JSON per clip in lab/train/<clip>/.
- train: folds by clip (FOLDS below): a model per fold trained on the clips of the other folds, so every clip is
  scored by a model that never saw it; --fold all = every labelled clip. YOLOX-S, one class, input 320, SGD, flips,
  brightness/contrast jitter. CPU works (~1 s per batch of 8).
- export: ONNX 640x640 for ball_detect.py (one class: score = obj x cls).

    python3 tools/lab/ball_train.py dataset [clip ...]
    python3 tools/lab/ball_train.py train --fold A --iters 2000
    python3 tools/lab/ball_train.py export --fold A
The YOLOX code: the PyPI sdist yolox-0.3.0 (Apache-2.0), unpacked; --yolox points at it (setup in README test 18).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import subprocess
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

TRAIN = os.path.join(ev.ROOT, "lab", "train")
MODELS = os.path.join(ev.ROOT, "lab", "models")
ONECLICK = os.path.join(ev.ROOT, "lab", "tests", "oneclick")
DET = os.path.join(ev.ROOT, "lab", "tests", "detect")
CROP = 320
FOLDS = {
    "A": ["bt-rz-1105-a", "bt-0AE39B33", "yt-basket-04", "yt1105-volei-a", "basket-rp-1105-v-b", "yt1105-futevolei"],
    "B": ["bt-rz-1105-b", "bt-E5003B6B", "basket-rp-1105-v-a", "yt1105-volei-b", "yt1105-basket-a", "basket-v-01"],
    "C": ["bt-rz-1105-v", "yt1105-voleipraia", "yt1105-basket-b", "basket-rp-1105-h", "yt1105-bt"],
}
SIZE_TAGS = ["edgetam-roi40b", "edgetam-roi40b5", "edgetam-fuse5", "edgetam-5fps"]


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


def frames_at(meta, ks, W, H):
    """Full-resolution frames (BGR) at 100 ms ticks ks, decoded once."""
    import cv2  # noqa: F401
    video = os.path.join(ev.ROOT, meta["video"])
    dec = subprocess.Popen(["ffmpeg", "-nostdin", "-v", "error", "-ss", f"{meta['startMs'] / 1000}", "-i", video, "-t",
                            f"{meta['durMs'] / 1000}", "-vf", "fps=10:start_time=0", "-f", "rawvideo", "-pix_fmt",
                            "bgr24", "-"], stdout=subprocess.PIPE)
    want = set(ks)
    fb = W * H * 3
    k = 0
    out = {}
    while want:
        buf = dec.stdout.read(fb)
        if len(buf) < fb:
            break
        if k in want:
            out[k] = np.frombuffer(buf, np.uint8).reshape(H, W, 3).copy()
            want.discard(k)
        k += 1
    dec.kill()
    return out


def ball_sizes(name, truth, W, H, det_tag="yolox-s-t5"):
    """Box (w, h) in px per labelled frame from the masks / detector boxes near the label."""
    R = ev.radius_px(truth["size"])
    sources = []
    for tag in SIZE_TAGS:
        p = os.path.join(ONECLICK, f"{name}.ball.{tag}.json")
        if os.path.exists(p):
            sources.append(("mask", json.load(open(p))["pred_one"]))
    p = os.path.join(DET, f"{name}.{det_tag}.json")
    det = json.load(open(p))["frames"] if os.path.exists(p) else None
    sizes = {}
    for ms, g in truth["samples"].items():
        if not isinstance(g, tuple):
            continue
        k = ms // 100
        for _, pred in sources:
            v = pred.get(str(k))
            if v is not None and ev._dist_px(v[:2], g, truth["size"]) <= R and v[4] * W < 0.06 * max(W, H):
                sizes[k] = (v[4] * W, v[5] * H)
                break
        if k not in sizes and det is not None and k < len(det) and det[k]:
            near = [c for c in det[k] if ev._dist_px(c[:2], g, truth["size"]) <= R]
            if near:
                c = max(near, key=lambda c: c[4])
                sizes[k] = (c[2] * W, c[3] * H)
    return sizes


def cmd_dataset(a):
    import cv2
    rng = random.Random(0)
    clips = a.clips or [c for f in FOLDS.values() for c in f]
    for name in clips:
        meta = ev.clip_meta(name)
        truth = ev.load_truth(name)
        W, H = upright(os.path.join(ev.ROOT, meta["video"]))
        balls = {ms // 100: g for ms, g in truth["samples"].items() if isinstance(g, tuple) and ms // 100 < meta["count"]}
        empty = [ms // 100 for ms, g in truth["samples"].items() if not isinstance(g, tuple) and ms // 100 < meta["count"]]
        sizes = ball_sizes(name, truth, W, H, a.det)
        if sizes:
            med = (float(np.median([s[0] for s in sizes.values()])), float(np.median([s[1] for s in sizes.values()])))
        else:
            med = (0.012 * max(W, H), 0.012 * max(W, H))
        p = os.path.join(DET, f"{name}.{a.det}.json")  # test 38: --det bhn-n5 (sizes + its false candidates)
        det = json.load(open(p))["frames"] if os.path.exists(p) else None
        frames = frames_at(meta, sorted(set(balls) | set(empty)), W, H)
        d = os.path.join(TRAIN, name)
        os.makedirs(d, exist_ok=True)
        items = []

        def save(img, boxes, tag):
            fn = f"{tag}.jpg"
            cv2.imwrite(os.path.join(d, fn), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
            items.append({"file": fn, "boxes": boxes})

        def crop_at(fr, x0, y0):
            x0 = int(min(max(x0, 0), W - CROP))
            y0 = int(min(max(y0, 0), H - CROP))
            return fr[y0:y0 + CROP, x0:x0 + CROP], x0, y0

        for k, fr in frames.items():
            if k in balls:
                gx, gy = balls[k][0] * W, balls[k][1] * H
                bw, bh = sizes.get(k, med)
                bw, bh = max(bw, 4.0), max(bh, 4.0)
                for r in range(2):
                    x0 = gx - rng.uniform(0.15, 0.85) * CROP
                    y0 = gy - rng.uniform(0.15, 0.85) * CROP
                    c, x0, y0 = crop_at(fr, x0, y0)
                    save(c, [[gx - x0, gy - y0, bw, bh]], f"{k:04d}-p{r}")
            # negatives: a random crop away from the ball, and the detector's candidates far from it
            g = balls.get(k)
            tries = 0
            while tries < 20:
                tries += 1
                x0, y0 = rng.uniform(0, W - CROP), rng.uniform(0, H - CROP)
                if g is None or not (x0 - 20 <= g[0] * W <= x0 + CROP + 20 and y0 - 20 <= g[1] * H <= y0 + CROP + 20):
                    c, x0, y0 = crop_at(fr, x0, y0)
                    save(c, [], f"{k:04d}-n0")
                    break
            if det is not None and k < len(det) and det[k]:
                far = [cc for cc in det[k] if g is None or ev._dist_px(cc[:2], g, truth["size"]) > 3 * ev.radius_px(truth["size"])]
                for j, cc in enumerate(sorted(far, key=lambda v: -v[4])[:2]):
                    cx, cy = cc[0] * W, cc[1] * H
                    x0 = cx - rng.uniform(0.2, 0.8) * CROP
                    y0 = cy - rng.uniform(0.2, 0.8) * CROP
                    c, x0, y0 = crop_at(fr, x0, y0)
                    boxes = []
                    if g is not None and x0 <= g[0] * W <= x0 + CROP and y0 <= g[1] * H <= y0 + CROP:
                        bw, bh = sizes.get(k, med)
                        boxes = [[g[0] * W - x0, g[1] * H - y0, max(bw, 4.0), max(bh, 4.0)]]
                    save(c, boxes, f"{k:04d}-h{j}")
        json.dump({"clip": name, "size": [W, H], "sport": meta["sport"], "medianBall": med, "sized": len(sizes),
                   "balls": len(balls), "items": items}, open(os.path.join(d, "items.json"), "w"))
        npos = sum(1 for it in items if it["boxes"])
        print(f"{name}: {len(items)} crops ({npos} with the ball), ball boxes from masks/detector {len(sizes)}/{len(balls)}, "
              f"median ball {med[0]:.0f}x{med[1]:.0f} px", flush=True)


def load_items(clips):
    out = []
    for c in clips:
        j = json.load(open(os.path.join(TRAIN, c, "items.json")))
        for it in j["items"]:
            out.append((os.path.join(TRAIN, c, it["file"]), it["boxes"]))
    return out


def build(yolox_dir, num_classes=1):
    sys.path.insert(0, yolox_dir)
    from yolox.models import YOLOX, YOLOPAFPN, YOLOXHead
    return YOLOX(YOLOPAFPN(0.33, 0.50), YOLOXHead(num_classes, 0.50))


def cmd_train(a):
    import cv2
    import torch
    torch.set_num_threads(a.threads)
    torch.manual_seed(0)
    rng = random.Random(0)
    clips = ([c for f, cs in FOLDS.items() if f != a.fold for c in cs] if a.fold != "all"
             else [c for cs in FOLDS.values() for c in cs])
    items = load_items(clips)
    pos = [it for it in items if it[1]]
    neg = [it for it in items if not it[1]]
    print(f"fold {a.fold}: train on {len(clips)} clips, {len(pos)} crops with the ball, {len(neg)} without", flush=True)
    m = build(a.yolox)
    ck = torch.load(os.path.join(MODELS, "yolox_s.pth"), map_location="cpu", weights_only=False)["model"]
    # the one-class head starts from COCO's "sports ball" row (class 32), so training starts from the COCO detector
    init = {k: (v[32:33] if "cls_preds" in k else v) for k, v in ck.items()}
    m.load_state_dict(init, strict=True)
    m.train()
    if a.freeze_bn:  # small batches: keep COCO's BatchNorm statistics
        for mod in m.modules():
            if isinstance(mod, torch.nn.BatchNorm2d):
                mod.eval()
    params_bn, params_w, params_b = [], [], []
    for mod in m.modules():
        if hasattr(mod, "bias") and isinstance(mod.bias, torch.nn.Parameter):
            params_b.append(mod.bias)
        if isinstance(mod, torch.nn.BatchNorm2d):
            params_bn.append(mod.weight)
        elif hasattr(mod, "weight") and isinstance(mod.weight, torch.nn.Parameter):
            params_w.append(mod.weight)
    opt = torch.optim.SGD([{"params": params_bn}, {"params": params_w, "weight_decay": 5e-4}, {"params": params_b}],
                          lr=a.lr, momentum=0.9, nesterov=True)

    def sample():
        path, boxes = rng.choice(pos) if rng.random() < a.pos else rng.choice(neg)
        img = cv2.imread(path)
        boxes = [list(b) for b in boxes]
        if rng.random() < 0.5:
            img = img[:, ::-1]
            for b in boxes:
                b[0] = CROP - b[0]
        if rng.random() < 0.8:
            alpha, beta = rng.uniform(0.6, 1.4), rng.uniform(-30, 30)
            img = np.clip(img.astype(np.float32) * alpha + beta, 0, 255)
        return np.ascontiguousarray(img, dtype=np.float32).transpose(2, 0, 1), boxes

    t0 = time.time()
    log = []
    for it in range(a.iters):
        lr = a.lr * min(1.0, (it + 1) / 100) * (0.5 * (1 + math.cos(math.pi * it / a.iters)) * 0.95 + 0.05)
        for g in opt.param_groups:
            g["lr"] = lr
        xs, ts = [], torch.zeros(a.batch, 20, 5)
        for b in range(a.batch):
            x, boxes = sample()
            xs.append(torch.from_numpy(x))
            for j, (cx, cy, w, h) in enumerate(boxes[:20]):
                ts[b, j] = torch.tensor([0, cx, cy, w, h])
        out = m(torch.stack(xs), ts)
        loss = out["total_loss"]
        opt.zero_grad()
        if not torch.isfinite(loss):
            print(f"iter {it + 1}: loss not finite, batch skipped", flush=True)
            continue
        loss.backward()
        torch.nn.utils.clip_grad_norm_(m.parameters(), 10.0)
        opt.step()
        log.append(float(loss.detach()))
        if (it + 1) % 50 == 0:
            print(f"fold {a.fold} iter {it + 1}/{a.iters} loss {np.mean(log[-50:]):.3f} lr {lr:.5f} "
                  f"{(time.time() - t0) / (it + 1):.2f} s/iter", flush=True)
    os.makedirs(MODELS, exist_ok=True)
    torch.save({"model": m.state_dict(), "fold": a.fold, "clips": clips, "iters": a.iters},
               os.path.join(MODELS, f"ball_yolox_s_{a.fold}{a.suffix}.pth"))
    print(f"fold {a.fold}: saved lab/models/ball_yolox_s_{a.fold}{a.suffix}.pth", flush=True)


def cmd_export(a):
    import torch
    m = build(a.yolox)
    ck = torch.load(os.path.join(MODELS, f"ball_yolox_s_{a.fold}{a.suffix}.pth"), map_location="cpu", weights_only=False)
    m.load_state_dict(ck["model"])
    m.eval()
    m.head.decode_in_inference = False
    path = os.path.join(MODELS, f"ball_yolox_s_{a.fold}{a.suffix}.onnx")
    torch.onnx.export(m, torch.zeros(1, 3, 640, 640), path, input_names=["images"], output_names=["output"],
                      opset_version=13, dynamo=False)
    print("exported", path)


def cmd_check(a):
    """Quick check: on crops with the ball, from training clips and from held-out clips, the best score within the
    ball's radius and the best score anywhere."""
    import cv2
    import torch
    torch.set_num_threads(2)
    m = build(a.yolox)
    ck = torch.load(os.path.join(MODELS, f"ball_yolox_s_{a.fold}{a.suffix}.pth"), map_location="cpu", weights_only=False)
    m.load_state_dict(ck["model"])
    m.eval()
    test = FOLDS[a.fold] if a.fold in FOLDS else []
    train = [c for f, cs in FOLDS.items() if f != a.fold for c in cs]
    for label, clips in (("train", train), ("held-out", test)):
        pos = [it for it in load_items(clips) if it[1]]
        random.Random(1).shuffle(pos)
        hit, near_s, top_other = 0, [], []
        for path, boxes in pos[:60]:
            x = torch.from_numpy(cv2.imread(path).astype(np.float32).transpose(2, 0, 1))[None]
            with torch.no_grad():
                o = m(x)[0]
            s = o[:, 4] * o[:, 5]
            cx, cy = boxes[0][0], boxes[0][1]
            d = torch.hypot(o[:, 0] - cx, o[:, 1] - cy)
            near = s[d < 12]
            ns = float(near.max()) if len(near) else 0.0
            near_s.append(ns)
            hit += ns > 0 and ns >= float(s.max()) * 0.999
            top_other.append(float(s[d >= 12].max()) if (d >= 12).any() else 0.0)
        print(f"{label}: the ball is the best box on {hit}/{min(60, len(pos))} crops; median score at the ball "
              f"{np.median(near_s):.3f}, best elsewhere {np.median(top_other):.3f}", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yolox", default=os.environ.get("YOLOX_SRC", "/tmp/yxsrc/yolox-0.3.0"))
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("dataset")
    p.add_argument("--det", default="yolox-s-t5", help="test 38: detections for the ball's box size and the 'not a "
                   "ball' crops (bhn-n5 = ball_tiny_hn on all tiles)")
    p.add_argument("clips", nargs="*")
    p = sub.add_parser("train")
    p.add_argument("--fold", required=True, choices=["A", "B", "C", "all"])
    p.add_argument("--iters", type=int, default=2000)
    p.add_argument("--batch", type=int, default=8)
    p.add_argument("--lr", type=float, default=0.004)
    p.add_argument("--threads", type=int, default=2)
    p.add_argument("--pos", type=float, default=0.6, help="share of crops with the ball in a batch")
    p.add_argument("--freeze-bn", type=int, default=1)
    p.add_argument("--suffix", default="")
    p = sub.add_parser("export")
    p.add_argument("--fold", required=True)
    p.add_argument("--suffix", default="")
    p = sub.add_parser("check")
    p.add_argument("--fold", required=True)
    p.add_argument("--suffix", default="")
    a = ap.parse_args()
    {"dataset": cmd_dataset, "train": cmd_train, "export": cmd_export, "check": cmd_check}[a.cmd](a)


if __name__ == "__main__":
    main()
