# Modo Foco lab (2026-11-03 to 2026-11-06)

## Outcome (Victor, 2026-11-06) — read this first

**Nothing from this lab went into the app. Production keeps today's Modo Foco (players only, Vision whole frame +
9 tiles, `FocusTuning.action` / v15) unchanged. Foco na Bola stays on hold** (spec
`docs/superpowers/specs/2026-11-04-focus-mode-ball-design.md`); Victor is trying other methods. This section keeps where
the lab got to, so nothing is repeated.

### Best path so far for Foco na Bola (tests 17–19, 2026-11-05/06)

**Update 2026-11-07 (tests 27–28)**: for basketball, swapping the COCO YOLOX-Tiny below for a one-class YOLOX-Tiny
fine-tuned on a public CC BY 4.0 dataset (`lab/models/ball_tiny_pub.onnx`) raises the ball cover of the mix on the 7
basketball clips 54 → 64% (66% with our labels added), and the detector alone (no tap) 14 → 52%, at the same cost
(test 28; the dataset's licence risk is to be decided). TrackNetV3 without retraining does not find the basketball
(test 27).

**Update 2026-11-08 (test 32)**: `lab/models/ball_tiny_hn.onnx` (the same model + "not a ball" crops of heads and
torsos) raises the mix 64 → 68% and precision +2 at the same cost. On basket-app-1107-a the limit was the two-stage
tile choice (it never looked where the ball was); all 416 tiles on every analysed frame fixes that clip at ~2.2x the
detector cost, to be measured on the phone.

**Update 2026-11-08 (test 33)**: trained on our hand labels alone the detector finds about half as many balls (mix 68 →
57%). Victor's decision: keep the public dataset; `ball_tiny_hn` is the base to improve.

**Update 2026-11-08 (test 34)**: automatic labels on our recordings do not improve it (mix −2 to −5). The detector runs
on **all 416 tiles of every analysed frame** (Victor's decision: one clip at a time in the app; 64 s of analysis per
30 s clip on the iPhone 16 Pro Max, thermal nominal for 11 clips in a row). Best recipe: public + "not a ball" + our
hand labels (mix 70%, precision 81%, by fold).

**Update 2026-11-08 (test 35)**: the ball path's still-object filter at 0.5 for basketball (it threw away the held
ball): with `ball_tiny_hn` on all tiles the detector alone (no tap) is on the ball at 71% of the labelled points (was
57%), precision 84%; with EdgeTAM 76%. Next: basketball's remaining loss is the detector (20% of the points with no
candidate on the ball); then the other sports, each with its own tests.

**Update 2026-11-08 (tests 37–38)**: on 12 clips Victor labelled in our gym (never used for tuning) the current path
with `ball_tiny_hn` gets 75% / 89%; trained also on those clips' labels (by halves) **82% cover, 92% precision**, story
camera ball in crop 98% at 1.2x. **App model: `ball_tiny_gym`** (YOLOX-Tiny 416, all 416 tiles + whole frame on every
analysed frame at 5 fps, path with still 0.5). Test 39 (2026-11-09): a motion model in the path does not
help basketball at 5 fps (the ball bounces and is passed); the path stays as is.

A per-frame AI ball detector mixed with the EdgeTAM tracker, then the hybrid framing:

1. **Detector**: YOLOX-Tiny (Megvii, Apache-2.0, COCO class 32 "sports ball"; 416 x 416 input) at 5 fps, in **two
   stages** (`roi_tiles.py --anchor 3 --k 2`): every 3rd analysed frame the whole frame + all native 416 px tiles; the
   ball path over those frames (`ball_track.py`, dynamic programming); the frames in between only the whole frame + the
   2 tiles nearest that path. Core ML: `yolox_coreml.py --name tiny` → `lab/coreml/yolox_tiny.mlpackage`.
2. **EdgeTAM** (from the user's tap), two passes at 5 fps, fused track (tests 14–15).
3. **Mix** (`low_fps.py fuse --p2 det-<detector> --p1 edgetam-fuse5`): the detector's ball where trusted, else EdgeTAM's.
4. **Framing**: `hybrid.py` round 6 + `v_keep=0.2` (lob fix, approved) + `min_seg=10 zoom_rate=0.5` (no quick zoom in /
   out on short finds, approved 2026-11-06: "very good, no losses").

| | ball cover (17 labelled clips) | phone, 30 s clip (iPhone17,2, 15 min soak) | heat |
|---|---|---|---|
| EdgeTAM alone (2 passes at 5 fps) | 43% | 26.7 s | `fair` at 7 min |
| + YOLOX-S, all tiles (test 17) | 56% | 80.3 s | nominal |
| + YOLOX-S, two stages (test 19) | 55% | 58.4 s | nominal |
| **+ YOLOX-Tiny 416, two stages (test 19, best)** | **53%** | **~48 s** (detector 21–23 s + 2 × 13.3 s) | **nominal, < 5% battery** |

- Cost scales with the analysed length: ~1.6 s per second of video, so **~16 s for a typical 10 s cut**. Today's app
  analyses a clip's whole `bounds` when it is saved (`onClipSaved` → `focusQueue`), before the user's cut; Foco na Bola
  needs the tap in the editor anyway, so it would analyse only the cut range on demand (a margin of ~±2 s, or a
  re-analysis when the cut changes, to decide).
- Strong: night beach tennis at 1x (the detector finds what EdgeTAM lost). Weak: night at 0.5x (ball ~3 px; with Tiny
  mostly today's framing on bt-rz-1105-v), the ball in hands (basketball, volleyball: EdgeTAM carries it), broadcast
  footage (yt1105-bt, 0%).
- Videos (Victor's reviews): `lab/tests/framing/<clip>.compare.mix-keep-vs-mix-tiny.mp4` (12 app clips, S all tiles vs
  Tiny two stages) and `<clip>.compare.mix-tiny-vs-mix-tiny-zoom.mp4` (bt-rz-1105-v / -a / -b, bt-wa-1028: the zoom fix).
- Phone bench: FocusBench soak "Detector em 2 etapas + 2 passadas a 5 fps (teste 19)" with "YOLOX-Tiny (416, recortes
  416)"; results in `lab/tests/ios/soak.ball5deta3*.json`. In FocusBench the path between anchor frames is the best
  candidate per anchor frame (same model calls as the lab's path).
- Not worth it (measured): YOLOX-Nano (cover 49%), Tiny on 640 px tiles scaled down (52%), choosing tiles online frame
  by frame (46–51%), tiles around EdgeTAM's ball (47–51%), only EdgeTAM pass 1 with the detector (46%), fine-tuning the
  detector on the lab's 32 labelled clips (test 18: does not generalise).
- Open ideas: EdgeTAM pass 2 only where the detector has no trusted ball (the passes are now the larger cost); more
  labelled clips or a licensed public ball dataset for a fine-tune (done for basketball in test 28: works);
  TrackNetV3 (MIT; tested without retraining in test 27: does not find the basketball; retraining needs labelled
  consecutive frames).

Reproduce (cloud workspace or Mac, CPU): `ball_detect.py --model lab/models/yolox_tiny.onnx --tag tiny-n5 --tile 416
--step 2` and `--no-tiles --tag tiny-w5`; `roi_tiles.py --src tiny-n5 --whole tiny-w5 --anchor 3 --k 2 --out
tiny-n-a3k2`; `ball_track.py --det tiny-n-a3k2`; `low_fps.py fuse --p2 det-tiny-n-a3k2 --p1 edgetam-fuse5 --out
mix-tiny-n-a3k2`; `hybrid.py --model mix-tiny-n-a3k2 --tag mix-tiny-zoom --set v_keep=0.2 --set min_seg=10 --set
zoom_rate=0.5`; `compare_tracks.py`. Models: YOLOX release 0.1.1rc0 on GitHub (`yolox_tiny.onnx`, `yolox_tiny.pth`,
`yolox_s.onnx`, `yolox_s.pth`), downloaded to `lab/models/` when needed (not kept locally).

### Earlier conclusions (2026-11-05)

- **Foco na Bola with EdgeTAM alone**: good when the ball is big and clear (basketball, daylight, YouTube references),
  but on the app's own clips only one (basket-rp-1105-v-a) was good enough. A rule to offer it only on clips tracked
  well exists (test 15).
- **Faster / closer camera from the players alone** (tests 13 and 16: σx, pan speed, zoom up to 2.0x, feet anchor,
  lead on the play, runner pull, optical flow): measurable gains in "ball in crop" (85 → 91%) but not liked on video.
- **One EdgeTAM pass, sparser pass 1, classical detection, Vision trajectories**: worse (tests 3, 4, 12, 14).

**Do not repeat** (results below, with the numbers): SAM 2 / EdgeTAM at 20–30 fps (test 8), one-pass EdgeTAM variants
(test 12), pass 1 at 2.5 / 3.3 fps (test 14), optical flow as a framing signal (test 13), zoom above ~1.5x driven by the
players alone without headroom (test 13: loses the ball above the crop), players-only "broadcast" tunings (13, 16),
headroom alone (16), and the detector variants listed above (tests 18–19).

**Findings about today's Modo Foco itself** (none applied; checked on the 17 labelled clips, 2026-11-05):
- **v14's tiles are right and needed**: with the whole-frame detector alone, 3 of the 13 new clips get no framing at all
  (night beach tennis at 0.5x, sand clips) and the night beach tennis clips keep fewer balls in the crop
  (bt-rz-1105-a 89 → 95%, bt-rz-1105-b 74 → 86%, yt1105-bt 71 → 100% with tiles). Side effect: people on other courts
  or in the stands widen the framing (zoom 1.31 → 1.13x on bt-rz-1105-a, 1.58 → 1.32x on basket-rp-1105-v-b). A filter
  for those (e.g. far people diluting the "10 tallest" reference of rule 1) is a possible refinement, not verified.
- **The ball is mostly lost above the crop** (lobs, sets, shots): today 88.5% of labelled balls in the crop; volleyball
  is the weak sport (yt1105-volei-a/-b 64 / 72%, yt1105-voleipraia 70%). The only isolated change that helps without
  touching speed or zoom is headroom: the crop's bottom half way to just under the players' feet (`anchorFeet=1
  anchorShare=0.5`): 88.5 → 91.7% (full anchor 93.3%), same zoom and jerk, vertical direction changes 0.08 → 0.18 per
  10 s. Seen on video only bundled with other changes (tests 13, 16), never alone. Videos of it alone (2026-11-05, deleted 2026-11-06,
  `broadcast.py render headroom ... --var headroom:anchorFeet=1,anchorShare=0.5`, `summary-headroom.md`) on the 9 app
  clips + yt1105-voleipraia: `lab/tests/broadcast/<clip>.compare.headroom.mp4`; labelled balls in the crop 89 → 94%
  (bt-rz-1105-b 86 → 97%, bt-0AE39B33 63 → 73%, bt-E5003B6B 78 → 88%, yt1105-voleipraia 70 → 86%; the rest unchanged),
  same zoom; vertical direction changes 0 → 1.3 per 10 s on bt-E5003B6B, 0 → 0.4 on basket-rp-1105-v-a. **Verdict (Victor,
  2026-11-05): today's Modo Foco is better; headroom not adopted.**
- **Lab note**: the "current" framings of the clips before 2026-11-05 were computed from the whole-frame boxes only
  (`focus_variant.py --boxes full`), not the app's whole frame + tiles; the 2026-11-05 clips use `--boxes tiled`. Use
  tiled (and re-run vision-probe for old people files without `tilesFixed`) when comparing with the app again.
- `evaluate.clip_meta` now rebuilds a clip's metadata from `clips.txt` and the video when its frames were deleted, so
  the scores and reports run without `lab/frames`.

**Kept for re-testing** (in git): the tools in `tools/` and `tools/lab/`, the ball labels (`labels/`, 32 clips), the clip
list (`clips.txt`), FocusBench (`ios-bench/`), this README, the specs. Kept locally (not in git): the source videos
(`clips/`, `raw-dump/`, `refs/`), the people files (`renders/**/*.people.json`), the lab's Python envs and checkpoints
(`lab/.venv*`, `lab/models/`), the Core ML models in use (`lab/coreml/`: EdgeTAM encoder / attention / attention_pairs_soft /
decoder / memory, `yolox_s`, `yolox_tiny`), every result file (`lab/tests/**/*.json|md`, incl. the best path's
detections, tracks and framings) and the best path's videos (above). Deleted to free space: on 2026-11-05 the extracted
frames, old comparison videos and renders (~6.6 GB); on 2026-11-06 the superseded videos (`compare.mix`,
`compare.mix-keep`, `compare.headroom`), the rejected / unused Core ML exports (`yolox_nano`, attention `halves_soft*`,
`v1*`), `lab/frames` again, and the variant detections of test 19 other than the best path (numbers in the tables);
see "Regenerate" at the end.
---

Test bench for the next Modo Foco round. **Nothing here goes into the app.** The goal is to compare, on the same
static-camera clips and against the same ground truth, the ways to make the framing follow the play faster:

| # | Test | Status |
|---|---|---|
| 0 | Ground truth: ball (and one chosen player) on 18 clips, labelled with SAM 2 assist | 4 clips (ball) on 2026-11-03 |
| 1 | SAM 2 "one click on the ball": how long it follows, clicks a user would need (`oneclick.py`, Mac) | **done: first method that follows the ball** (below) |
| 2 | "One click on a player" (custom Modo Foco): SAM 2 first (`oneclick.py --mode person`); Vision `VNTrackObjectRequest`, EdgeTAM, people boxes + appearance after | needs person labels |
| 3 | Vision trajectories (`VNDetectTrajectoriesRequest`), every trajectory at every frame (`vision-traj.swift`, Mac; `vision_eval.py`) | **done: not good enough** (below) |
| 4 | Classical ball detection for a fixed camera (`classical.py`) | **done: not good enough** (below) |
| 5 | Motion (optical flow) as a lead signal for the camera | **done in test 13: no measurable gain over the players alone** |
| 6 | Hybrid framing: the ball while SAM 2 is sure of it, today's Modo Foco when not (`hybrid.py`, videos in `lab/tests/framing/`) | **first round done** (below) |
| 10 | iPhone step 1: EdgeTAM as 4 fixed-shape Core ML models + the tracking loop (`loop.py`, `coreml_export.py`, `coreml-mac.sh`) | **done: same quality as EdgeTAM, 45 ms/frame on the Mac's Neural Engine** (below) |
| 11 | iPhone step 2: time and check the Core ML models on the phones (16 Pro Max, XR) with FocusBench, a throwaway test app (`ios-bench/`, `ios_bench.py`) | **done: 16 Pro Max 122 ms/frame, all on the Neural Engine, same track as the Mac; XR 0.55–0.72 s/frame with GPU, same track, heats up** (below) |
| 50 | Basketball: the 9:16 camera loses a long pass and the receiver (Victor's field clip `basket-app-1110-a`, the app's export of `basket-app-1108-a`): measure the app's camera on its export (`app_camera.py`), find the cause (`pass_diag.py`), sweep path and camera on the 32 labelled basketball clips (`pass_sweep.py`, people by `people_yolox.py`), compare (`pass_render.py`) | **cause: the path stays on a yellow SHIRT the detector scores 0.64 (the passer's) while the ball flies at 0.2–0.3, so the camera sees the ball only at the shot, 1.0 s later; camera speed alone is not the cause. Fix: a tall candidate (h >= 1.35 w) inside a person and bigger than 0.3 of the person's height scores x0.3, + the beach tennis camera speed (a 1, b 100): ball in crop 96.6 -> 98.0%, at passes 92.2 -> 96.4%, holder whole at passes 88.2 -> 92.8%; 1110-a 85 -> 100%. Waiting for Victor's eye** (below) |
| 49 | The beach tennis camera: (a) aim between the ball and the player who hits it, (b) its speed, (c) lock the camera to the court of the main players, (d) Victor's reference reels (`cam_bt.py`, 19 labelled own clips + 6 app clips) | **blend 0.4 toward the hitter + faster smoothing (a 1, b 100) + court lock (ball points outside 5–95% of the main players' x ± 0.20 dropped): ball in crop 98.0 -> 97.9%, hitter whole 88.1 -> 93.6%, at the hits 82.1 -> 91.2% (arena B 78 -> 88%), a-10 no longer goes to the next court. The reels: same player size and pan, but they keep both near players in the frame (84–95% vs our 14–17%); keeping our pair together costs the ball or the hitter -> off. T49 into the app (beach tennis only)** (below) |
| 48 | The beach tennis model for the app (public sets + BOTH arenas, every ball marked) and Seguir a Bola per sport in the app (`mac-train-bt.sh` on Victor's Mac, `mac-coreml-bt.sh`; ReplayCore `BallSport`) | **the 45b recipe, re-run (the .pth were lost with the cloud workspace): a run varies ~4 pts (public base on arena A 81.8 -> 78.0%; btplA2 93.8 -> 88.7% ceiling, cover 90 -> 85%), the fine-tune gain is the same (+12 / +11). On 5 labelled clips no beach tennis model saw (249 points): `btpl` = `btplB` (ceiling 85.1 vs 85.5%, cover 82 vs 82%, precision 94 vs 95%) -> `btpl` ships (more of the real arenas). App: the sport per recording (asked when the classifier says another sport), the beach tennis profile (tests 46-47), the verdict; basketball unchanged (parity fixtures identical, 285 Swift + 1,328 jest tests pass)** (below) |
| 47 | Beach tennis: (a) when is Seguir a Bola worth applying to a clip (`ball_verdict.py`, signals the phone has, no labels; 30 bt clips + 16 basketball clips measured only), (b) a video screen at the venue (`ball_track.py` `screen`), (c) the ball near the players (`near`) | **(a) before: players < 10% of the 9:16 output height = too far, not offered; after: ball share >= 25%, ball >= 16 px in the output, camera pan >= 0.6 crop widths / 10 s, else today's Modo Foco. Off: bt-v-1029 (0.5x), bt-rz-1105-v, bt-wa-1028, yt1105-bt, bt-0AE39B33, bt-own-a-06; on: the other 24. Basketball: no verdict (today's behaviour). (b) a region that changes all at once: the LED screen found on the stream only (51 path frames on it -> 0), the 19 own clips unchanged. (c) no gain: the native crop changes nothing, the 9:16 one costs cover (90.6 -> 86.9%); off** (below) |
| 46 | The beach tennis path: where does `ball_track.py` + `hybrid.trusted` lose the ball the detector sees (`path_diag.py`), and which parameters bring cover to the ceiling? (`path_sweep.py`, new: every parameter set scored on the 19 own clips in one pass, each arena with the model that never saw it) | **cover 75 → 90.6% (A 69 → 90%, B 81 → 91%; ceiling 94%) at precision 96 → 98%, every clip through the gate (b-02 50 → 96%, a-09 54 → 96%): (1) still filter radius 2% → 0.6% of the long side (`SPORT_P["beachTennis"]`); (2) the racket rules of `hybrid.trusted` (made for EdgeTAM masks) off for detector paths (`r_det`), as in the app's BallTrust. `dp=2` and `fill` add nothing worth their cost. Story camera C, ball in the 9:16 crop: 98.6% at 1.0x, 96.3% at 1.2x; 46b: the camera follows only ball runs >= 1 s (no pan before the rally or onto the next court: pan while no ball is in play -36%, ball in crop 97.9%)** (below) |
| 45 | A beach tennis detector: YOLOX-Tiny 416 one class trained on the two public beach tennis sets (CC BY 4.0) + "not a ball" crops (heads, torsos, rackets), then fine-tuned with one arena of Victor's clips, scored on the other (`ball_train_pub.py --folds bt`, `own_relabel.py`) | **public data alone: ceiling 53 → 88%, path cover 28 → 72%; + own arena crops with EVERY real ball marked (45b): ceiling 94% on both arenas, cover A 58 → 69%, B 87 → 81% (all 75%), precision mostly 90–100%. Detector at basketball's level; the path is now what limits (next: beach tennis path, test 46)** (below) |
| 44 | Beach tennis baseline for Seguir a Bola: the basketball detector (`ball_tiny_gym`, all tiles, 5 fps) and today's path, zero-shot, on the 8 labelled beach tennis clips (`det_report.py --det bgymall-n5 --track det-t44-bgymall`) | **far from basketball's bar: detector ceiling 0–60%, path cover 0–36% (basketball: ceiling ~90%, cover 82%); a beach tennis detector is needed (public data + "not a ball" crops + Victor's recordings), and more labels (two clips have 1 point)** (below) |
| 43 | Can the app tell a basketball clip from the other sports by itself (no question to the player)? 43a Apple's built-in scene classifier (Vision `VNClassifyImageRequest`, 3 frames per clip, `sport_classify.swift`); 43b the app's detector and path (trusted-ball share, `sport_report.py`) | **43a works as a "not basketball" signal: another sport's label (volleyball, tennis…) >= 0.4 with "basketball" < 0.1 catches 14 of the 18 readable non-basketball clips and hides none of the 75 basketball clips (at 0.3: 16/18, 1 basketball hidden); the "basketball" label itself is precise but finds only 40%. 43b separates poorly (basketball 22–100%, others 11–62%). Proposed: classify a few frames per recording, show "EM BREVE" only on a confident other sport, otherwise allow** (below) |
| 42 | Phone cost of "Seguir a Bola" (no tap, so no EdgeTAM) and all a frame's tiles in one Core ML call (FocusBench `det5`, `det5b`) | **one call per frame: ~11 s per 30 s clip (was 64 s with EdgeTAM, 34 s without), identical output (`batchMaxDiff` 0, same candidates); about 4 s for a 10 s cut. Adopted for the app** (below) |
| 40 | Does the app's detector (`ball_tiny_gym`) hold on other courts? 11 clips Victor labelled (outdoor + 3 gyms, web videos, measure only) | **yes: 82% cover / 90% precision, the same as in our gym; `ball_tiny_hn` 82% / 89%; still filter 0.5 +10 again. Weakest: outdoor (57%), a far small ball (70%), one gym with many false candidates (51%)** (below) |
| 39 | A motion model in the ball path (constant velocity, offline Kalman idea) and a straight line through gaps (`ball_track.py dp=2 acc_cost`, `fill`) | **no: the motion model raises precision but loses the bouncing / passed ball at 5 fps (cover −1 to −3, story camera up to −9 on one clip, test 37's torso case back); the line through gaps +3–4 cover but −4–6 precision, camera unchanged. Default stays test 38's path; options kept for the racket sports** (below) |
| 38 | `ball_tiny_hn` + crops from our 12 labelled gym clips (+ its false candidates there), scored by halves (`ball_train.py dataset --det`, `ball_train_pub.py --extra`) | **our gym, unseen half: detector alone (no tap) 75 → 82% cover, precision 89 → 92%; story camera 1.2x 92 → 98% (1107); other courts unchanged on average. App model: `ball_tiny_gym` (all 12 clips)** (below) |
| 37 | Do tests 32–35 hold on 12 newly labelled clips from our own gym (1107 + 1108, never used for tuning)? | **yes: detector alone (no tap) 59% (test 32's path) → 75% cover now, precision 89%; all tiles +9, still filter 0.5 +7; our old hand labels make it worse here (72%), so the app's model is `ball_tiny_hn`; story camera 1.2x ball in crop 75% today → 92%. Left: ball behind the railing / players 14%, a ball held still > 2 s 5%, torso taken for the ball 4%** (below) |
| 36 | Are the ball labels in time with the detector's frames (ffmpeg versions, Mac vs cloud)? (`frame_sync.py`, `label_sync.py`) | **yes: the labelling frames and the detector's frames are identical on all 7 clips; a first "~33 ms late" reading was an error of the reference grid. About a third of the "blind" points are imprecise clicks on a blurred ball, the rest real misses (ball in hands, in the net, behind a player, under the watermark)** (below) |
| 35 | Basketball: where does the ball path lose the ball (ceiling 80% vs cover 57%)? (`path_diag.py`, `ball_track.py` `SPORT_P`) | **the still-object filter threw away the held / dribbled ball (13% of the points); at 0.5 for basketball: detector alone, no tap, 57 → 71% cover, precision 79 → 84%; mix 68 → 76%; story camera ball in crop 95 → 96% (1.2x) / 90 → 95% (closer zoom), a little more movement. Default for basketball** (below) |
| 34 | `ball_tiny_hn` + 2,764 automatic labels on our 36 app recordings (self-training), and the phone cost of the detector on all 416 tiles (`ball_train_pub.py --extra`, `yolox_coreml.py --ball`, FocusBench `ball5det` + `ball_tiny_hn@416`) | **automatic labels: mix cover 68 → 63% (70 → 68% with our hand labels), not adopted; best stays public + "not a ball" + our labels, all tiles (mix 70%, precision 81%). Phone, all tiles: 64 s per 30 s clip (two stages 48 s), nominal for the first 10 min / 11 clips, serious after 13 min nonstop; Victor: use is one clip at a time → all tiles adopted** (below) |
| 33 | How good is a basketball detector trained only on our own recordings (no public dataset)? (`ball_train_pub.py --no-yt`, `pseudo_label.py`) | **our hand labels only: ceiling 76 → 37%, detector alone 55 → 30%, mix 68 → 57%, same precision (77–79%); automatic labels on 36 app recordings prepared (2,764 balls) but stopped: Victor keeps the public dataset, `ball_tiny_hn` stays the base (attribution CC BY 4.0)** (below) |
| 32 | Basket-app-1107-a followed a bald head: retrain test 28's detector with "not a ball" examples (heads/torsos of the public data + our own false candidates) and a head filter on Vision people boxes (`hard_neg.py`, `ball_train_pub.py --fp`) | **"not a ball" examples: mix cover 64 → 68% (66 → 69% with our labels), precision +2, same cost → `ball_tiny_hn`; head filter −1 to −2 points, not adopted. 1107-a: the detector sees the real ball, the cheap two-stage tiles never look there; all tiles every analysed frame fixes it (19 vs 8.6 inferences): phone cost to measure** (below) |
| 31 | The story's zoom per clip: min(today's Modo Foco zoom x1.0 H / x1.2 V, x2.2 scale-up, the detector's own ball kept in the crop but 3%), safe zoom when the detector sees the ball in < 35% of the clip (`story.py auto`) | **horizontal 1.0–1.2x per clip: ball 90% (fixed 1x 91%, 1.25x 86%) with more movement; vertical 1.05–1.95x: ball 99%, like the fixed 1.65x but per clip; in 4K the zoom barely rises (the ball decides) but the scale-up halves; no lens rule needed** (below) |
| 30 | A "story" (9:16) export option with Foco na Bola: today's Modo Foco 9:16 vs camera A / C at several zooms, horizontal and vertical recordings, exported 1080x1920 with the app's mark (`story.py`) | **horizontal: C at full height keeps the ball 91% (today 61%) with 2x the pan, 608 px scaled x1.8 from 1080p (native from 4K); more zoom loses ball and sharpness. Vertical: C at 2x moves 2.5x more, ball 97%, x2.0 from 1080p. Option for >= 1080p60; 4K for extra zoom** (below) |
| 29 | A camera that moves with the ball: test 24's camera with zoom (today / 1.5x / 1.75x / 2x) x dead zone (0.20 / 0.10 / 0.05) x smoothing x anticipation, ball = test 28's detector with no tap (`cam_sweep.py`, 72 configs, 7 basketball clips) | **smaller dead zone at today's zoom doubles the camera's travel with the ball still in 99%; 1.5x triples it at 98% (698p from 1080p); 2x loses the ball (worst clip 81%) and drops to 540p; anticipation does not help; more direction changes (1.5 → 2.3–2.8 /10 s): videos for Victor** (below) |
| 28 | A basketball detector of our own: YOLOX-Tiny (one class) fine-tuned on a public CC BY 4.0 dataset (Roboflow cvsense, ~4.3k originals), then + our labels by fold; same two-stage path and mix as test 19 (`ball_train_pub.py`, `ball_eval28.sh`, cloud CPU) | **ceiling 26 → 75%, detector alone 14 → 52% (no tap), mix with EdgeTAM 54 → 64% (66% with our labels), precision 71 → 76–78%, same phone cost; dataset has scraped web photos: licence risk to decide before shipping. Camera at today's zoom: same as today's mix with a tap (the ball is already in the wide crop); the gain is a no-tap camera about as good (94–100%)** (below) |
| 27 | TrackNetV3 (MIT; 8 consecutive frames + median background, trained on badminton) without retraining as the ball detector on the basketball clips (`tracknet_eval.py`, cloud CPU) | **not usable as is: its answer is on the basketball in 0–1% of the labelled frames; all its weak blobs together 4–23% vs YOLOX-Tiny's 10–42%; would need retraining on basketball sequences** (below) |
| 26 | The ball TRAIL with no camera (Victor, after Ball AI): link the ball offline, robust fit, still objects out, gaps filled/bridged; raw vs clean video; on the mix, EdgeTAM, detector-path and raw detector tracks (`trail.py`) | **cleaning adds ~nothing on the existing tracks (the DP path already does it); the YOLOX-Tiny candidates contain the labelled ball in only 34% of the frames: the limit is detection; videos for Victor** (below) |
| 25 | Victor on test 24: the camera barely moves now. Horizontal clips both ways: 16:9 at a fixed 1.5x zoom (`sg_lazy3.py --zoom 1.5`) and the 9:16 export of test 22 (`--aspect portrait`) | **16:9 at 1.5x: 91% today → 93% EdgeTAM / 98% mix, 1.0 / 1.3 direction changes; 9:16: 79% → 94% / 97%; videos for Victor** (below) |
| 24 | Test 23 fixed after Victor's review: on y the camera stays at the players' height and rises only as far as the ball needs (15% top / 10% bottom margin, no hold on y); output in the orientation recorded (horizontal -> 16:9) (`sg_lazy3.py`) | **ball in crop 91% today → 95% EdgeTAM alone / 98% mix, direction changes 1.7 → 0.8 / 1.2; videos for Victor** (below) |
| 23 | Test 22's calm camera on every labelled app clip, horizontal and vertical (x and y, today's zoom), EdgeTAM alone vs YOLOX-S + EdgeTAM (`sg_lazy2.py`) | **ball in crop 79% today → 97% EdgeTAM alone / 98% mix; direction changes 2.0 → 1.0 per 10 s; videos for Victor** (below) |
| 22 | A calm camera for test 21: dead zone (still while the ball is in the crop's central band) + the smoothest path that keeps it there, solved offline (`sg_lazy.py`) | **dead zone 0.20, a 10, b 1000: ball in crop 81% (no tap) / 92% (1 tap) vs 61% today, direction changes 0.8 / 1.1 per 10 s vs today's 2.3; videos for Victor** (below) |
| 21 | The offline Savitzky-Golay framing (test 20's idea: a centred filter that looks ahead) on every ball engine the lab has, 9:16 output, fallback to today's framing or to the last ball (`sg_framing.py`, `sg_render.py`) | **numbers: ball in the 9:16 crop 61% today → 82% YOLOX-S alone (no tap), 91–95% detector + EdgeTAM; ~3x more direction changes; videos for Victor** (below) |
| 20 | The "YOLOv8 + Savitzky-Golay + 9:16 crop" script (Victor, 2026-11-06): YOLOv8n `sports ball` per frame (`model.track`), first box, last position on a miss, savgol(15, 2), crop centred on it (`yolo_reframe_test.py`, cloud CPU; Ultralytics is AGPL: lab only) | **done: not good enough** (below) |
| 19 | A cheaper detector: the whole frame + only a few 640 px tiles where the ball should be, instead of all ~9 regions (`roi_tiles.py`, offline simulation on test 17's detections) | **two-stage `--anchor 3 --k 2` (all tiles on every 3rd analysed frame, 2 tiles around that path in between): 4.8 regions per frame instead of 8.5, mix cover 55% vs 56%; 58.4 s per 30 s clip measured on the phone vs 80.3 s (ball5 alone 26.7 s); YOLOX-Tiny matches S only with native 416 tiles (17 regions), phone cost to measure** (below) |
| 18 | Fine-tune the detector (YOLOX-S, one class "ball") on the lab's labels, 3 folds by clip (`ball_train.py`, CPU in the cloud workspace) | **does not generalise with this data: on held-out clips the ball is the best box on 25/60 crops vs 28/60 for COCO YOLOX (train clips 50/60); needs many more clips** (below) |
| 17 | AI that FINDS the ball in every frame (no tap): YOLOX-S (Apache-2.0, COCO "sports ball", ONNX) on the whole frame + native 640 px tiles at 5 fps, a dynamic-programming ball path; alone and mixed with EdgeTAM (`ball_detect.py`, `ball_track.py`, `det_report.py`; run in the cloud workspace, CPU) | **night beach tennis much better (bt-rz-1105-b cover 3 → 86%, bt-0AE39B33 50 → 90%); basketball / volleyball worse alone (the COCO detector misses a ball in hands or blurred); detector + EdgeTAM mixed: mean cover 43 → 56%; videos for Victor** (below) |
| 16 | Today's Modo Foco a little faster and closer (`broadcast.py scores --all`) | **not adopted (Victor, 2026-11-05): today's framing stays** (below) |
| 15 | When is a clip good enough for the ball framing? A rule from the phone's own signals after the two passes (`ball_gate.py`) | **Foco na Bola on hold (only 1 app clip good enough on video). Rule round 2 on the fused track (ball mode ≥ 50%, speed ≥ 0.10, slow ≤ 15%, confirmed ≥ 50%): right on 22 clips incl. 7 validation clips; two tracking fixes (click inside the crop, pass 1 where pass 2 is not trusted)** (below) |
| 14 | Foco na Bola at 5 fps (EdgeTAM on every 2nd 100 ms frame, interpolated back), two passes and one pass, to bring its cost near today's Modo Foco (`low_fps.py`, `mac-lowfps.sh`) | **done: two passes at 5 fps chosen (quality of v6 on 13 of 15 clips; 26.7 s per 30 s clip on the phone, never serious heat); pass 1 at 2.5/3.3 fps and one pass worse** (below) |
| 13 | A more "broadcast" Modo Foco from the players alone, at today's cost: faster/closer camera rules, a lead on the play, optical flow (`broadcast.py`, `focus_variant.py` options, `flow-probe.swift`, FocusBench `peopleflow`) | **not adopted (Victor, 2026-11-05: did not like it on video); flow not worth it** (below) |
| 12 | Foco na Bola in ONE EdgeTAM pass instead of two: crops guided by the players only (`roi.py --guide p`), or following the previous frame's ball as tracking goes (`single_pass.py`) | **done: no one-pass variant ties with the two passes on every clip; keep two passes** (below) |

Run the Mac tests with `bash tools/lab/mac-tests.sh` (ball) or `bash tools/lab/mac-tests.sh person`.

### Test 50 result (2026-11-10) — basketball: a long pass, the receiver lost for a second

Victor (field clip, app export with Seguir a Bola, `refs/2026-11-10/basquete/`: `3C8A306D...` without it, `64230949...`
with it): on a fast pass from one side to the other the camera loses the ball and is slow to reach the player who gets
it, who usually shoots or drives at once. The clip is `basket-app-1108-a` exported again (same frames; its labels
score it), added as `basket-app-1110-a` with the app's model on all tiles (`bgymall-n5`, as the phone runs it).

**The app's camera** (`app_camera.py`: the 9:16 export matched against the export without it every 100 ms, match
0.99–1.00, zoom 1.2): held at the left edge (centre 0.13) until 3.6 s, then a slow pan to 0.57 at 6.6 s. The lab's
camera C on the same detections reproduces it (mean |dx| 0.003, max 0.008), so the port is exact and the lab can
explain it. Labelled ball: 4.0 s x 0.16 (the pass leaves) -> 4.4 s 0.39 -> 4.8 s 0.56 (caught under the basket) ->
shot at 5.8 s. The ball is outside the app's crop at 4.4–5.0 s (4 labelled points, 0.8 s) and the receiver from ~4.5 s
to ~5.6 s.

**Cause** (`pass_diag.py`): not the camera's speed. The detector sees the ball in flight weakly (4.2 s 0.32, 4.6 s
0.31, 4.8 s 0.15: motion blur, 5 fps) and the passer's YELLOW SHIRT strongly (53x75 / 56x103 px boxes, 0.64, on
4.4–4.6 s; the ball is 22–35 px there). The path (`dp=1`) keeps the shirt, so the trusted ball stays at x 0.16 until
4.8 s and is next seen at 5.8 s (shot); the 10-frame bridge and camera C's smoothing turn that into a 3 s pan.
Moving the path's costs does not help (`move_cost` 0.3–0.5, `s0` 0.1: 1110-a unchanged, others worse); a size
consistency cost does (`size_cost`) but loses the real ball where it grows near the camera (basket-ext-1109-b 100 ->
76%): the ball's size changes with depth.

**Sweep** (`pass_sweep.py`, 32 labelled basketball clips: held-out folds for our gym, the app's model elsewhere;
people boxes by YOLOX-Tiny COCO, `people_yolox.py`, as a stand-in for Vision's; "at passes" = labelled points from the
end of a move >= 0.15 frame widths within 0.6 s to 0.8 s after it; "holder" = the person nearest to the ball wholly
inside the crop; zoom per clip fixed across variants; clips without today's Modo Foco file use a centred fallback):

| path | camera | ball in crop | at passes (309) | holder whole: all / at passes (279) | worst out-run mean / max | pan |
|---|---|---|---|---|---|---|
| today | C (a 3, b 300) | 96.6% | 92.2% | 95.1 / 88.2% | 0.20 / 1.0 s | 2.44 |
| today | a 1, b 100 (beach tennis') | 97.3% | 93.9% | 96.1 / 89.2% | 0.17 / 1.0 s | 2.82 |
| **shirt filter (x0.3)** | **a 1, b 100** | **98.0%** | **96.4%** | **96.7 / 92.8%** | **0.14 / 1.0 s** | **2.84** |
| shirt filter (dropped) | a 1, b 100 | 97.7% | 96.4% | 96.2 / 92.8% | 0.17 / 1.0 s | 2.86 |
| taller than 1.3x wide dropped (no people) | a 1, b 100 | 97.2% | 97.4% | 96.3 / 95.3% | 0.17 / 1.0 s | 2.84 |
| shirt filter (dropped) + aim 0.4 toward the holder (`cam_bt.aim_x`) | a 1, b 100 | 97.6% | 96.1% | 96.6 / 93.5% | 0.17 / 1.0 s | 2.86 |

Shirt filter (`ball_track.py` `person_ratio` 0.3, `person_asp` 1.35, `person_w` 0.3): a candidate at least 1.35x taller
than wide, inside a person's box that the picture does not cut, and bigger than 0.3 of that person's height, has its
score x0.3. Real balls matching a label are never taller than 1.25x inside a person in this set; shirts 1.4–2.1x
(checked over all 32 clips). Vision's boxes (`person_vision=1`, the 4 clips that have them) flag the same
candidates as YOLOX's (one more on 1107-d). The faster camera alone never makes a clip worse (8 better). With the
filter, per clip vs today: 1108-a and 1110-a 85 -> 100%, 1107-a, 1107-c, 1108-c, 1109-g, yt1105-a/b, rp-1105-v-a
better; 1108-d 96 -> 89% (the lab's centred fallback before the first ball; the app falls back to Modo Foco) and
1109-b 100 -> 98% (one point) worse. "Taller than 1.3x dropped" with no people scores best at passes but drops 7% of the
real ball's detections (vertical blur: dribbles, shots; 1108-a's shot at 6.2 s) and costs 1108-c (-13), 1109-b (-12).
Dropping the shirt instead of x0.3 lets the path pick weaker clutter (1108-g 100 -> 90%). Aiming toward the holder
adds little in basketball.

1110-a with the filter + a 1, b 100: crop at 4.4 s [0.23–0.50], 4.8 s [0.35–0.61], 5.0 s [0.39–0.65]: the ball
and the receiver are in from the pass to the shot (the receiver at the crop's right edge at ~4.7 s). Video
`lab/tests/story/basket-app-1110-a.pass-compare-t50.mp4` (app today | faster camera only | faster camera + shirt
filter; green ring = labelled ball, red border = labelled ball outside). Report `lab/tests/story/pass-sweep-t50.md`.

For the app (after Victor's eye): `BallSport.basketball` gets `BallCameraParams` a 1, b 100 and the shirt filter in
`BallPath` (the Modo Foco file's `people`, which BallAnalyzer today passes only to sports with `follow`), rules
`ball-t50`, `ball_parity.py` fixtures with people. **Victor approved by eye (2026-11-10) -> in the app**:
`BallPathParams.basketball` (`personRatio` 0.3, `personAsp` 1.35, `personW` 0.3, `BallPath.isShirt`),
`BallCameraParams.basketball` (a 1, b 100), `BallAnalyzer` reads `people` for basketball, rules `ball-t50`;
`ball_track.SPORT_P["basquete"]` now has the shirt rule (pass `person_ratio=0` for the path before it; `pass_sweep.py`
and `pass_diag.py` do for "base"); `ball_parity.py --out` writes each case's person boxes (YOLOX's `people-yx`, top-left,
6 decimals; the lab reads them back as the Swift port does) and adds `basket-app-1110-a` (no Modo Foco file: the
centred crop, zoom 1.0); the four older cases: 1107-a unchanged, 1107-d 8 / 1109-b 18 / yt1105-a 2 path frames
changed by the rule; beach tennis' fixture unchanged. The root cause is the detector: a retrain with yellow-shirt
"not a ball" crops from our gym (test 32's recipe, Victor's Mac) would remove it at the source.

### Test 49 result (2026-11-10) — the beach tennis camera: aim between the ball and the player who hits it, court lock, reference reels

Victor: with the sport right the field clip was good; the player attacking the ball gets cut when the camera is on the
court's DIAGONAL (behind the court it is fine). New tool `cam_bt.py`: camera C variants (dead zone, smoothing, `lead` =
aim ahead, `blend` = aim between the ball and the main player nearest to it, Vision boxes >= 0.6 of the clip's
80th-percentile height) scored by the ball in the crop (labels), the HITTER fully inside the crop (the main player within
0.25 long sides of the ball; at the hits = the frames where the ball turns), and the pan. 19 own clips (T47 tracks):

| Camera | ball in crop | hitter whole: all / at hits | pan (crop widths / 10 s) |
|---|---|---|---|
| C (today: dz 0.10, a 3, b 300) | 98.0% | 88.1% / 82.1% | 1.6 |
| calmer (dz 0.2 and/or a 10, b 1000) | 97.2–97.6% | 83.0–86.2% / 76.7–80.0% | 1.1–1.3 |
| lead 0.3 / 0.5 s | 96.8 / 95.6% | 84.1 / 81.6% / 75.0 / 72.9% | 1.6 |
| faster (a 1, b 100) | 98.3% | 89.0% / 84.5% | 1.9 |
| blend 0.4 | 97.3% | 91.9% / 88.3% | 1.6 |
| **blend 0.4 + faster (a 1, b 100)** | **97.9%** | **93.6% / 91.2%** | **1.9** |
| blend 0.5–0.6 | 97.0–97.3% | 92.1–92.8% / 88.1–89.0% | 1.6–1.7 |

By arena (blend 0.4 + faster vs C): A (behind, slightly diagonal) hitter at hits 87.6 -> 94.9%, B (side diagonal, the
class) 78.1 -> 88.4% (b-09 69 -> 96%, b-04 69 -> 81%), ball in crop unchanged. Victor's five clips of today
(`bt-app-1110-a..e`, behind the court; no labels): hitter whole 97.7 -> 98.0%, at hits 96.2 -> 97.1% (already fine
there, as he saw). A calmer camera cuts the hitter MORE (the ball crosses the court fast); aiming ahead loses the ball.
Videos `lab/tests/story/bt-own-{b-09,b-04,a-10}.story-compare-t49b.mp4` and `bt-app-1110-e.story-compare-t49b.mp4`
(today | C | T49b). Not in the app yet: waiting for Victor's eye and his reference reels.

**49a — the court lock** (Victor on T49b: all good but `bt-own-a-10`, where the camera still went right to the next
court). There the rally ends at 5.4 s and the path takes the next court's ball at x 0.94–0.97 (6.0–6.6 s), joined to
the rally's run (no gap over 4 frames: one run 0.4–8.8 s with 10% of its points on the next court), so neither the
1 s runs nor a lock by the ball's own x range (5–95% of the longest run, `court`) can drop it. The court is where the
MAIN players are (`courtp`: 5–95% of the main Vision boxes' x over the clip, + a margin): a ball point outside is
another court's. Margin 0.10–0.20: ball in crop 97.9% (unchanged), hitter 93.4–93.6%; a-10's camera centre max
0.84 -> 0.62 (0 frames past 0.75, was 20). Dropped points, all 27 clips: a-10 10 (the next court), bt-own-f-01 12 at
21.6–23.4 s (the ball after the point Victor saw going right), b-09 9 at margin 0.15 (2 of them labelled: a ball wide of
the court) and 0 at 0.20. **Margin 0.20.** Videos `bt-own-{a-10,f-01}.story-compare-t49.mp4` (today | T49b | T49 =
T49b + court lock).

**49c — the reference reels** (Victor approved T49 and sent 4 beach tennis reels he likes, iPhone screen recordings in
`refs/2026-11-10/beach-tennis/`; measured only). People by YOLOX-Tiny COCO (person class), pan by phase correlation:

| | near player height (of the frame) | near pair both whole | near players' feet (from top) | pan (frame widths / 10 s) |
|---|---|---|---|---|
| the 4 reels | 22–31% | 17 / 95 / 84 / 91% | 53–69% | 0.6 / 1.2 / 4.4 / 1.9 |
| C (25 own + app clips) | 28% | 17% | 70% | 1.6 |
| T49 | 28% | 14% | 70% | 1.7 |

Same player size and pan; what differs is that 3 of the 4 reels keep BOTH near players in the frame. Our near pair
spans a median 0.88 crop widths (fits 65% of the frames, 13–94% by clip), so two `cam_bt.py` options were tried
(`pair`): (1) move the target, when the ball stays inside, so both near players fit; (2) aim at the near pair's centre
with the ball as a limit. (1): pair both in 14 -> 24–26%, ball 97.9 -> 97.3%, hitter at hits 91.4 -> 87–90%; (2): pair
31%, ball 83–92%, hitter at hits 64–70%. The pair can only be kept together by losing the ball or the hitter: the reels
are filmed so the pair is narrower in the frame (the camera further back or wider), and the feet position (70% from the
top) is the source's, since a 1.0x 9:16 crop of a landscape clip takes its full height. **Off; T49 ships as approved.**

**49d — the ball leaves the frame and the next court's ball is followed** (Victor, all three cameras: `bt-own-b-04`
at ~4.5 s goes to the VOLLEYBALL on the court to the left). The rally's ball goes out of the picture after 4.0 s
(labels: none / out from 4.2 s) and the path picks the volleyball at x 0.08–0.24 (4.6–6.4 s, one run >= 1 s). The
players' lock cannot drop it: the left court's players are as tall as ours, so the "main players" span x 0.02–0.81. A
second lock by the rally's own ball (`court`, test 49a's ball range: 5–95% of the longest run's x ± margin; a run or
point outside is dropped) on top of the players' one, 25 clips:

| court (ball) margin | ball in crop | hitter whole / at hits | labelled balls dropped | b-04 camera at 4.5–7 s |
|---|---|---|---|---|
| off (T49) | 97.9% | 94.1 / 91.3% | 0 | goes to x 0.17 |
| 0.10 / 0.15 | 96.9 / 97.0% | 94.4–94.5 / 91.4–91.5% | 8 / 7 | stays at 0.49 |
| 0.20 | 97.7% | 94.5 / 91.6% | 1 | 0.49 |
| **0.25** | **97.7%** | **94.5 / 91.6%** | **0** | **0.49** |
| 0.30 | 97.7% | 94.5 / 91.6% | 0 | 0.23 |

0.25 changes two clips only: b-04 (10 points of the volleyball dropped; hitter at hits 33 -> 100%) and a-04 (5 points
at 10.6–11.0 s, the ball flying out at the left after the point; one labelled point at 10.4 s falls just outside the
crop, 100 -> 97.7%). Videos `bt-own-b-04.story-compare-t49d.mp4` (T49 | T49 + ball lock 0.25) and, for the 2 vs 3
choice on long rallies, `bt-own-{f-01,b-03,a-02,b-01,b-07,b-06}.story-compare-t49d.mp4` (T49 | T49 + reels, both with
the ball lock). **Victor: 3** (T49 + the ball lock + the near pair kept whole where the ball allows) -> the app
(`BallFollowParams.beachTennis`: `ballCourtMargin` 0.25, `keepPair`, `pairPad` 0; `BallRuns.courtLock`,
`BallPlayers.keepPair`; rules `ball-bt-t49d`; `cam_bt.T49` and `ball_parity.py --out-bt` with b-04 added, the locks
dropping 10 / 12 / 10 points on a-10 / f-01 / b-04). 25 clips: ball in crop 97.2%, hitter whole 92.7%, at the hits
90.6%, near pair whole 26%.
Last check on `yt-bt-06` (the vertical web clip, 1.5x; Vision boxes made for it, `mac-people.sh yt-bt-06`): the ball's
own points in the crop 100% in all three; hitter whole 96.6 / 98.1 / 97.0% (at the hits 94.8 / 96.5 / 96.5%), near
pair whole 31 / 38 / 51%, pan 0.8 / 0.8 / 0.6 (before 49 / T49 / shipped). Video `yt-bt-06.story-compare-t49d.mp4`.
Its parity case now has people (aim off the ball on 266 frames; `playersHeight` 0.216 for the verdict, still applied).

**49e — the ball gone out at the top** (Victor, field clip `bt-app-1110-f` with the build of 49d, arena B's side
diagonal at night: the camera went left to the next court's ball at 2.4–5 s, in the app and in the lab alike). A lob
leaves the picture at the top (2.0 s, y 0.12 rising 0.06 per frame; the detector still sees it at 2.2 s at y 0.03 and
again from 3.2 s), and the path takes the next court's ball, a smooth arc mid-frame at x 0.02–0.29, until ours comes
down at 5.1 s. Both court locks keep it: that ball stays inside our players' x range (main players 0.26–0.46 ± 0.20)
and inside the rally's run. Rule (`cam_bt.keep_exits`, `exit`): a point still rising that, at its speed, is within
0.05 of the top edge 2 frames later is going out; the points after it are not followed until one is back within 0.20
of the top and 0.25 frame widths of where it went out. Tried and dropped: resuming at a point near a main player (the
next court's ball passes "behind" our near players in the picture); re-entry at 0.10 / 0.12 or "above 0.15 and rising"
as the exit (they cut real high balls that turn inside the picture: 47–76 labelled balls lost); the same at the side
edges (changes nothing). 26 clips: ball in crop 97.2%, hitter 92.7 / 90.6% (unchanged), 0 labelled balls dropped;
bt-app-1110-f: 23 points of the other ball dropped, the camera stays at 0.42 and goes to 0.33 for our ball's hit at
5.4 s (was 0.16); a-05: 5 points at 10.4–11.4 s the labels mark "out" dropped; yt-bt-06 / the stream / bt-v-1029
unchanged (lab tracks). Videos `bt-app-1110-f.story-compare-t49e.mp4`, `bt-own-a-05.story-compare-t49e.mp4` (app
today | + top exit). In the app: `BallFollowParams.exitTop/exitBack/exitDx` (0.05 / 0.20 / 0.25), `BallRuns.keepExits`
after the court locks, rules `ball-bt-t49e`; `ball_parity.py --out-bt` adds `bt-app-1110-f` (`playersCourt` before the
exit rule in the fixture).

**49f — a more dynamic camera** (Victor on 49e's `bt-app-1110-f`: no longer goes to the next court, but when the
right player attacks at ~3 s the defence on the other side is not shown: the camera stays still). Three changes, all
in `cam_bt.py`: (1) `own`: while the path is dropped after a ball went out at the top, our ball is looked for among the
detector's moving candidates (score >= 0.5, not in a screen, not still: nothing within 0.01 at the analysed frame
before or after), first back at the top (within 0.20, 0.25 frame widths of where it went out), then candidate to
candidate (nearest within 0.08 long sides per frame, 2 frames' worth at most), out at the top again or 4 frames lost =
at the top again. f: our ball found at 2.2, 3.2–3.6 and 4.4–5.0 s (8 points; 26 clips: 1 more, on b-04, labelled
right). (2) `glide`: where the ball is lost in flight, the target goes on the way it was going (x speed of its last
two points) for up to 6 frames, inside the main players' court. (3) `pairnear`: the near pair is kept whole only while
the ball is near one of them (0.25 long sides), not when it is on its way to the other side.

| 26 clips | ball in crop | hitter whole / at hits | near pair whole | pan |
|---|---|---|---|---|
| 49e (top exit) | 97.2% | 92.7 / 90.6% | 26% | 1.5 |
| + own | 97.2% | 92.7 / 90.6% | 26% | 1.5 |
| + own + glide 6 | 98.2% | 93.4 / 90.8% | 25% | 1.6 |
| **+ own + glide 6 + pairnear** | **98.3%** | **93.8 / 91.3%** | **22%** | **1.6** |

f: the camera goes 0.46 -> 0.48 toward the far players at 3.4–4.0 s (was held at 0.43). Tried: the far players as
hitters too (`hitall`; the camera pulled to them, hitter whole 89.6%): off. Videos
`bt-{app-1110-f,own-b-01,own-f-01}.story-compare-t49f.mp4` (49e | 49f). Not in the app yet: waiting for Victor's eye.

**49g — zoom below 1x** (Victor: 49f is the default; on a camera position that is not favourable, the diagonal, try
0.5–0.8x so the ball and the framing stay right). Below 1x the 9:16 crop is wider than the picture is tall: the picture
sits in the middle and the rest is filled with a blurred, darker copy of it (`story.crop_at`; content = zoom of the
output height: 80% at 0.8x, 65% at 0.65x, 50% at 0.5x). 49f, by arena:

| zoom | A (behind, slight diagonal): ball / hitter at hits / pair | B (side diagonal) | app a-e (behind): hitter at hits / pair | 1110-f (diagonal, night) | f-01 | pan |
|---|---|---|---|---|---|---|
| 1.0x | 98.1 / 93.3 / 26% | 98.5 / 86.4 / 8% | 96.2 / 40% | 88.9 / 11% | 94.2 / 28% | 1.2–2.2 |
| 0.8x | 98.4 / 96.6 / 43% | 97.9 / 91.7 / 26% | 98.1 / 62% | 94.4 / 30% | 98.1 / 72% | 0.9–1.5 |
| 0.65x | 98.7 / 98.3 / 59% | 98.8 / 98.3 / 46% | 98.1 / 75% | 100 / 92% | 99.0 / 89% | 0.8–1.2 |
| 0.5x | 99.5 / 99.4 / 83% | 100 / 100 / 71% | 100 / 92% | 100 / 100% | 100 / 94% | 0.5–0.7 |

Everything kept in improves as the crop widens (the crop is 1.25 / 1.54 / 2 times wider); the cost is the players'
size (x0.8 / x0.65 / x0.5: the near players 28% of the output height at 1x -> 22 / 18 / 14%) and the blurred bands.
Videos `bt-{app-1110-f,own-b-01,own-a-02}.story-compare-t49g.mp4` (1.0 | 0.8 | 0.65 | 0.5x). Waiting for Victor's eye
(which zoom, and whether only on the diagonal: then a rule to tell the diagonal from what the phone has).
Victor: 0.8x was the one he liked, but not with the bands (a 9:16 crop wider than 1x has no picture above and below:
there is no way around it but bands, 4:5 or generated picture) -> **stays 1x with 49f**.

**49f in the app**: `BallFollowParams.beachTennis` + `ownMinScore` 0.5, `ownStep` 0.08, `ownLost` 4, `pairNear` 0.25,
`glide` 6; `BallRuns.movingCandidates`, `BallRuns.keepExits(..., cands:)`, `BallPlayers.keepPair(..., nearOnly:)`,
`BallPlayers.glide`; rules `ball-bt-t49f`. `cam_bt.T49` and `ball_parity.py --out-bt` follow (`camera_rects` == 
`cam_bt.camera` with T49 on bt-app-1110-f, b-04, a-05: max diff 0).
Fix (Victor's `swift test`, `testTopExit`): 49f's rewrite of `keep_exits` skipped the "going out again?" check on the
point where the ball comes back (49e did it); lab and Swift fixed alike. 26 clips: ball in crop 98.3 -> 98.6%, hitter
93.8 / 91.3 -> 93.8 / 91.2%, 0 labelled balls dropped; the fixture's drop / found counts unchanged.

**In the app** (beach tennis only; `BallSport.beachTennis`, rules `ball-bt-t49`): `BallCameraParams.beachTennis`
(a 1, b 100), `BallFollowParams.beachTennis` (main 0.6, court margin 0.20, blend 0.4, near 0.25), `BallPlayers`
(`main`, `courtLock`, `aim`, `hitter`); FocusAnalyzer writes the person boxes per row (`people`) and BallAnalyzer
passes them to `BallFraming.compute`. Basketball: camera C, no follow, its fixtures unchanged. `ball_parity.py --out-bt`
now uses `cam_bt.people_rows` / `main_players` / `keep_players_court` / `aim_x` and adds a-10 and f-01 (the lock drops
10 and 12 points there, as above); `camera_rects(..., smooth, aim)` == `cam_bt.camera` T49 on a-02 and b-04 (max diff 0).

### Field check after test 48 (2026-11-10) — `bt-app-1110-a`: the app analysed a beach tennis clip as basketball

Victor's first app clip with the beach tennis build (arena A's court, 12.9 s, `refs/bt-own/field-1110/`): the 9:16
camera went right to the next court at 2–3 s and stayed on it at 6.5–8.8 s, and cut the player hitting the ball. The
app's camera, measured on the export by template matching against the original (every 0.25 s, match 0.90–0.99):
centre 0.50 -> 0.78 at 2.75 s, 0.84 (the right edge) at 6.5–8.75 s. The lab with **basketball's** model and rules
(`ball_tiny_gym`, still 0.5, every point followed) gives the same camera from 5 s on (0.669 / 0.768 / 0.842, mean
|diff| 0.054 over the clip; the ball path at x 0.91–0.97 at 7–9 s = the next court); with beach tennis' (`btpl`, T47)
the camera stays at 0.44–0.59 (mean |diff| from the app 0.159) and never leaves the court. The classifier was unsure
about the clip, so the sport defaulted to basketball. Victor: ask the sport once per recording (its first clip) until
it can be told reliably (`ballSportIdOf` no longer defaults to basketball). Video
`lab/tests/story/bt-app-1110-a.story-compare-t49.mp4` (today | beach tennis C 1.0x). The framing of the hitter
(Victor: the player attacking the ball gets cut) is test 49's other part.

### Test 48 result (2026-11-10) — the beach tennis model for the app, Seguir a Bola per sport

**Model.** The cloud workspace that trained test 45 is gone with its `.pth` files (the Mac kept only the `.onnx`), and
this workspace has no PyTorch, so the recipe ran on Victor's Mac (`tools/lab/mac-train-bt.sh`, `lab/.venv`, CPU, ~1.0 s
per iteration of 16 crops; 5,000 iterations in 1 h 25):
1. `btpub`: YOLOX-Tiny 416 from COCO, `pub-bt01`, `pub-bt02`, `neg-bt01`, 3,000 it.
2. `btplA2`: `btpub` + arena B's crops with every ball marked (`own_relabel.py` with test 45's `btpub.onnx`: 756
   "not a ball" crops of arena B and 158 of arena A had a ball, test 45: 716 / 154), 1,000 it. — the recipe check.
3. `btpl`: `btpub` + both arenas' marked crops, 1,000 it. — the app's model.

| Arena A (not trained on) | detector ceiling | path cover (T47) |
|---|---|---|
| `btpub` (test 45) / today's re-run | 81.8% / 78.0% | 73% / 74% |
| `btplA` (test 45) / `btplA2` (today) | **93.8%** / 88.7% | **90%** / 85% |

A run of the same recipe varies by ~4 points (the public base already differs; the arenas add the same, +12 / +11).
The fair test of the app's model is on clips no beach tennis model trained on — 5 labelled older clips (249 points;
`btplB` and `btpl` both trained on arena A, `btpl` on B too):

| Model | ceiling | path: precision / cover (T47) |
|---|---|---|
| `btplB` (test 45) | 85.5% | 95% / 82% |
| **`btpl`** | **85.1%** | **94% / 82%** |

(bt-rz-1105-a/b, bt-0AE39B33, bt-E5003B6B 91–100% cover each; yt1105-bt 15–24% for both, the clip the verdict turns
down.) Equal where neither has been: `btpl` ships, as it has seen both of the real arenas. Into the app:
`tools/lab/mac-coreml-bt.sh` (`yolox_coreml.py --ball ball_tiny_btpl`, `xcrun coremlcompiler`) ->
`app/modules/replay-camera/ios/Models/ball_tiny_btpl.mlmodelc`. Same architecture and size as `ball_tiny_gym`, so the
phone's speed is the same (test 42).

**App** (spec 2026-11-09, part 4): `Core/BallSport.swift` — a profile per sport (model, path, runs, zoom, screens,
verdict); `.basketball` is exactly the previous values. `BallAnalyzer` takes the sport, loads its model, keeps the
detections per model, renders 160 px grey thumbnails for `BallScreen`, skips a clip recorded too far before analysing
(`playersHeight`, now written by `FocusAnalyzer`), and returns `unsuitable` with a reason. JS: the Foco panel asks "Que
esporte é esta gravação?" where the classifier says another sport (`Session.ballSport.sport`), shows "Esporte: … ·
Trocar", and an unsuitable cut goes back to Modo Foco with the reason. Parity: `ball_parity.py --out-bt` ->
`Fixtures/ball-parity-bt.json` (5 clips: arenas A/B, yt-bt-06, the LED stream, bt-v-1029 turned down);
`BallParityBeachTennisTests`; basketball's `ball-parity.json` regenerated with today's lab: identical.

### Test 47 result (2026-11-10) — beach tennis: when to apply Seguir a Bola, video screens, the ball near the players

Victor after the night rally recorded at 0.5x (`bt-v-1029`: the camera hardly moved, the ball is far: "unnecessary
processing") and the tournament stream (the path on the LED screen): (a) a rule for when the mode is worth it, for every
sport with its own limits ("we do not know how people will record"); test (b) leaving out a video screen and (c)
preferring the ball near the players.

**47a — `ball_verdict.py`** (new; limits per sport in `VERDICT`, beach tennis only so far; other sports: no verdict,
today's behaviour). Today the app always runs the ball analysis when the mode is on and only shows "Bola pouco
visível" under 35% ball (`BALL_SPARSE_SHARE`, `[id].tsx`); nothing decides "not for this clip".
Signals (no labels), measured on the 30 beach tennis clips with `btpl` tracks (T46b) and 16 basketball clips
(`ball_tiny_gym` folds, measure only):

| Signal | beach tennis own arenas (19) | far / bad bt clips | basketball |
|---|---|---|---|
| players' median height in the 9:16 output (Vision, before the ball analysis) | 12–21% | bt-wa-1028 9%, bt-rz-1105-v 10%, bt-v-1029 11% | 9–31% (basket-rp-1105-v-b 9%) |
| ball's median size in the 9:16 output (px of 1080) | 19–24 | bt-rz-1105-v 13, bt-v-1029 15 | 20–85 |
| ball share (trusted after the run filter) | 38–91% | yt1105-bt 15% (precision 46%) | 15–97% |
| camera pan on screen (crop widths / 10 s) | 0.4 (a-06) – 3.6 | bt-wa-1028 0.0, bt-rz-1105-v 0.3, bt-0AE39B33 0.5 | 0.1 (basket-v-01) – 4.1 |

Ball share alone is no quality signal (b-05: 38% ball, 100% in the crop: short rallies). Rule for beach tennis:
**before** the ball analysis (free: today's Modo Foco already ran Vision), players < 10% of the output height at the
largest zoom the sport allows = recorded too far, not offered (no processing); **after**: ball share >= 25%, ball >= 16
px in the output, pan >= 0.6, else the clip stays on today's Modo Foco. Verdicts: off bt-v-1029 (ball 15 px),
bt-rz-1105-v (ball 13 px, pan 0.3), bt-wa-1028 (players 9%), yt1105-bt (ball 15%), bt-0AE39B33 (pan 0.5),
bt-own-a-06 (pan 0.4: the ball stays mid-court, the 9:16 crop hardly needs to move; today's framing keeps it 100%);
on: the other 18 own clips, bt-own-f-01, yt-bt-06, yt-bt-stream-1110, bt-rz-1105-a/b, bt-E5003B6B. Thin calibration
(30 clips, limits close to some clips): to revisit with more recordings. The app also knows the lens at recording
time (0.5x), a direct signal the lab clips do not carry.

**47b — video screens** (`ball_track.screen_boxes`, `SPORT_P["beachTennis"]["screen"] = 1`). On the clip's frames
(160 px wide, every 2nd 100 ms frame), a pixel is active when it changes > 12 grey levels; a connected active region
is a screen when its box is >= 75% active, >= half of it changes at once on >= 12% of the frame steps, and the box is
>= 1.5% of the frame. 32 beach tennis clips: only the stream's LED screen (fill 0.85, sync 0.19; players' regions
fill <= 0.81 with sync 0.00, sync <= 0.08; a 0.5% strip at b-08's edge excluded by the size). Stream: 51 path frames
on the screen -> 0; at 21.4–24.8 s the path is now mid-court (the serve). 19 own clips unchanged (90.6%). Video
`yt-bt-stream-1110.story-compare-t47.mp4` (today | T46b | T47).

**47c — the ball near the players** (`near`, `near_w`, `near_916`, off). Vision finds everyone (next court, crowd),
so "near a person" says little; tried today's Modo Foco crop instead. Native crop (70–90% of the width): nothing
changes. 9:16 crop + 0.1 width, score x0.5: cover 90.6 -> 86.9% (b-01 98 -> 53%: in a class today's framing is on
people off the rally), 6 fewer of 192 ball points far from a rally; +0.2: 90.4%, 2 fewer; +0.3: nothing. Not taken;
a-02's point on the next court (11.6 s) is inside today's crop.

Basketball unchanged (path 465 / 465, story camera 22 / 22 identical to git HEAD; `screen` / `near` default off).

### Test 46 result (2026-11-09) — the beach tennis path

Detections of test 45 (fold-honest: arena A with `btplA`, trained on B; arena B with `btplB`), 709 labelled points.
New tool `path_sweep.py`: tracks every clip in memory with a parameter set (`k=v` for `ball_track.P`, `t.k=v` for
`hybrid.T`) and scores it as `ball_gate.signals` does, pooled per arena; it reproduces test 45 exactly (74.8%).

**1. Where the path lost the ball** (`path_diag.py`, test 45's path; share of the labelled points):

| Arena | blind (detector) | still filter | wrong / none | trusted | hit (cover) |
|---|---|---|---|---|---|
| A | 6% | **16%** | 1% | 6% | 69% |
| B | 5% | 4% | 3% | 7% (b-02: 38%) | 81% |

**2. Still filter.** A ball lying on the sand is found within a few px of the same spot; the old radius (2% of the
long side, 38 px at 1080p) also caught the ball in play whenever it passed near one, or near a fence knot (arena A).
Radius 0.4–1% with share 0.2–0.4 is a plateau (cover 81.0–81.9%); chosen `still_r=0.006, still_share=0.3`
(`SPORT_P["beachTennis"]`). Share alone (0.3–0.7 at 2%) gives at most 78.6%; the filter off falls to 50%.

**3. Trust rules.** With the still filter fixed, `hybrid.trusted` became the main loss (A 13%, B 7%): the round-5
racket rules. Ablation (cover A / B, precision unchanged at 97 / 99%): base 78 / 85%; without the area-jump rule
82 / 91%; without the slow-path rule 87 / 85%; both off (`racket=0`) **90 / 91%**; aspect 3.0 no change. A detector
box's size varies frame to frame (area jumps of 2.5x happen on the real ball), and a ball that moves little for a
second (a lob going away, a soft drop) is often in play. Those rules were made for SAM 2 / EdgeTAM masks sliding onto a
racket, which a detector does not do; the app's `BallTrust.swift` has no racket rules either. So `hybrid.trusted` skips
them for a pure detector path (`detector_path`: every point carries the detector's score) unless `r_det=1` (test 45's
numbers: `t.r_det=1,still_r=0.02,still_share=0.2`). EdgeTAM and fused tracks keep them; basketball is not a racket
sport, unchanged. Cost: on frames labelled "out" more than 1 s from any labelled ball, the camera shows a ball on
A 23 / 62 (was 14), B 63 / 130 (was 49; arena B is a class where other balls fly between points). With the slow-path
rule kept at 0.05 instead, B would be 54 / 130 at the same cover; not taken (the app has no such rule).

**4. Other parameters** (on top of 2 + 3, all cover): `dp_gap` 6 / 16, `vmax` 0.08 / 0.2, `box_max` 0.02 / 0.03,
`s0` 0.03 / 0.1, `move_cost` 0.5 / 2, `conf` 0.1: 89.6–91.1%, within noise of 90.6%; nothing changed.
**Test 39's motion options**: `dp=2` (acc_cost 0.5–2) 90.7–91.0% at precision 98.5–98.6% (a-10 100 → 71% at acc_cost 0.5–1); `fill` 91.5% at
precision 93%; both 92.4% at 94%. Small gains, a lower precision, and `dp=2` is not in the app: not taken.

**Result** (`report.t46-btplA.md`, `report.t46-btplB.md`; tracks `det-t46-btplA/B`):

| Path | arena A: prec / cover | arena B: prec / cover | all 709 points |
|---|---|---|---|
| test 45 | 97% / 69% | 96% / 81% | 96.4% / 74.8% |
| still filter 0.6% | 97% / 78% | 99% / 85% | 97.8% / 81.4% |
| **+ no racket rules on detector paths (test 46)** | **97% / 90%** | **99% / 91%** | **97.7% / 90.6%** |
| detector ceiling | 94% | 95% | 94% |

- Every clip through the gate (b-02 was "não"); worst clips now b-04 75%, b-09 77% (both: the detector is blind on
  10% of their points), a-07 80%. What is left between cover and the ceiling: the detector blind 5–6%, the rest ~1%
  each. Path diagnosis after: A blind 6%, still 1%, trusted 1%, hit 90%; B blind 5%, hit 91%.
- **Story camera C** (`story.py`; these clips have no Vision "today" framing, so a centre 9:16 crop stub stands in, as
  in test 40: `lab/tests/framing/bt-own-*.current.focus.json`). Ball inside the crop, labelled points:

  | Path | C 1.0x | C 1.2x |
  |---|---|---|
  | test 45 | 97.6% | 95.6% (b-02 73%) |
  | **test 46** | **98.6%** (worst b-08 92%) | **96.3%** (worst b-09 87%) |

  Pan 1.9 / 2.3 crop widths per 10 s. Test 31's per-clip zoom rule stays at 1.0x on every clip here because the stub
  has no "today" zoom to scale; it needs the app's real framing. Videos for Victor
  (`lab/tests/story/bt-own-{b-02,a-09,b-03,a-02}.story-compare-t46.mp4`: centre crop | C 1.0x | C 1.2x).
- **46b (Victor's review of the videos, same day)**: liked C 1.0x best; asked for (a) no camera movement before the
  rally starts (b-02: the camera went right and back at 2.0–2.4 s, a 0.5 s "ball" high on the right while no ball was in
  play), (b) no slide to the neighbouring court after the point (a-02, 11.6 / 12.2 s: points at x 0.86 / 0.94), (c) on
  b-03 the left player cut at the end. (a) and (b) are short runs of trusted points: of the 19 clips' runs under 1 s,
  almost none hold a labelled ball. `story.camera` now follows only runs of at least 10 frames (a run ends after 4
  frames without a ball); elsewhere it stays on the base framing. **Beach tennis only** (`RUN_SPORT`); basketball and
  the other sports keep test 46's camera. Sweep (C 1.0x, 19 clips):

  | min run | ball in crop | pan while the label says "out" (crop widths / 10 s) | worst clip |
  |---|---|---|---|
  | off (46) | 98.6% | 2.2 | 92% |
  | 0.5 s | 98.4% | 1.8 | 90% |
  | **1.0 s** | **97.9%** | **1.4** | **90%** |
  | 1.0 s, gap 2 | 95.6% | 0.8 | 65% |

  (c) is the lab's stand-in: these clips have no Vision players framing, so when the ball leaves the camera goes back
  to a fixed centre crop; in the app the fallback is today's Modo Foco framing of the players. Videos
  `bt-own-{b-02,a-02}.story-compare-t46b.mp4` (centre | T46 | T46b, C 1.0x).
- **46c: the real Modo Foco framing as the fallback** (Victor: "how will it look in the app?"). `mac-people.sh` (new,
  on the Mac: the app's Vision person detector, `renders/bt-own-*.people.json`) + `focus_variant.py --preset acao
  --boxes tiled` replace the centre-crop stubs for all 20 bt-own clips (Vision's whole-frame boxes find arena A's
  players on 1–16% of the frames, the tiles on 100%). Ball inside the 9:16 crop, 19 labelled clips:

  | Camera | arena A | arena B | all | pan / pan while "out" (crop widths / 10 s) |
  |---|---|---|---|---|
  | today's Modo Foco 9:16 (players only) | 80.4% | 53.3% | 67.6% (b-01 7%, b-04 15%) | 0.8 / 1.0 |
  | C 1.0x, T46 | 98.9% | 98.2% | 98.6% | 1.9 / 2.3 |
  | **C 1.0x, T46b** | **98.1%** | **97.9%** | **98.0%** | **1.6 / 1.4** |
  | C 1.2x, T46b | 96.8% | 94.0% | 95.5% | 2.0 / 1.8 |

  The ball camera's numbers barely move with the real fallback. Today's framing alone loses the ball on arena B (a
  class: it frames people off the rally, e.g. b-01). Videos `bt-own-{f-01,b-03,b-02,b-01}.story-compare-t46c.mp4`
  (today | C 1.0x T46b).
- **`yt-bt-06`** (web, measure only; Victor: the arena cameras sit in a corner at the end of the court, this one is
  behind the court, centred; indoor, white sand, vertical 1080x1920 30 fps, first 30 s; 1 labelled point, so judged by
  eye). Trusted ball after the run filter: `btplB` 271 / 300 frames, `btplA` 252, the basketball model `bgymall` 79;
  `btplA` and `btplB` agree (< 40 px) on 230 of the 243 frames both have. Test 31's rule picks 1.8x (today's zoom
  1.51x x 1.2 for vertical). Video `yt-bt-06.story-compare-t46c.mp4` (today | C 1.5x | C 1.8x, T46b `btplB`).
- **46d: the story zoom by orientation, beach tennis only** (Victor, after `yt-bt-06` at 1.0 / 1.2x: a horizontal
  recording needs little zoom, a vertical one needs some to give the camera movement). On `yt-bt-06` (vertical
  1080x1920), pan on screen (crop widths / 10 s) and upscale to 1080 wide by zoom: 1.0x 0 / x1.0 (the whole frame),
  1.2x 0.3 / x1.2, 1.35x 0.6, 1.5x 0.8 / x1.5, 1.65x 1.0, 1.8x 1.2 / x1.8; the ball never leaves the crop up to
  1.8x. Horizontal 1.0x already pans 1.6 on the arena clips without losing resolution. Victor chose quality: cap x1.5.
  `story.ZOOM_SPORT["beachTennis"]` / `story.sport_zoom`: horizontal 1.0x fixed; vertical test 31's rule (today's zoom
  x 1.2, kept while the detector's own ball stays in the crop, safe zoom under 35% ball) with `max_upscale` 1.5:
  `yt-bt-06` 1.5x (content 1.81, quality 1.5), `bt-rz-1105-v` 1.05x (ball guard). `auto_zoom` / `ball_share` /
  `self_miss` take an optional `engine` (default: as before). Other sports: `sport_zoom` returns None, test 31
  unchanged (`basket-v-01` still 1.6x). Videos `yt-bt-06.story-compare-t46c.mp4` (the 1.5x panel is the new default)
  and `-t46d` (1.0 / 1.2x).
- **Two more clips, no labels (judged by eye), `btplB` + T46b + 46d zoom** (Victor, 2026-11-10):
  - `bt-v-1029`: vertical 1080x1920 30 fps, 20 s, night open court, camera behind the baseline, a new arena
    (`refs/bt-own/field-1029/`). Ball shown on 135 / 202 frames (`btplA` 125); `btplA` / `btplB` agree on 113 of 116.
    Zoom rule: 1.5x (content 1.71, quality cap 1.5). Follows the rally well. Video `bt-v-1029.story-compare-t46d.mp4`
    (today | C 1.2x | C 1.5x).
  - `yt-bt-stream-1110`: screen recording of a tournament stream (web: measure only; 1414x760 with borders, variable
    frame rate; high camera behind the court; `refs/web/`). Ball shown on 160 / 271 frames; the models agree on only
    99 of 127. At 21.4–24.8 s the path follows round things **inside the video on the venue's LED screen** (top left)
    while the real ball is in the serve (`lab/tests/story/chk-led.jpg`). The slow-ball rule (`r_slow_path` 0.05, free on
    the 19 own clips: cover 90.6% unchanged) drops only 14 of those 35 frames; not taken. A screen showing video is a
    new kind of false ball (also possible at real tournaments); candidates: leave out a bright rectangle whose content
    changes (a screen), or prefer candidates near the players. The 9:16 crop here is 427 px wide (x2.5 upscale): the
    source is low resolution. Video `yt-bt-stream-1110.story-compare-t46d.mp4` (today | C 1.0x).
- **Basketball unchanged (checked, Victor: each sport keeps its own models and tuning).** Every change of tests 46 /
  46b is keyed by sport (`SPORT_P["beachTennis"]`, `RUN_SPORT["beachTennis"]`) or limited to racket sports
  (`hybrid.trusted`'s `r_det`; basketball is not one). The lab code before (git HEAD) and after, on every basketball
  clip: path + trust on all 465 basketball detection files (every tag) identical; story camera C 1.0x / 1.2x on the
  11 basketball clips that have it identical (checked again after 46d); `story.frames`' header read (`-show_streams`) gives the same size, fps
  and rotation as before (ffprobe 6.1, also on a rotated file). No app file and no basketball model was touched.
- **Field rally `bt-own-f-01`** (Victor, 2026-11-09, a third arena never trained on: night, low side camera, another
  court behind; 23.8 s 1080p60, `refs/bt-own/field-1109/`, no labels yet): `btplA` and `btplB` (each trained without
  this arena) put the path on the same point (< 30 px) on 206 of the 208 frames both have, ball in 88–92% of the
  frames after the run filter. Video `bt-own-f-01.story-compare-t46b.mp4` (centre | T46 | T46b, `btplB`). Labelling it
  would make it the first scored clip from an unseen arena.
- `story.frames` now reads the stream with `ffprobe -show_streams` (the `stream_side_data` section of
  `-show_entries` is not in the Mac VM's ffprobe 4.4); same values.
- Next (step 6 of the handoff): the app model trained on both arenas + public (`btpl` all), FocusBench `det5b` on the
  phone, `BallPathParams.beachTennis` (still_r 0.006, still_share 0.3) in `ReplayCore` with `ball_parity.py`
  fixtures, then "EM BREVE" off for beach tennis (`focus/sportCheck.ts`).

### Test 45 result (2026-11-09) — a beach tennis detector (public data + Victor's two arenas)

Data (`lab/train/`): `pub-bt01` (Beach_Tennis_01 without its 834 `cam0b` frames, 799 of which are in Beach_Tennis_02:
3,557 crops, 1,903 with the ball), `pub-bt02` (4,861 / 2,694), `neg-bt01` (3,000 "not a ball" crops from Beach_Tennis_01's
player and racket boxes: heads, torsos, racket heads, scaled by the BALL, `hard_neg.py public --person player --racket
racket --ball-px 13`, since a beach tennis ball is ~half a head), and Victor's clips `bt-own-*` (`ball_train.py dataset
--det bgymall-n5`, ~4,500 crops). Public balls: 7–13 px at 720/1080p, like ours (10–15 px at 1080p). New tool options:
`ball_train_pub.py dataset --part/--merge/--skip`, `train --folds bt` (fold A = arena A scored, arena B trained, and back),
`hard_neg.py public --person/--racket/--ball-px`. Training on the cloud CPU (1.6 s per iteration of 16 crops).

| Model | arena A: ceiling / cover | arena B: ceiling / cover | all 19 clips |
|---|---|---|---|
| `ball_tiny_gym` (basketball, test 44) | 62% / 32% | 43% / 22% | 53% / 28% |
| `btpub`: public sets + negatives, 3,000 it. from COCO | 82% / 58% | 95% / 87% | 88% / 72% |
| `btownA`: + arena B crops and `--fp` as labelled (1,000 it.) | 54% / ~40% | (stopped) | — |
| **`btplA` / `btplB`: + the other arena's crops with every ball marked (45b)** | **94% / 69%** | **95% / 81%** | **94% / 75%** |

- **45 → 45b**: fine-tuning with arena B's crops as labelled made the detector timid on arena A (ceiling 82 → 54%,
  precision 100%). Arena B is a class at night with dozens of balls on the sand and only the ball in play labelled:
  its "not a ball" crops (random and around the old detector's false candidates) were full of real balls.
  `own_relabel.py` runs `btpub` on every own crop and marks its confident balls (score >= 0.4) as positives: 716 of
  arena B's "not a ball" crops and 154 of arena A's had one. Balls on the floor are the path's job (still filter), not
  the detector's.
- **Detector**: 94–95% ceiling on both arenas, never trained on the arena it is scored on: basketball's level.
- **Path**: cover is now well below the ceiling (69–81%), and on arena B lower than with `btpub` alone (b-02 88 → 50%:
  many balls on the sand, the path follows one). Precision is 90–100% on most clips. Next, test 46: the beach tennis
  path (still filter, ball box size, `dp=2` / `fill` of test 39 for the ball in flight, racket trust rules of test 6),
  then story camera C on these clips.
- The app's model will be trained on both arenas (+ public) once the path is settled.

### Test 44 result (2026-11-09) — beach tennis baseline (zero-shot)

First step of the new-sport path (skill `seguir-a-bola-novo-esporte`): what the basketball pipeline does on beach
tennis as it is. Detector `ball_tiny_gym` (all tiles + whole frame, 5 fps, `<clip>.bgymall-n5.json` from test 43b),
path `ball_track.py` with the default parameters (beach tennis has no `SPORT_P` yet), report
`report.t44-bt-base.md`:

| Clip | pts | detector ceiling | path: mode / prec / cover | EdgeTAM fused (test 15, with a tap) |
|---|---|---|---|---|
| bt-0AE39B33 | 30 | 60% | 4% / 80% / 13% | 14% / 94% / 50% |
| bt-E5003B6B | 32 | 31% | 16% / 83% / 16% | 27% / 93% / 44% |
| bt-rz-1105-a | 73 | 55% | 51% / 79% / 36% | 75% / 100% / 81% |
| bt-rz-1105-b | 73 | 12% | 46% / 0% / 0% | 61% / 8% / 3% |
| bt-rz-1105-v | 54 | 31% | 41% / 19% / 6% | 9% / 0% / 0% |
| yt1105-bt | 41 | 0% | 32% / 0% / 0% | 72% / 30% / 7% |
| bt-wa-1028, yt-bt-06 | 1 each | — | — | — |

- The basketball detector sees the small yellow ball in 0–60% of the labelled points (basketball: ~90%); the path then
  follows something else on most clips. Nothing to tune in the path before a beach tennis detector exists.
- **Victor's own beach tennis recordings (2026-11-09)**: 19 app clips (1080p60, 7–19 s), arena A (`bt-own-a-01..10`,
  373 labelled ball points) and arena B (`bt-own-b-01..09`, 336 points), labelled by Victor the same day
  (`refs/bt-own/<arena>/`, own data: train and measure, by arena). Same zero-shot baseline (`report.t44-btown-base.md`):

  | Set | pts | detector ceiling | path cover |
  |---|---|---|---|
  | arena A | 373 | 62% | 32% |
  | arena B | 336 | 43% | 22% |
  | all 19 | 709 | 53% | 28% |

  Path precision varies a lot by clip (0–100%): when the detector misses the ball, the path follows a head, a shoe or
  a light. The beach tennis detector (test 45) is trained on one arena and scored on the other.
- **Beach tennis datasets found by Victor (2026-11-09)**, both Roboflow Universe, CC BY 4.0 (README.roboflow.txt in the
  export), COCO, in `lab/datasets/Beach_Tennis_01_4164_images/` and `Beach_Tennis_02_4444_images/`:

  | Dataset | Images | Classes | Ball size (long side) | Source of the frames |
  |---|---|---|---|---|
  | `beach-tennis-analysis/beach-tennis` v9 | 4,164 (1080p, 720p, 360p) | ball 2,156, player, racket, net | median 0.7% | 2,779 from a live stream of an ITF BT 200 tournament (Toledo PR, scoreboard and #SELIGANOPLAY on screen), 834 from a fixed "Filma Eu" arena camera (cam0b), a few others |
  | `beach-tennis-ball/beach-tennis-mg42r` v5 | 4,444 (720p) | ball 3,599 | median 0.5% | all from the same "Filma Eu" arena camera (7 segments, cam0b); overlaps the first set's cam0b frames |

  Much closer to the app than tennis/padel sets (beach courts, end view, ball as small as ours). The licence is the
  uploaders'; the frames are a tournament stream and a commercial arena-camera service, the same kind of risk as the
  basketball set of test 28 (Victor kept it for internal training). Duplicate cam0b frames between the two sets to be
  removed before training.
- Labels of the older clips are thin: 6 clips with 30–73 points, 2 with one. Before training: more of Victor's recordings (2–3 venues,
  side and end views, day and night) and denser labels, split in two halves by venue.
- **Public data for the racket-sport detector (licence check, 2026-11-09, Roboflow Universe pages)** — kept only CC BY
  4.0 (credit in the app), image source to be checked on the samples after download (scraped broadcast frames are a
  licence risk, as in test 28):

  | Dataset | Licence | Images | Classes | Note |
  |---|---|---|---|---|
  | `padel-rbqpp/padel-detection-5` | CC BY 4.0 | 5,267 | ball | video frames; padel ball ≈ beach tennis ball, rackets around |
  | `viren-dhanwani/tennis-ball-detection` | CC BY 4.0 | 578 | tennis ball | video frames (some synthetic?) |
  | `technische-universitt-mnchen/tennisball_annotation` | CC BY 4.0 | ? | 1 | |
  | `gani-moli-s-yym2m/tennis_ball_detection-t5wnx` | CC BY 4.0 | ? | ball, court, players | only `ball` used |
  | `ahmad-workspace/tennis-ball-detection-hpv6q` | CC BY 4.0 | ? | ? | |
  | `padelytixs-workspace/padel-tracking` | CC BY 4.0 | 508 | ball + 4 players | only `ball` used |

  Left out: `tennis-rally-detection/tennis-ball-detection-e5vmz` and `joel-emmenegger/tennis-ball-detection-lvsp5` (no
  licence stated); the TrackNet tennis dataset (broadcast TV frames, no commercial licence found).
- Next: a one-class beach tennis detector (public tennis/beach tennis ball data with a commercial licence, checked one
  by one; "not a ball" crops of rackets, heads, net tape, lights; Victor's clips by fold), then the path's racket options
  (test 39 `dp=2`, `fill`; test 6 round 5 trust rules).

### Test 43 result (2026-11-09) — telling basketball from the other sports automatically

Victor (2026-11-09): rather than asking the player the sport before Seguir a Bola (basketball only for now), can the app
tell by itself? Two free, on-device signals, on every clip of clips.txt (75 basketball: our gyms, other courts, web
clips; 19 other sports: beach tennis, volleyball, beach volleyball, futevôlei, tennis, society; web clips used only to
measure). Results: `lab/tests/sport/t43a.json`, `t43b.json`.

**43a — Apple's scene classifier** (Vision `VNClassifyImageRequest`, built into iOS/macOS, no model to ship;
`sport_classify.swift` on Victor's Mac, 3 frames per clip at 20/50/80% of its window, 94 clips in 7 s; the label's
highest confidence over the 3 frames; ref-tennis-02 gave no frame, its codec):

| Rule | basketball clips kept as basketball | other sports recognised |
|---|---|---|
| "basketball" >= 0.1 (is basketball) | 40% | — (0% of the others reach it) |
| another sport's label (volleyball, tennis, ping_pong, badminton, soccer, football) >= 0.3 and "basketball" < 0.1 | 74 / 75 | 16 / 18 |
| same at **>= 0.4** | **75 / 75** | **14 / 18** |
| same at >= 0.5 | 75 / 75 | 11 / 18 |

- The classifier rarely says "basketball" on our amateur gym footage (people, structure, fence, window come first), so
  it cannot confirm basketball; but it often names the other sports (beach tennis comes out as "volleyball"), so it can
  rule basketball out. Missed at 0.4: two beach tennis clips (bt-wa-1028 0.29, bt-rz-1105-v 0.14), futevôlei/volleyball
  near the line. Basketball clips closest to the line: own side-low-normal-05 (volleyball 0.32), yt-basket-04 (tennis
  0.50 but basketball 0.12), side-low ping_pong ~0.2–0.3.
- Small sample on the other side (18 clips, mostly web videos), and the basketball side is mostly two gyms: to be
  confirmed in the field before it hides anything for good.

**43b — the app's own detector** (`ball_tiny_gym`, all tiles, 5 fps, path with still 0.5, trusted points; 19 new runs
`<clip>.bgymall-n5.json`, basketball from tests 38–40): share of frames with a trusted ball, basketball 22–100%
(median ~72%), other sports 11–62% (it does find volleyballs and tennis balls). Any threshold drops basketball clips or
keeps most others (>= 0.35: 97% / 53%). Not a usable signal on its own.

- **Proposed for the app**: classify 3 frames of the first clip(s) of a recording (milliseconds), and only when another
  sport's label is >= 0.4 with "basketball" < 0.1 show Seguir a Bola as "EM BREVE" (B3) for that recording; in every
  other case allow it. Wrongly hiding it from a basketball player is worse than letting another sport try it.

### Test 42 result (2026-11-09) — phone cost of "Seguir a Bola" without EdgeTAM, and all tiles in one Core ML call (FocusBench `det5`, `det5b`)

Victor (2026-11-09): the vertical export that follows the ball is named **"Seguir a Bola"**, a switch under Modo Foco in
the Edit screen's Foco panel (the two exclude each other; Modo Foco stays the default); it asks for **no tap**, so the
two EdgeTAM passes are not needed (tests 35–40 scored the detector alone); the user cuts the clip first. Two runs on the
iPhone 16 Pro Max (iOS 27.0.1, unplugged, brightness 66%, Low Power off, the 3 bench clips in a loop, 10 min each,
`ball_tiny_gym@416`, all tiles + whole frame at 5 fps; `lab/tests/ios/soak.det5{,b}-gym416.iPhone17_2.20261109-*.json`):

- **A, `det5`**: one Core ML call per region (as tests 34/38).
- **B, `det5b`** (new): all a frame's regions in ONE call (`MLModel.predictions(fromBatch:)`, the same model file);
  on the first frame it also runs them one by one and records the largest output difference (`batchMaxDiff`).

| Run | per 30 s clip (19 regions per frame), first 5 min | after 5 min | model ms per region | thermal | battery (Victor's readings) |
|---|---|---|---|---|---|
| A, one call per region | **34 s** (max 36) | 14 s (the "fast state" again) | 11 → 4.5 | fair at 6.5 min | 72 → 69% for 40 clips |
| **B, one call per frame** | **10.6 s** (max 12.3) | 11 s | **2.5–2.9** | fair at 1.1 min, serious at 6.6 min | 68 → 62% for 72 clips |

- **Identical results**: `batchMaxDiff` = 0 on every clip and the candidate counts match run A exactly (7407 / 1697 /
  1112): batching changes nothing in the output.
- **From 64 s (test 34, with EdgeTAM) to ~11 s per 30 s clip**, about 6x: EdgeTAM out (−26 s) and batching (34 → 11 s).
  Steady from the first clip, with no reliance on the Neural Engine's unexplained fast state. For the cut clips Victor
  expects (≤ 10 s), about 4 s.
- Analysing at 2.5 fps instead of 5 would halve the time but loses the ball (simulated by dropping every other analysed
  frame of the held-out detections; reports `report.t42-{gym,ext}-s4.md`): cover 82 → 64% on our gym and 82 → 59% on
  other courts, precision 92 → 78%, story ball in crop 98 → 95% (1107). Not an option.
- Heat and battery per clip are about the same (B does ~1.8x the clips per minute in this nonstop loop, so it warms
  sooner: about 0.08% battery per clip in both). In the app one clip at a time is a few seconds of work.
- **iPhone XR (A12, iOS 18.7, run B, 2026-11-09)**, same setup (brightness 75%, unplugged;
  `soak.det5b-gym416.iPhone11_8.20261109-1052.json`), 19 clips in 10 min: **36.5 s per 30 s clip** at first, 3.4x the
  16 Pro Max, rising to 45.6 s at the end (model 9.0 → 11.5 ms per region as it throttled); the 9-region beach clip
  12 → 15 s. A 10 s cut ≈ 12–15 s. Thermal fair after the 2nd clip (0.8 min) and **serious from the 3rd (1.4 min) to the
  end**, though Victor felt the phone no warmer than "fair" by hand (the OS's state follows the chip, not the case).
  Battery 68 → 60% (Victor's reading). `batchMaxDiff` 0 on every clip; candidate counts 7496 / 1715 / 1126 vs 7407 /
  1697 / 1112 on the 16 Pro Max (about 1% more, the A12's Neural Engine rounds differently): the spec's on-device
  detector check (§5) must compare paths, not raw counts.
- **Decision for the app**: Seguir a Bola = `ball_tiny_gym`, all tiles + whole frame, one batched Core ML call per
  analysed frame (5 fps), path (`ball_track.py`, still 0.5) and camera C; no EdgeTAM.
- **App port, parity (2026-11-09, spec `docs/superpowers/specs/2026-11-09-follow-the-ball-design.md` §5)**: the path,
  trusted points, camera C and zoom rule are ported to Swift (`ReplayCore` `BallPath`, `BallTrust`, `BallCamera`,
  `BallZoom`). `ball_parity.py --out …/Fixtures/ball-parity.json` writes the lab's inputs and results for 4 clips
  (1107-a, 1107-d, ext 1109-b, yt1105-a); `BallParityTests` replays them: same ball frames and positions (1e-6), same
  trusted frames, same zoom (1.2, 1.2, 1.0, 1.05), 9:16 rects within 5e-8 (the fixture's 7-decimal rounding).
  `ball_parity.py --check` asserts its camera still equals `story.camera`.

### Test 40 result (2026-11-09) — the app's detector on other courts (11 newly labelled clips)

Victor gathered 11 clips of other courts (2026-11-09, `refs/2026-11-09/`: screen recordings of web videos, so used to
measure only), and labelled 12 s windows of them (`basket-ext-1109-a..k`: a = outdoor court with a scoreboard overlay;
b–d a wooden-floor gym; e–f a gym with teal walls; g–k a black-and-yellow gym; several camera spots; 441 points with
the ball in play and visible). Detector alone (no tap), all tiles, path with still 0.5; reports `report.t40-*.md`:

| Detector | ceiling | precision | **cover** |
|---|---|---|---|
| `ball_tiny_hn` (public + "not a ball") | 92% | 89% | **82%** |
| **`ball_tiny_gym`** (+ our gym's 12 clips, the app's model) | 91% | 90% | **82%** |
| `ball_tiny_gym` with the old still filter 0.2 | 91% | 87% | 72% |

- **Other courts are as good as our gym** (82% / 90%, against 82% / 92% on our gym by halves): the detector carries over.
  Our gym's labels neither help nor hurt elsewhere on average (per clip: outdoor a 71 → 57%, b 45 → 51%, c 84 → 91%).
- The still filter at 0.5 holds on new courts too (+10 cover).
- Story camera C at 1.2x on 5 of them (a, b, e, j, k; `lab/tests/story/basket-ext-1109-*.story-compare-t40.mp4`,
  left panel: a fixed centre 9:16 crop, because these clips have no Vision "today" framing — the stub
  `lab/tests/framing/basket-ext-1109-*.current.focus.json` is that centre crop, also camera C's fallback): ball inside
  the crop 96.7% (centre crop 57%); outdoor a 84%, the others 98–100%; 2.3 direction changes per 10 s.
- Victor saw a slight stutter in some of these videos. Cause: the clips are screen recordings with a variable frame
  rate (frames 15–48 ms apart; on 1109-b 40% of the frames are repeats of the previous one), and `story.py` read every
  frame with OpenCV and timed it as k / nominal fps, so the export played them at uneven speed and the crop drifted off
  its time. Fixed: `story.frames` now decodes with ffmpeg's fps filter from the real timestamps onto a constant 30 fps
  timeline (60 when the source averages ≥ 55 fps); the videos were re-rendered. Constant-rate sources (the app's
  recordings) render exactly as before (1107-a: the same 505 frames). For the app: its export must place frames by
  their presentation timestamps (AVFoundation does), never by frame count.
- Victor (2026-11-09) first asked to train on these clips too (test 41: crops built, two venue-held-out models started),
  then stopped it to keep the data policy: web videos are used to **measure only**, never to train. The crops were
  deleted; no model was trained on them.
- Where it loses the ball (`path_diag.py`, 441 points): blind 11% (outdoor a 27%, k 28%: small far ball), another
  candidate 5% (b 18%), still 2%, empty path 2%, trusted 2%. Weakest clips: a (outdoor, 57%), b (51%), k (70%).

### Test 39 result (2026-11-09) — a motion model in the ball path (the Kalman idea, offline) (`ball_track.py dp=2`, `fill`)

Why: after test 38 the path still loses the ball behind the railing / players and sometimes stays on a wrong candidate
(test 37/38 `path_diag.py`). Victor asked about Kalman filters (2026-11-08): their core is a motion model that predicts
where the ball goes and carries the track through short gaps. Our path is offline (it sees the whole clip), so the
offline forms were tried, as options of `ball_track.py` (default off):

- `dp=2 acc_cost=a`: Viterbi whose state is (candidate, previous candidate): each step also costs a × its distance from
  where the previous step's velocity would put the ball (constant velocity), on top of the distance cost; the 8
  strongest candidates per frame (`dp_topk`).
- `fill=1`: the frames a path jumps over (≤ 1 s) get the straight line between the points around them (a smoother
  through the gap) instead of "no ball".

Scored on held-out detections only: gym halves with `bgym-n5` (each clip detected by the half-model that never saw it),
the 7 old clips with `bgymX-n5`. Detector alone (no tap); reports `report.t39-<variant>-{X,Y,O}.md`:

| Path | gym half X: prec / cover | gym half Y: prec / cover | 7 old clips: prec / cover |
|---|---|---|---|
| test 38 (dp=1) | 90% / 82% | 94% / 83% | 87% / 74% |
| motion model, `acc_cost` 0.5 / 1 / 2 / 4 | 90 / 80, 89 / 79, 91 / 78, 90 / 74 | 96 / 81, 99 / 82, 99 / 80, 99 / 76 | 89 / 75, 89 / 75, 91 / 73, 91 / 71 |
| straight line through gaps (`fill`) | 84% / 82% | 90% / 86% | 81% / 77% |
| both (`acc_cost` 1 + `fill`) | 86% / 81% | 92% / 86% | 84% / 80% |

Story camera C (ball inside the 9:16 crop; 1107 clips 1.2x / 1.5x; 7 old clips at their lower / higher zoom):

| Path | 1107 | 7 old clips |
|---|---|---|
| test 38 | 98.3% / 95.8% | 97.1% / 95.7% |
| motion model (`acc_cost` 1) | 98.3% / 97.4% | 95.5% / 93.9% |
| `fill` | 98.3% / 97.4% | 97.4% / 95.8% |
| both | 98.3% / 98.3% | 96.5% / 94.8% |

- **The motion model does not pay.** It raises precision (fewer jumps: half Y 94 → 99%) but loses the ball where it
  changes direction abruptly, which in basketball is all the time: a dribble bounces every ~0.4 s, a pass is caught, a
  shot hits the rim, and we see the ball only every 200 ms (5 fps). It even brings back test 37's torso case (1108-c
  78 → 65%) and 1108-b (82 → 65%), and the story camera loses up to 9 points on yt1105-basket-b (88 → 79%). Higher
  `acc_cost` is worse. A Kalman/constant-velocity prior suits a ball in flight (tennis, volleyball serves), not a
  dribbled ball at 5 fps.
- **The straight line through gaps** adds cover where the ball is labelled behind something (half Y +3, old clips +4:
  1107-d 68 → 77%, 1108-c 78 → 83%, rp-1105-h 64 → 72%) but costs 4–6 points of precision (a bounce or a pass is not
  a straight line), and the story camera barely changes (≤ +1.6): its dead zone and smoothing already carry it through
  short gaps.
- **Not adopted**; the default stays test 38's path. The options stay in `ball_track.py` for the racket sports, where a
  ball in flight is the common case (to try in their own tests).

### Test 38 result (2026-11-08) — `ball_tiny_hn` + our gym's labels (`ball_train.py dataset --det`, `ball_train_pub.py --extra`)

Why: test 37's losses in our gym (the ball behind the railing's bars, a shirtless torso taken for the ball). Training
crops from Victor's 12 labelled gym clips (`ball_train.py dataset --det bhn-n5`: 2 crops of 320 px per labelled ball,
box size from `ball_tiny_hn`'s candidate on it, + a random crop without the ball + crops around `ball_tiny_hn`'s two
strongest false candidates per labelled frame — torsos, heads, the railing; `lab/train/basket-app-110{7,8}-*`, 2,000
crops, 709 with the ball). Two halves, each mixing both camera spots: X = 1107-a, 1107-c, 1108-a, 1108-b, 1108-e,
1108-g; Y = the other six. `ball_tiny_gym{X,Y}`: init `ball_tiny_hn`, the same public + "not a ball" sets, `--extra
<the OTHER half's 6 sets> --extra-weight 1.0`, 1000 iters, lr 0.0005, frozen BN; each scored on the half it never saw.
All tiles, path with still 0.5, detector alone (no tap):

| Clips | `ball_tiny_hn`: ceiling / prec / **cover** | + our gym's labels (by half): ceiling / prec / **cover** |
|---|---|---|
| half X (6 clips) | 88% / 93% / **76%** | 91% / 90% / **82%** |
| half Y (6 clips) | 82% / 86% / **73%** | 88% / 94% / **83%** |
| **all 12 gym clips** | 85% / 89% / **75%** | **89% / 92% / 82%** |
| the 7 old clips (other courts), model X / Y | 80% / 84% / **71%** | 82% / 87% / **74%**; 77% / 88% / **68%** |

- **+7 cover and +3 precision in our gym**, on clips the model never saw. Per clip: 1107-a 71 → 100%, 1108-b 59 → 82%,
  1108-c 43 → 78% (the torso is gone), 1108-f 77 → 92%; worse on 1108-e 96 → 78% and 1108-a 78 → 70%. Where it
  loses the ball now (`path_diag.py`): blind 14 → 10%, still filter 5 → 2%, another candidate 4%.
- Elsewhere it does not get worse on average: on the 7 old clips (other courts) cover +3 / −3 (model X / Y), precision
  +3 for both.
- Story camera C on the 4 1107 clips (ball inside the 9:16 crop): 1.2x 92 → **98%**, 1.5x 85 → **96%**, direction
  changes per 10 s 3.1 → 2.1 (it holds the ball instead of jumping between candidates). Videos (Hoje | T35 | T38):
  `lab/tests/story/basket-app-1107-{a,d}.story-compare-t38.mp4`.
- Caveat: all 12 clips are from one gym and one day, so the gain is measured where the labels come from; the 7 old
  clips say it does not hurt other courts, but clips from another gym will tell how much of it carries over.
- **The app's model: `ball_tiny_gym`** (the same recipe with all 12 gym clips; nothing left to score it on in that gym,
  its estimate is the halves' 82% / 92%).

### Test 37 result (2026-11-08) — 12 new labelled clips from our gym: an independent check of tests 32–35

Victor labelled (2026-11-08, `server.py`, all clicks) the 4 basket-app-1107 clips and 8 new ones,
`basket-app-1108-a..h` (`refs/2026-11-08/`, app exports with the "@reprize.app" mark, 1080p, landscape, 4.6–11.5 s,
the same gym as 1107 from two camera spots, behind a railing): 455 samples, 326 with the ball in play and visible
(`labels/basket-app-110{7,8}-*.ball.json`). None of these clips was used to train or to choose any setting, so they
check tests 32–35 independently. Detector alone (no tap; the story camera's input), means of the 12 clips (reports
`lab/tests/detect/report.t37-*.md`):

| Detector, path | ceiling | precision | **cover** |
|---|---|---|---|
| `ball_tiny_hn`, two stages (`a3k2`), still filter 0.2 (test 32's path) | 74% | 84% | **59%** |
| `ball_tiny_hn`, two stages, still 0.5 | 74% | 81% | 63% |
| `ball_tiny_hn`, all tiles, still 0.2 (test 34) | 85% | 87% | 68% |
| **`ball_tiny_hn`, all tiles, still 0.5 (test 35, current)** | **85%** | **89%** | **75%** |
| `ball_tiny_hnownA` / `B` (+ our old hand labels, test 32), all tiles, still 0.5 | 84% / 83% | 84% / 85% | 72% / 72% |

- **All three decisions hold on new clips**: all tiles (+11 ceiling, +9 cover), still filter 0.5 (+7 cover, +3
  precision), and the current path does better here (75% / 89%) than on the 7 old clips (71% / 84%).
- **Our old hand labels do not help in our gym**: the fold models trained with them (mostly YouTube and other courts)
  are 3 points worse in cover and 4–5 in precision than `ball_tiny_hn` alone. The app's model is `ball_tiny_hn`.
- Story camera C at 1.2x, ball inside the 9:16 crop, on the 4 1107 clips (the 1108 clips have no "today" framing file,
  which needs the Mac): today's Modo Foco 75%, two stages 83%, all tiles 92% (still 0.2 or 0.5 alike; at 1.5x 87 vs
  85%, 2 points of 110). Direction changes per 10 s 1.1 (today) → 2.4 (all tiles, 0.2) → 3.1 (0.5).
- Where the current path still loses the ball (`path_diag.py`, 325 points): **blind 14%** (no candidate on the ball:
  behind the railing's bars, behind players; 1107-d 29%, 1108-b 24%, 1108-c 22%), **still filter 5%** (a ball held
  in place for over 2 s: 1108-g 5.0–7.0 s, 22% of that clip), **another candidate 4%** (1108-c 1.0–2.8 s: the path
  stays on a shirtless player's torso while the ball comes in from the left edge and then shows only weakly through
  the railing, scores 0.06–0.14), `trusted` 2%, empty path 1%.

### Test 36 result (2026-11-08) — are the ball labels in time with the detector's frames? (`label_sync.py`, `frame_sync.py`)

Why: many of test 35's "blind" points (no candidate on the labelled ball, 20% of the points) show the ball clearly a
little away from its label, in passes, shots and dribbles. Suspicion: the labelling frames (extracted on Victor's Mac)
and the detector's frames (decoded here) are not the same moments.

- **They are the same frames.** `frame_sync.py` compares a frame with this machine's decode at 30 / 60 fps around its
  tick (pixel difference): Victor's frames (ffmpeg 9.0.2 on macOS, `lab/frames/<clip>/`, re-extracted 2026-11-08) and
  the detector's frames (ffmpeg 6.1 in the cloud; 4.4 on the Mac's Linux VM) land on the same frame on all 7 clips (4
  ticks each). Neither the ffmpeg version nor the machine moves the frames.
- A first check (`label_sync.py`: the detector on 30 fps frames shifted -133..+133 ms, hit share per shift) seemed to
  say the labels were ~33 ms late on 4 of 7 clips. **That was wrong**: the `fps=30` grid's frame 3k is NOT the `fps=10`
  frame k (the filter rounds differently; the 10 fps frame is 30 fps frame 3k+1, i.e. "+33 ms" in that table). Read
  against the detector's own frame, the labels are in time on 6 clips (yt1105-basket-b 77%, v-a 93%, h 76%, v-01 88%,
  yt1105-basket-a 83% at the detector's frame; v-b within noise) and yt-basket-04 is 10 points better one frame later
  (30 points, within noise).
- So the "blind" points are partly **imprecise clicks**: on a sample of 30, about a third show the ball clearly visible
  one to three lab radii from the click, in fast moments where the ball is blurred (all 98 labels of yt1105-basket-b
  are clicks, none from SAM). The rest are real detector misses: the ball held in hands and half covered (most of
  yt-basket-04's), in the net, behind a player, and once under the app's watermark (basket-rp-1105-v-a 14.2 s: the
  clip is an app export with the mark burnt in). The scores are slightly pessimistic, the same for every method.

### Test 35 result (2026-11-08) — where the ball path loses the ball, and a fix (`path_diag.py`, `ball_track.py`)

Why: with all tiles (test 34's choice) the detector has a candidate on the ball at 80% of the labelled points
(ceiling) but the path is on it at only 57% (cover, detector alone): the gap is the path, not the detector. Victor
(2026-11-08): make basketball as good as possible first, then beach tennis / tennis / the other sports, each with its
own tests.

**Diagnosis** (`path_diag.py --det bhn-n5 --track det-bhn-n5`): per labelled point, the first stage that loses the ball.
All 7 clips, 500 points:

| | blind (no candidate on the ball) | shape filter | **still-object filter** | path on another candidate | path empty | `trusted` | outside ball mode | **hit** |
|---|---|---|---|---|---|---|---|---|
| `ball_track` as in test 17 | 20% | 1% | **13%** | 2% | 1% | 2% | 0% | **60%** |
| still filter 0.5 for basketball | 20% | 1% | **1%** | 4% | 1% | 2% | 0% | **70%** |

The still-object filter (a candidate with another candidate within 2% of the long side on ≥ `still_share` of the
analysed frames within ±2 s is a lamp, a logo, a spare ball) was set at 0.2 in test 17 for the COCO detector, which
fired on many still things. With our basketball detector it throws away the REAL ball while it is held, dribbled in
place or waits for a free throw: up to 30% of the points on basket-rp-1105-v-b, 29% on basket-v-01.

**Sweep** (all tiles, `bhn-n5`; means of the 7 clips; det = detector alone, no tap; mix = with EdgeTAM from a tap):

| `still_share` | det prec / cover | mix prec / cover |
|---|---|---|
| 0.2 (test 17) | 79% / 57% | 79% / 68% |
| 0.4 | 84% / 70% | 85% / 77% |
| **0.5 (adopted for basketball)** | **84% / 71%** | **84% / 76%** |
| 0.6 / 0.8 | 84% / 71%, 82% / 70% | 84% / 76%, 83% / 75% |
| off (1.01) | 58% / 50% | 60% / 55% |

- A plateau from 0.4 to 0.8, on both folds' clips (fold A clips 65/52/63 → 77/72/73%, fold B clips 44/50/63/63 → 70/75/66/63%), and
  on every model: `bhnown` (by fold) 57 → 68% detector alone, 70 → 76% mix; two stages (`a3k2`) 55 → 68% / 68 → 75%.
  Turning the filter off is much worse (the rim and the spare balls come back). Per clip, detector alone: v-a 65 → 77,
  v-b 44 → 70, h 52 → 72, v-01 50 → 75, yt-04 63 → 66, yt-a 63 → 73, yt-b 63 → 63%.
- The other knobs do not pay: box size (`box_max` 0.06 → 0.10: nothing), a cost for standing still (`still_cost` 0.05
  → 1.0: ±0.2), longer windows (`still_win` 40 / 80: −0.5 to −1). A higher cost per distance moved (`move_cost` 4–6)
  raises precision to 86–87% but cuts the detector-alone cover (71 → 55% at 12) and is not stable across models; kept at 1.
- What is left is mostly the detector (20% of the points have no candidate on the ball) and 4% wrong candidates.
- **Default now** (`ball_track.py`, `SPORT_P`): `still_share` 0.5 for basketball; the other sports keep 0.2 until their
  own tests. The app's version of the path must use the same value. Unlabelled 1107 clips: the path changes on few
  frames; on 1107-d it now follows the shot into the net (5.0–5.8 s; before, it lost the ball after 5.0 s) and 1107-c
  gets the ball in a player's hands at 4.4 s; on 1107-b it takes a ball lying by the goal for 0.2 s (1.4–1.6 s), and on
  1107-d at 7.8 s a player's back (checked by eye on the frames).

**Story camera** (camera C, the detector alone, no tap; ball inside the 9:16 crop at the labelled points, `story.py`;
horizontal at 1.2x / 1.5x, vertical at 1.65x / 2.0x):

| Ball track | ball in crop, lower zoom | higher zoom | direction changes per 10 s |
|---|---|---|---|
| today's Modo Foco 9:16 | 76% | — | 1.4 |
| test 34 (`det-bhn-n5`) | 95% | 90% | 2.0 / 2.7 |
| **test 35 (`det-bhn-n5-s50`)** | **96%** | **95%** | 2.6 / 2.8 |

The gain shows most at the higher zoom (90 → 95%): the camera can come closer. It also moves a bit more (it follows the
ball where it used to fall back to the players' framing; basket-rp-1105-v-b 1.4 → 3.5 direction changes per 10 s).
Videos (Hoje | T34 | T35, camera C): `lab/tests/story/<clip>.story-compare-t35.mp4` for basket-app-1107-d and
yt1105-basket-a (1.2x), basket-rp-1105-v-b and basket-v-01 (1.65x).

### Test 34 result (2026-11-08) — `ball_tiny_hn` + automatic labels on our recordings, and its phone cost with all tiles (`ball_train_pub.py --extra`, `yolox_coreml.py --ball`, FocusBench)

Two questions after Victor kept the public dataset (test 33): (A) does `ball_tiny_hn` get better with the 2,764 balls
that it labelled itself on the 36 app recordings (test 33b's `lab/train/pl-own-*`, a "self-training" step on our
courts)? (B) What does the detector on ALL 416 tiles of every analysed frame (the variant that fixed basket-app-1107-a
in test 32) cost on the phone?

**(A) Models** (init `ball_tiny_hn`, 1000 iters, lr 0.0005, frozen BN, the same `pub-lbacg` + `neg-lbacg` at weight
0.5, plus `--extra <36 pl-own sets> --extra-weight 1.0`; cloud CPU ~22 min each): `ball_tiny_hnpl` (no hand labels,
scored on all 7 clips) and `ball_tiny_hnownpl{A,B}` (+ our hand labels and false candidates of the other fold, `--fold
--fp`, as `bhnown`). Detection on all 416 tiles (`<tag>-n5`, the variant chosen below), path on it, mix with EdgeTAM;
reports `lab/tests/detect/report.{det,mix}-<tag>full.md` (the two-stage `a3k2` reports without `full` too); `bhnown`'s
all-tiles reports were added for the comparison. Means of the 7 clips:

| Model, all tiles | ceiling | detector alone: prec / cover | **mix with EdgeTAM: prec / cover** |
|---|---|---|---|
| `bhn` (test 32) | 80% | 79% / 57% | 79% / **68%** |
| `bhn` + automatic labels (`bhnpl`) | 83% | 76% / 52% | 77% / **63%** |
| `bhnown` (test 32, by fold) | 80% | 82% / 57% | 81% / **70%** |
| `bhnown` + automatic labels (`bhnownpl`, by fold) | 83% | 82% / 57% | 82% / **68%** |

- **The automatic labels do not help**: the detector sees the ball among its candidates a bit more often (ceiling
  +3), but the path picks wrong candidates more often: mix cover −5 without hand labels (`bhnpl`: v-01 50 → 33%,
  yt1105-basket-a 74 → 65%, yt-basket-04 80 → 89%) and −2 with them. The two-stage path gives the same picture (mix
  68 → 62%, 69 → 67%). About 10% of the automatic labels are not the ball (test 33b's sample sheet), and they come from
  the very model being trained, so it learns its own mistakes; and our recordings add few new looks to a dataset of
  ~10.8k balls. Not adopted; the `pl-own-*` sets and the `hnpl`/`hnownpl` models can be deleted.
- basket-app-1107-a/-d (no labels): `bhnpl` leaves the bald head 0.2 s earlier on 1107-a (2.0 s instead of 2.2 s) and
  otherwise follows the same path; on 1107-b it has fewer frames with a ball (61 → 51%). No change worth the loss above.
- **Best so far stays `bhnown`'s recipe** (public + "not a ball" + our hand labels) with all tiles: mix 70%, precision
  81%. The fold models only exist for scoring; the app's model is that recipe trained on all our own labelled
  recordings (an estimate of its quality is the fold result above).

**(B) Phone cost of all tiles** (FocusBench `ball5det` = all 416 tiles + whole frame on every analysed frame at 5 fps +
the two EdgeTAM passes; detector `ball_tiny_hn@416`; iPhone 16 Pro Max, iOS 27.0.1, unplugged, brightness 51%, Low
Power Mode off, Neural Engine, the 3 bench clips in a loop for **30 min**;
`lab/tests/ios/soak.ball5det-hn416.iPhone17_2.20261108-1309.json`). FocusBench changes: `yolox_coreml.py --ball
ball_tiny_hn` → `lab/coreml/ball_tiny_hn.mlpackage` (same objectness as the ONNX, max diff 1e-7), copied by `ios_bench.py
prepare`; `BallDetector.scan` reads the class column from the output's width (85 = COCO class 32, 6 = the lab's one
class); Detector picker "Bola basquete ball_tiny_hn (416, recortes 416, teste 34)".

| Part of the run | per 30 s clip (yt-basket-04 / yt-bt-06, 19 regions per frame) | detector | ms per region | thermal |
|---|---|---|---|---|
| 0–10 min (11 clips) | **64 s** | 38 s | 13.3 | nominal |
| 10–15 min | 38 s | 15 s | 5.2 | nominal → fair → serious (13.4 min) |
| 15–30 min | 41 s | 17 s | 5.9 | serious to the end |

- Worst case (the first 10 min) 64 s per 30 s clip vs **48 s** for test 19's two stages (YOLOX-Tiny COCO): +16 s
  (+33%). The one-class model costs the same as COCO's Tiny (12 ms per region in the slow state). After 10 min the
  Neural Engine went to ~5 ms per region (the fast state seen in test 19's 5 min run, gone in its 15 min run): not
  something to count on.
- Battery 65 → 60% in 30 min. Thermal "serious" from 13 min on, after 17 clips with no pause; test 19's two stages
  stayed nominal for 15 min (slower state, shorter run).
- **Victor (2026-11-08)**: in the app the work is not continuous — the user picks one clip, exports/sends/saves the
  story, then moves on — so the nominal first 10 minutes (11 clips back to back) cover real use. What matters is the final
  result (the ball framed, the camera following it) without heating the phone over a few clips. **Decision: all
  tiles** (the quality of 1107-a), ~64 s of analysis per 30 s clip at worst. No two-stage 30 min control run needed.

### Test 33 result (2026-11-08) — a basketball detector trained only on our own recordings (`ball_train_pub.py --no-yt`, `pseudo_label.py`)

Question (Victor): how much worse or better is the detector without the public dataset (test 28's licence risk)?

**33a, strict: our hand labels only** (`ball_train_pub.py train --model tiny --fold A|B --no-yt --out own --iters
2000 --lr 0.002`, COCO init as test 28, no public data, no YouTube clips: those are not ours to train on). Per fold
that is very little: 176 balls (fold A model) / 296 (fold B model), plus the labelled clips' crops without a ball.
Models `lab/models/ball_tiny_own{A,B}`; same two-stage path and mix as tests 28/32 (tag `bown33`, reports
`lab/tests/detect/report.{det,mix}-bown33.md`), means of the 7 clips:

| Model | ceiling | detector alone (no tap): prec / cover | mix with EdgeTAM: prec / cover |
|---|---|---|---|
| COCO "sports ball", no training (test 28 baseline) | 26% | — / 14% | — / 54% |
| **ours only (`bown33`, by fold)** | **37%** | **77% / 30%** | **79% / 57%** |
| public + heads/torsos (`bhn`, test 32) | 76% | 77% / 55% | 78% / 68% |
| public + heads/torsos + our labels (`bhnown`, test 32) | 76% | 80% / 55% | 80% / 69% |

- **Without the public dataset the detector loses about half of its balls**: ceiling 76 → 37%, cover alone 55 → 30%,
  mix 68 → 57% (barely above the untrained COCO detector's 54%). Precision is the same (77–79%): what it finds is
  the ball, it just finds it much less often. Per clip, detector alone: v-a 40%, v-b 32%, h 40%, v-01 38%, yt-04 40%,
  and the two YouTube clips 7% / 11% (a broadcast-like look our recordings never show).
- Same conclusion as test 18 (our 32 clips alone did not generalise): a few hundred hand-labelled balls are far from
  the public dataset's ~10.8k.

**33b, started and stopped: automatic labels on the app's own recordings** (`pseudo_label.py`): 36 basketball
recordings from the app (`clips/basket-*.mp4`, 720p/1080p, 60 s each; `basket-v-corner-normal-01` left out because
it holds the eval clip basket-v-01) got labels from `ball_tiny_hn` all tiles + ball path, kept only where a candidate
≥ 0.5 and the path agree and the point is not a still object: 2,764 balls + 1,422 crops without a ball
(`lab/train/pl-own-*`, ~90% real balls on a sample sheet). The images are ours but the labels come from a teacher
trained on the public data, so it does not remove the dependency; and the 36 recordings share courts with some eval
clips and with the 1107 clips. `ball_tiny_ownplA` was trained (3000 iters, COCO init); fold B and the evaluation were
**stopped by Victor's decision** below.

**Decision (Victor, 2026-11-08)**: keep the public dataset. The base for further work is `ball_tiny_hn` (public CC BY
4.0 data + "not a ball" crops, test 32); training is internal, the images are not shown or shipped (only the model
weights). CC BY 4.0 asks for attribution: credit "basketball_detection (cvsense, Roboflow Universe), CC BY 4.0" in
the app's licences screen when a model trained on it ships.

### Test 32 result (2026-11-08) — "not a ball" examples and a head filter for the basketball detector (`hard_neg.py`)

Why: in test 31 the story of basket-app-1107-a followed a yellow shirt (0.8–1.8 s) and then a bald head on the right
(x 0.82–0.91, 2.2–3.6 s) while the real ball was dribbled behind the railing on the left (x 0.33–0.50) and shot at
3.2 s. Two ideas: (A) retrain test 28's detector with "not a ball" examples; (B) lower the score of candidates that sit
on a head (Vision people boxes, which today's Modo Foco already computes).

**(A) Hard negatives** (`hard_neg.py public|mine`, `ball_train_pub.py --fp --neg-weight`):
- `lab/train/neg-lbacg`: 3,977 crops of heads (60%) and torsos (40%) of the public dataset's "person" boxes, at the
  ball's scale (a head 8–32 px); upright people only (the dataset rotates a third of its images); a ball inside a crop
  stays a positive (723 crops without any ball). Sampled at weight 0.5 next to `pub-lbacg`.
- `lab/train/fp-<clip>`: the detector's own false candidates (score ≥ 0.2, > 3 lab radii from the labelled ball) on
  the labelled clips: 191 crops (shoes, hands, heads, a rim while the camera moves). Still objects (seen at the same
  place on ≥ 30% of the labelled frames: spare balls, the fixed rim) are left out on purpose: a spare ball IS a ball,
  and the ball path already ignores still objects. With `--fold`, only the training fold's clips are added.
- Models (init `ball_tiny_pub`, 1000 iters, lr 0.0005, frozen BN, cloud CPU ~25 min each): `ball_tiny_hn` (public +
  heads/torsos) and `ball_tiny_hnown{A,B}` (+ our labels and our false candidates of the other fold). Same size and
  cost as test 28's (YOLOX-Tiny 416, 20 MB ONNX).

**(B) Head filter** (`hard_neg.py heads --factor 0.3`): a candidate inside the head zone of a person box (top 22% of
the box, middle 80% in x; above the head, i.e. a shot, untouched) gets its score x0.3.

7 labelled basketball clips, same two-stage path and mix as test 28 (`ball_eval28.sh`; the fold models each scored
only on the clips they never saw); means of the clips, `lab/tests/detect/report.{det,mix}-<tag>.md`:

| Model | ceiling | detector alone (no tap): prec / cover | mix with EdgeTAM: prec / cover |
|---|---|---|---|
| test 28 public (`bpub`) | 75% | 75% / 52% | 76% / 64% |
| **+ heads/torsos (`bhn`)** | **76%** | **77% / 55%** | **78% / 68%** |
| `bhn` + head filter (`bhnhf`) | 76% | 75% / 53% | 78% / 66% |
| test 28 + our labels (`bown`, by fold) | 76% | 79% / 54% | 78% / 66% |
| **+ heads/torsos + our false candidates (`bhnown`, by fold)** | **76%** | **80% / 55%** | **80% / 69%** |
| `bhnown` + head filter | 76% | 80% / 54% | 80% / 68% |
| `bhn` with ALL tiles on every analysed frame (`bhnfull`, 19 inferences) | 80% | 79% / 57% | 79% / 68% |

- **The "not a ball" examples help a little everywhere**: mix cover 64 → 68% (public data only) and 66 → 69% (with our
  labels), precision +2 points. Per clip it is not all up: worst −5 (yt-basket-04 83 → 78%) for `bhn` and −6
  (yt1105-basket-b 70 → 64%) for `bhnown`, best +12 (basket-v-01 38 → 50%) and +16 (basket-rp-1105-h 68 → 84%).
  Same phone cost. `ball_tiny_hn` replaces `ball_tiny_pub` as the lab's basketball detector.
- **The head filter does not pay**: −1 to −2 points on the labelled clips, and on 1107-a it does not remove the bald
  head at 2.4–3.6 s (his Vision box does not put that point in the head zone on those frames). Not adopted.

**basket-app-1107-a, the clip that started this** (no labels; checked by eye on the frames, ball track per 0.2 s):
- The new detector alone does not fix it: the track still sits on the bald head at 1.8–3.6 s (the head's score even
  rises, 0.43 → 0.62 at 3.2 s).
- **The real cause is the cheaper two-stage path, not the detector**: the detector (old and new) DOES see the real
  ball on several frames — behind the railing at 1.6 / 2.2 s (0.15–0.16), at 2.8 s (0.84) and in the shot at
  3.2–3.6 s (0.51–0.79), verified on the image. But `roi_tiles --anchor 3 --k 2` runs all the tiles only every 0.6 s,
  and those anchor frames fell where the ball was hidden; in between, its 2 tiles follow the current path (the head),
  so the ball's tile is never run.
- With all the tiles on every analysed frame (`bhn-n5`, 19 inferences per analysed frame instead of 8.6), the track
  leaves the head at 2.2 s and follows the real ball 2.2–3.6 s (x 0.36–0.50). Cheaper variants tried on 1107-a do NOT
  get there: anchors every 2nd frame (`a2k2`), 3–4 tiles (`a3k3`, `a3k4`, `a2k4`: 9.2–12.2 inferences), a rolling
  scan of 4–6 tiles per frame (`--k 6..8 --scan 4..6`: 7–9 inferences; it keeps the ball at 2.2 / 2.8 / 3.4 s, too
  sparse for the path to leave the head's steady 0.4–0.6 candidates).
- The other three app clips of 2026-11-07 (no labels): share of frames with a ball, test 28 / `bhn` two-stage / `bhn`
  all tiles: b 39 / 47 / 57%, c 68 / 68 / 75%, d 72 / 66 / 62%. On 1107-d the all-tiles track differs from test 28's on
  14% of the frames: by eye better at 2.0–4.0 s (test 28 sat on an orange shirt and on the mural's painted ball), worse
  at 0 s (the painted ball).
- Videos `lab/tests/story/basket-app-1107-{a,d}.story-compare-t32.mp4` (today | T31 = test 31 | T32 a3k2 = new detector,
  same cost | T32 tiles = new detector, all tiles; all C at 1.2x, the zoom test 31 chose), and the export with the mark
  `basket-app-1107-a.story-C-z1.2-det-bhn-n5.mp4`. `story.py` takes the ball track per panel: `--cam "C@1.2#det-bhn-n5"`.

**Next**: (1) the phone cost of all 416 tiles at 5 fps with YOLOX-Tiny (19 vs 8.6 inferences per analysed frame,
~2.2x; test 19's 58.4 s per 30 s clip was for YOLOX-S 640 tiles) — FocusBench; if it is too slow, a smarter tile
choice that keeps a second hypothesis (tiles around the best candidate AWAY from the current path) instead of only the
path; (2) labels for the four 2026-11-07 clips (indoor court, railing, mural) to measure this instead of judging by eye.

### Test 31 result (2026-11-08) — the story's zoom chosen per clip (`story.py auto`)

Victor after test 30: liked C at 1x, 1.25x (horizontal) and 1.65x (vertical) and could not pick one; asked whether the
zoom should differ by orientation or lens (0.5x / 1x), since the distances vary. Proposal (accepted): no rule by
orientation or lens — one zoom per clip from what the camera sees, limited by quality and by the ball. The recordings
carry no lens metadata (ffprobe: no lens / focal tags); the app would know it at recording time, but the rule below
does not need it.

**Rule** (camera C, one zoom for the whole clip so the picture does not "breathe"): zoom = min of
- **content**: today's Modo Foco zoom in the recording's own framing (median over the clip; 1.1x near → 1.65x far,
  the distance signal) x 1.0 for horizontal recordings (the players as big as in today's Modo Foco, now in 9:16) and
  x 1.2 for vertical ones (Victor: more zoom / movement there);
- **quality**: at most x2.2 scale-up to 1080 wide (what Victor accepted in C 1.25x horizontal): 1080p horizontal ≤
  1.24x, 1080p vertical ≤ 2.2x, 4K horizontal ≤ 2.47x;
- **ball**: the largest zoom (0.05 steps) at which the camera keeps the detector's OWN ball points inside the crop
  but 3% (no labels needed);
- **guard**: when the detector finds the ball in under 35% of the clip its own points cannot judge the zoom: stay at
  the safe zoom (horizontal: full height; vertical: today's Modo Foco zoom).
Calibration runs (`lab/tests/story/story-auto-t31_*.md`): vertical factor 1.0 left the verticals at 1.42x on average,
less movement than the 1.65x Victor liked (→ 1.2); ball tolerance 6% / 10% instead of 3% only cost ball
(yt1105-basket-b 78 → 69%) for little movement; without the guard, yt1105-bt "in 4K" went to 1.3x and the labelled
ball fell to 54% (the detector finds it in 33% of that clip).

Table `lab/tests/story/story-auto-t31.md` (+ `.json`); means, zoom / ball in crop (labelled clips) / pan on screen
(crop widths per 10 s) / scale-up to 1080 wide:

| Recordings | rule, 1080p | rule, same clips in 4K | fixed 1x H / 1.65x V | fixed 1.25x H / 1.65x V |
|---|---|---|---|---|
| horizontal (16, 11 labelled) | **1.10x / 90% / 2.1 / x2.1** | 1.16x / 90% / 2.3 / x1.1 | 1.00x / 91% / 1.9 / x1.9 | 1.25x / 86% / 2.5 / x2.4 |
| vertical (4 + yt-bt-06) | **1.60x / 99% / 0.6 / x1.6** | 1.60x / 99% / 0.6 / x0.8 | 1.65x / 98% / 0.7 / x1.6 | 1.65x / 98% / 0.7 / x1.6 |

- The rule picks per clip what Victor picked by eye overall: horizontal 1.0x where the ball gets lost
  (yt1105-basket-b, beach volleyball, footvolley, basket-app-1107-c) up to 1.2x where it is safe (yt-basket-04,
  volleyball a/b, basket-app-1107-a/b/d); vertical 1.05x (bt-rz-1105-v: the detector sees the ball in 16% → guard)
  to 1.95x (basket-rp-1105-v-a). Against the fixed 1x it keeps the ball (90 vs 91%) with more movement (2.1 vs 1.9);
  against 1.25x it loses 4 points less ball.
- **4K mostly buys sharpness, not zoom**: with the same clips in 4K the rule goes only from 1.10x to 1.16x on average
  (the ball limit, not the resolution, decides) but the scale-up drops from x2.1 to x1.1.
- The low-resolution sources (basket-rp-1105-h 1024x576, yt1105-bt 720p) stay at 1x by the quality limit; they are
  below the option's 1080p60 floor anyway.
- Videos `lab/tests/story/<clip>.story-compare-t31.mp4` (today | FIXO = fixed 1x H / 1.65x V | REGRA = the rule)
  for yt-basket-04, yt1105-volei-b, basket-app-1107-a, basket-app-1107-d, basket-rp-1105-v-a, bt-rz-1105-v, yt-bt-06;
  exports with the mark at the rule's zoom: `basket-app-1107-d.story-C-z1.2.mp4`, `yt1105-volei-b.story-C-z1.2.mp4`,
  `basket-rp-1105-v-a.story-C-z1.95.mp4`.
- For the app: the inputs are already there at export time (today's Modo Foco rows, the ball track, the source
  resolution); the zoom search is ~20 camera solves per clip (offline, on the phone: to be measured).

### Test 30 result (2026-11-07) — a "story" (9:16) export with Foco na Bola (`story.py`)

Victor after test 29 (at today's zoom C barely differs from the Modo Foco): try a story mode — 9:16 — where the tighter
crop should move more, and see the quality. Decisions (Victor, 2026-11-07): an **export option, not the default**
(test 25's "no horizontal → vertical conversion" stays for the normal export); **offered only for clips recorded at
1080p60 or more**; the **watermark must be on the story too**; vertical recordings may also take more zoom.

- Crop: 9:16 of the source; zoom relative to the largest 9:16 crop (horizontal source: full height, 31.6% of the width
  = z1.0; vertical source: the whole frame). Cameras on test 24's band path: **today** = today's Modo Foco 9:16 rows
  (players only, the "portrait" rows of `current.focus.json`); **A** = calm (dead zone 0.20, s10); **C** = Victor's
  test 29 pick (dead zone 0.10, s3). Ball: test 28's basketball detector with no tap for basketball, today's mix
  (tap) for the other sports. "Pan on screen" = crop-centre movement in crop widths per 10 s.
- Export as the app would: crop scaled to 1080x1920 (Lanczos) + the export mark of `app/src/share/ShareOverlay.tsx`
  rebuilt at frame pixels (bottom gradient, dark pill, `reprize-mark.png` + "@reprize.app" in Manrope SemiBold, sizes
  from the frame's short side). The mark is drawn by the export overlay, not at recording, so a 1080x1920 story export
  gets it as is (checked against the mark in Victor's exported clips: same look). The `basket-app-1107-*` sources are
  exported clips that already carry the mark (bottom right of the landscape frame): a story crop there can show part
  of the old mark; the app would crop the clean recording.
- No 4K source yet: the 3 YouTube basketball clips are 1920x1080 (the YouTube originals may exist in 4K; not
  downloadable from the cloud workspace). The 4K column is computed (same framing, 2x the source pixels).

Table `lab/tests/story/story-sweep-t30.md` (+ `.json`); means (ball in crop / direction changes per 10 s / pan on
screen), labelled clips only for the ball:

| Recording | today (players) | A z1.0 | C z1.0 | C z1.25 | C z1.5 |
|---|---|---|---|---|---|
| horizontal (15 clips, 11 labelled) | 61% / 2.0 / 1.0 | 89% / 1.3 / 1.2 | **91% / 2.2 / 1.9** | 86% / 2.9 / 2.5 | 81% / 3.1 / 3.1 |
| crop width from 1080p → 1080 output; from 4K | 607 px (x1.8); 1214 px | 608 px (x1.8); 1216 px | 608 px (x1.8); 1216 px | 486 px (x2.2); 972 px | 405 px (x2.7); 810 px |

| Recording | today (players, ~1.4x) | C z1.65 | C z2.0 | C z2.5 |
|---|---|---|---|---|
| vertical (4 clips + yt-bt-06 with 1 point) | 100% / 1.3 / 0.4 | 99% / 1.8 / 0.7 | **97% / 2.0 / 1.0** | 90% / 2.2 / 1.4 |
| crop width from 1080p → 1080 output; from 4K | 755 px (x1.4); 1510 px | 655 px (x1.6); 1310 px | 540 px (x2.0); 1080 px | 432 px (x2.5); 864 px |

- **Horizontal → story: C at full height is the best trade**: ball in the crop 61% (today's Modo Foco 9:16) → 91%,
  about 2x the pan on screen; more zoom loses the ball (86% / 81%) and resolution. Weakest clips: yt1105-basket-a / -b
  (88 / 78% at z1.0; the detector's gaps), yt1105-bt (76%), yt1105-futevolei (83%, = today).
- **Vertical recordings: C at 2x** moves 2.5x more than today with the ball still in 97% (basket-v-01 and bt-rz-1105-v
  barely move: the play is spread / static); 2.5x drops to 90%.
- **Quality from 1080p**: every option upscales — the horizontal story at full height is 608 px wide scaled x1.8,
  2x on a vertical recording is x2.0. From 4K the full-height horizontal story is native (1216 px for 1080) and 1.25x
  still near native (972 px). So **1080p60 is the floor for the option; 4K is what makes the extra zoom sharp**.
- Videos `lab/tests/story/`: comparisons (`<clip>.story-compare.mp4`, 540x960 panels with ball % and source px):
  horizontal today | A z1.0 | C z1.0 | C z1.25 for yt-basket-04, yt1105-basket-a, basket-app-1107-c, bt-rz-1105-a,
  yt1105-volei-b; vertical today | C z1.65 | C z2 | C z2.5 for basket-rp-1105-v-a, bt-rz-1105-v. Exports as the app
  would make them (1080x1920 with the mark, to watch full screen on the iPhone): `<clip>.story-C-z1.mp4` and
  `-C-z1.25.mp4` for yt-basket-04, basket-app-1107-c, bt-rz-1105-a; `basket-rp-1105-v-a.story-C-z2.mp4` and
  `-today.mp4`.
- Next: 4K recordings (Victor) to judge the extra zoom; the story option's quality floor (1080p60) in the app.

### Test 29 result (2026-11-07) — a camera that moves with the ball (`cam_sweep.py`)

Victor after test 28: how do we get more camera movement following the ball? Test 24's calm camera barely moves on
basketball because today's crop is 61–87% of the frame width (zoom 1.15–1.65x: only 13–39% of the width to travel),
the dead zone is ±20% of the crop and the smoothing is heavy; on vertical clips y stays at the players by design.
Offline sweep of test 24's camera, ball = test 28's basketball detector alone, no tap (`det-bpub-n-a3k2`), 7 basketball
clips: zoom (today's crop / 1.5x / 1.75x / 2x, `min(today, 1/zoom)` in both orientations, centred where today's is) x
dead zone (0.20 / 0.10 / 0.05 of the crop width) x smoothing (`s10` = a 10, b 1000 as test 24; `s3` = 3 / 300; `s1` =
1 / 100) x anticipation (aim at the ball 0 or 0.4 s ahead): 72 configs, 45 s on CPU. App recording: 1080p 60 fps
(Victor; lower when the phone heats up), so `px` = the output's short side from a 1080p recording.
Table `lab/tests/sg/cam-sweep-t29.md` (+ `.json` per clip); means over the 7 clips:

| Camera | ball in crop (worst clip) | direction changes /10 s | travel (frame widths /10 s) | ball off-centre (0 = centred, 0.5 = edge) | px at 1080p |
|---|---|---|---|---|---|
| Modo Foco today (players) | 97% (83%) | 1.9 | 0.26 | 0.19 | 782 |
| A: test 24 calm (today's zoom, dz 0.20, s10) | 99% (94%) | 1.5 | 0.18 | 0.18 | 782 |
| B: today's zoom, dz 0.05, s3 | 99% (97%) | 2.8 | 0.38 | 0.15 | 782 |
| C: 1.5x, dz 0.10, s3 | 98% (93%) | 2.3 | 0.39 | 0.16 | 698 |
| D: 1.5x, dz 0.05, s1 | 98% (92%) | 2.8 | 0.52 | 0.15 | 698 |
| 2x, dz 0.10, s3 | 96% (81%) | 2.7 | 0.53 | 0.18 | 540 |

- **Test 24's calm camera moves less than today's players-only Modo Foco** (0.18 vs 0.26 frame widths per 10 s).
- **The dead zone is the cheapest lever**: at today's zoom (no resolution lost), dz 0.05 + lighter smoothing (B)
  doubles the travel (0.18 → 0.38) and keeps the ball in the crop 99% (worst clip 97%), the ball more centred
  (0.18 → 0.15); the cost is more direction changes (1.5 → 2.8 per 10 s).
- **Zoom 1.5x** adds travel (D: 0.52, ~3x the calm camera) with the ball still in 98% (worst 92–93%), at 698p from a
  1080p recording. **2x is too much**: 540p, and the worst clip drops to 81% (yt1105-basket-b: the detector's misses
  are no longer covered by a wide crop).
- **Anticipation (0.4 s ahead) does not help** with this ball: same travel, worst clip 1–4 points lower (the detector
  at 5 fps with gaps gives too few positions ahead to aim at); not pursued.
- Per clip (ball in crop / travel): the moving cameras gain most where the ball crosses the court — yt1105-basket-a
  (A 98% / 0.29 → D 98% / 0.65), yt1105-basket-b (A 94% / 0.15 → C 93% / 0.68), basket-rp-1105-v-a (A 98% / 0.31 → D
  97% / 0.77); basket-v-01 barely moves in any config (the play stays in the crop).
- Videos (Hoje | A | B | C | D, label = ball in crop; horizontal = 2 columns): `lab/tests/sg/<clip>.cam-t29.mp4` for
  yt1105-basket-a, yt1105-basket-b, basket-rp-1105-v-a (`cam_sweep.py render --clip <clip> --cfg <cfg> ...`). For
  Victor's review: how much movement looks good, and whether B (no zoom) is enough or the 1.5x of C / D is worth the
  resolution.
- **Victor (2026-11-07): picks C (1.5x, dead zone 0.10, s3).** C on other clips (videos `<clip>.cam-t29.mp4`, panels
  today | A | C; ball in crop / travel, frame widths per 10 s):

| Clip | Ball source | Modo Foco today | A calm | C |
|---|---|---|---|---|
| yt1105-voleipraia | today's mix (tap) | 70% / 0.06 | 100% / 0.06 | **100% / 0.27** |
| yt1105-futevolei | today's mix (tap) | 100% / 0.23 | 100% / 0.01 | 91% / 0.22 |
| yt1105-bt | today's mix (tap) | 100% / 0.14 | 100% / 0.00 | 100% / 0.02 |
| yt-bt-06 (1 labelled point) | today's mix (tap) | — / 0.28 | — / 0.28 | — / 0.58 |
| yt-basket-04 | basketball detector, no tap | 100% / 0.20 | 100% / 0.16 | 100% / 0.27 |
| basket-app-1107-a | basketball detector, no tap | — / 0.23 | — / 0.26 | — / 0.24 |
| basket-app-1107-b | basketball detector, no tap | — / 0.43 | — / 0.08 | — / 0.28 |
| basket-app-1107-c | basketball detector, no tap | — / 1.05 | — / 0.26 | — / 0.68 |
| basket-app-1107-d | basketball detector, no tap | — / 0.21 | — / 0.40 | — / 0.50 |

  - Beach with a tap: C keeps the ball (beach volleyball 70% today → 100%) and moves 4–5x more than A; footvolley
    loses the ball on 9% of the labelled points; beach tennis yt1105-bt does not move (the rally fits in the crop).
    Beach with no tap (COCO detector alone): weak (beach volleyball 76%, footvolley still) — a beach ball detector
    (test 28's recipe) would be needed to drop the tap there.
  - `basket-app-1107-a..d`: 4 clips Victor recorded with the app on 2026-11-07 (basketball, horizontal 1080p, 3 at
    60 fps and 1 at 30 fps, 5.7–8.5 s, from the raised side of the gym; `refs/2026-11-07/`, added to `clips.txt`).
    No ball labels yet (visual review only). People: `vision-probe` on the Mac (Victor); today's framing:
    `focus_variant.py --preset acao --boxes tiled` (zoom already 1.4–1.65x, the players are far, so C's 1.5x crop is
    close to today's). Ball: test 28's detector, no tap (`bpub-n5`/`bpub-w5` → `bpub-n-a3k2` → `ball_track.py`),
    ball in 39–72% of the analysed frames. The scripts read a label file for the image size: the cloud runs used a
    stub with no samples (not kept); label these clips to get numbers.
  - Not used: `refs/h264/ref-basket-01..03` and `ref-beach-01..05` are vertical YouTube shorts where the camera is
    already operated (pans / zooms) on most of them, so C on top of them tests nothing.

### Test 28 result (2026-11-07) — a basketball detector of our own: YOLOX-Tiny fine-tuned on a public dataset (`ball_train_pub.py`, `ball_eval28.sh`)

Test 26's conclusion: the limit is detection (the COCO "sports ball" class finds the basketball in 10–42% of frames).
Test 18 (fine-tune on our 32 clips alone) did not generalise. Here: YOLOX-Tiny (Apache-2.0, COCO weights from the
release 0.1.1rc0), one class, fine-tuned on a public basketball dataset, then optionally on our labels too.

- **Data**: Roboflow Universe `cvsense/basketball_detection-lbacg` v3 "BBD_NEW_OPTIMIZED" (CC BY 4.0, licence in the
  export's `README.dataset.txt`; COCO JSON zip in `lab/datasets/basketball_detection-lbacg/`, sha256 `68eeebff…3ee66b4a`,
  downloaded by Victor). 10,912 images = ~4,330 originals x 3 augmentations (90° rotations, crop, shear, brightness),
  all stretched to 640x640; classes ball / person / rim / shoot / made, only "ball" used (10,825 boxes, median 54 px).
  Mixed content: amateur outdoor courts filmed from the side (close to our clips), broadcast frames and web photos —
  some with stock-agency watermarks (VEER, Sohu), i.e. scraped images: the CC BY is the uploader's, **decide whether
  that is acceptable before a model trained on it ships**. Not usable as a second dataset:
  `basketball-6vyfz/basketball-detection-srfkd` (also CC BY 4.0) is a copy of the same 4,330 originals and copies,
  class names "0".."4"; the other "similar projects" with ~9.5k images are probably copies too. `toothless-zone/
  basketball-mo7dc` has no published version (0 images).
- **Crops** (`ball_train_pub.py dataset`): every image resized so its ball is 8–32 px (our balls: 14–48 px median per
  clip at native resolution), 320x320 crop around it (13,693 crops, 9,399 with the ball; negatives at scale 0.6–1.2
  away from the balls). Augmentation in training: flips, brightness/contrast, motion blur (30%).
- **Training** (cloud CPU, 2 threads, ~1.5 s per batch of 16): head from COCO's "sports ball" row, BatchNorm frozen,
  SGD lr 0.001 cosine, 3,000 iterations (~75 min) → `lab/models/ball_tiny_pub.{pth,onnx}` (416 input, one class;
  `ball_detect.py` reads it unchanged). With our labels (`--fold A|B --init ball_tiny_pub`, 1,000 more iterations, lr
  0.0005, public crops and test 18's crops of our basketball clips sampled 1:1): fold A trained on v-b, v-01, yt-04,
  yt-b + basket-app-1031-a/-b and scored on v-a, h, yt-a; fold B the other way round → `ball_tiny_pubown{A,B}`.
- **Scoring** (`ball_eval28.sh <onnx> <tag>`): exactly the best path of tests 19 / 26 with the model swapped — 416
  tiles + whole frame at 5 fps, two stages `a3k2`, `ball_track.py`, mix with `edgetam-fuse5`, `det_report.py`. The chain
  reproduces `tiny-n-a3k2` / `mix-tiny-n-a3k2` exactly from the saved COCO detections (checked). Reports
  `lab/tests/detect/report.{det,mix}-{bpub1k,bpub,bown}.md`.

| Clip | pts | ceiling: COCO / pub / pub+own | detector alone cover: COCO / pub / pub+own | mix cover: COCO / pub / pub+own | mix prec: COCO / pub / pub+own |
|---|---|---|---|---|---|
| basket-rp-1105-v-a | 109 | 38% / 83% / 88% | 17% / 64% / 53% | 82% / 82% / 77% | 89% / 86% / 84% |
| basket-rp-1105-v-b | 57 | 19% / 72% / 68% | 5% / 40% / 49% | 37% / 47% / 60% | 58% / 66% / 71% |
| basket-rp-1105-h | 25 | 20% / 84% / 76% | 16% / 52% / 60% | 32% / 68% / 68% | 67% / 94% / 89% |
| basket-v-01 | 24 | 21% / 79% / 71% | 17% / 38% / 38% | 33% / 38% / 38% | 50% / 47% / 60% |
| yt-basket-04 | 101 | 42% / 70% / 78% | 34% / 59% / 61% | 87% / 83% / 78% | 92% / 88% / 87% |
| yt1105-basket-a | 86 | 31% / 74% / 88% | 7% / 58% / 59% | 49% / 71% / 69% | 71% / 80% / 80% |
| yt1105-basket-b | 98 | 10% / 62% / 65% | 0% / 50% / 58% | 59% / 58% / 70% | 73% / 71% / 78% |
| **mean** | | **26% / 75% / 76%** | **14% / 52% / 54%** | **54% / 64% / 66%** | **71% / 76% / 78%** |

- **The detection limit moves a lot**: some candidate on the ball in 75% of the frames instead of 26%, with the same
  number of candidates per frame (3–5); the best-scored candidate is on the ball 40–58% vs 8–21% (first 4 clips).
- **The detector alone (no tap) now covers 52–54%**, about what today's best mix (detector + EdgeTAM from a tap) does
  (54%). In the mix: 54 → 64% (public only) / 66% (+ our labels), precision 71 → 76 / 78%; big gains on
  basket-rp-1105-h (32 → 68%), yt1105-basket-a (49 → 71%), basket-rp-1105-v-b (37 → 47 / 60%); yt-basket-04 −4 / −9 and
  basket-rp-1105-v-a 0 / −5 (EdgeTAM was already strong there).
- **Our labels add little on top** (+2 points of mix cover, +2 precision, mixed per clip): the public dataset does most
  of it. The 1,000-iteration checkpoint of the public model (`bpub1k`) had a lower ceiling (68%) but a higher mix cover
  (67%) than the final one: `ball_track.py` and the mix rules were tuned on the COCO model's scores and were not retuned
  here (7 clips are too few to tune and score on).
- **Same phone cost**: same network, same 416 input, 7.8 inferences per analysed frame for all three models (the
  two-stage tile choice does not change). The Core ML export is `yolox_coreml.py` with the new weights (not done).
- **The camera barely changes (2026-11-07, `compare28.py`)**: test 24's calm camera in the app's format (native
  orientation, today's zoom) driven by each ball, "ball inside the crop" on the labelled samples (direction changes
  per 10 s), `lab/tests/sg/lazy3-summary-t28.md`:

| Clip | Output | Modo Foco today (players) | today's ball, with a tap | trained + EdgeTAM, tap | trained, no tap |
|---|---|---|---|---|---|
| basket-rp-1105-h | 16:9 | 100% (1.2) | 100% (0.0) | 100% (0.0) | 100% (0.0) |
| yt1105-basket-a | 16:9 | 83% (3.6) | 98% (2.8) | 99% (2.8) | 98% (2.8) |
| yt1105-basket-b | 16:9 | 94% (3.0) | 100% (1.3) | 98% (1.3) | 94% (1.7) |
| yt-basket-04 | 16:9 | 100% (1.7) | 100% (2.7) | 100% (2.7) | 100% (2.7) |
| basket-rp-1105-v-a | 9:16 | 100% (2.9) | 100% (2.1) | 100% (2.1) | 98% (2.1) |
| basket-rp-1105-v-b | 9:16 | 100% (0.7) | 100% (0.7) | 100% (1.4) | 100% (1.4) |
| basket-v-01 | 9:16 | 100% (0.0) | 100% (0.0) | 100% (0.0) | 100% (0.0) |

  At today's zoom the crop is wide enough that the ball is already inside it 83–100% of the time **with today's
  players-only Modo Foco** (100% on 5 of the 7 basketball clips); a better ball changes the result only on
  yt1105-basket-a and -b. With a tap, the trained detector and today's give the same camera (0–3 points apart, also at
  a fixed 1.5x or 2x zoom on the horizontal clips). The detector's gain shows as **the no-tap camera**: the trained
  model alone keeps the ball in the crop about as well as today's tap + EdgeTAM (94–100%), i.e. it could replace the
  tap and the EdgeTAM passes (the larger cost of the path) for basketball. Videos (3 panels: Modo Foco today | today's
  ball with a tap | trained, no tap; label = ball in crop): `lab/tests/sg/<clip>.lazy3-t28.mp4` for basket-rp-1105-h,
  yt1105-basket-a, yt1105-basket-b, basket-rp-1105-v-a, basket-rp-1105-v-b.
- Not done yet: YOLOX-S on the same data; retuning the track / mix to the new scores (needs more labelled clips to
  avoid tuning on the test set); the other sports; the FocusBench run (expected equal to test 19's Tiny).

### Test 27 result (2026-11-06) — TrackNetV3 without retraining, basketball (`tracknet_eval.py`)

Question from test 26: does a detector that looks at several consecutive frames find the small, fast ball better than
YOLOX on one frame? TrackNetV3 (MIT, `github.com/qaz812345/TrackNetV3`, commit 6eda442 of 2026-09-03; official
weights `TrackNetV3_ckpts.zip` from the README's Google Drive link, sha256 `8de68d34…4571bcc4`, downloaded by Victor)
sees 8 consecutive frames + the clip's median background at 512 x 288 and outputs a ball heatmap per frame. It was
trained on broadcast badminton (the shuttlecock), so this is the zero-shot check before any retraining.

- Safety: both `.pt` files load with `torch.load(..., weights_only=True)` (tensors only: TrackNet epoch 18, seq_len 8,
  bg_mode concat; InpaintNet epoch 281). The repo's own `predict.py` calls `torch.load` without `weights_only`; the lab
  script never uses it. Code and weights live in `lab/src/TrackNetV3/` and `lab/models/tracknetv3/` (not in git).
- Set-up: the analysis window decoded at 30 fps, upright, RGB; landscape = the whole frame (already 16:9, ball ~5–10 px
  at 512 wide, like the shuttle in its training data); portrait = 4 stacked 16:9 windows at native scale (each with its
  own median); one forward pass per 8 frames (no overlap ensemble), every blob of the heatmap kept with its peak as
  score. The input was checked on basket-rp-1105-h: the median background comes out clean (players removed), the ball
  is visible where the label is; the heatmap there peaks at 0.2–0.29 and not on the ball.
- CPU in the cloud workspace, 2 threads: ~0.17 s per frame per window (a 30 s portrait clip ~10 min). 5 of the 7
  basketball clips (basket-rp-1105-v-a and basket-v-01 stopped: the result was already clear and the CPU was needed
  for test 28). Report `lab/tests/detect/report.tn3-tiles.md`:

| Clip | pts | ceiling: any blob | ceiling: blob ≥ 0.5 | TrackNet answer given | on the ball | false alarm | YOLOX-Tiny ceiling (tiny-n-a3k2) |
|---|---|---|---|---|---|---|---|
| basket-rp-1105-v-b | 57 | 11% | 0% | 5% | 0% | — | 19% |
| basket-rp-1105-h | 25 | 8% | 0% | 0% | 0% | — | 20% |
| yt-basket-04 | 101 | 21% | 0% | 2% | 0% | 2% | 42% |
| yt1105-basket-a | 86 | 23% | 1% | 5% | 1% | 7% | 31% |
| yt1105-basket-b | 98 | 4% | 1% | 5% | 1% | — | 10% |

- **Not usable as is**: TrackNet's own answer (largest blob ≥ 0.5) is on the basketball in 0–1% of the labelled frames;
  even every weak blob (peak ≥ 0.1) reaches only 4–23%, below YOLOX-Tiny's 10–42%. The badminton model does not know a
  basketball (big, orange, often in hands) — expected for a shuttlecock model; the multi-frame idea is untested until it
  is retrained on basketball.
- Retraining TrackNet needs labelled consecutive frames (its loss is per frame, sequences of 8 at 30 fps); our labels
  are every 200 ms and the public basketball datasets are single images, so it is a bigger job than test 28. Left for
  after test 28.

### Test 26 result (2026-11-06) — the ball trail on its own (`trail.py`)

Victor, after Ball AI (an iPhone basketball training app that draws clean ball trails): those trails are drawn after
the clip with the whole clip in hand, from a phone on a tripod close to one hoop and one player (ball big in frame).
Question: is our gap the post-processing or the detection? `trail.py` builds the best offline path from any track or
detector file (frame-to-frame linking, robust local fit, outliers and still objects out, gaps filled and bridged up to
1 s; kept detections stay where seen) and renders raw | clean trail. Scores on the labels (`evaluate.score_track`,
recall raw → clean), summaries `lab/tests/trail/summary-t26-*.md`:

- **On the existing tracks the cleaning adds ~nothing**: mix-tiny-n-a3k2 (best) mostly within ±5 points, a few up
  (bt-E5003B6B 72 → 78%, basket-v-01 33 → 42%, yt1105-volei-a 79 → 85%), some down where it drops short or slow runs
  (basket-rp-1105-h 32 → 0%, yt1105-futevolei 6 → 0%). `ball_track.py`'s DP path already does what a trail app does.
- **On the raw YOLOX-Tiny candidates**, its linking is a strong cleaner (night beach tennis bt-0AE39B33 3 → 50%,
  bt-rz-1105-a 12 → 32%, false alarm 100 → 20%) but stays below `ball_track.py` (det-tiny-n-a3k2): keep the DP.
- **The ceiling is detection**: some YOLOX-Tiny candidate is on the labelled ball in 34% of the analysed frames
  (basketball 10–42%, volleyball 22–28%, futevôlei 7%, broadcast 0%; night beach tennis 67–74%). No offline path can
  find a ball the detector never proposes. The ball is ~1–2% of the picture's long side on our clips (12–15 px at night
  beach tennis), much smaller than in Ball AI's close tripod set-up.
- Next, by expected gain: a detector trained for the sport's ball (fine-tune YOLOX on a public dataset with a
  commercial-friendly licence + our labels; test 18 failed on 32 clips alone), or TrackNetV3 (MIT, uses consecutive
  frames, made for small fast balls; weights must be downloaded by hand).
- Videos (raw | clean): `lab/tests/trail/<clip>.t26-mix.trail.mp4` for basket-rp-1105-v-a, basket-rp-1105-v-b,
  bt-rz-1105-a, yt1105-volei-a, yt1105-basket-b.

### Test 6 result (2026-11-03, hybrid framing from the SAM 2 one-click track, 4 clips)

Trust the ball when the mask is ball-sized, ball-shaped, did not jump and is not lying still; ball mode after 3 trusted
frames, through gaps of up to 4; ball rect at today's zoom cap; blend smoothed over ~0.5 s.

| Clip | Ball in crop: today → hybrid | Ball off centre | Zoom | Jerk p95 | Ball mode |
|---|---|---|---|---|---|
| bt-0AE39B33 | 63% → 77% | 0.54 → 0.15 | 1.58x → 1.60x | 0.24 → 0.76 | 69% |
| bt-E5003B6B | 78% → 78% | 0.35 → 0.24 | 1.39x → 1.53x | 0.20 → 0.77 | 57% |
| basket-v-01 | 100% → 100% | 0.29 → 0.09 | 1.65x → 1.65x | 0.01 → 0.31 | 21% |
| yt-basket-04 | 100% → 100% | 0.25 → 0.06 | 1.43x → 1.64x | 0.07 → 0.66 | 91% |

Never worse at keeping the ball in the crop, much more centred on it, 3–10x more camera movement. Open issue: ball mode
also runs when the ball is out of play (64% / 45% of the "out" samples in beach tennis, all 18 in the YouTube clip):
SAM 2 keeps a ball-like mask on a ball being held or lying around between points.

### Test 6, rounds 2–3 (Victor's reviews, 2026-11-03) — `hybrid.py` (round 3 is the default; `--round2`, `--round1`)

- Round 2: back to the players 0.2 s after a lost ball (was up to 0.4 s + 0.5 s), ball zoom 2x (was today's cap).
- Round 3: vertical camera follows the ball's highest point over the last 0.8 s (rises at once, comes down at most 0.2
  frame heights/s, σ 0.4 s): no bobbing on dribbles or a ball hitting the sand. Losses up to 1 s are bridged (the
  camera glides to where the ball comes back): the drop to the players and back was the 25–28 s jolt in yt-bt-06.

| Clip | Ball in crop: today / r2 / r3 | Zoom r3 | Jerk p95: r2 → r3 | Vertical flips per 10 s: r2 → r3 |
|---|---|---|---|---|
| bt-0AE39B33 | 63% / 73% / 73% | 1.92x | 1.03 → 1.88 | 5.3 → 2.7 |
| bt-E5003B6B | 78% / 72% / 72% | 1.77x | 1.58 → 1.03 | 3.0 → 1.3 |
| basket-v-01 | 100% / 100% / 100% | 1.73x | 0.38 → 0.37 | 0.3 → 0.3 |
| yt-basket-04 | 100% / 100% / 98% | 2.00x | 1.15 → 0.43 | 8.3 → 4.0 |
| yt-bt-06 (1 label: video only) | — | 2.00x | 1.01 → 0.56 | 8.3 → 1.7 |

### Test 6, round 4 (default) — vertical: as low as the players, as high as the ball needs

Victor on round 3: the camera rose more than needed on shots and long passes over the top (it centred the ball).
Round 4: the crop's height stays at today's (players') height and moves only to keep the ball's highest point over
the window 15% of the crop below its top edge (and its lowest point 10% above the bottom); round 3's rise-at-once /
come-down-slowly and the 1 s bridges stay. Ball in crop unchanged (yt-basket-04 100%, bt-E5003B6B 72%); the crop
centre's highest point 0.25 → 0.39 (yt-basket-04) and 0.30 → 0.47 (yt-bt-06) of the frame height; vertical flips
~1 per 10 s on every clip.

### Test 6, round 5 (default) — racket-sport filters (`trusted` in hybrid.py)

Victor on bt-wa-1028 (app recording, good rally): SAM 2 slid onto a racket at 9.6 s and at the end. Colour and
"near a player" were measured and do not separate them on this clip (a far, blurred ball changes colour as much as a
racket; Vision missed the player holding it). What does, for beach tennis / tennis / padel only:
rounder masks (aspect <= 2, fill >= 0.6); a mask that suddenly grows x2.5 is suspect until it moves like a ball for
6 frames, and one that shrinks back at once is the ball found again (SAM 2 often re-finds it by itself: 10.8 s,
12.0 s); a mask moving < 0.10 frame long sides over ±0.5 s for >= 0.6 s is not a ball in a rally.

| Clip | Ball in crop: today / r4 / r5 | Ball mode r4 → r5 |
|---|---|---|
| bt-0AE39B33 | 63% / 73% / 80% | 80% → 17% (held balls between points dropped) |
| bt-E5003B6B | 78% / 72% / 100% | 59% → 15% |
| yt-bt-06 (video only) | — | 100% → 97% |
| bt-wa-1028 (video only) | — | 81% → 61% (rackets 9.6–10.6, 11.0–11.6, 15.0–16.8 s dropped) |
| basketball clips | unchanged (filters off) | unchanged |

Left for later: SAM 2 does not come back from a racket by itself every time. An automatic correction (a negative
prompt on the rejected object and a positive one on a ball candidate, then propagate again) would re-acquire it.

### Test 19: a cheaper ball detector, fewer tiles (2026-11-06) — `roi_tiles.py`

The phone bench of test 17 (`ball5det`) put the cost in the tiles: ~9 detector regions per frame at 39 ms each =
53.8 s per 30 s clip. Here: the whole frame always (a new whole-frame-only run, `ball_detect.py --no-tiles --step 2`,
tag `yolox-s-w5`), plus K tiles chosen per frame. Simulated offline from the full run (`yolox-s-t5`): a candidate is
kept if the whole-frame run has it or it lies inside a chosen tile. Then `ball_track.py`, `low_fps.py fuse --p2
det-<tag> --p1 edgetam-fuse5 --out mix-<tag>` and test 17's ground-truth numbers, 17 labelled clips.

| Variant (tag) | regions per frame | detector finds the ball | detector cover | **mix cover** |
|---|---|---|---|---|
| all tiles (test 17, `t5`) | 8.45 | 48% | 35% | **56%** |
| whole frame only (`w5`) | 1 | 9% | 4% | 43% (= EdgeTAM alone) |
| online, K tiles around the last ball + speed, players' crop when lost (`r1`/`r2`/`r3`) | 2 / 3 / 3.95 | 26 / 33 / 37% | 15 / 22 / 24% | 46 / 49 / 50% |
| online + scanning tiles in turn (`r2s`, `r3s`, `r3s2`, `r4s`) | 3–4.9 | 31–41% | 20–27% | 47–51% |
| tiles around EdgeTAM's fused ball (`gk1`/`gk2`/`gk3`) | 2.1 / 3.1 / 4.0 | 39 / 42 / 45% | 27 / 29 / 31% | 47 / 50 / 51% |
| **two-stage: all tiles on every 3rd analysed frame, path over those, 2 tiles around it in between (`a3k2`)** | **4.84** | 45% | 32% | **55%** |
| two-stage every 2nd / 4th / 5th (`a2k2`, `a4k2`, `a5k2`), K = 1 (`a2k1`, `a3k1`) | 4.1–5.7 | 40–45% | 28–32% | 53–55% |
| two-stage every 5th + EdgeTAM's ball where the path has none (`ga5k2`) | 4.10 | 46% | 33% | 54% |

- Online choices lose the ball: night beach tennis has many look-alike candidates and the online guess locks on the
  wrong one (bt-rz-1105-b mix cover 86 → 23–67%). Tiles around EdgeTAM's ball add little: they find the ball where
  EdgeTAM already has it.
- The clip is processed after recording, so two stages are allowed: `a3k2` stays within 5 points of all tiles on
  every clip (night beach tennis 90/56/95/84 vs 90/59/95/86).
- **Measured on the phone (2026-11-06, iPhone17,2, 15 min, FocusBench "Detector em 2 etapas + 2 passadas a 5 fps
  (teste 19)" = `ball5deta3`, YOLOX-S, `lab/tests/ios/soak.ball5deta3.iPhone17_2.20261106-0911.json`)**: yt-basket-04 /
  yt-bt-06 **58.4 s per 30 s clip** (detector 31.9 s at 5.0 regions per frame, as in the lab, + 13.2 + 13.2 s),
  bt-wa-1028 37.6 s (4.3 regions); all tiles was 80.3 s. Thermal nominal for 15 min, battery 70 → 65%. In the app's
  version the path between the anchor frames is the best candidate of each anchor frame (ball_track.py's path in the
  lab; same number of model calls). FocusBench modes `det5a3` / `ball5deta3` (anchor 3, k 2) and a "Detector" picker
  (`yolox_s@640`, `yolox_tiny@640`, `yolox_tiny@416` = model @ tile side in video px; Nano removed 2026-11-06).
- **Smaller detectors** (YOLOX-Tiny / Nano, Apache-2.0, release 0.1.1rc0, 416 x 416 input; `ball_detect.py --tile`;
  Core ML by `tools/lab/yolox_coreml.py` from the .pth, checked on a frame: same detections as the release ONNX):

  | Detector (tag) | regions per frame | detector finds the ball | **mix cover** |
  |---|---|---|---|
  | YOLOX-S, all 640 tiles (`yolox-s-t5`) | 8.45 | 48% | **56%** |
  | YOLOX-S, two stages (`yolox-s-a3k2`) | 4.84 | 45% | **55%** |
  | Tiny, 640 tiles scaled to 416 (`tiny-t5`) | 8.45 | 39% | 52% |
  | Tiny, native 416 tiles (`tiny-n5`) | 17.1 | 42% | **55%** |
  | Tiny, 416 tiles, two stages k 2 / 3 / 4 (`tiny-n-a3k2/3/4`) | 7.7 / 8.4 / 9.1 | 34–37% | 53% |
  | Tiny, 640 tiles, two stages (`tiny-a3k2`) | 4.84 | 33% | 50% |
  | Nano, 640 tiles scaled to 416 (`nano-t5`) | 8.45 | 33% | 49% |

  Tiny needs native 416 tiles (twice as many regions) to match S; Nano loses too much.
- **Measured: Tiny, 416 tiles, two stages (`ball5deta3`, `yolox_tiny@416`, 5 min, 10 clips,
  `lab/tests/ios/soak.ball5deta3-tiny416.iPhone17_2.20261106-0957.json`)**: 7.5–8 ms per region once warm (14 ms on
  the first 3 clips; S: 38 ms), 8.3 regions per frame. yt-basket-04 / yt-bt-06 **~35.3 s per 30 s clip** (detector
  12.0 s + 11.6 + 11.6 s; the first clip 48 s), bt-wa-1028 20.5 s. The EdgeTAM passes also got faster after clip 3
  (13.2 → 11.6 s, mask summary 6.1 → 2.4 ms), as in the `ball35` soak (test 14). Thermal nominal, battery 65 → 65%; 5 min
  only (15 min still to run for heat). Lab cover of this variant: 53% (S two stages 55%, all tiles 56%, EdgeTAM alone
  43%). Estimate for Tiny with all 416 tiles (17 regions, cover 55%): ~21 s detector, ~45 s per clip.
- **Measured, 15 min (`soak.ball5deta3-tiny416.iPhone17_2.20261106-1035.json`, 22 clips)**: Tiny stayed at **14 ms per
  region the whole time** (the 7.5 ms of the 5 min run did not come back; the faster state seen there and in `ball35`
  is not something to count on). yt-basket-04 / yt-bt-06 **~48 s per 30 s clip** (detector 21–23 s + 13.3 + 13.2 s),
  bt-wa-1028 ~28 s. Thermal nominal all 15 min, battery 65 → 65% (less than one 5% step). So: all tiles S 80.3 s →
  S two stages 58.4 s → **Tiny two stages ~48 s** (ball5 alone 26.7 s); the two EdgeTAM passes are now the larger part.
  Lab check: Tiny two stages + only EdgeTAM pass 1 (no pass 2, ~13 s less) = mix cover 46% vs 53% with both passes: pass 2 still pays.

- Videos for Victor (2026-11-06): `lab/tests/framing/<clip>.compare.mix-keep-vs-mix-tiny.mp4` on the 12 app clips:
  the test 17 mix (YOLOX-S, all tiles; orange, left) vs the Tiny two-stage mix (`mix-tiny-n-a3k2`; green, right), both
  `hybrid.py --set v_keep=0.2` (basket-app-1031-a/b with ball_zoom 1.25); `tools/lab/compare_tracks.py`. Ball-in-crop
  and ball mode about the same on 11 clips; bt-rz-1105-v (night, 0.5x) ball mode 87 → 19% with Tiny (mostly today's
  framing there).

- Victor (2026-11-06) on bt-rz-1105-v with Tiny: the ball is found only in short bursts (3–11 frames), so the zoom
  opens and closes quickly. `hybrid.py` options (off by default): `min_seg` (drop ball segments shorter than N frames)
  and `zoom_rate` (max zoom change per second, both ways, the centre kept). This clip only, `--set min_seg=10 --set
  zoom_rate=0.5` (tag `mix-tiny-zoom`): zoom travel 6.7 → 1.5, fastest zoom change 2.7 → 0.8 per second, zoom
  reversals 2 → 0; ball mode 19 → 8% (only the first, longest find; the rest is today's framing). Videos:
  `bt-rz-1105-v.compare.mix-tiny-vs-mix-tiny-zoom.mp4`, `bt-rz-1105-v.compare.mix-keep-vs-mix-tiny-zoom.mp4`.
  Then on bt-wa-1028, bt-rz-1105-b, bt-rz-1105-a (Victor's pick; `<clip>.compare.mix-tiny-vs-mix-tiny-zoom.mp4`): ball
  mode unchanged (85 / 73 / 87%: their ball segments are long), fastest zoom change 1.6 / 1.7 / 2.7 → 0.8 per second;
  ball in crop 100 / 86 / 92% (bt-rz-1105-b 85 → 86%).
- Victor (2026-11-06): the zoom fix "very good, no losses" (`min_seg=10`, `zoom_rate=0.5` kept for the Tiny mix). 15 min soak done: ~48 s per 30 s clip, no heat.

### Test 18: fine-tune the ball detector on the lab's labels (2026-11-06) — `ball_train.py`

Victor: "worth testing" (after test 17). YOLOX-S from the COCO weights, one class, trained on 320 px crops at full
resolution: 17 labelled clips, 5,514 crops (2,412 with the ball; box sizes from EdgeTAM masks or COCO-detector boxes near
the label, else the clip's median), negatives = random crops + the COCO detector's false candidates. Folds by clip
(`FOLDS` in the script) so every clip is scored by a model that never saw it. CPU in the cloud workspace, ~0.9 s per
batch of 8. YOLOX code: the PyPI sdist yolox-0.3.0 (Apache-2.0), unpacked (`--yolox`); weights `yolox_s.pth` from its
GitHub release. `ball_detect.py` reads the one-class ONNX too.

Check (`ball_train.py check`): on 60 crops with the ball, is it the best box, and its score:

| Model (fold A: trained on folds B + C) | train clips: best box / score at the ball | held-out clips |
|---|---|---|
| COCO YOLOX-S, no training (head = COCO's "sports ball") | 21/60, 0.001 | 28/60, 0.003 |
| 2,000 iters, lr 0.004, new head (first run) | 0/60, 0.004 | 0/60, 0.006 (objectness collapsed) |
| 400 iters, lr 0.0005, head from COCO's ball row, BatchNorm frozen, grad clip | 27/60, 0.089 | 30/60, 0.061 |
| **3,000 iters, same settings** | **50/60, 0.389** | **25/60, 0.045** |

It learns the training clips (their courts, lights, balls) and not the ball: worse than COCO on clips it never saw.
With ~1,400 balls from 11 clips per fold the data is far too small and too uniform per clip; a detector of our own needs
tens of clips per sport (or a public ball dataset with a commercial licence). Not pursued further for now; the folds
B and C were not trained.

### Test 17: an AI detector that finds the ball in every frame (2026-11-05) — `ball_detect.py`, `ball_track.py`

Victor: "use AI to find the ball and anticipate its movement for the camera, to get close to v6". The framing rules of
v6 (hybrid round 6) work on any ball track; what failed was finding the ball on the app's clips (EdgeTAM is a tracker:
it drifts or sticks). So: a per-frame detector instead, no tap.

- Detector: YOLOX-S (Megvii, Apache-2.0; the ONNX of its GitHub release 0.1.1rc0), COCO class 32 "sports ball", score
  ≥ 0.05, on the whole frame (letterboxed 640) + native-resolution 640 px tiles (8 on 1080p), NMS, at 5 fps
  (`--step 2`); CPU in the cloud workspace, ~0.9 s per analysed frame (not a phone number).
- Ball path (`ball_track.py`, offline): shape filter; still things out (a candidate with another within 2% of the long
  side in ≥ 20% of the frames within ±2 s: balls lying, lamps); then dynamic programming over all candidates: the path
  with the best total score that moves like a ball (≤ 0.12 long sides per 100 ms, a cost per distance, gaps up to 1 s),
  repeated for other rallies; back to 100 ms by interpolation (`low_fps.upsample`). Output = oneclick-style track, so
  `hybrid.py` / `ball_gate.py` frame and score it.
- Mixed tracks (`low_fps.py fuse`): `mix-det-fuse5` = the detector where its ball is trusted, else EdgeTAM's fused track
  (test 15); `mix-fuse5-det` = the other way round.

Ground truth, 17 labelled clips (mode / prec / cover as in test 15; `lab/tests/detect/report.{det,mix,mixdet}.md`):

| Clip | detector finds the ball | EdgeTAM fused | detector alone | **detector + EdgeTAM** |
|---|---|---|---|---|
| bt-rz-1105-a (night, 1x) | 89% | 75 / 100 / 81 | 94 / 100 / 84 | **87 / 100 / 95** |
| bt-rz-1105-b (night, 1x) | 96% | 61 / 8 / 3 | 75 / 100 / 86 | **76 / 98 / 86** |
| bt-0AE39B33 (night) | 90% | 14 / 94 / 50 | 37 / 100 / 83 | **37 / 100 / 90** |
| bt-E5003B6B (night) | 84% | 27 / 93 / 44 | 30 / 76 / 41 | **34 / 83 / 59** |
| bt-rz-1105-v (night, 0.5x) | 26% | 9 / 0 / 0 | 84 / 40 / 11 | 87 / 35 / 13 |
| yt1105-voleipraia | 54% | 56 / 88 / 42 | 59 / 92 / 46 | 75 / 88 / 56 |
| yt1105-futevolei | 39% | 36 / 25 / 6 | 28 / 100 / 24 | 34 / 88 / 26 |
| yt1105-bt (broadcast) | 0% | 72 / 30 / 7 | 0 / — / 0 | 72 / 30 / 7 |
| yt-basket-04 | 61% | 96 / 94 / 89 | 56 / 96 / 50 | 100 / 92 / 87 |
| basket-rp-1105-v-a | 46% | 100 / 89 / 82 | 57 / 83 / 27 | 100 / 87 / 80 |
| basket-rp-1105-v-b | 23% | 99 / 51 / 32 | 35 / 89 / 14 | 99 / 61 / 40 |
| basket-rp-1105-h | 24% | 50 / 50 / 16 | 9 / 100 / 16 | 62 / 67 / 32 |
| basket-v-01 | 17% | 12 / 78 / 29 | 21 / 31 / 17 | 24 / 47 / 38 |
| yt1105-basket-a | 51% | 95 / 74 / 50 | 71 / 89 / 38 | 100 / 82 / 57 |
| yt1105-basket-b | 26% | 87 / 73 / 59 | 16 / 65 / 13 | 87 / 75 / 60 |
| yt1105-volei-a | 49% | 84 / 91 / 80 | 46 / 68 / 24 | 90 / 83 / 62 |
| yt1105-volei-b | 42% | 92 / 72 / 64 | 48 / 67 / 27 | 92 / 73 / 59 |
| **mean cover / prec** | | **43% / 65%** | 35% / 81% | **56% / 76%** |

- The COCO detector is strong where EdgeTAM was weakest: **night beach tennis at 1x** (it finds 84–96% of the labelled
  balls among ~14 candidates per frame; the path picks the right one). It is weak where EdgeTAM was strong: basketball
  and volleyball (17–61%: the ball in hands, near heads, blurred, is not a COCO "sports ball"). Night at 0.5x (ball
  ~3 px) and the broadcast clip (yt1105-bt, 0%) fail for both.
- Mixed, the two cover 56% of the labelled balls on average vs 43% for EdgeTAM alone and 35% for the detector alone.
- Framing (`hybrid.py --model mix-det-fuse5 --tag mix`): videos today | ball framing on the 13 app clips (the 9
  labelled + bt-wa-1028, volei-app-1102, basket-app-1031-a/b with ball zoom 1.25), `lab/tests/framing/<clip>.compare.mix.mp4` (deleted 2026-11-06).
  On the 4 unlabelled app clips the mixed track keeps EdgeTAM's ball mode (78–99%; detector alone: bt-wa-1028 34%). Camera jerk on night beach tennis ~1.0–1.7 (EdgeTAM fused 0.3–1.4; v6 on
  the approved clips 0.45): to check on video.
- Victor (2026-11-05): "overall good, satisfying; at times (lobs) the camera goes too high and loses the players".
  `hybrid.py --set v_keep=0.2`: the players' centre stays at least 20% of the crop's height above its bottom edge (a
  high lob may leave the top). 9 app clips, ball-mode frames: players' centre out of the crop 3.4 → 0%, in the bottom
  15% 8.6 → 0%; labelled balls in the crop 94.8 → 91.9% (v_keep 0.1: 93.5%, players out 0%, bottom 15% 6.4%). Videos:
  `<clip>.compare.mix-keep.mp4` (night beach tennis + bt-wa-1028; deleted 2026-11-06, the same framing is the left side of `compare.mix-keep-vs-mix-tiny`).
- Victor (2026-11-05): lob fix "excellent" (`v_keep=0.2` kept for the ball framing).
- **Phone cost bench (2026-11-06)**: `lab/coreml/yolox_s.mlpackage` (YOLOX-S COCO converted with coremltools 9 in the
  cloud workspace: image 640x640 BGR, output [1, 8400, 85], FP16, iOS 16); FocusBench soak modes **"Detector de bola a
  5 fps (teste 17)"** (`det5`: the detector alone, whole frame + 640 px tiles, every 2nd 100 ms tick through the click,
  read from the video) and **"Detector + 2 passadas a 5 fps (teste 17)"** (`ball5det`: the detector, then `ball5`);
  `ios_bench.py prepare` copies the model, `results` shows the detector's seconds per clip and ms per 640 px region.
- **Measured (2026-11-06, iPhone17,2, iOS 27.0.1, Neural Engine, attention_pairs_soft, 15 min `ball5det`,
  `lab/tests/ios/soak.ball5det.iPhone17_2.20261106-0810.json`)**: 13 clips, identical times every round.
  | clip | detector | pass 1 + pass 2 | total |
  |---|---|---|---|
  | yt-basket-04 (30 s) | 53.8 s | 13.2 + 13.2 s | **80.3 s** |
  | yt-bt-06 (30 s) | 53.8 s | 13.2 + 13.2 s | **80.3 s** |
  | bt-wa-1028 (~20 s) | 28.2 s | 10.4 + 8.9 s | **47.6 s** |
  The detector costs 39 ms per 640 px region (model 38.1, prep 1.2, decode 0.1) and ~9 regions per frame (whole frame
  + tiles) = ~360 ms per frame at 5 fps: **2x the two EdgeTAM passes; the mix is ~3x `ball5` (80 s vs 26.7 s per 30 s
  clip)**. Thermal state nominal for all 15 min (the `ball5` soak reached fair at 7.2 min on 2026-11-05; ambient may
  differ), battery 75% → 75% (iOS reports 5% steps). Verdict: works, but too slow for the app as it is; the cost is in
  the tiles (8 of the ~9 inferences).
- Cheaper detector: test 19 (two stages: 58.4 s per 30 s clip measured, mix cover 55%).
- Next if worth it: fine-tune the detector on the sports (labels: `labels/`, 32 clips; plus public data with a
  commercial-friendly licence) so it sees the ball in hands and in volleyball; TrackNetV3 (MIT, code and checkpoints;
  checkpoints on Google Drive, not reachable from the lab's workspaces: Victor would download them) for small fast
  balls from consecutive frames.

### Test 16: today's Modo Foco, a little faster and closer (2026-11-05) — `broadcast.py scores --all`

Victor, after the fuse5 videos: of the app clips only basket-rp-1105-v-a was good enough to use the ball framing;
**Foco na Bola is on hold, production keeps today's Modo Foco**. Next: only a faster camera and a little more zoom when
possible, tested before the app. Milder than test 13 (no lead, no runner pull, no widen by default), on the 17
labelled clips (`summary-mild.md`; the new clips with whole frame + tiles as the app):

| Variant | Ball in crop | Off centre | Zoom mean / max | Pan p95 / mean | Jerk p95 | Vertical flips / 10 s |
|---|---|---|---|---|---|---|
| today | 88% | 0.30 | 1.34x / 1.54x | 0.07 / 0.024 | 0.09 | 0.1 |
| `s1-speed`: σx 0.45 s, pan 50%/s | 88% | 0.30 | 1.34x / 1.54x | 0.08 / 0.027 | 0.12 | 0.1 |
| `s2-faster`: σx 0.35 s, pan 70%/s | 88% | 0.30 | 1.34x / 1.54x | 0.09 / 0.029 | 0.17 | 0.1 |
| `z1-zoom`: s1 + max zoom 1.6 (1.76x) | 88% | 0.31 | 1.37x / 1.60x | 0.08 / 0.027 | 0.12 | 0.1 |
| **`z2-zoom-head`**: z1 + feet anchor half way | **91%** | 0.28 | 1.37x / 1.60x | 0.08 / 0.027 | 0.12 | 0.2 |
| `z3-zoom-slow`: z2 with max 1.7 and widen on fast pans | 91% | 0.28 | 1.35x / 1.61x | 0.08 / 0.026 | 0.13 | 0.2 |

The zoom changes little on average because most clips are wide plays (the zoom is set by the players' spread); the
half feet anchor gives the extra zoom to headroom and gains ball in crop (bt-E5003B6B 78 → 88%, bt-rz-1105-b 86 → 97%).
Videos (today | variant) on the 9 app clips: `lab/tests/broadcast/<clip>.compare.{s2-faster,z2-zoom-head}.mp4`
(deleted 2026-11-05; `broadcast.py render` remakes them). **Verdict (Victor, 2026-11-05): none precise enough to replace
today's framing; today's Modo Foco stays as it is.**

### Test 15: when does a clip get the ball framing? (2026-11-05) — `ball_gate.py`

Victor: today's Modo Foco stays for every clip; the ball framing is offered on top of it only on clips where the ball
is tracked well. We need a reference value the phone can compute after the two passes, without ground truth.

`ball_gate.py` lists per clip the phone-side signals (ball-mode share, trusted share, density of trusted frames in
ball mode, pass 1 / pass 2 agreement, segments, the trusted ball's speed) next to the ground truth where labelled
(`prec`: labelled balls during ball mode that the trusted ball hits; `cover`: labelled balls hit in ball mode). Reports
`lab/tests/gate/report.{5fps,v6}.md`.

Bad clips are of two kinds: (1) the ball is found little (night beach tennis, basket-v-01: ball mode 0–19%), and
(2) the dangerous one, **ball mode most of the time on the wrong thing** (basket-rp-1105-v-b: 90% ball mode, the trusted
ball hits the labelled one only 62% of the time; basket-rp-1105-h, 80% at 10 fps, 50%). Kind (2) shows as a "ball" that
barely moves: median speed 0.03–0.07 long sides per second vs 0.12–0.38 on every good clip (a ball in play moves).

**Proposed rule: ball framing when ball mode ≥ 50% of the clip AND the median speed of the trusted ball in ball mode ≥
0.10 long sides per second; otherwise today's framing** (the chip says the ball could not be followed). On the 15 clips
it says yes to the 8 good ones (the 6 Victor approved on video with v6, plus bt-rz-1105-a: 100% prec, 81% cover, and
basket-rp-1105-v-a: 91% / 79%) and no to the 7 others, with the 5 fps tracks and with v6's 10 fps tracks alike.
Margins: ball mode 29% (worst no) vs 65% (lowest yes); speed 0.07 vs 0.12. Not used: pass 1 / pass 2 agreement (low on
good clips where pass 1 finds the small ball little, e.g. bt-wa-1028 22%, bt-rz-1105-a 12%). The thresholds were chosen
on these 15 clips: validate them on clips not used here before relying on them.

Validation (2026-11-05, 7 YouTube clips not used to choose the rule, ball labelled by Victor; `mac-validate.sh`,
`mac-pass2.sh`, reports `lab/tests/gate/report.{validate,pass2fix,fuse5fix}.md`) found two tracking problems first:

1. **The click could fall outside pass 2's crop at its own frame** (4 of 22 clips: yt1105-volei-b, yt1105-basket-b,
   bt-rz-1105-b, basket-v-01 at the edge; v6 too): the crop path follows pass 1, and where pass 1 does not trust the
   ball at the click the crop sat on the players. Fix in `roi.py` (`seed_inside`, default): the crop at the click's
   frame moves so the click is at least 25% inside it, the frames around follow over a Gaussian of 3 frames. The app's
   ROI (spec 4.4) needs the same rule. (Side effect: pass 2 is sensitive to its crops; yt1105-basket-a got worse with
   the moved crop, 80 → 27% prec.)
2. **Pass 2 can stick to something still while pass 1 follows the ball** (yt1105-volei-a: pass 1 hits 90% of the
   labelled balls, pass 2 stays on a fixed spot from the click). **Fused track** (`low_fps.py fuse`, tag
   `edgetam-fuse5`): per frame pass 2's ball where trusted, else pass 1's where trusted. Same cost. On the 22 clips it
   turns 4 more clips good (yt1105-volei-a 2 → 84% ball mode at 91% prec, yt1105-basket-b 21 → 87% at 73%,
   yt1105-basket-a 58 → 95% at 74%, yt-basket-04 cover 78 → 89%) and keeps the others.

With the validation clips the first rule let one bad clip through: bt-rz-1105-b (pass 2 after the fix: 54–61% ball mode,
speed 0.103, but the labelled ball hit 8% of the time: it follows something else, few frames confirmed). **Rule, round 2
(on the fused track): ball framing when ball mode ≥ 50%, speed ≥ 0.10 long sides/s, slow steps ≤ 15%, and ≥ 50% of
the ball-mode time with a confirmed (trusted) ball** (`dens`). On all 22 clips: no bad clip let through, no good clip
refused ("good" = the labelled ball hit ≥ 70% of the time in ball mode, or approved by Victor on v6's video). Margins
(fused): dens 0.42–0.46 (worst bad) vs 0.60 (lowest good); slow 0.22 vs 0.13; speed 0.06 vs 0.12. Four thresholds
on 22 clips: still to confirm in the field (the values go in `<clip>.ball.json` to tune them).

Lens (Victor, night beach tennis): bt-rz-1105-a (1x) works (75% ball mode, 100% prec), bt-rz-1105-b (1x) does not
(8% prec, after the fix), bt-rz-1105-v (0.5x, ball ~3 px in pass 1) 0%. 1x is not enough by itself; 0.5x at night
with a far ball did not work at all. Basketball at 0.5x works (basket-rp-1105-v-a, big ball).

Videos (today | ball framing on the fused track): `lab/tests/framing/<clip>.compare.fuse5.mp4` for the 7 YouTube clips
and bt-rz-1105-b.

### Test 14: Foco na Bola at 5 fps (2026-11-04) — `low_fps.py`, `mac-lowfps.sh`

Victor, after test 13: none of the players-only variants looks like Foco na Bola v6; the look needs the ball. So: make
the ball tracking cheaper. On the 16 Pro Max a pass costs ~84 ms per frame (test 11, optimised soak): one pass at
10 fps ~27 s per 30 s clip, two passes ~52 s. At 5 fps: **one pass ~13 s, two passes ~26 s** (on top of today's
people analysis, which the ball framing needs as its fallback), if the tracker holds the ball with twice the motion
between frames (test 8 tried more frames, never fewer).

How: the same EdgeTAM tracking on every 2nd frame, on a grid through the click's frame; the track goes back to the
10 fps grid by linear interpolation of the centre and box (`low_fps.upsample`), then hybrid.py round 6 as v6. New
options: `oneclick.py --fps 5` (frames `lab/frames/<clip>@5` from `low_fps.py frames`, hard links), `roi.py --step 2`
(pass 2 crops only on the grid: `@roi40b5`), `single_pass.py track --step 2` (tag `...-5fps`).

Simulation first (no tracker, Linux): keep every 2nd frame of the existing 10 fps tracks and interpolate
(`low_fps.py sub`; `lab/tests/lowfps/report.sim.md`). The framing barely moves: the crop centre is within 0.00 crop
widths of v6 at the median on all 9 clips (p90 ≤ 0.12), ball mode within −5…+6 points, labelled balls in the crop
the same except basket-v-01 (100 → 88%: 3 of its 24 labelled balls). So 5 fps is enough for the **framing**; what the Mac run
answers is whether EdgeTAM still **tracks** at 5 fps.

Run on the Mac: `bash tools/lab/mac-lowfps.sh 2>&1 | tee lab/tests/lowfps/mac.log` (pass 1 at 5 fps → `edgetam-5fps`,
pass 2 → `edgetam-roi40b5`, one pass → `edgetam-torch-fp16-roi40f-5fps`, report `lab/tests/lowfps/report.mac.md`).

Results (2026-11-04, Mac; ball mode = share of the clip framed on the ball, round 6; in crop / off = labelled balls
inside the hybrid crop / distance to its centre):

| Clip | v6: 2 passes, 10 fps | 2 passes, 5 fps | **1 pass, 5 fps** | 1 pass, 10 fps (test 12) |
|---|---|---|---|---|
| bt-wa-1028 | 74% | 85% | 85% | 76% |
| yt-basket-04 | 100%, 100%, 0.17 | 87%, 100%, 0.24 | 96%, 100%, 0.19 | 100%, 100%, 0.17 |
| yt-bt-06 | 84% | 83% | 84% | 87% |
| volei-app-1102 | 65% | 69% | **58%** | 47% |
| basket-v-01 | 11%, 100%, 0.40 | 12%, 100%, 0.17 | 8%, 100%, 0.28 | 1%, 100%, 0.29 |
| bt-E5003B6B | 9%, 94%, 0.34 | 19%, 94%, 0.35 | 30%, **59%**, 0.47 | 12%, 81%, 0.37 |
| bt-0AE39B33 | 14%, 80%, 0.35 | 14%, 77%, 0.37 | 16%, 80%, 0.35 | 16%, 80%, 0.36 |
| basket-app-1031-a | 100% | **83%** | **79%** | 84% |
| basket-app-1031-b | 100% | 99% | 99% | 100% |
| iPhone 16 Pro Max, 30 s clip (84 ms per frame per pass) | ~52 s | ~26 s | **~13 s** | ~27 s |

Crop centre vs v6, median: ≤ 0.01 crop widths on every clip for both 5 fps runs except one pass on volleyball (0.05);
p90 up to 0.18 (two passes) and 0.28 (one pass, bt-E5003B6B).

- 5 fps tracks as well as 10 fps on most clips; sometimes more ball mode (bt-wa-1028 74 → 85%: fewer frames, fewer
  chances for EdgeTAM to drift onto a racket).
- One pass at 5 fps (~13 s on the phone, the budget asked for) is close to v6 on 7 of 9 clips; it is worse where the
  one-pass method already was (test 12): volleyball (ball lost outside the crop, 58% vs 65%; better than one pass at
  10 fps, 47%) and bt-E5003B6B, where its ball mode rises to 30% but the ball is in the crop only 59% of the time
  (it follows something else part of the time), and basket-app-1031-a (79%, box seed).
- Two passes at 5 fps (~26 s) keep v6's quality except yt-basket-04 (87% ball mode) and basket-app-1031-a (83%).

Victor (2026-11-05): one pass at 5 fps does the job, two passes at 5 fps are better; can the frame rate go lower
with two passes? Simulation (`low_fps.py sub --step 3|4`, `report.sim-steps.md`): the framing of v6's own track kept at
3.3 fps loses ball mode on volleyball (65 → 56%) and basket-app-1031-a (100 → 84%); at 2.5 fps on most clips
(bt-wa-1028 59%, yt-bt-06 62%, volleyball 43%). But pass 1 only places pass 2's crops (smoothed, gaps bridged): with
pass 1 at 3.3 fps, ≥ 90% of v6's pass-2 balls stay inside the crop on every clip; at 2.5 fps too, except bt-0AE39B33
(78%) and volleyball (91%). Next, on the Mac (`mac-lowfps2.sh`): pass 1 at 2.5 or 3.3 fps, pass 2 at 5 fps
(~19 / ~21 s per clip on the phone, vs ~26 s for both at 5 fps).

Mac run (2026-11-05, `mac-lowfps2.sh`, `report.mac2.md`): ball mode, and labelled balls in the crop where labelled.

| Clip | v6 (2 × 10 fps) | 2 × 5 fps | **p1 3.3 + p2 5 fps** | p1 2.5 + p2 5 fps | 1 × 5 fps |
|---|---|---|---|---|---|
| bt-wa-1028 | 74% | 85% | 85% | 85% | 85% |
| yt-basket-04 | 100% / 100% | 87% / 100% | 92% / 100% | 92% / 100% | 96% / 100% |
| yt-bt-06 | 84% | 83% | 82% | 82% | 84% |
| volei-app-1102 | 65% | 69% | 62% | 57% | 58% |
| basket-v-01 | 11% / 100% | 12% / 100% | 17% / **83%** | 14% / **83%** | 8% / 100% |
| bt-E5003B6B | 9% / 94% | 19% / 94% | 20% / **81%** | 23% / **66%** | 30% / **59%** |
| bt-0AE39B33 | 14% / 80% | 14% / 77% | 17% / **60%** | 13% / **57%** | 16% / 80% |
| basket-app-1031-a | 100% | 83% | 99% | 99% | 79% |
| basket-app-1031-b | 100% | 99% | 99% | 90% | 99% |
| frames per 30 s clip / iPhone estimate | 600 / ~52 s | 300 / ~26 s | 250 / ~21 s | 225 / ~19 s | 150 / ~13 s |

A sparser pass 1 keeps the easy clips (and fixes basket-app-1031-a and yt-basket-04 vs 2 × 5 fps) but costs on the
three hard night/vertical clips (basket-v-01, bt-E5003B6B, bt-0AE39B33: 3–6 of 24–32 labelled balls), where pass 1
already finds the ball little: with fewer pass-1 frames the crops go to the wrong place more often. 2.5 fps is worse
than 3.3 fps everywhere it differs. Videos for p1 3.3 + p2 5: `<clip>.compare-v6-vs-p3.mp4`.

New clips (2026-11-05, Victor: 3 night beach tennis, 3 basketball, app exports without Modo Foco, ball labelled on the
page; `mac-newclips.sh`, `report.newclips.md`). Today's framing here uses the people file's whole frame + 9 tiles, as
the app since v14 (the whole frame alone found people in 9% of bt-rz-1105-v's frames). Ball mode / labelled balls in
the crop:

| Clip (points) | today | v6 (2 × 10 fps) | 2 × 5 fps | p1 3.3 + p2 5 fps | 1 × 5 fps |
|---|---|---|---|---|---|
| bt-rz-1105-a (73) | — / 95% | 39% / 90% | 75% / 92% | 43% / 88% | 77% / 100% |
| bt-rz-1105-b (73) | — / 86% | 0% / 86% | 9% / 79% | 9% / 79% | 36% / 79% |
| bt-rz-1105-v (54) | — / 100% | 0% / 100% | 0% / 100% | 0% / 100% | 0% / 100% |
| basket-rp-1105-h (25) | — / 100% | 80% / 100% | **29%** / 100% | 54% / 100% | 34% / 100% |
| basket-rp-1105-v-a (109) | — / 100% | 100% / 99% | 100% / 100% | 99% / 99% | 100% / 99% |
| basket-rp-1105-v-b (57) | — / 100% | 89% / 98% | 90% / 100% | 81% / 98% | 79% / 96% |

- Night beach tennis from the side (far, small ball): EdgeTAM barely holds the ball at any frame rate (v6 0–39% ball
  mode; bt-rz-1105-v 0% everywhere); the framing stays on the players, as today. One pass at 5 fps gets more ball mode
  on bt-rz-1105-a (77%, every labelled ball in the crop) but on bt-rz-1105-b its 36% is mostly something else (11% hits).
- Basketball: 2 × 5 fps ties v6 on the two vertical clips; it loses the short low-resolution horizontal clip
  (basket-rp-1105-h, 1024×576, 8 s: 80 → 29%), where p1 3.3 + p2 5 keeps more (54%).
- Videos: `lab/tests/framing/<clip>.compare-v6-vs-{2p5,p3,1p5}.mp4` for the six clips.

iPhone (to run): FocusBench's soak has three new modes, same clips and settings as test 11 (15 min each, unplugged,
brightness 50%, Low Power Mode off): **"Bola: 2 passadas a 5 fps (teste 14)"** (`ball5`), **"Bola: passada 1 a 3,3 fps +
passada 2 a 5 fps (teste 14)"** (`ball35`) and **"Bola: 1 passada a 5 fps (teste 14)"** (`ball1_5`). The tracker runs
on every 2nd (3rd) 100 ms tick on the grid through the click (`Tracker.step`, memory bank 2 or 3 ticks apart as on the
Mac); the video is still decoded in full, but only the grid's ticks are scaled and encoded (`VideoFrames.wanted`). Pass
2 uses v6's crops (the bundled roi40b): its cost does not depend on where the crop is; the quality is the Mac's above.
The comparison with the Mac's track is skipped in these modes. `ios_bench.py results` adds them to the soak table.

Soak results (2026-11-05, iPhone 16 Pro Max, iOS 27.0.1, unplugged, brightness 53%, Low Power Mode off, Neural Engine,
the same 3 clips in a loop, 15 min):

| | v6: 2 × 10 fps (test 11, optimised) | 1 × 10 fps (test 11) | **2 × 5 fps (`ball5`)** | p1 3.3 + p2 5 fps (`ball35`) |
|---|---|---|---|---|
| 30 s clip | 52 s | ~27 s | **26.7 s** (13.3 + 13.3; max 27.6 s) | **22.8 s** (9.5 + 13.3) first 7.5 min, **20.0 s** (8.4 + 11.6) after |
| processing / video | 1.7x | 0.9x | **0.89x** (38 clips, 1011 s of video in 905 s) | **0.71x** (48 clips, 1282 s in 915 s) |
| ms per frame and pass | 84 | 84–89 | 85 (models 74, image 5, mask summary 6) | 91 / 85, then 82 / 76 (decoder 5.8 → 4.4, mask summary 6.2 → 2.4 ms) |
| battery (5% steps) | 75 → 70% (20 clips) | 70 → 60% (38 clips) | **95 → 90% (38 clips)** | **95 → 95% (48 clips)** |
| heat | fair after 5 min, serious after 13 min | fair after 7 min, serious after 11 min | **fair after 7.2 min, never serious in 15 min** | **fair after 9 min, never serious** |

`ball35` got ~10% faster at 7.8 min (every part, CPU ones most: the mask summary 6.2 → 2.4 ms), as if the phone
stopped sharing the CPU with something else (a system task finishing); the first 7.5 min (22.8 s per 30 s clip) are the
comparable number. Its pass 1 costs ~6 ms more per frame (91 vs 85: three ticks decoded per tracked frame instead of
two). The battery numbers come in 5% steps: both runs used under ~5–8% in 15 min.

The video reader failure seen once in a first `ball5` run (clip 7, "video reader failed") did not come back in 38
clips; FocusBench now records the reader's error and retries such a clip up to twice (no retries in this run).

Videos (`lab/tests/framing/<clip>.compare-v6-vs-1p5.mp4` and `...-v6-vs-2p5.mp4`, v6 left in green, the 5 fps run
right in magenta; the app exports with ball zoom 1.25 as in clips.txt): all 9 clips.

### Test 13: a "broadcast" camera from the players alone (2026-11-04) — `broadcast.py`, `focus_variant.py`

Victor (handoff `handoff-players-camera.md`): today's Modo Foco ships (~15 s per 30 s clip on the 16 Pro Max, cold);
Foco na Bola has the TV look but costs 27–52 s per clip and heats up. Goal: more "TV" (faster camera, more movement and
zoom) at today's cost. Every variant below is a change of the path rules only (`FocusPath`, the same Vision boxes), so
its analysis cost is today's, except the optical-flow ones (13c).

New `focus_variant.py` options (all off by default: `--preset acao --check` still matches the app's files exactly on
the six lab clips): `speedPow` (the fastest runner pulls harder), `leadMs` (aim where the players will be),
`vertAsym` + `vDeadband`/`vUpPerSecond`/`vDownPerSecond`/`vSigmaMs` (the ball framing's height rule: dead band, up fast,
down slow), `anchorFeet` + `footMargin`/`anchorShare` (the crop's bottom just under the players' feet), `widenPerSpeed`
(open while the camera pans fast, close when the play is slow), `flowPull`/`flowRef`/`flowSpread` (the fast-motion
region of the optical flow pulls the target). `broadcast.py scores` runs the variants on the labelled clips next to
today (`current`) and Foco na Bola v6 (`hybrid.v6-edgetam-roi40b`); `broadcast.py render VARIANT` makes the
today | variant videos; `broadcast.py flow` computes the flow files with OpenCV Farneback at 320 px (a stand-in for
Vision's flow on Linux; `flow-probe.swift` writes the same file with Vision on the Mac).

Scores (mean over basket-v-01, bt-0AE39B33, bt-E5003B6B, yt-basket-04: 24 + 30 + 32 + 101 labelled ball points, so
one point is 1–4% on a clip; full tables `lab/tests/broadcast/summary-*.md`). Ball in crop / off centre on the labelled
balls; pan in frame widths per second; jerk in long sides / s²; moving cut = frames with a moving player > 25% outside.

| Variant | Ball in crop | Off centre | Zoom mean / max | Pan p95 / mean | Jerk p95 | Vertical flips / 10 s | Moving cut / anyone cut |
|---|---|---|---|---|---|---|---|
| today (`current`, v15 acao) | 85% | 0.36 | 1.51x / 1.65x | 0.10 / 0.029 | 0.13 | 0.3 | 0% / 2% |
| 13a `a1-fast`: σx 0.35 s, pan 70%/s | 85% | 0.36 | 1.51x / 1.65x | 0.14 / 0.034 | 0.21 | 0.3 | 0% / 2% |
| 13a `a2-fast-zoom`: + zoom to 2.0x | **76%** | 0.41 | 1.70x / 2.00x | 0.14 / 0.037 | 0.23 | 0.3 | 0% / 2% |
| 13b `b2-lead-runner`: + lead 0.5 s, speed² | 78% | 0.43 | 1.73x / 2.00x | 0.17 / 0.045 | 0.23 | 0.2 | 0% / 3% |
| `d1-feet`: + feet anchor | 86% | 0.36 | 1.73x / 2.00x | 0.17 / 0.045 | 0.30 | 1.2 | 2% / 4% |
| **`tv18`** (below), up to 1.8x | **91%** | 0.32 | 1.55x / 1.79x | 0.15 / 0.038 | 0.26 | 0.4 | 1% / 2% |
| `tv18m`: `tv18` with the feet anchor half way | 89% | 0.33 | 1.55x / 1.79x | 0.15 / 0.038 | 0.24 | 0.0 | 0% / 1% |
| `tv20`: `tv18` up to 2.0x | 88% | 0.34 | 1.64x / 1.96x | 0.16 / 0.040 | 0.25 | 0.8 | 1% / 3% |
| `tv18-nolead`: no lead, no speed² | 91% | 0.32 | 1.54x / 1.79x | 0.13 / 0.033 | 0.22 | 0.5 | 0% / 2% |
| 13c `tv18-flow`: + flow pull 0.7 (Farneback) | 91% | 0.31 | 1.51x / 1.78x | 0.16 / 0.041 | 0.36 | 0.3 | 1% / 2% |
| Foco na Bola v6 (EdgeTAM roi40b) | 93% | 0.32 | 1.70x / 2.00x | 0.20 / 0.049 | 0.45 | 0.8 | 2% / 26% |

`tv18` = `--preset acao --set sigmaXMs=350 --set maxPanPerSecond=0.7 --set maxZoom=1.65 --set sigmaSizeMs=1200
--set anchorFeet=1 --set footMargin=0.06 --set vertAsym=1 --set vDeadband=0.05 --set vUpPerSecond=1 --set
vDownPerSecond=0.2 --set vSigmaMs=800 --set widenPerSpeed=0.6 --set leadMs=500 --set speedPow=2` (maxZoom 1.65 × zoomIn
1.1 = 1.8x on screen; 1.82 = 2.0x).

What the rounds showed:
1. **Faster pan alone** (13a, `a1`) adds movement and keeps the ball, but is a small change (pan p95 +40%).
2. **More zoom from the players alone loses the ball**, and almost always **above** the crop (lobs in beach tennis,
   shots in basketball): 2.0x took ball in crop 85 → 76%. The players' centre is the wrong anchor once the crop is
   small. **Anchoring the crop's bottom just under the players' feet** (`anchorFeet`) gives the zoom to the headroom
   and is the round's main gain: 76 → 86% at 2.0x, 91% at 1.8x (today 85%; bt-0AE39B33 63 → 77%, bt-E5003B6B 78 → 94%).
   It made the camera bob (a zoom change moves the centre when the bottom is fixed: 2.7 flips/10 s on bt-E5003B6B) until
   the size smoothing went back to today's 1.2 s and the height got a 5% dead band and σ 0.8 s (0.4 flips/10 s).
3. **Zoom with the play's speed** (`widenPerSpeed` 0.6): open during a fast transition, close on a slow play, like a
   TV camera operator; it costs no ball and keeps people in (anyone cut 3 → 2%).
4. **The lead on the play** (13b: 0.3/0.5/0.7 s, and speed² so the fastest runner pulls) gives more movement (pan mean
   +15%) but no measurable change in the ball: the path already looks ahead (centred Gaussian), so the lead mostly
   moves the camera earlier. Kept in `tv18` for the look; `tv18-nolead` is the calmer alternative. Video decides.
5. **Optical flow** (13c, OpenCV Farneback at 320 px as the stand-in): no measurable gain on top of `tv18` (91% → 91%,
   jerk 0.26 → 0.36). Not worth an extra Vision request per frame for now. The Vision version is ready to measure
   (`flow-probe.swift` on the Mac → `lab/tests/broadcast/<clip>.flow.json`, then `broadcast.py scores`; `flowRef` was
   set on Farneback's scale and must be checked on Vision's), and its cost on the iPhone with FocusBench's soak mode
   **"Pessoas + fluxo óptico (teste 13)"** (`peopleflow`: today's analysis + `VNGenerateOpticalFlowRequest`, low
   accuracy, 320 px, between consecutive 100 ms ticks; `ios_bench.py results` shows the flow ms per tick). Not run yet.
6. Where `tv18` is worse than today: basket-v-01 loses 2 of its 24 labelled balls (100 → 92%, the zoom 1.65x → 1.77x
   on a static half-court scene), jerk p95 doubles (0.13 → 0.26, still below Foco na Bola's 0.45: it is the movement
   asked for), and a moving player is cut in 1% of the frames (today 0%).
7. App exports (volei-app-1102, basket-app-1031-a/b) are left out: they are already cropped by today's Modo Foco and
   have no people files.

Cost: `tv18` and `tv18m` change only `FocusPath` (pure Swift over ~300 samples), not the analysis, so the clip costs
what it does today (~15 s per 30 s clip, cold, test 11's soak). The new rules are a few passes over the samples.

Videos for Victor (`lab/tests/broadcast/<clip>.compare.<variant>.mp4`, left: the whole picture with today in orange
and the variant in blue and the labelled ball ring; then today | variant): `tv18`, `tv18m` and `tv20` on basket-v-01,
bt-0AE39B33, bt-E5003B6B, yt-basket-04, yt-bt-06 and bt-wa-1028 (the last two have only the first click, so video
only). Proposed amendment (pending the videos): `2026-10-23-focus-mode-design.md`, "Amendment proposal 2026-11-04".

### Test 12: one pass instead of two (2026-11-04) — `single_pass.py`, `roi.py --guide p`

Question (spec 10 item 5): can a single EdgeTAM pass keep the quality of the two-pass pipeline (pass 1 on the whole
frame, pass 2 on 40% crops around pass 1's trusted ball, `edgetam-roi40b`)? Same 10 fps frames, same seeds, same
round-6 judge (`coreml_export.judge`: share of the clip in ball mode, hits on the labelled clips) and hybrid.py.

Variants:
- **(a) players only** (`roi40p`): 40% crops on today's framing (players), EdgeTAM's predictor (`oneclick.py`).
- **(b) follow the ball** (`single_pass.py track`, coreml_export's fixed-bank loop on the PyTorch wrappers): each
  frame's crop is centred on the last plausible ball (round 6's per-frame shape filters + jump limit), held 0.3 s
  after a loss, then back to the players' path; forwards from the click, then backwards; crops cut from the
  full-resolution video (decoded once into `lab/cache/`, deleted after each clip) through JPEG q92 as roi.py.
  `roi40f` the crop jumps onto the ball (`--vel 1` adds the ball's velocity; `roi40f0` without it: same results except
  bt-E5003B6B), `roi40f0s30` the crop moves 30% of the way per frame (`--follow 0.3`), `roi40f0w` the tracker sees
  the whole frame while the ball is lost (`--lost full`, as pass 1).

Ball mode (round 6) / hits on the labels; Mac, CPU, ~295 ms per frame for the four parts:

| Clip | Two passes (roi40b) | (a) players only | (b) jump onto the ball | (b) smooth 30% | (b) whole frame when lost |
|---|---|---|---|---|---|
| bt-wa-1028 | 74% | 0% | **76%** | **76%** | 20% |
| yt-basket-04 | 100% / 98% | 74% / 69% | 100% / 98% | 100% / 97% | 88% / 92% |
| yt-bt-06 | 84% | 89% | 87% | **90%** | 87% |
| volei-app-1102 | 65% | 30% | 47% | 47% | **66%** |
| basket-v-01 | 11% / 33% | 22% / 17% | 1% / 8% | **23% / 50%** | 1% / 8% |
| bt-E5003B6B | 9% / 25% (94% ball in hybrid crop) | 9% / 16% (78%) | 12% / 22% (81%) | 1% / 6% (78%) | 0% / 6% (78%) |
| bt-0AE39B33 | 14% / 70% | 22% / 0% | 16% / 70% | 16% / 70% | 14% / 73% |
| basket-app-1031-a (box seed) | 100% | 69% | 84% | 84% | 100% |
| basket-app-1031-b | 100% | 29% | 100% | 87% | 100% |

Why none is enough:
- (a) has no idea where the ball is: lobs, serves and passes leave the players' crop (bt-wa-1028 0%, basket-app-1031-b
  29%, bt-0AE39B33 0% hits). Confirms test 8.
- (b) ties or beats the two passes where the ball stays in view (bt-wa-1028, yt-basket-04, yt-bt-06, bt-0AE39B33,
  basket-app-1031-b), but once the ball is lost the crop goes back to the players and nothing can find the ball
  elsewhere: volei-app-1102 5–12 s, the ball is outside the crop (pass 1 finds it on the whole frame).
- Showing the whole frame while lost fixes that clip (66%) and basket-app-1031-a, but the switch of scale between
  the 40% crop and the whole frame (2.5x) confuses the memory: bt-wa-1028 74% → 20%, yt-basket-04 100% → 88%.
- A crop that jumps 30–40 px per frame after the ball loses basket-v-01 at 24.9 s (ball in hand: EdgeTAM says "no
  object" and never comes back, while the two-pass crop moves ≤ 3 px per frame and keeps it); moving the crop smoothly
  fixes that clip (23% / 50% hits, better than the two passes) but breaks bt-E5003B6B (1%) and basket-app-1031-b (87%).
- Each fix moves other clips both ways: on hard clips the track is sensitive to small changes of the picture (as the
  FP16 runs in test 10). The two passes are robust because pass 1 sees the whole clip before the crops are chosen,
  and the crop path is smoothed with the future known (σ 0.3 s).

Decision: keep the two passes (spec 4.4). Options to save time stay as in spec section 5 (pass 1 at 5 fps; pass 1
only near the seed); "pass 2 only, players' path" is measured here and does not work.

Run (`docs/focus-refs`, Mac, `lab/.venv-edgetam`):

```bash
PY=lab/.venv-edgetam/bin/python
CLIPS=(bt-wa-1028 yt-basket-04 yt-bt-06 volei-app-1102 basket-v-01 bt-E5003B6B bt-0AE39B33 basket-app-1031-a basket-app-1031-b)
$PY tools/lab/roi.py $CLIPS --size 0.4 --guide p && $PY tools/lab/oneclick.py --model edgetam --variant roi40p $CLIPS
$PY tools/lab/single_pass.py track $CLIPS --vel 1                 # roi40f   (--vel 0: roi40f0)
$PY tools/lab/single_pass.py track $CLIPS --vel 0 --follow 0.3    # roi40f0s30
$PY tools/lab/single_pass.py track $CLIPS --vel 0 --lost full     # roi40f0w
$PY tools/lab/single_pass.py report --tags edgetam-roi40b,edgetam-roi40p,edgetam-torch-fp16-roi40f --name test12
# videos for review: two passes (left, green) vs one pass (right, magenta), both framed by hybrid.py round 6
python3 tools/lab/compare_runs.py bt-wa-1028 yt-bt-06 yt-basket-04 volei-app-1102 basket-app-1031-a
python3 tools/lab/compare_runs.py basket-v-01 --b edgetam-torch-fp16-roi40f0s30 --label-b "1 passada suave" --tag 1v2-suave
```

Videos: `lab/tests/framing/<clip>.compare-1v2.mp4` (and `basket-v-01.compare-1v2-suave.mp4`).

Tracks: `lab/tests/oneclick/<clip>.ball.edgetam-torch-fp16-roi40f*.json` (with the crops per frame); reports
`lab/tests/single/report.test12*.md`. Box seeds go to the decoder as SAM's box prompt (labels 2, 3).

### Test 11: FocusBench on the iPhones (2026-11-04) — `ios-bench/`, `ios_bench.py`

FocusBench is a separate test app (its own Xcode project and bundle id, nothing shared with Lance's code). It runs
the four Core ML models of test 10 with the same loop as `coreml_export.py`'s `track` (bank in fp16, empty slots
switched off), Swift only, on the ROI crops of yt-basket-04, bt-wa-1028 and yt-bt-06, and writes one JSON per clip and
compute unit: ms per model (median after 3 warm-up calls), image prep, Swift loop, first model load, thermal state,
and the track (per frame the same mask summary as `server.py`, on the mask upsampled to the crop as on the Mac).

1. Mac: `lab/.venv-edgetam/bin/python tools/lab/ios_bench.py prepare` (models + frames into
   `ios-bench/FocusBench/Data/`, about 120 MB, not in git).
2. Open `tools/lab/ios-bench/FocusBench.xcodeproj` (Xcode 16 or later). Target FocusBench > Signing & Capabilities:
   pick your Team (a personal team works; change the bundle id if Xcode says it is taken). Plug the iPhone in, pick it
   as the run destination, Run. First time on a phone: Developer Mode on, and trust the developer in Settings >
   General > VPN & Device Management.
3. On the phone: pick clips and compute units, Run (keep the app open; the screen stays on). The first Neural Engine
   load compiles the models (seconds to a minute), later loads are cached.
4. Share results (AirDrop to the Mac), or Files > On My iPhone > FocusBench. Put the .json files in
   `lab/tests/ios/` and run `lab/.venv-edgetam/bin/python tools/lab/ios_bench.py results`: a table per phone, compute
   unit and clip (ms per model, ball mode, hits, agreement with the Mac's Core ML track), and each track saved as a
   oneclick track `edgetam-ios-<device>-<units>-roi40b` for `hybrid.py --render`.

The mask summary in Swift was checked against `server.py`'s on random masks (same pixels after upsampling).

Results (2026-11-04, both phones on the cable, run from Xcode; `attention_pairs_soft`, which is now the default):

| | iPhone 16 Pro Max (iPhone17,2, iOS 27.0.1) | iPhone XR (iPhone11,8, iOS 18.7.11) |
|---|---|---|
| compute units | all four on the Neural Engine | encoder Neural Engine, attention / decoder / memory GPU |
| encoder / attention / decoder / memory, ms | 18 / 38 / 4 / 6 | 60 / 335 / 84 / 95 (whole clip; 59 / 243 / 68 / 65 in the first 50 frames) |
| image prep + Swift loop, ms | 28 + ~27 | 16 + ~60 |
| per frame (10 fps track), median | **122 ms** | **552 ms** first 50 frames, **691 ms** whole clip |
| 30 s clip (300 frames) | 37 s | 216 s |
| thermal | nominal → fair | fair → serious (slows the GPU) |
| track vs the Mac's Core ML track (centroid median, frames where only one sees a ball) | yt-basket-04 0.1 px, 1; yt-bt-06 0.1 px, 1; bt-wa-1028 0.2 px, 19 | yt-basket-04 0.1 px, 2 |
| ball mode (round 6), bt-wa-1028 | 79% (Mac Neural Engine 79%, EdgeTAM 74%) | — |

What the XR (A12) needed, from the probe (each model alone): its Neural Engine cannot run the attention (1.6–2.6 s,
mostly on the CPU; a 4-block version ran its compiler out of memory) and runs the memory model badly (0.4–0.5 s); its
GPU aborted the app on Core ML's fused attention kernel (`sdpa_fwdNew`, fixed by spelling out the softmax), refused
the RoPE-on-halves rewrite in fp16 (error -5) and a 0/1 matrix product (blob type mismatch). The 16 Pro Max runs
everything on the Neural Engine; its GPU fails the decoder (not used).

Soak test (2026-11-04, `Soak.swift`): the ticked clips back to back for N minutes, as the app would after a game, on
battery; one row per clip with time, battery (1% steps) and heat, saved after every clip as
`soak.<people|ball>.<device>.<time>.json`. `people` = today's Modo Foco analysis (FocusAnalyzer's reading, Vision on the
whole frame + 9 tiles, 10 fps); `ball` = Foco na Bola, pass 1 on the whole frame and pass 2 on the roi40b crops, both read
from the clip's video with AVAssetReader (pass 2 compared with the Mac's track). `ios_bench.py prepare` now also writes
each clip's window as `<clip>.mp4`; `ios_bench.py results` adds a soak table. Same phone, unplugged, Low Power Mode off,
the same brightness for both runs.

Soak results (2026-11-04, iPhone 16 Pro Max, 30 min each, unplugged, brightness 50%, Low Power Mode off, the same
3 clips in a loop; `ball` with all four models on the Neural Engine, `attention_pairs_soft`):

| | Foco na Bola (2 passes) | Modo Foco today (people) |
|---|---|---|
| clips processed in 30 min | 22 (591 s of video) | 136 (3634 s of video) |
| processing time / video time | **3.1x** (30 s clip: 91 s; 45 s per pass, ~150 ms per frame per pass) | **0.5x** (30 s clip: 15 s) |
| battery (iOS reports 5% steps) | 65 → 55% | 65 → 60% (the screen, on in both, is part of it) |
| per 30 s clip | ~0.45% | ~0.04% |
| heat | nominal throughout; the last clips 5–7% slower | nominal throughout |
| pass 2 vs the Mac's track (centroid median / frames where only one sees a ball) | yt-basket-04 1.2 px / 12; yt-bt-06 11.8 px / 35; bt-wa-1028 124 px / 60 | — |

Two open points: (1) a pass costs ~150 ms per frame here vs the 66 ms of the models: video decoding (every frame of
the source is decoded), Core Image scaling and the bench's array copies; (2) reading the video (frame choice at each
100 ms tick, H.264 re-encode, Core Image scaling) instead of the Mac's JPEG crops changes pass 2 on the hard clips
(bt-wa-1028 tracks something else much of the time): the phone's own track must be judged (ball mode), not only
compared with the Mac's.

Optimised soak (2026-11-04, same phone and settings, 15 min): the video read in the decoder's own format (Core Image
converts only the 100 ms ticks) and the model outputs passed on with no array copies (bank kept as the memory model's
float32 outputs, attention inputs preallocated and filled with memcpy). **30 s clip: 91 → 52 s (1.7x the clip
length)**; per frame and pass 84 ms = models 74 (encoder 20, attention 39, decoder 6, memory 9) + image 4 + mask
summary 6 + loop 0.1. 20 clips in 15 min, battery 75 → 70%. Heat: nominal → fair after 5 min → **serious after 13 min**
of non-stop work (the slower run stayed nominal for 30 min). Pass 2 vs the Mac unchanged (same numbers as above), so the
float32 bank changes nothing and the difference on bt-wa-1028 comes from the frames read from the video.

One-pass soak (2026-11-04, same phone and settings, 15 min; `ball1` = test 12's roi40f in Swift, the crop following
the ball): **30 s clip ~27 s** (0.9x the clip length; 84–89 ms per frame), 38 clips in 15 min, battery 70 → 60%;
heat fair after 7 min, **serious after 11 min** of non-stop work (the Neural Engine is busy all the time in both
versions, so the heat per minute is the same and the heat per clip halves). Track vs the Mac's one-pass track:
yt-basket-04 1.7 px / 9 frames, yt-bt-06 15 px / 43, bt-wa-1028 330 px / 50 (it follows something else: with one pass
a small difference moves the crop and the track drifts further). Victor (2026-11-04): neither ball version is ready for
production; today's Modo Foco ships; next, a faster "broadcast" camera from the players alone at today's cost
(`handoff-players-camera.md`), and later a light ball detector (YOLOX, Apache-2.0) as a reinforcement. Heat can be
traded for time (pausing between frames keeps the Neural Engine idle part of the time, as the first 91 s version did).

To test next (Victor, 2026-11-04): one pass instead of two, with crops guided by the players only or by the previous
frame's ball (spec section 10, item 5).

Not tuned yet: the Swift glue (copies between models, ~27 ms on the 16 Pro Max, ~60–90 ms on the XR) and the image
prep (JPEG decode + scale; in the app the frames come from the camera or the video decoder).

### Test 10: EdgeTAM on Core ML, step 1 (2026-11-03) — `loop.py`, `coreml_export.py`, `coreml-mac.sh`

On the phone the tracker is four Core ML models and a loop in Swift that keeps the memory bank. Core ML wants fixed
shapes, so the bank always has 7 memory frames and 16 object pointers; slots with nothing yet (just after the click,
at the clip's edges) are switched off in the attention. Quality is judged as in the framing tests: share of the clip
in ball mode (round 6) and, on the labelled clips, hits on the ball. Each run is also saved as a oneclick track
(`edgetam-<run>-roi40b`), so `hybrid.py --model ... --render` makes its framing video.

| Step | Where | Result |
|---|---|---|
| `loop.py`: EdgeTAM driven frame by frame (`parts`) and with the full fixed bank (`fixed`), vs the predictor | container, CPU, bt-wa-1028@roi40b, 50 frames | parts: IoU 1.0, 0 px; fixed: IoU mean 0.95, centroid median 0.07 px, max 0.71 px, 1 frame where only one of them sees the ball |
| `coreml_export.py export`: wrappers (RoPE with real numbers, constants baked in) vs EdgeTAM's own code | container | max abs difference 0 on every part |
| conversion to Core ML (FP16, iOS 16 target) | container | encoder 10.0 MB, attention 12.5 MB, decoder 13.1 MB, memory 4.5 MB |
| the Swift-like loop (`track`) on the PyTorch wrappers, whole clip (201 frames) | container | empty slots filled (`--fill`, as loop.py): ball mode **60%** vs EdgeTAM's 74%, mask = EdgeTAM's 66%. Empty slots switched off (attention inputs `mem_on`, `ptr_on`): ball mode **74%**, mask = EdgeTAM's **100%**, also with the bank kept in fp16 |
| the same loop on the Core ML models (FP16), quality and ms per model | Mac (2026-11-04), 4 clips | **done: same quality as EdgeTAM on every compute unit** (below) |

Mac results, ball mode share (round 6) and, on labelled clips, hits on the ball (`lab/tests/coreml/<clip>@roi40b/`):

| Clip | EdgeTAM (PyTorch) | Core ML CPU | GPU | Neural Engine | all |
|---|---|---|---|---|---|
| yt-basket-04 (labels) | 100%, 98% on the ball | 100%, 98% | 100%, 98% | 100%, 98% | 100%, 98% |
| bt-E5003B6B (labels) | 9%, 25% | 7%, 22% | 25%, 25% | 20%, 25% | 7%, 22% |
| bt-wa-1028 | 74% | 74% | 74% | 79% | 74% |
| yt-bt-06 | 84% | 86% | 84% | 82% | 90% |

Masks match EdgeTAM's 91–99% where the tracker is sure (yt-basket-04, yt-bt-06); on hard clips small FP16 differences
send the track elsewhere for a while, in both directions (bt-wa-1028: Neural Engine 79% vs 74%), without a pattern of
loss. bt-E5003B6B (far ball, ROI guided by a weak first pass) is poor for EdgeTAM itself.

Time per frame on the Mac (all four models; steady state, after the first calls): CPU 97 ms, GPU 35 ms, Neural Engine
45 ms (encoder 11.6, attention 25.5, decoder 3.4, memory 5.0), all 56 ms. Neural Engine load (compile) 5 s once. The
"ANECCompile() FAILED" line printed while converting comes from coremltools' own test load and did not stop any
model from running on the Neural Engine. The first run crashed (segfault) with the earlier attention model; with
the current models nothing crashed.

The framing video from a Core ML track: `lab/.venv/bin/python tools/lab/hybrid.py --model
edgetam-coreml-ne-fp16-roi40b --tag v6-coreml --render bt-wa-1028 yt-bt-06`.

The clicked frame skips the attention model (its features + `no_mem_embed`, in `lab/coreml/edgetam_constants.json`);
its memory is made from the binarised mask (`hard` = 1), as the video predictor does. Box seeds are not exported yet
(the decoder takes 2 prompt points: the click and a pad).

### Test 9: cleaner masks and round 6 (2026-11-03) — `hybrid.py` default

Two problems found on the ROI runs: (1) EdgeTAM's masks on the full-resolution crops carried stray specks far from the
ball (a 13x15 px ball inside a 300x390 px box), so the shape filters dropped correct balls: `summarize` now keeps the
largest connected piece and records its share (`main`, 8th field). (2) On basket-v-01 the ROI track slid onto other
objects after a short gap and was trusted. Round 6, every sport: a mask whose largest piece is < 70% of it is not the
ball; the jump allowed after a gap stops growing at 8 frames (4 cut real volleyball serves); a gap is bridged only if
the ball comes back near where it was lost. SAM 2 tiny results are identical to round 5.

Ball in crop (labelled clips) / ball mode, round 6, EdgeTAM re-run with the cleaner masks:

| Clip | SAM 2 tiny | EdgeTAM full frame | EdgeTAM ROI 40% (ball-guided) |
|---|---|---|---|
| bt-wa-1028 | — / 61% | — / 20% | — / **74%** |
| yt-basket-04 | 100% / 100% | 100% / 90% | **100% / 100%** |
| yt-bt-06 | — / 97% | — / 90% | — / 84% |
| bt-E5003B6B | 100% / 15% | 94% / 15% | 94% / 9% |
| basket-v-01 | 100% / 15% | 92% / 11% | **100%** / 11% |
| bt-0AE39B33 | 80% / 17% | 80% / 21% | 80% / 14% |
| volei-app-1102 | — / 82% | — / 71% | — / 65% |
| basket-app-1031-a / -b | — / 100% / 99% | — / 100% / 100% | — / 100% / 100% |

One-click recall (raw masks): yt-basket-04 97% (tiny) / 81% (EdgeTAM) / 98% (ROI 40%); bt-0AE39B33 67 / 53 / 70%.
Cost: two EdgeTAM passes ≈ 70 s per 30 s of video on the Mac, vs ≈ 170 s for one SAM 2 tiny pass.

### Test 8: EdgeTAM at 20/30 fps, and on a closer picture (ROI) (2026-11-03)

More frames: no gain. At 30 fps (aligned exactly to the 10 fps frames: their match is frame 3k+1, measured by image
difference and stored as `alignTo10`) EdgeTAM scores as at 10 fps (bt-E5003B6B 22%, basket-v-01 21%) for 3x the
time; 20 fps cannot align exactly (17 ms off, and bt-wa-1028 is a 30 fps source) and is not trusted.

Closer picture (`roi.py` + `oneclick.py --variant`): EdgeTAM on a square crop cut from the full-resolution video,
following the ball of a first full-frame EdgeTAM pass (bridged gaps) or, without it, today's framing; masks mapped
back to the whole frame; same round-5 hybrid. Same cost per pass (~34 s per 30 s on the Mac), two passes in total.

| Clip | Full frame | ROI 50% ball-guided | ROI 40% ball-guided | ROI 40% players only | SAM 2 tiny |
|---|---|---|---|---|---|
| bt-wa-1028: ball mode | 20% | 56% | **74%** | 0% | 61% |
| bt-E5003B6B: one-click recall | 22% | **41%** | 25% | 16% | 69% |
| bt-E5003B6B: hybrid ball in crop | 94% | 84% | 78% | 78% | 100% |
| basket-v-01: one-click recall | 21% | 21% | **33%** | 17% | 67% |
| basket-v-01: hybrid ball in crop | 92% | 92% | 100% | 100% | 100% |

The ball-guided ROI is what makes the difference (players-only fails on lobs). On bt-wa-1028 the 40% ROI follows the
ball longer than SAM 2 tiny on the whole frame, with no racket confusion (5–14 s); on bt-E5003B6B it finds the ball
more but also claims it more where it is not (false alarms 12–54%), and the ball in crop drops.

### Test 7: EdgeTAM vs SAM 2.1 tiny (2026-11-03, same seeds, same round-5 hybrid; Mac, MPS)

EdgeTAM (facebookresearch/EdgeTAM @7711e01, Apache-2.0; `setup-edgetam.sh`, `oneclick.py --model edgetam`).

| Clip | One click recall: tiny → EdgeTAM | precision | Hybrid ball in crop | Ball mode | Mac time per clip |
|---|---|---|---|---|---|
| bt-0AE39B33 | 67% → 53% | 80% → 100% | 80% → 80% | 17% → 19% | 209 → 35 s |
| bt-E5003B6B | 69% → 22% | 71% → 70% | 100% → 94% | 15% → 6% | 176 → 34 s |
| basket-v-01 | 67% → 21% | 70% → 23% | 100% → 92% | 15% → 11% | 171 → 34 s |
| yt-basket-04 | 97% → 81% | 99% → 91% | 100% → 100% | 100% → 89% | 167 → 34 s |
| yt-bt-06 | — | — | — | 97% → 90% | 170 → 35 s |
| bt-wa-1028 | — | — | — | 61% → 20% | 124 → 23 s |
| volei-app-1102 | — | — | — | 82% → 71% | 118 → 23 s |
| basket-app-1031-a / -b | — | — | — | 100% / 99% → same | 38 / 74 → 8 / 15 s |

EdgeTAM is ~5x faster on the Mac (~9 frames/s at 10 fps sampling: 30 s of video in ~35 s) and holds the easy clips
(big, clear ball: the YouTube references, the app basketball exports), but loses the ball far more on the hard ones
(small far ball, beach tennis at night, the vertical basketball clip). The hybrid falls back to the players there, so
the crop stays safe; the cost is less time framed on the ball. The official Core ML export covers only the image path
(image encoder, prompt encoder, mask decoder); the video memory modules are not exported.

### Test 6 on three app exports (volleyball, 2 basketball; 2026-11-03)

These arrived with today's Modo Foco already applied (the originals were not at hand), so "today" = the video itself
(identity framing) and the hybrid adds `--set ball_zoom=1.25` (~2x overall, like round 5). The round-5 filters now
also cover volleyball (ball only held between rallies; heads look like balls). New for every sport, from the
basketball clips (SAM 2's mask spilled onto a player at 6.6 s, 7.0 s, 9.6 s): a mask whose box is over 6% of the
frame's long side, or that fills under 45% of its box, is not the ball. The approved clips do not change
(yt-basket-04: ball in crop 100%, ball mode 100%).

| Clip | SAM 2 masks / frames | Trusted | Ball mode |
|---|---|---|---|
| volei-app-1102 | 119 / 207 | 109 | 82% (lost from 15 s) |
| basket-app-1031-a | 60 / 70 | 55 | 100% |
| basket-app-1031-b | 128 / 134 | 103 | 99% |

### Test 1 result (2026-11-03, SAM 2.1 tiny on the Mac GPU, 4 clips, 187 ball points)

Seed = the first click Victor made when labelling (a point on the ball). "With fixes" simulates a user who clicks the
true position at the first missed sample and lets SAM 2 go on (forward from the seed only).

| Clip | Points | One click: recall | precision | false alarm | follows until 1st miss | With fixes: clicks | per 10 points |
|---|---|---|---|---|---|---|---|
| bt-0AE39B33 | 30 | 67% | 80% | 62% | 1.8 s | 11 | 3.7 |
| bt-E5003B6B | 32 | 69% | 71% | 41% | 9.4 s | 11 | 3.4 |
| basket-v-01 | 24 | 67% | 70% | 11% | 1.8 s | 9 | 3.8 |
| yt-basket-04 | 101 | 97% | 99% | 43% | 3.8 s | 4 | 0.4 |

- Far above tests 3 and 4 (0–37% recall): SAM 2 loses the ball and finds it again by itself (its memory), so recall
  stays at 67–97% even when the first miss comes early.
- False alarms are high when the ball is out of play (41–62% beach tennis, 43% YouTube basketball): SAM 2 keeps a
  mask on something (another ball, a player). A framing built on it needs a guard (mask size jumps, players' area).
- Cost: ~170–210 s per 30 s clip on the Mac (tiny, MPS), i.e. ~6x slower than real time on the Mac. SAM 2 itself is
  not an on-device option; EdgeTAM (Apache-2.0, SAM 2 distilled for phones, 16 fps on an iPhone 15 Pro Max) is the
  candidate to repeat this test with.
- The seed is a human click here. In the app it could be a tap in the editor, or a detector that only has to find the
  ball once with high confidence (low recall is fine for a seed).

### Test 3 result (2026-11-03, 4 clips, 187 ball points)

Vision on the Mac, every frame (60 fps app clips, 30 fps YouTube), radius 0.002–0.06, trajectory length 5; ~8 s per
30 s clip. Candidates = the newest point of every trajectory Vision reports at the tick's frame. VNVideoProcessor
already gives points in the upright picture: the "raw" mapping (Vision's point, y flipped) is the right one; applying
the track transform again rotates them twice (the "upright" column of the script equals raw on unrotated video).

| Clip | Points | Trajectories/frame | Ceiling | Longest trajectory: recall | precision | false alarm | Track: recall |
|---|---|---|---|---|---|---|---|
| bt-0AE39B33 | 30 | 16.9 | 30% | 13% | 15% | 55% | 17% |
| bt-E5003B6B | 32 | 22.4 | 28% | 19% | 21% | 45% | 3% |
| basket-v-01 | 24 | 2.3 | 25% | 0% | 0% | 10% | 0% |
| yt-basket-04 | 101 | 44.4 | 41% | 11% | 11% | 98% | 2% |

Vision has the ball in under half of the samples, among 2–44 other "trajectories" (arms, rackets, legs); neither the
longest one nor the chain search picks it. Not a ball source on its own.

### Test 4 result (2026-11-03, 4 clips, 187 ball points)

MOG2 background subtraction at 30 fps, 960 px; candidates = small compact moving blobs seen in 3 consecutive frames on
a near-straight line and alone (kicked sand comes as a crowd); offline chain search. Without the 3-frame and crowd
filters: 6–63 candidates per frame (sand, net, compression noise), the chosen track 3–4% right.

| Clip | Points | Ceiling (any candidate on the ball) | Cands/frame | Track recall | Precision | False alarm |
|---|---|---|---|---|---|---|
| bt-0AE39B33 | 30 | 53% | 4.9 | 37% | 44% | 85% |
| bt-E5003B6B | 32 | 41% | 4.0 | 0% | 0% | 60% |
| basket-v-01 | 24 | 17% | 0.9 | 17% | 18% | 17% |
| yt-basket-04 | 101 | 39% | 3.5 | 24% | 28% | 86% |

The ball is among the candidates at most half the time (in hands, against bright walls, too small at the far end) and
what moves like a ball (feet, hands, rackets) wins the track. Not worth tuning further; kept as a baseline.

Earlier rounds (git history, commit `45e5317`, `docs/superpowers/spikes/focus-v2/`): COCO detectors, WASB and
TrackNetV3 were already measured; ball framing lost to players framing on basketball, won on tennis and volleyball, and
nothing found the beach tennis ball. Their labels (`*.ball.json`) were lost: they never went to git. This round keeps
the labels in `docs/focus-refs/labels/`, which is allow-listed in `docs/focus-refs/.gitignore`.

## Files

| Path (under `docs/focus-refs/`) | What | In git |
|---|---|---|
| `tools/lab/clips.txt` | the 18 clips, window and sport, in labelling order | yes |
| `tools/lab/extract.sh` | frames every 100 ms, long side 1280 px → `lab/frames/<clip>/` | yes |
| `tools/lab/setup-mac.sh` | one-time env on the Mac: PyTorch (MPS) + SAM 2.1 from Meta's repo + checkpoints | yes |
| `tools/lab/server.py`, `index.html` | labelling page with SAM 2 assist, http://127.0.0.1:8765 | yes |
| `labels/<clip>.ball.json`, `labels/<clip>.person.json` | the ground truth (format in `server.py`'s docstring) | **yes** |
| `tools/lab/loop.py`, `coreml_export.py`, `coreml-mac.sh` | test 10: EdgeTAM in parts, Core ML export and Mac check | yes |
| `tools/lab/single_pass.py` | test 12: one pass with the crop following the ball; `report` scores tracks side by side | yes |
| `tools/lab/broadcast.py`, `tools/lab/flow-probe.swift` | test 13: broadcast-camera variants (scores, renders, OpenCV flow) and the Vision optical-flow probe (Mac) | yes |
| `tools/lab/low_fps.py`, `tools/lab/mac-lowfps.sh` | test 14: Foco na Bola at 5 fps (frames, simulation, report; the Mac run) | yes |
| `tools/lab/ball_detect.py`, `ball_track.py`, `det_report.py`, `ball_train.py` | tests 17–18: per-frame ball detector (YOLOX ONNX), ball path, report, fine-tuning | yes |
| `lab/tests/detect/`, `lab/train/` | test 17 detections and reports; test 18 crops (regenerable by `ball_train.py dataset`) | no |
| `tools/lab/ball_train_pub.py`, `hard_neg.py`, `pseudo_label.py`, `path_diag.py`, `story.py`, `yolox_coreml.py`, `frame_sync.py`, `label_sync.py`, `report_mean.py` | tests 28–38: basketball detector training (public data, "not a ball" crops, automatic labels), where the path loses the ball, the 9:16 story export, Core ML for FocusBench, label/frame timing checks, report means | yes |
| `tools/lab/sport_classify.swift`, `sport_report.py` | test 43: Apple's scene classifier on 3 frames per clip (run on a Mac) and the report with the detector's signal | yes |
| `lab/tests/sport/` | test 43 results | no |
| `tools/lab/ball_parity.py` | Seguir a Bola: parity fixtures for the Swift port (`ReplayCore` `BallParityTests`) | yes |
| `tools/lab/handoff-test-39.md` | the state after test 38 and the plan for test 39, for a new session | yes |
| `tools/lab/ball_gate.py` | test 15: per-clip signals and the proposed rule for offering the ball framing | yes |
| `lab/tests/gate/` | test 15 reports | no |
| `lab/tests/lowfps/` | test 14 reports | no |
| `lab/tests/broadcast/` | test 13 scores, framings, flow files and videos | no |
| `tools/lab/compare_runs.py` | test 12: one video with two ball tracks framed side by side (default: two passes vs one) | yes |
| `lab/tests/single/`, `lab/cache/` | test 12 reports; full-resolution frames while a clip runs (deleted after) | no |
| `tools/lab/ios-bench/`, `tools/lab/ios_bench.py` | test 11: the FocusBench test app and its data/results script | yes (not `ios-bench/FocusBench/Data/`) |
| `lab/tests/ios/` | the phones' result files | no |
| `lab/coreml/`, `lab/tests/coreml/` | the exported .mlpackage models and the check results | no |
| `lab/` | frames, Python env, checkpoints, SAM 2 cache | no |

## Use

```bash
cd docs/focus-refs
bash tools/lab/setup-mac.sh                 # once (~5 min; downloads PyTorch, SAM 2, the tiny checkpoint)
lab/.venv/bin/python tools/lab/server.py    # opens the page in the browser
```

Labelling a clip (ball): find a frame where the ball shows, click it (or drag a small box around it). SAM 2 follows it
through the whole clip (status chip top right); then go through the samples (every 200 ms) with **Enter** where the
lime ring is on the ball, **click** where it is wrong (the click becomes a new SAM 2 prompt and the rest of the clip
is redone in the background), **O** when the ball is out of play, **N** when it is in play but hidden. Shift+click on
something SAM 2 confused with the ball marks it "not this". **Space** plays the clip with the proposals, to spot
where SAM 2 got lost. Labels save on every key.

Person: drag a box around the chosen player once; SAM 2 follows; Enter / fix the same way. One player per clip on a
subset is enough for test 2.

The page records whether each label is an accepted SAM 2 proposal or a human click (`src`), and every prompt in
order: test 1 replays only the first prompt to measure SAM 2 on its own, and the number of clicks per clip is itself a
result.

`--model tiny | small | base_plus` picks the SAM 2.1 size (default tiny; `setup-mac.sh small` downloads another). A click recomputes only from the clicked frame on, and a newer click stops a running pass; `--backend none` runs the page without a
model (the proposal is the last click).

## Regenerate (what was deleted on 2026-11-05 and 2026-11-06)

Deleted to free space, all remade by the tools (run from `docs/focus-refs`):

| Deleted | Remake with |
|---|---|
| `lab/frames/<clip>/` (10 fps JPEGs) | `bash tools/lab/extract.sh [clip ...]` (clips.txt windows) |
| `lab/frames/<clip>@5`, `@3`, `@2` | `python3 tools/lab/low_fps.py frames --step 2/3/4 <clip ...>` |
| `lab/frames/<clip>@roi40b`, `@roi40b5`, ... (pass-2 crops) | `roi.py <clip ...> --first <pass-1 tag> [--step 2]` (needs the pass-1 track) |
| comparison videos (`lab/tests/framing/*.mp4`, `lab/tests/broadcast/*.mp4`, old `renders/*.mp4`) | `hybrid.py --model <tag> --render`, `compare_runs.py`, `broadcast.py render` |
| `tools/lab/ios-bench/FocusBench/Data/` | `lab/.venv-edgetam/bin/python tools/lab/ios_bench.py prepare` |
| `lab/_to_delete/`, `lab/cache/` | scratch, nothing to remake |
| `lab/coreml/yolox_nano.mlpackage`, `yolox_tiny`, `yolox_s` | YOLOX release 0.1.1rc0 `.pth` into `lab/models/`, then `yolox_coreml.py --yolox <YOLOX source, PyPI sdist yolox-0.3.0> --name nano/tiny/s` (needs coremltools + torch) |
| `lab/coreml/edgetam_attention_halves_soft*`, `_v1*` | `EXPORT=1 bash tools/lab/coreml-mac.sh` with the attention `--variants` (test 11) |
| test 19 variant detections (`lab/tests/detect/*.yolox-s-r*`, `-a*`, `-g*`, `tiny-t5`, `nano-t5`, ...) | `ball_detect.py` (+ `--tile`, `--no-tiles`) and `roi_tiles.py` with the flags in test 19 |

Kept (not deleted): `lab/.venv`, `lab/.venv-edgetam`, `lab/models/`, `lab/coreml/` (if removed later: `setup-mac.sh`,
`setup-edgetam.sh`, `coreml_export.py export`); `lab/tests/**/*.json` and `*.md` (tracks, framings, reports: every number in this README), `renders/**/*.people.json`
(Vision people per clip; remade by `tools/vision-probe.swift` on the Mac), the source videos.

### Test 20 result (2026-11-06) — YOLOv8n per frame + Savitzky-Golay + 9:16 crop (`yolo_reframe_test.py`)

The proposed script as written writes an empty file on 1920x1080 video (its fixed 1080x1920 crop does not fit in a
1080-high frame, OpenCV drops every frame) and keeps every frame in RAM (killed at ~7 GB on a 20 s 1080p60 clip). Run
with the crop at 9:16 of the source height and a second read of the video for the render; otherwise as proposed.
11 horizontal labelled clips; "ball in crop" against a fixed centred 9:16 crop (no tracking).

| Clip | Frames with a detection | Detection on the labelled ball | Ball in 9:16 crop | Fixed centre crop |
|---|---|---|---|---|
| basket-rp-1105-h | 0% | 0% | 88% | 88% |
| bt-rz-1105-a | 73% | 1% | 32% | 70% |
| bt-rz-1105-b | 95% | 5% | 36% | 71% |
| yt-basket-04 | 5% | 8% | 83% | 57% |
| yt1105-basket-a | 14% | 9% | 56% | 39% |
| yt1105-basket-b | 4% | 2% | 57% | 53% |
| yt1105-bt | 2% | 2% | 41% | 56% |
| yt1105-futevolei | 33% | 0% | 52% | 57% |
| yt1105-volei-a | 40% | 11% | 84% | 28% |
| yt1105-volei-b | 22% | 22% | 92% | 55% |
| yt1105-voleipraia | 11% | 0% | 62% | 84% |
| **mean** | | **6%** | **62%** | **60%** |

YOLOv8n finds the real ball in 6% of the labelled samples; most detections are static round things (on the night beach
tennis clips two lamps/signs behind the court, `lab/tests/yolo-reframe/bt-rz-1105-b.detections.jpg`), so the crop
follows them and loses the play. With no ball found the crop sits still where it last was. Wins only on the YouTube
volleyball/basketball, where the big ball is often seen. 75–120 ms/frame on CPU. Same conclusion as test 17 (a COCO
detector alone, here a smaller one without tiles or a path): not usable as the camera signal. Videos and scores:
`lab/tests/yolo-reframe/`.

### Test 21 result (2026-11-06) — offline Savitzky-Golay 9:16 framing per ball engine (`sg_framing.py`)

Same 11 horizontal labelled clips as test 20; crop = 9:16 of the full height (today's portrait crop size); the engines'
existing tracks (`lab/tests/oneclick/`), kept where `hybrid.trusted` accepts them; gaps up to 1 s bridged by a straight
line; longer gaps -> today's portrait centre ("players") or the last ball ("hold"); centred Savitzky-Golay, order 2.
Means (full table and per clip: `lab/tests/sg/summary.md`):

| Engine | Ball in crop | Speed p95 (widths/s) | Direction changes /10 s |
|---|---|---|---|
| today's portrait Modo Foco | 61% | 0.06 | 2.3 |
| fixed centre | 60% | 0 | 0 |
| YOLOv8n script (test 20) | 62% | — | — |
| YOLOX-Tiny cheap tiles, no tap, players, 1.5 s | 73% | 0.20 | 4.1 |
| YOLOX-S + tiles, no tap, players, 1.5 s | 82% | 0.31 | 5.7 |
| EdgeTAM 1 tap (Foco na Bola), hold, 1.0 s | 93% | 0.35 | 5.7 |
| YOLOX-S + EdgeTAM, hold, 1.0 s | 94% | 0.36 | 6.0 |
| hand labels (ceiling), hold, 1.0 s | 99% | 0.38 | 4.8 |

- The window (0.5–1.5 s) barely changes ball in crop and lowers speed and flips: 1.0–1.5 s is free smoothness.
- With the tap engines, "hold" beats "players" (93–95% vs 87–91%): between points the ball is near where it was.
- Today's portrait framing is no better than a fixed centre at keeping the ball (players-only framing, test 16 note).
- yt1105-bt stays ~50% for every engine (no engine tracks that ball); basket-rp-1105-h only with EdgeTAM.
- Caveat: in-sample for the app clips (the trust filter and the mix were tuned on them); the yt1105 clips are validation.
- More movement than today (even the labels' ceiling flips 4.8 per 10 s): judge on video. Side-by-side videos (today |
  YOLOX-S players 1.5 s | YOLOX-S + EdgeTAM hold 1.0 s): `lab/tests/sg/<clip>.compare.mp4` for bt-rz-1105-b,
  yt1105-basket-a, yt1105-volei-a, basket-rp-1105-h.

### Test 22 result (2026-11-06) — dead zone + smoothest path (`sg_lazy.py`)

Victor on test 21's videos: the camera looked uncontrolled and abrupt. Here the crop centre minimises (ball outside a
central band of +-dz crop widths)^2 + a (speed)^2 + b (acceleration)^2, offline (active-set least squares); target as
test 21 with fallback "hold" (weight 0.2 on fallback frames). Grid dz 0.10/0.20/0.30, a 1/10, b 100/1000/10000:
`lab/tests/sg/lazy-summary.md`. Picked dz 0.20, a 10, b 1000:

| Engine | Ball in crop | Speed p95 (widths/s) | Direction changes /10 s |
|---|---|---|---|
| today's portrait Modo Foco | 61% | 0.06 | 2.3 |
| YOLOX-S + tiles, no tap | 81% | 0.08 | 0.8 |
| YOLOX-S + EdgeTAM, 1 tap | 92% | 0.09 | 1.1 |

Ball in crop costs 1–2 points vs test 21 while the camera moves about as fast as today's and changes direction less.
b = 10000 is calmer still (0.7 flips) for ~2–4 points less. Videos (today | no tap | 1 tap):
`lab/tests/sg/<clip>.lazy.mp4` for bt-rz-1105-b, yt1105-basket-a, yt1105-volei-a, basket-rp-1105-h.

**Verdict (Victor, 2026-11-06): very good on video, especially "1 toque - zona 0.20" (YOLOX-S + EdgeTAM, dz 0.20,
a 10, b 1000): the version to take forward. No tap loses the ball at times.** Same camera on the cheaper 1-tap engines
(`lazy-summary-cheap.md`): EdgeTAM alone (edgetam-fuse5, 26.7 s per 30 s clip on the 16 Pro Max) 89% / 1.3 flips;
YOLOX-Tiny cheap tiles + EdgeTAM (mix-tiny-n-a3k2, phone cost not measured) 91% / 1.5; YOLOX-S all tiles + EdgeTAM
(80.3 s; 58.4 s with test 19's two stages) 92% / 1.1.

### Test 23 result (2026-11-06) — the calm 1-tap camera on the app clips (`sg_lazy2.py`)

Test 22's camera (dz 0.20, a 10, b 1000, fallback hold) on the 9 labelled app clips. Crop size per frame = today's
portrait Modo Foco crop (vertical sources keep today's zoom); the lazy path runs on x and on y. Ball in crop counts both.
| Clip | Source | Labels | Ball in crop: today | EdgeTAM alone | YOLOX-S + EdgeTAM | Direction changes /10 s: today | EdgeTAM | mix |
|---|---|---|---|---|---|---|---|---|
| bt-rz-1105-a | horizontal | 73 | 55% | 93% | 97% | 3.2 | 2.1 | 1.1 |
| bt-rz-1105-b | horizontal | 73 | 44% | 88% | 96% | 2.5 | 1.0 | 1.0 |
| basket-rp-1105-h | horizontal | 25 | 72% | 100% | 100% | 0.0 | 0.0 | 0.0 |
| bt-rz-1105-v | vertical | 54 | 100% | 100% | 94% | 1.4 | 0.0 | 0.0 |
| bt-0AE39B33 | vertical | 30 | 63% | 100% | 97% | 3.3 | 0.3 | 1.3 |
| bt-E5003B6B | vertical | 32 | 78% | 91% | 100% | 4.3 | 3.0 | 3.3 |
| basket-v-01 | vertical | 24 | 100% | 100% | 100% | 0.0 | 0.0 | 0.0 |
| basket-rp-1105-v-a | vertical | 109 | 100% | 100% | 100% | 2.9 | 1.7 | 1.7 |
| basket-rp-1105-v-b | vertical | 57 | 100% | 100% | 100% | 0.7 | 0.7 | 0.7 |
| **mean** | | | 79% | 97% | 98% | 2.0 | 1.0 | 1.0 |

Same quality for both engines (the mix wins on night beach tennis bt-rz-1105-b, loses on bt-rz-1105-v where the detector
took something else); EdgeTAM alone is 2–3x cheaper on the phone (26.7 s vs 58–80 s per 30 s clip). Vertical clips:
today's zoomed framing already keeps the ball on most; the gain is on horizontal clips and beach tennis. Videos (today |
EdgeTAM alone | YOLOX-S + EdgeTAM): `lab/tests/sg/<clip>.lazy2.mp4` for bt-0AE39B33, bt-E5003B6B, bt-rz-1105-a,
basket-rp-1105-v-a, basket-rp-1105-v-b.

### Test 24 result (2026-11-06) — y at the players' height, native orientation (`sg_lazy3.py`)

Victor on test 23: the camera sat too high on some clips (bt-0AE39B33); and why was everything vertical (test 20's script
cropped 9:16; kept for comparison only, the app frames in the orientation recorded). Fix: x unchanged (dead zone 0.20);
y = today's height (anchor weight 0.05) moved only to keep a trusted / bridged ball 15% below the crop's top and 10%
above its bottom; no ball -> back to the players. Output: today's landscape crop for horizontal sources, portrait for
vertical (`--aspect portrait` for test 23's 9:16 everywhere).
| Clip | Output | Labels | Ball in crop: today | EdgeTAM alone | YOLOX-S + EdgeTAM | Direction changes /10 s: today | EdgeTAM | mix | Crop centre y, mean: today | EdgeTAM | mix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| bt-rz-1105-a | landscape | 73 | 95% | 96% | 100% | 0.5 | 0.5 | 2.1 | 0.53 | 0.53 | 0.49 |
| bt-rz-1105-b | landscape | 73 | 86% | 88% | 100% | 1.0 | 0.5 | 1.5 | 0.53 | 0.52 | 0.45 |
| basket-rp-1105-h | landscape | 25 | 100% | 100% | 100% | 1.2 | 0.0 | 0.0 | 0.58 | 0.58 | 0.58 |
| bt-rz-1105-v | portrait | 54 | 100% | 100% | 94% | 1.4 | 0.0 | 0.0 | 0.48 | 0.48 | 0.48 |
| bt-0AE39B33 | portrait | 30 | 63% | 83% | 97% | 3.3 | 1.0 | 2.0 | 0.54 | 0.54 | 0.51 |
| bt-E5003B6B | portrait | 32 | 78% | 84% | 91% | 4.3 | 2.7 | 2.7 | 0.52 | 0.50 | 0.50 |
| basket-v-01 | portrait | 24 | 100% | 100% | 100% | 0.0 | 0.0 | 0.0 | 0.54 | 0.54 | 0.54 |
| basket-rp-1105-v-a | portrait | 109 | 100% | 100% | 100% | 2.9 | 2.1 | 2.1 | 0.66 | 0.66 | 0.66 |
| basket-rp-1105-v-b | portrait | 57 | 100% | 100% | 100% | 0.7 | 0.7 | 0.7 | 0.53 | 0.53 | 0.53 |
| **mean** | | | 91% | 95% | 98% | 1.7 | 0.8 | 1.2 | | | |

Horizontal clips in 16:9: today's landscape Modo Foco already keeps the ball well (86–100%); the mix reaches 100% on all
three. Vertical: the lower camera costs EdgeTAM alone some high balls (bt-0AE39B33 100 → 83%), the mix keeps 97%.
Videos (today | EdgeTAM alone | YOLOX-S + EdgeTAM; stacked for 16:9): `lab/tests/sg/<clip>.lazy3.mp4` for bt-0AE39B33,
bt-E5003B6B, bt-rz-1105-a, bt-rz-1105-b.

### Test 25 result (2026-11-06) — horizontal clips: 16:9 at 1.5x and the 9:16 export

Victor on test 24: the camera barely moved. Cause: today's landscape crop is wide (zoom ~1.1–1.3x), so the ball rarely
leaves a 0.20 dead zone of it; on vertical clips y now stays at the players. Test 22 (the version Victor picked) was the
9:16 crop (32% of the width) with YOLOX-S + EdgeTAM. Two outputs for horizontal clips, same camera as test 24:

| Clip | 16:9 at 1.5x: today / EdgeTAM / mix | flips /10 s | 9:16 export: today / EdgeTAM / mix | flips /10 s |
|---|---|---|---|---|
| bt-rz-1105-a | 95% / 90% / 100% | 0.5 / 1.6 / 2.6 | 55% / 93% / 97% | 3.2 / 2.1 / 1.1 |
| bt-rz-1105-b | 86% / 77% / 96% | 1.0 / 1.0 / 2.0 | 44% / 88% / 96% | 2.5 / 1.0 / 1.0 |
| basket-rp-1105-h | 100% / 100% / 100% | 1.2 / 0 / 0 | 72% / 100% / 100% | 0 / 0 / 0 |

("today" in the 16:9 column is today's own landscape framing at its own zoom.) Videos: `lab/tests/sg/<clip>.lazy3-z15.mp4`
(16:9, panels stacked) and `<clip>.lazy3-916.mp4` (9:16) for bt-rz-1105-a and bt-rz-1105-b. Summaries:
`lazy3-summary-native-z15.md`, `lazy3-summary-portrait-916.md`.

**Victor (2026-11-06): no horizontal -> vertical conversion in the app, so the 9:16 export is out.** Evaluation set for
the candidate (test 22's "1 toque - zona 0.20" = YOLOX-S + EdgeTAM, dz 0.20, a 10, b 1000, with test 24's height fix,
native orientation, today's zoom): today | candidate on all 9 labelled app clips, `lab/tests/sg/<clip>.lazy3-final.mp4`
(`sg_lazy3.py --render <clip> --only mix-det-fuse5 --suffix=-final`). Scores = the mix column of
`lazy3-summary-native.md` (ball in crop 91% today → 98%, direction changes 1.7 → 1.2 per 10 s).

Horizontal clips, candidate at today's zoom vs a fixed 1.5x (`--zoom 1.5 --suffix=-final-z15`), 11 horizontal labelled
clips (3 app + 8 YouTube): today's landscape zoom is already 1.13–1.43x (mean ~1.27). Ball in crop / direction changes
per 10 s: today 88% / 2.2; candidate at today's zoom 99% / 1.7; candidate at 1.5x 98% / 1.8. Videos (today on top):
`lab/tests/sg/<clip>.lazy3-final-z15.mp4` for bt-rz-1105-a, bt-rz-1105-b, basket-rp-1105-h, yt1105-volei-a,
yt1105-voleipraia.

