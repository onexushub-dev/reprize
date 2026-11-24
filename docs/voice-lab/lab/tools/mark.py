"""Find speech segments (Silero VAD) and transcribe each with Whisper small (sherpa-onnx), to locate every "salvar".

Usage: python mark.py OUT_DIR FILE [FILE ...]   -> OUT_DIR/<name>.json  {"file", "segments": [{"start","end","text"}]}
"""
import json
import os
import sys
import time

import numpy as np
import sherpa_onnx
import soundfile as sf
import torch
from silero_vad import get_speech_timestamps, load_silero_vad

HERE = os.path.dirname(os.path.abspath(__file__))
M = os.path.join(HERE, "sherpa-onnx-whisper-small")
SR = 16000

asr = sherpa_onnx.OfflineRecognizer.from_whisper(
    encoder=os.path.join(M, "small-encoder.int8.onnx"),
    decoder=os.path.join(M, "small-decoder.int8.onnx"),
    tokens=os.path.join(M, "small-tokens.txt"),
    language="pt",
    task="transcribe",
    num_threads=os.cpu_count(),
)
vad = load_silero_vad(onnx=True)


def transcribe(chunk):
    s = asr.create_stream()
    s.accept_waveform(SR, chunk)
    asr.decode_stream(s)
    return s.result.text.strip()


out_dir, files = sys.argv[1], sys.argv[2:]
os.makedirs(out_dir, exist_ok=True)
for path in files:
    name = os.path.splitext(os.path.basename(path))[0]
    target = os.path.join(out_dir, name + ".json")
    if os.path.exists(target):
        continue
    t0 = time.time()
    audio, sr = sf.read(path, dtype="float32")
    assert sr == SR
    stamps = get_speech_timestamps(torch.from_numpy(audio), vad, sampling_rate=SR, threshold=0.35,
                                   min_speech_duration_ms=150, min_silence_duration_ms=250, speech_pad_ms=150)
    segs = []
    for st in stamps:
        a, b = st["start"], st["end"]
        # Whisper hallucinates on long noise; cap each window at 8 s.
        for x in range(a, b, 8 * SR):
            y = min(b, x + 8 * SR)
            segs.append({"start": round(x / SR, 2), "end": round(y / SR, 2), "text": transcribe(audio[x:y])})
    with open(target, "w") as fh:
        json.dump({"file": name, "segments": segs}, fh, ensure_ascii=False, indent=0)
    hits = sum(1 for s in segs if "salv" in s["text"].lower())
    print(f"{name}: {len(segs)} segs, {hits} with 'salv' ({time.time() - t0:.0f}s)", flush=True)
