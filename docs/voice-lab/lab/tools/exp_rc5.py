"""salvar-v2-rc5 candidate: veto retrained with three real -ar sessions (Yasmin 094639, Victor 095648, Victor 151502)
and tested leave-one-session-out; then a veto on all three, checked on every rc1 gate. rc4's veto (Yasmin + Victor
morning) failed on Victor's afternoon session (6 -> 6)."""
import pickle, numpy as np
s = open('exp_rc4.py').read(); exec(s[:s.index("if __name__ == '__main__':")])
REAL_AR.clear()
REAL_AR.update({'Y': ('20261126-094639', [(131.5, 135.2)]), 'V1': ('20261126-095648', []), 'V2': ('20261126-151502', [])})
class Veto:
    def __init__(self, a, b, tau): self.a, self.b, self.tau = a, b, tau
    def predict_proba(self, X):
        p = self.a.predict_proba(X)[:, 1] * (self.b.predict_proba(X)[:, 1] >= self.tau); return np.stack([1 - p, p], 1)
SW = {}
for k, (n, cuts) in REAL_AR.items():
    W = V7.windows(V7.load(f'{B}/{n}-confusers.wav')); SW[k] = (W, V7.times(len(W)), cuts)
def par(m, only=None):
    out = []
    for k, (W, t, cuts) in SW.items():
        if only and k != only: continue
        e = V2.events(t, m.predict_proba(W)[:, 1], 0.95, 2)
        out.append(f"{k} {sum(not any(a <= x <= b + 1.2 for a, b in cuts) for x in e)}")
    return ' '.join(out)
rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
posW = late + [D['ms_pos'], D['piper_pos']]
base = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas']]
print('rc1 -ar:', par(rc1), flush=True)
for out in ('V2', 'V1', 'Y'):
    v = fit_seed(posW, base + real_ar(out) * 3, 1, 256)
    print(f"held out {out}: rc1 {par(rc1, out)} -> veto 0.05 {par(Veto(rc1, v, 0.05), out)} | veto 0.2 {par(Veto(rc1, v, 0.2), out)}", flush=True)
v = fit_seed(posW, base + real_ar() * 3, 1, 256); pickle.dump(v, open('clf_rc5_s1.pkl', 'wb'))
print('rc5 -ar (in training):', par(Veto(rc1, v, 0.05)), flush=True)
report2('rc5 0.05', Veto(rc1, v, 0.05))
