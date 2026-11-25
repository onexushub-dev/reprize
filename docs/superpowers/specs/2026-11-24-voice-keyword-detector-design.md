# Voice keyword detector for "salvar" — design

Status: draft for Victor's approval · 2026-11-24
Lab work behind it: `docs/voice-lab/2026-11-23-voice-trigger-field-test.md` (results) and `docs/voice-lab/lab/tools/` (scripts).

## Why

The voice trigger today asks a dictation engine to write down everything it hears and then looks for "salvar" in the text:
Apple `SFSpeechRecognizer` on iOS, ML Kit GenAI speech recognition on Android. On court, with music, wind and people
talking, dictation misses the word, even when the voice is loud and clear. Fast, it sounds like "salvá", and dictation
writes "Salve!", "Sao Bair" or "Tao Bar".

| Measured on court (see the lab report) | Today's trigger | Detector prototype (M4) |
|---|---|---|
| Victor, real game, loud music | 12/27 | — |
| Victor, up to 10 m, strong wind (held-out day) | 9/15 | 16/18, and 6/6 at 12 m |
| Eliane (adult woman, never heard), 3/5/10 m | — | 18/18 |
| Sara (never heard from the phone), 3/9 m, loud music | — | 5/6 |
| Yasmin, calm day, 3/5 m · 10 m (soft voice, a machine nearby) | — | 12/12 · 3/6 |
| False triggers, 67 min of held-out noise (other courts, a championship, a tennis lesson) | — | 1 (0.9/h) |

A small detector trained only on "salvar", from the player's own recordings, hears it much more often and almost never
fires on its own.

## Goals

- In Portuguese (`pt-BR`), "salvar" is heard by the dedicated detector on **iOS and Android**, on the **camera phone**
  and on the **remote phone**.
- Hit rate at least the prototype's (table above) up to 10 m, with ≤ 1 false trigger per hour.
- Portuguese voice needs **only the microphone permission** (no speech-recognition permission), and works on every
  Android version the app supports (no Android 12 floor, no language-pack download).
- A better model ships by **replacing files**, with no code change.

## Non-goals

- English "save": keeps today's dictation path unchanged (Victor, 2026-11-24). It gets its own detector later, if this
  one proves itself.
- Apple Watch voice (raise wrist, say "salvar"): a separate spec, after this ships. It will reuse the same model files
  and pipeline.
- Downloading models from a server, remote flags, or engine switches in the UI.
- Changing how the model is trained (the lab stays in `docs/voice-lab/`).

## Anti-goals (a failure even if it "works")

- Any audio leaving the phone. Everything runs on the device, as today.
- Any change to the audio recorded into the clips. The detector only reads a copy.
- Noticeably more battery use or heat while recording. The thermal steps the app already has must not get worse.
- Saves nobody asked for. The false-trigger rate is the gate, not an afterthought.

## Approaches considered

| | What | Trade-off |
|---|---|---|
| **A — direct swap (chosen, Victor 2026-11-24)** | In `pt-BR`, the detector replaces dictation outright, after it wins in VoiceBench (Phase 1) | Fastest in the app. Going back needs a store release. |
| B — side-by-side phase | A test build runs both engines and logs both; then the detector becomes the default | Field numbers before shipping, more work |
| C — server-controlled | Like B, with engine and threshold switched from the backend | No release to switch, but new infrastructure and more ways to fail |

## Phase 1: VoiceBench, before the app (Victor, 2026-11-24)

The detector goes into Reprize only after it beats today's trigger in a test app, as FocusBench did for Modo Foco.
**VoiceBench** is a throwaway iPhone app in `docs/voice-lab/lab/ios-bench/`, separate from Reprize and never shipped.

- **Same microphone path as Reprize:** an audio-only `AVCaptureSession` with `AVCaptureAudioDataOutput`.
- **Two engines on the same buffers.** "Atual" is a copy of today's `VoiceTrigger` dictation path (`SFSpeechRecognizer`
  on-device pt-BR, `VoiceCommand` matching, restart every 50 s, 2 s cooldown). "Novo" is the keyword detector below,
  built from the same model files and the same `ReplayCore` math the app will use.
- **Accuracy mode** (both engines on):
  - distance sessions: pick 3, 5, 10 or 12 m and type the speaker's name; the speaker says "salvar" 6 times (3
    normal, 3 loud); stop. Two big counters ("Atual N", "Novo N") show while it runs.
  - noise session: a normal game with nobody saying "salvar"; it counts each engine's false triggers.
- **Consumption mode** (one engine at a time): microphone only (baseline), only Atual, only Novo, **10 min each** (Victor, 2026-11-24: 15 → 10),
  same place, off the charger, same screen brightness, cooling down between runs. Every minute it logs:
  - battery level (iOS gives apps 5% steps, so a 10 min run rarely moves it: CPU above the microphone-only run and heat are the main readings, and an Xcode Power Profiler trace is the full energy picture);
  - iOS thermal state (nominal/fair/serious/critical, the same one Reprize uses);
  - the app's CPU time;
  - for Novo, the average processing time per 80 ms step.

  Dictation does part of its work in an iOS process outside the app, so in-app CPU understates Atual; battery and
  heat are the fair comparison.
- **Every session saves its audio** with a JSON of events and readings, reachable from the Mac's Finder. Words can
  then be checked by ear and future models scored on the same recordings.
- `voice_bench.py prepare` copies the model files into the bench; `voice_bench.py results` builds one table per
  speaker and distance, plus false triggers per hour, battery per hour, time in each thermal state and CPU.

Phase 2, the integration into Reprize below (iOS, Android, app), starts only after Victor approves the VoiceBench
numbers.

## How it works

### Pipeline (identical on both platforms; numbers from the lab, `features.py` and `detector_v4.py`)

1. **Audio in:** whatever the source gives (the capture session's buffers, the remote's microphone), mixed to mono.
2. **Resample to 16 kHz** with a proper low-pass first. Today's Android code interpolates without one, which folds court
   noise above 8 kHz into the voice band; the new resampler also serves the English ML Kit path.
3. **Mel frames:** 32 mel bins, every 10 ms, then `mel / 10 + 2`. Same as openWakeWord's melspectrogram, minus its top-dB floor, which depends on how much audio is processed at once. Removing it changes no word count on the lab clips; in a quiet room a firing can move by up to 0.5 s.
4. **Speech embedding:** a 96-number embedding every 80 ms, each from the last 76 mel frames (~0.76 s).
5. **Classifier:** the last 16 embeddings (~1.3 s of audio) → a score from 0 to 1. Today it is one hidden layer of 128
   (ReLU) and a sigmoid, the `M4` weights.
6. **Firing rule:** two scores in a row ≥ 0.95 → "salvar". The detector then ignores audio for 1.5 s; the existing 2 s
   cooldown stays on top.

Latency: it fires about 0.2–0.5 s after the word ends. Steps 3–5 are kept in small ring buffers, so the detector runs
continuously, with none of today's restart every 50 s.

### Model files (one folder per version, the same in iOS and Android)

`voice/salvar-v1/` holds:
- `detector.json`: version, sample rate, step, window, threshold (0.95), windows in a row (2), refractory (1.5 s);
- the **mel** and **embedding** models, which never change between versions: Core ML (`.mlmodelc`) on iOS, LiteRT
  (`.tflite`) on Android, as the ball models already are;
- the **classifier**, the only part retraining changes: its weights as a small file both platforms read (or a tiny
  Core ML / LiteRT model, builder's call), with its version.

A new model is a new classifier file plus `detector.json`, and the Diagnóstico shows which version is running. Total
size is about 3 MB.

- **The first classifier is `M4`:** `docs/voice-lab/lab/tools/models/clf_v4_M4.pkl`, a scikit-learn `MLPClassifier`
  (1536 → 128 ReLU → 1 logistic). Export its weights with a small script kept next to the lab tools.
- **The mel parameters** (FFT size, window, mel range) are the ones inside openWakeWord's `melspectrogram.onnx`.
  Read them from that graph and check them with the golden test below.

### iOS (`modules/replay-camera/ios/`)

- New `KeywordDetector` (pipeline above), owned by `VoiceTrigger`. When the locale is `.ptBR`, `VoiceTrigger` feeds it
  instead of `SFSpeechRecognizer`. `.enUS` keeps today's code, untouched.
- Inputs it already receives: `consider(CMSampleBuffer)` from the capture session (read the format from the buffer;
  never assume 44.1 or 48 kHz or the channel count) and `consider(AVAudioPCMBuffer)` from `RemoteVoice`.
- Its own serial queue with a bounded backlog: if it falls behind, it drops audio and logs it, and never blocks the
  capture queue.
- `isSupported(.ptBR)` → true whenever the models load. The speech-recognition permission is not needed for `.ptBR`.
- `onCommand` and the event it emits stay as they are (`onTrigger` with `source: "voice"`, `onRemoteVoice`).
- Switching language while voice is on (`setEnabled` with a new locale) moves between the two engines, as switching
  recognizers does today.

### Android (`modules/replay-camera/android/`)

- New `KeywordDetector.kt` with LiteRT (already a dependency), CPU. Same pipeline and the same `detector.json`.
- `VoiceTrigger` uses it for `pt-BR` instead of ML Kit; ML Kit stays only for `en-US`. `consider(buf, bytes, rate)`
  keeps its signature, and the recorder thread never blocks.
- `isSupported()` becomes per locale: `pt-BR` always (models loaded), `en-US` as today (Android 12+).
- `RemoteVoice` (remote phone) gets the same detector. It already records 16 kHz mono with `VOICE_RECOGNITION`.

### App (`app/src`)

- `isVoiceSupported("pt-BR")` is true on both platforms, so onboarding, setup and the remote stop hiding voice on
  older Androids.
- `setup.tsx`, `remote.tsx` and `onboarding.tsx`: in Portuguese, turning voice on asks for nothing beyond the
  microphone the recording already has, and the speech-recognition prompt and its "denied" states only apply to
  English. Text that mentions the speech-recognition permission follows the same rule.
- No new screens or settings. "Testar gatilhos" and the practice sheet keep working as they are, on the new engine.

### Diagnóstico

Both platforms log, under the existing `voz:` prefix and never anything that was said:
- the detector starting, with its model version;
- each "salvar" heard, with its score;
- audio dropped for falling behind;
- model load errors.

### Privacy and store texts

Still all on the device. The store privacy answers don't change (no audio collected). `NSSpeechRecognitionUsageDescription`
stays for English. Victor is already updating the store texts for the next release: if any of them says that voice
needs speech recognition, it should say so only for English.

## Before building: prerequisites

1. **License of the two feature models.** The openWakeWord code is Apache-2.0, and its pretrained wake-word models
   (CC BY-NC-SA) are not used. The embedding is Google's speech embedding (TF Hub, Apache-2.0), which openWakeWord
   re-implemented. The mel model is an ONNX export of Torch's melspectrogram with no license stated.
   - **Mel:** rebuild it ourselves from torchaudio (BSD) with the same parameters, or compute the mel frames in
     native code.
   - **Embedding:** convert Google's original TF Hub model ourselves, and keep its license notice in the app's
     licenses.
   - The project rule holds: free, commercial use allowed, nothing GPL/AGPL.
2. **Conversion check (golden test).** Run a few lab WAVs through the native pipeline on each platform. The scores
   must match the Python lab's within a small tolerance, and the firing times within one step (80 ms). Use short
   clips of Victor's own voice only (`HOME_SALVAR` and a few seconds of noise), so no bystanders end up in the repo.

## Validation

- **Unit:** the firing rule (threshold, two in a row, refractory), the resampler (a tone above 8 kHz must not leak
  into the 16 kHz output), and the ring buffers across buffer sizes.
- **Golden test** on both platforms (above), in CI where the platform allows it.
- **Device:** 30 min of recording with voice on, comparing CPU, battery and the thermal state with voice off; the
  difference has to be small enough not to change the app's heat steps.
- **Field:** one session with the field-test checklist (3/5/10 m, voice ON, plus a normal game), comparing with the
  lab numbers.

## Left to the builder

- Mel in a model file or in native code, and the classifier as a weights file or a tiny model, as long as one
  `detector.json` drives both platforms and a retrain only swaps the classifier.
- Queue sizes, how buffers are batched into 80 ms steps, and thread priorities.
- Where the model folder sits in each native project (next to the ball models is the obvious place).
