# Focus pipeline: analysis and improvement plan (Stage 1)

Date: 2026-11-12. Decisions: Victor. Analysis: Claude. Stage 1 = analysis and plan only; no app code was changed.
Checked once by a reviewer with fresh context against the request, the code, the logs and the sources; its findings
are applied (export time, TennisCut facts, per-clip results and thumbnail size for motion gating, ranges on estimates).
Stage 2 (Victor picked I1, I2, I3, with I5 first) is built: section 9 has what was done and the before / after
numbers, section 10 the phone protocol, section 11 the answer on the ball-detection approach.

How to read the evidence tags used everywhere below:

| Tag | Meaning |
|---|---|
| `[code]` | read in the repository at commit `c19cbf2` (main) |
| `[phone]` | measured on the iPhone, from the app's Diagnóstico logs in `docs/focus-refs/raw-dump/2026-11-11-4k` and `2026-11-12-speedtest` |
| `[bench]` | measured on the iPhone with FocusBench (`docs/focus-refs/lab/tests/ios/soak.*.json`) |
| `[lab]` | measured in the lab on labelled clips (Mac / cloud CPU); the lab has been more generous than the phone |
| `[estimate]` | derived by me from the numbers above; not measured directly |
| `[assumption]` | my reading; no measurement and no source |

Related documents, not repeated here: `docs/focus-refs/tools/lab/README.md` (tests 1–53),
`docs/superpowers/plans/2026-11-12-4k-analysis-speed-test-plan.md` (results log, decisions of 2026-11-12).

---

## 0. Recommendation: the first three to build

**1. One analysis pass per clip, scoped to the cut, shared by Jogadores and Bola** (section 3, I1).
Today the two modes are two separate analyzers, two queues, two video decodes and two caches; Bola cannot start before
a full Jogadores pass has finished, and Jogadores analyses the clip's whole `bounds` even when the cut is a third of it
`[code]`. Rebuild both around one frame source (one `AVAssetReader` pass, frames handed to the people detector and the
ball detector on the same 200 ms ticks), one per-tick cache for both kinds of detections, and one heat policy.
Why first: it is where the waiting time of the differentiating feature goes, it is the change every later one plugs
into, and it removes code instead of adding it. A 15 s 4K cut costs 5.1 s of Jogadores and 5.4 s of Bola `[phone]`,
~10.5 s one after the other `[estimate]`. The only wall-clock reading is worse: 13 s from opening the clip to Bola
done, three times, in the 2026-11-12 speed-test build, which ran Jogadores twice (that build still started it on
opening) `[phone]`; today's code has no such reading. Expected `[estimate]`: Bola-first 10.5 s → about 9 s if the two
detectors run one after the other on each frame, → about 6 s at best if Vision and Core ML run side by side. The
speed-test log gives a first hint that they can: Bola took 5.4–5.8 s while a Jogadores pass overlapped it for about
3 s, against 5.0–5.1 s alone `[phone]`. Jogadores on a 30 s clip cut to 10 s: about 10 s → 3.4 s for the cut alone (a
10 s clip measured 3.4 s `[phone]`), about 4.8 s with a 2 s margin on each side; a changed cut re-analyses only the
new ticks.

**2. Bola: run only the tiles where the picture changed** (I2).
The detector is about 70% of Bola's time on the 16 Pro Max (per-region times `[bench]`, the share `[estimate]`; the XR
has bench numbers only), and its cost is linear in the regions per frame. The camera is on a tripod, so a ball in play
should change the picture where it is: in the lab 99.4–100% of the labelled ball points lay in a tile that changed
`[lab]`. (Test 4 showed that motion alone cannot find the ball; here motion only chooses the tiles the detector looks
at.) New lab measurement
made for this plan (section 6): running a tile only when its picture changed, and carrying the last
candidates of the tiles that did not, cuts the regions from 19 to 9–11 per frame with **no loss of the detector's
ceiling on 39 labelled clips (1,342 ball points)**; the ball path is identical on basketball; on Victor's two beach tennis
arenas the set scores hold (precision equal, cover −0.3 on B) while single clips move (ball-mode share 78 → 100% on
one clip and 90 → 71% on another); the 4K night set loses 2 points of precision / 1 of cover, from two clips, and one
of them passes the ball gate with motion gating when it did not before, at lower precision (91 → 77%) `[lab]`. So it is
fast and safe at the detector, and still needs the path gates before the app. What the phone must compute is one grey
thumbnail 640 px wide per analysed frame, compared with the analysed frames before and after it; the 160 px thumbnail
the beach tennis screen rule already makes is too small (detector ceiling 89.6 → 57.8% on the night set) `[lab]`.
Expected on the phone `[estimate]`: Bola ~1.6x faster, before the thumbnail's own cost, and the Neural Engine busy
about half as long per clip. Unlike the tiles-around-the-path idea of tests 19 and 32, the choice of tiles does not
depend on where the path thinks the ball is, so it cannot lock on a wrong object (the carried candidates can still
change which one the path picks, as the night clip shows). Build it inside the loop of item 1.

**3. Recording under heat: slow down before restarting, never lose the buffer, and measure where the recording's
energy goes** (I3).
The recording is the long, hot part of a game (65 → 50% in 37 min at 4K30, read in 5% steps 13 min apart, so about
23% per hour and no finer than that `[phone]`); an analysis is seconds.
Today the first reaction to heat (`serious` held 120 s → 1080p30) closes the writer and clears the 60 s ring, so the
step that protects the recording throws away the play that was in the buffer `[code]`. The camera's frame rate can be
lowered on a running session with no restart (Apple TN2445; the app already does it for the setup preview `[code]`),
and the app does not read the camera's own pressure signal (`AVCaptureDevice.systemPressureState`), for which Apple
recommends frame-rate throttling. Build: (a) throttle 60 → 30 fps on the running session as the first step (for the
default 1080p60 that is all the ladder's first step asks for, so that restart goes away; 4K30 still needs b), (b) keep the
old ring readable for its remaining lifetime when a format change cannot be avoided, (c) a Diagnóstico "energy test"
that attributes battery and heat to the gesture detector, the voice trigger, the preview and the format, because today
none of that is measured. Night recordings stayed `nominal` for 37 min `[phone]`; there is no 4K measurement in the
sun, which is where this matters.

**Measure next, because it may displace one of the three: the export.** The only two readings are 9.6 and 10.0 s to
export a 15 s 4K clip to 1080p with the framing `[phone]`: as long as Jogadores and Bola together, on every clip the
player sends. Nobody has looked at where that time goes and there is no 1080p reading. I8 starts with a short
measurement round on the log line that already exists; if a Full HD export costs the same, I8 moves ahead of I3.

Why these three and not others: they cover the three things the product needs (finish fast, do not heat, do not lose
the play), 1 and 2 have phone or lab numbers behind them, and 3 fixes a defect that is certain whenever it triggers.
What I would **not** build now, with the evidence: tiles around the predicted ball (tests 19 and 32: locks on the wrong
object; all tiles were adopted on purpose), analysing below 5 fps (test 42: cover 82 → 64%), a motion model / Kalman in
the basketball path (test 39: loses the bounced and passed ball at 5 fps), INT8 before a size or speed problem is
measured (I10), HEVC and 4K60 (parked by Victor on 2026-11-12).

---

## 1. The app today

### 1.1 Recording `[code]`

- `CaptureController`: one `AVCaptureSession`, `.inputPriority`, a 16:9 format picked by width and rate: `2160p30`,
  `1080p60` (default), `1080p30`, `720p30`. One `AVCaptureVideoDataOutput` (late frames not discarded) and one audio
  output deliver to a single queue.
- `SegmentWriter`: `AVAssetWriter` in HLS fMP4 mode, 1 s segments, H.264, no frame reordering, a key frame per second,
  bit rate `BufferPlan.videoBitRate` (10 Mb/s at 1080p60, 6 at 1080p30, 24 at 4K30). `SegmentRing` keeps the last
  `bufferSeconds` segments on disk (the buffer length chosen for the recording; 60 when unset). A save concatenates init + segments and remuxes with a passthrough export (no re-encode).
- Every video frame is also offered to: the gesture detector (below), the watch preview and the remote preview (JPEG,
  only while asked for). Every audio buffer goes to the voice trigger (`SFSpeechRecognizer`, on-device, continuous,
  restarted every 50 s) when it is enabled.
- `GestureDetector` / `GesturePipeline` run during the whole recording when the gesture is on: one sample every 250 ms
  (125 ms for 2 s after arms are seen up; 500 ms when degraded by heat). Per sample: person detection on the whole
  frame + 2 of the 9 tiles in turn + up to 2 close looks, each as its own `perform` on a handler built from a
  `CIImage` of the full-resolution frame, then body pose on up to 4 people, each on a Lanczos-enlarged crop with a new
  handler. Measured 55–60 ms per sample on the 16 Pro Max (backlog, 2026-10-28); not measured at 4K capture nor on the
  XR.
- Heat: `ThermalLadder` reads `ProcessInfo.thermalState`. `serious` slows the gesture; `serious` held 120 s →
  1080p30; `critical` → 720p30; it never steps back up. Each step is `restartCapture`: the session stops, the writer
  finishes, **the ring is cleared**, pending saves fail. Only iOS taking the camera away ends a recording.
  `AVCaptureDevice.systemPressureState` is not read anywhere.
- Screen: `ScreenEconomy` dims to 2% and disconnects the preview layer; JS covers the screen in black after 20 s idle
  (10 s when warm, `useScreenEconomy.ts`).
- No analysis runs while the camera is on (`focusHold(cameraOn)` → `all`), after the 2026-11-07 field test where the
  queue between recordings kept the phone `serious` all morning (README, spec 2026-11-07 §4.1).

### 1.2 Modo Foco: Jogadores `[code]`

`FocusAnalyzer.analyze(clipPath, startMs, endMs, outPath, everyMs)`, one at a time on a `.utility` queue:

1. `AVAssetReader` + `AVAssetReaderTrackOutput`, NV12 at the **native size**, over `startMs…endMs`. Every frame of the
   range is decoded (30 or 60 per second); one per 200 ms is used (`everyMs` 200, default since 2026-11-12).
2. Per used frame, one `VNImageRequestHandler(cvPixelBuffer:)` performs **10** `VNDetectHumanRectanglesRequest`:
   the whole frame + the 9 half-frame regions of `ScanTiles` (v14). Tile boxes pass a plausibility filter and are
   merged (`PersonBoxes.merge`).
3. `FocusGrid` puts the samples on the 100 ms grid; `FocusPath.compute` (preset `action`, rules `v15-acao-zoom110`)
   computes the landscape and portrait framings; the file `<clip>.focus.json` also keeps `playersHeight` and the
   person boxes per row (`people`), which Bola reads.
4. No heat check of its own. No per-frame cache: a cancelled or re-requested analysis starts from zero.

The range it is given is the clip's `bounds` (the cut the clip was first saved with), not the current cut
(`focusQueue.start`: `clip.bounds ? clip.bounds : {0, durationMs}`).

### 1.3 Modo Foco: Bola `[code]`

`BallAnalyzer.analyze(clipPath, startMs, endMs, detPath, outPath, focusPath, sport, maxWidth)`, one at a time on a
`.userInitiated` queue, over the **current cut**:

1. Before any frame: `BallVerdicts.before` (players too small → `tooFar`, nothing runs), from the Jogadores file's
   `playersHeight` when that file exists.
2. A second, separate `AVAssetReader` pass, NV12 at native size, every frame decoded, one per 200 ms used.
3. Per used frame: `CIImage` → upright → scaled to 1920 wide when the frame is wider (4K; default since 2026-11-12) →
   19 regions (the whole frame letterboxed to 416 + 18 tiles of 416 px with 80 px overlap), each rendered by Core
   Image into its own 416×416 BGRA buffer → **one batched Core ML prediction** (`predictions(fromBatch:)`, test 42) on
   `.cpuAndNeuralEngine` → decode, NMS → candidates stored normalized. Beach tennis also keeps a grey thumbnail per
   frame for the video-screen rule.
4. Detections are cached in `<clip>.balldet.json` (written every 25 frames and on any exit), keyed by model and
   width, so a changed cut, a cancel or a stop for heat continues from what was found.
5. `BallFraming.compute` (ReplayCore: `BallPath` dynamic-programming path, `BallTrust`, `BallZoom`, `BallCamera`,
   per-sport rules in `BallSport`) → `<clip>.ball.json`, or a verdict (`tooFar`, `rarelyFound`, `tooSmall`, `still`)
   that leaves the clip as it was.
6. Heat: waits to start while `serious` (only `critical` for cuts up to 15 s), stops at `critical` keeping the cache.

Models: `ball_tiny_gym` (basketball) and `ball_tiny_btpl` (beach tennis), YOLOX-Tiny one class, Core ML ML Program,
FP16 weights, fixed 416×416 input, 9.8 MB each compiled (20 MB in `ios/Models`).

### 1.4 Queues and product rules `[code]`

- `focusQueue` (Jogadores) and `ballQueue` (Bola) are two independent JS queues with the same shape (one running
  native call, hold while the camera is on, foreground only, cancel by clip path). `ballQueue` first calls
  `refreshFocus` when the Jogadores file is missing or has no person boxes, so **tapping Bola on a fresh clip runs a
  whole Jogadores pass and then a whole Bola pass, each with its own decode**.
- Nothing starts by itself: Jogadores and Bola run only on the user's tap; opening a clip applies nothing (the
  2026-11-12 fix). This plan keeps that rule everywhere.
- 16 comments in 10 files are marked `TEMP(lab-4k…)` (Diagnóstico switches, `everyMs`, `maxWidth`, rules suffix `@w1920`); they wait
  for the 4K + Full HD field test. That dump is not in `raw-dump` yet (the latest are `2026-11-11-4k` and
  `2026-11-12-speedtest`), so nothing here uses it.

### 1.5 Export and the rest `[code]`

- `ClipExporter`: `AVMutableComposition` + `AVMutableVideoComposition` with one transform ramp per 100 ms for the
  framing, a Core Animation layer for the mark, `AVAssetExportSession` with `AVAssetExportPresetHighestQuality`. The
  preset decides the bit rate: Full HD measured at 15 Mb/s (30 fps) and 23 Mb/s (60 fps) on the 16 Pro Max
  (`exportSize.ts`, 2026-10-29), against 10 Mb/s recorded at 1080p60. Diagnóstico logs every export's render time and sizes
  (`diagExport`, `clipTimings.ts`); the exported file's size is not logged.
- `SportCheck` (3 frames, `VNClassifyImageRequest` + floor measure), `ClipThumbnail`, `ClipContent.firstPictureMs`:
  a few frames each through `AVAssetImageGenerator`; not a cost that matters.
- Vision and Core ML fail with the app in the background; both analyzers report `interrupted` and the queues retry in
  the foreground. Nothing is scheduled as background work.

### 1.6 Where the time goes

iPhone 16 Pro Max, 15 s cut, phone cool. Rows marked `[estimate]` are my split of a measured total.

| Step | 4K30 clip | 1080p60 clip | Evidence |
|---|---|---|---|
| Jogadores, 10 fps (before 2026-11-12) | 9.3 s | 8.4–8.5 s | `[phone]` |
| Jogadores, 5 fps (today) | 4.9–5.3 s | 5.0–5.1 s | `[phone]` |
| — of which Vision, 10 requests per used frame | 53–59 ms/frame, 4.0–4.4 s | 44–47 ms/frame, 3.3–3.5 s | `[estimate]` two-point fit of the 10 fps and 5 fps totals (different clips in two rounds, so a range) |
| — of which everything else (decode of every frame, path, file) | 0.5–1.3 s | 1.5–1.8 s | `[estimate]` same fit; 1080p60 has twice the frames to decode |
| Bola, native tiles (before) | 20.4–21.5 s (85 regions) | 5.3 s (19 regions) | `[phone]` |
| Bola, scaled to 1920 (today) | 5.0–5.8 s | 5.3–5.7 s | `[phone]` |
| — of which the model | 2.5 ms × 19 regions = ~48 ms/frame, ~3.6 s (~68%) | same | `[bench]` FocusBench `det5b`, same detector code |
| — of which tile preparation (Core Image) | 0.4 ms × 19 = ~8 ms/frame, ~0.6 s (~11%) | same | `[bench]` |
| — of which decode, scaling, thumbnails, files | ~14 ms/frame, ~1.1 s (~20%) | same order | `[estimate]` total minus the two rows above |
| Bola on a fresh clip (Jogadores first) | ~10.5 s | ~10.5 s | `[estimate]` sum of the two; the speed-test build read 13 s wall clock, with Jogadores run twice `[phone]` |
| Export to 1080p with the framing and the mark | 9.6–10.0 s (two exports, 2026-11-11) | no reading | `[phone]` Diagnóstico "exportação … render" |
| "Jogadores on screen" after opening | 5.3–7.2 s | — | `[phone]` |

iPhone XR (A12), FocusBench only `[bench]`: 9.0–11.5 ms per region for the model and 2.1 ms per region for the tile
preparation; 36.5–45.6 s per 30 s clip for Bola's detector (3.4x the 16 Pro Max), `serious` from the third clip in a
row. Jogadores on the XR has no measurement (backlog item still open).

Readings that drive the plan:

- Jogadores does not get faster with fewer people in the picture (4.9–5.1 s from 3.1 to 6.5 people per frame `[phone]`):
  the cost is the 10 Vision requests, not what they find.
- Halving the analysed frames gave ~1.85x on Jogadores `[phone]`, so decoding the frames that are thrown away is the
  smaller part (0.5–1.8 s per 15 s `[estimate]`), but it is paid twice when Bola follows Jogadores.
- Bola's time is the region count: 85 → 19 regions gave 3.8x `[phone]`.
- The export is the longest single wait on a clip the player sends, and the only one whose inside nobody has looked
  at (two readings, 4K only).

### 1.7 Where heat and battery go

| Situation | Measured | Not measured |
|---|---|---|
| Recording 4K30 H.264, night, gesture + remote on | 65 → 50% in 37 min 28 s, in 5% steps at minutes 1, 14 and 27 (about 23%/h, no finer), `nominal` throughout `[phone]` | split between sensor/encoder, gesture, voice, screen, Bluetooth; anything in the sun |
| Recording 1080p60, night | 45 → 40% in 15 min 21 s (iOS reports 5% steps: too coarse) `[phone]`; ~20%/h in the plan's table | same |
| Jogadores 10 fps + Bola native tiles, clip after clip | `fair` after 2–3 min (7 Jogadores + 2 Bola on 2026-11-11; the 4th clip in round A) `[phone]` | each mode alone |
| Jogadores 5 fps + Bola 1920, 8 clips in 3 min | `nominal`, battery 80 → 80% `[phone]` (ran after another round, so not a clean comparison) | a soak; the XR |
| Bola detector alone, non-stop loop | 16 Pro Max: `fair` at 1.1 min, `serious` at 6.6 min; battery 70 → 60% over 72 clips in 10 min (5% steps). XR: `serious` from 1.4 min `[bench]` | — |
| Analysis between recordings (before the hold) | phone `serious` all morning, 2026-11-07 (README) | — |

What follows `[assumption]` until the energy test of I3 exists: during a game the app-controlled loads are the gesture
detector (Vision at 4–8 samples per second for the whole recording), the voice trigger (continuous on-device speech
recognition) and the capture format; the sensor, the encoder and the radio are fixed by the format and by iOS. After
the game, analyses are short bursts on the Neural Engine and matter only when chained (many clips in a row, or an old
phone).

Memory: not measured. Nothing in the code holds more than one decoded frame, the 19 input buffers and the per-frame
detections; a 4K NV12 frame is ~12 MB. `[code]`

Which part of the chip each stage loads. The first column is what the code asks for; where the work actually lands
has **no Instruments trace behind it**, so the last column is `[assumption]` unless tagged otherwise.

| Stage | What the code uses `[code]` | Where it lands |
|---|---|---|
| Decode of the clip (both modes) | `AVAssetReader`, NV12, every frame of the range | hardware video decoder + CPU for the hand-over |
| Jogadores: people | Vision `VNDetectHumanRectanglesRequest` × 10 per tick; no compute device is set | Vision chooses (Neural Engine or GPU); CPU for request set-up and box merging |
| Bola: 19 regions per tick | Core Image, one render per region into a 416×416 BGRA buffer (`CIContext`, default device) | GPU |
| Bola: model | Core ML, `.cpuAndNeuralEngine`, one batched prediction per tick | Neural Engine: FocusBench ran the same model with units `ne` on both phones `[bench]`; whether every layer stays there in the app is not measured |
| Paths and framing (`FocusPath`, `BallFraming`) | plain Swift in ReplayCore, once per analysis | CPU; not timed on the phone |
| Recording: camera + writer | `AVCaptureSession` → `AVAssetWriter` (H.264) | image signal processor + hardware encoder |
| Recording: gesture | Vision person + body-pose requests, 4–8 samples per second, crops through `CIImage` | Neural Engine / GPU for Vision, GPU for the crops, CPU for the rules |
| Recording: voice | `SFSpeechRecognizer`, on-device, continuous | unknown (CPU and/or Neural Engine) |
| Export | `AVAssetExportSession`, transform ramps + a Core Animation layer | hardware decoder and encoder, GPU for the composition |

Memory per analysis `[estimate]`, from what the code keeps alive: one decoded frame (~12 MB at 4K, ~3 MB at 1080p),
the upright / scaled picture while its regions are rendered, the 19 input buffers (19 × 416 × 416 × 4 = ~13 MB), the
loaded model (9.8 MB on disk; its size in memory is not measured) and the detections. Tens of MB, not hundreds; the
peak has never been read on the phone. One Instruments run per mode (Time Profiler + Core ML + Allocations, section 5
item 10) turns this table into measurements.

### 1.8 Quality today (from the lab's log; not re-measured)

- Jogadores: the tiles are needed (without them 3 of 13 clips get no framing); their side effect is that people on
  other courts or in the stands widen the framing (zoom 1.31 → 1.13x and 1.58 → 1.32x on two clips). The ball is lost
  mostly above the crop (88.5% of labelled balls in the crop; volleyball 64–72%). `[lab]` README "Findings about
  today's Modo Foco".
- Bola, basketball (`ball_tiny_gym`): 82% cover / 90–92% precision on our gym and on 11 other courts; losses on the
  other courts by cause: no candidate on the ball 11%, another candidate picked 5%, still filter 2% `[lab]` tests
  38, 40. Fixed since: the shirt rule and a faster camera for long passes (test 50).
- Bola, beach tennis (`ball_tiny_btpl`): cover 90.6%, precision 98% on the 19 own clips; court lock (ball points
  outside the main players' x-range ± 0.20 dropped), aim toward the hitter, the hitter kept whole (tests 46, 49, 52)
  `[lab]`.
- 4K: at native size the model saw many false small "balls" (precision 76.8%, verdict `tooSmall`); scaled to 1920:
  precision 95.9%, cover 86.1% on the 7 labelled night clips `[lab]`; on the phone no clip lost Bola, and three clips
  with little play are `rarelyFound` `[phone]`. The lab's trusted share runs higher than the phone's on the same clips
  (0.32–0.41 vs 0.17–0.25): the phone is the reference.
- Camera that jumps: Bola's camera is the lab's story camera C, a dead zone of ±10% of the crop and a path smoothed
  offline (`BallCamera` `[code]`), so the camera itself does not snap; in the lab the jumps came from the ball path
  switching between candidates (test 38: direction changes 3.1 → 2.1 per 10 s once the path held the ball) and from a
  small dead zone (test 29: smaller zones and closer zooms raised it from 1.5 to 2.3–2.8 per 10 s, and Victor picked
  the 0.10 zone on video; test 22: 0.8–1.1 with the 0.20 zone, against 2.3 for the players-only portrait framing)
  `[lab]`. On the phone this is judged by eye only: Diagnóstico logs
  time, frames, cache, ball share and zoom per cut, and no movement number `[code]`. I5 adds one.
- Open on the phone: the 4K → 1920 scaling is a bilinear Core Image transform, the lab's is ffmpeg `area` (plan,
  step 8 caveat).

---

## 2. How the reference apps do it

Facts are what a public source states; everything marked *assumption* is mine. Sources are numbered in section 7.
Research on each app stopped when new results repeated the earlier ones.

### 2.1 HomeCourt (NEX Team) — basketball, iPhone, real time on the device

| Question | Fact | Source |
|---|---|---|
| Processing | On the device, in real time; built on Core ML from 2017 | [1][2] |
| Hardware floor | Real-time shot tracking shipped with the iPhone XS; on the previous generation the result came a couple of seconds late; the company says the newer chip does it at a tenth of the battery | [3] |
| Court calibration | A CNN scans the frame with a sliding window for the hoop, weights detections near the centre, finds backboard and court-line feature points, and solves the camera pose (perspective-n-point), refined with the phone's focal length and gravity reading | [4][5] |
| Camera movement | Detection is repeated so the calibration stays current, and only on sharp frames (a contrast check rejects blur from vibration); movement is compensated with a homography | [4][5] |
| Ball | Balls are detected only inside a "ball tracking ROI" around the hoop, whose size depends on the device's processing power; detections over successive frames are grouped into trajectories, and each trajectory is tested as a shot attempt | [4][5] |

*Assumptions*: the patents describe embodiments, not necessarily the shipping code. The region of interest is what
makes real time possible, and it works because the question is "did a ball go through this hoop", not "where should
the camera look".

### 2.2 SwingVision — tennis / pickleball, iPhone or iPad, real time on the device

| Question | Fact | Source |
|---|---|---|
| Processing | On-device machine learning, real time, no internet needed; videos recorded elsewhere can be imported and analysed | [6][7] |
| Frame rate and size | Records at 60 fps (at lower rates the bounce is not seen) and processes 1080p frames 60 times a second; the founder says the models had to be made as lean as possible and that the app is not possible without the Neural Engine | [8] |
| What is tracked | "A series of machine learning models" output the ball, the court and the players; 3D ball position at hit, net and bounce; shot type, spin, speed | [9] |
| Placement | One or two iPhones mounted at the back of the court with the full court in view, not touched during the match | [9] |
| Dead time | Dead time between points is removed to condense the match; rallies are separated from dead time from the tracking data, not by hand | [9][10] |
| Battery | A reviewer notes that constant filming and measuring drains the battery quickly and that the court must be well lit | [11] |
| Patents | "Learning-based 3D property extraction" (single camera) is assigned to Mangolytics / SwingVision; I did not read its claims | [12] |

*Assumptions*: the court is found once (keypoints + homography) and reused; a rally is "ball in play between two
shot events". I found no public statement on how the app reacts to heat.

### 2.3 TennisCut (the app Victor knows as "TenisCut")

The App Store name is **TennisCut: AI Tennis Analysis** (subtitle "Auto Rally Trim & Highlights", © Arc Labs). Facts,
all from its store page [13]: every analysis runs on the phone, nothing is uploaded and no connection is needed; the
video is recorded in the app (1080p or 4K, 30 or 60 fps) or imported; the AI marks the moments the ball is in play and
builds a rallies-only video without the dead time between points; the paid tier unlocks the rally detection and
trimming, rally-to-rally navigation, single-point export, a ball trajectory drawn over the video (three trail
styles), video insights and 4K recording. *Assumptions*: the analysis runs after the recording, on request (the page
describes trimming a recorded or imported video and does not say when it runs); the mechanism is not documented ("ball
in play" over time is what the page's wording points to). It is the closest reference to Reprize's own shape: phone
only, after the game, the ball as the signal for the cut. A similar app, PerfectSwing, uploads the video and clips
rallies in the cloud [14].

### 2.4 Veo — field sports, dedicated camera or two iPhones, processed in the cloud after the game

| Question | Fact | Source |
|---|---|---|
| Capture | Two 4K lenses record a 180° view of the whole field for the whole game; nothing is cropped at capture | [16] |
| Follow-cam | Generated after upload: the AI finds ball and players frame by frame and the tracked view is a virtual crop of the full recording; digital zoom costs sharpness | [15][16] |
| Where | Cloud compute | [17] |
| Veo Go | Two iPhones (iPhone 11 or newer, ultra-wide) each record half the pitch; both files are uploaded and stitched and tracked in the cloud; the tripod must not move once recording has started (movement disturbs the processing); the checklist asks for both phones fully charged and with free storage | [18][19] |

*Assumption*: phones only record so that heat and battery are spent on capture alone.

### 2.5 Pixellot, Hudl Focus, PlaySight — fixed or dedicated hardware

- **Pixellot**: several cameras in one head, a separate video processing unit, feeds stitched into a panorama; the
  production is a virtual camera that pans and zooms inside it; models are trained per sport [20]. Patents: a stream
  of frames derived from a panoramic capture by a camera array; a virtual camera model per group of frames with a
  foreground mask per frame [21].
- **Hudl Focus**: four lenses form one image; an algorithm trained on many games finds the ball, players, officials
  and the scoreboard, and player tracking drives the camera [22]; video uploads during the game and needs no
  processing afterwards, with dedicated algorithms per sport [23]; Focus Flex is calibrated by marking the pitch
  corners [24].
  *Assumption*: tracking therefore runs on the camera itself.
- **PlaySight**: fixed PoE cameras wired to an on-site computing unit kept in a cool server room; tracking and
  automated production there, video to the cloud [25]; its CEO said fast small objects such as a hockey puck were
  beyond the system in 2020 [26].

### 2.6 Two mechanism references that are not competitors

- **Google AutoFlip** (open source reframing): buffers a whole scene before deciding, then chooses per scene between a
  stationary crop, a constant-speed pan and a tracking path, and solves the camera path as an optimisation instead of
  following boxes frame by frame; its signals are faces and objects, and the article names ball and motion detection
  as possible extensions [27].
- **TrackNet** (ball tracking research): a heat-map network fed several consecutive frames, so a small blurred ball is
  found from its trajectory and not from one frame's look [28]. The lab's test 27 found TrackNetV3 unusable for
  basketball without retraining.

### 2.7 What transfers to Reprize

| Mechanism (who) | Reprize today | Transfer |
|---|---|---|
| Look for the ball only where it can be (HomeCourt ROI; SwingVision court) | All 19 regions on every analysed frame; tiles around the path were tried and rejected (tests 19, 32) | Yes, with a criterion that cannot lock on a wrong object: motion (I2), then the court area (F2) |
| Calibrate the court once and reuse it (HomeCourt, SwingVision, Hudl) | Court lock from the main players' x-range, per clip | Yes, per recording (F2); a tripod does not move between clips |
| Process after the game, not during it (Veo and Pixellot in the cloud, TennisCut on the phone) | After, on demand, on the phone; nothing while the camera is on | Already the right shape; keep it |
| Real-time analysis during recording (HomeCourt, SwingVision) | None | No: they need live stats and line calls, Reprize does not, and it would spend heat during the game |
| Decide the camera for the whole scene, stationary when it can be (AutoFlip, Veo) | Offline path with dead zone; verdict "the camera would hardly move"; Victor prefers a still camera when nothing needs it | Already there; no change proposed |
| Several frames as the detector's input (TrackNet) | One frame per detection; the path adds time afterwards | Not now: needs retraining on sequences; motion as a second signal (I2, I11) is the cheap version |
| Cut dead time (SwingVision, TennisCut) | Removed from the app on 2026-11-01 (cut suggestion from motion + sound was not reliable) | As a feature, on request, with the ball as the new signal (F1) |
| Frame-rate throttling under pressure (Apple's capture guidance [29][30]) | Restart at a lower format, buffer lost | Yes (I3) |

---

## 3. Improvements, in order

Effort: S = up to a day, M = a few days, L = one to two weeks (my estimates). "Phone only" = what the lab cannot tell.

Order to build (the numbers are labels, kept stable for reference): **I5 first** (a day, no risk; I1's own before /
after needs its timers), then **I1, I2, I3** (section 0), then I8 once its measurement round is in (ahead of I3 if a
Full HD export also costs ~10 s), I4 (inside I1), I6, I7, I9 (when the field test is in), I10, and I11 in the lab at
any time.

### I1. One analysis pass, scoped to the cut, shared by Jogadores and Bola  — recommended 1st

- **What**: a `FrameSource` (one reader pass, the upright frame of each 200 ms tick, cancellable, heat-aware) feeding
  two detectors that each write to the same per-tick cache: people boxes (today inside `.focus.json`) and ball
  candidates (today `.balldet.json`). Framing (`FocusPath`, `BallFraming`) becomes a pure function of the cache for a
  given cut and runs in milliseconds. One native entry point and one JS queue replace two of each. A request is
  "these ticks, these detectors": Jogadores asks for people; Bola asks for people + ball in the same pass; a changed
  cut asks only for the ticks the cache lacks. Jogadores is analysed over the cut plus a margin instead of `bounds`
  (the plan's open candidate 3).
- **User impact**: Bola on a fresh clip ~10.5 s → ~9 s (same work, one decode) or ~6 s (detectors side by side)
  `[estimate]`; Jogadores proportional to the cut (a 30 s clip cut to 10 s: ~10 s → ~3.4 s `[estimate]`); trimming
  after an analysis is instant inside the analysed range; a cancelled Jogadores resumes instead of restarting.
- **Effort**: L. **Risk**: medium. The detections do not change, so the parity fixtures (`BallParityTests`,
  `FocusPathTests`, the vectors) stay valid; the risk is in the queue semantics (cancel, hold, foreground) and in the
  file migration (keep reading today's files; write the new cache next to them). A second risk is in the framing: analysing the cut plus a
  margin instead of `bounds` changes what `FocusPath` sees (smoothing windows, the 3 s still window,
  `minPeopleShare`), and the 4K plan's step 7 check for this candidate ("framing inside the cut identical") is still
  open. It is gate G4 for I1 and runs on the Mac before any app work; if it fails, I1 keeps `bounds` for Jogadores and
  loses only that part of the gain.
- **Measure before / after**: the Diagnóstico lines that exist today (seconds per cut, frames, "N do cache"), plus
  per-stage timers added first (decode, people, tiles, model, path) so the split of section 1.6 stops being an
  estimate. Same protocol as the plan's step 8 (the 18:52 clips, "Zerar análises", phone cool).
- **Phone only**: whether Vision and Core ML run side by side without slowing each other (both may use the Neural
  Engine); the real decode share; heat over 10 clips in a row; the XR.
- **Open question inside it**: Jogadores must keep receiving the native-size frame until a Mac check
  (`vision-probe.swift`, gate G4) shows the 9 tiles find the same far players on a 1920-wide frame; only then can the
  reader itself deliver the smaller frame to both (I6).

### I2. Bola: motion-gated tiles with carry-forward  — recommended 2nd

- **What**: per analysed frame, a grey thumbnail 640 px wide is compared with the analysed frames before and after
  it (200 ms apart, so no frame is used that the loop does not already have; the first lab run used 100 ms neighbours,
  with the same result). The thumbnail is new work for both sports: the beach tennis screen rule makes one of 160 px,
  which is too small, and basketball makes none. Then a tile is sent to the model only when at least 2 thumbnail pixels changed inside
  it, or it ran on the previous analysed frame; the whole-frame region always runs. A tile that is not run keeps the
  candidates it had the last time it ran, so still objects stay "seen on every frame" and the path's still filter
  keeps ignoring them.
- **Evidence**: section 6. Regions 19 → 9.2–10.8; detector ceiling unchanged on 1,342 labelled points; path
  identical on basketball; arenas A and B equal as sets, with single clips moving (section 6); night 4K: precision
  95.4 → 93.4, cover 84.5 → 83.6, from two clips, one of which changes from "not applied" to "applied" `[lab]`.
  Without the carry-forward the beach tennis precision drops 2–3 points `[lab]`.
  Thumbnail width (detector ceiling, section 6): 640 px keeps it on every set; 480 px loses 2.9 points at night;
  320 px loses 5–8 on beach tennis and nothing on basketball; 160 px loses 32 at night `[lab]`.
- **User impact**: Bola ~1.6x faster on the 16 Pro Max (~70 → ~44 ms per frame, before the thumbnail's own cost) and ~1.7x on the XR `[estimate]`;
  about half the Neural Engine time per clip, so chained clips heat later.
- **Effort**: M. **Risk**: medium. The path's input changes slightly, so it needs the plan's gates (G1–G3, G7) on
  basketball, beach tennis day and night, and a threshold check on a noisy night clip; a Diagnóstico switch as for
  the 4K candidates.
- **Measure**: lab first (`motion_tiles.py`, already written), then the phone: seconds per cut, regions per frame in
  the log line, verdict and ball share per clip against today.
- **Phone only**: the real gain (the thumbnail and the difference cost something), the threshold under the phone's
  own noise at night, heat.

### I3. Recording under heat: throttle first, keep the buffer, measure the energy  — recommended 3rd

- **What**:
  a. Read `AVCaptureDevice.systemPressureState` (level and factors) next to `thermalState`; log both in Diagnóstico.
  b. First step under `serious`: lower the frame rate on the running session (`activeVideoMin/MaxFrameDuration`, as
     `CaptureController.setRate` already does for the preview): 1080p60 → 30 fps with the same writer, ring and
     buffer. This is the whole of the ladder's first step for the default 1080p60, so that restart goes away. To check
     in Stage 2: the writer was opened with a bit-rate target and an expected frame rate for 60 fps
     (`SegmentWriter`), so the segments' size and picture after the step need a look. Apple documents that the rate can change without stopping the session [30] and recommends throttling
     under system pressure [29].
  c. When a format change cannot be avoided (4K → 1080p, `critical` → 720p): keep the old ring's segments readable
     until they age out, so a save in the next 60 s still returns the play (as its own clip). Design in Stage 2.
  d. A Diagnóstico energy test: same place, 10-minute blocks, one thing changed per block: gesture on / off, voice
     on / off, preview on / off, and the format (1080p60, 1080p30, 4K30; HEVC against H.264 if that is taken up); battery from Xcode's energy gauge or MetricKit rather than the 5% steps iOS reports.
  e. With (d) in hand, make the gesture sample cheaper: one handler from the pixel buffer per sample, all person
     requests in one `perform`, request objects reused; check ms per sample at 4K against 1080p in `/spike`.
- **User impact**: the play in the buffer survives the first heat step; fewer restarts (each one also drops the
  microphone for a moment and moves the volume the remote is read from, `ThermalLadder` / `ReplayEngine` comments); a known cost per feature
  instead of a guess.
- **Effort**: M for a + b + d, M for c, S–M for e. **Risk**: low for a, b, d (no change while cool); medium for c
  (ring and save paths).
- **Measure**: ThermalLadder tests for the new step; on the phone, a recording forced through the step (Xcode's
  thermal state override) with a save right after it: clip present, length right.
- **Phone only**: all of it that matters: time to `fair` / `serious` in the sun at 1080p60 and 4K30, whether 30 fps
  brings the pressure down, the energy split.

### I4. Heat policy for every analysis, in one place

- **What**: Jogadores has no heat check; Bola has start and stop rules. In the shared loop of I1: start rules as
  Bola's today, and between ticks a short pause when `fair` or `serious` (the lab saw that pausing between frames
  keeps the phone cooler at the price of time, test 11). Apple's guidance: at `fair` defer work the person does not
  need now; at `serious` reduce; at `critical` stop [31].
- **Impact**: chained clips stop pushing a warm phone to `serious`. **Effort**: S inside I1. **Risk**: low (slower
  when hot is the intent). **Measure**: a 10-clip soak per variant, time per clip and thermal state per clip.
  **Phone only**: all.

### I5. Per-stage timing in Diagnóstico  — build first (step 0)

- **What**: decode, people detection, tile preparation, model and path as fields of the existing analysis lines,
  the file size next to the render time the export line already has; and for the framing that was applied, two movement numbers the lab already uses (pan p95 in
  crop widths per second, direction changes per 10 s), so a camera that jumps shows in the field-test log and not
  only on video. **Impact**: none for the user directly; it turns sections 1.6 and 1.7 into measurements and
  makes every later item checkable. **Effort**: S. **Risk**: none (diagnostics builds only). **Measure**: it is the
  measurement; check that the stages add up to the total already logged. **Phone only**: all (it exists to be read on
  the phone). Do it before I1.

### I6. Smaller frames from the reader, tiles without Core Image

- **What**: ask `AVAssetReaderTrackOutput` for a frame at most 1920 wide (width / height in its pixel-buffer
  settings; FocusBench already reads scaled frames this way), and cut the 18 tiles straight out of that buffer (they
  are 1:1 crops: scale 416 / 416) instead of 19 Core Image renders per frame. The reader must then deliver BGRA (or the model take NV12), and vertical clips
  still need the rotation the Core Image path does today.
- **Impact**: tile preparation is ~11% of Bola on the 16 Pro Max and ~15% on the XR `[bench]`; most of it goes.
  Less memory traffic on 4K. **Effort**: M. **Risk**: medium: the scaler changes (the plan already flags bilinear
  on the phone vs `area` in the lab), so gates G1–G3 again; for Jogadores see the open question of I1.
- **Measure**: the per-stage timers of I5; parity of candidates per frame against today (`ball_parity.py --check`
  style). **Phone only**: speed; which scaler the decoder uses.

### I7. Jogadores: fewer Vision requests per tick

- **What**: the 10 requests per tick are two thirds (1080p60) to four fifths (4K30) of Jogadores `[estimate]`. Candidates: the whole frame every tick and
  the 9 tiles in turn (3 per tick) with people kept between visits, as the gesture pipeline does with
  `PersonTracks`; or tiles only where the picture changed (the same motion signal as I2).
- **Impact**: up to ~2x on Jogadores `[estimate]`. **Effort**: M. **Risk**: medium-high: Bola reads these boxes
  (hitter, head rule, court lock) and the framing must stay v15's. **Measure**: on the Mac with `vision-probe.swift`
  (Vision does not run in the cloud workspace), rects against today per clip (gate G4), then videos for Victor.
  **Phone only**: the gain. Not before I1 and I2.

### I8. Export: find where its 10 s go, then an explicit bit rate

- **What**: (1) a measurement round on the log line that exists: the same 15 s clip exported from a 4K and from a
  1080p recording, with and without the framing, with and without the mark layer, at each output size; megabytes
  added to the line (I5). (2) With that in hand: an explicit target bit rate (the source's, capped) instead of the
  "highest quality" preset, which writes Full HD at 15–23 Mb/s from a 10 Mb/s recording (measured 2026-10-29, noted
  in `exportSize.ts`); and, if the composition is where the time goes, the framing and the mark drawn in one reader /
  writer pass instead of `AVVideoComposition` with the Core Animation tool `[assumption]`.
- **User impact**: 9.6–10.0 s per 15 s 4K clip today `[phone]`, paid on every clip sent, with or without a Modo Foco;
  smaller files for WhatsApp and Instagram. How much of it can be recovered is unknown until (1) `[assumption]`.
- **Effort**: S for (1), M for the bit rate, L for a pipeline of our own. **Risk**: medium: the picture is judged by
  eye, and the mark must come out exactly where it is today.
- **Measure**: seconds (logged today) and megabytes per export of the same clips, before and after; side by side for
  Victor.
- **Phone only**: all of it (the decoder and the encoder are the phone's).

### I9. Make the 2026-11-12 defaults permanent

- **What**: after the 4K + Full HD field test, remove the 16 `TEMP(lab-4k…)` comments and the code under them (switches, rule suffix,
  `ClipFocus.every`) with a rules bump, as the plan's step 9 says. With I1 this disappears into the new entry point.
  **Impact**: none visible; less code and no stale switch in a store build. **Effort**: S. **Risk**: low (clips
  analysed under the old rules are analysed again when asked). **Measure**: the Swift and jest suites, and the field
  test's Diagnóstico showing the same times as the 2026-11-12 round B. **Phone only**: that field test.

### I10. Model: size first, speed only if measured

- Facts: both models are FP16 ML Programs on `.cpuAndNeuralEngine`, 9.8 MB each `[code]`; 2.5 ms per region batched
  on the A18 Pro, 9–11.5 ms on the A12 `[bench]`. Core ML's own guidance: weight palettization reduces size and
  usually helps memory and latency on the Neural Engine; 8-bit weights + activations can use a faster int8
  path on newer chips (the page names the A17 Pro and M4 as examples) [32].
- **What**, in this order: (a) 8-bit palettized weights: ~half the size for each model (Victor asked on 2026-11-11 for care with
  the store size as models are added; the 2026-11-04 spec had accepted +40 MB); (b) a FocusBench run of that model for speed; (c) W8A8 only if (b) shows the newest
  phones need it. Separate bench experiment: one full-resolution input (1920×1088) instead of 18 tiles (fewer pixels:
  2.1 MP against 3.1 MP, no tile preparation), to see whether the Neural Engine takes it.
- **Impact**: app size now; speed unknown `[assumption]`. **Effort**: S for (a) + (b). **Risk**: detection changes
  slightly: gates G1–G2 and `batchMaxDiff`-style checks. **Measure**: megabytes of `ios/Models` and of the built
  app; ms per region in FocusBench; ceiling, precision and cover on the labelled clips with the compressed model
  against today's. **Phone only**: speed, and whether each variant stays on the
  Neural Engine.

### I11. Quality candidates to test in the lab before any app work

- Motion as evidence for a candidate (a candidate with no change around it and no person on it scores less): aimed at
  lamps, logos, the mural's painted ball, false small balls at night. I2's thumbnails would already be there.
- The play area per recording (F2) as a filter for people and candidates: aimed at the framing widened by other
  courts and stands, and at the camera going to the next court.
- The phone's 4K → 1920 scaler against the lab's (`CILanczosScaleTransform` or the decoder's scaler, I6), if the
  field test shows missed balls.
For each: **impact** unknown until tested (fewer false balls, fewer framings widened by bystanders); **effort** S–M
in the lab; **risk** none for the app (nothing ships without the gates); **measure** precision / cover / verdicts on
the labelled clips against today (gates G1–G5), then videos for Victor; **phone only** the scaler item and, for the
rest, whatever passes the lab.

### Considered and not proposed (with the evidence)

| Idea from the brief | Verdict | Evidence |
|---|---|---|
| Search near where the ball was, full sweep now and then | No, in that form | Tests 19, 32: online tiles lock on look-alikes (cover 86 → 23–67% on one night clip); two stages never looked where the real ball was on 1107-a; all tiles adopted. Motion gating (I2) is the variant that does not depend on the path |
| Kalman filter / motion model | No for basketball; keep as an option for racket sports | Test 39: precision up, cover −1 to −3, camera −9 points on one clip at 5 fps |
| Adaptive frame skipping | Not now | Test 42: 2.5 fps loses the ball (cover 82 → 64%). Skipping only where nothing moves is what I2 already does per tile |
| Decode once for both modes | Yes | I1 |
| Scale down at decode | Yes, after I1 | I6 |
| FP16 / INT8, Neural Engine | Already FP16 on the Neural Engine; compression for size | I10 |
| React to `thermalState` | Extend | I3, I4 |
| Capture format (4K / 1080, 30 / 60, HEVC) | Measure inside I3 d, then decide; 4K60 and HEVC stay parked by Victor (2026-11-12) | Known today: after the scale-down a 4K clip analyses as fast as a 1080p60 one (section 1.6) `[phone]`; the two formats' battery use cannot be told apart at 5% steps `[phone]`; a 4K → 1080p export is ~10 s per 15 s and the Full HD export has no reading; 4K30 writes 24 Mb/s against 10 at 1080p60 `[code]`. HEVC would make smaller files at equal quality `[assumption]`; its effect on heat and on the passthrough save is not measured |
| Screen during recording | Already dimmed, preview disconnected | 1.1; measure its share in I3 d |
| Background work | No change: analyses are user-initiated and need the foreground | 1.5 |

---

## 4. New features (separate from the improvements)

| # | Feature | What it would be in Reprize | Cost | Risk |
|---|---|---|---|---|
| F1 | Trim to the play (cut the dead time) | A button in the cut tool that proposes start and end from the ball-in-play runs (the beach tennis path already finds runs ≥ 1 s, test 46b; basketball has no minimum run today; TennisCut sells exactly this, from "ball in play", section 2.3) plus players' movement; and "Compilar" joining clips already trimmed. Never applied by itself | M: Bola's detections over the clip's `bounds` (cheap after I1 + I2), a rule, the button | Medium-high: the first version (movement + hit sounds) matched the hand-marked cut at 73% on average and was removed on 2026-11-01. Needs a lab test with the ball signal on labelled cuts before any UI |
| F2 | Court / play area per recording | Learned from the people of the recording's analysed clips (no question to the user), stored per recording; later an optional 4-corner adjust. Used to drop people and ball candidates outside it and to skip tiles | M | Medium: a wrong area hides real play; lobs leave the court in the picture, so the ball needs a taller area than the feet. Lab test first (I11) |
| F3 | Jogadores with no wait, from the recording's own people | While recording, the gesture detector already finds and tracks people 4 times a second. Keeping those boxes with each buffered second would let a saved clip's Jogadores framing be computed with no video pass. No new work during the game | M–L | High until measured: the gesture looks at 2 tiles per sample, Jogadores at 9; only when the gesture is on; and Victor must judge it against "no analysis starts by itself" (nothing new runs and nothing is applied, but data is kept). The gesture probe can replay clips on the Mac to compare framings |
| F4 | Ball trail / hit markers | A drawn trail or a slow-motion beat at the hit, from Bola's path | M | Medium: a wrong trail is visible; test 26 found the limit is detection |
| F5 | Follow one chosen player | Tap a player, the framing follows them | L | High: needs person labels and an identity tracker (lab test 2 never run) |

F1 and F2 are the two the competitors all have in some form (section 2.7). F2 also feeds I2 and I7.

---

## 5. What only the phone can tell (one list)

1. Vision and Core ML side by side in one pass: total time against one after the other (I1).
2. The per-stage split of Jogadores and Bola on the 16 Pro Max and the XR (I5); Jogadores on the XR at all.
3. Motion-gated tiles: seconds per cut, regions per frame, verdicts, on night clips above all (I2).
4. The recording's energy by component, and time to `fair` / `serious` in the sun at 1080p60 and 4K30 (I3).
5. Whether 30 fps on the running session lowers the pressure, and the save right after the step (I3).
6. Gesture cost per sample at 4K against 1080p (I3 e).
7. Export: where the ~10 s go (4K against 1080p source, framing and mark on / off) and megabytes per size and rate
   (I8).
8. Palettized model: speed and compute unit (I10).
9. Heat over 10 clips in a row for each analysis variant (I4), both phones.
10. CPU / GPU / Neural Engine / memory per stage: one Instruments run of Jogadores and one of Bola on a 15 s cut
    (Time Profiler, Core ML and Allocations templates), on the 16 Pro Max and the XR (section 1.7's table).
11. Tap-to-ball-camera wall clock on today's code for a fresh clip (section 0: the only reading is from the
    speed-test build).

Protocol for 1–3 and 9: the plan's step 8 as it is (clips never analysed, "Zerar análises", phone cool, off the
charger, `nominal`), one variant per round, Diagnóstico shared after each.

---

## 6. Lab measurement added in this stage: motion-gated tiles

Script: `docs/focus-refs/tools/lab/motion_tiles.py` (new; python3 + numpy + ffmpeg, no venv). Offline simulation on
the stored all-tiles detections, as `roi_tiles.py` did for test 19: a candidate is kept when its centre lies in a tile
that would have run. Thumbnails 640 px wide at 10 fps; a pixel "changed" when its 3×3 mean differs by more than 20
grey levels from **both** the frame 100 ms before and the one 100 ms after; a tile runs with ≥ 2 changed pixels or
when it ran on the previous analysed frame; `--carry 1` keeps the last candidates of the tiles that do not run.
Candidates found only by the whole-frame region are dropped (conservative: the phone would keep them). Path and
scores by `ball_track.py` and `det_report.py`, baseline recomputed the same day (`det-<det>-ref`).

| Set (detector tag) | clips / labelled points | regions per frame | detector ceiling | path precision | path cover |
|---|---|---|---|---|---|
| Night beach tennis, 4K → 1920 + the 1080p control (`btpl-4kplan-1920`) | 8 / 308 | 19 → 10.3 | 89.6 → 89.6% | 95.4 → 93.4% | 84.5 → 83.6% |
| Basketball, our gym (`bgym-n5`) | 12 / 325 | 19 → 9.2 | 90.2 → 90.2% | 94.4 → 94.4% | 83.7 → 83.7% |
| Beach tennis, arena A (`btplA2-n5`) | 10 / 373 | 19 → 9.5 | 88.7 → 88.7% | 94.8 → 94.8% | 83.9 → 83.9% |
| Beach tennis, arena B (`btplB-n5`) | 9 / 336 | 19 → 10.8 | 95.2 → 95.2% | 99.0 → 99.0% | 90.1 → 89.8% |

- Per clip (`report.mt-ref-*` against `report.mt-mt20c-*`), the set scores hide movement:
  - Basketball: all 12 clips identical in every column.
  - Night 4K: two clips change. `bt4k-1111-2fd3b0a7`: precision 91 → 77%, cover 62 → 59%, and the ball gate goes
    from "no" to "yes": a clip that today is left as it was would get the ball camera, on a worse path. This is the
    result to resolve before the app (question 3 in section 8). `bt4k-1111-c4bd28f7`: precision 100 → 98%, cover
    97 → 94%.
  - Arena A: precision 94 → 97% on `a-01` and 95 → 92% on `a-03`; ball-mode share 78 → 100% on `a-05`.
  - Arena B: cover 92 → 88% on `b-02`; ball-mode share 90 → 71% on `b-08` and 86 → 94% on `b-09`.
  The ball-mode share is how much of the clip the camera follows the ball, so those shifts would be visible on video
  even where precision and cover are equal: videos for Victor belong in the gate for I2.
- Set scores above are pooled over the labelled points of the per-clip rows; an independent recount from the track
  files gave 95.6 → 93.8% precision and 84.4 → 83.4% cover on the night set, the same picture.
- What the phone would have to compute (second run, `--thumb-w`, `--step`, `--dry 1`; detector ceiling, regions):

  | Variant | Night 4K | Basketball | Arena A | Arena B |
  |---|---|---|---|---|
  | 640 px, neighbours ±100 ms (the table above) | 89.6 → 89.6%, 10.3 | 90.2 → 90.2%, 9.2 | 88.7 → 88.7%, 9.5 | 95.2 → 95.2%, 10.8 |
  | 640 px, neighbours ±200 ms (the analysed frames only) | 89.6 → 89.6%, 11.3 | 90.2 → 90.2%, 9.4 | 88.7 → 88.7%, 10.6 | 95.2 → 95.2%, 11.7 |
  | 480 px | 89.6 → 86.7%, 9.7 | — | — | — |
  | 320 px | 89.6 → 81.5%, 9.0 | 90.2 → 90.2%, 8.8 | 88.7 → 80.7%, 8.0 | 95.2 → 89.9%, 9.3 |
  | 160 px (the screen rule's thumbnail) | 89.6 → 57.8%, 7.1 | 90.2 → 89.8%, 7.1 | — | — |

  So: one 640 px grey thumbnail per analysed frame is enough (no extra frames), about one region more than with
  100 ms neighbours, and nothing smaller is safe for beach tennis. With ±200 ms neighbours the path reports for the
  night set and arena B (`report.mt-mt20s2c-*`) are identical, row for row, to the ±100 ms ones, including the two
  night clips that move. That both variants move the same clips the same way points at what they share (the
  carry-forward, or the simulation dropping candidates only the whole-frame region found) rather than at which tiles
  run `[assumption]`; `path_diag.py` on `2fd3b0a7` is the first lab step of I2.
- Without the carry-forward: precision −3.2 (night), −1.7 (arena A), −2.3 (arena B), basketball unchanged: the still
  filter stops recognising objects that come and go with the tiles.
- Threshold sweep on the night set: 12 grey levels → 12.1 regions, ceiling kept; 30 without the hold → 8.7 regions,
  ceiling 89.6 → 82.1% (rerun with `--dry 1` on 2026-11-12; the first run's files were not kept). So 20 with the hold is on the safe side, and there is no large further gain to be had.
- Caveats: a simulation (no new inference); the lab is more generous than the phone; thumbnails by ffmpeg `area`,
  not the phone's scaler; no clip in the sun with moving shadows, no vertical 4K; one threshold for every set.
- Files: outputs `lab/tests/detect/<clip>.<det>-mt20c.json`, tracks `det-<det>-mt20c`, reports
  `report.mt-{ref,mt20c}-<det>.md`, logs in `lab/tests/motion/`. Sweep leftovers were moved to
  `lab/tests/motion/_to_delete/` (41 files) because this session cannot delete files there.

Reproduce (from `docs/focus-refs`): `python3 tools/lab/motion_tiles.py --det bgym-n5 --out bgym-n5-mt20c --thr 20
--mode and --hold 1 --carry 1 <clips>`, then `ball_track.py --det bgym-n5-mt20c <clips>` and
`det_report.py --det bgym-n5-mt20c --track det-bgym-n5-mt20c <clips>`.

---

## 7. Sources

Accessed 2026-11-12. [8] and [9] could not be opened directly from this session (both sites are outside its network
allowlist). For [8] the search engine returned the article's text, including Apple's own translated edition of the
same page, and the 60 fps / 1080p / lean models / Neural Engine statements were checked against it; for [9] what is
cited is only the text the search engine returned for that PDF, so treat the ITF rows as the weakest-sourced facts
in section 2.2.

1. NEX Team, "Transforming Basketball with AI" — https://medium.com/nex-team/our-first-shot-s-272c67d0349d
2. NEX Team press release, 2018-07-17 — https://www.homecourt.ai/press-releases/2018/7/13/nex-team-inc-debuts-with-4-million-in-funding-and-launches-homecourt-the-first-ai-powered-basketball-training-app
3. Business Insider via Yahoo, interview with the founders — https://www.yahoo.com/now/ex-apple-engineers-created-app-174412491.html
4. US 10,489,656, "Methods and systems for ball game analytics with a mobile device" (NEX Team) — https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10489656
5. US 11,380,100 (same family) and US 11,594,029, "…determining ball shot attempt location on ball court" — https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11380100 , https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11594029
6. Tennis Australia, 2021-03-23 — https://tennis.com.au/news/2021/03/23/swingvision-brings-game-changing-tech-to-tennis
7. Pickleball Union (import of outside videos) — https://pickleballunion.com/?p=14029
8. Apple Developer, "Behind the Design: SwingVision", 2023-06-05 — https://developer.apple.com/news/?id=0pg4dthn
9. ITF, PAT approval report 25-037, SwingVision — https://www.itftennis.com/media/15294/pat-25-037-approval-report-swingvision.pdf
10. ParentingAces podcast notes, 2021-08-31 — https://parentingaces-archive.pages.dev/library/2021-08-31-swingtennis-ft-swupnil-sahai/
11. iMore review — https://www.imore.com/apps/level-up-your-serve-with-ai-powered-tennis-coaching-iphone-app-swingvision
12. US 11,893,808 B2, "Learning-based 3D property extraction" (Mangolytics / SwingVision) — https://patents.google.com/patent/US11893808
13. TennisCut: AI Tennis Analysis, App Store — https://apps.apple.com/app/id6754323620
14. PerfectSwing, App Store — https://apps.apple.com/us/app/id6751231905
15. Veo, "AI camera for sports guide" — https://www.veo.com/article/ai-camera-for-sports-guide
16. TechCrunch, 2017-08-30 — https://techcrunch.com/2017/08/30/veo/amp/
17. NVIDIA developer blog — https://developer.nvidia.com/blog/ai-technology-automatically-records-soccer-matches
18. Veo Go product page and FAQ — https://www.veo.co/product/veo-go-row
19. Veo support: uploading, and the recording guide — https://support.veo.com/hc/en-us/articles/33190289619729 , https://support.veo.com/hc/en-us/articles/43899691605521-A-step-by-step-guide-to-recording-your-matches-with-Veo-Go
20. Pixellot FAQ — https://www.pixellot.tv/faq/
21. Patents assigned to Pixellot Ltd. — https://patents.justia.com/assignee/pixellot-ltd
22. Hudl, "Training the eye in the sky" — https://hudl.com/blog/training-the-eye-in-the-sky
23. Hudl Focus FAQs — https://focusflex.hudl.com/pages/faqs , https://hudl.com/products/focus/faq/fixed
24. Hudl club soccer page (Focus Flex calibration by pitch corners) — https://www.hudl.com/solutions/club/soccer
25. PlaySight basketball SmartCourt installation guide — https://playsight.com/?p=111344
26. GamesBeat, 2020 — https://gamesbeat.com/playsight-ai-machine-learning-sports-analytics/
27. Google Research, "AutoFlip", 2020-02-13 — https://research.google/blog/autoflip-an-open-source-framework-for-intelligent-video-reframing/
28. Huang et al., "TrackNet", arXiv 1907.03698 — https://arxiv.org/pdf/1907.03698
29. Apple, `AVCaptureDevice.systemPressureState` — https://developer.apple.com/documentation/avfoundation/avcapturedevice/systempressurestate-swift.property
30. Apple Technical Note TN2445, "Handling Frame Drops with AVCaptureVideoDataOutput" — https://developer.apple.com/library/archive/technotes/tn2445/_index.html
31. Apple, "Responding to power notifications" (thermal states) — https://developer.apple.com/documentation/xcode/responding-to-power-notifications
32. Apple, coremltools optimization overview — https://apple.github.io/coremltools/docs-guides/source/opt-overview.html
33. Tarashima et al., "Widely Applicable Strong Baseline for Sports Ball Detection and Tracking" (WASB), BMVC 2023 — https://arxiv.org/pdf/2311.05237
34. Raj, Wang, Gedeon, "TrackNetV4: Enhancing Fast Sports Object Tracking with Motion Attention Maps" — https://arxiv.org/pdf/2409.14543
35. Apple, "Detecting moving objects in a video" (`VNDetectTrajectoriesRequest`) — https://developer.apple.com/documentation/vision/detecting-moving-objects-in-a-video
36. Roboflow, RF-DETR (Apache 2.0) — https://blog.roboflow.com/rf-detr-nano-small-medium/ and https://blog.roboflow.com/rf-detr-is-free-to-use-commercially/

---

## 8. Questions for Victor before Stage 2

1. F3 keeps the gesture detector's people boxes during the recording. Does that fit "no analysis starts by itself"?
2. For a heat step that must change the format, is "the buffer from before the step saved as its own clip when the
   player saves within 60 s" the behaviour wanted, or one joined clip?
3. With motion gating the night 4K clip `2fd3b0a7` changes from "left as it was" to "ball camera applied", on a worse
   path (precision 91 → 77%); the app had called it `tooSmall` at native size. Should the ball camera serve that
   clip, or should it stay as it was?
4. The export takes ~10 s for a 15 s 4K clip. Is that wait a complaint in the field tests? It decides whether I8 goes
   ahead of I3.

Victor's answers (2026-11-12): 1. It fits, as long as battery and heat do not get worse. 2. One joined clip.
3. It stays as it was, no re-analysis (the variant built keeps it "not applied", section 9). 4. Not answered yet.

---

## 9. Stage 2: what was built, and the results (2026-11-12)

Victor agreed to I1, I2 and I3; I5 went first as step 0. Checks run for all of it: `npx tsc --noEmit`, `npx expo lint`
(0 errors; 13 old warnings in test files), `npm test` (114 suites, 1,363 tests), ReplayCore `swift test` (329 tests)
and an unsigned Release `xcodebuild` of the app (BUILD SUCCEEDED) — all passing on 2026-11-12. Nothing below was run
on a phone: every time, heat and battery effect is still to be measured (section 10). The lab outputs cited here live
under `docs/focus-refs/lab/tests/`, which git ignores; the tables that matter are copied into the lab README (Stage 2
gates, test 54) and below.

Where the "quality did not drop" gate stands, item by item:
- **I5, I3 a, I3 d**: no analysis input or rule changes; nothing to measure on clips.
- **I1**: met by input parity, not by a re-run. A Python copy of the old and new frame-picking rules gives the same
  pictures on 278 app recordings; the detectors, `FocusPath` and `BallFraming` are unchanged and their Swift parity
  tests pass. The Swift `ClipScan` itself was not run on the labelled clips (that needs the phone or a Mac harness),
  and Jogadores has no labelled quality number of its own, only this input parity.
- **I2**: **not strictly met**. Basketball and arena A are identical; arena B cover 90.1 → 89.8 and night precision
  95.4 → 95.0, cover 84.5 → 83.9; per clip, b-08's ball-mode share falls 90 → 71 (others rise). That is why it ships
  off, behind a Diagnóstico switch, until Victor compares the clips on the phone (section 10, step 3).
- **I3 b, c**: **open**. They change the recording, not the analysis rules, but a clip slowed to 30 fps mid-way, or
  joined from a scaled-down part, was never analysed on labelled clips: the labelled clips' videos are not in the
  repository, only their extracted frames. What the lab shows is narrower: across 278 different recordings, a 30 fps
  recording fills every 200 ms analysis tick just as a 60 fps one does.

| Item | What the app does now | Lab before → after (labelled clips) | Default |
|---|---|---|---|
| I5 | Each Jogadores / Bola line in Diagnóstico ends with the stages (decode, people, tiles, model, path, regions per frame) and the camera's movement (pan p95, turns per 10 s) | No analysis input changes: nothing to compare | On (diagnostics builds) |
| I1 | One pass over the clip (`ClipScan`) serves both detectors: Bola on a clip with no Jogadores file finds the people in the same decode and writes it; people kept per tick in `<clip>.people.json`, so a stopped Jogadores resumes and a later Jogadores is instant; people and ball detectors side by side on a shared frame (Diagnóstico "Passe" times one after the other) | Same pictures to the detectors on 278 app recordings (41,985 Jogadores, 56,057 Bola, 0 differ; Python copy of both rules), so Jogadores and Bola are expected to give what they gave — inferred, not re-run. Bola's reference on 39 labelled clips, 1,342 points: precision 94.4 / 94.8 / 99.0 / 95.4, cover 83.7 / 83.9 / 90.1 / 84.5 (gym / arena A / arena B / night) | On |
| I1, not taken | Jogadores over the cut + margin | G4 failed: framing inside the cut moves up to 11% (2 s margin) / 8.4% (4 s) of the frame | Jogadores keeps the clip's range |
| I2 | Bola sends to the model only the tiles where the picture changed (640 px grey thumbnails, ±100 ms); what a skipped tile held stays as evidence for the still-object filter only (test 54, `mt20e`) | Regions 19 → 9.2–10.8 per frame; detector ceiling unchanged; precision 94.4 / 94.8 / 99.0 / 95.4 → 94.4 / 94.8 / 99.0 / 95.0; cover 83.7 / 83.9 / 90.1 / 84.5 → 83.7 / 83.9 / 89.8 / 83.9; no verdict changes (2fd3b0a7 stays as it was); 6 of 39 clips move, both ways, the largest b-08's ball-mode share 90 → 71 (lab README, test 54) | Off: Diagnóstico "Recortes: Só com movimento" until the phone shows the saving |
| I3 a | The camera's own pressure (`systemPressureState`, level and factors) in Diagnóstico: a line when it changes, and in every heat and battery line | — | On (diagnostics builds) |
| I3 b | First heat step from 1080p60: the running camera goes to 30 fps; writer, buffer and microphone untouched (`ThermalLadder.throttle`) | Gate open (above). Across 278 recordings, the 30 fps ones fill every 200 ms analysis tick (13,424 of 13,429; the 5 are a gap in one source file) as the 60 fps ones do (28,561 of 28,561) | On |
| I3 c | A step that changes the size (4K → 1080p, any → 720p at `critical`) keeps the old buffer readable for its 60 s (two steps in a minute keep both); a save in that time joins the old parts (scaled down to the newest size) and the new one into **one clip** (Victor's answer 2); saves waiting during the restart are answered from the old buffer instead of failing | Gate open (above); no unit test of the join (it needs AVFoundation on a device) | On |
| I3 d | Energy test: each minute's line during a recording carries the configuration (format, gesture, voice, preview); Diagnóstico groups the minutes by configuration and shows battery per hour, worst heat and worst pressure per block | — | On (diagnostics builds) |

Not built: I3 e (a cheaper gesture sample) waits for the energy test's numbers, as planned.

Known limits of what was built:
- I3 c re-encodes the older part of a joined save (`AVAssetExportPreset1920x1080` / `1280x720`) on a phone that is
  already hot; it only happens when a save in the 60 s after a size change reaches back before the change. Saves run
  one at a time, so a long re-encode also delays the saves right after it. Both are phone measurements (section 10,
  step 5b).
- After I3 b the writer keeps the 60 fps bit-rate target at 30 fps, so those minutes are written at about twice the
  bits per frame; the file size per second does not grow. To look at in the same run.
- I2 adds a 640 px thumbnail and two neighbour frames per analysed frame; whether that costs less than the ~9 tiles
  it saves is the phone's answer.

### 9.1 Phone results, round 1 (2026-11-12, iPhone 16 Pro Max, section 10 steps 1–4) `[phone]`

Six beach tennis 4K clips cut to 15 s, the same six in A, B and C (Diagnóstico files 25, 26, 14, 15). Times are
Bola + Jogadores in one pass ("analisado em"); "open → framing" is from opening the clip to the framing on screen,
including the tap.

| Run | Passe / Recortes | Seconds per cut | Model | Regions / frame | Open → framing | Ball share (6 clips) |
|---|---|---|---|---|---|---|
| A | side by side / all | 5.5–5.7 | 4.1–4.5 s | 19 | 7.4–9.6 s | 70, 67, 45, 59, 78, 91% |
| B | one after the other / all | 7.5–7.8 | 3.7–3.9 s | 19 | 10.3–11.9 s | identical to A |
| C | side by side / motion | 3.9–4.6 | 2.0–3.0 s | 8.5–12.8 | 6.1–8.0 s | 68, 63, 42, 57, 78, 85% |
| D (6 of 10) | side by side / all | 5.5–5.9 | 4.0–4.4 s | 19 | 7.7–9.0 s | identical to A |

- **I1**: Bola and Jogadores of a 15 s 4K cut in ~5.6 s, against ~10.5 s for the two one after the other on the old
  code (section 0). Side by side beats one after the other by ~2 s, with identical results clip for clip, so side by
  side stays the default. Victor confirmed that Modo Foco is instant after Seguir a Bola (no second analysis).
- **I2 on the phone**: ~24% faster (5.6 → 4.2 s), model time roughly halved, decode up 0.3 → 0.4–0.7 s (the
  neighbour frames). But the ball share drops on 5 of the 6 clips (−2 to −6 points, mean 68 → 65%) and the camera of
  the sixth changes (turns per 10 s 3.3 → 1.3). The lab had predicted no change on beach tennis. Test 55 (lab README) ruled out
  the one difference found in the code, the app's grey thumbnail (single bilinear sample, RGB mean): copied in the
  lab it costs at most a point. The cause is still open; the next step needs the phone's own detection files of the
  same six clips with and without gating. I2 stays off.
- **Heat and battery (D)**: 10 cuts back to back (6 beach tennis 4K 15 s, 4 basketball Full HD 5–8 s): the phone
  reached `fair` (camera pressure `fair`, temperature) on the 5th clip, about 45 s of continuous analysis, and stayed
  there; no slowdown (first 4K cut 5.9 s, sixth 5.7 s); battery 86 → 84% by the status bar (the app reads 5% steps:
  85% throughout); warm to the touch.
- Fixed after round 1: the pressure level is written as `nominal` / `fair` / … (it was the constant's name), and the
  energy test uses 30-minute blocks (battery in 5% steps).

### 9.2 Field test (2026-11-12, beach tennis at night by an avenue) and the lab follow-ups

- Recording `[phone]`: 43 min at 1080p60, `nominal` heat and pressure throughout (no step), battery 95 → 80% (about
  20% per hour with gesture and voice on, preview off by screen economy), 29 clips, no alert.
- Seguir a Bola went to the right edge on two clips: the path followed car lights behind the fence (lab tests 57).
  Analysis took 9–10 s for 8–12 s cuts because the shared pass also ran Jogadores over the whole (longer) clip.
- Lab answers (README tests 56–58):
  1. Jogadores over the cut + 2 s frames as well as over the whole clip: both modes can analyse only the cut + 2 s;
     a changed cut then costs only its new seconds, a shorter cut nothing.
  2. A "flat run" rule in the ball path (car lights slide at one height outside the players or as low as the far
     players' heads; the ball climbs and falls): the path drops those candidates and is chosen again, so it finds the
     real ball (main player in the 9:16 crop 26 → 100% on the worst field clip, the camera following the rally);
     the 22 own labelled clips unchanged, the night set one labelled hit of 39 less. A first version in the camera
     only kept it off the cars but left it still (Victor saw it), since the path had followed the cars instead of
     the ball.
  3. A Jogadores 9:16 does not replace Seguir a Bola for story / reels from horizontal recordings: 63% of the
     labelled balls in the crop and the hitter whole 60% of the time, against 98% and 95%; the ball as a hint closes
     part of it (93% / 86% at hint 0.5) but not the hitter.
- Proposed for the app (Victor to decide): 1 and 2 (beach tennis's ball rules), Jogadores 16:9 unchanged.
- Victor (2026-11-12): 1 and 2 to the app, no vertical Jogadores.

### 9.3 In the app (2026-11-13): the cut + 2 s, and the flat-run rule

**The cut + 2 s (both modes).** Jogadores analyses `focusRange(clip)`: the cut ± 2 s, inside the clip's own part
of the file (`FOCUS_MARGIN_MS`, `app/src/data/focusFile.ts`). Seguir a Bola asks for the same range when its pass
also makes the Jogadores file. The clip's Jogadores record keeps the range it covers (`focus.startMs` / `endMs`).
When the cut changes:
- inside the analysed range: nothing to do, the framing is instant;
- outside it: Jogadores is analysed again over the new cut ± 2 s, and the people already found are reused from the
  people file, so only the new seconds are looked at (`focusCovers`, `focusQueue.ensure`; native: `BallAnalyzer`
  makes the file again only when the old one does not cover the new range);
- a record from before ranges were kept counts as covering the whole clip, as it was made over all of it.

**The flat-run rule (beach tennis only, rules `ball-bt-t57`).** Ported to `BallPath.track` (Swift) from the lab's
`ball_track.track_flat`, with parity on 12 beach tennis clips (`ball-parity-bt.json`, now with both field clips).
Old Seguir a Bola results are analysed again the next time the mode is on; the detections are cached, so only the
path and the camera run.

One change against 9.2, found by the parity fixture before the port: the first rule also took real balls on three
clips that have no labelled frames there (the vertical web clips yt-bt-06 and bt-v-1029, and f-01, a lob 0.06
frame widths to the right of the players' range). Followed points: 85 → 76%, 66 → 48%, 84 → 78%. Two guards fix it:
- horizontal clips only (on a vertical clip a ball crossing at the far players' height looks flat);
- "outside the play area" means beyond the main players' x range ± 0.2, the same court as the court lock.

With them:
- the ten earlier parity clips give the same output as with no rule;
- the 22 own labelled clips are identical to no rule, frame by frame;
- the night set and both field clips are identical to the 9.2 run, so its numbers stand (field a: main player in the
  crop 26 → 100%; night set: one labelled hit of 39 less).

**Does it work on other distractions?** It takes out anything the path follows that slides sideways at one height
for 0.8 s or more, beyond the players' court or below the far players' heads: a car, a bike or a person walking
behind the fence, a reflection moving along a wall. It does not take out:
- things that stand still (the still filter already does);
- things that climb and fall like a ball (a second ball thrown on the next court);
- things that slide high over the court.

Not measured: the rule on the phone.

## 10. Phone protocol for Stage 2 (Victor)

Build (Mac, iPhone on the cable): `cd app && REPRIZE_DIAGNOSTICS=1 REPRIZE_FIELD_TEST_UNLOCK=1 npx expo run:ios
--configuration Release --device`. Before each round: phone off the charger, cool (`nominal` in Diagnóstico), Low Power
Mode off, Diagnóstico "Limpar". Share the Diagnóstico after each round.

What iOS tells the app about heat is a level (`nominal`, `fair`, `serious`, `critical`), not degrees: the "calor"
in each line is `thermalState`, "pressão" the camera's own reading. For a temperature, note what the back of the phone
feels like (cool / warm / hot) at the start and end of each round, or use an infrared thermometer if there is one.
Every Jogadores and Seguir a Bola line now carries battery and heat before and after the analysis; the battery comes
in 5% steps, so it shows over a round, not per clip.

"Before" for I1 is the 2026-11-12 speed-test reading on the old code: a 15 s 4K cut took 5.1 s of Jogadores plus
5.4 s of Bola, one after the other (section 0). Use 15 s cuts of 4K clips in steps 1–3 so the numbers compare.

1. **Bola on fresh clips (I1 + I5).** 6 4K clips never analysed (3 basketball, 3 beach tennis), each cut to 15 s.
   Diagnóstico: "Zerar análises", "Passe: Lado a lado", "Recortes: Todos". Open each clip, turn Seguir a Bola on,
   wait for it. Write down for each: the seconds in the "Seguir a Bola: corte ... analisado em X s" line, the stages
   at its end, "jogadores no mesmo passe", battery and "calor" before and after, and the stopwatch time from turning
   Seguir a Bola on to the ball camera showing. Then pick Jogadores on the same clip: it must be ready
   at once (no wait).
2. **Side by side against one after the other (I1).** Same 6 clips after "Zerar análises", "Passe: Um após o
   outro". Write down the same numbers. The faster one becomes the default.
3. **Motion-gated tiles (I2).** Same 6 clips after "Zerar análises", "Passe" at the winner of step 2, "Recortes: Só
   com movimento". Write down seconds, "recortes/quadro" (expect about 9–11 instead of 19), "bola em N%" and whether
   the clip was applied. Watch each Seguir a Bola clip next to step 1's: anything worse, note the clip and the second.
4. **Ten clips in a row (heat).** With the variant that won, analyse 10 fresh 15 s cuts back to back. Write down the
   heat state and battery before the first and after the last, and the seconds of the first and the last clip.
5. **Heat step during a recording (I3 b, c).** Phone on the cable, Xcode → Window → Devices and Simulators → the
   iPhone → Device Conditions → Thermal State (Fair / Serious / Critical), with a recording running at 1080p60:
   a. `serious` for more than 2 minutes: Diagnóstico must show "câmera: 1080p30 sem reiniciar (calor) — buffer
      mantido" and **no** "reiniciando". Save a clip right after: it must contain the play from before the step, with
      sound, and play smoothly.
   b. At 4K30 (Pro), `serious` for 2 minutes: "reiniciando em 1080p30 ... buffer anterior mantido". Save within 10 s:
      the clip must be **one** clip covering before and after the step (the first part a bit softer: scaled down),
      and its length must match. Note how long the save took; then save twice in a row and time both (saves wait
      for each other). Before Stage 2 this step restarted the camera and the clip had only what came after it.
   c. `critical`: same as b, to 720p30. Then `critical` again within a minute of b: the clip must still be one,
      covering both steps.
   The Xcode condition moves the camera's pressure too (round 2, 2026-11-12: "pressão serious" at the same second).
   Do not touch the phone between 1:50 and the save, except to save: leaving the app (Control Center, a
   notification) interrupts the camera, and an interruption empties the buffer (as before Stage 2), which hides
   what the step did. Screen economy can be off for this step.
6. **Energy test (I3 d).** Same place, phone on a tripod, 1080p60, recording for 4 blocks of **30 minutes** with
   one thing changed per block: (1) gesture on, voice off, screen economy on; (2) gesture off; (3) voice on; (4)
   screen economy off. Then one block at 4K30 with (1)'s settings. The blocks can be spread over several sessions (same
   place, similar time of day, each starting cool and above 50% battery). Read the "Teste de energia" box in
   Diagnóstico: battery per hour, worst heat and pressure for each block. iOS gives apps the battery in **5% steps**
   (seen on the phone, 2026-11-12: 95 → 90 between two analyses), so at the ~23% per hour measured at 4K30 a 30-minute
   block moves about two steps: compare blocks only when they differ by more than one step (10% per hour). For a finer
   reading, run the same blocks from Xcode over Wi-Fi (Window → Devices and Simulators → "Connect via network", then
   Debug Navigator → Energy Impact): never on the cable, which charges the phone.
7. **In the sun (I3).** One recording of 30+ minutes at 1080p60 in direct sun, phone on its usual mount: write down
   when "calor" reaches `fair` and `serious`, whether the 30 fps step came, and whether "pressão" went down after it.

What to send back: the Diagnóstico files of each round and the clips from step 3 and 5 that looked wrong.

## 11. Ball detection: is today's approach the best one available?

Today: a single-frame detector (YOLOX-Tiny, one class, 416 px tiles, Apache 2.0) on every analysed frame, then an
offline path (dynamic programming over the candidates) with per-sport rules. On the labelled sets the detector finds
the ball on 88.7–95.2% of labelled frames (its ceiling) and the path follows it on 83.7–90.1% of the labelled frames at 94–99% precision
(section 1.8, test 54). The gap that matters is the ceiling: the path cannot follow a ball the detector never saw,
and the frames it misses are the hard ones for a single picture (blur, a small ball at night, a ball against a
busy background). So the next gain in % comes from the detector seeing more, not from the path.

What the field does for exactly this problem:
- **Several frames as the model's input.** WASB (BMVC 2023) feeds consecutive frames to a high-resolution network and
  beat six earlier ball trackers on five datasets from different sports [33]; TrackNetV4 adds frame-difference "motion
  attention" to the TrackNet family and improves tennis and shuttlecock tracking [34]. The lab's test 27 ran
  TrackNetV3 without retraining and it did not work on basketball; nobody has trained one of these on our labels.
  The licenses of WASB's and TrackNetV4's code were not verified from here (check before any use).
- **Newer single-frame detectors.** RF-DETR (Apache 2.0, 2025) reports better accuracy than YOLO11 at similar
  latency [36]. A better single-frame model may raise the ceiling a little; it cannot use motion, and its Core ML /
  Neural Engine behaviour is unknown.
- **Apple's trajectory request.** `VNDetectTrajectoriesRequest` finds objects moving on a parabola, needs a fixed
  camera [35], and comes with iOS: no model to ship. Arcs fit beach tennis and volleyball better than a dribble.

Recommendation, in order, all lab-only first (each needs Victor's ok before any model is trained or swapped):
1. **Motion as an input channel of today's detector**: add the frame difference (already computed for I2) as an extra
   input to YOLOX-Tiny and retrain on the same data. Cheapest test of the multi-frame idea; same app pipeline.
2. **A multi-frame model trained on our labels** (TrackNetV4-style or WASB) for beach tennis, where the ball is
   smallest: compare its ceiling on the night set (89.6% today) and its cost in FocusBench.
3. **`VNDetectTrajectoriesRequest` as extra candidates** on the Mac, on the labelled beach tennis clips: free to try,
   no training.
4. **RF-DETR-Nano** trained on the same data, as an A/B of the single-frame detector.
More labelled clips of the hard cases (night, far court, ball against the crowd) help every one of these.

