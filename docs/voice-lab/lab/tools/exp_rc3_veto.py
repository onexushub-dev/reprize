"""rc1 + veto: fire only where rc1 fires (0.95, 2 in a row) AND an rc3 model also gives >= tau on those windows.
Can only remove rc1 fires, never add; the question is how many real salvar it removes."""
import pickle, numpy as np
s = open('exp_rc3.py').read(); exec(s[:s.index("rc1 = pickle.load(open('clf_v8_h256_s1.pkl'")])
class Veto:
    def __init__(self, a, b, tau): self.a, self.b, self.tau = a, b, tau
    def predict_proba(self, X):
        p = self.a.predict_proba(X)[:, 1] * (self.b.predict_proba(X)[:, 1] >= self.tau)
        return np.stack([1 - p, p], 1)
rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
for vs in (2, 1):
    v = pickle.load(open(f'clf_rc3_s{vs}.pkl', 'rb'))
    for tau in (0.1, 0.3, 0.5):
        report(f'veto s{vs} {tau}', Veto(rc1, v, tau))
