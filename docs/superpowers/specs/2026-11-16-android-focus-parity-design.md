# Reprize: Modo Foco on Android as on the iPhone (Jogadores and Bola) — design

> Date: 2026-11-16. Status: **design approved by Marcus (2026-11-16); spec awaiting his review**.
> Scope: Android. The iPhone code is the reference and is not changed.
> Builds on: `2026-10-23-focus-mode-design.md` (Jogadores), `2026-11-09-follow-the-ball-design.md` (Seguir a Bola),
> `2026-11-11-focus-panel-and-recording-sport-design.md` (the Foco panel and the recording's sport).
> Material outside git: `docs/focus-refs/android-seguir-a-bola/` (Victor's handoff, 2026-11-16: the two ball models as
> ONNX with checksums, 20 labelled clips, 2 field clips, a README).

## 1. Goal

The same clip gives on Android the framing it gives on the iPhone, in both cards of the Foco panel: **Jogadores** and
**Bola** (basketball and beach tennis). The panel behaves the same while it works: the progress ring with its percent,
"Aguardando" while the phone cools, the stop button, and the "ball not found" outcome.

Product decision (Marcus, 2026-11-16): **fidelity first**. Android runs the same search as the iPhone on every phone,
and a slow phone waits longer. Faster, lighter searches are judged after the evaluation of §9, not in this delivery.

Success looks like this:
- given the same detections, the Kotlin rules produce the same framing as the Swift rules, number for number;
- the Android ball detector agrees with the ONNX models on the labelled clips;
- on the 20 labelled clips, the ball is inside the 9:16 picture about as often as in the lab's reference;
- the panel shows the same states as on the iPhone, with no Android-only screen.

Not in this delivery:
- speed shortcuts: an int8 model, motion-gated tiles (`BallMotion`), frames scaled below 1920;
- a scene classifier like Apple's (see §7);
- the gesture, the voice trigger, or anything outside Modo Foco.

## 2. What cannot be the same

Two iPhone pieces are Apple's and have no Android equal. Here the result is close, and it is measured:

1. **People**: the iPhone finds them with Vision. Android uses its own detector (§6).
2. **Sport**: the iPhone reads Apple's scene labels. Android has only the floor measure (§7).

The wait is also different. Measured on the test phone (POCO X3 NFC, Snapdragon 732G, Android 12) with the real
basketball model, one 416 px region:

| Where | ms per region |
|---|---|
| POCO X3, CPU, 4 threads | 105 |
| POCO X3, GPU, fp16 | 76 |
| POCO X3, GPU, full precision | 119 |
| iPhone XR (lab) | 9–11.5 |

At 19 regions a Full HD frame and 5 frames a second, the ball model alone costs about 7 s per second of cut on this
phone (a 10 s cut: about 72 s; the iPhone 16 Pro Max: about 4 s). This is accepted for now.

## 3. The rules in Kotlin

A direct port of the Swift core, file by file, into `android/.../replaycamera/ball/` (pure Kotlin, no Android types):

| Swift (`ios/Core/Sources/ReplayCore/`) | Kotlin |
|---|---|
| `BallDetect.swift` | regions, anchors, decode, NMS, stored candidates |
| `BallPath.swift`, `BallTrust.swift` | the ball path and its trusted points |
| `BallZoom.swift`, `BallCamera.swift` | zoom and the 9:16 camera |
| `BallSport.swift` | per-sport profiles, verdicts, the video-screen rule |
| `BallFraming.swift` | detections cache, grids, the framing file |
| `ScanTicks.swift`, `FocusFrames.swift` | which frames a pass keeps; the kept people |
| `FramingMotion.swift` | camera motion numbers for the Diagnóstico line |
| `SportFloor.swift` | the sand-floor measure |

`BallMotion.swift` is not ported: on the iPhone it is a Diagnóstico switch, off by default. Android ignores the
`motionTiles` option.

Rounding, tie-breaking and iteration order follow the Swift code exactly (as `FocusCore.kt` already does for
`FocusPath`).

**Tests.** Kotlin unit tests read the Swift fixtures in place (`ios/Core/Tests/ReplayCoreTests/Fixtures/`:
`ball-parity.json`, `ball-parity-bt.json`), added to the Android test resources by path in `build.gradle`, so there is
one copy. They assert what `BallParityTests.swift` and `BallParityBeachTennisTests.swift` assert, with the same
tolerances. Each ported file also gets the cases of its Swift test file where one exists.

## 4. The ball detector

**Models.** `ball_tiny_gym.onnx` and `ball_tiny_btpl.onnx` (YOLOX-Tiny, one class, input `[1, 3, 416, 416]` BGR 0–255,
output `[1, 3549, 6]`) are converted to TFLite by a script kept in `docs/focus-refs/tools/lab/` (`android_tflite.py`):

1. fold the shape arithmetic to constants (`onnxsim`): without this the TFLite graph has dynamic tensors and the GPU
   refuses it (found in the 2026-11-16 speed test);
2. convert (`onnx2tf`); the input becomes NHWC and the output comes out as `[1, 6, 3549]`: the Kotlin decoder reads it
   in that layout;
3. check against the ONNX on frames **with a ball** taken from the labelled clips: the same candidates at
   `score >= 0.05`, and the largest score difference reported. (The 2026-11-16 check used a tile without a ball: the
   raw outputs agreed to 1e-5, which says nothing yet about candidates.)

The `.tflite` files go in `android/src/main/assets/`, as the `.mlmodelc` are in the iOS pod. The fp16 file `onnx2tf`
writes does not load in the interpreter; the script tries fp16 weights by another route, and if none loads the fp32
files ship (20 MB each instead of 10).

**Running it.** LiteRT, a new dependency of the module. The GPU delegate in fp16 first; XNNPACK on the CPU when the
delegate cannot start. A native crash cannot be caught (the MediaPipe GPU delegate crashed the app on a test phone
before), so the module writes a "trying the GPU" mark before the first GPU run and clears it after a good one: found at
start, the mark means the app died there, and the CPU is used from then on.

**Regions and frames** as on the iPhone: the whole frame letterboxed into the top-left of a 416 square over grey 114,
then every 416 px tile (`BallDetect.regions`), at 5 frames a second, on the cut only; a frame wider than 1920 is scaled
to 1920 first (`maxWidth`). Regions are rendered from the decoded frame with bilinear scaling. Core Image's scaling is
not identical, so candidates can differ slightly from the iPhone's; §9 measures it.

**Probe.** `probeBall` times one 19-region frame, as on the iPhone (median of 3 after a warm-up).

## 5. One pass over the clip

`ClipScan.kt`: the clip is decoded once (`FrameDecoder`, MediaCodec) and each kept frame goes to the people detector,
the ball detector, or both at the same time on two threads, as `ClipScan.swift` does. `ScanTicks` decides which frames
are kept.

`BallAnalyzer.kt` follows `BallAnalyzer.swift`:
- the detections cache `<clip>.balldet.json` (keyed by model and size), written every 25 frames and whatever happens,
  so a stop, a cancel or a changed cut continues from what was found;
- the Jogadores file made in the same pass when it is missing, has no people, or does not cover the cut;
- the early "recorded too far" verdict from `playersHeight`;
- the framing into `<clip>.ball.json`, the same format (9:16 track under `portrait`, `endMs`);
- the same result fields: `status`, `reason`, `analysed`, `reused`, `ballFrames`, `trustedFrames`, `ballShare`,
  `zoom`, `elapsedMs`, `focus`, `stages`, `panP95`, `turnsPer10s`, `playSeconds`.

**Progress.** `onBallProgress` with `done`, `total` and `state`: `cooling`, `running` (every 5 frames), `framing`.

**Errors.** `CANCELLED`, `BALL_HOT`, `BALL_NO_MODEL`, `BALL_FAILED`. `BALL_INTERRUPTED` exists on the iPhone because
Vision and Core ML stop in the background; Android keeps working there, so it is raised only if the decoder or the
model fails repeatedly.

**Heat.** `PowerManager.getCurrentThermalStatus` (API 29, the app's minimum): `SEVERE` stands for the iPhone's
`serious`, `CRITICAL` and above for `critical`. Same rule: wait to start while serious or worse (showing "Aguardando"),
a cut up to 15 s starts unless critical, stop at critical keeping the detections.

One analysis at a time across both modes, as on the iPhone.

## 6. Jogadores

`FocusAnalyzer.kt` moves onto the same pass and gains what the iPhone's has:
- `peoplePath` (`<clip>.people.json`): the people of each analysed frame are kept, so a stopped analysis goes on;
- `everyMs` (200 by default from JS, the iPhone's default since 2026-11-12), with the last frame's people held to the
  end so the file keeps 100 ms rows;
- `people` and `playersHeight` in the file (Bola reads both);
- `reused`, `stages`, `panP95`, `turnsPer10s` in the result.

**Tiles.** All nine half-frame tiles on every sample, as on the iPhone, instead of one in rotation. This makes
Jogadores about five times slower on the test phone than it is today: it is what "fidelity first" asks, and §9 reports
the time.

**Detector.** EfficientDet-Lite0 stays unless a measurement says otherwise: on clips where Vision's boxes are known
(the iPhone's `samples` dumps), EfficientDet-Lite0 and a YOLOX-Tiny "person" are compared with Vision by matched boxes
and by the framing each gives. The detector changes only if the other is clearly closer.

## 7. Module, JS and export

**Module (Kotlin).** `analyzeBall`, `cancelBall`, `probeBall`, the `onBallProgress` event, the new `analyzeFocus`
options, and `classifySport`. With these the Bola card appears by itself (`isBallSupported`).

**The speed limit.** JS hides Bola when the probe's frame takes over 400 ms (`BALL_PROBE_MAX_MS`); the test phone would
take about 1,450 ms. On Android the probe is still run and recorded but does not hide the mode, until the evaluation
says what the limit should be.

**Sport.** `classifySport` on Android returns only `_floorSand` and `_floorTex` (three frames, `SportFloor`). With the
rules as they are in `sportCheck.ts`: a sand court is beach tennis by itself; otherwise the sport is not known and the
player picks it on the sport sheet. Basketball is never worked out by itself on Android.

**Export.** `ClipExporter.kt` gains `fill`: Bola's 9:16 crop fills the whole frame instead of the spot the whole video
would take, as on the iPhone. The types' "iOS only" notes are corrected.

**Credit.** The ball models were trained on public datasets under CC BY 4.0 and the app must credit them. No credit
text was found in `app/src`: where it lives (or that it is missing on both systems) is settled in the plan.

## 8. Order of delivery

1. The rules in Kotlin with the parity tests (§3).
2. The models converted and checked, the detector, the probe (§4).
3. The pass, `BallAnalyzer`, the module and the export: Bola working end to end (§5, §7).
4. Jogadores on the same pass with the nine tiles (§6).
5. The evaluation on the test phone and its report (§9).

## 9. Evaluation

The 22 clips of the handoff are analysed on the test phone through a Diagnóstico command (the sport taken from
`clips.txt`). For each clip the report gives:
- the analysis time and its stages;
- the share of labelled points with the ball inside the 9:16 crop (the 20 labelled clips), beside the same number for
  the lab's reference track (the pipeline that made the iOS fixtures);
- how far Android's rects are from the reference's.

A side-by-side with an iPhone needs exports made on the current `main`: older exports are from before lab tests 56–60
and are not a valid reference (Victor's README).

The report ends with what the shortcuts left out of this delivery would cost and save, to decide the next step.

## 10. Rules for the material

The models' ONNX files and the videos stay out of git (`docs/focus-refs` is ignored on purpose; the videos show real
people). The converted `.tflite` files are committed with the module, as the `.mlmodelc` are.
