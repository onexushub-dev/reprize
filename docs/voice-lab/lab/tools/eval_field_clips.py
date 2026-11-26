"""Field clips 2026-11-25 (Victor labeled them 2026-11-26): which models still fire on the real salvar and stop on the
-ar tests. Fires within the last 1.6 s of a clip are the one that saved it."""
import glob, os, pickle, numpy as np
import detector_v7 as V7, detector_v2 as V2
LAB = {'17F09608': 'salvar', '7631553B': 'salvar', 'F3052629': 'salvar', 'E6E25AFA': 'salvar', 'D2EE379C': '?'}
clips = {os.path.basename(p).split('-')[0]: V7.load(p) for p in glob.glob('/tmp/clips/*.wav')}
W = {k: V7.windows(x) for k, x in clips.items()}
class Veto:
    def __init__(self, a, b, tau): self.a, self.b, self.tau = a, b, tau
    def predict_proba(self, X):
        p = self.a.predict_proba(X)[:, 1] * (self.b.predict_proba(X)[:, 1] >= self.tau); return np.stack([1 - p, p], 1)
L = lambda f: pickle.load(open(f, 'rb'))
rc1 = L('clf_v8_h256_s1.pkl')
models = {'v1': L('clf_v4_M4.pkl'), 'rc1': rc1}
for s in (1, 0, 2): models[f'rc3 s{s}'] = L(f'clf_rc3_s{s}.pkl')
for s in (2, 1):
    for tau in (0.1, 0.3, 0.5): models[f'veto s{s} {tau}'] = Veto(rc1, L(f'clf_rc3_s{s}.pkl'), tau)
for name, m in models.items():
    sal = [0, 0]; te = [0, 0]; tef = 0
    for k, w in W.items():
        t = V7.times(len(w)); e = V2.events(t, m.predict_proba(w)[:, 1], 0.95, 2); dur = len(clips[k]) / 16000
        lab = LAB.get(k, 'teste')
        if lab == 'salvar': sal[1] += 1; sal[0] += any(x >= dur - 1.6 for x in e)
        elif lab == 'teste': te[1] += 1; te[0] += len(e) > 0; tef += len(e)
    print(f"{name:13s} salvar {sal[0]}/{sal[1]} | testes -ar com disparo {te[0]}/{te[1]} ({tef} disparos)")
