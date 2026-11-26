"""First "salvar" detector prototype: openWakeWord-style (shared speech embeddings + a small classifier).

Leave-one-distance-out: to test on the camera phone at distance D, the classifier never sees the watch copy of the
utterances said at D (same speech, other microphone). Training positives are close-mic "salvar" (home, watch, two other
people's watches) mixed with court noise at random levels, with a random low-pass/reverb to imitate distance.
Negatives: court noise, bystander talk and the confuser words (salva, salvou, salve, falar, saber, salada).

Test: every camera-phone distance clip as a live stream (one score every 80 ms). A labeled "salvar" counts as heard
if the detector fires from its start to 1 s after its end; any other firing is a false trigger. Also run on
"60s de ruido 3", never used in training.
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt
from sklearn.neural_network import MLPClassifier

import features as F
from labels import DIST_CLIPS, DIST_UTTERANCES, DIST_WATCH, HOME_CONFUSERS, HOME_SALVAR, UNCERTAIN

HERE = os.path.dirname(os.path.abspath(__file__))
WAV = os.environ.get("VOICE_LAB_WAV", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "wav16"))
SR = 16000
CLIP = 2.0
rng = np.random.default_rng(7)


def load(name):
    x, sr = sf.read(os.path.join(WAV, name + ".wav"), dtype="float32")
    assert sr == SR
    return x


def cut(x, s, e):
    return x[max(0, int(s * SR)): int(e * SR)]


# ---------- sources ----------
home = load(HOME_SALVAR)
home_segs = [(2.76, 3.70), (3.70, 4.69)] + [tuple(s) for s in [
    (4.81, 5.78), (5.83, 6.77), (6.83, 7.77), (8.01, 9.08), (9.13, 10.2), (10.47, 11.51), (11.66, 12.6), (12.91, 13.91),
    (14.22, 15.25), (15.5, 16.5), (16.68, 17.65), (17.93, 18.97), (19.02, 19.93), (20.3, 21.37), (21.45, 22.49),
    (22.79, 23.77), (23.95, 25.01), (25.01, 25.97)]]
home_pos = [cut(home, s - 0.05, e + 0.05) for s, e in home_segs]

sara = load("Salvar teste Sara")
yas = load("Salvar teste yasmin")
other_pos = [cut(sara, s, e) for s, e in [(2.89, 4.02), (4.52, 5.65), (6.09, 7.06), (15.27, 16.37), (16.87, 17.9), (18.0, 19.29)]]
other_pos += [cut(yas, s, e) for s, e in [(20.9, 22.0), (24.4, 25.6), (51.0, 52.1), (52.62, 53.72), (54.06, 55.03)]]

watch = load(DIST_WATCH)
watch_pos = {d: [cut(watch, s - 0.05, e + 0.05) for s, e, dd, _ in DIST_UTTERANCES if dd == d and s != 13.48] for d in (3, 5, 9)}

conf = load(HOME_CONFUSERS)
conf_json = json.load(open(os.path.join(HERE, "marks", HOME_CONFUSERS + ".json")))
confusers = [cut(conf, s["start"] - 0.05, s["end"] + 0.05) for s in conf_json["segments"]]

noise_train = [load("60s de ruido 1"), load("60s de ruido 2"), load("Gravação")]


# ---------- augmentation ----------
def speed(x, r):
    n = int(len(x) / r)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def far(x):
    if rng.random() < 0.7:
        fc = rng.uniform(2500, 6000)
        x = sosfilt(butter(2, [150, fc], btype="band", fs=SR, output="sos"), x)
    if rng.random() < 0.3:
        L = int(rng.uniform(0.15, 0.4) * SR)
        ir = rng.standard_normal(L) * np.exp(-np.arange(L) / (L / 5))
        x = x + rng.uniform(0.1, 0.3) * np.convolve(x, ir / np.sqrt(np.sum(ir ** 2)))[: len(x)]
    return x.astype(np.float32)


def noise_bed(pool):
    src = pool[rng.integers(len(pool))]
    i = rng.integers(0, len(src) - int(CLIP * SR))
    return src[i: i + int(CLIP * SR)].copy()


def rms(x):
    return float(np.sqrt(np.mean(x ** 2) + 1e-12))


def mix(word, pool, snr_lo=-2, snr_hi=18, end_lo=1.55, end_hi=1.95):
    w = far(speed(word, rng.uniform(0.9, 1.1)))
    bed = noise_bed(pool)
    w = w / rms(w) * rms(bed) * 10 ** (rng.uniform(snr_lo, snr_hi) / 20)
    end = int(rng.uniform(end_lo, end_hi) * SR)
    start = end - len(w)
    a, b = max(0, start), min(end, len(bed))
    if b > a:
        bed[a:b] += w[a - start: b - start]
    peak = np.max(np.abs(bed)) + 1e-9
    return (bed / peak * rng.uniform(0.1, 0.9)).astype(np.float32)


def window_of(clip_audio):
    e = F.embeddings(clip_audio)
    return e[-F.WINDOW:].reshape(-1) if len(e) >= F.WINDOW else None


def make_pos(pos_words, k_pos=40):
    X = []
    for wd in pos_words:
        for _ in range(k_pos):
            v = window_of(mix(wd, noise_train))
            if v is not None:
                X.append(v)
    return np.array(X, np.float32)


def make_talk_neg(n=3000):
    """Bystander/own talk from the game watch recording (segments with no salvar-like word, >= 1.5 s), made far."""
    d = json.load(open(os.path.join(HERE, "marks", "Gravação 3.json")))
    import re
    pat = re.compile(r"sal|sau|sao|são|tao|dao|tau|sop|calv|sabe|sav", re.I)
    segs = [(x["start"], x["end"]) for x in d["segments"] if not pat.search(x["text"]) and x["end"] - x["start"] >= 1.5]
    g3 = load("Gravação 3")
    X = []
    for _ in range(n):
        s, e = segs[rng.integers(len(segs))]
        a = rng.uniform(s, max(s, e - 1.5))
        piece = cut(g3, a, a + 1.5)
        v = window_of(mix(piece, noise_train, snr_lo=-5, snr_hi=15, end_lo=1.9, end_hi=2.0))
        if v is not None:
            X.append(v)
    return np.array(X, np.float32)


def make_set(pos_words, k_pos=40, n_noise=5000, k_conf=25):
    X, y = [], []
    for wd in pos_words:
        for _ in range(k_pos):
            v = window_of(mix(wd, noise_train))
            if v is not None:
                X.append(v); y.append(1)
    for wd in confusers:
        for _ in range(k_conf):
            v = window_of(mix(wd, noise_train))
            if v is not None:
                X.append(v); y.append(0)
    for _ in range(n_noise):
        bed = noise_bed(noise_train)
        v = window_of(bed / (np.max(np.abs(bed)) + 1e-9) * rng.uniform(0.1, 0.9))
        if v is not None:
            X.append(v); y.append(0)
    # partial words: "salvar" cut off at the window's end must not fire
    for wd in pos_words[::2]:
        for _ in range(5):
            v = window_of(mix(wd, noise_train, end_lo=2.3, end_hi=2.6))
            if v is not None:
                X.append(v); y.append(0)
    return np.array(X, np.float32), np.array(y)


