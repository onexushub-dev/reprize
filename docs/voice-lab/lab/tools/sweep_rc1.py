import pickle, numpy as np
s = open('eval_range.py').read(); exec(s[:s.index("C = [")])
TODAY = {  # word times from the v1/rc1 offline firings on 2026-11-25 (Victor, home; TV on for 1156-1159)
 '20261125-115049': (3, [8.78, 11.34, 13.74, 16.06, 18.13]), '20261125-115116': (5, [8.94, 11.34, 13.74, 16.13, 18.22]),
 '20261125-115144': (10, [11.74, 14.14, 16.54, 18.93, 21.26]),
 '20261125-115639': (3, [8.1, 10.1, 12.3, 14.8, 16.7]), '20261125-115705': (5, [8.8, 11.3, 14.3, 16.9, 19.5]),
 '20261125-115744': (10, [13.7, 18.3, 21.2, 23.3, 26.9]), '20261125-115832': (10, [38.0, 40.1, 42.3, 44.9, 47.3]),
 '20261125-115942': (10, [36.3, 38.7, 41.2, 43.8, 46.1])}
def today(m, thr, need):
    near = [0, 0]; far = [0, 0]; false = 0
    for f, (d, words) in TODAY.items():
        e = ev(m, os.path.join(V7.BENCH, f + '-accuracy.wav'), thr, need)
        hit = sum(any(w - 0.7 <= x <= w + 0.8 for x in e) for w in words)
        false += sum(not any(w - 0.7 <= x <= w + 0.8 for w in words) for x in e)
        b = near if d <= 5 else far; b[0] += hit; b[1] += len(words)
    return near, far, false
m = pickle.load(open('clf_v8_h256_s1.pkl', 'rb')); m1 = pickle.load(open('clf_v4_M4.pkl', 'rb'))
for name, mm, thr, need in [('v1', m1, 0.95, 2), ('rc1', m, 0.95, 2), ('rc1', m, 0.9, 2), ('rc1', m, 0.85, 2), ('rc1', m, 0.8, 2), ('rc1', m, 0.97, 1), ('rc1', m, 0.95, 1)]:
    near, far, fa, cf, cw, extra = run(mm, thr, need); c, t = pub(mm, thr, need); tn, tf, tfa = today(mm, thr, need)
    print(f"{name:4s} {thr} x{need} | <=5m old {near[0]}/{near[1]} hoje {tn[0]}/{tn[1]} | 10m old {far[0]}/{far[1]} hoje {tf[0]}/{tf[1]} | FALSOS quadra {fa} crossfit {cf} casa-hoje {tfa} conversaCV {t}/400 | parecidas crossfit {cw}/8 publicas {c}/225", flush=True)
