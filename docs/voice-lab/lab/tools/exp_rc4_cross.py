"""Cross-check of the rc1+veto idea with real -ar from both people (Yasmin and Victor, VoiceBench Parecidas 2026-11-26).
1) veto model trained on Victor's -ar only, tested on Yasmin's session (held out);
2) other seed of the Yasmin-only veto;
3) veto trained on both (seeds 1, 2) — candidate for salvar-v2-rc4 = rc1 + veto."""
import pickle, numpy as np
s = open('exp_rc4.py').read(); exec(s[:s.index("if __name__ == '__main__':")])
REAL_AR['Victor'] = ('20261126-095648', [])
class Veto:
    def __init__(self, a, b, tau): self.a, self.b, self.tau = a, b, tau
    def predict_proba(self, X):
        p = self.a.predict_proba(X)[:, 1] * (self.b.predict_proba(X)[:, 1] >= self.tau); return np.stack([1 - p, p], 1)
SW = {}
for spk, (n, cuts) in REAL_AR.items():
    W = V7.windows(V7.load(f'{B}/{n}-confusers.wav')); SW[spk] = (W, V7.times(len(W)), cuts)
def par(m):
    out = []
    for spk, (W, t, cuts) in SW.items():
        e = V2.events(t, m.predict_proba(W)[:, 1], 0.95, 2)
        out.append(f"{spk} {sum(not any(a <= x <= b + 1.2 for a, b in cuts) for x in e)}")
    return 'Parecidas -ar: ' + ' '.join(out)
rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
def rep(name, m): print(par(m), '|', end=' '); report2(name, m)
posW = late + [D['ms_pos'], D['piper_pos']]
base = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas']]
rep('rc1', rc1)
vy2 = pickle.load(open('clf_rc4b_s2.pkl', 'rb'))
for tau in (0.02, 0.05): rep(f'vetoY s2 {tau}', Veto(rc1, vy2, tau))
vv = fit_seed(posW, base + real_ar('Yasmin') * 3, 1, 256); pickle.dump(vv, open('clf_rc4v_s1.pkl', 'wb'))
for tau in (0.02, 0.05): rep(f'vetoV s1 {tau}', Veto(rc1, vv, tau))
for seed in (1, 2):
    vb = fit_seed(posW, base + real_ar() * 3, seed, 256); pickle.dump(vb, open(f'clf_rc4yv_s{seed}.pkl', 'wb'))
    for tau in (0.02, 0.05): rep(f'vetoYV s{seed} {tau}', Veto(rc1, vb, tau))
