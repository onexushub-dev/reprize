"""Ablation for v7: which part costs recall. Same eval as op_point.py + crossfit, windows cached once."""
import os, pickle, sys, numpy as np, soundfile as sf
import detector_v7 as V7, detector_v2 as V2, detector_v4 as V4, features as F
from labels2 import CLIPS2, UTT2
from labels3 import CLIPS3, WORD
from sklearn.neural_network import MLPClassifier
S = pickle.load(open('cache_v7.pkl', 'rb'))
P, Q, T = V2.P, V2.Q, V4.T
Wc = {}
def win(path):
    if path not in Wc:
        W = V7.windows(V7.load(path)); Wc[path] = (V7.times(len(W)), W)
    return Wc[path]
noise = V2.other_courts + V2.camp_test + V4.ten_test
cross2 = V7.load(V7.CROSS2); a, b = V7.CROSS2_WORDS
Wwords = V7.windows(cross2[int(a*16000):int(b*16000)]); Wrest = np.concatenate([V7.windows(cross2[:int(a*16000)]), V7.windows(cross2[int(b*16000):])])
Y2 = {'Yasmin 4': 3, 'Yasmin 6': 5, 'Yasmin 11': 10}
def ev(m, path, thr=0.95, need=2):
    t, W = win(path); return V2.events(t, m.predict_proba(W)[:, 1], thr, need) if len(W) else []
def evaluate(name, m):
    fa = sum(len(ev(m, p)) for p in noise)
    v = {}
    for clip, off in CLIPS2.items():
        e = ev(m, os.path.join(V2.D2, clip + '.wav')); t, _ = win(os.path.join(V2.D2, clip + '.wav'))
        for s, en, spk, d in UTT2:
            if 0 <= s - off <= t[-1]:
                k = (spk, d); h, n = v.get(k, (0, 0)); v[k] = (h + any(s - off - 1 <= x <= en - off + 1.5 for x in e), n + 1)
    vic = sum(v[('Victor', d)][0] for d in (3, 5, 10))
    eli = 0
    for clip, d in CLIPS3.items():
        e = ev(m, os.path.join(V2.HERE, 'w2/wav16/mulheres', clip + '.wav'))
        eli += sum(any(s - 0.5 <= x <= s + WORD + 1.0 for x in e) for s in d['Eliane'])
    y2 = [len(ev(m, os.path.join(V2.HERE, 'w2/wav16/yasmin2', c + '.wav'))) for c in Y2]
    bench = [len(ev(m, os.path.join(V7.BENCH, f))) for f in ('20261124-202720-accuracy.wav', '20261124-203230-accuracy.wav', '20261124-203420-accuracy.wav')]
    cw = len(V2.events(np.arange(len(Wwords)) * 0.08, m.predict_proba(Wwords)[:, 1], 0.95, 2))
    cf = len(V2.events(np.arange(len(Wrest)) * 0.08, m.predict_proba(Wrest)[:, 1], 0.95, 2))
    print(f"{name:28s} Victor<=10m {vic}/18 | Eliane {eli}/18 | Yasmin 3/5/10m {y2} of 6 | bench 3m,10m,10m {bench} of 6 | similar words {cw} | false: courts {fa}/67min crossfit {cf}/33min", flush=True)
def fit(pos, neg):
    X = np.concatenate(pos + neg); y = np.concatenate([np.ones(sum(map(len, pos))), np.zeros(sum(map(len, neg)))])
    return MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)
base_pos_v4 = [P["home_other"]] + [P["watch"][d] for d in (3, 5, 9)] + [Q["phone_day1"], Q["close2"], Q["day1_under_camp"], T["words_under_ten"]]
base_neg = [P["neg"], P["partial"], P["talk"], Q["conf2"], Q["camp_noise"], T["ten_noise"]] + [T["ten_hard"]] * 3
evaluate('M4 (v1)', pickle.load(open('clf_v4_M4.pkl', 'rb')))
variants = {
  'v4pos + glued + cross':            (base_pos_v4, base_neg + [S['glued'], S['cross_noise']]),
  'v4pos+latepos + glued + cross':    (base_pos_v4 + [S['pos'], S['phone_pos']], base_neg + [S['glued'], S['cross_noise']]),
  'latepos + glued + cross':          ([S['pos'], S['phone_pos']], base_neg + [S['glued'], S['cross_noise']]),
  'latepos + early + glued + cross':  ([S['pos'], S['phone_pos']], base_neg + [S['early'], S['phone_early'], S['glued'], S['cross_noise']]),
}
for k, (pos, neg) in variants.items():
    m = fit(pos, neg); pickle.dump(m, open('clf_v7_' + k.replace(' ', '').replace('+', '_') + '.pkl', 'wb')); evaluate(k, m)
