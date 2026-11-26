"""rc5 seeds/threshold sweep: veto on all three real -ar sessions; keep only a version equal to rc1 on every salvar.
Also checks the 6 VoiceBench Acerto sessions of 2026-11-26 afternoon (quiet and loud talk, 3/5/10 m)."""
import pickle, numpy as np
s = open('exp_rc5.py').read(); exec(s[:s.index("print('rc1 -ar:'")])
NEW = ['144407', '144439', '144513', '144726', '144804', '144835']
NW = {n: V7.windows(V7.load(f'{B}/20261126-{n}-accuracy.wav')) for n in NEW}
def newacc(m):
    return ' '.join(str(len(V2.events(V7.times(len(W)), m.predict_proba(W)[:, 1], 0.95, 2))) for W in NW.values())
print('rc1 tarde (fires por sessao):', newacc(rc1), flush=True)
for seed in (0, 2, 3):
    v = fit_seed(posW, base + real_ar() * 3, seed, 256); pickle.dump(v, open(f'clf_rc5_s{seed}.pkl', 'wb'))
    for tau in (0.02, 0.05):
        m = Veto(rc1, v, tau); print(f'tarde {newacc(m)} | -ar {par(m)} |', end=' '); report2(f'rc5 s{seed} {tau}', m)
v = pickle.load(open('clf_rc5_s1.pkl', 'rb'))
m = Veto(rc1, v, 0.02); print(f'tarde {newacc(m)} | -ar {par(m)} |', end=' '); report2('rc5 s1 0.02', m)
