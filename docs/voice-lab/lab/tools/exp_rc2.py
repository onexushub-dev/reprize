"""salvar-v2-rc2 (2026-11-25): rc1's recipe + real VoiceBench sessions (Victor home/TV, Jessica, Ester, Carol) as
positives (windows 0.2-0.6 s after each word, also with extra court noise) and their gaps as negatives.
Leave-one-speaker-out for the three new women; the usual gates (courts, crossfit, talk, similar words, Eliane/Yasmin)."""
import pickle, numpy as np, sys
s = open('sweep_rc1.py').read(); exec(s[:s.index("m = pickle.load(open('clf_v8_h256_s1.pkl'")])
src8 = open('exp_v8.py').read(); exec(src8[src8.index("def fit_seed"):src8.index("m4 = pickle.load")])
B = V7.BENCH
SESS = {'Victor': ['20261124-202720', '20261125-115049', '20261125-115116', '20261125-115144', '20261125-115639',
                   '20261125-115705', '20261125-115744', '20261125-115832', '20261125-115942'],
        'Jessica': ['20261125-154834', '20261125-154914', '20261125-154936'],
        'Ester': ['20261125-200528', '20261125-200546', '20261125-200602'],
        'Carol': ['20261125-200810', '20261125-200826', '20261125-200840']}
m1 = pickle.load(open('clf_v4_M4.pkl', 'rb')); rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
rng2 = np.random.default_rng(11)
cache = {}
for spk, names in SESS.items():
    for n in names:
        x = V7.load(f'{B}/{n}-accuracy.wav'); W = V7.windows(x); t = V7.times(len(W))
        if n in TODAY: words = TODAY[n][1]          # word times checked by hand (v1 had 3 false fires in 115832)
        else: words = [float(v) for v in V2.events(t, m1.predict_proba(W)[:, 1], 0.95, 2)]
        pos = [W[(t >= w - 0.05) & (t <= w + 0.35)] for w in words]
        far = np.ones(len(t), bool)
        for w in words: far &= ~((t >= w - 1.2) & (t <= w + 1.4))
        aug = []
        for w in words:
            for _ in range(6):
                end = int((w - 0.25 + rng2.uniform(0.25, 0.55)) * 16000)
                if end - 32000 < 0 or end > len(x): continue
                seg = x[end - 32000:end].copy(); pool = pools[rng2.integers(len(pools))]; srcn = pool[rng2.integers(len(pool))]
                i = rng2.integers(0, len(srcn) - 32000); bed = srcn[i:i + 32000]
                seg = seg + bed / (L.rms(bed) + 1e-9) * L.rms(seg) * 10 ** (rng2.uniform(-15, 0) / 20)
                v = L.window_of((seg / (np.abs(seg).max() + 1e-9) * rng2.uniform(0.1, 0.9)).astype(np.float32))
                if v is not None: aug.append(v)
        cache[n] = dict(spk=spk, words=words, W=W, t=t, pos=np.concatenate(pos) if pos else W[:0],
                        aug=np.array(aug, np.float32).reshape(-1, W.shape[1]), neg=W[far])
print({n: (c['spk'], len(c['words']), len(c['pos']), len(c['aug']), len(c['neg'])) for n, c in cache.items()}, flush=True)
def hits(m, n):
    c = cache[n]; e = V2.events(c['t'], m.predict_proba(c['W'])[:, 1], 0.95, 2)
    h = sum(any(w - 0.7 <= x <= w + 0.8 for x in e) for w in c['words']); f = sum(not any(w - 0.7 <= x <= w + 0.8 for w in c['words']) for x in e)
    return h, len(c['words']), f
def bench(m, spk):
    out = []
    for n in SESS[spk]:
        h, k, f = hits(m, n); out.append(f"{h}/{k}" + (f"+{f}F" if f else ""))
    return ' '.join(out)
pos8 = late + [D['ms_pos'], D['piper_pos']]
neg8 = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas']]
def train(exclude, seed):
    keep = [n for n, c in cache.items() if c['spk'] != exclude]
    P = [cache[n]['pos'] for n in keep] * 4 + [cache[n]['aug'] for n in keep] * 2
    N = [cache[n]['neg'] for n in keep]
    return fit_seed(pos8 + P, neg8 + N, seed, 256)
print('rc1 on new women: ' + ' | '.join(f"{s_} {bench(rc1, s_)}" for s_ in ('Jessica', 'Ester', 'Carol')), flush=True)
print('v1  on new women: ' + ' | '.join(f"{s_} {bench(m1, s_)}" for s_ in ('Jessica', 'Ester', 'Carol')), flush=True)
for seed in (0, 1):
    res = []
    for spk in ('Jessica', 'Ester', 'Carol'):
        res.append(f"{spk} {bench(train(spk, seed), spk)}")
    print(f'rc2 s{seed} leave-one-out (3 m, 5 m, 10 m): ' + ' | '.join(res), flush=True)
    full = train(None, seed); pickle.dump(full, open(f'clf_rc2_s{seed}.pkl', 'wb'))
    near, far, fa, cf, cw, extra = run(full, 0.95, 2); c, t_ = pub(full, 0.95, 2)
    print(f"rc2 s{seed} full | <=5m old {near[0]}/{near[1]} | 10m old {far[0]}/{far[1]} | FALSOS quadra {fa} crossfit {cf} conversaCV {t_}/400 | parecidas crossfit {cw}/8 publicas {c}/225", flush=True)
near, far, fa, cf, cw, extra = run(rc1, 0.95, 2); c, t_ = pub(rc1, 0.95, 2)
print(f"rc1      | <=5m old {near[0]}/{near[1]} | 10m old {far[0]}/{far[1]} | FALSOS quadra {fa} crossfit {cf} conversaCV {t_}/400 | parecidas crossfit {cw}/8 publicas {c}/225", flush=True)
