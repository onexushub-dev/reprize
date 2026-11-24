"""M4 at several firing rules: hits (Victor/Yasmin day 2, Eliane, Yasmin calm) and false triggers on all held-out noise."""
import pickle, os, numpy as np, soundfile as sf
import detector_v2 as V2, detector_v4 as V4, features as F
from labels2 import CLIPS2, UTT2
from labels3 import CLIPS3, WORD
m = pickle.load(open(os.path.join(V2.HERE, 'models', 'clf_v4_M4.pkl'), 'rb'))
cache = {}
def sc(path):
    if path not in cache:
        x, _ = sf.read(path, dtype='float32'); W = F.windows(F.embeddings(x))
        cache[path] = (np.array([F.window_end_time(j) for j in range(len(W))]), m.predict_proba(W)[:, 1] if len(W) else np.array([]))
    return cache[path]
noise = V2.other_courts + V2.camp_test + V4.ten_test
mins = sum(sf.info(p).duration for p in noise) / 60
Y2 = {'Yasmin 4': 3, 'Yasmin 6': 5, 'Yasmin 11': 10}
for thr, need in [(0.8, 2), (0.9, 2), (0.95, 2), (0.95, 1), (0.98, 1), (0.99, 1)]:
    fa = sum(len(V2.events(*sc(p), thr, need)) for p in noise)
    v = {}; 
    for clip, off in CLIPS2.items():
        t, p = sc(os.path.join(V2.D2, clip + '.wav')); ev = V2.events(t, p, thr, need)
        for s, e, spk, d in UTT2:
            if 0 <= s - off <= t[-1]:
                k = (spk, d); h, n = v.get(k, (0, 0)); v[k] = (h + any(s - off - 1 <= x <= e - off + 1.5 for x in ev), n + 1)
    vic10 = sum(v[('Victor', d)][0] for d in (3, 5, 10)); 
    eli = 0
    for clip, d in CLIPS3.items():
        t, p = sc(os.path.join(V2.L.WAV, 'mulheres', clip + '.wav')); ev = V2.events(t, p, thr, need)
        eli += sum(any(s - 0.5 <= x <= s + WORD + 1.0 for x in ev) for s in d['Eliane'])
    y2 = {d: len(V2.events(*sc(os.path.join(V2.L.WAV, 'yasmin2', c + '.wav')), thr, need)) for c, d in Y2.items()}
    print(f"{thr} x{need} | Victor<=10m {vic10}/18 12m {v[('Victor',12)][0]}/6 | Eliane {eli}/18 | Yasmin calmo disparos 3m {y2[3]} 5m {y2[5]} 10m {y2[10]} | falsos {fa} em {mins:.1f} min ({fa/mins*60:.1f}/h)", flush=True)
