# Voice Keyword Detector ("salvar", pt-BR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the dedicated "salvar" detector against today's trigger in a test app (VoiceBench, Phase 1), then put it in Reprize behind a Diagnóstico switch, iPhone only, for Portuguese on the camera and remote phones (Phase 2, revised 2026-11-25). English stays on today's engine; Android comes after the iPhone field validation.

**Architecture:** One pipeline on both platforms: 16 kHz resample → mel frames (native) → speech embedding (Core ML / LiteRT model) → small MLP classifier (weights file) → firing rule. The pure math (resampler, mel, classifier, rule, config) lives in the platform-free cores (`ReplayCore` in Swift, `core/` in Kotlin) and is pinned by one shared golden fixture. `VoiceTrigger` on each platform routes `pt-BR` to the new `KeywordDetector` and `en-US` to the old recognizer. The model files are produced by one export script from the lab.

**Tech Stack:** Swift (Accelerate/vDSP, Core ML), Kotlin (LiteRT 1.4.2, already a dependency), Expo module bridge, React Native/TypeScript (Jest), Python (lab export: numpy, torch/torchaudio, onnx, onnx2torch, coremltools, ai-edge-litert).

**Spec:** `docs/superpowers/specs/2026-11-24-voice-keyword-detector-design.md`

## Global Constraints

- pt-BR only. `en-US` keeps `SFSpeechRecognizer` (iOS) and ML Kit GenAI (Android) exactly as today.
- Pipeline numbers: 16 000 Hz; samples scaled to int16 range (×32767); mel: frames of 512 every 160 (no padding), periodic Hann(400) at samples 56…455 of the 512, real FFT, power, 32-bin filterbank from `mel_filterbank.bin` (torchaudio slaney scale + slaney norm, 60–3800 Hz), `10·log10(max(p, 1e-10))`, **no top-dB floor** (Task 1 measured it changes no word count), then `/10 + 2`; embedding every 8 mel frames from the last 76; classifier on the last 16 embeddings; fire on 2 consecutive scores ≥ 0.95; refractory 1.5 s; the existing 2 s cooldown stays.
- First classifier: `docs/voice-lab/lab/tools/models/clf_v4_M4.pkl` (1536 → 128 ReLU → 1 logistic).
- Model folder version `salvar-v1` (Phase 1 and the golden tests); Phase 2 ships `salvar-v2-rc1` (`models/clf_v8_h256_s1.pkl`, 1536 → 256 ReLU → 1 logistic). All runtime numbers come from the folder's `detector.json`, never from code constants.
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
  - Consumo: engine picker (Só microfone / Só atual / Só novo); it stops by itself at 10:00;
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
  - Consumo: 10 min per engine, same place and screen, off the charger, starting from similar battery and a cool phone, rest between runs, in the order microfone → atual → novo.
- [ ] **Step 6: Field run and verdict.** Victor runs the protocol. `voice_bench.py results` → tables appended to `docs/voice-lab/2026-11-23-voice-trigger-field-test.md` ("VoiceBench" section). Victor decides whether Phase 2 starts.
- [ ] **Commit point** (Victor).

## Phase 2 — In Reprize behind a Diagnóstico switch, iPhone only (revised 2026-11-25)

Spec: "Phase 2 revision". Store builds stay on dictation; builds with diagnostics get "Gatilho de voz: Ditado | Modelo".
The model is `salvar-v2-rc1` (`docs/voice-lab/lab/tools/build/salvar-v2-rc1/`, from `models/clf_v8_h256_s1.pkl`).
Permissions, onboarding and setup texts don't change in this phase.

### Task 6: iOS — model files, engine choice and routing in `VoiceTrigger`

**Files:**
- Create: `app/modules/replay-camera/ios/Core/Sources/ReplayCore/Voice/VoiceEngine.swift`
- Create: `app/modules/replay-camera/ios/Models/voice/salvar-v2-rc1/{detector.json,mel_filterbank.bin,classifier.bin}` (copied from the lab build; `salvar-v1` stays for the golden tests)
- Modify: `ReplayCamera.podspec` (resource bundle `ReplayCameraModels` gains the `Models/voice/salvar-v2-rc1` folder and `voice_embedding.mlmodelc`), `ios/Voice/KeywordDetector.swift` (gains `static func loadBundled(log:) -> KeywordDetector?`), `ios/VoiceTrigger.swift`, `ios/ReplayEngine.swift` (diag sink), `ios/ReplayCameraModule.swift` (new function), `docs/voice-lab/MODELS.md` (rc1 provenance, training-data credits, sha256)
- Test: `ios/Core/Tests/ReplayCoreTests/VoiceKeywordTests.swift`

**Interfaces:**
- Produces `public enum VoiceEngine: String { case dictation, keyword }` with `public static func choose(preferred: VoiceEngine, locale: VoiceLocale, keywordAvailable: Bool) -> VoiceEngine` (`.keyword` only when preferred, `.ptBR` and available; otherwise `.dictation`).
- `VoiceTrigger.preferred: VoiceEngine` (static, lock-protected, default `.dictation`) and `static func setPreferred(_ e: VoiceEngine)`, which posts a notification so every live `VoiceTrigger` (camera and `RemoteVoice`) re-applies on its own queue.
- `VoiceTrigger` keeps its public surface (`setEnabled`, `consider(CMSampleBuffer)`, `consider(AVAudioPCMBuffer)`, `onCommand`, `isEnabled`, `stop`) and gains `var log: ((String) -> Void)?`. Inside: the engine is chosen on `setEnabled` and on a preference change; `consider` feeds only the live engine; the detector is loaded once (lazily) and shared.
- Module: `Function("setVoiceEngine") { (engine: String) in VoiceTrigger.setPreferred(VoiceEngine(rawValue: engine) ?? .dictation) }`.
- Diagnóstico lines (camera phone, via `ReplayEngine.diag`): `voz: gatilho ditado` / `voz: gatilho modelo salvar-v2-rc1`; `voz: comando (modelo, nota 0.99)` / `voz: comando (ditado)`; `voz: N s de áudio descartados` (once per minute, only when N > 0); `voz: modelo indisponível (…) — usando ditado`.

- [ ] **Step 1: Failing tests** in `VoiceKeywordTests`:
  - `testEngineChoice`: (`.keyword`, `.ptBR`, true) → `.keyword`; (`.keyword`, `.enUS`, true) → `.dictation`; (`.keyword`, `.ptBR`, false) → `.dictation`; (`.dictation`, `.ptBR`, true) → `.dictation`.
  - `testCandidateModelLoadsAndFiresOnGolden`: `KeywordConfig.load(directory: ios/Models/voice/salvar-v2-rc1)` gives `version == "salvar-v2-rc1"`, `hidden == 256`; scoring the fixture's `embeddings` (16 at a time) through its scorer and `FiringRule` fires at `[2.702, 4.702]` (±0.08 s).
- [ ] **Step 2:** `cd app/modules/replay-camera/ios/Core && swift test --filter VoiceKeywordTests` → FAIL.
- [ ] **Step 3: Implement** `VoiceEngine`, copy the rc1 folder, then the routing in `VoiceTrigger` and the module function as in Interfaces. Switching engine while listening stops the old one before starting the new one; nothing may fire twice for one word.
- [ ] **Step 4:** `swift test` → PASS (all ReplayCore tests).
- [ ] **Commit point** (Victor).

### Task 7: App — the switch in Diagnóstico

**Files:**
- Create: `app/src/voice/voiceEngine.ts`
- Modify: `app/src/data/schema.ts` (prefs: `labVoiceEngine?: 'dictation' | 'keyword'`), `app/modules/replay-camera/src/{ReplayCameraModule,ReplayCamera}.ts` (`setVoiceEngine(engine: 'dictation' | 'keyword'): void`), `app/src/app/diag.tsx` (`LabSwitches` row "Gatilho de voz": Ditado | Modelo), the app's root layout (apply the choice once at start)
- Test: `app/src/voice/__tests__/voiceEngine.test.ts`

**Interfaces:**
- `voiceEngine(): 'dictation' | 'keyword'` → `'keyword'` only when `DIAGNOSTICS_ENABLED` and the pref is `'keyword'`.
- `setVoiceEnginePref(e)` saves the pref and calls `applyVoiceEngine()`; `applyVoiceEngine()` calls `camera.setVoiceEngine(voiceEngine())` and never throws (older native builds, module mocks).

- [ ] **Step 1: Failing tests:** diagnostics off + pref `'keyword'` → `'dictation'` and native gets `'dictation'`; diagnostics on + pref `'keyword'` → native gets `'keyword'`; no pref → `'dictation'`; a native call that throws is swallowed.
- [ ] **Step 2:** `cd app && npx jest src/voice` → FAIL.
- [ ] **Step 3: Implement.** No `?.`.
- [ ] **Step 4:** `npx jest src/voice` → PASS; `npx jest` → PASS; `npx tsc --noEmit` → no errors.
- [ ] **Commit point** (Victor).

### Task 8: Device check and field use

- [ ] **Step 1: Build** with diagnostics on the iPhone (`npx expo run:ios --device` with `REPRIZE_DIAGNOSTICS=1`).
- [ ] **Step 2: Desk check:** Diagnóstico → Gatilho de voz → Modelo. Record in Portuguese: `voz: gatilho modelo salvar-v2-rc1` shows; "salvar" at 3 m saves a clip with `voz: comando (modelo, nota …)`. Back to Ditado: `voz: gatilho ditado`, dictation saves as before. Switch while recording: one engine at a time, no double save. App in English with Modelo selected: dictation. Remote phone with Modelo: "salvar" saves.
- [ ] **Step 3: Field:** games with Modelo on; note unwanted saves and missed "salvar" per session. Victor decides when the model becomes the default (spec approach A, a later plan) and when Android starts.
- [ ] **Commit point** (Victor).

### Task 9: salvar-v2-rc4 as the Portuguese default, lab switch removed (2026-11-26, done)

Spec section "salvar-v2-rc4 is the Portuguese default". `VoiceEngine.choose(locale:keywordAvailable:)` and
`VoiceEngine.portugueseUsesKeyword` decide; the Diagnóstico switch and its plumbing are deleted; `salvar-v1` moved to
the test fixtures; `voice_bench.py prepare` defaults to the app's model (rc4, checked against MODELS.md).

### Later (not in this plan's scope now)

- Android: the Kotlin core and detector (the former Tasks 7–8), after the iPhone validation.
- Portuguese asking only for the microphone (the former Task 9), when the model becomes the default.
- New model versions (rc2…): a new `Models/voice/<version>/` folder and the podspec line; nothing else changes.
