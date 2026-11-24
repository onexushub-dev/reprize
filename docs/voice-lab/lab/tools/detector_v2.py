"""v2: test the "salvar" detector on a different day (2026-11-24: wind, no music, Yasmin and Victor at 3/5/10/12 m)
and measure false triggers on ~1 h of other courts (basketball, beach tennis, volleyball) plus half of a beach tennis
championship (crowd + music) that is never used in training.

M1 = trained on day 1 only (variant B of v1, all distances together).
M2 = M1 + the day-1 phone recordings of each "salvar" (real far-field) + day-2 close voices and confusers
     + the other half of the championship as noise (alone and under the words).
Neither model ever sees the day-2 far-field recordings.
"""
import glob
import json
import os
import pickle
import re

import numpy as np
import soundfile as sf
from sklearn.neural_network import MLPClassifier

import detector_v1_lib as L
import features as F
from labels import DIST_CLIPS, DIST_UTTERANCES
from labels2 import CLIPS2, CLOSE2, CONFUSERS2, UTT2

HERE = os.path.dirname(os.path.abspath(__file__))
D2 = os.path.join(L.WAV, "2026-11-24")
SR = 16000
rng = np.random.default_rng(11)


def load(path):
    x, sr = sf.read(path, dtype="float32")
    assert sr == SR
    return x


# ---------- noise sets ----------
camp = sorted(glob.glob(os.path.join(L.WAV, "ruido", "camp_*.wav")))
camp_train, camp_test = camp[0::2], camp[1::2]
other_courts = sorted(glob.glob(os.path.join(L.WAV, "noise", "*.wav")))

# ---------- day-2 close voices ----------
SALV = re.compile(r"salv|sol ?b|telbar|solver|sour|sauv", re.I)


def close_words(name):
    d = json.load(open(os.path.join(HERE, "marks2", name + ".json")))
    x = load(os.path.join(D2, name + ".wav"))
    out = []
    for s in d["segments"]:
        single = "," not in s["text"] and len(s["text"]) <= 12 and s["end"] - s["start"] <= 1.5
        if single and SALV.search(s["text"]):
            out.append(L.cut(x, s["start"] - 0.05, s["end"] + 0.05))
    return out


def confuser_words(name):
    d = json.load(open(os.path.join(HERE, "marks2", name + ".json")))
    x = load(os.path.join(D2, name + ".wav"))
    return [L.cut(x, s["start"] - 0.05, s["end"] + 0.05) for s in d["segments"]]


# ---------- day-1 phone far-field windows (real) ----------
def phone_day1_windows(k=8):
    X = []
    for name, off in DIST_CLIPS.items():
        a = load(os.path.join(L.WAV, name + ".wav"))
        for s, e, _, _ in DIST_UTTERANCES:
            cs, ce = s - off, e - off
            if cs < 0.3 or ce > len(a) / SR - 0.5:
                continue
            for _ in range(k):
                end = ce + rng.uniform(0.05, 0.45)
                seg = L.cut(a, end - L.CLIP, end)
                if len(seg) == int(L.CLIP * SR):
                    v = L.window_of(seg / (np.max(np.abs(seg)) + 1e-9) * rng.uniform(0.1, 0.9))
                    if v is not None:
                        X.append(v)
    return np.array(X, np.float32)


cache2 = os.path.join(HERE, "cache_v2.pkl")
P = pickle.load(open(os.path.join(HERE, "cache_v1.pkl"), "rb"))
if os.path.exists(cache2):
    Q = pickle.load(open(cache2, "rb"))
else:
    camp_audio = [a for a in (load(p) for p in camp_train) if len(a) > 2.5 * SR]
    L.noise_train = L.noise_train + camp_audio  # words below get mixed into day-1 noise and championship noise
    close = [w for n in CLOSE2 for w in close_words(n)]
    conf2 = [w for n in CONFUSERS2 for w in confuser_words(n)]
    Q = {
        "close2": L.make_pos(close, k_pos=40),
        "conf2": np.array([v for v in (L.window_of(L.mix(w, L.noise_train)) for w in conf2 for _ in range(25)) if v is not None], np.float32),
        "day1_under_camp": np.array([v for v in (L.window_of(L.mix(w, camp_audio)) for w in L.home_pos + L.other_pos
                                                for _ in range(15)) if v is not None], np.float32),
        "camp_noise": np.array([v for v in (L.window_of(L.noise_bed(camp_audio) * rng.uniform(0.5, 3.0)) for _ in range(3000)) if v is not None], np.float32),
        "phone_day1": phone_day1_windows(),
    }
    pickle.dump(Q, open(cache2, "wb"))
print("v2 sets:", {k: len(v) for k, v in Q.items()}, "close words:", flush=True)


def fit(pos, neg):
    X = np.concatenate(pos + neg)
    y = np.concatenate([np.ones(sum(len(a) for a in pos)), np.zeros(sum(len(a) for a in neg))])
    return MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)


day1_pos = [P["home_other"]] + [P["watch"][d] for d in (3, 5, 9)]
day1_neg = [P["neg"], P["partial"], P["talk"]]
models = {}
for k in ("M1", "M2"):
    path = os.path.join(HERE, "models", f"clf_v2_{k}.pkl")
    if os.path.exists(path):
        models[k] = pickle.load(open(path, "rb"))
    else:
        models[k] = fit(day1_pos, day1_neg) if k == "M1" else fit(
            day1_pos + [Q["phone_day1"], Q["close2"], Q["day1_under_camp"]], day1_neg + [Q["conf2"], Q["camp_noise"]])
        pickle.dump(models[k], open(path, "wb"))

# ---------- evaluation ----------
emb_cache = {}


def windows_of(path):
    if path not in emb_cache:
        W = F.windows(F.embeddings(load(path)))
        emb_cache[path] = (W, np.array([F.window_end_time(j) for j in range(len(W))]))
    return emb_cache[path]


def events(t, p, thr, need, refr=1.5):
    out, last, run = [], -1e9, 0
    for ti, pi in zip(t, p):
        run = run + 1 if pi >= thr else 0
        if run >= need and ti - last >= refr:
            out.append(ti)
            last = ti
    return out


THR = [(0.5, 1), (0.8, 1), (0.8, 2), (0.9, 2), (0.95, 2), (0.98, 2)]

def report():
    for name, m in models.items():
        print(f"\n=== {name} ===")
        for thr, need in THR:
            hit = {}
            fa_clips = 0
            for clip, off in CLIPS2.items():
                W, t = windows_of(os.path.join(D2, clip + ".wav"))
                p = m.predict_proba(W)[:, 1]
                dur = t[-1] + 0.2
                tg = [(s - off, e - off, spk, d) for s, e, spk, d in UTT2 if 0 <= s - off <= dur]
                others = [(s - off, e - off) for s, e, _, _ in UTT2]
                got = set()
                for ev in events(t, p, thr, need):
                    m_ = [k for k, (s, e, _, _) in enumerate(tg) if s - 1.0 <= ev <= e + 1.5]
                    got.update(m_)
                    if not m_ and not any(s - 1.0 <= ev <= e + 2.0 for s, e in others):
                        fa_clips += 1
                for k, (_, _, spk, d) in enumerate(tg):
                    key = (spk, d)
                    h, n = hit.get(key, (0, 0))
                    hit[key] = (h + (k in got), n + 1)
            fa = {}
            for label, files in (("outras quadras", other_courts), ("campeonato (teste)", camp_test)):
                n_fa, secs = 0, 0.0
                for f in files:
                    W, t = windows_of(f)
                    if len(W) == 0:
                        continue
                    p = m.predict_proba(W)[:, 1]
                    n_fa += len(events(t, p, thr, need))
                    secs += t[-1] + 0.2
                fa[label] = (n_fa, secs / 60)
            cells = " ".join(f"{spk[0]}{d}m {h}/{n}" for (spk, d), (h, n) in sorted(hit.items(), key=lambda kv: (kv[0][1], kv[0][0])))
            le10 = [v for (spk, d), v in hit.items() if d <= 10]
            tot10 = f"{sum(h for h, _ in le10)}/{sum(n for _, n in le10)}"
            fas = "; ".join(f"{k}: {v[0]} em {v[1]:.1f} min ({v[0] / v[1] * 60:.1f}/h)" for k, v in fa.items())
            print(f"thr {thr} x{need} | <=10 m {tot10} | {cells} | falsos nos clipes do dia 2: {fa_clips} | {fas}", flush=True)


if __name__ == "__main__":
    report()
