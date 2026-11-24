#!/usr/bin/env python3
"""Builds the "salvar" detector files for the app and for VoiceBench (plan Task 1), and the golden fixture both native
pipelines are tested against.

    # anywhere with the lab's Python packages (numpy, soundfile, onnx, onnxruntime, torch, torchaudio, onnx2torch,
    # coremltools, ai-edge-litert, scikit-learn):
    python3 export_detector.py build --out ../../../../app/modules/replay-camera
    # then on the Mac (needs only numpy + coremltools + Xcode): compiles build/voice_embedding.mlpackage into
    # ios/Models/voice_embedding.mlmodelc and checks Core ML's embeddings against the golden fixture:
    python3 export_detector.py mac --out ../../../../app/modules/replay-camera
    # `fetch` downloads openWakeWord v0.5.1's melspectrogram.onnx, embedding_model.onnx and embedding_model.tflite
    # into oww/ (needed by `build` only).

What the pipeline is (the native code copies it exactly):
  16 kHz mono float -> frames of 512 samples every 160 (no padding), periodic Hann(400) centred in the 512
  (samples 56..455) -> real FFT -> power (re^2 + im^2) -> 32 mel bins (torchaudio slaney scale + slaney norm,
  60..3800 Hz) -> 10*log10(max(p, 1e-10)) -> /10 + 2  (no top-dB floor: see `--check-floor`)
  -> one 96-d embedding every 8 frames from the last 76 -> classifier on the last 16 embeddings
  -> fire on 2 scores in a row >= 0.95, then 1.5 s without firing.
The mel filterbank and window are rebuilt here from torchaudio and asserted equal to openWakeWord's
melspectrogram.onnx; the embedding is openWakeWord's re-implementation of Google's speech embedding (Apache-2.0).
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import pickle
import shutil
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OWW = os.path.join(HERE, "oww")
WAV = os.environ.get("VOICE_LAB_WAV", os.path.join(HERE, "..", "wav16"))
CLASSIFIER = os.path.join(HERE, "models", "clf_v4_M4.pkl")
VERSION = "salvar-v1"
CONFIG = {
    "version": VERSION, "sampleRate": 16000, "nFft": 512, "winLength": 400, "hop": 160, "nMels": 32,
    "fMin": 60.0, "fMax": 3800.0, "embedEvery": 8, "embedFrames": 76, "embedSize": 96, "windows": 16,
    "hidden": 128, "threshold": 0.95, "consecutive": 2, "refractorySec": 1.5,
}
GOLDEN_SOURCES = [("3380894D-4D5C-4EC0-8071-5FCE87072764", 2.5, 8.5), ("60s de ruido 1", 10.0, 16.0)]


# ---------- reference pipeline (numpy) ----------
def hann_window() -> np.ndarray:
    w = np.zeros(CONFIG["nFft"], np.float32)
    n = np.arange(CONFIG["winLength"])
    off = (CONFIG["nFft"] - CONFIG["winLength"]) // 2
    w[off:off + CONFIG["winLength"]] = 0.5 - 0.5 * np.cos(2 * np.pi * n / CONFIG["winLength"])
    return w


def mel_filterbank() -> np.ndarray:
    import torchaudio
    return torchaudio.functional.melscale_fbanks(
        CONFIG["nFft"] // 2 + 1, CONFIG["fMin"], CONFIG["fMax"], CONFIG["nMels"], CONFIG["sampleRate"],
        norm="slaney", mel_scale="slaney").numpy().astype(np.float32)


def mel_frames(audio: np.ndarray, fb: np.ndarray) -> np.ndarray:
    """(n_frames, 32) for frames starting at 0, 160, 320... that fit entirely in `audio` (int16 scale)."""
    x = np.asarray(audio, np.float32) * 32767.0
    n = (len(x) - CONFIG["nFft"]) // CONFIG["hop"] + 1
    if n <= 0:
        return np.zeros((0, CONFIG["nMels"]), np.float32)
    idx = np.arange(CONFIG["nFft"])[None, :] + CONFIG["hop"] * np.arange(n)[:, None]
    spec = np.fft.rfft(x[idx] * hann_window()[None, :], axis=1)
    power = (spec.real ** 2 + spec.imag ** 2).astype(np.float32)
    mel = power @ fb
    return (10.0 * np.log10(np.maximum(mel, 1e-10)) / 10.0 + 2.0).astype(np.float32)


class OnnxEmbedding:
    def __init__(self):
        import onnxruntime as ort
        self.s = ort.InferenceSession(os.path.join(OWW, "embedding_model.onnx"))

    def __call__(self, windows: np.ndarray) -> np.ndarray:  # (N,76,32) -> (N,96)
        if len(windows) == 0:
            return np.zeros((0, 96), np.float32)
        return self.s.run(None, {"input_1": windows[..., None].astype(np.float32)})[0].reshape(-1, 96)


def embeddings_from_mel(mel: np.ndarray, embed) -> np.ndarray:
    n = (len(mel) - CONFIG["embedFrames"]) // CONFIG["embedEvery"] + 1
    if n <= 0:
        return np.zeros((0, 96), np.float32)
    idx = np.arange(CONFIG["embedFrames"])[None, :] + CONFIG["embedEvery"] * np.arange(n)[:, None]
    return embed(mel[idx])


class Classifier:
    def __init__(self, path=CLASSIFIER):
        clf = pickle.load(open(path, "rb"))
        assert [c.shape for c in clf.coefs_] == [(1536, 128), (128, 1)], [c.shape for c in clf.coefs_]
        assert clf.out_activation_ == "logistic" and clf.activation == "relu"
        self.W1, self.W2 = clf.coefs_[0].astype(np.float32), clf.coefs_[1][:, 0].astype(np.float32)
        self.b1, self.b2 = clf.intercepts_[0].astype(np.float32), np.float32(clf.intercepts_[1][0])
        self.sk = clf

    def scores(self, emb: np.ndarray) -> np.ndarray:
        n = len(emb) - CONFIG["windows"] + 1
        if n <= 0:
            return np.zeros(0)
        idx = np.arange(CONFIG["windows"])[None, :] + np.arange(n)[:, None]
        X = emb[idx].reshape(n, -1)
        h = np.maximum(X @ self.W1 + self.b1, 0)
        return 1 / (1 + np.exp(-(h @ self.W2 + self.b2)))

    def blob(self) -> bytes:
        return b"".join(a.astype("<f4").tobytes() for a in (self.W1, self.b1, self.W2, np.array([self.b2])))


def window_end_time(j: int) -> float:
    """Seconds of audio at which score j exists: end of its last embedding's last mel frame."""
    last_frame = (j + CONFIG["windows"] - 1) * CONFIG["embedEvery"] + CONFIG["embedFrames"] - 1
    return (last_frame * CONFIG["hop"] + CONFIG["nFft"]) / CONFIG["sampleRate"]


def fires(scores: np.ndarray) -> list[float]:
    out, last, run = [], -1e9, 0
    for j, p in enumerate(scores):
        run = run + 1 if p >= CONFIG["threshold"] else 0
        t = window_end_time(j)
        if run >= CONFIG["consecutive"] and t - last >= CONFIG["refractorySec"]:
            out.append(round(t, 4))
            last = t
    return out


def load_wav(name: str, start=0.0, end=None) -> np.ndarray:
    import soundfile as sf  # only `build` reads audio; `mac` runs without it
    x, sr = sf.read(os.path.join(WAV, name + ".wav"), dtype="float32")
    assert sr == 16000, sr
    return x[int(start * sr): None if end is None else int(end * sr)]


def sha256(path: str) -> str:
    h = hashlib.sha256()
    if os.path.isdir(path):
        for root, _, files in sorted(os.walk(path)):
            for f in sorted(files):
                h.update(open(os.path.join(root, f), "rb").read())
    else:
        h.update(open(path, "rb").read())
    return h.hexdigest()


# ---------- checks ----------
def check_mel_against_onnx(fb: np.ndarray):
    import onnx
    from onnx import numpy_helper
    W = {i.name: numpy_helper.to_array(i) for i in onnx.load(os.path.join(OWW, "melspectrogram.onnx")).graph.initializer}
    assert np.allclose(fb, W["1.melW"], atol=1e-5), np.abs(fb - W["1.melW"]).max()
    win = hann_window()
    k, n = np.arange(257)[:, None], np.arange(512)[None, :]
    assert np.allclose(win * np.cos(2 * np.pi * k * n / 512), W["0.stft.conv_real.weight"][:, 0, :], atol=1e-5)
    assert np.allclose(-win * np.sin(2 * np.pi * k * n / 512), W["0.stft.conv_imag.weight"][:, 0, :], atol=1e-5)
    print("mel filterbank + window == openWakeWord melspectrogram.onnx")


def onnx_mel(audio: np.ndarray) -> np.ndarray:
    import onnxruntime as ort
    s = ort.InferenceSession(os.path.join(OWW, "melspectrogram.onnx"))
    return s.run(None, {"input": (audio * 32767).astype(np.float32)[None, :]})[0].squeeze() / 10 + 2


def check_floor(fb, embed, clf):
    """The ONNX mel floors every frame at (loudest frame of the call - 80 dB). That floor depends on how much audio is
    in the call, so the streaming native code skips it. This shows it changes no word count on the lab's clips (in a
    quiet room a firing can move by up to ~0.5 s, as the floor lifts near-silent frames)."""
    names = ["3380894D-4D5C-4EC0-8071-5FCE87072764", "60s de ruido 1", "60s de ruido 3", "3m normal forte",
             "5m normal forte lado", "9m normalfortelado pul"]
    worst = 0.0
    for nm in names:
        a = load_wav(nm)
        s_ref = clf.scores(embeddings_from_mel(onnx_mel(a), embed))
        s_new = clf.scores(embeddings_from_mel(mel_frames(a, fb), embed))
        n = min(len(s_ref), len(s_new))
        worst = max(worst, float(np.abs(s_ref[:n] - s_new[:n]).max()))
        fr, fn = fires(s_ref[:n]), fires(s_new[:n])
        assert len(fr) == len(fn) and all(abs(x - y) <= 0.6 for x, y in zip(fr, fn)), (nm, fr, fn)
        shift = max([abs(x - y) for x, y in zip(fr, fn)] + [0.0])
        print(f"  {nm}: {len(fn)} firings either way, largest shift {shift:.2f} s")
    print(f"no top-dB floor: same number of firings on {len(names)} lab clips, each within 0.6 s "
          f"(max score diff {worst:.2e})")


def check_tflite(windows: np.ndarray, ref: np.ndarray):
    from ai_edge_litert.interpreter import Interpreter
    it = Interpreter(model_path=os.path.join(OWW, "embedding_model.tflite"))
    it.allocate_tensors()
    inp, out = it.get_input_details()[0], it.get_output_details()[0]
    got = []
    for w in windows:
        it.set_tensor(inp["index"], w[None, :, :, None].astype(np.float32))
        it.invoke()
        got.append(it.get_tensor(out["index"]).reshape(96))
    d = float(np.abs(np.array(got) - ref).max())
    assert d < 1e-3, d
    print(f"tflite embedding == onnx (max diff {d:.1e})")


def _embedding_torch_class():
    import onnx
    import torch
    import torch.nn.functional as Fn
    from onnx import numpy_helper

    class EmbeddingTorch(torch.nn.Module):
        """openWakeWord's embedding_model.onnx replayed node by node with plain torch ops (Conv with explicit pads,
        LeakyRelu 0.2, max(x, -0.4), MaxPool), so coremltools converts it without onnx2torch's broadcast ops."""

        def __init__(self):
            super().__init__()
            g = onnx.load(os.path.join(OWW, "embedding_model.onnx")).graph
            W = {i.name: numpy_helper.to_array(i) for i in g.initializer}
            self.steps = []
            self.params = torch.nn.ParameterList()
            for n in g.node:
                att = {a.name: onnx.helper.get_attribute_value(a) for a in n.attribute}
                if n.op_type == "Conv":
                    self.params.append(torch.nn.Parameter(torch.from_numpy(W[n.input[1]].copy()), requires_grad=False))
                    bias = None
                    if len(n.input) > 2:
                        self.params.append(torch.nn.Parameter(torch.from_numpy(W[n.input[2]].copy()), requires_grad=False))
                        bias = len(self.params) - 1
                    pads = list(att.get("pads", [0, 0, 0, 0]))  # [h_begin, w_begin, h_end, w_end]
                    wi = len(self.params) - (2 if bias is not None else 1)
                    self.steps.append(("conv", wi, bias, (pads[1], pads[3], pads[0], pads[2])))
                elif n.op_type == "LeakyRelu":
                    self.steps.append(("leaky", float(att["alpha"])))
                elif n.op_type == "Max":
                    self.steps.append(("floor", float(W[n.input[1]].ravel()[0])))
                elif n.op_type == "MaxPool":
                    self.steps.append(("pool", tuple(att["kernel_shape"]), tuple(att["strides"])))
                elif n.op_type == "Reshape":
                    self.steps.append(("reshape", tuple(int(v) for v in W[n.input[1]])))
                else:
                    raise ValueError(n.op_type)
            self._Fn = Fn

        def forward(self, mel):
            Fn = self._Fn
            x = mel
            for st in self.steps:
                if st[0] == "conv":
                    _, wi, bi, pad = st
                    if any(pad):
                        x = Fn.pad(x, pad)
                    x = Fn.conv2d(x, self.params[wi], None if bi is None else self.params[bi])
                elif st[0] == "leaky":
                    x = Fn.leaky_relu(x, st[1])
                elif st[0] == "floor":
                    x = torch.clamp(x, min=st[1])
                elif st[0] == "pool":
                    x = Fn.max_pool2d(x, st[1], st[2])
                else:
                    x = x.reshape(st[1])
            return x.reshape(1, 96)

    return EmbeddingTorch


def build_coreml(out_pkg: str, windows: np.ndarray, ref: np.ndarray):
    EmbeddingTorch = _embedding_torch_class()
    import coremltools as ct
    import torch

    w = EmbeddingTorch().eval()
    with torch.no_grad():
        got = np.concatenate([w(torch.from_numpy(x[None, :, :, None].astype(np.float32))).numpy() for x in windows])
    d = float(np.abs(got - ref).max())
    assert d < 1e-3, d
    traced = torch.jit.trace(w, torch.zeros(1, 76, 32, 1))
    ml = ct.convert(traced, inputs=[ct.TensorType(name="mel", shape=(1, 76, 32, 1))],
                    outputs=[ct.TensorType(name="embedding")], minimum_deployment_target=ct.target.iOS16,
                    compute_precision=ct.precision.FLOAT32, convert_to="mlprogram")
    if os.path.exists(out_pkg):
        shutil.rmtree(out_pkg)
    ml.save(out_pkg)
    print(f"torch embedding == onnx (max diff {d:.1e}); saved {out_pkg}")


# ---------- commands ----------
def cmd_build(a):
    out = os.path.abspath(a.out)
    ios_dir = os.path.join(out, "ios", "Models")
    ios_voice = os.path.join(ios_dir, "voice", VERSION)
    and_assets = os.path.join(out, "android", "src", "main", "assets")
    and_voice = os.path.join(and_assets, "voice", VERSION)
    fixtures = os.path.join(out, "ios", "Core", "Tests", "ReplayCoreTests", "Fixtures")
    for d in (ios_voice, and_voice, fixtures):
        os.makedirs(d, exist_ok=True)

    fb = mel_filterbank()
    check_mel_against_onnx(fb)
    embed = OnnxEmbedding()
    clf = Classifier()
    check_floor(fb, embed, clf)

    # golden audio: Victor's own close "salvar" + court noise (no bystander words)
    audio = np.concatenate([load_wav(n, s, e) for n, s, e in GOLDEN_SOURCES]).astype(np.float32)
    pcm = np.clip(np.round(audio * 32767), -32768, 32767).astype("<i2")
    audio_q = pcm.astype(np.float32) / 32767.0  # the natives decode the same int16
    mel = mel_frames(audio_q, fb)
    idx = np.arange(CONFIG["embedFrames"])[None, :] + CONFIG["embedEvery"] * np.arange((len(mel) - 76) // 8 + 1)[:, None]
    win = mel[idx]
    emb = embed(win)
    sc = clf.scores(emb)
    f = fires(sc)
    assert len(f) >= 2, f"golden audio fires only {f}"
    check_tflite(win, emb)
    build_coreml(os.path.join(HERE, "build", "voice_embedding.mlpackage"), win[:40], emb[:40])

    for d in (ios_voice, and_voice):
        json.dump(CONFIG, open(os.path.join(d, "detector.json"), "w"), indent=2)
        open(os.path.join(d, "mel_filterbank.bin"), "wb").write(fb.astype("<f4").tobytes())
        open(os.path.join(d, "classifier.bin"), "wb").write(clf.blob())
    shutil.copy(os.path.join(OWW, "embedding_model.tflite"), os.path.join(and_assets, "voice_embedding.tflite"))
    golden = {
        "note": "Plan Task 1. 6 s of Victor's close 'salvar' + 6 s of court noise, int16 LE at 16 kHz. mel: first 100 "
                "frames; embeddings: all; scores: all windows; fires: seconds (window_end_time).",
        "pcm16k": base64.b64encode(pcm.tobytes()).decode(),
        "mel": np.round(mel[:100], 6).tolist(),
        "embeddings": np.round(emb, 6).tolist(),
        "scores": np.round(sc, 6).tolist(),
        "fires": f,
    }
    json.dump(golden, open(os.path.join(fixtures, "voice-golden.json"), "w"))
    print(f"golden: {len(audio_q) / 16000:.1f} s, {len(mel)} mel frames, {len(emb)} embeddings, fires {f}")
    write_models_md(ios_voice, and_assets)
    print("parity ok (Core ML compile and check: run `mac` on the Mac)")


def cmd_mac(a):
    out = os.path.abspath(a.out)
    pkg = os.path.join(HERE, "build", "voice_embedding.mlpackage")
    dest = os.path.join(out, "ios", "Models")
    subprocess.check_call(["xcrun", "coremlcompiler", "compile", pkg, dest])
    import coremltools as ct
    fb = np.fromfile(os.path.join(dest, "voice", VERSION, "mel_filterbank.bin"), "<f4").reshape(257, CONFIG["nMels"])
    g = json.load(open(os.path.join(out, "ios", "Core", "Tests", "ReplayCoreTests", "Fixtures", "voice-golden.json")))
    pcm = np.frombuffer(base64.b64decode(g["pcm16k"]), "<i2").astype(np.float32) / 32767.0
    mel = mel_frames(pcm, fb)
    m = ct.models.MLModel(pkg, compute_units=ct.ComputeUnit.CPU_ONLY)
    worst = 0.0
    for j, ref in enumerate(g["embeddings"][:40]):
        x = mel[8 * j: 8 * j + 76][None, :, :, None].astype(np.float32)
        got = m.predict({"mel": x})["embedding"].reshape(96)
        worst = max(worst, float(np.abs(got - np.array(ref)).max()))
    assert worst < 1e-3, worst
    print(f"Core ML embedding == golden (max diff {worst:.1e}); compiled into {dest}/voice_embedding.mlmodelc")
    write_models_md(os.path.join(dest, "voice", VERSION), os.path.join(out, "android", "src", "main", "assets"))


def write_models_md(ios_voice: str, and_assets: str):
    rows = []
    for label, path in [
        ("detector.json", os.path.join(ios_voice, "detector.json")),
        ("mel_filterbank.bin", os.path.join(ios_voice, "mel_filterbank.bin")),
        ("classifier.bin", os.path.join(ios_voice, "classifier.bin")),
        ("voice_embedding.tflite (Android)", os.path.join(and_assets, "voice_embedding.tflite")),
        ("voice_embedding.mlmodelc (iOS)", os.path.join(ios_voice, "..", "..", "voice_embedding.mlmodelc")),
    ]:
        rows.append(f"| {label} | {sha256(path) if os.path.exists(path) else '(built on the Mac by `mac`)'} |")
    md = os.path.join(HERE, "..", "..", "MODELS.md")
    text = open(md).read() if os.path.exists(md) else ""
    head = text.split("## sha256")[0] if "## sha256" in text else text
    open(md, "w").write(head.rstrip() + "\n\n## sha256\n\nWritten by `export_detector.py`.\n\n| File | sha256 |\n|---|---|\n"
                       + "\n".join(rows) + "\n")


def cmd_fetch(a):
    import urllib.request
    os.makedirs(OWW, exist_ok=True)
    base = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/"
    for f in ("melspectrogram.onnx", "embedding_model.onnx", "embedding_model.tflite"):
        urllib.request.urlretrieve(base + f, os.path.join(OWW, f))
        print(f, sha256(os.path.join(OWW, f)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("cmd", choices=["fetch", "build", "mac"])
    p.add_argument("--out", default=os.path.join(HERE, "..", "..", "..", "..", "app", "modules", "replay-camera"),
                   help="app/modules/replay-camera")
    a = p.parse_args()
    {"fetch": cmd_fetch, "build": cmd_build, "mac": cmd_mac}[a.cmd](a)


if __name__ == "__main__":
    main()
