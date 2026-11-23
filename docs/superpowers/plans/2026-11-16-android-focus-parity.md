# Modo Foco on Android as on the iPhone (Jogadores and Bola) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The same clip gives on Android the framing it gives on the iPhone in Jogadores and in Bola, with the same panel states while it works.

**Architecture:** The Swift rules (`ios/Core/Sources/ReplayCore/Ball*.swift` and friends) are ported file by file to pure Kotlin and proven against the Swift fixtures. The ball models run through LiteRT (GPU fp16, CPU fallback). One Kotlin `ClipScan` decodes the clip once and feeds the people and ball detectors; `BallAnalyzer.kt` and `FocusAnalyzer.kt` sit on it and write the same files as the iPhone. The JS panel is shared and lights up once the module exposes the ball functions.

**Tech Stack:** Kotlin, Expo Modules, MediaCodec, LiteRT (`com.google.ai.edge.litert`), MediaPipe tasks-vision (people, already there), Media3 Transformer (export), JUnit 4, Jest; Python (`onnxsim`, `onnx2tf`, `onnxruntime`) for the one-off model conversion.

**Spec:** `docs/superpowers/specs/2026-11-16-android-focus-parity-design.md`

All paths below are relative to `app/modules/replay-camera/` unless they start with `app/` or `docs/`.
`KT` = `android/src/main/java/expo/modules/replaycamera`, `KTT` = `android/src/test/java/expo/modules/replaycamera`,
`SW` = `ios/Core/Sources/ReplayCore`, `SWT` = `ios/Core/Tests/ReplayCoreTests`.

Commands:
- Kotlin unit tests: `cd app/android && ./gradlew :replay-camera:testDebugUnitTest` (`app/android` comes from `npx expo prebuild`; it is git-ignored).
- JS: `cd app && npx jest` and `npx tsc --noEmit`.
- Device: POCO X3 NFC, `adb -s 7579e535`; if `adb devices` is empty, `adb kill-server && adb start-server`.

## Global Constraints

- The iPhone code is the reference and is not changed. A port follows the Swift file line by line: same rounding (`roundTo`, half-away-from-zero where Swift's `.rounded()` is used, `.toNearestOrEven` where Swift says so), same tie-breaking, same iteration order. When Kotlin and Swift disagree, Kotlin is wrong.
- Fidelity first: every Full HD frame gets the whole frame plus every 416 px tile (19 regions), 5 frames a second, 4K scaled to 1920. No int8 model, no motion-gated tiles (`motionTiles` is ignored), no frame below 1920.
- Files and formats are the iPhone's: `<clip>.balldet.json`, `<clip>.people.json`, `<clip>.focus.json`, `<clip>.ball.json`; written to a `.tmp` and renamed, never half-written.
- Result fields, event names and error codes are the iPhone's: `onBallProgress` (`cooling` | `running` | `framing`); `CANCELLED`, `BALL_HOT`, `BALL_NO_MODEL`, `BALL_FAILED`, `BALL_INTERRUPTED`.
- Model input: `float32`, BGR, 0–255, 416×416, letterboxed top-left over grey 114. Converted model: NHWC input `[1, 416, 416, 3]`, output `[1, 6, 3549]`.
- `docs/focus-refs/android-seguir-a-bola/` (ONNX, videos) never goes to git. The converted `.tflite` files do.
- minSdk 29. Copy in pt-BR follows the existing strings; no new screen.
- Commit after every task, on `feat/android-focus-parity`, messages in the repo's style, ending with the attribution line.

## Review Focus

1. **A clip stored rotated (90°/270°) or in 4K**: regions and stored candidates must be in the upright picture, 4K scaled to 1920 before tiling. Test in Task 8.
2. **Stop, then run again**: an analysis cancelled half way and resumed must give the same `.ball.json` as one that ran through. Test in Task 9.
3. **The app dies inside the first GPU run**: the next start must use the CPU and still analyse. Test in Task 7.
4. **A cut with no ball, or no people**: `unsuitable` with a reason, or Jogadores `none`; never a crash or an empty file read as ready. Test in Task 9 and Task 10.
5. **A Jogadores file written by the old Android build** (no `people`, 1 tile, no `playersHeight`): Bola must make it again in its pass, not use it. Test in Task 9.

---

### Task 1: Ball types, `BallDetect`, and the fixtures in the Android tests

**Files:**
- Modify: `android/build.gradle` (test resources)
- Create: `KT/ball/BallTypes.kt`, `KT/ball/BallDetect.kt`
- Test: `KTT/ball/BallDetectTest.kt`

**Interfaces:**
- Produces (package `expo.modules.replaycamera.ball`):
  - `data class BallCandidate(val cx: Double, val cy: Double, val width: Double, val height: Double, val score: Double)`
  - `data class BallPoint(val cx: Double, val cy: Double, val width: Double, val height: Double, val score: Double, val area: Double)` (fields as `SW/BallPath.swift:13`)
  - `data class BallXY(val x: Double, val y: Double)`
  - `object BallMath { fun roundTo(v: Double, digits: Int): Double; fun mean(v: List<Double>): Double }` (as `BallPath.roundTo`)
  - `object BallDetect { data class Region(val x0: Int, val y0: Int, val scale: Double); data class Box(val cx: Double, val cy: Double, val w: Double, val h: Double, val score: Double); fun starts(n: Int, tile: Int, overlap: Int = 80): List<Int>; fun regions(width: Int, height: Int, side: Int, tile: Int): List<Region>; fun anchors(side: Int): List<FloatArray> /* gx, gy, stride */; fun decode(rows: Int, cls: Int, anchors: List<FloatArray>, region: Region, conf: Float = 0.05f, value: (Int, Int) -> Float): List<Box>; fun nms(boxes: List<Box>, iou: Double = 0.5): List<Box>; fun frameCandidates(boxes: List<Box>, width: Int, height: Int): List<BallCandidate> }`
  - Test helper `KTT/ball/Fixtures.kt`: `fun fixture(name: String): JSONObject` reading from the classpath.

- [ ] **Step 1: Point the Android test resources at the Swift fixtures**

In `android/build.gradle`, inside `android { }`:

```groovy
sourceSets { test { resources.srcDirs += ['../ios/Core/Tests/ReplayCoreTests/Fixtures'] } }
```

- [ ] **Step 2: Write the failing tests** in `BallDetectTest.kt`

```kotlin
@Test fun fixturesAreOnTheClasspath() { assertEquals(5, fixture("ball-parity.json").getJSONArray("cases").length()) }
@Test fun fullHdHasNineteenRegions() {
  val r = BallDetect.regions(1920, 1080, 416, 416)
  assertEquals(19, r.size)
  assertEquals(BallDetect.Region(0, 0, 416.0 / 1920.0), r[0])
  assertEquals(listOf(0, 301, 602, 902, 1203, 1504), BallDetect.starts(1920, 416))
  assertEquals(listOf(0, 332, 664), BallDetect.starts(1080, 416))
}
@Test fun aFrameSmallerThanATileHasOneStart() { assertEquals(listOf(0), BallDetect.starts(400, 416)) }
@Test fun anchorsAre3549() { assertEquals(3549, BallDetect.anchors(416).size) }
@Test fun decodeKeepsObjTimesClassAtOrOverConf() { /* one anchor (gx 1, gy 2, stride 8), value = [0.5, 0.5, 0, 0, 0.5, 0.2]: one box, cx 12.0, cy 20.0, w 8.0, h 8.0, score 0.1 at scale 1; with class 0.09: none */ }
@Test fun nmsDropsTheOverlappingLowerScore() { /* two boxes IoU > 0.5: the higher score stays; equal scores: the first stays */ }
@Test fun frameCandidatesRoundTo4And3() { /* Box(960.123456, 540.0, 20.0, 20.0, 0.123456) on 1920x1080 -> cx 0.5001, width 0.0104, score 0.123 */ }
```

(`starts` values: `k = ceil((n − 80) / 336)`, origin `i = round_half_even(i × (n − 416) / (k − 1))`; check them against `SW/BallDetect.swift:22` before trusting the literals above, and fix the literals if the Swift gives others.)

- [ ] **Step 3: Run** `./gradlew :replay-camera:testDebugUnitTest --tests '*BallDetectTest'` → FAIL (unresolved references).
- [ ] **Step 4: Implement** `BallTypes.kt` and `BallDetect.kt` from `SW/BallDetect.swift` and the type declarations in `SW/BallPath.swift:4-20`, `SW/BallTrust.swift:19`.
- [ ] **Step 5: Run** the same command → PASS.
- [ ] **Step 6: Commit** `feat(android): ball detection regions and decoding (Seguir a Bola)`.

### Task 2: `BallPath` and `BallTrust`

**Files:**
- Create: `KT/ball/BallPath.kt`, `KT/ball/BallTrust.kt`, `KT/ball/BallPlayersMath.kt` (only `BallPlayers.main` and `percentile`, which `BallPath.playArea` needs; Task 4 completes `BallPlayers` in its own file and moves these there)
- Test: `KTT/ball/BallParityTest.kt`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `class BallPathParams` with every field of `SW/BallPath.swift:22-94`, `companion { val basketball; val beachTennis }`
  - `object BallPath { fun track(frames: List<List<BallCandidate>?>, width: Double, height: Double, step: Int, params: BallPathParams = BallPathParams.basketball, people: List<List<List<Double>>> = emptyList(), screens: List<List<Double>> = emptyList(), stale: List<List<BallCandidate>?> = emptyList()): List<BallPoint?> }` plus the internal helpers the Swift tests call (`dropFlat`, `segments`, `upsample`, `playArea`, `isHead`, `isShirt`), `internal`. Parameter list and defaults exactly as `SW/BallPath.swift:104`.
  - `class BallTrustParams`; `object BallTrust { fun trusted(path: List<BallPoint?>, width: Double, height: Double, params: BallTrustParams = BallTrustParams()): List<BallXY?> }`

- [ ] **Step 1: Write the failing tests** `pathMatchesLab` and `trustedMatchesLab` in `BallParityTest.kt`: the Kotlin of `SWT/BallParityTests.swift` `testPathMatchesLab` and `testTrustedMatchesLab`, over all 5 cases of `ball-parity.json`, tolerance `1e-6`, nil-ness equal frame by frame. A `null` entry of `frames` is `JSONObject.NULL`.
- [ ] **Step 2: Run** `--tests '*BallParityTest'` → FAIL.
- [ ] **Step 3: Implement** from `SW/BallPath.swift` and `SW/BallTrust.swift`. The Viterbi keeps Swift's `Node` ordering (`k`, then `j`) wherever Swift iterates a dictionary in sorted order; where Swift iterates a `Dictionary` unsorted, find the sort it applies before use and keep it.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(android): ball path and trusted points, checked against the lab fixtures`.

### Task 3: `BallCamera` and `BallZoom`

**Files:**
- Create: `KT/ball/BallCamera.kt`, `KT/ball/BallZoom.kt`
- Test: `KTT/ball/BallParityTest.kt` (add)

**Interfaces:**
- Produces:
  - `class BallCameraParams`, `companion { basketball; beachTennis }`; `object BallCamera { fun rects(ball: List<BallXY?>, today: List<List<Double>>, width: Double, height: Double, zoom: Double, params: BallCameraParams, aim: List<Double?>? = null, …): List<List<Double>> }` — full parameter list as `SW/BallCamera.swift:44`
  - `class BallZoomParams`, `companion { beachTennis }`; `data class BallZoomResult` (fields as `SW/BallZoom.swift:30`, including `zoom` and `share`); `object BallZoom { fun zoom(ball, today, native, width, height, …): BallZoomResult; fun median(v: List<Double>): Double }` as `SW/BallZoom.swift:43`

- [ ] **Step 1: Write the failing test** `zoomAndCameraMatchLab`: `SWT/BallParityTests.swift` `testZoomAndCameraMatchLab` — zoom within `1e-9`, rect max difference under `1e-5`, 5 cases.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** from the two Swift files (`solvePenta` is a banded solve: keep the operation order, it decides the last digits).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(android): ball zoom and 9:16 camera`.

### Task 4: `BallSport` and `BallFraming.compute`

**Files:**
- Create: `KT/ball/BallSport.kt` (`BallSport`, `BallFollowParams`, `BallVerdictParams`, `BallVerdictReason`, `BallVerdict`, `BallVerdicts`), `KT/ball/BallPlayers.kt` (absorbs `BallPlayersMath.kt`), `KT/ball/BallRuns.kt`, `KT/ball/BallScreen.kt`, `KT/ball/BallFraming.kt` (`compute`, `aligned`, `Result`, the constants)
- Test: `KTT/ball/BallParityTest.kt` (add `endToEnd`), `KTT/ball/BallParityBeachTennisTest.kt`

**Interfaces:**
- Produces:
  - `class BallSport` with every field of `SW/BallSport.swift:6-39` (`id`, `modelId`, `rules`, `path`, `camera`, `zoom`, `follow`, `screens`, `verdict`, …); `companion { val basketball; val beachTennis; fun of(id: String): BallSport? }` — ids `"basquete"`, `"beachTennis"`; `modelId` `"ball_tiny_gym"`, `"ball_tiny_btpl"` (confirm in the Swift).
  - `enum class BallVerdictReason(val raw: String) { TOO_FAR("tooFar"), RARELY_FOUND("rarelyFound"), TOO_SMALL("tooSmall"), STILL("still") }`
  - `object BallVerdicts { fun before(playersHeight: Double?, width: Double, height: Double, sport: BallSport): BallVerdictReason?; fun after(…): BallVerdict }`
  - `object BallFraming { const val stepMs = 100.0; const val step = 2; data class Result(rects: List<List<Double>>, ballFrames: Int, trustedFrames: Int, zoom: BallZoomResult, verdict: BallVerdict?, …as SW/BallFraming.swift:84); fun compute(grid: List<List<BallCandidate>?>, width: Double, height: Double, today: List<List<Double>>, native: List<List<Double>>, sport: BallSport, screens: List<List<Double>>, players: Double?, people: List<List<List<Double>>>, stale: List<List<BallCandidate>?> = emptyList()): Result }`

- [ ] **Step 1: Write the failing tests**: `endToEnd` (`SWT/BallParityTests.swift` `testEndToEnd`) and every test of `SWT/BallParityBeachTennisTests.swift` (12 cases of `ball-parity-bt.json`), same names in camelCase, same tolerances.
- [ ] **Step 2: Run** `--tests '*BallParity*'` → FAIL.
- [ ] **Step 3: Implement** from `SW/BallSport.swift` and `SW/BallFraming.swift:84-180`.
- [ ] **Step 4: Run** → PASS (all `BallParity*` tests).
- [ ] **Step 5: Commit** `feat(android): Seguir a Bola rules per sport, beach tennis and basketball at parity`.

### Task 5: Caches, grids, ticks, motion numbers, the floor

**Files:**
- Modify: `KT/ball/BallFraming.kt` (JSON and grid functions)
- Create: `KT/core/ScanTicks.kt`, `KT/focus/FocusFrames.kt`, `KT/core/FramingMotion.kt`, `KT/core/SportFloor.kt`
- Test: `KTT/ball/BallFramingTest.kt`, `KTT/core/ScanTicksTest.kt`, `KTT/core/SportFloorTest.kt`, `KTT/focus/FocusFramesTest.kt`

**Interfaces:**
- Produces:
  - `BallFraming`: `data class Detection(val tMs: Double, val candidates: List<BallCandidate>, val stale: List<BallCandidate> = emptyList())`; `fun rows(startMs, endMs): Int`; `fun phase(startMs, endMs, cached: List<Detection>): Int`; `fun missingTicks(startMs, endMs, phase, cached): List<Double>`; `fun grids(startMs, endMs, phase, detections): Pair<List<List<BallCandidate>?>, List<List<BallCandidate>?>>` (candidates, stale); `fun detectionsJSON(dets, width: Int, height: Int, model: String, screens: List<List<Double>>): JSONObject`; `fun detections(json: JSONObject?, width: Int, height: Int, model: String): List<Detection>`; `fun screens(json: JSONObject?): List<List<Double>>`; `fun framingJSON(r: Result, startMs: Double, width: Double, height: Double, rules: String): JSONObject`
  - `object ScanTicks { fun ticks(startMs, endMs, everyMs): List<Double>; fun missing(ticks, have, windowMs): List<Double>; class Cursor(ticks: List<Double>, windowMs: Double) { val done: Boolean; fun take(tMs: Double): Boolean }; fun span(people, peopleWindowMs, ball, ballWindowMs): Pair<Double, Double>? }`
  - `object FocusFrames { fun json(frames: List<FocusSample>, width: Int, height: Int): JSONObject; fun read(json: JSONObject?, width: Int, height: Int): List<FocusSample>; fun merged(old, new): List<FocusSample> }`
  - `object FramingMotion { fun stats(rects: List<List<Double>>, stepMs: Double): Pair<Double, Double> /* panP95, turnsPer10s */ }`
  - `object SportFloor { data class Measure(val sand: Double, val texture: Double); const val width = 320; fun measure(rgba: ByteArray, width: Int, height: Int): Measure?; fun median(v: List<Double>): Double }`

- [ ] **Step 1: Write the failing tests**: the Kotlin of `SWT/BallFramingTests.swift`, `SWT/ScanTicksTests.swift`, `SWT/SportFloorTests.swift` (same pictures from the same LCG seed 12345, same thresholds), plus:

```kotlin
@Test fun aCacheForAnotherModelOrSizeIsEmpty() { /* detectionsJSON(model "ball_tiny_gym", 1920x1080) read with "ball_tiny_btpl", or with 1280x720: emptyList() */ }
@Test fun peopleKeptRoundTrip() { /* FocusFrames.read(JSONObject(FocusFrames.json(frames, 1920, 1080).toString()), 1920, 1080) == frames; read(..., 1280, 720) == emptyList() */ }
@Test fun mergedPrefersTheNewFrameAtTheSameTime() { }
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** from the Swift files. **Step 4: Run** → PASS; then the whole suite (`testDebugUnitTest`) → PASS, `FocusCoreTest` included.
- [ ] **Step 5: Commit** `feat(android): detections cache, scan ticks, kept people and the floor measure`.

### Task 6: The models as TFLite

**Files:**
- Create: `docs/focus-refs/tools/lab/android_tflite.py`
- Create: `android/src/main/assets/ball_tiny_gym.tflite`, `android/src/main/assets/ball_tiny_btpl.tflite`
- Modify: `docs/focus-refs/tools/lab/README.md` (a short section: how they were made, the check's numbers, the files' SHA256)

**Interfaces:**
- Produces: assets named `<modelId>.tflite`; input `[1, 416, 416, 3]` float32 BGR 0–255; output `[1, 6, 3549]` float32 (row `c`, anchor `i`: value `(i, c)`).

- [ ] **Step 1: Write `android_tflite.py`** with two commands:
  - `convert <onnx> <out.tflite>`: `onnxsim.simplify` → `onnx2tf` → the float32 file; then try fp16 weights (TF converter with `target_spec.supported_types = [float16]` from the SavedModel `onnx2tf -osd` writes) and keep the fp16 file only if `ai_edge_litert` loads it **and** the check below passes with it; print which was kept and its size. Fails if the result has any tensor with a dynamic shape.
  - `check <onnx> <tflite> <clips.txt> [--frames 40]`: for each clip of that model's sport, frames at the labelled times (`<clip>.ball.json` `samples`), the 416 tile centred on the labelled ball and the letterboxed whole frame, through both models; prints per model: frames, candidates at `score >= 0.05` in ONNX and in TFLite, how many match (IoU ≥ 0.9), largest score difference. Exit 1 unless every ONNX candidate with score ≥ 0.1 has a match and the largest score difference is under 0.02.
- [ ] **Step 2: Run** both commands for both models (venv with `onnx onnxsim onnx2tf tensorflow tf_keras onnxruntime ai-edge-litert opencv-python`), from `docs/focus-refs/android-seguir-a-bola/`. Expected: `check` exits 0 for both. If fp16 fails the check, the fp32 files ship.
- [ ] **Step 3: Copy** the two files into `android/src/main/assets/`, write the README section.
- [ ] **Step 4: Commit** `feat(android): the ball models as TFLite, checked against the ONNX` (the assets, the script, the README).

### Task 7: The detector on the phone, and the probe

**Files:**
- Modify: `android/build.gradle` (LiteRT: `com.google.ai.edge.litert:litert` and `:litert-gpu`, the latest stable; check Maven Central for the version and that it builds beside `com.google.mediapipe:tasks-vision:0.10.26`)
- Create: `KT/ball/BallDetector.kt`, `KT/ball/RegionRender.kt`
- Modify: `KT/ReplayCameraModule.kt` (`probeBall`), `app/plugins/withAndroidKeepRules.js` if R8 needs keep rules for LiteRT
- Test: `KTT/ball/RegionRenderTest.kt`

**Interfaces:**
- Consumes: `BallDetect` (Task 1), the assets (Task 6).
- Produces:
  - `object RegionRender { fun fill(frameArgb: IntArray, frameW: Int, frameH: Int, region: BallDetect.Region, tile: Int, side: Int, out: FloatBuffer) }` — writes `side × side × 3` floats, B, G, R, 0–255, grey 114 where the picture does not reach; region 0 = whole frame scaled by `region.scale` (bilinear) into the top-left; a tile = `tile × tile` px from `(x0, y0)` scaled by `side / tile`.
  - `class BallDetector(context: Context, val modelId: String) : Closeable { val backend: String /* "gpu" | "cpu" */; var lastPrepMs: Double; var lastModelMs: Double; fun detect(frameArgb: IntArray, width: Int, height: Int, regions: List<BallDetect.Region>): List<BallDetect.Box> }`; throws `BallDetector.NoModel` when the asset is missing.
  - GPU mark: `SharedPreferences("reprize.ball")`, key `gpuTrying` (set before the first GPU inference of the process, cleared after it returns) and `gpuBad` (set at construction when `gpuTrying` is found set). `gpuBad` → CPU (XNNPACK, 4 threads).
  - Module: `AsyncFunction("probeBall")`: a grey 1920×1080 frame, 19 regions, one warm-up, the median of 3 runs in ms; rejects `BALL_NO_MODEL` / `BALL_FAILED`.

- [ ] **Step 1: Write the failing tests** in `RegionRenderTest.kt` (plain JVM, no Android types):

```kotlin
@Test fun aTileIsCopiedPixelForPixelAsBgr() { /* 832x416 frame, region (416, 0, 1.0): out[0..2] == B,G,R of frame pixel (416, 0) */ }
@Test fun theWholeFrameSitsTopLeftOverGrey() { /* 1920x1080 solid colour, region 0: rows 0..233 the colour, row 234 onward 114f in all channels */ }
@Test fun aTileAtTheEdgeOfASmallFrameIsPaddedWithGrey() { /* 300x300 frame, tile 416: beyond column 299 and row 299, 114f */ }
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `RegionRender`. **Step 4: Run** → PASS.
- [ ] **Step 5: Implement `BallDetector`**: one interpreter per model, batch 1, one inference per region reusing the input buffer; output read once into a `FloatArray` and decoded with `BallDetect.decode(rows = 3549, cls = 0, …) { i, c -> out[c * 3549 + i] }`. GPU delegate with precision loss allowed; any exception creating it → CPU.
- [ ] **Step 6: Device check** (Review Focus 3). Build the dev app (`cd app && npx expo run:android --device`), then in Diagnóstico run the probe twice. Expected in logcat (tag `ReprizeBall`): `backend=gpu`, a probe near 19 × 76 ms ≈ 1.4–1.6 s. Then `adb shell run-as app.reprize.dev` is not needed: set the mark by a debug-only Diagnóstico row "Simular falha da GPU" that writes `gpuTrying = true` and kills the process; start again and probe: expected `backend=cpu` and a probe near 2 s.
- [ ] **Step 7: Commit** `feat(android): ball detector on LiteRT (GPU, CPU fallback) and the speed probe`.

### Task 8: `ClipScan` — one pass over the clip

**Files:**
- Modify: `KT/focus/FrameDecoder.kt` (tick-driven, two sizes)
- Create: `KT/focus/ClipScan.kt`, `KT/focus/PeopleDetector.kt` (the MediaPipe detector and the tile loop, moved out of `FocusAnalyzer.kt`)
- Test: `KTT/focus/ClipScanPlanTest.kt`

**Interfaces:**
- Consumes: `ScanTicks`, `BallDetector`, `BallDetect`, `BallFraming.Detection`, `BallScreen`.
- Produces:
  - `FrameDecoder(path, fromMs, toMs, rotation)` with `fun run(cancelled: () -> Boolean, want: (ptsMs: Double) -> Boolean, onFrame: (ptsMs: Double, frame: DecodedFrame) -> Boolean)`; `class DecodedFrame { fun upright(longSide: Int): Bitmap /* ARGB_8888, upright, scaled so the long side is at most longSide; 0 = native */ }`. Only frames `want` accepts are converted.
  - `class PeopleDetector(context: Context, tilesPerSample: Int = 9) : Closeable { fun detect(frame: Bitmap, index: Int): List<FocusBox> }` — whole frame at long side 1280 plus `tilesPerSample` tiles, merged, as today's `FocusAnalyzer.detect`.
  - `object ClipScan { class Stages { var decode, people, prep, model, path: Double; var regions, ballFrames: Int; fun json(): Map<String, Any> }; class Video(val path: String, val width: Int, val height: Int, val rotation: Int, val durationMs: Double) { companion { fun load(clipPath: String): Video } }; class BallJob(val ticks: List<Double>, val detector: BallDetector, val width: Int, val height: Int, val thumbnails: Boolean); class Found(val people: FocusSample?, val ball: BallFraming.Detection?, val thumbnail: Thumb?); class Thumb(val pixels: ByteArray, val width: Int, val height: Int); class Cancelled : Exception(); class Unreadable(m: String) : Exception(m); class Hot : Exception(); class Interrupted : Exception(); fun ballSize(width: Int, height: Int, maxWidth: Int): Pair<Int, Int>; fun run(context: Context, video: Video, people: List<Double>, peopleWindowMs: Double, ball: BallJob?, sideBySide: Boolean, stages: Stages, cancelled: () -> Boolean, critical: () -> Boolean, each: (Found) -> Unit) }`
  - `ballSize`: `maxWidth > 0 && max(W, H) > maxWidth` → both sides scaled by `maxWidth / max(W, H)` and rounded to even (`round(v × scale / 2) × 2`); else `(W, H)`.

- [ ] **Step 1: Write the failing tests** in `ClipScanPlanTest.kt`:

```kotlin
@Test fun fullHdIsNotScaled() { assertEquals(Pair(1920, 1080), ClipScan.ballSize(1920, 1080, 1920)) }
@Test fun fourKIsScaledTo1920() { assertEquals(Pair(1920, 1080), ClipScan.ballSize(3840, 2160, 1920)) }
@Test fun aPortrait4KClipKeepsItsShape() { assertEquals(Pair(1080, 1920), ClipScan.ballSize(2160, 3840, 1920)) }
@Test fun zeroMeansNative() { assertEquals(Pair(3840, 2160), ClipScan.ballSize(3840, 2160, 0)) }
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `ballSize`, then `ClipScan.run` after `ios/ClipScan.swift:137-300` without the motion gate: the decoder reads `span ± 50 ms`; a frame both lists want with `sideBySide` runs the people detector on a second thread while the ball detector runs on this one; `critical()` is asked before each ball frame (→ `Hot`); 5 ball failures making over 10% of ball frames → `Interrupted`; people failures over 10% → `Interrupted`. The thumbnail is `BallScreen.thumbWidth` px wide, the mean of R, G, B. `Video.load` reads width, height, rotation and duration with `MediaMetadataRetriever` and returns the **upright** size.
- [ ] **Step 4: Run** unit tests → PASS.
- [ ] **Step 5: Device check** (Review Focus 1): a temporary Diagnóstico row runs `ClipScan` on `bt-own-a-01.mp4` pushed to the app's files (ball ticks every 200 ms, basketball model is fine here) and logs frame count and regions per frame. Expected: 54 ball frames for 10.7 s, `regions` 19.0. Repeat with one of Marcus's own portrait clips: `regions` 19.0 and candidates' `cx`, `cy` inside 0..1 in the upright picture. Remove the row before committing.
- [ ] **Step 6: Commit** `feat(android): one pass over a clip for the people and ball detectors`.

### Task 9: `BallAnalyzer` and the module's ball functions

**Files:**
- Create: `KT/ball/BallAnalyzer.kt`, `KT/core/Heat.kt`
- Modify: `KT/ReplayCameraModule.kt` (`AnalyzeBallOptions` record with the fields of `ios/ReplayCameraModule.swift:88-110`; `analyzeBall`, `cancelBall`; `onBallProgress` in `Events`)
- Test: `KTT/ball/BallAnalyzerPlanTest.kt`, `KTT/core/HeatTest.kt`

**Interfaces:**
- Consumes: Tasks 4, 5, 7, 8; `FocusAnalyzer.write` (Task 10 — until then Bola calls a stub that returns `"none"`; Task 10 replaces it).
- Produces:
  - `object Heat { enum class Level { NOMINAL, SERIOUS, CRITICAL }; fun level(thermalStatus: Int): Level /* PowerManager.THERMAL_STATUS_SEVERE (3) -> SERIOUS; >= CRITICAL (4) -> CRITICAL */; fun mustWait(level: Level, shortCut: Boolean): Boolean /* shortCut: only CRITICAL waits */ }`
  - `object BallAnalyzer { const val shortCutMs = 15_000.0; const val modelSide = 416; const val tileSide = 416; class Players(val startMs: Double = 0.0, val endMs: Double = 0.0, val everyMs: Double = 100.0, val peoplePath: String = ""); class Outcome(ready, analysed, reused, ballFrames, trustedFrames, ballShare, zoom, elapsedMs, verdict: String, focus: String, stages: ClipScan.Stages, panP95, turnsPer10s, playSeconds); var emit: ((clipPath: String, done: Int, total: Int, state: String) -> Unit)?; fun cancel(clipPath: String); fun analyze(context, clipPath, startMs, endMs, detPath, outPath, focusPath, sport: BallSport, maxWidth: Int, players: Players, sideBySide: Boolean): Outcome; internal fun covers(file: JSONObject, startMs: Double, endMs: Double): Boolean; internal fun plan(…): Plan }`
  - `Plan`: what one run will do, decided before any frame is read — `makeFocus: Boolean`, `detModel: String` (`modelId`, or `"$modelId@$maxWidth"` when scaled), `phase: Int`, `missing: List<Double>`, `total: Int`, `reused: Int`, `peopleTicks: List<Double>`.
  - Module result map keys: `status` (`"ready"` | `"unsuitable"`), `reason`, `analysed`, `reused`, `ballFrames`, `trustedFrames`, `ballShare`, `zoom`, `elapsedMs`, `focus`, `stages`, `panP95`, `turnsPer10s`, `playSeconds`. `status` is `unsuitable` when `verdict` is not empty (as `ios/ReplayCameraModule.swift:112-128`).

- [ ] **Step 1: Write the failing tests**

```kotlin
// HeatTest
@Test fun severeIsSeriousAndCriticalIsCritical() { }
@Test fun aShortCutStartsWhileSerious() { assertFalse(Heat.mustWait(Heat.Level.SERIOUS, shortCut = true)); assertTrue(Heat.mustWait(Heat.Level.SERIOUS, shortCut = false)); assertTrue(Heat.mustWait(Heat.Level.CRITICAL, shortCut = true)) }
// BallAnalyzerPlanTest
@Test fun aFocusFileWithoutPeopleIsMadeAgain() { /* {"v":1,"startMs":0,"stepMs":100,"portrait":[…]} (the old Android file): plan.makeFocus == true */ }
@Test fun aFocusFileForAnotherCutIsMadeAgain() { /* people rows 0..5000 ms, cut 8000..12000: covers == false */ }
@Test fun aFocusFileCoveringTheCutIsUsed() { /* rows 0..12000, cut 2000..8000: covers == true, makeFocus == false */ }
@Test fun cachedDetectionsAreNotAnalysedAgain() { /* cut 0..10000, cache holds every tick 0..4800: missing == ticks 5000..9800, reused == 25, total == 50 */ }
@Test fun aResumedRunFramesLikeAnUninterruptedOne() { /* a fixture case's candidates as Detections: compute over all of them == compute over (first half read back from detectionsJSON) + (second half) */ }
@Test fun noBallAtAllIsUnsuitableNotACrash() { /* a bt fixture case with every frame's candidates emptied: Result.verdict.reason != null, rects not empty */ }
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** after `ios/BallAnalyzer.swift:109-300`: the early `tooFar` verdict, `waitUntilCool` (2 s sleeps, cancellable, `cooling` emitted once), the detector kept between runs and swapped when the sport's model changes, cache written every 25 found frames and in a `finally`, `running` emitted every 5 frames, `framing` at the end, `todayRows` / `peopleRows` / `playersHeight` read from the Jogadores file, `endMs` added to the framing file. One analysis at a time across both modes: `BallAnalyzer` and `FocusAnalyzer` synchronise on one shared lock (`ClipScan.lock`). Each analysis on its own thread at priority 5, as `analyzeFocus` does.
- [ ] **Step 4: Run** → PASS, whole suite.
- [ ] **Step 5: Device check** (Review Focus 2, 4): on the dev app open a basketball clip, pick the sport, tap Bola. Expected: the ring counts up, the 9:16 framing plays when done. Tap Bola on another clip, stop at about 50%, tap again: it starts near 50%. Compare the two `.ball.json` of one clip analysed in one go and in two (pull with `adb`): identical.
- [ ] **Step 6: Commit** `feat(android): Seguir a Bola analysis (cache, heat rule, progress) and its module API`.

### Task 10: Jogadores on the same pass

**Files:**
- Modify: `KT/focus/FocusAnalyzer.kt` (rewritten over `ClipScan`), `KT/ReplayCameraModule.kt` (`AnalyzeFocusOptions`: `peoplePath: String = ""`, `everyMs: Double = 100.0`; result adds `reused`, `stages`, `panP95`, `turnsPer10s`)
- Test: `KTT/focus/FocusFileTest.kt`

**Interfaces:**
- Produces: `object FocusAnalyzer { const val stepMs = 100.0; fun cancel(clipPath: String); fun analyze(context, clipPath, startMs, endMs, outPath, peoplePath: String, debug: Boolean, everyMs: Double): Outcome; fun inRange(frames: List<FocusSample>, startMs: Double, endMs: Double): List<FocusSample>; fun write(frames: List<FocusSample>, startMs: Double, endMs: Double, everyMs: Double, width: Double, height: Double, outPath: String, debug: Boolean): Pair<Boolean, List<FocusRect>> }` — `write` is what Bola's pass calls (Task 9's stub goes away).

- [ ] **Step 1: Write the failing tests** (`write` into a temp file, read back):

```kotlin
@Test fun theFileHasPeopleRowsAndTheMedianHeight() { /* 3 frames with boxes of height 0.2, 0.3, 0.4: "playersHeight" == 0.3, "people" has one row per 100 ms sample, 4 decimals */ }
@Test fun at200MsTheLastPeopleAreHeldToTheEnd() { /* frames at 0, 200, 400 with everyMs 200, endMs 600: 6 rows, rows 4 and 5 equal */ }
@Test fun rulesAndStepAreTheIPhones() { /* "rules" == "v15-acao-zoom110", "stepMs" == 100.0, "v" == 1 */ }
@Test fun tooFewPeopleGivesEmptyTracksAndNotReady() { /* no boxes at all: Pair(false, emptyList()), "landscape" and "portrait" empty arrays, "people" present */ }
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** after `ios/FocusAnalyzer.swift`: the kept people read first, only the missing ticks scanned, kept every 25 frames and in a `finally`; `ClipScan.run` with `ball = null`; `PeopleDetector(tilesPerSample = 9)`. `STEP_MS = 200` and `TILES_PER_SAMPLE = 1` go away.
- [ ] **Step 4: Run** → PASS, `FocusCoreTest` still green.
- [ ] **Step 5: Device check**: Jogadores on a clip; stop half way, tap again: it resumes. Note the time for the report (expected: about five times today's).
- [ ] **Step 6: Commit** `feat(android): Jogadores on the shared pass, nine tiles, kept people and the fields Bola reads`.

### Task 11: JS, sport, export and the credit

**Files:**
- Modify: `app/src/focus/appBallQueue.ts` (`ballAvailable`), `KT/ReplayCameraModule.kt` (`classifySport`), `KT/ClipExporter.kt` (`fill`), `src/ReplayCamera.ts` and `src/ReplayCamera.types.ts` (comments that say "iOS only"), the Diagnóstico screen `app/src/app/diag.tsx` (the GPU row of Task 7 stays, debug only)
- Test: `app/src/focus/__tests__/ballAvailable.test.ts`, `KTT/ExportFillTest.kt`

**Interfaces:**
- Produces:
  - `ballAvailable()`: on Android, `true` whenever `isBallSupported()` and `ballProbeMs !== Number.MAX_SAFE_INTEGER` (no model); iOS unchanged (`<= BALL_PROBE_MAX_MS`).
  - `classifySport(clipPath, startMs, endMs): Map<String, Double>` on Android: frames at 20%, 50%, 80% of the range, long side 1280, each scaled to 320 wide; `_floorSand` (median, 3 decimals) and `_floorTex` (median, 2 decimals); empty when no frame decodes.
  - `ClipExporter`: `FocusOption.fill: Boolean = false`; `internal fun fillScale(rectW: Double, rectH: Double, videoW: Int, videoH: Int, outW: Int, outH: Int, fill: Boolean): Pair<Float, Float>` — the scale that makes the cropped picture cover the whole output when `fill`, or fit as today when not.

- [ ] **Step 1: Write the failing tests**

```ts
// ballAvailable.test.ts
it('shows Bola on Android whatever the probe took', () => { /* Platform.OS android, ballProbeMs 1450 -> true */ });
it('hides Bola on Android without the model', () => { /* ballProbeMs Number.MAX_SAFE_INTEGER -> false */ });
it('keeps the 400 ms limit on iOS', () => { /* ios, 401 -> false; 400 -> true */ });
```

```kotlin
// ExportFillTest
@Test fun aNineBySixteenCropFillsANineBySixteenFrame() { /* rect 0.3164 x 1.0 of 1920x1080 into 1080x1920, fill: the picture covers 1080x1920 exactly */ }
@Test fun withoutFillTheCropKeepsTheVideosSpot() { /* same rect, fill false: today's numbers */ }
```

- [ ] **Step 2: Run** `npx jest ballAvailable` and the Kotlin test → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx jest` (all), `npx tsc --noEmit`, `npx expo lint` → clean.
- [ ] **Step 5: The credit.** `grep -rn -i "roboflow\|CC BY" app/src app/app.json docs/superpowers` to find where the iPhone credits the datasets. If there is a place, make sure Android shows it. If there is none on either system, do not invent the text: stop and ask Marcus where it should go and what it should say (Victor's README: public Roboflow datasets, CC BY 4.0).
- [ ] **Step 6: Device check**: export a Bola clip from the dev app and open the file: 9:16, the picture fills the frame, the watermark in its corner. On a beach tennis recording made on sand with no sport chosen, open a clip: the sport chip says beach tennis by itself.
- [ ] **Step 7: Commit** `feat(android): Bola shown on Android, the floor as the sport check, 9:16 export that fills the frame`.

### Task 12: Evaluation on the test phone

**Files:**
- Create: `docs/focus-refs/tools/lab/android_eval.py`
- Modify: `app/src/app/diag.tsx` (a row "Avaliar clipes (Android)", `DIAGNOSTICS_ENABLED` only), `docs/focus-refs/tools/lab/README.md` (the results)
- Create: `docs/superpowers/reports/2026-11-android-focus-parity.md` (the report, pt-BR, for Marcus and Victor)

**Interfaces:**
- The Diagnóstico row: reads `<app files>/eval/clips.txt` (Victor's format), runs `analyzeBall` on each clip with its sport (which makes the Jogadores file in the same pass), then `analyzeFocus`, writes `<name>.result.json` (both results) beside each clip.
- `android_eval.py push` (adb push of the 22 clips and `clips.txt` into the dev app's files), `pull`, and `report`: per clip the analysis time and stages, the share of labelled points inside the 9:16 rect at their time, the same number for the reference track made by the lab pipeline on the Mac from the ONNX (`ball_detect.py` + `ball_parity.py`), and the mean and worst distance between Android's rect centres and the reference's.

- [ ] **Step 1: Write** the script and the row. **Step 2: Run** the 22 clips on the POCO X3, plugged in, screen on; note the phone's heat state before and after.
- [ ] **Step 3: People detectors** (spec §6): for the clips with an iPhone `samples` dump, compare EfficientDet-Lite0 with Vision (matched boxes at IoU ≥ 0.5, and the Jogadores rects each gives); do the same with a YOLOX-Tiny "person" (COCO class 0, through `android_tflite.py`) only if EfficientDet's framing differs from Vision's by more than the two iPhones differ from each other in the lab. No dump at hand → ask Marcus to export them from the iPhone (`debug: true`), and report this step as pending.
- [ ] **Step 4: Write the report**: one table per sport (time, ball inside the picture: Android / reference, rect distance), Jogadores' time before and after the nine tiles, the GPU/CPU backend used, heat, and what each shortcut left out (int8, motion tiles, 1280 frames) would be expected to save, to decide the next step.
- [ ] **Step 5: Commit** `docs: Modo Foco no Android, avaliação no POCO X3` (script, row, README, report; no videos).
