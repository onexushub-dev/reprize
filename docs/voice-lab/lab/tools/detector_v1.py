"""v1: same as v0, with the training sets built once and two variants:
A = v0 negatives; B = A + talk from the game (watch) as extra negatives.
Two firing rules: one window over the threshold, or two in a row. Prints where false triggers happen."""
import pickle, os, sys
import numpy as np
from sklearn.neural_network import MLPClassifier
from detector_v1_lib import *  # noqa
import features as F

cache = os.path.join(HERE, "cache_v1.pkl")
if os.path.exists(cache):
    P = pickle.load(open(cache, "rb"))
else:
    P = {"home_other": make_pos(home_pos + other_pos), "watch": {d: make_pos(watch_pos[d]) for d in (3, 5, 9)}}
    Xn, yn = make_set([], n_noise=5000)  # noise + confusers (no positives, no partials)
    P["neg"] = Xn
    P["partial"] = np.array([v for v in (window_of(mix(w, noise_train, end_lo=2.3, end_hi=2.6))
                                         for w in (home_pos + other_pos)[::2] for _ in range(5)) if v is not None], np.float32)
    P["talk"] = make_talk_neg(3000)
    pickle.dump(P, open(cache, "wb"))
print("sets:", {k: (len(v) if not isinstance(v, dict) else {d: len(x) for d, x in v.items()}) for k, v in P.items()}, flush=True)

def stream_scores(model, audio):
    W = F.windows(F.embeddings(audio))
    p = model.predict_proba(W)[:, 1]
    return np.array([F.window_end_time(j) for j in range(len(p))]), p

def events(t, p, thr, need=1, refractory=1.5):
    out, last, run = [], -1e9, 0
    for ti, pi in zip(t, p):
        run = run + 1 if pi >= thr else 0
        if run >= need and ti - last >= refractory:
            out.append(ti); last = ti
    return out

def score_clip(evts, targets, ignore):
    hit = [False] * len(targets); fa = 0
    for ev in evts:
        m = False
        for k, (s, e) in enumerate(targets):
            if s <= ev <= e + 1.0: hit[k] = True; m = True
        if not m and not any(s - 0.5 <= ev <= e + 1.5 for s, e in ignore): fa += 1
    return sum(hit), fa

noise3 = load("60s de ruido 3")
THRS = [0.8, 0.9, 0.95, 0.98, 0.99]
for variant in ("A", "B"):
    res = {}
    fa_where = []
    for d in (3, 5, 9):
        pos = [P["home_other"]] + [P["watch"][dd] for dd in (3, 5, 9) if dd != d]
        negs = [P["neg"], P["partial"]] + ([P["talk"]] if variant == "B" else [])
        X = np.concatenate(pos + negs)
        y = np.concatenate([np.ones(sum(len(a) for a in pos)), np.zeros(sum(len(a) for a in negs))])
        clf = MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)
        pickle.dump(clf, open(os.path.join(HERE, "models", f"clf_{variant}_{d}.pkl"), "wb"))
        streams = []
        for name, off in DIST_CLIPS.items():
            audio = load(name); dur = len(audio) / SR
            tg = [(s - off, e - off) for s, e, dd, _ in DIST_UTTERANCES if dd == d and s != 13.48 and 0 <= s - off <= dur]
            ot = [(s - off, e - off) for s, e, dd, _ in DIST_UTTERANCES if dd != d or s == 13.48] + [(s - off, e - off) for s, e in UNCERTAIN]
            if tg: streams.append((name, audio, tg, ot, dur))
        streams.append(("60s de ruido 3", noise3, [], [], 60.0))
        for name, audio, tg, ot, dur in streams:
            t, p = stream_scores(clf, audio)
            for thr in THRS:
                for need in (1, 2):
                    h, fa = score_clip(events(t, p, thr, need), tg, ot)
                    r = res.setdefault((thr, need), {"hit": {3: 0, 5: 0, 9: 0}, "n": {3: 0, 5: 0, 9: 0}, "fa": 0, "min": 0.0})
                    r["hit"][d] += h; r["n"][d] += len(tg); r["fa"] += fa; r["min"] += dur / 60
                    if thr == 0.95 and need == 2:
                        for ev in events(t, p, thr, need):
                            if not any(s <= ev <= e + 1.0 for s, e in tg) and not any(s - 0.5 <= ev <= e + 1.5 for s, e in ot):
                                fa_where.append((d, name, round(ev, 2)))
    print(f"\nvariant {variant}: threshold, rule | 3 m | 5 m | 9 m | false triggers")
    for (thr, need), r in sorted(res.items()):
        print(f"  {thr:.2f} {'1 janela' if need == 1 else '2 seguidas'} | {r['hit'][3]}/{r['n'][3]} | {r['hit'][5]}/{r['n'][5]} | {r['hit'][9]}/{r['n'][9]} | {r['fa']} em {r['min']:.1f} min")
    print("  false triggers at 0.95 / 2 seguidas:", fa_where, flush=True)
