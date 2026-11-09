# Reprize: "Seguir a Bola" (vertical camera that follows the ball) — design

> Date: 2026-11-09. Status: **draft for implementation; product decisions confirmed by Victor (2026-11-09)**.
> Scope: iPhone, basketball only in v1. Replaces nothing: today's Modo Foco (`2026-10-23-focus-mode-design.md`) stays
> the default framing. Supersedes the one-tap ball tracker of `2026-11-04-focus-mode-ball-design.md` (EdgeTAM, on
> hold), which this design does not need.
> Evidence: the Modo Foco lab, `docs/focus-refs/tools/lab/README.md`, tests 28–42 (2026-11-07/09): the basketball
> detector, the ball path, the 9:16 camera, the phone cost on FocusBench (iPhone 16 Pro Max).
> Layouts: the "Seguir a Bola — layouts" design canvas (A1, A2, A3, B1, B3; B2 not chosen).

## 1. Goal

In the clip editor the player switches on **Seguir a Bola**. The app finds the ball in the cut clip and shows the clip
as a **vertical 9:16 video whose camera follows the ball**, ready for Stories, Reels, TikTok and Shorts. Saved and
shared clips come out the same way.

Success looks like this:
- the ball inside the 9:16 picture as in the lab: 96–98% of the labelled points at 1.2x on our gym and on other courts
  (tests 38, 40);
- the analysis takes about 0.4 s per second of clip on an iPhone 16 Pro Max (test 42), and once only per clip and cut;
- switching between Modo Foco and Seguir a Bola after both are ready is instant.

Non-goals for v1:
- other sports (beach tennis, tennis, volleyball: their own lab tests first);
- a tap on the ball (EdgeTAM);
- live framing while recording;
- horizontal output that follows the ball;
- Android.

## 2. Decisions

| Decision | Detail |
|---|---|
| Name | **"Seguir a Bola"** (Victor, 2026-11-09). It names the behaviour, not a network, so it fits Stories, Reels and TikTok alike. |
| Where | Edit screen, **Foco panel**, a second switch under Modo Foco (layouts A1/A2). Not an export option. |
| One or the other | Switching Seguir a Bola on switches Modo Foco off, and the reverse. Neither on = the original picture. |
| Processed once | Each mode is computed once per clip and cut. Switching back to a mode already computed is instant (§4.6). |
| Output | Always vertical 9:16, whatever the recording's orientation. Modo Foco keeps the recording's orientation. |
| No tap | The detector alone drives the camera (tests 35–40 scored exactly that); no EdgeTAM in the app (test 42). |
| Detector | `ball_tiny_gym`: YOLOX-Tiny (Megvii, Apache-2.0), one class, 416 input, trained on the public "basketball_detection" (cvsense, Roboflow Universe, **CC BY 4.0**) + "not a ball" crops + Victor's own gym recordings (test 38). Core ML: `lab/coreml/ball_tiny_gym.mlpackage` (about 10 MB, FP16). |
| Data policy | Only data with a licence that allows commercial use, or our own recordings. Web videos are used to measure, never to train (Victor, 2026-11-09, test 40). |
| Credit | The licences screen lists "basketball_detection (cvsense, Roboflow Universe), CC BY 4.0" and YOLOX (Apache-2.0). |
| First-use notice | A sheet the first time the switch is tapped (layout B1), the same pattern as "Prepare o celular", with "Não mostrar de novo". Its main action sends the player to cut the clip first. |
| Progress | Only on the video (layout A3): a chip "Seguir a Bola · analisando N% · ~S s", a thin amber bar on the video's bottom edge and a ✕ to cancel. Nothing extra in the panel. |
| Plans | As Modo Foco: works in the app on every plan; only a paid export carries it (same PRO pill and hint). |
| Sport | Basketball recordings only. In other sports the row shows "EM BREVE", disabled (layout B3). |

## 3. Facts from the lab that shape the design

| Fact (test) | Consequence |
|---|---|
| The detector must see the whole frame and **all 416 px tiles** on every analysed frame; cheaper tile plans lose the ball (tests 32, 37: cover 63% vs 75% on our gym). | All tiles + whole frame, every analysed frame. |
| 5 analysed frames per second; 2.5 fps loses the ball (test 42, simulated: cover 82 → 64% on our gym). | One analysed frame every 200 ms. |
| Path by dynamic programming over all the candidates of the clip; still-object filter `still_share` 0.5 for basketball (test 35: cover 57 → 71%). A motion model (Kalman idea) does not help a dribbled ball at 5 fps (test 39). | Port `ball_track.py` (dp=1) as is. |
| Camera C (dead zone 0.10, smoothing s3) and a zoom per clip (test 31); fallback to today's 9:16 framing where there is no ball. | Port camera C and the zoom rule; it reads Modo Foco's portrait framing as the fallback. |
| One Core ML call per frame for its 19 regions (`predictions(fromBatch:)`) gives identical outputs (max difference 0) and costs 2.5–2.9 ms per region against 11–13 ms one call per region (test 42). | Batched calls. |
| 30 s clip: ~11 s (batched, no EdgeTAM) vs 64 s (test 34). Thermal "fair" after ~1 min of nonstop work, "serious" after ~6.6 min nonstop (test 42); real use is one cut clip at a time. iPhone XR (A12): 36.5 → 45.6 s per 30 s clip (3.4x), "serious" from the 3rd clip (1.4 min nonstop), though not warm by hand (test 42). | A started analysis always finishes; a new one waits while `serious` (§4.4). |
| Variable-frame-rate sources: frames must be placed by their presentation time, never by count (test 40). | The analysis and the export read timestamps. |
| Results held across courts: our gym 82% cover / 92% precision (test 38, by halves); other courts 82% / 90% (test 40). Weakest: outdoor, a far small ball. | Expectation for the field test; a note when the ball is rarely found (§4.1). |

## 4. Design

### 4.1 Interface (layouts A1, A2, A3, B1, B3)

- **Foco panel**: row 1 "MODO FOCO" (as today); row 2 "SEGUIR A BOLA" with a NOVO pill for the first weeks, hint
  "A câmera segue a bola, na vertical 9:16 para Stories, Reels e TikTok.", and the same switch component.
- **Switching on** (first time ever): the B1 sheet. "Cortar o lance primeiro" closes the sheet, leaves the switch off and
  opens the cut. "Seguir o clipe todo" closes it and goes on. "Não mostrar de novo" starts on, as in `PrepareSheet`.
- **While analysing** (A3):
  - the video keeps playing the current picture;
  - the chip shows the percentage and the estimate (0.4 s per clip second on the reference phone, corrected by the
    measured speed after the first frames);
  - ✕ cancels: the switch goes back off and the detections done so far are kept (§4.6);
  - Modo Foco can be switched on at any time: that is instant and stops the analysis, keeping what was done.
- **When ready** (A2): the preview shows the 9:16 result, centred in the video area with black sides. The chip reads
  "Seguir a Bola · 9:16". "Mantenha o dedo pressionado no vídeo para ver o clipe original" works as with Modo Foco.
- **Pinch zoom** switches Seguir a Bola off, as it does Modo Foco ("Com zoom manual o Modo Foco desliga" extends to both).
- **Ball rarely found**: if the path has the ball in under 35% of the analysed frames (test 31's guard), show once under
  the chip "Bola pouco visível neste trecho: a câmera segue os jogadores quando a perde."
- **Heat** (Victor, 2026-11-09, after the XR run): an analysis that has started always finishes (it starts cool and a
  10 s cut is ≤ 15 s even on an XR). While the phone is `serious`, a new analysis does not start: it waits with the chip
  "Seguir a Bola · esfriando o celular" and starts by itself at `fair` or `nominal`. At `critical` it stops at once.
- **Other sports** (B3): the row is disabled with an "EM BREVE" pill and the hint "Por enquanto só no basquete.".
- **Unsupported phones** (§4.7): the row is not shown.
- Copy: pt-BR and en, in `src/i18n/locales` under `clip.*` beside the Modo Foco keys.

### 4.2 Edit model

`Edit` gains the framing choice as one field, so both modes can never be on together:

- `framing: 'focus' | 'ball' | 'none'`, default `'focus'`;
- a migration reads today's `focus: boolean` (true → `'focus'`, false → `'none'`);
- `readEdit` keeps exposing `focus` for the existing callers (`framing === 'focus'`);
- `toggleFocus` / `toggleBall` set `framing`;
- pinch zoom sets `framing` to `'none'`, as today for Modo Foco.

### 4.3 Native analysis (`BallAnalyzer.swift`)

A sibling of `FocusAnalyzer`, in `modules/replay-camera/ios`, with the same shape (one at a time, cancellable,
`Outcome`, `Failure`):

1. `AVAssetReader` over the cut's missing frames, 420f (as FocusBench measured; Core Image converts). The cut's 100 ms
   grid (`BallFraming`): row k at `startMs + k × 100`; every 2nd row is analysed (5 fps), with the picture that is the
   first at or after its tick within 100 ms, by presentation time. The analysed rows' parity follows the cache, so a
   cut moved by 100 ms still reuses it.
2. Regions per frame (exactly as FocusBench's `BallDetector`, which matches the lab's `ball_detect.py`; `BallDetect`):
   - the whole upright frame, letterboxed into the top-left of a 416 grey (114) square;
   - every 416×416 tile, with origins from `starts(n, 416, overlap 80)` on each side.

   A 1080p frame gives 19 regions.
3. One `model.predictions(fromBatch:)` per frame, compute units `.cpuAndNeuralEngine`.
4. Decode **every** candidate with objectness × class ≥ 0.05, not only the best one, because the path needs them all.
   Tile candidates go back to frame coordinates; then, as the lab, all of the frame's candidates go through NMS at IoU
   0.5 (highest score first, ties in region order) and are stored 0..1 with 4 decimals (score 3).
5. Write the detections cache (§4.6), then run the path and the camera (§4.5) and write the framing file.

Implementation (part 2): `ios/BallAnalyzer.swift` (reader, Core ML, heat, cancel, files) on top of `Core`'s
`BallDetect` (regions, anchors, decoding, NMS) and `BallFraming` (grid, cache, path → trust → zoom → camera, file
contents), tested in `BallFramingTests` (the parity fixture through `BallFraming.compute`). The module exposes
`analyzeBall`, `cancelBall`, `probeBall` and the event `onBallProgress` (`done`, `total`, `state` cooling / running /
framing) for the chip and bar on the video. The model ships compiled (`ios/Models/ball_tiny_gym.mlmodelc`, made with
`xcrun coremlcompiler compile` from the lab's .mlpackage) in the pod's `ReplayCameraModels` resource bundle; a build
without it rejects with `BALL_NO_MODEL`.

Queue: its own, separate from the Modo Foco queue, which keeps running in the background as today.
- It starts only from the switch.
- Foreground only, never while the camera is on (`focusHold`).
- Priority `.userInitiated`: the player is waiting.

### 4.4 Heat and battery

- Read `ProcessInfo.thermalState` before starting and between frames:
  - before starting, `serious` or worse: wait (queued, §4.1) until `fair`;
  - during an analysis, `serious`: carry on to the end of the clip;
  - `critical`: stop, keeping the detections done so far in the cache.
- No other throttling: a 10 s cut is about 4 s of work on a 16 Pro Max, 12–15 s on an XR (test 42).

### 4.5 Path and camera (Swift port of the lab, in `Core`)

These modules are pure functions over arrays, unit-tested against lab fixtures (§5):

| Swift (Core) | Lab source | Content |
|---|---|---|
| `BallPath` | `tools/lab/ball_track.py` (`track`, `dp_track`, `finish`; `P` + `SPORT_P`) | shape filter (box ≤ 6% of the long side, aspect ≤ 2.5, score ≥ 0.05), still filter (`still_r` 0.02, `still_win` 20, `still_share` **0.5** for basketball), Viterbi path (`s0` 0.05, `vmax` 0.12, `move_cost` 1.0, `dp_gap` 10, `still_cost` 0.05, `min_len` 3, extra disjoint paths while value > 0.5), upsample to 100 ms (`low_fps.upsample`). `dp=2` / `fill` are NOT ported (test 39). |
| `BallTrust` | `tools/lab/hybrid.py` `trusted` (basketball branch) | per-100 ms ball point or nil. |
| `BallCamera` | `tools/lab/story.py` `camera` with `CAMS["C"]`, `sg_framing.target_x(mode "hold", bridge 10)`, `sg_lazy3.band_path` / `bridged` and their constants | 9:16 crop per 100 ms: x follows the ball inside a dead zone of 0.10 of the crop width, smoothing (3, 300); y keeps the ball between `TOP`/`BOTTOM`; where there is no ball, it eases to Modo Foco's portrait framing (`.focus.json` `portrait` rows). |
| `BallZoom` | `tools/lab/story.py` `auto_zoom` (test 31) | one zoom per clip: min of content (Modo Foco's median zoom × 1.0 landscape / × 1.2 portrait recordings), quality (≤ ×2.2 scale-up to 1080 wide), ball (largest zoom keeping the detector's own points inside but 3%), guard (ball in < 35% → the safe zoom). |

The output is `<clip>.ball.json`, the **same format as `.focus.json` v1**:
- `"v": 1`, `"rules": "ball-t42"`, `stepMs` 100, `startMs`, `size`;
- a `portrait` track of normalized rects; there is no landscape track.

The editor preview (`stage.ts`, `focusFile.ts`) and the exporter (`FocusFile.segments`) can then read it with
`aspect: 'portrait'` as they read Modo Foco's.

Modo Foco must be ready before the camera runs, because the camera uses its portrait framing as the fallback. Modo
Foco's analysis is fast and normally already done; if not, the ball analysis waits for it, and the chip shows "analisando".

### 4.6 Files and caching

These files sit next to the clip and are deleted with it (`mmkv.ts` cleanup list):

| File | Content | Valid while |
|---|---|---|
| `<clip>.balldet.json` | per analysed frame (by presentation ms): its candidates `[cx, cy, w, h, score]`; the model id (`ball_tiny_gym`), the frame size | the model id is the same |
| `<clip>.ball.json` | the 9:16 framing (§4.5) for one cut | the cut, the detections and the camera rules are the same |

- **Change of cut**: frames already in `.balldet.json` are reused. Only frames outside it are analysed (a longer cut).
  Then the path, trust, camera and zoom are recomputed, which takes milliseconds. Shortening the cut needs no new
  detection.
- **Cancel or switch to Modo Foco mid-way**: the detections so far stay. Switching Seguir a Bola back on continues
  from there.
- **Switching modes when both are ready**: no work at all; the preview and the export just read the other file.
- The `Clip` record gains `ball?: { status: 'pending' | 'running' | 'ready' | 'failed'; path; startMs; endMs }`, beside
  `focus`.

### 4.7 Phones

- Measured: iPhone 16 Pro Max (A18 Pro).
- **Before release, measure FocusBench `det5b` on an iPhone 12 or 13** (A14/A15). Show Seguir a Bola where a 30 s
  clip analyses in under ~30 s. **Revised (Victor, 2026-11-09): the gate is per typical cut, not per 30 s clip**:
  show the option where a 10 s cut analyses in about 20 s or less, i.e. `probeBall` ≤ 400 ms per 19-region frame
  (50 frames). The iPhone XR (≈ 245 ms, 10 s cut in 12–15 s) passes.
- Gate by a one-time probe at first use: run one 19-region batch (`probeBall`), and time it as the existing focus
  probe does. Hide the row on phones above 400 ms per frame.

### 4.8 Export

`exportOptions.ts`:
- when `framing === 'ball'` and the ball file is ready, the output size is **portrait** (1080×1920 for a paid 1080p
  export, the free size otherwise) whatever the clip's orientation;
- `focus` becomes `{ path: ballPath, aspect: 'portrait' }`.

`ClipExporter` places frames by presentation time, as today. The watermark goes in its portrait position. The Story
template with bands (`share/layout.ts`, "never crop the court") stays for clips exported without Seguir a Bola.

## 5. Quality parity with the lab (the release gate)

The port must reproduce the lab, because the quality decisions were measured there:

1. **Fixtures**: export from the lab, for 4 clips, the detections (`bgym-n5` / `bgymall-n5` JSON) and the expected
   outputs. Clips: basket-app-1107-a, basket-app-1108-c, basket-ext-1109-b, yt1105-basket-a. Expected outputs:
   `ball_track` points, `trusted` points, camera C rects at the clip's zoom, and the chosen zoom.
2. **Core unit tests**: `BallPath`, `BallTrust`, `BallCamera` and `BallZoom` on those detections must match the
   expected outputs: the same frames with/without ball, positions within 1e-4, rects within 1e-3, the same zoom.
3. **Detector on device**: run `BallAnalyzer` on the 4 clips in a debug build. Its candidates must match the lab's
   ONNX detections: the same counts at score ≥ 0.05; best candidate within 2 px; scores within 0.02 (FP16).
4. **End to end**: export the 4 clips with Seguir a Bola and compare them by eye with the lab's
   `story-compare-t38/t40` videos.

## 6. Plan

1. Core: `BallPath`, `BallTrust`, `BallCamera`, `BallZoom` + fixtures and tests (§5.1–2).
2. Native: `BallAnalyzer` + module bridge (`analyzeBall`, `cancelBall`) + model in the bundle (`ball_tiny_gym.mlpackage`).
3. JS: `Edit.framing` + migration, ball queue, `Clip.ball`, Foco panel row, chip states, B1 sheet, B3 state, pinch rule,
   export options, licences screen, i18n.
4. Device checks: §5.3–4, FocusBench `det5b` on an older iPhone (§4.7).
5. Field test: Victor's club, basketball, cut clips, Seguir a Bola on; compare with Modo Foco by eye.

## 7. Open points

- **Attribution (CC BY 4.0)**: the detector's training data asks for credit, "basketball_detection (cvsense, Roboflow
  Universe), CC BY 4.0", in the app's credits/licences before release (lab README, test 33). Tracked in
  `docs/superpowers/backlog.md`.
- Analytics: a `ball_framing` event (clip seconds, analysis ms, ball share, zoom, thermal before/after), as for Modo
  Foco.
- A recording made in portrait already has the 9:16 shape. There Seguir a Bola zooms in and follows (test 31's
  vertical rule, up to ~2x). Victor to confirm by eye in the field test.
