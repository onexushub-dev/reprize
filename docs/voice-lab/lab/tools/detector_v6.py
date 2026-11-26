"""v6: two more women (Bel, Eliane) at 3, 5 and 10 m, no wind.
1. M4 as it is on them (it never heard either).
2. Cross-speaker: M6-Bel = M4's sets + Eliane's close words -> test Bel; M6-Eliane the reverse.
3. M6 = M4's sets + both women's close words -> test both, Yasmin day 2 (5/10 m) again, and the false-trigger sets.
The women's far-field clips are never trained on."""
import os, pickle
import numpy as np
import soundfile as sf
from sklearn.neural_network import MLPClassifier
import detector_v1_lib as L
import detector_v2 as V2
import detector_v4 as V4
import features as F
from labels3 import CLIPS3, CLOSE3, WORD

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
MW = os.path.join(L.WAV, "mulheres")
rng = np.random.default_rng(53)
load = lambda n: sf.read(os.path.join(MW, n + ".wav"), dtype="float32")[0]

ten_audio = [a for a in (V2.load(p) for p in V4.ten_train) if len(a) > 2.5 * SR]
camp_audio = [a for a in (V2.load(p) for p in V2.camp_train) if len(a) > 2.5 * SR]
pool = L.noise_train + camp_audio + ten_audio

cache6 = os.path.join(HERE, "cache_v6.pkl")
if os.path.exists(cache6):
    C = pickle.load(open(cache6, "rb"))
else:
    C = {}
    for who, spans in CLOSE3.items():
        a = load(who)
        words = [L.cut(a, s - 0.05, e + 0.05) for s, e in spans]
        C[who] = np.array([v for v in (L.window_of(L.mix(w, pool, snr_lo=-4, snr_hi=16)) for w in words for _ in range(60)) if v is not None], np.float32)
    pickle.dump(C, open(cache6, "wb"))
print("v6 sets:", {k: len(v) for k, v in C.items()}, flush=True)

P, Q, T = V2.P, V2.Q, V4.T
base_pos = [P["home_other"]] + [P["watch"][d] for d in (3, 5, 9)] + [Q["phone_day1"], Q["close2"], Q["day1_under_camp"], T["words_under_ten"]]
base_neg = [P["neg"], P["partial"], P["talk"], Q["conf2"], Q["camp_noise"], T["ten_noise"]] + [T["ten_hard"]] * 3

def fit(extra):
    pos = base_pos + extra
    X = np.concatenate(pos + base_neg)
    y = np.concatenate([np.ones(sum(len(a) for a in pos)), np.zeros(sum(len(a) for a in base_neg))])
    return MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)

emb = {}
def women_score(m, thr, need, who_list=("Bel", "Eliane")):
    res = {}
    fa = 0
    for clip, d in CLIPS3.items():
        if clip not in emb:
            W = F.windows(F.embeddings(load(clip))); emb[clip] = (W, np.array([F.window_end_time(j) for j in range(len(W))]))
        W, t = emb[clip]
        ev = V2.events(t, m.predict_proba(W)[:, 1], thr, need)
        all_words = [(s, s + WORD) for w in ("Bel", "Eliane") for s in d[w]]
        for who in who_list:
            tg = [(s, s + WORD) for s in d[who]]
            hit = sum(any(s - 0.5 <= x <= e + 1.0 for x in ev) for s, e in tg)
            res[(who, d["dist"])] = (hit, len(tg))
        fa += sum(1 for x in ev if not any(s - 0.5 <= x <= e + 1.0 for s, e in all_words))
    return res, fa

def show(name, m, who_list=("Bel", "Eliane")):
    for thr, need in ((0.8, 2), (0.9, 2), (0.95, 2)):
        r, fa = women_score(m, thr, need, who_list)
        cells = " ".join(f"{w} {dd}m {h}/{n}" for (w, dd), (h, n) in sorted(r.items(), key=lambda kv: (kv[0][0], kv[0][1])))
        print(f"{name} {thr} x2 | {cells} | outros disparos nos clipes: {fa}", flush=True)

m4 = pickle.load(open(os.path.join(HERE, "models", "clf_v4_M4.pkl"), "rb"))
show("M4 (nunca ouviu)", m4)
m_bel = fit([C["Eliane perto"]]); show("M6 sem Bel (teste Bel)", m_bel, ("Bel",))
m_eli = fit([C["Bel perto"]]); show("M6 sem Eliane (teste Eliane)", m_eli, ("Eliane",))
m6 = fit([C["Bel perto"], C["Eliane perto"]]); pickle.dump(m6, open(os.path.join(HERE, "models", "clf_v6_M6.pkl"), "wb"))
show("M6 (com as duas de perto)", m6)
for thr in (0.9, 0.95):
    n, mins = V4.fa_on(m6, V4.ten_test, thr); print(f"M6 tennis test half {thr} x2: {n} in {mins:.1f} min", flush=True)
V2.models = {"M6": m6}
V2.report()
