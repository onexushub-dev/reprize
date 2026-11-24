"""Per utterance of the distance test: voice-over-noise (SNR) and whether a dictation engine (Whisper small) reads
"salvar", on the camera phone and on the watch. Writes results/dist.csv and prints a summary per distance.
"""
import csv
import os
import re
import unicodedata

import numpy as np
import sherpa_onnx
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

from labels import DIST_CLIPS, DIST_UTTERANCES, DIST_WATCH, UNCERTAIN

HERE = os.path.dirname(os.path.abspath(__file__))
WAV = os.environ.get("VOICE_LAB_WAV", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "wav16"))
SR = 16000
SOS = butter(4, [300, 3400], btype="band", fs=SR, output="sos")
M = os.path.join(HERE, "sherpa-onnx-whisper-small")
asr = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=os.path.join(M, "small-encoder.int8.onnx"), decoder=os.path.join(M, "small-decoder.int8.onnx"),
    tokens=os.path.join(M, "small-tokens.txt"), language="pt", task="transcribe", num_threads=os.cpu_count())


def load(name):
    x, sr = sf.read(os.path.join(WAV, name + ".wav"), dtype="float32")
    return x, sosfiltfilt(SOS, x)


def fold(t):
    t = unicodedata.normalize("NFD", t.lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def says_salvar(text):
    return re.search(r"\bsalvar\b", fold(text)) is not None


def whisper(x):
    s = asr.create_stream()
    s.accept_waveform(SR, x)
    asr.decode_stream(s)
    return s.result.text.strip()


def power(x):
    return float(np.mean(x ** 2) + 1e-12)


def snr(band, s, e, busy):
    """Loudest 0.4 s inside the utterance vs the median 0.4 s of the 4 s around it that holds no labeled speech."""
    w = int(0.4 * SR)
    a, b = max(0, int((s - 0.3) * SR)), min(len(band), int((e + 0.3) * SR))
    sig = max(power(band[i:i + w]) for i in range(a, max(a + 1, b - w), SR // 50))
    noise = []
    for i in range(max(0, int((s - 4) * SR)), min(len(band) - w, int((e + 4) * SR)), SR // 10):
        t0, t1 = i / SR, (i + w) / SR
        if any(t1 > bs - 0.3 and t0 < be + 0.3 for bs, be in busy):
            continue
        noise.append(power(band[i:i + w]))
    if not noise:
        return None
    pn = float(np.median(noise))
    return 10 * np.log10(max(sig - pn, 1e-12) / pn)


busy_watch = [(u[0], u[1]) for u in DIST_UTTERANCES] + UNCERTAIN
watch_raw, watch_band = load(DIST_WATCH)
clips = {name: load(name) for name in DIST_CLIPS}
rows = []
for s, e, dist, style in DIST_UTTERANCES:
    row = {"start": s, "dist": dist, "style": style}
    pad = int(0.4 * SR)
    row["watch_snr"] = snr(watch_band, s, e, busy_watch)
    row["watch_text"] = whisper(watch_raw[max(0, int(s * SR) - pad): int(e * SR) + pad])
    for name, off in DIST_CLIPS.items():
        raw, band = clips[name]
        cs, ce = s - off, e - off
        if cs >= 0.2 and ce <= len(raw) / SR - 0.2:
            busy = [(a - off, b - off) for a, b in busy_watch]
            row["clip"] = name
            row["phone_snr"] = snr(band, cs, ce, busy)
            row["phone_text"] = whisper(raw[max(0, int(cs * SR) - pad): int(ce * SR) + pad])
            break
    rows.append(row)

os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
keys = ["start", "dist", "style", "clip", "phone_snr", "phone_text", "watch_snr", "watch_text"]
with open(os.path.join(HERE, "results", "dist.csv"), "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=keys)
    w.writeheader()
    for r in rows:
        w.writerow({k: (round(r[k], 1) if isinstance(r.get(k), float) else r.get(k, "")) for k in keys})

for dist in (3, 5, 9):
    rs = [r for r in rows if r["dist"] == dist and "clip" in r]
    ps = [r["phone_snr"] for r in rs if r.get("phone_snr") is not None]
    ws = [r["watch_snr"] for r in rs if r.get("watch_snr") is not None]
    ph = sum(says_salvar(r["phone_text"]) for r in rs)
    wh = sum(says_salvar(r["watch_text"]) for r in rs)
    print(f"{dist} m: n={len(rs)}  phone SNR median {np.median(ps):.1f} dB  watch SNR median {np.median(ws):.1f} dB  "
          f"Whisper 'salvar': phone {ph}/{len(rs)}  watch {wh}/{len(rs)}")
for r in rows:
    print(f"{r['start']:7.2f} {r['dist']} {r['style']:6s} phone {r.get('phone_snr', float('nan')):5.1f} dB "
          f"[{r.get('phone_text', '')[:22]:22s}]  watch {r['watch_snr']:5.1f} dB [{r['watch_text'][:22]}]")
