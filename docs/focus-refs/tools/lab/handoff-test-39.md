# Handoff: Modo Foco lab, test 39 (basketball ball path with a motion model)

> **2026-11-09: test 39 was done in the original session (not adopted; see the README's test 39). Before using this
> handoff for later work, renumber the task (next test: 40) and read the README's newest sections.**

Paste everything below the line into the new session as the first message.

---

You are continuing the **Modo Foco lab** of **Reprize**, Victor's iOS sports-replay app. The lab's job is the camera
of the **Story 9:16 export**: the camera should follow the ball. Tests 1–38 are done. Your task is **test 39**.
**Always answer me in Portuguese.** Specs, docs, code comments and file names are in English.

## Where things are
- Repo "Lance" on my Mac: `/Users/victorhm/Documents/Projetos/Nexus/Lance` (GitHub onexushub-dev/repplay). The lab is
  in `docs/focus-refs/`; tools in `docs/focus-refs/tools/lab/`; data, models and results in `docs/focus-refs/lab/`
  (gitignored).
- **Read `docs/focus-refs/tools/lab/README.md` first.** It is the full log:
  - the table of tests at the top, newest first;
  - the "Best path" notes with dated updates;
  - one "Test N result" section per test (36, 37 and 38 are the newest);
  - "Files" and "Use" at the end.
  Do not redo anything it already settles.

## Project rules (keep them exactly)
- Only free resources with a licence that allows commercial use (MIT, Apache, CC BY). Nothing AGPL/GPL (so no
  Ultralytics/YOLOv8) and nothing NC/ND.
- Never run git commands that change the repository (commit, push, pull, checkout -b…). Only status, diff and log. When
  something should be committed, give me the commands to run myself. Leave out the Claude-Session line.
- Specs and technical documents in English, file names too. No optional chaining (`?.`) in JS/TS code.
- Number new tests from 39 on. Record each result in the lab README the same way as the previous tests:
  - a row in the top table;
  - a "Test N result" section, newest first;
  - an "Update" line under Best path when the best changes.
- Load .pt/.pth weights with `torch.load(..., weights_only=True)`.
- Downloads from Roboflow, Hugging Face and Google Drive are done by me by hand. Ask me.
- You may edit and write files in the repo on my Mac (through the linked computer). Deleting files there is blocked.
  Give me the `rm` commands instead.

## Current best for basketball (end of test 38, 2026-11-08)
- **Detector: `lab/models/ball_tiny_gym.onnx`.**
  - YOLOX-Tiny, one class, 416 input. Apache code, COCO init.
  - Fine-tuned on the public Roboflow dataset "basketball_detection" (cvsense, **CC BY 4.0**: the app's licences screen
    must credit it), plus "not a ball" crops and the crops of the 12 clips I labelled in our gym.
  - Core ML version: `lab/coreml/ball_tiny_gym.mlpackage`.
- **Detection:** on **all 416 px tiles + the whole frame** of every analysed frame, at 5 fps (`ball_detect.py --tile
  416 --step 2`, tag `<model>-n5`). About 19 inferences per frame on 1080p.
  - Phone cost (iPhone 16 Pro Max, FocusBench): 64 s per 30 s clip, worst case. Accepted: in the app the user exports
    one clip at a time.
- **Ball path:** `tools/lab/ball_track.py`, a dynamic-programming path over the candidates of the whole clip.
  - Basketball uses `still_share 0.5` through `SPORT_P` (test 35).
  - No motion model: only a max speed (`vmax`), a cost per distance moved (`move_cost`) and a still penalty.
- **Story camera:** "camera C" in `tools/lab/story.py` (`--cam "C@1.2#<track tag>"`): dead zone 0.10, smoothing s3,
  zoom per clip (test 31).

## Measurements to beat (detector alone, no tap; unweighted means over clips)
- **12 gym clips**: `basket-app-1107-a..d`, `basket-app-1108-a..h`. Same gym (railing in front, mural), labelled by me.
  - These clips are training data for `ball_tiny_gym`. **Score paths on them with the held-out fold detections
    `bgym-n5`**: each clip was detected by the half-model that never saw it (`ball_tiny_gymX` / `gymY`).
  - Baseline track `det-t38-bgym`: **ceiling 89.4%, precision 92.0%, cover 82.3%**.
  - Losses (`path_diag.py`): blind 10%, still filter 2%, another candidate 4%, empty path 1%, trusted 1%, hit 82%.
  - Story camera C at 1.2x on the 1107 clips: ball in crop 98.3% at 2.1 direction changes per 10 s; at 1.5x 95.8%.
  - The 1108 clips have no `lab/tests/framing/<clip>.current.focus.json` ("today" framing, made on the Mac), so
    story.py cannot score them yet.
- **7 old clips** (other courts, YouTube + earlier recordings): `basket-rp-1105-v-a`, `basket-rp-1105-v-b`,
  `basket-rp-1105-h`, `basket-v-01`, `yt-basket-04`, `yt1105-basket-a`, `yt1105-basket-b`.
  - Held-out detections exist as `bgymX-n5` and `bgymY-n5`.
  - With `bhn-n5` + still 0.5 (report `det-s35sh0.5`): ceiling 79.7%, precision 84.3%, cover 70.9%.
- Commands, run from `docs/focus-refs`:
  ```
  python3 tools/lab/ball_track.py --det bgym-n5 --tag det-t39-<variant> [--set k=v ...] <clips>
  python3 tools/lab/det_report.py --det bgym-n5 --track det-t39-<variant> --name t39-<variant> <clips>
  python3 tools/lab/report_mean.py t38-gym t39-<variant>        # means + cover per clip
  python3 tools/lab/path_diag.py --det bgym-n5 --track det-t39-<variant> [-v] <clips>   # where the ball is lost
  ```
- Story camera scores: `story.load` / `story.camera` / `story.scores` give the ball inside the 9:16 crop and the
  direction changes per 10 s. Comparison videos: `story.py compare --clip <c> --cam today --cam "C@1.2#<track>" ...
  --labels "" "T38" "T39" --suffix=-t39`. Rendering uses the app's brand images and Manrope font: in the repo the
  defaults work (`app/assets/images/brand`, the font in `app/node_modules/@expo-google-fonts`); in a copy elsewhere
  set `REPRIZE_ASSETS` and `REPRIZE_FONT` (top of story.py).

## Test 39: what to try
Add a **ball motion model** to the path. The idea is the Kalman filter's, but offline, because we see the whole clip:
a smoother, or a dynamic program whose state includes velocity. A ball in flight keeps its velocity and falls with
gravity; a dribble bounces.

Target the losses left in test 38:
- The path stays on a wrong candidate while the real ball comes in. Example: 1108-c 1.0–2.8 s, a shirtless torso, now
  mostly fixed by the detector.
- Gaps when the ball goes behind the railing's bars or behind players, with weak scores of 0.06–0.14. Predicting
  through the gap should keep the camera right.
- Fewer jumps between candidates, so a calmer camera.

Constraints:
- Keep the still filter.
- Don't break the held ball case: a player holding the ball still for 2 s, as in 1108-g at 5–7 s.
- Don't tune on everything at once. Choose settings on one half (X = 1107-a, 1107-c, 1108-a, 1108-b, 1108-e,
  1108-g) and confirm on the other (Y = the rest) and on the 7 old clips. Report both, with per-clip numbers.
- Check by eye on the frames, and render story comparisons for the clips that change most.

If it wins, make it the basketball default in `ball_track.py` (as `SPORT_P` did) and note what the app's version of
the path must do.

## Lessons already paid for (don't repeat)
- **Test 33/34:** training on our own recordings only loses half the balls. Self-training on the model's own automatic
  labels made it worse. The public dataset stays.
- **Test 36:** the labelling frames and the detector's frames are the same frames. But an ffmpeg `fps=30` grid's
  frame 3k is NOT the `fps=10` frame k (that one is 3k+1). Use `frame_sync.py` before claiming any time offset.
  About a third of the "blind" points are imprecise clicks on a blurred ball.
- **Test 37:** our old hand labels (mostly YouTube) make the detector worse in our gym.
- Some clips are app exports with the "@reprize.app" mark burnt in. Check that the app analyses the original video.

## Working environment (if this session runs in the cloud linked to my Mac)
- **The Mac side** is a Linux VM:
  - 4 cores; python3 with onnxruntime, cv2 and PIL; **no torch**; ffmpeg 4.4.
  - Each call is capped at about 170 s, and background processes die when the call ends. Work in chunks with
    idempotent steps, for example one detection per call:
    `ball_detect.py --model lab/models/<m>.onnx --tag <t>-n5 --tile 416 --step 2 --threads 4 <clip>`. Skip the
    clips whose JSON already exists.
- **Training** (torch, YOLOX source in `lab/src/yolox-0.3.0`) runs in the cloud workspace, about 1.3–2 s per iteration
  for YOLOX-Tiny batch 16 on 2 cores. Don't evaluate while training: it slows training about 9x.
- **Moving files:**
  - Stage from the Mac into the cloud, and commit back through `/mnt/user-data/outputs/`.
  - Files over about 25–40 MB fail to commit: split them into tars of ≤ 25 MB.
  - Extract on the Mac with python `tarfile`, in `lab/_parts/`, which I delete afterwards.
  - Before overwriting the README, check that the Mac's copy hasn't changed since you read it (sha256).
- **Retraining** needs the public crops `lab/train/pub-lbacg` and `neg-lbacg`, which are **not on the Mac**. Rebuild
  them from the dataset zip in `lab/datasets/basketball_detection-lbacg/`:
  ```
  python3 tools/lab/ball_train_pub.py dataset --src lab/datasets/basketball_detection-lbacg --name lbacg
  python3 tools/lab/hard_neg.py public --src lab/datasets/basketball_detection-lbacg --name lbacg
  ```
  Test 39 itself only needs the detection JSONs, which are on the Mac.
- **Labelling new clips** (I may bring clips from other courts):
  1. Put them in `refs/<date>/`.
  2. Add rows to `tools/lab/clips.txt`: `name|video|startMs|durMs|basquete`.
  3. Extract frames with `tools/lab/extract.sh <names>`. On my Mac's system python PIL is missing; the VM has it.
  4. I label with `lab/.venv/bin/python tools/lab/server.py`.
  New clips from another gym are the first real test of `ball_tiny_gym` outside our gym. Score them before any
  retraining.

## Still open (not test 39)
- The app integration (Swift) of the detector, all tiles, the path and camera C. The lab has the parts; FocusBench in
  `tools/lab/ios-bench/` measures cost.
- Other sports: beach tennis, tennis, volleyball. Each gets its own tests after basketball.
- Licences: credit for the CC BY 4.0 dataset in the app.

Start by reading the README sections of tests 35–38 and `ball_track.py`. Then tell me, in Portuguese and briefly, your
plan for test 39 before running long jobs.
