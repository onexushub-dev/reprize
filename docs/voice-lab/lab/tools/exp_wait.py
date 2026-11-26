"""salvar-v2-rc1-w: rc1's recipe with positives whose window ends 0.15-0.45 s after the word (rc1: 0.25-0.55),
so the model can decide ~0.1 s earlier. Same negatives, 256 hidden, 3 seeds. Compared with rc1 on the usual gates
and on every VoiceBench session (none of them is in either model's training), plus how much earlier it fires."""
import os, pickle, numpy as np
s = open('sweep_rc1.py').read(); exec(s[:s.index("m = pickle.load(open('clf_v8_h256_s1.pkl'")])
src8 = open('exp_v8.py').read(); exec(src8[src8.index("def fit_seed"):src8.index("m4 = pickle.load")])
B = V7.BENCH
END = (1.55, 1.85)
cpath = 'cache_wait.pkl'
if os.path.exists(cpath):
    NP = pickle.load(open(cpath, 'rb'))
else:
    words = V7.L.home_pos + V7.L.other_pos + [w for ws in V7.L.watch_pos.values() for w in ws]
    close = [w for n in V7.V2.CLOSE2 for w in V7.V2.close_words(n)]
    vp = {"day1": V7.L.noise_train,
          "camp": [a for a in (V7.load(p) for p in V7.V2.camp_train) if len(a) > 2.5 * 16000],
          "tenis": [a for a in (V7.load(p) for p in V7.V4.ten_train) if len(a) > 2.5 * 16000],
          "cross": [V7.load(V7.CROSS1)]}
    pos = []
    for name, pool in vp.items():
        k = 12 if name == "day1" else 8
        for w in words + close:
            for _ in range(k):
                v = V7.L.window_of(V7.L.mix(w, pool, end_lo=END[0], end_hi=END[1]))
                if v is not None: pos.append(v)
    NP = {'pos': np.array(pos, np.float32), 'phone_pos': V7.phone_day1((0.15, 0.45)),
          'ms_pos': mixwins([trim(V7.load(p)) for w, s_, p in ms if w == 'salvar' and not test_spk(s_)], 10, END),
          'piper_pos': mixwins([trim(V7.load(p)) for p in sorted(glob.glob(f'{DS}/piper/pos__*.wav'))], 2, END)}
    pickle.dump(NP, open(cpath, 'wb'))
print('new positives', {k: len(v) for k, v in NP.items()}, '| rc1 had', {'pos': len(S['pos']), 'phone_pos': len(S['phone_pos']), 'ms_pos': len(D['ms_pos']), 'piper_pos': len(D['piper_pos'])}, flush=True)

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

def bench_eval(m):
    """Per speaker: hits/words and false fires; plus fire time of each hit word (for the earlier-or-later check)."""
    per = {}; fires = {}
    for n, (spk, W, t, words) in bench.items():
        e = V2.events(t, m.predict_proba(W)[:, 1], 0.95, 2)
        h, k, f = per.get(spk, (0, 0, 0))
        for i, w in enumerate(words):
            got = [x for x in e if w - 0.7 <= x <= w + 0.8]
            if got: h += 1; fires[(n, i)] = got[0]
        f += sum(not any(w - 0.7 <= x <= w + 0.8 for w in words) for x in e)
        per[spk] = (h, k + len(words), f)
    return per, fires

def report(name, m, ref_fires=None):
    near, far, fa, cf, cw, extra = run(m, 0.95, 2); c, t_ = pub(m, 0.95, 2)
    per, fires = bench_eval(m)
    b = ' '.join(f"{spk} {h}/{k}" + (f"+{f}F" if f else '') for spk, (h, k, f) in per.items())
    line = (f"{name:10s} | old <=5m {near[0]}/{near[1]} 10m {far[0]}/{far[1]} | FALSOS quadra {fa} crossfit {cf} conversaCV {t_}/400 "
            f"| parecidas crossfit {cw}/8 publicas {c}/225 | bench {b}")
    if ref_fires is not None:
        d = [fires[k] - ref_fires[k] for k in fires if k in ref_fires]
        if d: line += f" | vs rc1: mediana {np.median(d) * 1000:+.0f} ms (p10 {np.percentile(d, 10) * 1000:+.0f}, p90 {np.percentile(d, 90) * 1000:+.0f}, n={len(d)})"
    print(line, flush=True)
    return fires

rc1 = pickle.load(open('clf_v8_h256_s1.pkl', 'rb'))
ref = report('rc1', rc1)
report('rc1-recipe s0', pickle.load(open('clf_v8_h256_s0.pkl', 'rb')), ref)
posW = [NP['pos'], NP['phone_pos'], NP['ms_pos'], NP['piper_pos']]
negW = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas']]
for seed in (0, 1, 2):
    m = fit_seed(posW, negW, seed, 256); pickle.dump(m, open(f'clf_wait_s{seed}.pkl', 'wb'))
    report(f'wait s{seed}', m, ref)
