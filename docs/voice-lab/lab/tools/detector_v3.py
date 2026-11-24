"""v3: same tests as v2. Targets the two gaps v2 showed:
- Yasmin far away (5 and 10 m) was missed: too few high voices in training -> positives also pitched up (resampled
  x1.1-1.4, which raises pitch and formants like a higher voice) and mixed with synthetic wind (day 2 was windy).
- false triggers under crowd + music -> more championship noise (training half only) and hard negatives: windows of
  the training noise where M2 already scores high.
"""
import os
import pickle

import numpy as np
from scipy.signal import butter, sosfilt
from sklearn.neural_network import MLPClassifier

import detector_v1_lib as L
import detector_v2 as V2  # builds/loads the v2 sets and runs the v2 report once (cached embeddings)
import features as F

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
rng = np.random.default_rng(23)


def wind(n):
    x = np.cumsum(rng.standard_normal(n)).astype(np.float32)
    x = sosfilt(butter(2, [20, rng.uniform(400, 900)], btype="band", fs=SR, output="sos"), x)
    t = np.arange(n) / SR
    env = 0.4 + 0.6 * np.abs(np.sin(2 * np.pi * rng.uniform(0.3, 1.5) * t + rng.uniform(0, 6.3)))
    x = x * env
    return (x / (np.sqrt(np.mean(x ** 2)) + 1e-9)).astype(np.float32)


def with_wind(clip):
    w = wind(len(clip)) * np.sqrt(np.mean(clip ** 2)) * 10 ** (rng.uniform(-6, 6) / 20)
    y = clip + w
    return (y / (np.max(np.abs(y)) + 1e-9) * rng.uniform(0.1, 0.9)).astype(np.float32)


def pitched(word):
    return L.speed(word, rng.uniform(1.1, 1.4))  # shorter and higher, like a higher voice


all_words = L.home_pos + L.other_pos + [w for ws in L.watch_pos.values() for w in ws]
close2 = [w for n in V2.CLOSE2 for w in V2.close_words(n)]
camp_audio = [a for a in (V2.load(p) for p in V2.camp_train) if len(a) > 2.5 * SR]
pool = L.noise_train + camp_audio

cache3 = os.path.join(HERE, "cache_v3.pkl")
if os.path.exists(cache3):
    R = pickle.load(open(cache3, "rb"))
else:
    def win(a):
        return L.window_of(a)

    R = {
        "pitch_pos": np.array([v for v in (win(L.mix(pitched(w), pool)) for w in all_words + close2 for _ in range(12)) if v is not None], np.float32),
        "wind_pos": np.array([v for v in (win(with_wind(L.mix(w, pool, snr_lo=0, snr_hi=20))) for w in all_words + close2 for _ in range(10)) if v is not None], np.float32),
        "wind_pitch_pos": np.array([v for v in (win(with_wind(L.mix(pitched(w), pool, snr_lo=0, snr_hi=20))) for w in all_words + close2 for _ in range(6)) if v is not None], np.float32),
        "wind_neg": np.array([v for v in (win(with_wind(L.noise_bed(pool))) for _ in range(2500)) if v is not None], np.float32),
        "camp_more": np.array([v for v in (win(L.noise_bed(camp_audio) * rng.uniform(0.5, 3.0)) for _ in range(4000)) if v is not None], np.float32),
    }
    # hard negatives: every training-noise window M2 scores >= 0.3
    m2 = V2.models["M2"]
    hard = []
    for a in pool:
        W = F.windows(F.embeddings(a))
        if len(W):
            p = m2.predict_proba(W)[:, 1]
            hard.extend(W[p >= 0.3])
    R["hard"] = np.array(hard, np.float32)
    pickle.dump(R, open(cache3, "wb"))
print("v3 sets:", {k: len(v) for k, v in R.items()}, flush=True)

P, Q = V2.P, V2.Q
pos = [P["home_other"]] + [P["watch"][d] for d in (3, 5, 9)] + [Q["phone_day1"], Q["close2"], Q["day1_under_camp"],
                                                               R["pitch_pos"], R["wind_pos"], R["wind_pitch_pos"]]
neg = [P["neg"], P["partial"], P["talk"], Q["conf2"], Q["camp_noise"], R["wind_neg"], R["camp_more"]] + [R["hard"]] * 3
X = np.concatenate(pos + neg)
y = np.concatenate([np.ones(sum(len(a) for a in pos)), np.zeros(sum(len(a) for a in neg))])
m3 = MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)
pickle.dump(m3, open(os.path.join(HERE, "models", "clf_v3_M3.pkl"), "wb"))
V2.models = {"M3": m3}
V2.report()
