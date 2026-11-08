#!/usr/bin/env python3
"""Modo Foco lab, test 28 (2026-11-06): a basketball detector of our own, YOLOX-Tiny / YOLOX-S (Apache-2.0, COCO
weights from the GitHub release) fine-tuned on ONE class, "basketball", from a public dataset with a commercial licence
(Roboflow Universe, CC BY 4.0, COCO JSON export) plus, optionally, the lab's own basketball labels (test 18's crops).

Why the public data is rescaled: our balls are 1-2% of the long side of a 1280 px frame (13-26 px at native
resolution, which is what the detector sees on the native 416 / 640 px tiles); the public images (often stretched to
640 x 640) have bigger balls. Every crop is resized so its ball is 8-32 px, then cut to 320 x 320 around it.

    python3 tools/lab/ball_train_pub.py dataset --src lab/datasets/basketball_detection-lbacg --name lbacg
    python3 tools/lab/ball_train_pub.py train --model tiny --sets pub-lbacg --out pub --iters 3000
    python3 tools/lab/ball_train_pub.py train --model tiny --sets pub-lbacg --fold A --out pubown --iters 1000 \
        --init ball_tiny_pub                      # public model + the lab's crops of fold B (+ ALWAYS), scored on A
    python3 tools/lab/ball_train_pub.py export --model tiny --out pub      # -> lab/models/ball_<model>_<out>.onnx
then ball_detect.py --model lab/models/ball_tiny_pub.onnx ... as in test 19 (the ONNX has one class; ball_detect.py
reads it). Folds (FOLDS): each fold's clips are scored by a model that never saw them; basket-app-1031-a/-b are
labelled but not in the 7 evaluation clips, so they are always training data with --fold.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import sys
import time
import zipfile

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import evaluate as ev  # noqa: E402

TRAIN = os.path.join(ev.ROOT, "lab", "train")
MODELS = os.path.join(ev.ROOT, "lab", "models")
CROP = 320
EVAL = ["basket-rp-1105-v-a", "basket-rp-1105-v-b", "basket-rp-1105-h", "basket-v-01", "yt-basket-04",
        "yt1105-basket-a", "yt1105-basket-b"]
FOLDS = {"A": ["basket-rp-1105-v-a", "basket-rp-1105-h", "yt1105-basket-a"],
         "B": ["basket-rp-1105-v-b", "basket-v-01", "yt-basket-04", "yt1105-basket-b"]}
ALWAYS = ["basket-app-1031-a", "basket-app-1031-b"]
ARCH = {"tiny": (0.33, 0.375, 416), "s": (0.33, 0.50, 640)}  # depth, width, ONNX input
BALL_PX = (8.0, 32.0)


def coco_sets(src):
    """[(split, annotations dict, image reader)] from a Roboflow COCO export: a folder or the .zip inside it."""
    out = []
    zips = sorted(glob.glob(os.path.join(src, "*.zip")))
    if zips:
        z = zipfile.ZipFile(zips[-1])
        names = z.namelist()
        for ann in [n for n in names if n.endswith("_annotations.coco.json")]:
            base = os.path.dirname(ann)
            out.append((base or ".", json.loads(z.read(ann)),
                        (lambda fn, base=base, z=z: z.read(os.path.join(base, fn) if base else fn))))
    else:
        for ann in glob.glob(os.path.join(src, "**", "_annotations.coco.json"), recursive=True):
            base = os.path.dirname(ann)
            out.append((os.path.basename(base), json.load(open(ann)),
                        (lambda fn, base=base: open(os.path.join(base, fn), "rb").read())))
    return out


def cmd_dataset(a):
    import cv2
    rng = random.Random(0)
    d = os.path.join(TRAIN, f"pub-{a.name}")
    os.makedirs(d, exist_ok=True)
    items, stats = [], {"images": 0, "with_ball": 0, "balls": 0, "ball_px": []}
    for split, ann, read in coco_sets(a.src):
        if split not in a.splits:
            print(f"skip split {split}", flush=True)
            continue
        cats = {c["id"]: c["name"] for c in ann["categories"]}
        want = {i for i, n in cats.items() if n.lower() in a.classes}
        print(f"{split}: categories {cats}; using {[cats[i] for i in want]}", flush=True)
        by_img = {}
        for an in ann["annotations"]:
            if an["category_id"] in want:
                by_img.setdefault(an["image_id"], []).append(an["bbox"])  # x, y, w, h (px)
        imgs = ann["images"]
        rng.shuffle(imgs)
        for im in imgs[: a.limit or None]:
            boxes = by_img.get(im["id"], [])
            img = cv2.imdecode(np.frombuffer(read(im["file_name"]), np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            stats["images"] += 1
            H0, W0 = img.shape[:2]
            if boxes:
                stats["with_ball"] += 1
                stats["balls"] += len(boxes)
                stats["ball_px"] += [max(b[2], b[3]) for b in boxes]
                for r in range(a.per_ball):
                    b = rng.choice(boxes)
                    size = max(b[2], b[3], 1.0)
                    s = rng.uniform(*BALL_PX) / size
                    s = min(max(s, 0.08), 2.0)
                    big = cv2.resize(img, (max(1, int(W0 * s)), max(1, int(H0 * s))),
                                     interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
                    cx, cy = (b[0] + b[2] / 2) * s, (b[1] + b[3] / 2) * s
                    x0 = int(cx - rng.uniform(0.15, 0.85) * CROP)
                    y0 = int(cy - rng.uniform(0.15, 0.85) * CROP)
                    crop = np.full((CROP, CROP, 3), 114, np.uint8)
                    sx0, sy0 = max(x0, 0), max(y0, 0)
                    sx1, sy1 = min(x0 + CROP, big.shape[1]), min(y0 + CROP, big.shape[0])
                    if sx1 <= sx0 or sy1 <= sy0:
                        continue
                    crop[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = big[sy0:sy1, sx0:sx1]
                    bb = []
                    for o in boxes:
                        ox, oy, ow, oh = (o[0] + o[2] / 2) * s - x0, (o[1] + o[3] / 2) * s - y0, o[2] * s, o[3] * s
                        if 0 <= ox < CROP and 0 <= oy < CROP and max(ow, oh) >= 3:
                            bb.append([ox, oy, max(ow, 3.0), max(oh, 3.0)])
                    if not bb:
                        continue
                    fn = f"{len(items):06d}-p.jpg"
                    cv2.imwrite(os.path.join(d, fn), crop, [cv2.IMWRITE_JPEG_QUALITY, 92])
                    items.append({"file": fn, "boxes": bb})
            if rng.random() < a.neg:  # a crop without any ball (scale 0.6-1.2: room for a crop away from the balls)
                s = rng.uniform(0.6, 1.2)
                big = cv2.resize(img, (max(CROP, int(W0 * s)), max(CROP, int(H0 * s))), interpolation=cv2.INTER_AREA)
                sx, sy = big.shape[1] / W0, big.shape[0] / H0
                for _ in range(20):
                    x0, y0 = rng.randint(0, big.shape[1] - CROP), rng.randint(0, big.shape[0] - CROP)
                    if all(not (x0 - 4 <= (b[0] + b[2] / 2) * sx <= x0 + CROP + 4 and
                                y0 - 4 <= (b[1] + b[3] / 2) * sy <= y0 + CROP + 4) for b in boxes):
                        fn = f"{len(items):06d}-n.jpg"
                        cv2.imwrite(os.path.join(d, fn), big[y0:y0 + CROP, x0:x0 + CROP], [cv2.IMWRITE_JPEG_QUALITY, 92])
                        items.append({"file": fn, "boxes": []})
                        break
    bp = stats.pop("ball_px")
    stats["ball_px_median"] = float(np.median(bp)) if bp else None
    json.dump({"clip": f"pub-{a.name}", "src": a.src, "classes": a.classes, "stats": stats, "items": items},
              open(os.path.join(d, "items.json"), "w"))
    npos = sum(1 for it in items if it["boxes"])
    print(f"pub-{a.name}: {len(items)} crops ({npos} with the ball); {stats}", flush=True)


def load_items(sets):
    out = []
    for c in sets:
        j = json.load(open(os.path.join(TRAIN, c, "items.json")))
        out.append([(os.path.join(TRAIN, c, it["file"]), it["boxes"]) for it in j["items"]])
    return out


def build(yolox_dir, model):
    sys.path.insert(0, yolox_dir)
    from yolox.models import YOLOX, YOLOPAFPN, YOLOXHead
    depth, width, _ = ARCH[model]
    return YOLOX(YOLOPAFPN(depth, width), YOLOXHead(1, width))


def cmd_train(a):
    import cv2
    import torch
    torch.set_num_threads(a.threads)
    torch.manual_seed(0)
    rng = random.Random(0)
    own = []
    if a.fold:
        own = [c for f, cs in FOLDS.items() if f != a.fold for c in cs] + ALWAYS
    if a.no_yt:  # test 33: only our own recordings (the YouTube clips are not ours to train on)
        own = [c for c in own if not c.startswith("yt")]
    pub = load_items(a.sets)
    mine = load_items(own)
    fps = load_items([f"fp-{c}" for c in own if os.path.exists(os.path.join(TRAIN, f"fp-{c}", "items.json"))]) \
        if a.fp else []
    pools = []  # (weight, positives, negatives)
    for name, lst in zip(a.sets, pub):
        w = a.neg_weight if name.startswith("neg-") else 1.0  # test 32: "not a ball" sets
        pools.append((w, [i for i in lst if i[1]], [i for i in lst if not i[1]]))
    if mine:
        allm = [i for lst in mine for i in lst]
        pools.append((a.own, [i for i in allm if i[1]], [i for i in allm if not i[1]]))
    if fps:
        allf = [i for lst in fps for i in lst]
        pools.append((a.neg_weight, [i for i in allf if i[1]], [i for i in allf if not i[1]]))
    if a.extra:
        alle = [i for lst in load_items(a.extra) for i in lst]
        pools.append((a.extra_weight, [i for i in alle if i[1]], [i for i in alle if not i[1]]))
    wsum = sum(p[0] for p in pools)
    print(f"{a.model} {a.out}: sets {a.sets} + own {own} + extra {len(a.extra)} sets; "
          + ", ".join(f"{len(p[1])} pos / {len(p[2])} neg (w {p[0]})" for p in pools), flush=True)
    m = build(a.yolox, a.model)
    if a.init:  # continue from one of our one-class models (e.g. the public-only one)
        m.load_state_dict(torch.load(os.path.join(MODELS, f"{a.init}.pth"), map_location="cpu",
                                     weights_only=True)["model"], strict=True)
    else:
        ck = torch.load(os.path.join(MODELS, f"yolox_{a.model}.pth"), map_location="cpu", weights_only=True)["model"]
        init = {k: (v[32:33] if "cls_preds" in k else v) for k, v in ck.items()}  # head from COCO's "sports ball"
        m.load_state_dict(init, strict=True)
    m.train()
    if a.freeze_bn:
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
        r = rng.random() * wsum
        for w, pos, neg in pools:
            if r < w:
                break
            r -= w
        lst = pos if ((rng.random() < a.pos and pos) or not neg) else neg
        path, boxes = rng.choice(lst)
        img = cv2.imread(path)
        boxes = [list(b) for b in boxes]
        if rng.random() < 0.5:
            img = img[:, ::-1]
            for b in boxes:
                b[0] = CROP - b[0]
        if rng.random() < 0.3:  # motion blur along a random direction (a fast ball is a streak)
            k = rng.choice([3, 5, 7])
            ker = np.zeros((k, k), np.float32)
            ang = rng.uniform(0, math.pi)
            for t in np.linspace(-1, 1, 2 * k):
                ker[int(round((k - 1) / 2 + t * (k - 1) / 2 * math.sin(ang))),
                    int(round((k - 1) / 2 + t * (k - 1) / 2 * math.cos(ang)))] = 1
            img = cv2.filter2D(np.ascontiguousarray(img), -1, ker / ker.sum())
        img = img.astype(np.float32)
        if rng.random() < 0.8:
            img = np.clip(img * rng.uniform(0.6, 1.4) + rng.uniform(-30, 30), 0, 255)
        return np.ascontiguousarray(img).transpose(2, 0, 1), boxes

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
        loss = m(torch.stack(xs), ts)["total_loss"]
        opt.zero_grad()
        if not torch.isfinite(loss):
            print(f"iter {it + 1}: loss not finite, batch skipped", flush=True)
            continue
        loss.backward()
        torch.nn.utils.clip_grad_norm_(m.parameters(), 10.0)
        opt.step()
        log.append(float(loss.detach()))
        if (it + 1) % 50 == 0:
            print(f"{a.model} {a.out}{a.fold or ''} iter {it + 1}/{a.iters} loss {np.mean(log[-50:]):.3f} lr {lr:.5f} "
                  f"{(time.time() - t0) / (it + 1):.2f} s/iter", flush=True)
        if a.save_every and (it + 1) % a.save_every == 0:
            save(m, a, it + 1, own)
    save(m, a, a.iters, own)


def tag_of(a):
    return f"ball_{a.model}_{a.out}{a.fold or ''}"


def save(m, a, iters, own):
    import torch
    os.makedirs(MODELS, exist_ok=True)
    p = os.path.join(MODELS, f"{tag_of(a)}.pth")
    torch.save({"model": m.state_dict(), "arch": a.model, "sets": a.sets, "own": own, "iters": iters,
                "init": a.init}, p)
    print(f"saved {os.path.relpath(p, ev.ROOT)} at iter {iters}", flush=True)


def cmd_export(a):
    import torch
    m = build(a.yolox, a.model)
    ck = torch.load(os.path.join(MODELS, f"{tag_of(a)}.pth"), map_location="cpu", weights_only=True)
    m.load_state_dict(ck["model"])
    m.eval()
    m.head.decode_in_inference = False
    S = ARCH[a.model][2]
    path = os.path.join(MODELS, f"{tag_of(a)}.onnx")
    torch.onnx.export(m, torch.zeros(1, 3, S, S), path, input_names=["images"], output_names=["output"],
                      opset_version=13, dynamo=False)
    print("exported", os.path.relpath(path, ev.ROOT))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yolox", default=os.environ.get("YOLOX_SRC", os.path.join(ev.ROOT, "lab", "src", "yolox-0.3.0")))
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("dataset")
    p.add_argument("--src", required=True, help="folder with the Roboflow COCO export (.zip or unpacked)")
    p.add_argument("--name", required=True)
    p.add_argument("--classes", type=lambda s: [c.strip().lower() for c in s.split(",")], default=["ball", "basketball"])
    p.add_argument("--splits", type=lambda s: s.split(","), default=["train", "valid", "test", "."])
    p.add_argument("--per-ball", type=int, default=1)
    p.add_argument("--neg", type=float, default=0.5, help="share of images that also give a crop without the ball")
    p.add_argument("--limit", type=int, default=0)
    for name in ("train", "export"):
        p = sub.add_parser(name)
        p.add_argument("--model", choices=list(ARCH), required=True)
        p.add_argument("--out", required=True, help="name of the run (model file ball_<model>_<out><fold>)")
        p.add_argument("--fold", choices=list(FOLDS), default=None, help="add the lab's crops of the other folds")
        if name == "train":
            p.add_argument("--sets", type=lambda s: [x for x in s.split(",") if x], default=[],
                           help="lab/train sets, e.g. pub-lbacg (test 33: may be empty)")
            p.add_argument("--no-yt", action="store_true", help="test 33: leave the YouTube clips (yt*) out of --fold")
            p.add_argument("--extra", type=lambda s: [x for x in s.split(",") if x], default=[],
                           help="test 33: more lab/train sets sampled with our own crops (e.g. the pseudo-labelled "
                           "pl-<clip> sets of pseudo_label.py), as one pool")
            p.add_argument("--extra-weight", type=float, default=1.0, help="sampling weight of the --extra pool")
            p.add_argument("--own", type=float, default=1.0, help="sampling weight of the lab's crops vs one set")
            p.add_argument("--iters", type=int, default=3000)
            p.add_argument("--batch", type=int, default=16)
            p.add_argument("--lr", type=float, default=0.002)
            p.add_argument("--pos", type=float, default=0.6)
            p.add_argument("--freeze-bn", action="store_true")
            p.add_argument("--threads", type=int, default=2)
            p.add_argument("--save-every", type=int, default=1000)
            p.add_argument("--init", default=None, help="start from lab/models/<init>.pth instead of COCO")
            p.add_argument("--fp", action="store_true", help="test 32: add the detector's false candidates mined on the "
                           "training fold's labelled clips (lab/train/fp-<clip>, hard_neg.py mine)")
            p.add_argument("--neg-weight", type=float, default=0.5, help="sampling weight of a neg-* set / the fp pool")
    a = ap.parse_args()
    {"dataset": cmd_dataset, "train": cmd_train, "export": cmd_export}[a.cmd](a)


if __name__ == "__main__":
    main()
