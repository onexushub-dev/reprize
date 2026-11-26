"""salvar-v2-rc3: rc1's recipe plus hard negatives of words ending in -ar (Victor's field test 2026-11-25: pular,
cavar, gritar, treinar... fired rc1). Negatives: Piper pt_BR verbs/phrases (3/4 of the list) and Common Voice
sentences ending in an -ar word (train speakers), each placed in court/crossfit noise ending 0.05-0.55 s before the
window end. Kept only if it matches rc1 everywhere (gates, 18 VoiceBench sessions, public salvar) and fires less on
held-out -ar words (the other 1/4 of the list; CV test speakers)."""
import os, glob, json, pickle, numpy as np
s = open('sweep_rc1.py').read(); exec(s[:s.index("m = pickle.load(open('clf_v8_h256_s1.pkl'")])
src8 = open('exp_v8.py').read(); exec(src8[src8.index("def fit_seed"):src8.index("m4 = pickle.load")])
B = V7.BENCH
AR = '/home/claude/ds/ar'; CVAR = '/home/claude/ds/cv_ar'
cvm = json.load(open(f'{CVAR}/pick.json'))
cv_ar = [(m_['client_id'], f"{CVAR}/wav/{m_['path'][:-4]}.wav") for m_ in cvm if os.path.exists(f"{CVAR}/wav/{m_['path'][:-4]}.wav")]
cpath = 'cache_rc3.pkl'
if os.path.exists(cpath):
    A = pickle.load(open(cpath, 'rb'))
else:
    A = {'piper_ar': mixwins([trim(V7.load(p)) for p in sorted(glob.glob(f'{AR}/train__*.wav'))], 1, (1.45, 1.95)),
         'cv_ar': mixwins([trim(V7.load(p)) for c_, p in cv_ar if not test_spk(c_)], 2, (1.45, 1.95))}
    pickle.dump(A, open(cpath, 'wb'))
print('rc3 sets', {k: len(v) for k, v in A.items()}, flush=True)
ar_test_piper = [trim(V7.load(p)) for p in sorted(glob.glob(f'{AR}/test__*.wav'))]
ar_test_cv = [trim(V7.load(p)) for c_, p in cv_ar if test_spk(c_)][:300]
clips = [V7.load(p) for p in sorted(glob.glob('/tmp/clips/*.wav'))]
print('held out -ar: piper', len(ar_test_piper), 'cv', len(ar_test_cv), '| field clips', len(clips), flush=True)

SESS = {'Victor': ['20261124-202720', '20261125-115049', '20261125-115116', '20261125-115144', '20261125-115639',
                   '20261125-115705', '20261125-115744', '20261125-115832', '20261125-115942'],
        'Jessica': ['20261125-154834', '20261125-154914', '20261125-154936'],
        'Ester': ['20261125-200528', '20261125-200546', '20261125-200602'],
        'Carol': ['20261125-200810', '20261125-200826', '20261125-200840']}
m1 = pickle.load(open('clf_v4_M4.pkl', 'rb'))
bench = {}
for spk, names in SESS.items():
    for n in names:
        x = V7.load(f'{B}/{n}-accuracy.wav'); W = V7.windows(x); t = V7.times(len(W))
        words = TODAY[n][1] if n in TODAY else [float(v) for v in V2.events(t, m1.predict_proba(W)[:, 1], 0.95, 2)]
        bench[n] = (spk, W, t, words)
def bench_str(m):
    per = {}
    for n, (spk, W, t, words) in bench.items():
        e = V2.events(t, m.predict_proba(W)[:, 1], 0.95, 2); h, k, f = per.get(spk, (0, 0, 0))
        h += sum(any(w - 0.7 <= x <= w + 0.8 for x in e) for w in words)
        f += sum(not any(w - 0.7 <= x <= w + 0.8 for w in words) for x in e); per[spk] = (h, k + len(words), f)
    return ' '.join(f"{spk} {h}/{k}" + (f"+{f}F" if f else '') for spk, (h, k, f) in per.items())
def report(name, m):
    near, far, fa, cf, cw, extra = run(m, 0.95, 2); c, t_ = pub(m, 0.95, 2)
    a = sum(nfires(m, ('mp', i), x) > 0 for i, x in enumerate(ms_test_pos)); b = sum(nfires(m, ('cs', i), x) > 0 for i, (g, x) in enumerate(cv_sal))
    pa = sum(nfires(m, ('ap', i), x) > 0 for i, x in enumerate(ar_test_piper)); ca = sum(nfires(m, ('ac', i), x) > 0 for i, x in enumerate(ar_test_cv))
    fc = sum(len(V2.events(V7.times(len(W)), m.predict_proba(W)[:, 1], 0.95, 2)) for W in [V7.windows(x) for x in clips])
    print(f"{name:9s} | -ar novas: piper {pa}/{len(ar_test_piper)} CV {ca}/{len(ar_test_cv)} | campo {fc} disparos/19 clipes "
          f"| salvar publico MSWC {a}/{len(ms_test_pos)} CV {b}/{len(cv_sal)} | old <=5m {near[0]}/{near[1]} 10m {far[0]}/{far[1]} "
          f"| FALSOS quadra {fa} crossfit {cf} conversa {t_}/400 | parecidas crossfit {cw}/8 publicas {c}/225 | bench {bench_str(m)}", flush=True)
rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
report('rc1', rc1)
posW = late + [D['ms_pos'], D['piper_pos']]
negW = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas'], A['piper_ar'], A['cv_ar']]
for seed in (1, 0, 2):
    m = fit_seed(posW, negW, seed, 256); pickle.dump(m, open(f'clf_rc3_s{seed}.pkl', 'wb'))
    report(f'rc3 s{seed}', m)
