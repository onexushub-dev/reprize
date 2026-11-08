# Repplay: Modo Foco with the ball — design

> Date: 2026-11-04. Status: **draft; decisions confirmed by Victor (2026-11-04); two passes at 5 fps chosen
> 2026-11-05 (amendment after section 5)** (no app code yet). **On hold (Victor, 2026-11-05):** on video only one app
> clip (basket-rp-1105-v-a) was good enough to use; production keeps today's Modo Foco. Kept for a later ball tracker.
> **Still on hold (Victor, 2026-11-06), best path so far recorded in section 11** (detector + EdgeTAM, lab tests
> 17–19); Victor is testing other methods before any app work. Scope:
> iPhone, A14 (iPhone 12) or newer.
> Builds on `2026-10-23-focus-mode-design.md` (Modo Foco, players only), whose framing stays the base and the fallback.
> Evidence: the Modo Foco lab, `docs/focus-refs/tools/lab/README.md` (tests 1–11, 2026-11-03/04): EdgeTAM one-click
> tracking, the hybrid framing reviewed by Victor on video (rounds 1–6), Core ML on the Mac, FocusBench on the iPhone
> 16 Pro Max and the iPhone XR.

## 1. Goal

The player taps the ball once in a saved clip and the virtual camera follows the play faster: it frames the ball while
the tracker is sure of it, and goes back to today's Modo Foco (players) when it is not. The rest of Modo Foco (preview,
export, mark, on/off) works as today.

Success looks like:
- One tap on the ball in the editor is all it takes; the clip is reframed in the background and eases into the new
  framing when ready.
- The camera reaches the ball on fast plays (passes, shots, smashes) and returns to the players when the ball is lost,
  out of play or hidden, without jumps.
- No vertical bobbing on dribbles and bounces; throws and lobs are followed upward only as far as needed to keep the ball
  in the picture (Victor's reviews, rounds 3–4).
- No framing on rackets, hands or a ball lying on the floor (rounds 5–6).
- What the editor shows is what is exported.

Non-goals (v1): finding the ball without the tap (section 10), live framing while recording, following one chosen
player, Android.

## 2. Decisions

Confirmed by Victor on 2026-11-04 (✔), next to the ones taken in the lab.

| Decision | Detail |
|---|---|
| Free resources only | Tracker: EdgeTAM (facebookresearch, Apache-2.0; RepViT backbone via timm, Apache-2.0). No AGPL/GPL (no Ultralytics). The NOTICE / licenses screen lists EdgeTAM. |
| Reference quality | Victor's approved lab videos: SAM 2 v4 for basketball and beach tennis (yt-basket-04, yt-bt-06), SAM 2 v5 for the hard app clip (bt-wa-1028); the on-device EdgeTAM + ROI + round 6 result was judged "bem satisfatório" (2026-11-03) and the framing from the Core ML track "bem satisfatório" (2026-11-04). |
| Framing rules | Round 6 of the lab (`tools/lab/hybrid.py`, default `T`), ported to Swift (section 4.5). |
| ✔ Trigger: one tap on the ball | A "Seguir a bola" action in the editor; the player pauses on a frame where the ball shows and taps it. All lab results start from such a click. |
| ✔ After the tap, in the background | Like today's analysis: a queue, one clip at a time, `.utility`, waits while recording or when hot. Progress shows on the Modo Foco chip. |
| ✔ Ball zoom 2.0x | Victor asked for more zoom while the ball is certain (round 2); 2.0x was approved on video. This is above the 1.5x cap of the players' framing (Full HD: about 540p at 2.0x), accepted. |
| ✔ Recommended phones only | A14 (iPhone 12) or newer, where everything runs on the Neural Engine. Older phones (the app supports the XR, A12) keep today's Modo Foco and do not show "Seguir a bola" (the XR measured about 7x the clip length and got warm). A one-time probe confirms the fast path on each phone (section 4.3). |
| ✔ Plans | As Modo Foco (section 9 of the base spec): works in the app on every plan; only a paid export carries it. |
| ✔ Models in the app bundle | Four Core ML models, about 40 MB (FP16): works at once and offline (no signal at the court). Speed, battery and heat would be the same if downloaded; download on first use (On-Demand Resources or a CDN) stays a later option if the install size matters. |

## 3. Facts that shape the design

| Fact (lab test) | Consequence |
|---|---|
| Classical detection (MOG2, test 4) and Vision trajectories (test 3) do not find the ball well enough. SAM 2 / EdgeTAM from one click follows it (tests 1, 7). | A video tracker from one tap. |
| EdgeTAM on the whole frame loses far, small balls (beach tennis); a 40% square crop around the first-pass ball (ROI, test 8) fixes most of it: bt-wa-1028 ball mode 74% vs SAM 2's 61%; yt-basket-04 100%; bt-E5003B6B 94% of the labelled balls inside the crop. 20/30 fps did not help (test 7). | Two passes at 10 fps: the whole frame, then crops cut from the full-resolution video around the first pass. |
| Round 6 filters (test 9): a mask in pieces, a jump after a gap, a gap bridged only when the ball comes back near. | Part of the framing rules. |
| Core ML needs fixed shapes. EdgeTAM's memory bank (7 frames, 16 object pointers) is kept full, empty slots switched off in the attention: the same mask as EdgeTAM's predictor (test 10, IoU 100% in fp32, bank in fp16). Filling empty slots with copies instead lost the ball (74% → 60% ball mode). | Four models + a loop in Swift; the switch-off is required. |
| Mac, Core ML FP16 (test 10): same quality as PyTorch EdgeTAM on every compute unit (yt-basket-04 100% ball mode / 98% hits on labels; bt-wa-1028 74–79%; yt-bt-06 82–90%). | FP16 models are enough. |
| iPhone 16 Pro Max (test 11): everything on the Neural Engine; models 66 ms per frame (encoder 18, attention 38, decoder 4, memory 6), 122 ms with the bench's image decoding and copies; 30 s clip in 37 s (one pass); thermal nominal → fair; track = the Mac's (0.1–0.2 px). | Fast path. |
| iPhone XR (A12): its Neural Engine cannot run the attention (1.6–2.6 s, mostly on the CPU) nor the memory model well; its GPU aborted the app on Core ML's fused attention kernel and refused two rewrites. With encoder on the Neural Engine and the rest on the GPU: 0.55–0.72 s per frame, 216 s for a 30 s clip (one pass), thermal fair → serious; track = the Mac's. | Slow path, chosen per phone at run time; the models are exported in the form that works on both (`attention_pairs_soft`, spelled-out softmax). |
| FocusBench measured one pass on prepared crops. The app does two passes and reads its own frames. | Budget in section 5. |

## 4. How it works

```
editor: "Seguir a bola" ─► tap on the ball (time t, point x,y) ─► BallQueue (JS, one at a time)
                                │ trackBall(clipPath, startMs, endMs, seed)                 native, background
                                ▼
 BallTracker (iOS)  pass 1: AVAssetReader 10 fps, whole frame ─► EdgeTAM loop ─► mask summaries
                    ROI path (Core, from pass 1 + the players' path)
                    pass 2: the same frames, 40% crops at full resolution ─► EdgeTAM loop ─► mask summaries
                                ▼
                    BallFramePath (Core, pure): trusted ball ─► ball segments ─► hybrid with the players' path
                                ▼
                    <clip>.ball.json (track) + <clip>.focusball.json (path, same format as .focus.json)
                                ▼
            clip.ball = { status: 'ready', … } ──► preview and export use the ball path instead of the players' path
```

### 4.1 Models (`EdgeTAM*.mlmodelc`, made by `tools/lab/coreml_export.py export`)

| Model | Inputs | Outputs |
|---|---|---|
| encoder | image 1024×1024 RGB (normalised inside) | `feat_s0` 1×32×256×256, `feat_s1` 1×64×128×128, `vision` 1×256×64×64 |
| attention | `vision`, `mem` 7×512×64, `ptr` 16×256, `mem_on` 1×7, `ptr_on` 1×16 | `pix` 1×256×64×64 |
| decoder | `pix`, `feat_s0`, `feat_s1`, `points` 1×2×2 (1024 px), `labels` 1×2 | `mask` 1×1×256×256 (logits), `obj_ptr` 1×256, `score` 1×1, `ious` 1×3 |
| memory | `vision`, `mask`, `hard` 1×1 | `mem` 1×512×64 |

Constants (`edgetam_constants.json`): `no_mem_embed` (256 values). FP16, iOS 16 target, about 40 MB in all. The export
script self-tests every wrapper against EdgeTAM's own code (max difference ≤ 1e-6) and is the only way to remake them.

### 4.2 Tracking loop (Swift; reference: `coreml_export.py` `track`, FocusBench `EdgeTAM.swift`)

- Frames every 100 ms over the clip's bounds, as today's analysis.
- Clicked frame: encoder → `pix = vision + no_mem_embed` → decoder with the tap (label 1) and a pad point (label −1) →
  memory with `hard = 1` (binarised mask, as EdgeTAM's video predictor).
- Then forward from the click to the end, then backwards from the click to the start, with **one** bank for both
  directions. Per frame: encoder → attention with the bank → decoder with no points (labels −1, −1) → memory (`hard = 0`).
- Bank: slot 0 = the clicked frame; slots 1–6 = frames f−6 … f−1 (f+6 … f+1 going backwards); pointers: the clicked
  frame, then f−1 … f−15. A frame not tracked yet leaves its slot empty: `mem_on` / `ptr_on` = 0 (never a copy).
  Memory features kept in FP16.
- Per frame output: the mask's largest 8-connected piece on the mask upsampled to the analysed image (bilinear,
  `align_corners = false`): `[cx, cy, x, y, w, h, area, main]` in 0..1 (as `server.py` `summarize`; the Swift version is
  checked equal on random masks), and `score`.
- Pass 2 maps the summaries back from the crop to the whole picture (`roi_back`).

### 4.3 Which phones

- **Gate**: "Seguir a bola" shows only on A14 or newer: model identifier `iPhone13,1` or later (iPhone 12 family and
  everything after it, including the SE 3rd generation, `iPhone14,6`). Everything runs on the Neural Engine
  (`MLComputeUnits.cpuAndNeuralEngine`).
- **Probe**: on first use, the four models are loaded and timed with a few calls on dummy inputs (about 5 s, as
  FocusBench's "Probe"). If a model fails to load or the total is above 150 ms per frame, the phone is treated as not
  recommended (no "Seguir a bola") and the result is logged. Kept in `Prefs` per app version.
- Known: iPhone 16 Pro Max 66 ms per frame (all on the Neural Engine). Not measured yet: A14–A17 (field checklist).
- Not used in v1: the GPU path the XR needed (encoder on the Neural Engine, the rest on the GPU). The exported models
  keep the form that works there (`attention_pairs_soft`, spelled-out softmax), so it stays possible later.

### 4.4 ROI (`BallRoi`, Core, pure; reference: `tools/lab/roi.py`)

- Path of crop centres per 100 ms frame: the pass-1 trusted ball (round-6 filters) inside its ball segments, bridged
  across gaps up to 1 s; elsewhere the centre of the players' framing (today's `.focus.json`). Gaussian σ 0.3 s.
- Square side = 40% of the video's long side, capped at the short side, kept inside the picture.
- Crops cut from the video frame at full resolution (1080p capture), then scaled to 1024 by the encoder's image input.
- **The tap must be inside the crop at its own frame (fix of 2026-11-05, lab test 15):** where pass 1 does not trust the
  ball at the tap, the path sits on the players and the tap fell outside the crop on 4 of 22 lab clips (pass 2 then
  starts from nothing). The crop at the tap's frame moves so the tap is at least 25% of the side inside it; the
  frames around follow, fading over a Gaussian of 3 frames (`roi.py` `seed_inside`).

### 4.5 Framing rules (`BallFramePath`, Core, pure; port of `tools/lab/hybrid.py` round 6)

Input: the pass-2 summaries per frame, the players' path (`.focus.json`), the sport, the frame size. Output: crop rects
per 100 ms, same format and aspect as today's path. Values in one `BallTuning` struct (the lab's `T`):

1. **Trusted ball**: area ≤ 0.3% of the frame, box ≤ 6% of the long side, fill ≥ 0.45, aspect ≤ 3, largest piece
   ≥ 70% of the mask; jump from the last trusted position ≤ 9% of the long side per frame, the allowance growing with the
   gap up to 8 frames; not still (within 1.2% over ±1 s: a ball on the floor). Racket sports (beach tennis, tennis,
   padel, table tennis, volleyball, beach volleyball, footvolley): aspect ≤ 2, fill ≥ 0.6, a mask that grows 2.5x must
   move like a ball for 6 frames before it is trusted again, a slow mask (path < 10% over ±0.5 s for 6 frames) is a
   racket held still.
2. **Ball mode**: segments of trusted frames joined across gaps up to 1 s only when the ball comes back near where it
   was lost; a segment needs 3 trusted frames.
3. **Ball rect**: 2.0x zoom, centred on the ball smoothed with σ 0.2 s, inside the picture. Vertical: the camera stays
   as close to the players' height as it can and moves only to keep the ball's highest point 15% of the crop below its top
   and its lowest point 10% above its bottom, over the last 0.8 s and the next 0.3 s; it rises at once and comes down at most 0.2 frame
   heights per second; σ 0.4 s.
4. **Blend**: ramp into ball mode over 0.5 s before the segment (offline, the camera starts early), out over 0.2 s after
   it; the two rects blended by that weight; a final σ 0.1 s; sizes and positions clamped inside the picture.

A port test runs the Swift on the lab's tracks and paths and must match `hybrid.py` (as `FocusPathTests` does for
`focus_variant.py`).

### 4.6 Storage

- `Clip.ball?: { v: 1; status: 'pending' | 'ready' | 'none' | 'failed'; seed: { ms, x, y }; file?: string; path?: string }`.
- `<clip>.ball.json`: `{ v: 1, stepMs: 100, startMs, size, seed, units, track: [[cx, cy, x, y, w, h, area, main] | null], score: [] }`
  (pass 2, whole-frame coordinates; ~30 KB per 60 s).
- `<clip>.focusball.json`: the framing path, same format as `.focus.json`, plus `ballSegments`. Preview and export read
  it in place of `.focus.json` when `clip.ball.status = 'ready'` and Modo Foco is on.
- `none` = fewer than 10% of the frames in ball mode: the clip keeps the players' framing and the chip says so.
  **Proposed 2026-11-05 (lab test 15, round 2, checked on 22 clips incl. 7 not used to choose it):** replace the 10% rule
  by: `ready` only when, on the fused track (below), ball mode covers ≥ 50% of the clip, the median speed of the trusted
  ball in ball mode is ≥ 0.10 long sides per second, at most 15% of its steps are slower than 0.02 (a "ball" that
  barely moves is held, lying, or something else), and ≥ 50% of the ball-mode time has a trusted ball (not bridged);
  otherwise `none` (today's framing, the chip says so). The four values go in `<clip>.ball.json` (`ballModeShare`,
  `ballSpeed`, `slowShare`, `trustedInMode`) to tune the thresholds after the field test.
  **Fused track (test 15):** the framing uses, per frame, pass 2's ball where trusted, else pass 1's where trusted
  (pass 2 can stick to a still object while pass 1 follows the ball). Same cost.
- Deleting the clip deletes both files; a new tap replaces them.

### 4.7 Screens and behaviour (editor, `src/app/clip/[id].tsx`)

| State | What shows |
|---|---|
| Modo Foco on, no ball yet | Next to the Modo Foco chip: "Seguir a bola" (ball icon). Only on recommended phones (section 4.3). |
| Choosing | The video pauses; caption "Toque na bola"; the player can scrub to a frame where it shows. Tap = seed; a ring marks it. Cancel returns. |
| Tracking | Chip "Seguindo a bola · 40%". The current framing keeps playing. Leaving the editor does not stop it. |
| Ready | Chip "Modo Foco · bola" filled lime; the framing eases into the ball path (400 ms). Long press on the chip: "Refazer" (new tap) / "Só jogadores" (back to the players' path). |
| `none` / `failed` | Chip back to "Modo Foco"; toast "Não deu para seguir a bola neste clipe". |

Turning Modo Foco off turns both off, as today. Export and share use the ball path when ready.

## 5. Time budget

Per 100 ms frame, per pass. The app reads frames as pixel buffers from `AVAssetReader` (no JPEG) and passes model
outputs straight to the next model (no array copies); the bench spent ~28 ms on JPEG decoding and ~27 ms on copies.

| Phone | Models per pass | Two passes, 30 s clip (300 frames) | Note |
|---|---|---|---|
| iPhone 16 Pro Max | 74 ms (in the soak test) | **52 s measured** (FocusBench soak, 2026-11-04: 84 ms per frame and pass with the video read and the outputs passed on; models 74, image 4, mask summary 6) | serious heat after 13 min of non-stop work |
| iPhone XR (not offered) | 0.44–0.6 s | about 5–7 min (estimate) | warm phone; for the record |

Step 0 measures the real numbers with both passes. Options if too slow: pass 1 at 5 fps; pass 1 only around the seed's
neighbourhood; on slow phones, pass 2 only (crops guided by the players' path, "p" guide in `roi.py`; quality to measure).

**Amendment 2026-11-05 (lab test 14, "two passes at 5 fps"; chosen by Victor, no app code yet).** Both passes track
every 2nd 100 ms frame instead of every frame; the rest of this spec is unchanged. Evidence:
`docs/focus-refs/tools/lab/README.md`, test 14 (`low_fps.py`, `mac-lowfps*.sh`, `mac-newclips.sh`, FocusBench `ball5`).

- **Section 4.2 (tracking loop)**: the frames tracked are the 200 ms grid through the clicked frame (ticks
  `seed ± 2k`), forwards then backwards, with the same single bank; slots 1–6 hold the previous six *tracked* frames
  (f−2 … f−12; f+2 … f+12 going backwards) and the pointers f−2 … f−30. The reader still decodes every frame but only the
  grid's ticks are scaled and encoded (FocusBench `VideoFrames.wanted`).
- **Back to 100 ms** (new, Core, pure; reference `low_fps.upsample`): between two tracked frames that both have a mask,
  `cx, cy, x, y, w, h, area` are interpolated linearly and the other values copied from the earlier frame; if either is
  `null` the frames between are `null`. Section 4.5's framing rules then run unchanged on the 100 ms track. A port test
  checks the Swift against `low_fps.py`.
- **Section 4.4 (ROI)**: the crop path comes from pass 1's interpolated track as before; crops are cut only on the grid.
- **Section 4.6**: `<clip>.ball.json` stores the interpolated 100 ms track and `trackStepMs: 200`.
- **Quality** (Mac, 15 clips, ball mode and labelled balls in the crop vs v6 at 10 fps): the same on 13 of 15 clips
  (often more ball mode, e.g. bt-wa-1028 74 → 85%); worse on two short basketball clips with a big ball
  (basket-app-1031-a 100 → 83%, basket-rp-1105-h 80 → 29%); the labelled ball stays in the crop as often as with v6.
  Night beach tennis filmed wide (likely the 0.5x lens; ball ~3–6 px in pass 1) is hard at any frame rate, v6 included
  (0–39% ball mode): the framing stays on the players there.
- **Section 5 (time budget), measured** (FocusBench soak, iPhone 16 Pro Max, 15 min non-stop, unplugged): **30 s clip in
  26.7 s** (13.3 s per pass, 85 ms per tracked frame; 0.89x the clip length) vs 52 s at 10 fps; heat `fair` after 7 min,
  **never `serious`** in 15 min (10 fps: `serious` after 13 min); battery 95 → 90% for 38 clips (5% steps). Plus
  today's players' analysis (~15 s per 30 s clip), which runs at save as before.
- Not chosen: pass 1 at 3.3 fps + pass 2 at 5 fps (22.8 s, a little cooler, but worse on the three hard night/vertical
  clips: labelled balls in the crop 80 → 60%, 94 → 81%, 100 → 83%); one pass at 5 fps (~13 s, follows something else
  on hard clips); a faster players-only camera (test 13: does not look like the ball framing).
- Section 7, step 0 (spike on device) is done for the 16 Pro Max by FocusBench; an iPhone 12 (A14) is still to measure.
- Field checklist addition: at night, the same court filmed at 1x and at 0.5x, to see whether 1x brings the ball back
  (if so, a recording hint for Foco na Bola).

## 6. Risks

- **Two passes on the phone**: the bench timed one. Step 0 measures both and the frame reading.
- **Unmeasured phones (A14–A17)**: the gate assumes their Neural Engine runs the four models; the probe checks it on
  each phone; the field checklist covers at least an iPhone 12 (A14), the slowest allowed.
- **Model updates**: any change to the models goes through `coreml_export.py` (self-test) and the Mac check
  (`coreml-mac.sh`) and FocusBench on the XR, which rejected three variants that worked elsewhere.
- **App size**: +40 MB (models in the bundle, accepted).
- **Heat**: phones below A14 are out. On the 16 Pro Max, non-stop processing (FocusBench soak) reached `fair` after
  5 min and `serious` after 13 min (about 15 clips of 30 s back to back); battery about 5% per 15 min. The ball queue
  pauses at `serious` and goes on at `fair` (as the thermal wait), one clip at a time, `.utility`.
- **Seed on a bad frame** (ball hidden, two balls): "Refazer" with another tap; a seed that gives `none` says so.
- **Quality on clips with Modo Foco already applied** cannot happen in the app (the analysis reads the original file);
  the lab's app exports were cropped already.
- **Zoom 2.0x in Full HD**: softer picture while in ball mode (accepted).

## 7. Plan (steps)

0. **Spike on device (throwaway, FocusBench)**: both passes read from a clip with `AVAssetReader`, model outputs passed
   directly, the probe as specified; time on the 16 Pro Max and an iPhone 12 if one is available; go/no-go on the
   numbers.
1. **Core**: `BallRoi`, `BallFramePath`, `BallTuning`, `summarize` + `roi_back`; port tests against the lab's files.
2. **Native**: `BallTracker` (reader, models, loop, two passes, files), the gate and the probe, `trackBall` and
   `ballSupported` in the module, cancel on delete.
3. **JS data**: `schema` (`ball`), `BallQueue` (after the tap; thermal and recording wait), cleanup on delete. Tests.
4. **Preview and export**: read `.focusball.json` when ready (no change to the ramps or the overlay).
5. **Editor**: "Seguir a bola", the tap, the chip states, "Refazer" / "Só jogadores". Tests.
6. **Field test** (section 8), then tune `BallTuning`.

## 8. Field checklist

1. Basketball, volleyball, beach tennis, futsal; landscape and upright; phone high on the side.
2. Tap the ball: time to ready on the 16 Pro Max and an iPhone 12 (A14); heat after 5 clips in a row; on the XR the
   action does not show.
3. Fast plays (pass, shot, smash, serve): the camera is there with the ball; a lost ball returns to the players in 0.2 s.
4. Dribbles and bounces: no vertical bobbing; a lob: the ball stays in the picture, near the top.
5. Rackets, hands, a ball on the floor, a second ball: not framed.
6. "Refazer", "Só jogadores", Modo Foco off and on, reopen the clip: choices kept.
7. Export and share with the ball path: matches the preview; mark bottom-right.

## 9. Lab files (reference, not app code)

`docs/focus-refs/tools/lab/`: `hybrid.py` (framing rules, round 6), `roi.py` (crops), `coreml_export.py` (models, loop,
Mac check), `coreml-mac.sh`, `loop.py` (EdgeTAM in parts), `ios-bench/` (FocusBench) and `ios_bench.py` (its data and
results), `README.md` (all results). Ground truth: `docs/focus-refs/labels/`.

## 10. Later (not in this spec)

1. **No tap**: find the ball to start from (a per-sport detector, Apache-2.0 / Create ML), then the same tracker.
2. **Follow one player**: the same tracker from a tap on a player (lab test 2, person labels pending).
3. **Speed**: the encoder of frame f+1 while the decoder of frame f runs; FP16 inputs; model download on demand.
4. **4K capture** for a sharper 2.0x zoom.
5. **One pass instead of two** (Victor, 2026-11-04: to test after the soak test): (a) crops guided by the players' path
   only (`roi.py --guide p`); (b) crops that follow the previous frame's ball as the tracking goes, back to the players'
   path when it is lost. Measure ball mode against the two passes on the lab clips first, then the time.

## 11. Best path so far (lab tests 17–19, 2026-11-05/06; not adopted, on hold)

Evidence and numbers: `docs/focus-refs/tools/lab/README.md`, "Outcome" and tests 17–19. If the feature is reopened,
this is the starting point; it changes sections 4, 5 and 10.1 as follows.

1. **A per-frame ball detector next to the tracker** (10.1 done in the lab, without replacing the tap): YOLOX-Tiny
   (Megvii, Apache-2.0, COCO "sports ball", 416 x 416, Core ML ~10 MB) at 5 fps in two stages: every 3rd analysed frame
   the whole frame + all native 416 px tiles, the ball path over those frames, then the other frames with the whole
   frame + the 2 tiles nearest that path (~8.3 model calls per frame on 1080p, 14 ms each on the iPhone17,2).
2. **Mixed track**: the detector's ball where trusted, else the fused EdgeTAM track of section 4 (two passes at 5 fps).
   Ball cover on the 17 labelled clips: 53% (EdgeTAM alone 43%; YOLOX-S with all tiles 56%).
3. **Framing** (section 4.5) adds, approved by Victor on video: `v_keep = 0.2` (on a lob the players' centre stays at
   least 20% of the crop's height above its bottom edge), `min_seg = 10` (a ball found for less than 1 s does not zoom
   in) and `zoom_rate = 0.5` (zoom changes at most 0.5x per second, both ways).
4. **Time** (section 5): ~48 s per 30 s of video on the iPhone17,2 in a 15 min soak (detector 21–23 s + two passes
   26.5 s), thermal state nominal, battery < 5%; ~1.6 s per second of video, so **~16 s for a typical 10 s cut**.
   The analysis would run on demand in the editor, on the cut range only (today's Modo Foco analyses the whole
   `bounds` at save time); a change of the cut afterwards needs a re-analysis or a margin (~±2 s), to decide.
5. **Weak spots**: night at 0.5x (ball ~3 px), the ball in hands (basketball, volleyball: EdgeTAM carries it),
   broadcast footage.
6. Not worth it (measured): YOLOX-Nano, Tiny on scaled 640 px tiles, online tile choice, fine-tuning on the lab's 32
   clips, the detector with EdgeTAM pass 1 only.

