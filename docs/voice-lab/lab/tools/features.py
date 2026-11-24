"""Speech embeddings for the "salvar" detector prototype (openWakeWord's shared feature models, Apache-2.0).

audio 16 kHz -> mel frames (10 ms, 32 bins) -> one 96-d embedding every 80 ms (each sees ~775 ms of audio).
The detector looks at WINDOW consecutive embeddings (~1.28 s).
"""
import os

import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 16000
STEP_S = 0.08  # one embedding per 80 ms
WINDOW = 16    # embeddings per detector window (~1.28 s)

_opts = ort.SessionOptions()
_opts.intra_op_num_threads = os.cpu_count()
_mel = ort.InferenceSession(os.path.join(HERE, "oww", "melspectrogram.onnx"), _opts)
_emb = ort.InferenceSession(os.path.join(HERE, "oww", "embedding_model.onnx"), _opts)


def embeddings(audio):
    """audio: float32 [-1, 1] at 16 kHz -> (n, 96); row i covers audio up to ~ (i * 0.08 + 0.775) s."""
    x = (np.clip(audio, -1, 1) * 32767).astype(np.float32)[None, :]
    mel = _mel.run(None, {"input": x})[0].squeeze()  # (frames, 32)
    mel = mel / 10.0 + 2.0
    n = (len(mel) - 76) // 8 + 1
    if n <= 0:
        return np.zeros((0, 96), np.float32)
    idx = np.arange(76)[None, :] + 8 * np.arange(n)[:, None]
    wins = mel[idx][..., None].astype(np.float32)  # (n, 76, 32, 1)
    out = []
    for i in range(0, n, 512):
        out.append(_emb.run(None, {"input_1": wins[i:i + 512]})[0].reshape(-1, 96))
    return np.concatenate(out)


def windows(emb):
    """(n, 96) -> (n - WINDOW + 1, WINDOW * 96); window j ends at embedding j + WINDOW - 1."""
    n = len(emb) - WINDOW + 1
    if n <= 0:
        return np.zeros((0, WINDOW * 96), np.float32)
    idx = np.arange(WINDOW)[None, :] + np.arange(n)[:, None]
    return emb[idx].reshape(n, -1)


def window_end_time(j):
    """Audio time (s) at which window j ends (when a live detector would fire)."""
    return (j + WINDOW - 1) * STEP_S + 0.775
