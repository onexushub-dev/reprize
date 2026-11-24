"""Re-score the saved v1 classifiers (variant B) with the corrected labels, on the phone clips and on the watch."""
import pickle, os
import numpy as np
import soundfile as sf
import features as F
from labels import DIST_CLIPS, DIST_UTTERANCES, DIST_WATCH, UNCERTAIN
HERE = os.path.dirname(os.path.abspath(__file__)); WAV = os.environ.get("VOICE_LAB_WAV", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "wav16")); SR = 16000
load = lambda n: sf.read(os.path.join(WAV, n + ".wav"), dtype="float32")[0]
def events(t, p, thr, need, refr=1.5):
    out, last, run = [], -1e9, 0
    for ti, pi in zip(t, p):
        run = run + 1 if pi >= thr else 0
        if run >= need and ti - last >= refr: out.append(ti); last = ti
    return out
def score(ev, tg, ig):
    hit = set(); fa = 0
    for x in ev:
        m = [k for k, (s, e) in enumerate(tg) if s <= x <= e + 1.0]
        hit.update(m)
        if not m and not any(s - 0.5 <= x <= e + 1.5 for s, e in ig): fa += 1
    return len(hit), fa
cache = {}
def scores(clf_key, clf, name, audio):
    k = (clf_key, name)
    if k not in cache:
        W = F.windows(F.embeddings(audio)); p = clf.predict_proba(W)[:, 1]
        cache[k] = (np.array([F.window_end_time(j) for j in range(len(p))]), p)
    return cache[k]
noise3 = load("60s de ruido 3"); watch = load(DIST_WATCH)
for thr, need in [(0.8, 2), (0.9, 2), (0.95, 1), (0.95, 2)]:
    ph = {3: [0, 0], 5: [0, 0], 9: [0, 0]}; wa = {3: [0, 0], 5: [0, 0], 9: [0, 0]}; fa = 0; mins = 0
    for d in (3, 5, 9):
        clf = pickle.load(open(os.path.join(HERE, "models", f"clf_B_{d}.pkl"), "rb"))
        for name, off in DIST_CLIPS.items():
            a = load(name); dur = len(a) / SR
            tg = [(s - off, e - off) for s, e, dd, _ in DIST_UTTERANCES if dd == d and 0 <= s - off <= dur]
            ig = [(s - off, e - off) for s, e, dd, _ in DIST_UTTERANCES if dd != d] + [(s - off, e - off) for s, e in UNCERTAIN]
            if not tg: continue
            t, p = scores(d, clf, name, a); h, f = score(events(t, p, thr, need), tg, ig)
            ph[d][0] += h; ph[d][1] += len(tg); fa += f; mins += dur / 60
        t, p = scores(d, clf, "noise3", noise3); h, f = score(events(t, p, thr, need), [], []); fa += f; mins += 1
        tg = [(s, e) for s, e, dd, _ in DIST_UTTERANCES if dd == d]
        t, p = scores(d, clf, "watch", watch); h, _ = score(events(t, p, thr, need), tg, [])
        wa[d] = [h, len(tg)]
    print(f"thr {thr} {'2 seguidas' if need == 2 else '1 janela'} | celular 3m {ph[3][0]}/{ph[3][1]} 5m {ph[5][0]}/{ph[5][1]} 9m {ph[9][0]}/{ph[9][1]} | falsos {fa} em {mins:.1f} min | relógio 3m {wa[3][0]}/{wa[3][1]} 5m {wa[5][0]}/{wa[5][1]} 9m {wa[9][0]}/{wa[9][1]}")
