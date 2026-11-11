#!/usr/bin/env python3
"""Sport classifier: the small head over Apple's Vision feature print (lab/sport-cls/features.jsonl, from
tools/lab/SportFeatures.swift on the Mac) and the manifest. Softmax regression (numpy), trained on use=train, measured on
use=eval PER CLIP (mean of its frames' probabilities). A clip gets a sport only when its top probability >= --min-p;
otherwise "sem certeza" (the app opens the list with nothing marked). Prints per-sport results and the confusions.

    python3 tools/lab/sport_cls_train.py [--min-p 0.8] [--save lab/sport-cls/head.json]
"""
import argparse, csv, json, os, sys, collections
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import evaluate as ev
D = os.path.join(ev.ROOT, "lab", "sport-cls")

def load():
    man = {r["file"]: r for r in csv.DictReader(open(os.path.join(D, "manifest.csv")))}
    X, rows = [], []
    for line in open(os.path.join(D, "features.jsonl")):
        o = json.loads(line)
        r = man.get(o["file"])
        if r is None: continue
        X.append(np.asarray(o["v"], np.float32)); rows.append(r)
    return np.stack(X), rows

def train(X, y, k, l2=1e-3, iters=600, lr=0.5):
    n, d = X.shape
    W = np.zeros((d, k), np.float32); b = np.zeros(k, np.float32)
    Y = np.eye(k, dtype=np.float32)[y]
    w = 1.0 / np.bincount(y, minlength=k)[y]; w = w / w.mean()  # balance the classes
    for _ in range(iters):
        Z = X @ W + b; Z -= Z.max(1, keepdims=True); P = np.exp(Z); P /= P.sum(1, keepdims=True)
        G = (P - Y) * w[:, None] / n
        W -= lr * (X.T @ G + l2 * W); b -= lr * G.sum(0)
    return W, b

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--min-p", type=float, default=0.8); ap.add_argument("--save")
    a = ap.parse_args()
    X, rows = load()
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Xn = (X - mu) / sd
    labels = sorted({r["label"] for r in rows if r["use"] == "train"})
    tr = [i for i, r in enumerate(rows) if r["use"] == "train"]
    W, b = train(Xn[tr], np.array([labels.index(rows[i]["label"]) for i in tr]), len(labels))
    print("labels:", labels, "| train frames:", len(tr))
    clips = collections.defaultdict(list)
    for i, r in enumerate(rows):
        if r["use"] == "eval": clips[(r["clip"], r["label"])].append(i)
    res = collections.defaultdict(collections.Counter)
    for (clip, label), idx in sorted(clips.items()):
        Z = Xn[idx] @ W + b; Z -= Z.max(1, keepdims=True); P = np.exp(Z); P /= P.sum(1, keepdims=True)
        p = P.mean(0); k = int(p.argmax())
        got = labels[k] if p[k] >= a.min_p else "sem certeza"
        res[label][got] += 1
        print(f"  {clip:28s} {label:12s} -> {got:12s} ({p[k]:.2f} {labels[k]})")
    print("\nper sport (eval clips):")
    for label, c in sorted(res.items()):
        n = sum(c.values())
        print(f"  {label:12s} right {c[label]}/{n}  sem certeza {c['sem certeza']}  wrong {n - c[label] - c['sem certeza']}  {dict(c)}")
    if a.save:
        json.dump({"labels": labels, "mean": mu.round(6).tolist(), "std": sd.round(6).tolist(),
                   "W": W.round(6).tolist(), "b": b.round(6).tolist(), "minP": a.min_p}, open(a.save, "w"))
        print("saved", a.save)

if __name__ == "__main__":
    main()
