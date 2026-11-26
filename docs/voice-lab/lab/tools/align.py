"""Find where a phone clip sits relative to a watch recording.

The two microphones hear very different mixes (the watch hears the player's voice up close, the phone hears the court),
so raw-waveform correlation is unreliable. This matches the loudness envelopes of the speech band instead (10 ms
frames, Pearson correlation over the overlap, at least MIN_OVERLAP seconds of overlap).

Usage: python align.py LONG.wav CLIP.wav [CLIP.wav ...]
Prints, per clip: offset in seconds (clip t=0 is LONG t=offset; negative = the clip starts before LONG),
the correlation at the best offset and the margin over the best offset more than 1 s away.
"""
import os
import sys

import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

SR = 16000
HOP = 160  # 10 ms
MIN_OVERLAP = 5.0
SOS = butter(4, [300, 3400], btype="band", fs=SR, output="sos")


def envelope(path):
    x, sr = sf.read(path, dtype="float32")
    assert sr == SR
    x = sosfiltfilt(SOS, x)
    n = len(x) // HOP
    e = np.log10(np.mean(x[: n * HOP].reshape(n, HOP) ** 2, axis=1) + 1e-10)
    # keep only rises (onsets): both mics agree on when sounds start far better than on their levels
    d = np.diff(e, prepend=e[0])
    return np.clip(d, 0, None)


def best_offset(long_env, clip_env):
    min_ov = int(MIN_OVERLAP * SR / HOP)
    scores = {}
    for lag in range(-(len(clip_env) - min_ov), len(long_env) - min_ov):
        a0, a1 = max(0, lag), min(len(long_env), lag + len(clip_env))
        if a1 - a0 < min_ov:
            continue
        a = long_env[a0:a1]
        b = clip_env[a0 - lag: a1 - lag]
        sa, sb = a.std(), b.std()
        if sa == 0 or sb == 0:
            continue
        scores[lag] = float(np.mean((a - a.mean()) * (b - b.mean())) / (sa * sb))
    lags = np.array(list(scores))
    vals = np.array(list(scores.values()))
    i = int(np.argmax(vals))
    far = np.abs(lags - lags[i]) > SR // HOP
    return lags[i] * HOP / SR, vals[i], vals[i] - vals[far].max()


if __name__ == "__main__":
    long_env = envelope(sys.argv[1])
    for clip in sys.argv[2:]:
        off, r, margin = best_offset(long_env, envelope(clip))
        print(f"{os.path.basename(clip)}\t{off:.2f}\tr={r:.2f}\tmargin={margin:.2f}")
