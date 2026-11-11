#!/usr/bin/env python3
"""Sport classifier: imports Kaggle's "100 Sports Image Classification" (gpiosenka, CC0 1.0) into lab/sport-cls/public.

Download it by hand (kaggle.com/datasets/gpiosenka/sports-classification), unzip, then:
    python3 tools/lab/sport_cls_public.py ~/Downloads/sports-classification
Our sports keep their label; every other sport becomes "outro" (at most --other-per-class images each), which teaches
the head what is NOT one of ours. Appends to lab/sport-cls/manifest.csv (source public, use train; the set's own
test/ folder: use eval).
"""
import csv, os, shutil, sys, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import evaluate as ev
OUT = os.path.join(ev.ROOT, "lab", "sport-cls")
OURS = {"basketball": "basquete", "tennis": "tenis", "volleyball": "volei", "beach volleyball": "voleiPraia",
        "soccer": "futebol", "football soccer": "futebol"}
ap = argparse.ArgumentParser(); ap.add_argument("src"); ap.add_argument("--other-per-class", type=int, default=15)
a = ap.parse_args()
man = os.path.join(OUT, "manifest.csv")
rows = {r["file"]: r for r in csv.DictReader(open(man))} if os.path.exists(man) else {}
found = set()
for split in ("train", "valid", "test"):
    sd = os.path.join(a.src, split)
    if not os.path.isdir(sd): continue
    for cls in sorted(os.listdir(sd)):
        cd = os.path.join(sd, cls)
        if not os.path.isdir(cd): continue
        found.add(cls)
        label = OURS.get(cls.lower(), "outro")
        imgs = sorted(f for f in os.listdir(cd) if f.lower().endswith((".jpg", ".jpeg", ".png")))
        if label == "outro": imgs = imgs[: a.other_per_class if split == "train" else 2]
        d = os.path.join(OUT, "public", label); os.makedirs(d, exist_ok=True)
        for f in imgs:
            name = f"{cls.replace(' ', '_')}__{split}__{f}"
            shutil.copy(os.path.join(cd, f), os.path.join(d, name))
            rel = f"public/{label}/{name}"
            rows[rel] = {"file": rel, "label": label, "clip": f"pub-{cls}-{split}", "source": "public",
                         "use": "eval" if split == "test" else "train"}
with open(man, "w", newline="") as fh:
    w = csv.DictWriter(fh, ["file", "label", "clip", "source", "use"]); w.writeheader(); w.writerows(rows.values())
print("classes found:", len(found))
print("ours:", sorted(c for c in found if c.lower() in OURS))
