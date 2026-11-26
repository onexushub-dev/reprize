"""rc1 vetoed by rc4 (trained with Yasmin's real -ar): fire only where rc1 fires and rc4 gives >= tau.
Never adds a fire; checks how many salvar it costs. Victor's Parecidas -ar (2026-11-26, never 'salvar') is held out."""
import pickle, numpy as np
s = open('exp_rc4.py').read(); exec(s[:s.index("if __name__ == '__main__':")])
class Veto:
    def __init__(self, a, b, tau): self.a, self.b, self.tau = a, b, tau
    def predict_proba(self, X):
        p = self.a.predict_proba(X)[:, 1] * (self.b.predict_proba(X)[:, 1] >= self.tau); return np.stack([1 - p, p], 1)
VW = V7.windows(V7.load(f'{B}/20261126-095648-confusers.wav')); VT = V7.times(len(VW))
rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
def rep(name, m):
    n = len(V2.events(VT, m.predict_proba(VW)[:, 1], 0.95, 2)); print(f"Parecidas Victor {n} disparos |", end=' '); report2(name, m)
rep('rc1', rc1)
for tag in ('a', 'b'):
    v = pickle.load(open(f'clf_rc4{tag}_s1.pkl', 'rb'))
    for tau in (0.02, 0.05, 0.15, 0.4):
        rep(f'veto {tag} {tau}', Veto(rc1, v, tau))
