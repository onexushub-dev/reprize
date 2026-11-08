# Repplay: Modo Foco (auto-framing) — design

> Date: 2026-10-23. Status: implemented (2026-10-23); step 0 passed on device; field checklist (§8) pending. Scope: iPhone only (Android keeps today's export, which already ignores `crop`).
> Origin: the multi-camera idea (`2026-10-23-multi-camera-design.md`) is postponed. Its goal (see the play up close on a big
> court) is reached first with one phone: record the whole court and let the app move a virtual camera inside the picture.
> Validated by a throwaway spike on 6 clips (basketball x4, volleyball, beach tennis), 2026-10-23.

## 1. Goal

Every saved clip opens already framed on the play: the picture pans and zooms gently to keep the action in the middle,
like a TV broadcast. The player can switch it off with one tap and get the whole court back. The name in the app is
**Modo Foco**.

Success looks like:
- A clip opened in the editor shows the framed version without the player doing anything (on by default).
- The movement is smooth: no shaking, no hunting when the play is still, no lag behind the play (the path is computed
  after the save, so it knows where the play goes next).
- What the editor shows is exactly what is downloaded or shared (same path, same times).
- The app mark is always in the bottom-right corner of the exported video, Modo Foco on or off, vertical or landscape.
- Works on the oldest supported phone (iPhone XR, iOS 16.4+), with the analysis in the background after the save.

Non-goals (v1): ball detection, following one chosen player, any setting other than on/off, a vertical Story cut from a
landscape clip (section 10), Android, 4K capture, live framing during the recording, a motorized stand (DockKit).

## 2. Decisions (Victor, 2026-10-23)

| Decision | Detail |
|---|---|
| On by default | Every clip uses Modo Foco unless the player turns it off for that clip. |
| One framing per clip, by how it was recorded | A clip recorded in landscape shows the landscape (16:9) framing; one recorded upright shows the vertical (9:16) framing. No format picker. |
| Full HD | Capture stays 1080p. The zoom is capped at 1.5x so the picture stays sharp enough (about 720p at the cap). 4K is a later comparison. |
| Off = the plain video | With Modo Foco off the preview shows the whole video, with no rectangle drawn on it (a drawn rectangle would look like part of the export). |
| Name | "Modo Foco". Avoid the bare name outside the app (notifications), where it collides with iOS "Foco". |
| Watermark | Always bottom-right of the exported video, drawn after the framing. |

## 3. Facts that shape the design

| Fact | Consequence |
|---|---|
| The spike (YOLO people detection + the path rules below) gave smooth, correct framing in all 6 clips. Ball was found in 3–15% of frames on basketball and beach tennis (42% volleyball). | v1 follows the players only. The ball is a later, per-sport model (section 10). |
| Spike problems: balls lying on the floor and spectators in the stands pulled the framing. A "same place for several seconds" filter fixed both. | The static filter is part of the path rules. |
| Ultralytics YOLO (used in the spike) is AGPL-3.0, including models trained with it; a closed app needs a paid Enterprise license. | Not used in the app. People come from Apple Vision (`VNDetectHumanRectanglesRequest`, iOS 13+, free). `GestureDetector` already uses Vision to find people at a distance. |
| `ClipExporter` places the video with one `AVMutableVideoCompositionLayerInstruction` transform and draws the overlay PNG (bands, mark) on a separate `AVVideoCompositionCoreAnimationTool` layer on top. | The moving framing becomes transform ramps (`setTransformRamp`) on the same layer instruction. The overlay path does not change, so the mark stays put by construction. |
| The editor plays with `expo-video` (`VideoView`) inside `ZoomableVideo`, which already shows a static `{scale, cx, cy}` zoom as a view transform. | The preview drives that same transform from the path, by the player's current time. No new native player in v1. |
| `Clip.edit` holds the editor choices; `readEdit` fills defaults when a field is absent. Exports are landscape for landscape clips, vertical for vertical ones (`exportOptions`). | `edit.focus` (absent = on) joins `Edit`. The aspect of the framing is the aspect of today's export. |
| Clip files hold up to the 60 s buffer; `bounds` is the part a clip may show; trims stay inside `bounds`. | The analysis covers `bounds` (or the whole file on old clips). A trim just reads part of the path. |

## 4. How it works

```
save ─► repo.addClip ─► FocusQueue (JS, one at a time)
                           │ analyzeFocus(clipPath, startMs, endMs)        native, background
                           ▼
            FocusAnalyzer (iOS): AVAssetReader at 10 fps ─► Vision people boxes ─► FocusPath (Core) ─► <clip>.focus.json
                           │
                           ▼
                clip.focus = { status: 'ready', file }   ──►  editor preview (ZoomableVideo, by player time)
                                                         ──►  exportClip(..., focusFile)  ─► transform ramps + overlay on top
```

### 4.1 Analysis (native, `FocusAnalyzer.swift`)

- Reads frames with `AVAssetReader` between `startMs` and `endMs`, one every 100 ms (10 fps), in the video's display
  orientation (track `preferredTransform` applied), scaled to 960 px on the long side.
- Runs `VNDetectHumanRectanglesRequest` (`upperBodyOnly = false`) on each frame. Keeps boxes with confidence ≥ 0.3.
- Passes the samples to `FocusPath` (Core) and writes the result next to the clip: same name, `.focus.json` (like the `.thumb.jpg` thumbnail).
- Runs at `.utility` priority, one clip at a time, only for the clips of a recording that is open (its screen) and
  never while the camera is on (setup preview or recording): the camera and the phone's heat come first. A clip opened
  in the editor goes first. See `2026-11-07-basketball-field-test-fixes-design.md` §4.1.
- Cancellable: deleting a clip or a game cancels its pending analysis and removes the file.

### 4.2 Path rules (`FocusPath.swift`, ReplayCore, pure, `swift test`)

Input: samples `(tMs, [box])`, boxes normalized 0..1 in display orientation; the frame size; the target aspect; max zoom.
Output: keyframes every 100 ms, each a crop rect `(x, y, width, height)` in 0..1 of the video.

1. **Far people out:** drop boxes shorter than 40% of the median height of the 10 tallest in that sample (people far
   behind the court).
2. **Still people out:** drop a box when, in at least 80% of the samples within ±3 s, there is a box whose bottom-centre is
   within 1.2% of the frame width of its own (spectators, bench, referee standing still).
3. **Weights:** each remaining box weighs `1 + min(moved / (1% of width), 4)`, where `moved` is the distance to the nearest
   box in the previous sample. Players in motion pull the framing more.
4. **Target per sample:** centre x and y = weighted mean of the box centres; spread = weighted 10th–90th percentile of
   the x centres. Samples with nobody are filled by linear interpolation.
5. **Smoothing with look-ahead:** centred Gaussian over time — σ 0.5 s for x, 0.8 s for y, 1.2 s for the size. Then pan
   speed limited to 35% of the frame width per second.
6. **Size:** landscape target (16:9 inside a 16:9 video): width = clamp(spread × 1.3 + 0.15, 1/maxZoom, 1). Vertical target
   inside a vertical video: same rule. The other aspect (stored for later, section 10): the largest rect of that aspect
   that fits the video (no zoom), moved by the same centre.
7. **Placement:** the rect is centred on the target, with its centre 10% of its height above the players' centre (heads
   and the hoop stay in), then clamped inside the video.
8. **No players:** if fewer than 20% of the samples have anyone after the filters, the result is `none` (no Modo Foco for
   this clip).

The constants above are the spike's values. They live in one `FocusTuning` struct so the field test can adjust them.

**Amendment 2026-10-27 (field tuning, "v13").** Chosen on the 2026-10-26 field recording (7 beach tennis clips) and two
reference videos (vertical beach tennis, horizontal basketball), with `docs/focus-refs/tools/focus_variant.py` (a port of
this file, checked equal to the Swift by `FocusPathTests.test_matchesThePortTheTuningWasChosenWith`) and
`render_focus.py`:

- **Hold of vanished people** (`holdMs` 1 s), after rule 2: someone the detector stops finding still counts where last
  seen for 1 s, unless someone is found within a body length of that spot. Vision often misses a player cut by the
  edge of the picture; without the hold the framing swung away from them and cut them.
- **Width hold** (`widthHoldMs` 1 s), in rule 6: the width target is the widest needed within ±1 s before the Gaussian,
  so the crop opens before someone reaches the edge and closes only once the play settles.
- Rule 5: σ for x 0.5 s → **0.6 s** (a calmer pan). Rule 7: lift 10% → **0** (near players are big; the lift cut feet).

Result against the spike values: players more than 25% outside the crop 55 → 3 on the field clips, 12 → 0 and 20 → 0
on the references; pan jitter −37 to −53%; median zoom 1.46× → 1.31× (it no longer zooms past someone at the edge).
The spike's detection files (6 clips, in `docs/superpowers/spikes/focus-mode/`) become test fixtures: the filters must drop the floor balls and stand spectators
seen in the spike, and the path must stay inside the frame with speed and zoom limits respected.

**Amendment proposal 2026-11-04 (lab test 13, "v16 broadcast") — NOT ADOPTED (Victor, 2026-11-05: did not like the
result on video; today's framing stays, and the ball framing is offered on top of it where the ball is tracked well).
Kept for the record.** A faster, closer camera from the players alone, at today's analysis cost (only these rules change; the Vision
analysis of §4.1 does not). Chosen with `docs/focus-refs/tools/lab/broadcast.py` on the four labelled ball clips;
details and videos in `docs/focus-refs/tools/lab/README.md`, test 13. New `FocusTuning` values on top of `.action`
(v15), each already an option of `focus_variant.py`, so the port check (`--check`) and
`FocusPathTests.test_matchesThePortTheTuningWasChosenWith` carry over:

- Rule 5: σ for x 0.6 s → **0.35 s**; pan limit 35% → **70%** of the frame width per second.
- Rule 3: weights raised to the power **2** (`speedPow`): the fastest runner pulls the centre harder.
- Rule 5, before the smoothing: the target x and y are those **0.5 s later** (`leadMs`; the path is computed after the
  clip).
- Rule 6: max zoom 1.5 → **1.65** before `zoomIn` (**1.8x** on screen; 2.0x lost more balls above the crop); the
  width opens by **0.6 frame widths per frame width per second** of camera pan (`widenPerSpeed`: wide on a fast
  transition, close on a slow play); size σ stays 1.2 s.
- Rule 7: the crop's bottom sits **6% of its height** under the players' feet (90th percentile of the box bottoms;
  `anchorFeet`), never higher than centring on the players: the zoom becomes headroom for lobs and shots. The height
  follows with a **5%** dead band, up at 1 frame height per second, down at **0.2**, then σ **0.8 s** (`vertAsym`, the
  ball framing's rule, ball spec §4.5 rule 3). Variant to choose on video: the anchor half way (`anchorShare` 0.5,
  less sky over the players).

Result against today (mean of basket-v-01, bt-0AE39B33, bt-E5003B6B, yt-basket-04): labelled ball inside the crop
85 → **91%** (Foco na Bola v6: 93%), ball off centre 0.36 → 0.32, mean zoom 1.51x → 1.55x (max 1.65x → 1.8x), pan p95
0.10 → 0.15 frame widths per second, vertical flips 0.3 → 0.4 per 10 s (Foco na Bola 0.8), moving players cut 0 → 1% of
the frames; basket-v-01 loses 2 of 24 labelled balls. Optical flow (`VNGenerateOpticalFlowRequest`) added nothing
measurable on top and is not proposed.

**Lab 2026-11-03 to 2026-11-05 (no change to these rules).** A faster / closer camera from the players alone (tests 13
and 16), the ball framing with EdgeTAM (`2026-11-04-focus-mode-ball-design.md`, on hold) and other ideas were tested;
none replaced today's framing on video (Victor, 2026-11-05). Results, what not to repeat and what to try next:
`docs/focus-refs/tools/lab/README.md`, "Outcome".

### 4.3 Storage

- `Clip.focus?: { v: 1; status: 'pending' | 'ready' | 'none' | 'failed'; file?: string }` in `schema.ts`.
  Absent = never analysed (clips from before this feature): the editor queues them when opened.
- `edit.focus?: boolean` in `Clip.edit`; `readEdit` returns `focus: true` when absent.
- `<clip name>.focus.json`: `{ v: 1, stepMs: 100, startMs, landscape: number[][], portrait: number[][] }`, each row
  `[x, y, width, height]` rounded to 4 decimals (60 s ≈ 600 rows per aspect, ~25 KB). `v` lets a better path version
  re-analyse old clips later.
- Deleting a clip or a game deletes its focus file (`removeFile` in `mmkv.ts`, where the thumbnail is already removed).

### 4.4 Preview (editor)

- `useFocusFraming(player, path, enabled)` reads `player.currentTime` on every animation frame while playing (and on seek),
  interpolates the two nearest keyframes, converts the rect to the `{scale, cx, cy}` that `ZoomableVideo` already shows, and
  drives it through a Reanimated shared value. Paused = the frame's framing; scrubbing follows.
- Speed: the path is in source time, so 0.5x/1.5x/2x need no change (the player's time is source time).
- Full screen uses the same framing.

### 4.5 Export

- `exportClip` gets `focusFile?: string` and `focusAspect?: 'landscape' | 'portrait'`. When set (and the clip's
  `edit.focus` is on), `ClipExporter` replaces the single `setTransform` with one `setTransformRamp` per keyframe pair
  inside the cut, with times mapped to composition time: `(t − startMs) / speed`.
- The transform for one keyframe is today's `crop` math with that keyframe's rect, so a still path equals today's zoom.
- The overlay (bands, mark) is unchanged and stays on top: the mark is in the corner of the video image in
  every frame. Covered by a test on the overlay layout (portrait and landscape) and the field checklist.
- Manual zoom and Modo Foco never apply together (section 5).

## 5. Screens and behaviour

Editor (`src/app/clip/[id].tsx`), over the video, in the left slot of the row where today's zoom badge sits:

| State | What shows |
|---|---|
| Analysing | Chip "Modo Foco · preparando" with a small inline spinner; the video plays whole meanwhile. When it gets ready, the framing eases in (400 ms). |
| Ready, on | Chip "Modo Foco" filled lime with a check. The video is framed. |
| Ready, off | Chip "Modo Foco" outlined, muted. The whole video, no rectangle. |
| `none` / `failed` | No chip. The whole video. (`failed` is logged.) |
| Player turned the video (`rotation ≠ 0`) | No chip, Modo Foco not applied (the path was made for the original shape). |

- **Tap the chip:** on ↔ off, saved in `edit.focus`. Accessibility: role switch, label "Modo Foco", state on/off.
- **Hold the video** (while on): shows the whole video while the finger is down, framed again on release, if the long
  press is free in the editor (check during the plan; drop this item if it conflicts).
- **Pinch while on:** Modo Foco turns off and the manual zoom starts from the current framing (no jump). Turning Modo Foco
  back on clears the manual zoom.
- **First time ever** a framed clip opens: the video starts whole and eases into the framing (700 ms), with a caption
  "Modo Foco: a câmera acompanha o lance" for 3 s. Reduced motion: no animation, caption only. Stored as
  `Prefs.focusIntroSeen`.
- Download, share and Story use the framing when on (section 4.5).
- Thumbnails in "Meus jogos" stay as today (whole video).

## 6. Risks

- **Vision vs. the spike's detector:** Vision may miss small, far players that YOLO found at 1280 px. Step 0 compares both
  on the spike clips; if Vision misses too many, try a larger analysis size before anything else.
- **Analysis time on the XR:** estimated a few seconds to tens of seconds per clip (Vision on the A12 at 10 fps). Step 0
  measures it on the XR and a recent phone; if too slow, analyse at 5 fps (the smoothing hides it).
- **Heat:** analysis during a long recording adds load; mitigated by `.utility`, one at a time, and the thermal wait.
- **Preview sync:** reading `currentTime` per frame may drift by a frame; the framing moves slowly so it should not show.
  Fallback if it does: a native player view with the same video composition as the export.
- **Many ramps:** a 60 s clip has ~600 transform ramps; Step 0 checks the export time and memory on the XR. If needed,
  thin the keyframes (drop rows that a straight line between neighbours already explains).
- **Crop quality at 1.5x in Full HD:** accepted (decision). The 4K comparison comes later.

## 7. Plan (steps)

0. **Spike on device (throwaway):** Vision people boxes on the spike clips vs. the spike's detections; analysis time on
   XR and 16 Pro Max; an export of one clip with ~600 transform ramps plus the overlay (time, memory, mark position). Go/no-go
   on the numbers.
1. **Core:** `FocusPath` + `FocusTuning` + fixtures from the spike; `swift test`.
2. **Native:** `FocusAnalyzer` (reader + Vision + Core + file), `analyzeFocus` in the module, cancel on delete.
3. **JS data:** `schema` (`focus`, `edit.focus`, `Prefs.focusIntroSeen`), `readEdit`, `FocusQueue` (after save, on editor
   open for old clips, thermal/recording wait), cleanup on delete. Tests.
4. **Export:** `focusFile` in `exportOptions`/`exportClip`, transform ramps in `ClipExporter`; overlay layout test.
5. **Editor:** `useFocusFraming`, the chip and its states, pinch hand-over, first-time intro. Tests.
6. **Field test** (section 8), then tune `FocusTuning`.

## 8. Field checklist

1. Basketball half court, society/futsal, volleyball, beach tennis; phone high on the side, landscape and upright.
2. Open a clip right after saving: "preparando", then the framing eases in. Time it on the XR and on the 16 Pro Max.
3. A still moment (players walking back): the framing does not wander.
4. A fast break across the court: the framing gets there with the play, not after it.
5. Spectators sitting near the court and balls lying on the floor do not pull the framing.
6. Turn Modo Foco off and on; pinch while on; turn the video; reopen the clip: choices kept.
7. Download and share (and Story) with Modo Foco on: the result matches the preview; the mark is bottom-right in every
   frame, vertical and landscape; with Modo Foco off the export is the same as today.
8. A full game with clips saved every few minutes: no slowdown in the recording, note heat and battery.

## 9. Plans

Modo Foco works in the app (preview and editor) on every plan. Only a paid export carries it: a free export leaves it
out, and the free-export notice says so. Rules: `docs/modelo-de-negocio-e-pagamentos.md`; the gate is in
`share/exportOptions.ts`.

## 10. Later (not in this spec)

1. **Story from a landscape clip:** use the stored vertical framing to fill the 9:16 Story instead of today's whole video
   with bands. This changes an earlier decision ("never crop the court" in the Story frame), so it needs its own decision.
2. **Ball, per sport:** a detector trained with Create ML (free) or an Apache-2.0 model (YOLOX, RT-DETR, D-FINE) converted
   to Core ML, on public datasets with a commercial-friendly license (check each) and, later, Repplay's own clips (with
   the player's consent in the terms). The ball then joins step 4 of the path rules as a reinforcement.
3. **Follow one player:** tap a player in the editor to keep the framing on them (the model of the Cinematic mode in Photos).
4. **4K capture comparison** for a stronger zoom.
5. **Multi-camera** (`2026-10-23-multi-camera-design.md`).

## 11. Step 0 results (2026-10-23, device, Release)

- Portrait clip 1080×1920, 36.7 s analysed: **4.5 s**, 368 frames, people in 368 (100%), 1.6 people/frame, `ready`.
  Vision found the players as well as the spike's detector did; framing at the 1.5x cap, max pan 0.024 of the width
  per 100 ms (limit 0.035).
- Export with Modo Foco (1080p, overlay on): **9.2 s**, saved to Photos; preview and export matched (Victor).
- Not measured yet: the iPhone XR and a landscape clip: both are in the field checklist (§8).
- Implementation notes: the focus file also stores `size: [w, h]`; hold-to-see-the-whole-video starts at 400 ms (above the
  350 ms tap); clips whose stored absolute path broke after a reinstall (iOS moved the app folder) are relocated at
  start (`repo.relocateClips`), a pre-existing bug found during the test.
