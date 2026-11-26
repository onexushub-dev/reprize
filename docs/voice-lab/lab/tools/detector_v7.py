"""v7 = salvar-v2 (2026-11-25): stop firing on longer words that start like "salvar" ("salvando", "salvamento",
"salva-me"), seen in the crossfit noise run.

Why v1 (M4) fires there: fast "salvar" sounds like "salvá", so when "salva" ends the audio matches "salvar"; M4 learned
to fire with as little as 0.05 s after the word, before the "-ndo"/"-mento" arrives, and never heard those words.

What changes (same features, same classifier shape, same firing rule, so only classifier.bin changes in the app):
  1. Wait for the word to end: every positive has 0.25-0.55 s of noise after "salvar" (was 0.05-0.45 s). Fires
     ~0.25-0.3 s later than v1. (Also making the same word with < 0.1 s after it a negative cost too much far-field
     recall in the ablation of 2026-11-25: Victor <=10 m 16 -> 13 of 18, Yasmin 5 m 6 -> 2; dropped.)
  2. Synthetic confusers: a positive word cut to 55-75 % of its length + 0.2-0.5 s of someone else's talk glued on
     ("salva" + "-ndo"-like), mixed into the same noise as the positives.
  3. Real confusers: VoiceBench "Parecidas" sessions (nobody says "salvar"), leave-one-speaker-out in the report, and
     the stretch of the 2026-11-25 crossfit run where Victor said them on purpose (held out until --use-crossfit-words).
  4. Crossfit gym noise (run 1) as noise; run 2 stays held out for false triggers.

    python3 detector_v7.py            # train M7 (cached sets in cache_v7.pkl) and print the comparison with M4

First run, 2026-11-25, before any "Parecidas" recording (synthetic confusers only; crossfit words held out):
    M4 (v1): Victor <=10 m 16/18, Eliane 18/18, Yasmin 3/5/10 m 6/6/3, similar words 8, false 1/67 min + 2/33 min
    M7 (v2): Victor <=10 m 15/18, Eliane 18/18, Yasmin 3/5/10 m 6/6/4, similar words 3, false 1/67 min + 1/33 min
"""
import glob
import json
import os
import pickle
import sys

import numpy as np
import soundfile as sf
from sklearn.neural_network import MLPClassifier

import detector_v1_lib as L
import detector_v2 as V2
import detector_v4 as V4
import features as F
from labels import DIST_CLIPS, DIST_UTTERANCES

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
BENCH = os.environ.get("VOICE_BENCH_WAV", os.path.join(HERE, "w2", "wav16", "bench"))
rng = np.random.default_rng(25)
CROSS1 = os.path.join(BENCH, "20261125-061214-noise.wav")
CROSS2 = os.path.join(BENCH, "20261125-062444-noise.wav")
CROSS2_WORDS = (1625.0, 1755.0)          # Victor saying similar words on purpose (cuts.json)
POS_END = (1.45, 1.75)                   # word end inside the 2 s clip: 0.25-0.55 s after it
EARLY_END = (1.90, 2.00)                 # < 0.1 s after the word: too early, negative
USE_CROSS_WORDS = "--use-crossfit-words" in sys.argv


def load(path):
    x, sr = sf.read(path, dtype="float32")
    assert sr == SR, (path, sr)
    return x


def windows(audio, chunk_s=120):
    """All detector windows of a long recording, in chunks (the ONNX embedding runs out of memory on 30+ min)."""
    out = []
    for i in range(0, len(audio), chunk_s * SR):
        W = F.windows(F.embeddings(audio[i: i + chunk_s * SR + 3 * SR]))
        if len(W):
            out.append(W)
    return np.concatenate(out) if out else np.zeros((0, F.WINDOW * 96), np.float32)


def times(n, start=0.0):
    return np.array([start + F.window_end_time(j) for j in range(n)])


# ---------- material ----------
def talk_pieces():
    """Speech from the day-1 game recording with no salvar-like word (the source of the glued-on endings)."""
    d = json.load(open(os.path.join(HERE, "marks", "Gravação 3.json")))
    import re
    pat = re.compile(r"sal|sau|sao|são|tao|dao|tau|sop|calv|sabe|sav", re.I)
    segs = [(x["start"], x["end"]) for x in d["segments"] if not pat.search(x["text"]) and x["end"] - x["start"] >= 0.8]
    return L.load("Gravação 3"), segs


def glued(word, g3, segs):
    """'salva' + someone else's syllables: the word cut to 55-75 % of its length, then 0.2-0.5 s of talk."""
    keep = word[: int(len(word) * rng.uniform(0.55, 0.75))]
    s, e = segs[rng.integers(len(segs))]
    a = rng.uniform(s, max(s, e - 0.5))
    tail = L.cut(g3, a, a + rng.uniform(0.2, 0.5))
    tail = tail / (L.rms(tail) + 1e-9) * L.rms(keep) * rng.uniform(0.6, 1.2)
    fade = min(160, len(keep), len(tail))
    out = np.concatenate([keep, tail]).astype(np.float32)
    out[len(keep) - fade: len(keep)] *= np.linspace(1, 0.3, fade)
    return out


def phone_day1(end_after):
    """Day-1 far-field phone recordings of each "salvar", with the window ending `end_after` s after the word."""
    X = []
    for name, off in DIST_CLIPS.items():
        a = L.load(name)
        for s, e, _, _ in DIST_UTTERANCES:
            cs, ce = s - off, e - off
            if cs < 0.3 or ce > len(a) / SR - 0.7:
                continue
            for _ in range(8):
                end = ce + rng.uniform(*end_after)
                seg = L.cut(a, end - L.CLIP, end)
                if len(seg) == int(L.CLIP * SR):
                    v = L.window_of(seg / (np.max(np.abs(seg)) + 1e-9) * rng.uniform(0.1, 0.9))
                    if v is not None:
                        X.append(v)
    return np.array(X, np.float32)


def confuser_sessions():
    """(speaker, path) of VoiceBench "Parecidas" sessions converted to 16 kHz WAV next to their JSON in BENCH."""
    out = []
    for j in sorted(glob.glob(os.path.join(BENCH, "**", "*-confusers.json"), recursive=True)):
        s = json.load(open(j))
        wav = j[: -len(".json")] + ".wav"
        if os.path.exists(wav):
            out.append(((s.get("speaker") or "?").strip(), wav))
    return out


def build_sets():
    words = L.home_pos + L.other_pos + [w for ws in L.watch_pos.values() for w in ws]
    close = [w for n in V2.CLOSE2 for w in V2.close_words(n)]
    pools = {
        "day1": L.noise_train,
        "camp": [a for a in (load(p) for p in V2.camp_train) if len(a) > 2.5 * SR],
        "tenis": [a for a in (load(p) for p in V4.ten_train) if len(a) > 2.5 * SR],
        "cross": [load(CROSS1)],
    }
    g3, segs = talk_pieces()
    mixed = lambda w, pool, end: L.window_of(L.mix(w, pool, end_lo=end[0], end_hi=end[1]))
    S = {"pos": [], "early": [], "glued": []}
    for name, pool in pools.items():
        k = 12 if name == "day1" else 8
        for w in words + close:
            for _ in range(k):
                S["pos"].append(mixed(w, pool, POS_END))
            for _ in range(2):
                S["early"].append(mixed(w, pool, EARLY_END))
            for _ in range(4):
                S["glued"].append(mixed(glued(w, g3, segs), pool, (1.55, 1.95)))
    S = {k: np.array([v for v in vs if v is not None], np.float32) for k, vs in S.items()}
    S["phone_pos"] = phone_day1((0.25, 0.55))
    S["phone_early"] = phone_day1((0.0, 0.08))
    cross1 = windows(load(CROSS1))
    S["cross_noise"] = cross1[::3]
    print("v7 sets:", {k: len(v) for k, v in S.items()}, flush=True)
    return S


def real_confusers(exclude_speaker=None):
    """Windows of real similar words: Parecidas sessions (minus one speaker) and, if asked, the crossfit stretch."""
    out = [windows(load(p)) for spk, p in confuser_sessions() if spk != exclude_speaker]
    if USE_CROSS_WORDS:
        a, b = CROSS2_WORDS
        out.append(windows(load(CROSS2)[int(a * SR): int(b * SR)]))
    out = [o for o in out if len(o)]
    return np.concatenate(out) if out else np.zeros((0, F.WINDOW * 96), np.float32)


def train(S, extra_neg):
    P, Q, T = V2.P, V2.Q, V4.T
    pos = [S["pos"], S["phone_pos"]]
    neg = [P["neg"], P["partial"], P["talk"], Q["conf2"], Q["camp_noise"], T["ten_noise"], [T["ten_hard"]] * 3,
           S["glued"], S["cross_noise"]]
    neg = [n for x in neg for n in (x if isinstance(x, list) else [x])]
    if len(extra_neg):
        neg += [extra_neg] * 3
    X = np.concatenate(pos + neg)
    y = np.concatenate([np.ones(sum(map(len, pos))), np.zeros(sum(map(len, neg)))])
    return MLPClassifier(hidden_layer_sizes=(128,), alpha=1e-3, max_iter=300, early_stopping=True, random_state=0).fit(X, y)


# ---------- report ----------
def fires(m, W, start=0.0, thr=0.95, need=2):
    return V2.events(times(len(W), start), m.predict_proba(W)[:, 1], thr, need) if len(W) else []


def compare(models):
    cross2 = load(CROSS2)
    a, b = CROSS2_WORDS
    W_words = windows(cross2[int(a * SR): int(b * SR)])
    W_before = windows(cross2[: int(a * SR)])
    W_after = windows(cross2[int(b * SR):])
    bench_acc = sorted(glob.glob(os.path.join(BENCH, "*-accuracy.wav")))
    conf = confuser_sessions()
    for name, m in models.items():
        fa = len(fires(m, W_before)) + len(fires(m, W_after))
        wd = fires(m, W_words, a)
        acc = []
        for p in bench_acc:
            acc.append(f"{os.path.basename(p)[9:15]} {len(fires(m, windows(load(p))))}")
        cf = {}
        for spk, p in conf:
            cf[spk] = cf.get(spk, 0) + len(fires(m, windows(load(p))))
        print(f"{name}: crossfit run 2 false {fa} in {(len(cross2) / SR - (b - a)) / 60:.1f} min | similar words "
              f"(crossfit, {'trained on' if USE_CROSS_WORDS else 'held out'}) {len(wd)} at {[round(x, 1) for x in wd]} | "
              f"bench accuracy firings (6 said each) {acc} | Parecidas {cf or '—'}", flush=True)


def main():
    cache = os.path.join(HERE, "cache_v7.pkl")
    S = pickle.load(open(cache, "rb")) if os.path.exists(cache) else build_sets()
    if not os.path.exists(cache):
        pickle.dump(S, open(cache, "wb"))
    m4 = pickle.load(open(os.path.join(HERE, "clf_v4_M4.pkl"), "rb"))
    m7 = train(S, real_confusers())
    pickle.dump(m7, open(os.path.join(HERE, "clf_v7_M7.pkl"), "wb"))
    compare({"M4 (v1)": m4, "M7 (v2)": m7})
    # leave-one-speaker-out on the Parecidas sessions, when there are several speakers
    speakers = sorted({spk for spk, _ in confuser_sessions()})
    if len(speakers) > 1:
        for spk in speakers:
            m = train(S, real_confusers(exclude_speaker=spk))
            n = sum(len(fires(m, windows(load(p)))) for s, p in confuser_sessions() if s == spk)
            print(f"  leave-out {spk}: {n} firings on their Parecidas session(s)", flush=True)
    V2.models = {"M7": m7}


if __name__ == "__main__":
    main()
