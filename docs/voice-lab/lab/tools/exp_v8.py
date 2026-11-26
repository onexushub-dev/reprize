"""salvar-v2 candidate with public data (2026-11-25): MLCommons + Common Voice 27 + Piper + Victor's Parecidas.
Held out by speaker (1 in 5) for the public words; Common Voice "salvar" sentences are all held out (recall test)."""
import csv, glob, hashlib, json, os, pickle, re
import numpy as np
src = open('ablate_v7.py').read(); exec(src[:src.index("evaluate('M4 (v1)'")])
import detector_v1_lib as L
rng = np.random.default_rng(8)
DS = '/home/claude/ds'
def test_spk(spk): return int(hashlib.md5((spk or '?').encode()).hexdigest(), 16) % 5 == 0
def trim(x):
    h = 160; n = len(x) // h
    if n < 3: return x
    e = 10 * np.log10((x[:n * h].reshape(n, h) ** 2).mean(1) + 1e-10); on = np.where(e > e.max() - 35)[0]
    return x[max(0, on[0] * h - 800): min(len(x), (on[-1] + 1) * h + 800)]
# ---- MSWC ----
spk = {}
for sp in ('train', 'dev', 'test'):
    for r in csv.DictReader(open(f'{DS}/mswc/{sp}.csv')):
        w, f = r['LINK'].split('/'); spk[f'{w}_{f[:-5]}'] = r['SPEAKER']
ms = []
for p in sorted(glob.glob(f'{DS}/wav/mswc/*.wav')):
    b = os.path.basename(p)[:-4]; word = b.split('_common_voice')[0]
    ms.append((word, spk.get(b, '?'), p))
# ---- Common Voice ----
meta = {m['path'][:-4]: m for m in json.load(open(f'{DS}/cv/pick.json'))}
SAL = re.compile(r'(?<![\wÀ-ú])salvar(?![\wÀ-ú])', re.I)
CONF = re.compile(r'(?<![\wÀ-ú])(salv\w*|salt\w*|sac[aoe]\w*|saque\w*|salad\w*|sala|salas)(?![\wÀ-ú])', re.I)
cv = []
for p in sorted(glob.glob(f'{DS}/wav/cv/*.wav')):
    m = meta[os.path.basename(p)[:-4]]; s = m['sentence'] or ''
    kind = 'salvar' if SAL.search(s) else ('conf' if CONF.search(s) else 'talk')
    cv.append((kind, m['client_id'], (m['gender'] or ''), s, p))
print('mswc', len(ms), 'cv', {k: sum(1 for c in cv if c[0] == k) for k in ('salvar', 'conf', 'talk')}, flush=True)
pools = [L.noise_train, [a for a in (V7.load(p) for p in V2.camp_train) if len(a) > 2.5 * 16000],
         [a for a in (V7.load(p) for p in V4.ten_train) if len(a) > 2.5 * 16000], [V7.load(V7.CROSS1)]]
def mixwins(words, k, end):
    out = []
    for w in words:
        for pool in pools:
            for _ in range(k):
                v = L.window_of(L.mix(w, pool, end_lo=end[0], end_hi=end[1]))
                if v is not None: out.append(v)
    return np.array(out, np.float32).reshape(-1, F.WINDOW * 96)
def sentence_wins(paths, per_clip):
    out = []
    for p in paths:
        x = V7.load(p); pool = pools[rng.integers(len(pools))]; src = pool[rng.integers(len(pool))]
        if len(src) < len(x) + 16000: continue
        i = rng.integers(0, len(src) - len(x) - 16000); bed = src[i: i + len(x) + 16000].copy()
        g = L.rms(bed) / (L.rms(x) + 1e-9) * 10 ** (rng.uniform(-2, 18) / 20)
        bed[8000: 8000 + len(x)] += x * g; bed = bed / (np.abs(bed).max() + 1e-9) * rng.uniform(0.1, 0.9)
        W = F.windows(F.embeddings(bed.astype(np.float32)))
        if len(W): out.append(W[rng.choice(len(W), min(per_clip, len(W)), replace=False)])
    return np.concatenate(out) if out else np.zeros((0, F.WINDOW * 96), np.float32)
cache = 'cache_v8.pkl'
if os.path.exists(cache):
    D = pickle.load(open(cache, 'rb'))
else:
    D = {}
    D['ms_pos'] = mixwins([trim(V7.load(p)) for w, s, p in ms if w == 'salvar' and not test_spk(s)], 10, V7.POS_END)
    D['ms_conf'] = mixwins([trim(V7.load(p)) for w, s, p in ms if w != 'salvar' and not test_spk(s)], 2, (1.45, 1.95))
    pp = sorted(glob.glob(f'{DS}/piper/pos__*.wav')); pn = sorted(glob.glob(f'{DS}/piper/neg__*.wav'))
    D['piper_pos'] = mixwins([trim(V7.load(p)) for p in pp], 2, V7.POS_END)
    D['piper_neg'] = mixwins([trim(V7.load(p)) for p in pn], 2, (1.45, 1.95))
    D['cv_conf'] = sentence_wins([c[4] for c in cv if c[0] == 'conf' and not test_spk(c[1])], 12)
    D['cv_talk'] = sentence_wins([c[4] for c in cv if c[0] == 'talk' and not test_spk(c[1])], 3)
    D['victor_parecidas'] = V7.windows(V7.load('/home/claude/lab/w2/wav16/bench/20261125-084923-confusers.wav'))
    pickle.dump(D, open(cache, 'wb'))
print('v8 sets', {k: len(v) for k, v in D.items()}, flush=True)
# ---- held-out tests ----
ms_test_pos = [trim(V7.load(p)) for w, s, p in ms if w == 'salvar' and test_spk(s)]
ms_test_conf = [(w, trim(V7.load(p))) for w, s, p in ms if w != 'salvar' and test_spk(s)]
cv_sal = [(g, V7.load(p)) for k, s_, g, s, p in cv if k == 'salvar']
cv_conf_test = [V7.load(p) for k, s_, g, s, p in cv if k == 'conf' and test_spk(s_)]
cv_talk_test = [V7.load(p) for k, s_, g, s, p in cv if k == 'talk' and test_spk(s_)][:400]
def pad(x): return np.concatenate([np.zeros(16000, np.float32), x, np.zeros(12000, np.float32)]).astype(np.float32)
WC = {}
def nfires(m, key, x):
    if key not in WC: WC[key] = F.windows(F.embeddings(pad(x)))
    W = WC[key]
    return len(V2.events(np.arange(len(W)) * 0.08, m.predict_proba(W)[:, 1], 0.95, 2, refr=19)) if len(W) else 0
def public(name, m):
    a = sum(nfires(m, ('mp', i), x) > 0 for i, x in enumerate(ms_test_pos))
    b = sum(nfires(m, ('cs', i), x) > 0 for i, (g, x) in enumerate(cv_sal))
    bf = sum(nfires(m, ('cs', i), x) > 0 for i, (g, x) in enumerate(cv_sal) if g.startswith('female'))
    c = sum(nfires(m, ('mc', i), x) for i, (w, x) in enumerate(ms_test_conf))
    d = sum(nfires(m, ('cc', i), x) for i, x in enumerate(cv_conf_test))
    e = sum(nfires(m, ('ct', i), x) for i, x in enumerate(cv_talk_test))
    print(f"{name:30s} public held out: salvar MSWC {a}/{len(ms_test_pos)}, CV sentences {b}/{len(cv_sal)} (women {bf}/{sum(g.startswith('female') for g, _ in cv_sal)}) | "
          f"similar words MSWC {c} in {len(ms_test_conf)} clips, CV {d} in {len(cv_conf_test)} sentences | other talk {e} in {len(cv_talk_test)}", flush=True)
def fit_seed(pos, neg, seed, hidden=128):
    X = np.concatenate(pos + neg); y = np.concatenate([np.ones(sum(map(len, pos))), np.zeros(sum(map(len, neg)))])
    return MLPClassifier(hidden_layer_sizes=(hidden,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=seed).fit(X, y)
late = [S['pos'], S['phone_pos']]; neg0 = base_neg + [S['glued'], S['cross_noise']]
m4 = pickle.load(open('clf_v4_M4.pkl', 'rb'))
public('M4 (v1)', m4)
pos8 = late + [D['ms_pos'], D['piper_pos']]
neg8 = neg0 + [D['ms_conf'], D['piper_neg'], D['cv_conf'], D['cv_talk'], D['victor_parecidas']]
for hidden in (128, 256):
    for seed in (0, 1):
        m = fit_seed(pos8, neg8, seed, hidden); pickle.dump(m, open(f'clf_v8_h{hidden}_s{seed}.pkl', 'wb'))
        public(f'v8 h{hidden} s{seed}', m); evaluate(f'v8 h{hidden} s{seed}', m)
