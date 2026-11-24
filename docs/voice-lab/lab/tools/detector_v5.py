"""v5: the model never had a real far-away woman's "salvar" (every phone-recorded positive was Victor's).
M5 = M4's sets + day-1 phone recordings of Sara (3 and 9 m) and Yasmin (3 m) + the women's close words (Sara and
Yasmin day 1, Yasmin day 2) augmented 3x more than the rest. Tested on the same day-2 words (Yasmin 5/10 m held out).

Day-1 alignments: Sara's watch -> "3m 9m - normal e forte" at -19.29 s (two words Whisper reads in both agree within
0.1 s); Yasmin's watch -> "3m normal" at -14.36 s ("Salvar" at 40.94 s on the phone = 26.58 s on the watch).
"""
import os
import pickle

import numpy as np
from sklearn.neural_network import MLPClassifier

import detector_v1_lib as L
import detector_v2 as V2
import detector_v4 as V4

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
rng = np.random.default_rng(41)

FEMALE_PHONE = {
    "3m 9m - normal e forte": [(22.18, 23.31), (23.81, 24.94), (25.38, 26.35), (34.56, 35.66), (36.16, 37.19), (37.29, 38.58)],
    "3m normal": [(35.26, 36.36), (38.76, 39.96), (40.36, 41.36)],
}

cache5 = os.path.join(HERE, "cache_v5.pkl")
if os.path.exists(cache5):
    G = pickle.load(open(cache5, "rb"))
else:
    ten_audio = [a for a in (V2.load(p) for p in V4.ten_train) if len(a) > 2.5 * SR]
    camp_audio = [a for a in (V2.load(p) for p in V2.camp_train) if len(a) > 2.5 * SR]
    pool = L.noise_train + camp_audio + ten_audio
    women = L.other_pos + V2.close_words("QD 5 3")
    G = {"women_close": np.array([v for v in (L.window_of(L.mix(w, pool, snr_lo=-4, snr_hi=14)) for w in women for _ in range(120))
                                  if v is not None], np.float32)}
    X = []
    for clip, spans in FEMALE_PHONE.items():
        a = V2.load(os.path.join(L.WAV, clip + ".wav"))
        for s, e in spans:
            for _ in range(16):
                end = e + rng.uniform(0.05, 0.45)
                seg = L.cut(a, end - L.CLIP, end)
                if len(seg) == int(L.CLIP * SR):
                    v = L.window_of(seg / (np.max(np.abs(seg)) + 1e-9) * rng.uniform(0.1, 0.9))
                    if v is not None:
                        X.append(v)
    G["women_phone"] = np.array(X, np.float32)
    pickle.dump(G, open(cache5, "wb"))
print("v5 sets:", {k: len(v) for k, v in G.items()}, flush=True)

P, Q, T = V2.P, V2.Q, V4.T
pos = [P["home_other"]] + [P["watch"][d] for d in (3, 5, 9)] + [Q["phone_day1"], Q["close2"], Q["day1_under_camp"],
                                                               T["words_under_ten"], G["women_close"], G["women_phone"]]
neg = [P["neg"], P["partial"], P["talk"], Q["conf2"], Q["camp_noise"], T["ten_noise"]] + [T["ten_hard"]] * 3
X = np.concatenate(pos + neg)
y = np.concatenate([np.ones(sum(len(a) for a in pos)), np.zeros(sum(len(a) for a in neg))])
m5 = MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)
pickle.dump(m5, open(os.path.join(HERE, "models", "clf_v5_M5.pkl"), "wb"))
for thr in (0.9, 0.95, 0.98):
    n, mins = V4.fa_on(m5, V4.ten_test, thr)
    print(f"M5 tennis test half, {thr} x2: {n} false in {mins:.1f} min", flush=True)
V2.models = {"M5": m5}
V2.report()
