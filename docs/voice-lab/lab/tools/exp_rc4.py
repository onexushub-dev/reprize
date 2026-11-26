"""salvar-v2-rc4 pilot: rc1's recipe + real -ar verbs said by people (VoiceBench Parecidas with the -ar list:
Yasmin 2026-11-26, her one accidental "salvar" at ~133 s cut out) as negatives, weighted 3x like the earlier real
Parecidas. Variant a: with the public -ar sets from rc3 too; variant b: real ones only. Tested on Victor's labeled
field clips (his voice is in neither), held-out public -ar, and every rc1 gate."""
import os, glob, json, pickle, numpy as np
s = open('exp_rc3.py').read(); exec(s[:s.index("rc1 = pickle.load(open('clf_v8_h256_s1.pkl'")])
LAB = {'17F09608': 'salvar', '7631553B': 'salvar', 'F3052629': 'salvar', 'E6E25AFA': 'salvar', 'D2EE379C': '?'}
fclips = {os.path.basename(p).split('-')[0]: V7.load(p) for p in glob.glob('/tmp/clips/*.wav')}
FW = {k: V7.windows(x) for k, x in fclips.items()}
def field(m):
    sal = [0, 0]; te = [0, 0]
    for k, w in FW.items():
        e = V2.events(V7.times(len(w)), m.predict_proba(w)[:, 1], 0.95, 2); dur = len(fclips[k]) / 16000; lab = LAB.get(k, 'teste')
        if lab == 'salvar': sal[1] += 1; sal[0] += any(x >= dur - 1.6 for x in e)
        elif lab == 'teste': te[1] += 1; te[0] += len(e) > 0
    return f"campo Victor: salvar {sal[0]}/{sal[1]}, testes -ar com disparo {te[0]}/{te[1]}"
REAL_AR = {'Yasmin': ('20261126-094639', [(131.5, 135.2)])}
def real_ar(exclude=None):
    out = []
    for spk, (n, cuts) in REAL_AR.items():
        if spk == exclude: continue
        W = V7.windows(V7.load(f'{B}/{n}-confusers.wav')); t = V7.times(len(W)); keep = np.ones(len(t), bool)
        for a, b in cuts: keep &= ~((t >= a) & (t <= b + 1.2))
        out.append(W[keep])
    return out
def report2(name, m):
    near, far, fa, cf, cw, extra = run(m, 0.95, 2); c, t_ = pub(m, 0.95, 2)
    a = sum(nfires(m, ('mp', i), x) > 0 for i, x in enumerate(ms_test_pos)); b = sum(nfires(m, ('cs', i), x) > 0 for i, (g, x) in enumerate(cv_sal))
    pa = sum(nfires(m, ('ap', i), x) > 0 for i, x in enumerate(ar_test_piper)); ca = sum(nfires(m, ('ac', i), x) > 0 for i, x in enumerate(ar_test_cv))
    print(f"{name:10s} | {field(m)} | -ar publicas novas: piper {pa}/{len(ar_test_piper)} CV {ca}/{len(ar_test_cv)} "
          f"| salvar publico MSWC {a}/{len(ms_test_pos)} CV {b}/{len(cv_sal)} | old <=5m {near[0]}/{near[1]} 10m {far[0]}/{far[1]} "
          f"| FALSOS quadra {fa} crossfit {cf} conversa {t_}/400 | parecidas crossfit {cw}/8 publicas {c}/225 | bench {bench_str(m)}", flush=True)
if __name__ == '__main__':
    rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
    report2('rc1', rc1)
    posW = late + [D['ms_pos'], D['piper_pos']]
    base = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas']]
    RA = real_ar() * 3
    for tag, extra in (('b', RA), ('a', RA + [A['piper_ar'], A['cv_ar']])):
        for seed in (1, 2):
            m = fit_seed(posW, base + extra, seed, 256); pickle.dump(m, open(f'clf_rc4{tag}_s{seed}.pkl', 'wb'))
            report2(f'rc4{tag} s{seed}', m)
