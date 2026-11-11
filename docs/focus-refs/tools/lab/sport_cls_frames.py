#!/usr/bin/env python3
"""Sport classifier (2026-11-11): frames per clip for Apple's Vision feature print (tools/lab/SportFeatures.swift).

lab/sport-cls/frames/<label>/<clip>__<i>.jpg (long side 512 px) + lab/sport-cls/manifest.csv
(file,label,clip,source,use). source: own (Victor's recordings) | web (YouTube references) | public (CC0 sets).
use: train | eval. YouTube references are eval only (no licence to train a shipped model on them).

    python3 tools/lab/sport_cls_frames.py [--k-own 8] [--k-web 12]
"""
import argparse, csv, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import sport_probe as sp, evaluate as ev
OUT = os.path.join(ev.ROOT, "lab", "sport-cls")

def dur(v):
    return float(json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", v],
                                           capture_output=True, text=True).stdout)["format"]["duration"])

def grab(v, t, out):
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", v, "-frames:v", "1", "-vf",
                    "scale='if(gt(iw,ih),512,-2)':'if(gt(iw,ih),-2,512)'", "-q:v", "3", out])
    return os.path.exists(out)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--k-own", type=int, default=8); ap.add_argument("--k-web", type=int, default=12)
    a = ap.parse_args()
    man = os.path.join(OUT, "manifest.csv")
    rows = {r["file"]: r for r in csv.DictReader(open(man))} if os.path.exists(man) else {}
    seen = set()
    for c in sp.clips():
        if c["name"] in seen: continue
        seen.add(c["name"])
        v = os.path.join(ev.ROOT, c["video"])
        if not os.path.exists(v): print("missing", c["name"]); continue
        web = bool(c.get("web")) or c["name"].startswith(("yt", "ref-"))
        label = {"society": "futebol", "tenisMesa": "outro", "sport": "outro"}.get(c["sport"], c["sport"])
        D = dur(v)
        if web: t0, t1, k = 0, D, a.k_web
        else: t0 = c["startMs"] / 1000; t1 = min(D, t0 + c["durMs"] / 1000); k = a.k_own
        d = os.path.join(OUT, "frames", label); os.makedirs(d, exist_ok=True)
        for i in range(k):
            f = os.path.join(d, f"{c['name']}__{i:02d}.jpg"); rel = os.path.relpath(f, OUT)
            if rel in rows: continue
            if grab(v, t0 + (t1 - t0) * (i + 0.5) / k, f):
                rows[rel] = {"file": rel, "label": label, "clip": c["name"], "source": "web" if web else "own",
                             "use": "eval" if web else "train"}
        with open(man, "w", newline="") as fh:
            w = csv.DictWriter(fh, ["file", "label", "clip", "source", "use"]); w.writeheader(); w.writerows(rows.values())
        print(c["name"], label, flush=True)
    # Victor's new clips: lab/sport-cls/videos/<label>/*.mp4|mov (labels: basquete beachTennis tenis futebol volei
    # voleiPraia futevolei nenhum); every 4th clip of a label (by name) is kept for eval, the rest train.
    vd = os.path.join(OUT, "videos")
    for label in sorted(os.listdir(vd)) if os.path.isdir(vd) else []:
        vids = sorted(f for f in os.listdir(os.path.join(vd, label)) if f.lower().endswith((".mp4", ".mov", ".m4v")))
        for j, f in enumerate(vids):
            v = os.path.join(vd, label, f); name = "new-" + os.path.splitext(f)[0].replace(" ", "_")
            D = dur(v); d = os.path.join(OUT, "frames", label); os.makedirs(d, exist_ok=True)
            for i in range(a.k_own):
                out = os.path.join(d, f"{name}__{i:02d}.jpg"); rel = os.path.relpath(out, OUT)
                if rel in rows: continue
                if grab(v, D * (i + 0.5) / a.k_own, out):
                    rows[rel] = {"file": rel, "label": label, "clip": name, "source": "own",
                                 "use": "eval" if j % 4 == 3 else "train"}
            print(name, label, flush=True)
        with open(man, "w", newline="") as fh:
            w = csv.DictWriter(fh, ["file", "label", "clip", "source", "use"]); w.writeheader(); w.writerows(rows.values())

if __name__ == "__main__":
    main()
