# Voice Keyword Detector ("salvar", pt-BR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the dedicated "salvar" detector against today's trigger in a test app (VoiceBench, Phase 1), then put it in Reprize for Portuguese (iOS + Android, camera and remote phones; Phase 2). English stays on today's engine.

**Architecture:** One pipeline on both platforms: 16 kHz resample → mel frames (native) → speech embedding (Core ML / LiteRT model) → small MLP classifier (weights file) → firing rule. The pure math (resampler, mel, classifier, rule, config) lives in the platform-free cores (`ReplayCore` in Swift, `core/` in Kotlin) and is pinned by one shared golden fixture. `VoiceTrigger` on each platform routes `pt-BR` to the new `KeywordDetector` and `en-US` to the old recognizer. The model files are produced by one export script from the lab.

**Tech Stack:** Swift (Accelerate/vDSP, Core ML), Kotlin (LiteRT 1.4.2, already a dependency), Expo module bridge, React Native/TypeScript (Jest), Python (lab export: numpy, torch/torchaudio, onnx, onnx2torch, coremltools, ai-edge-litert).

**Spec:** `docs/superpowers/specs/2026-11-24-voice-keyword-detector-design.md`

## Global Constraints

- pt-BR only. `en-US` keeps `SFSpeechRecognizer` (iOS) and ML Kit GenAI (Android) exactly as today.
- Pipeline numbers: 16 000 Hz; samples scaled to int16 range (×32767); mel: frames of 512 every 160 (no padding), periodic Hann(400) at samples 56…455 of the 512, real FFT, power, 32-bin filterbank from `mel_filterbank.bin` (torchaudio slaney scale + slaney norm, 60–3800 Hz), `10·log10(max(p, 1e-10))`, **no top-dB floor** (Task 1 measured it changes no word count), then `/10 + 2`; embedding every 8 mel frames from the last 76; classifier on the last 16 embeddings; fire on 2 consecutive scores ≥ 0.95; refractory 1.5 s; the existing 2 s cooldown stays.
- First classifier: `docs/voice-lab/lab/tools/models/clf_v4_M4.pkl` (1536 → 128 ReLU → 1 logistic).
- Model folder version `salvar-v1`; all runtime numbers come from its `detector.json`, never from code constants.
- No audio leaves the phone; the recorded clip audio is never modified; the detector never blocks the capture/recorder thread.
- Diagnóstico lines use the `voz:` prefix and never contain transcribed speech.
- License gate: no model file ships until Victor signs off `MODELS.md` (Task 1). Project rule: free, commercial use allowed, no GPL/AGPL.
- Code style: no optional chaining (`?.`) in TS/JS; explicit checks instead.
- Docs and plan text in English.
- Git: the agent runs no git commands at all (Victor, 2026-11-24). At each "Commit point" the agent stops and sends Victor the exact `git add` / `git commit` lines; Victor runs them.

## Review Focus

1. **Audio format changes mid-recording** (AirPods/route change: 48 kHz stereo → 44.1 kHz mono): the detector must rebuild its resampler and keep firing. Test in Tasks 2 and 7: feed golden audio at 48 kHz stereo, then 44.1 kHz mono, and assert the same firing times.
2. **Locale switched while listening** (pt-BR ↔ en-US): exactly one engine is live afterwards, and nothing fires twice. Test in Tasks 6 and 8 (routing).
3. **Model files missing or broken** (bad `detector.json`, truncated `classifier.bin`): `isVoiceSupported("pt-BR")` is false, a `voz: modelo indisponível` line is logged, and nothing crashes. Test in Tasks 3 and 7 (config decode errors).
4. **Detector falling behind** (slow phone, heat): it drops audio past a bounded backlog, counts the drops, and never blocks. Test in Tasks 6 and 8 (queue drop counter).
5. **Silence and clipping** (all zeros; full-scale square wave): there is no NaN or infinity, and nothing fires. Test in Tasks 2/3 and 7.

---

## File Structure

| Path | Responsibility |
|---|---|
| `docs/voice-lab/lab/tools/export_detector.py` | Builds `salvar-v1` (mel filterbank, classifier weights, `detector.json`, embedding models) and the golden fixture; parity asserts |
| `docs/voice-lab/MODELS.md` | Provenance, licenses and sha256 of every shipped model file |
| `app/modules/replay-camera/ios/Core/Sources/ReplayCore/Voice/{Resampler,MelFrontend,KeywordScorer,FiringRule,KeywordConfig}.swift` | Pure pipeline math (Swift) |
| `app/modules/replay-camera/ios/Core/Tests/ReplayCoreTests/VoiceKeywordTests.swift` + `Fixtures/voice-golden.json` | Swift tests; fixture shared with Android |
| `app/modules/replay-camera/ios/KeywordDetector.swift` | Embedding (Core ML) + ring buffers + queue; emits commands (Phase 2; VoiceBench uses the same file by reference) |
| `docs/voice-lab/lab/ios-bench/VoiceBench/*`, `VoiceBench.xcodeproj` | Phase 1 test app: both engines, sessions, consumption runs, export |
| `docs/voice-lab/lab/tools/voice_bench.py` | `prepare` (models into the bench) and `results` (comparison tables) |
| `app/modules/replay-camera/ios/VoiceTrigger.swift`, `ReplayCameraModule.swift`, `RemoteVoice.swift` | Routing pt-BR → detector, permissions, support check |
| `app/modules/replay-camera/ios/Models/voice/salvar-v1/*`, `Models/voice_embedding.mlmodelc` | iOS model files (pod resource bundle) |
| `app/modules/replay-camera/android/src/main/java/expo/modules/replaycamera/core/voice/{Resampler,MelFrontend,KeywordScorer,FiringRule,KeywordConfig}.kt` | Pure pipeline math (Kotlin) |
| `app/modules/replay-camera/android/src/test/java/expo/modules/replaycamera/core/VoiceKeywordTest.kt` | Kotlin tests on the same golden fixture |
| `app/modules/replay-camera/android/src/main/java/expo/modules/replaycamera/KeywordDetector.kt` | Embedding (LiteRT) + ring buffers + queue |
| `.../VoiceTrigger.kt`, `.../remote/RemoteVoice.kt`, `.../ReplayCameraModule.kt` | Routing, support check, new resampler for en-US too |
| `app/modules/replay-camera/android/src/main/assets/voice/salvar-v1/*`, `assets/voice_embedding.tflite` | Android model files |
| `app/modules/replay-camera/src/{ReplayCamera,ReplayCameraModule}.ts`, `app/src/app/{setup,remote,onboarding}.tsx` | Per-locale voice permission/support in the app |

---

## Phase 1 — Models, core math and VoiceBench (the detector must win here before Phase 2 starts)

### Task 1: Model export, provenance and golden fixture

**Files:**
- Create: `docs/voice-lab/lab/tools/export_detector.py`, `docs/voice-lab/MODELS.md`
- Create (outputs): `app/modules/replay-camera/ios/Models/voice/salvar-v1/{detector.json,mel_filterbank.bin,classifier.bin}`, `app/modules/replay-camera/ios/Models/voice_embedding.mlmodelc`, the same three files under `android/src/main/assets/voice/salvar-v1/`, `android/src/main/assets/voice_embedding.tflite`, `ios/Core/Tests/ReplayCoreTests/Fixtures/voice-golden.json`
- Modify: `docs/voice-lab/.gitignore` (allow `MODELS.md` and `export_detector.py`; `*.md` and `lab/tools/*.py` already are)

**Interfaces:**
- Produces `detector.json`:
  `{"version":"salvar-v1","sampleRate":16000,"nFft":512,"winLength":400,"hop":160,"nMels":32,"fMin":60.0,"fMax":3800.0,"embedEvery":8,"embedFrames":76,"embedSize":96,"windows":16,"hidden":128,"threshold":0.95,"consecutive":2,"refractorySec":1.5}`
- Produces `mel_filterbank.bin`: float32 little-endian, row-major 257×32.
- Produces `classifier.bin`: float32 LE, in order W1 (1536×128 row-major), b1 (128), W2 (128), b2 (1).
- Produces embedding models: input `[N,76,32,1]` float32, output `[N,96]` (squeezed). Core ML input name `mel`, output `embedding`; tflite as shipped by openWakeWord v0.5.1.
- Produces `voice-golden.json`: `{"pcm16k": base64 int16 LE, "mel": [[32 floats] × first 100 frames], "embeddings": [[96] × all], "scores": [all window scores], "fires": [seconds]}`. Audio: `HOME_SALVAR` 2.5–8.5 s (Victor, close) plus `60s de ruido 1` 10–16 s, so no bystander speech is in the repo; it fires at 2.222, 3.742 and 5.422 s. Fire time of score j: `(((j+15)*8+75)*160 + 512) / 16000` s.

- [ ] **Step 1: Mel filterbank from torchaudio, asserted against openWakeWord's graph.** `build_mel()` uses `torchaudio.functional.melscale_fbanks(n_freqs=257, f_min=60, f_max=3800, n_mels=32, sample_rate=16000, norm=None, mel_scale="htk")`. Assert `np.allclose(fb, onnx_melW, atol=1e-5)` against initializer `1.melW` of `oww/melspectrogram.onnx`. If that fails, try `mel_scale="slaney"` and `norm="slaney"` before stopping. Also assert that the window (row 0 of `0.stft.conv_real.weight`) equals `hann(400, periodic=True)` zero-padded to 512, centred.
- [ ] **Step 2: Classifier export.** Load the M4 pickle, assert `coefs_` shapes `[(1536,128),(128,1)]` and `out_activation_ == "logistic"`, then write `classifier.bin` and `detector.json`.
- [ ] **Step 3: Embedding models.** iOS: `onnx2torch.convert(embedding_model.onnx)` → `torch.jit.trace` → `coremltools.convert(minimum_deployment_target=ct.target.iOS16)` → `xcrun coremlcompiler compile` (run on the Mac). Android: copy openWakeWord v0.5.1 `embedding_model.tflite` and record its sha256.
- [ ] **Step 4: Parity asserts in the script.** On the golden audio, the Core ML (`model.predict`, macOS) and tflite (`ai_edge_litert.Interpreter`) outputs match the ONNX embedding: max abs difference < 1e-3. A pure-numpy reference pipeline (mel → ONNX embedding → classifier → rule) reproduces the lab's firing times for `HOME_SALVAR`.
- [ ] **Step 5: Golden fixture.** Write `voice-golden.json` from the numpy reference.
- [ ] **Step 6: `MODELS.md`.** One row per shipped file: source URL, upstream license and its text (Apache-2.0 for Google's speech embedding and the openWakeWord code; mel weights generated by us from torchaudio, BSD-2), sha256, and the command that produced it. The pretrained openWakeWord wake-word models (CC BY-NC-SA) are not used.
- [ ] **Step 7: Run it.** `cd docs/voice-lab/lab/tools && python3 export_detector.py fetch && python3 export_detector.py build` must print `parity ok`. Then on the Mac `python3 export_detector.py mac` (numpy + coremltools + Xcode) compiles `ios/Models/voice_embedding.mlmodelc` and prints `Core ML embedding == golden`.
- [ ] **Step 8: License gate.** Victor reads `MODELS.md` and approves before any later task ships these files.
- [ ] **Commit point** (Victor): script, `MODELS.md`, model files, fixture.

### Task 2: Swift core — resampler and mel frontend

**Files:**
- Create: `ios/Core/Sources/ReplayCore/Voice/Resampler.swift`, `.../Voice/MelFrontend.swift`
- Test: `ios/Core/Tests/ReplayCoreTests/VoiceKeywordTests.swift`

**Interfaces:**
- Produces `public final class Resampler { public init(fromRate: Double, channels: Int); public func process(_ interleaved: [Float]) -> [Float] }`: 16 kHz mono out; windowed-sinc low-pass at 7.2 kHz before decimation; keeps state across calls.
- Produces `public final class MelFrontend { public init(filterbank: [Float], nFft: Int, winLength: Int, hop: Int, nMels: Int); public func push(_ samples16k: [Float]) -> [[Float]] }`: input in [-1, 1], scaled ×32767 inside; returns the new mel frames (32 values each, already `/10 + 2`) for every complete hop. It keeps the 512−160 sample overlap internally, so results do not depend on how audio is split into pushes. (Task 3's `KeywordConfig` supplies these values at runtime; the tests pass them directly.)

- [ ] **Step 1: Failing tests.**
  - `testMelMatchesGolden`: decode `pcm16k`, push it in chunks of 1 600 samples; the first 100 frames equal golden `mel` within 1e-3.
  - `testResamplerBlocksAliasing`: a 12 kHz sine at 48 kHz → output RMS < 1% of the input RMS; a 1 kHz sine keeps > 95%.
  - `testResamplerStereo48kMatches16kMono`: golden audio up-sampled to 48 kHz stereo → resampled mel within 0.05 of golden on 95% of values.
  - `testSilenceAndClippingAreFinite`: zeros and a full-scale square wave produce only finite mel values.
- [ ] **Step 2:** `cd app/modules/replay-camera/ios/Core && swift test --filter VoiceKeywordTests` → FAIL (types missing).
- [ ] **Step 3: Implement** in plain Swift (no Accelerate, so ReplayCore stays platform-free and the Kotlin port is line-for-line): a radix-2 FFT of 512, the Hann(400) window centred in 512, power = re² + im², then the filterbank product. About 100 frames/s is cheap.
- [ ] **Step 4:** the same command → PASS.
- [ ] **Commit point** (Victor).

### Task 3: Swift core — config, scorer, firing rule

**Files:**
- Create: `.../Voice/KeywordConfig.swift`, `.../Voice/KeywordScorer.swift`, `.../Voice/FiringRule.swift`
- Test: `VoiceKeywordTests.swift` (same file)

**Interfaces:**
- Produces `public struct KeywordConfig: Decodable { let version: String; let sampleRate, nFft, winLength, hop, nMels, embedEvery, embedFrames, embedSize, windows, hidden, consecutive: Int; let fMin, fMax, threshold, refractorySec: Double }` (field names exactly as in `detector.json`), plus `static func load(directory: URL) throws -> (KeywordConfig, filterbank: [Float], scorer: KeywordScorer)`. It throws `KeywordModelError.missing(String)` or `.corrupt(String)` on a missing file or a wrong byte count.
- Produces `public final class KeywordScorer { public init(weights: [Float], inputSize: Int, hidden: Int) throws; public func score(_ window: [Float]) -> Double }`: window = the last 16 embeddings concatenated (1536).
- Produces `public struct FiringRule { public init(config: KeywordConfig); public mutating func feed(score: Double, at seconds: Double) -> Bool }`: true exactly when the rule fires.

- [ ] **Step 1: Failing tests.**
  - `testScoresMatchGolden`: score every 16-window run of golden `embeddings` → equals golden `scores` within 1e-4.
  - `testFiresMatchGolden`: feed golden scores at `(((j+15)*8+75)*160 + 512) / 16000` s → fire times equal golden `fires` (±0.001).
  - `testRuleNeedsTwoInARowAndRefractory`: scores `[0.96, 0.5, 0.96, 0.97, 0.99, 0.99]` at 0.08 s steps → fires once, at the 4th; then `[0.99, 0.99]` 1.0 s later → no fire; 1.6 s later → fires.
  - `testBrokenModelFolderThrows`: a `classifier.bin` 4 bytes short → `.corrupt`; no `detector.json` → `.missing`.
- [ ] **Step 2:** `swift test --filter VoiceKeywordTests` → FAIL.
- [ ] **Step 3: Implement.** The scorer is `sigmoid(W2·relu(W1ᵀx + b1) + b2)` with `vDSP_mmul`.
- [ ] **Step 4:** → PASS (Tasks 2 and 3 together).
- [ ] **Commit point** (Victor).

### Task 4: VoiceBench app

**Files:**
- Create: `docs/voice-lab/lab/ios-bench/VoiceBench.xcodeproj`, and in `docs/voice-lab/lab/ios-bench/VoiceBench/`: `VoiceBenchApp.swift`, `ContentView.swift`, `AudioCapture.swift`, `DictationEngine.swift`, `PerfSampler.swift`, `SessionStore.swift`, `Info.plist`
- Reference (not copy): `app/modules/replay-camera/ios/Core/Sources/ReplayCore/Voice/*.swift`, `ReplayCore/VoiceCommand.swift`, `app/modules/replay-camera/ios/KeywordDetector.swift` (created here first, in its Phase 2 form, so the bench and the app run the same code)
- Modify: `docs/voice-lab/.gitignore` (allow `lab/ios-bench/**` except `lab/ios-bench/VoiceBench/Data/`)
- Data (not in git, from Task 5's `prepare`): `VoiceBench/Data/voice/salvar-v1/*`, `VoiceBench/Data/voice_embedding.mlmodelc`

**Interfaces:**
- Consumes Tasks 2–3 (`Resampler`, `MelFrontend`, `KeywordConfig`, `KeywordScorer`, `FiringRule`), and `KeywordDetector` as specified in Task 6 (`init(directory: URL)` added for the bench's Data folder; `loadBundled()` for the app).
- `DictationEngine`: today's `VoiceTrigger` dictation path verbatim (pt-BR, `requiresOnDeviceRecognition`, `contextualStrings`, restart after 50 s, 2 s cooldown, `VoiceCommand.matches`), with `onCommand: (Double) -> Void`.
- `AudioCapture`: audio-only `AVCaptureSession` + `AVCaptureAudioDataOutput`, `automaticallyConfiguresApplicationAudioSession` left as Reprize leaves it; fans each `CMSampleBuffer` out to the enabled engines and to an `AVAssetWriter` (AAC, m4a).
- `PerfSampler`: every 60 s and at stop, `{t, battery (0–1, UIDevice monitoring), thermal ("nominal"|"fair"|"serious"|"critical"), cpuSec (getrusage RUSAGE_SELF user+sys), keywordStepMs (mean since last sample, nil when Novo is off)}`.
- Session file `Documents/<yyyyMMdd-HHmmss>-<kind>.json` next to its `.m4a`:
  `{"kind":"accuracy"|"noise"|"perf","engines":["dictation","keyword"],"perfEngine":"none"|"dictation"|"keyword"|null,"distance":Int|null,"speaker":String|null,"expected":Int|null,"device":String,"ios":String,"model":"salvar-v1","start":ISO8601,"durationSec":Double,"events":[{"engine":"dictation"|"keyword","t":Double,"score":Double|null}],"perf":[…PerfSampler rows],"audio":"<name>.m4a"}`. No transcripts are stored.
- UI (one screen):
  - mode picker: Acerto / Ruído / Consumo;
  - Acerto: distance 3/5/10/12, speaker text field, expected (default 6);
  - Consumo: engine picker (Só microfone / Só atual / Só novo); it stops by itself at 15:00;
  - Iniciar/Parar, and two large counters "Atual N" / "Novo N", each with a short flash and a distinct sound on its own events;
  - list of saved sessions.

  The screen stays on (`isIdleTimerDisabled`); Consumo fixes brightness at 0.5 and restores it at stop.
- `Info.plist`: microphone and speech-recognition usage texts, `UIFileSharingEnabled` and `LSSupportsOpeningDocumentsInPlace` = YES (sessions visible in Finder/Files).

- [ ] **Step 1: Build** in Xcode on Victor's iPhone after `voice_bench.py prepare` (Task 5). It installs and asks for the microphone and speech permissions.
- [ ] **Step 2: Desk check:**
  - Acerto at 1 m, say "salvar" 6 times: both counters move; the JSON has events from both engines; the m4a plays back.
  - Consumo "Só novo" for 2 min (shortened through a debug setting): 2 perf rows, `keywordStepMs` < 80.
- [ ] **Step 3: Sessions appear in Finder** (iPhone → Files → VoiceBench) and copy to `docs/voice-lab/<date>-bench/`.
- [ ] **Commit point** (Victor): the bench project (no Data).

### Task 5: `voice_bench.py` (prepare, results) and the bench protocol

**Files:**
- Create: `docs/voice-lab/lab/tools/voice_bench.py`, `docs/voice-lab/bench-protocol.md`
- Test: `docs/voice-lab/lab/tools/test_voice_bench.py` (pytest)

**Interfaces:**
- `prepare --out <bench Data dir>`: copies `salvar-v1/*` and `voice_embedding.mlmodelc` from Task 1's outputs; fails if `MODELS.md` sha256s don't match.
- `results <dir of session JSONs> [--md out.md]`:
  - accuracy: per speaker × distance, each engine's `min(events, expected)/expected`, and the extra events;
  - noise: each engine's false triggers per hour;
  - perf: per engine, battery drop per hour (from first and last rows), minutes in each thermal state, CPU seconds per minute, Novo's mean `keywordStepMs`; the "Só microfone" run is the baseline row.

- [ ] **Step 1: Failing tests:**
  - `test_accuracy_table_counts_per_engine`: two synthetic sessions (Victor 5 m: 6 keyword and 3 dictation events, expected 6) → row `Victor | 5 | 6/6 | 3/6`.
  - `test_extra_events_are_reported_not_counted`: 8 keyword events with expected 6 → `6/6 (+2)`.
  - `test_noise_rate_per_hour`: 2 dictation events in a 900 s session → 8.0/h.
  - `test_perf_battery_per_hour_and_thermal_minutes`: rows at 0, 60…900 s with battery 0.80 → 0.77 and thermal fair from 600 s → 12.0 %/h, 10 min nominal, 5 min fair.
- [ ] **Step 2:** `cd docs/voice-lab/lab/tools && python3 -m pytest test_voice_bench.py -q` → FAIL.
- [ ] **Step 3: Implement** `voice_bench.py`.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5: `bench-protocol.md`** (in Portuguese for whoever runs the test):
  - Acerto: per person, 3, 5, 10 and 12 m, 6 "salvar" each (3 normal, 3 loud), calm day; at least Victor plus 2 adult women; one session per person and distance.
  - Ruído: at least 15 min of a normal game.
  - Consumo: 15 min per engine, same place and screen, off the charger, starting from similar battery and a cool phone, rest between runs, in the order microfone → atual → novo.
- [ ] **Step 6: Field run and verdict.** Victor runs the protocol. `voice_bench.py results` → tables appended to `docs/voice-lab/2026-11-23-voice-trigger-field-test.md` ("VoiceBench" section). Victor decides whether Phase 2 starts.
- [ ] **Commit point** (Victor).

## Phase 2 — Integration into Reprize (starts after the VoiceBench verdict)

### Task 6: iOS — `KeywordDetector` and routing in `VoiceTrigger`

**Files:**
- Create: `ios/Core/Sources/ReplayCore/Voice/VoiceEngine.swift`
- Modify: `app/modules/replay-camera/ios/KeywordDetector.swift` (created in Task 4; here it gains `loadBundled()` and the Diagnóstico sink)
- Modify: `ios/VoiceTrigger.swift`, `ios/ReplayCameraModule.swift:510-526`, `ios/RemoteVoice.swift`, `ReplayCamera.podspec` (resource bundle `ReplayCameraModels` gains `Models/voice/**/*`)
- Test: `VoiceKeywordTests.swift` (routing and backlog), plus a device check

**Interfaces:**
- Produces `public enum VoiceEngine { case keyword, dictation; public static func forLocale(_ l: VoiceLocale) -> VoiceEngine }` (`.ptBR` → `.keyword`), and `public struct DropCounter` (bounded backlog: `mutating func offer(_ samples: Int) -> Bool`, `capacity` 2 s of 16 kHz audio, `dropped: Int`).
- Produces `final class KeywordDetector { static func loadBundled() -> KeywordDetector?; var onCommand: ((Double) -> Void)?; var log: ((String) -> Void)?; func consider(_ buffer: CMSampleBuffer); func consider(_ buffer: AVAudioPCMBuffer); func reset() }`. Its own serial queue; it reads the format from each buffer (`CMAudioFormatDescription` / `AVAudioFormat`) and rebuilds the `Resampler` when the format changes. The embedding goes through `MLModel` (`voice_embedding.mlmodelc`) on batches of the pending 76-frame windows.
- `VoiceTrigger.isSupported(.ptBR)` → `KeywordDetector.loadBundled() != nil` (cached); `.enUS` unchanged.
- `VoiceTrigger.needsSpeechPermission(_ l: VoiceLocale) -> Bool` → `l == .enUS`.
- Module: `Function("voiceNeedsSpeechPermission") { (locale: String) -> Bool }`.
- Diagnóstico via the existing `diag` sink: `voz: detector salvar-v1 ativo`, `voz: comando (nota 0.99)`, `voz: N trechos descartados`, `voz: modelo indisponível (…)`.

- [ ] **Step 1: Failing tests.** `testEngineForLocale` (`.ptBR` → `.keyword`, `.enUS` → `.dictation`); `testDropCounterBoundsBacklog` (offers past 32 000 samples return false and count as dropped).
- [ ] **Step 2:** `swift test --filter VoiceKeywordTests` → FAIL.
- [ ] **Step 3: Implement `VoiceEngine` and `DropCounter`, and wire `KeywordDetector`.** Then `VoiceTrigger`: `setEnabled(on, locale)` starts or stops the matching engine; switching locale while on stops the old engine before starting the new one. `consider(…)` routes to the live engine only. `RemoteVoice` keeps feeding `VoiceTrigger` as today.
- [ ] **Step 4:** `swift test` → PASS. `cd app && npx expo run:ios --device` builds.
- [ ] **Step 5: Device check.**
  - Voice on, app in Portuguese: Diagnóstico shows `voz: detector salvar-v1 ativo`, and "salvar" at 3 m saves a clip with a `voz: comando` line.
  - Switch the app to English: dictation runs as before.
  - Remote phone: "salvar" saves.
- [ ] **Commit point** (Victor).

### Task 7: Kotlin core — the same math, same fixture

**Files:**
- Create: `android/src/main/java/expo/modules/replaycamera/core/voice/{Resampler,MelFrontend,KeywordConfig,KeywordScorer,FiringRule}.kt`
- Test: `android/src/test/java/expo/modules/replaycamera/core/VoiceKeywordTest.kt` (reads `voice-golden.json` from the shared Fixtures resource dir already wired in `build.gradle:21`)

**Interfaces:** the Kotlin mirror of Tasks 2–3:
- `Resampler(fromRate: Int, channels: Int).process(pcm: FloatArray): FloatArray`
- `MelFrontend(filterbank: FloatArray, nFft: Int, winLength: Int, hop: Int, nMels: Int).push(samples: FloatArray): List<FloatArray>`
- `KeywordConfig.load(dir: File): Triple<KeywordConfig, FloatArray, KeywordScorer>` (throws `KeywordModelException`)
- `KeywordScorer.score(window: FloatArray): Double`
- `FiringRule(config).feed(score: Double, atSec: Double): Boolean`

Config field names are identical to `detector.json`.

- [ ] **Step 1: Failing tests:** the same eight tests as Tasks 2–3, with the same assertions and tolerances (`melMatchesGolden`, `resamplerBlocksAliasing`, `resamplerStereo48kMatches16kMono`, `silenceAndClippingAreFinite`, `scoresMatchGolden`, `firesMatchGolden`, `ruleNeedsTwoInARowAndRefractory`, `brokenModelFolderThrows`).
- [ ] **Step 2:** `cd app/android && ./gradlew :replay-camera:testDebugUnitTest --tests "*VoiceKeywordTest*"` → FAIL.
- [ ] **Step 3: Implement.** The FFT is a 512-point radix-2 real FFT in `core/voice/Fft.kt`. No Android APIs in `core/`.
- [ ] **Step 4:** → PASS.
- [ ] **Commit point** (Victor).

### Task 8: Android — `KeywordDetector` and routing

**Files:**
- Create: `android/src/main/java/expo/modules/replaycamera/KeywordDetector.kt`
- Modify: `VoiceTrigger.kt` (pt-BR → detector; `en-US` → ML Kit, which now resamples with the `core/voice/Resampler` instead of linear interpolation), `remote/RemoteVoice.kt`, `ReplayCameraModule.kt:378-391`
- Test: `android/src/test/java/expo/modules/replaycamera/VoiceTriggerTest.kt`

**Interfaces:**
- `class KeywordDetector(context: Context, log: (String) -> Unit) : Closeable { var onCommand: (() -> Unit)?; fun consider(buf: ByteBuffer, bytes: Int, rate: Int); fun reset() }`
  - LiteRT `Interpreter` on `assets/voice_embedding.tflite`, CPU, 1 thread.
  - Its own worker thread, with an `ArrayBlockingQueue` holding at most 2 s of audio (drops counted and logged).
  - It rebuilds the `Resampler` when `rate` changes.
- `VoiceTrigger.isSupported(locale: String): Boolean`: `"pt-BR"` → the detector loads; otherwise today's API ≥ 31 check.
- Module: `Function("isVoiceSupported") { locale: String -> VoiceTrigger.isSupported(locale) }` and `Function("voiceNeedsSpeechPermission") { _: String -> false }`. Android only needs `RECORD_AUDIO`, which `requestSpeechPermission` already checks.
- Diagnóstico: the same `voz:` lines as iOS.

- [ ] **Step 1: Failing tests** in `VoiceTriggerTest`:
  - `engineForLocale` (`"pt-BR"` → keyword, `"en-US"` → ML Kit);
  - `switchingLocaleStopsTheOldEngine`, with a fake engine factory: after `setEnabled(true,"pt-BR")` then `setEnabled(true,"en-US")`, the keyword engine is closed and only ML Kit receives audio;
  - the existing `matches` tests stay green.
- [ ] **Step 2:** `./gradlew :replay-camera:testDebugUnitTest --tests "*VoiceTriggerTest*"` → FAIL.
- [ ] **Step 3: Implement.** Inject an engine factory into `VoiceTrigger` (default: real detector and ML Kit) so the test can fake both. `RemoteVoice.set` uses `VoiceTrigger.isSupported(locale)`.
- [ ] **Step 4:** → PASS. `cd app && npx expo run:android --device` builds.
- [ ] **Step 5: Device check:**
  - an Android 11 or older phone, if one is available: voice is offered and works in Portuguese;
  - the Diagnóstico lines show up;
  - English still uses ML Kit;
  - the remote phone saves on "salvar".
- [ ] **Commit point** (Victor).

### Task 9: App — permission and support per locale

**Files:**
- Modify: `app/modules/replay-camera/src/ReplayCameraModule.ts`, `src/ReplayCamera.ts` (export `voiceNeedsSpeechPermission(locale: VoiceLocale): boolean`), `app/src/app/setup.tsx:255-380`, `app/src/app/remote.tsx` (~L165, ~L473), `app/src/app/onboarding.tsx:29`
- Test: `app/src/app/__tests__/setup.test.tsx`, `app/src/app/__tests__/remote.test.tsx` (and the module mock they use)

**Interfaces:**
- Consumes `voiceNeedsSpeechPermission` (Tasks 6 and 8). In `setup.tsx`: `speechGranted` becomes `const voiceAllowed = !voiceNeedsSpeechPermission(voiceLocale(locale)) || speech === "granted"`, and `toggleVoice` only calls `requestSpeechPermission()` when `voiceNeedsSpeechPermission(...)` is true. `remote.tsx` follows the same rule for `speechOk`. `onboarding.tsx`: `VOICE = isVoiceSupported("pt-BR")` on both platforms.

- [ ] **Step 1: Failing tests:**
  - `setup.test.tsx`: "in Portuguese, turning voice on asks no speech permission" (`voiceNeedsSpeechPermission` mocked to false → `requestSpeechPermission` not called; voice shows "Diga \"salvar\"" status);
  - "in English it still asks" (mocked true → called once);
  - `remote.test.tsx`: the same pair for the remote's voice alert.
- [ ] **Step 2:** `cd app && npx jest src/app/__tests__/setup.test.tsx src/app/__tests__/remote.test.tsx` → FAIL.
- [ ] **Step 3: Implement** as in Interfaces. No `?.`. Then search `app/src/i18n/locales/*.ts` for text about the speech-recognition permission ("reconhecimento de fala", "speech recognition"). Show it only when `voiceNeedsSpeechPermission` is true.
- [ ] **Step 4:** the same command → PASS; then `npx jest` (whole suite) → PASS; `npx tsc --noEmit` → no errors.
- [ ] **Commit point** (Victor).

### Task 10: Device budget and field check

**Files:**
- Modify: `docs/voice-lab/2026-11-23-voice-trigger-field-test.md` (new section "In the app")

- [ ] **Step 1: Battery and heat.** 15 min recording with voice on vs. 15 min with voice off, same phone and place, on one iPhone and one Android. Record battery %, thermal state from Diagnóstico, and the share of `voz: N trechos descartados`. Pass when the difference does not move the app to a hotter step and nothing was dropped at normal temperature.
- [ ] **Step 2: Field session** with the voice checklist (3/5/10 m with voice ON, then a normal game). Log hits per distance and unwanted saves. Pass when it matches the lab table in the spec within a word or two per distance and shows no unwanted save in the game.
- [ ] **Step 3: Write it up** in the report: numbers, phones, conditions.
- [ ] **Commit point** (Victor); then the PR `feat/voice-keyword-detector` is ready for review.
