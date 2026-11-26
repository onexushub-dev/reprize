"""Candidates under Victor's 2026-11-25 target: very accurate up to 5 m, reasonable up to 10 m, no false triggers."""
import os, pickle, numpy as np
src8 = open('exp_v8.py').read(); exec(src8[:src8.index("def fit_seed")])
def run(m, thr, need):
    near = [0, 0]; far = [0, 0]; extra = 0
    for clip, off in CLIPS2.items():
        path = os.path.join(V2.D2, clip + '.wav'); e = ev(m, path, thr, need); t, _ = win(path)
        used = set()
        for s, en, spk, d in UTT2:
            if d == 12 or not (0 <= s - off <= t[-1]): continue
            h = [x for x in e if s - off - 1 <= x <= en - off + 1.5]; used.update(h)
            (near if d <= 5 else far)[0] += bool(h); (near if d <= 5 else far)[1] += 1
    for clip, d in CLIPS3.items():
        path = os.path.join(V2.HERE, 'w2/wav16/mulheres', clip + '.wav'); e = ev(m, path, thr, need)
        for s in d['Eliane']:
            h = any(s - 0.5 <= x <= s + WORD + 1.0 for x in e); (near if d['dist'] <= 5 else far)[0] += h; (near if d['dist'] <= 5 else far)[1] += 1
    for c, dist in Y2.items():
        n = len(ev(m, os.path.join(V2.HERE, 'w2/wav16/yasmin2', c + '.wav'), thr, need))
        (near if dist <= 5 else far)[0] += min(n, 6); (near if dist <= 5 else far)[1] += 6; extra += max(0, n - 6)
    for f, dist in (('20261124-202720-accuracy.wav', 3), ('20261124-203230-accuracy.wav', 10), ('20261124-203420-accuracy.wav', 10)):
        n = len(ev(m, os.path.join(V7.BENCH, f), thr, need)); (near if dist <= 5 else far)[0] += min(n, 6); (near if dist <= 5 else far)[1] += 6; extra += max(0, n - 6)
    fa = sum(len(ev(m, p, thr, need)) for p in noise)
    cf = len(V2.events(np.arange(len(Wrest)) * 0.08, m.predict_proba(Wrest)[:, 1], thr, need))
    cw = len(V2.events(np.arange(len(Wwords)) * 0.08, m.predict_proba(Wwords)[:, 1], thr, need))
    return near, far, fa, cf, cw, extra

def pub(m, thr, need):
    def nf(key, x):
        if key not in WC: WC[key] = F.windows(F.embeddings(pad(x)))
        W = WC[key]
        return len(V2.events(np.arange(len(W)) * 0.08, m.predict_proba(W)[:, 1], thr, need, refr=19)) if len(W) else 0
    c = sum(nf(('mc', i), x) for i, (w, x) in enumerate(ms_test_conf)) + sum(nf(('cc', i), x) for i, x in enumerate(cv_conf_test))
    t = sum(nf(('ct', i), x) for i, x in enumerate(cv_talk_test))
    return c, t
C = [('v1 (atual)', 'clf_v4_M4.pkl', 0.95, 2), ('v1 rígido', 'clf_v4_M4.pkl', 0.98, 3),
     ('v2 sintético', 'clf_v7_late_g1_s0.pkl', 0.95, 2), ('v2 sintético rígido', 'clf_v7_late_g1_s0.pkl', 0.98, 3),
     ('v2 público h256', 'clf_v8_h256_s1.pkl', 0.95, 2), ('v2 público h256 0.85', 'clf_v8_h256_s1.pkl', 0.85, 2),
     ('v2 público h256 0.7', 'clf_v8_h256_s1.pkl', 0.7, 2)]
for name, f, thr, need in C:
    m = pickle.load(open(f, 'rb'))
    near, far, fa, cf, cw, extra = run(m, thr, need); c, t = pub(m, thr, need)
    print(f"{name:22s} thr {thr} x{need} | <=5 m {near[0]}/{near[1]} | 10 m {far[0]}/{far[1]} | falsos: quadra {fa}/67min crossfit {cf}/33min extras {extra} conversa CV {t}/400 | parecidas: crossfit {cw}/8 publicas {c}/225", flush=True)
