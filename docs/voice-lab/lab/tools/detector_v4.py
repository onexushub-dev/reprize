"""v4: adds the tennis-lesson noise (loud talk from other coaches nearby, 2026-11-24 folder ruido-tenis).

First M2 as it is on all the tennis audio (never seen). Then M4 = M2's training sets + half of the tennis files as noise
(alone and under the words) + hard negatives from that half; tested on the other half, the championship test half and
the other courts, plus the day-2 far-field words.
"""
import glob
import os
import pickle

import numpy as np
from sklearn.neural_network import MLPClassifier

import detector_v1_lib as L
import detector_v2 as V2
import features as F

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
rng = np.random.default_rng(31)
tenis = sorted(glob.glob(os.path.join(L.WAV, "tenis", "tenis_*.wav")))
ten_train, ten_test = tenis[0::2], tenis[1::2]


def fa_on(m, files, thr=0.95, need=2):
    n, secs = 0, 0.0
    for f in files:
        W, t = V2.windows_of(f)
        if len(W) == 0:
            continue
        n += len(V2.events(t, m.predict_proba(W)[:, 1], thr, need))
        secs += t[-1] + 0.2
    return n, secs / 60


m2 = V2.models["M2"]

cache4 = os.path.join(HERE, "cache_v4.pkl")
if os.path.exists(cache4):
    T = pickle.load(open(cache4, "rb"))
else:
    ten_audio = [a for a in (V2.load(p) for p in ten_train) if len(a) > 2.5 * SR]
    words = L.home_pos + L.other_pos + [w for ws in L.watch_pos.values() for w in ws]
    hard = []
    for a in ten_audio:
        W = F.windows(F.embeddings(a))
        if len(W):
            hard.extend(W[m2.predict_proba(W)[:, 1] >= 0.3])
    T = {
        "ten_noise": np.array([v for v in (L.window_of(L.noise_bed(ten_audio) * rng.uniform(0.5, 3.0)) for _ in range(4000)) if v is not None], np.float32),
        "words_under_ten": np.array([v for v in (L.window_of(L.mix(w, ten_audio)) for w in words for _ in range(10)) if v is not None], np.float32),
        "ten_hard": np.array(hard, np.float32).reshape(-1, F.WINDOW * 96),
    }
    pickle.dump(T, open(cache4, "wb"))
print("v4 sets:", {k: len(v) for k, v in T.items()}, flush=True)



def main():
    for thr in (0.9, 0.95, 0.98):
        n, mins = fa_on(m2, tenis, thr)
        print(f"M2 on all tennis audio (never seen), {thr} x2: {n} false in {mins:.1f} min", flush=True)
    P, Q = V2.P, V2.Q
    pos = [P["home_other"]] + [P["watch"][d] for d in (3, 5, 9)] + [Q["phone_day1"], Q["close2"], Q["day1_under_camp"], T["words_under_ten"]]
    neg = [P["neg"], P["partial"], P["talk"], Q["conf2"], Q["camp_noise"], T["ten_noise"]] + [T["ten_hard"]] * 3
    X = np.concatenate(pos + neg)
    y = np.concatenate([np.ones(sum(len(a) for a in pos)), np.zeros(sum(len(a) for a in neg))])
    m4 = MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)
    pickle.dump(m4, open(os.path.join(HERE, "models", "clf_v4_M4.pkl"), "wb"))

    for name, m in (("M2", m2), ("M4", m4)):
        for thr in (0.9, 0.95, 0.98):
            n, mins = fa_on(m, ten_test, thr)
            print(f"{name} tennis test half, {thr} x2: {n} false in {mins:.1f} min", flush=True)
    V2.models = {"M4": m4}
    V2.report()


if __name__ == "__main__":
    main()
