# 4K analysis speed test plan (Jogadores + Bola)

Date: 2026-11-12. Owner of decisions: Victor. Lab work: Claude.

## Goal

Make the two Modo Foco analyses faster on 4K clips **without losing today's quality** (detection, tracking, framing).
Field evidence (2026-11-11 night, 4K beach tennis): Bola took 20–25 s for a 15 s cut (0.27–0.34 s per analysed frame)
vs 0.07–0.09 s on 1080p clips in the afternoon. Cause: the detector tiles the frame in 416 px squares, 19 regions at
1080p and 85 at 4K.

## Candidates (in order of expected gain)

| # | Change | Mode | Expected gain | Risk |
|---|---|---|---|---|
| 1 | Scale 4K frames to 1920 px wide before tiling (19 regions instead of 85) | Bola | 3–4x | detection of small/far balls |
| 3 | Analyse only the cut (with a margin) instead of the whole clip | Jogadores | ~cut/clip length | trim edges |
| 4 | 5 fps instead of 10 fps | Jogadores | ~2x | framing smoothness |
| 2 | One video decode for both modes | both | decode time | architecture; only after 1 |

## Quality gates (a candidate ships only if all hold)

| Gate | Measure | Threshold |
|---|---|---|
| G1 Ball cover | share of labelled ball points with a trusted candidate on the ball | ≥ baseline − 1 pt, per sport |
| G2 Ball precision | trusted points that are on the ball | ≥ baseline − 1 pt, per sport |
| G3 Verdict | clips applied / tooSmall / rarelyFound / still / tooFar | no clip changes verdict, or each change reviewed and accepted by Victor |
| G4 Framing | 9:16 rects vs baseline (centre shift, width) | reported per clip; any clip above 5% of frame width reviewed on video |
| G5 Labelled ball in crop | labelled points inside the 9:16 crop | ≥ baseline − 1 pt |
| G6 1080p unchanged | the 64 labelled 1080p clips | identical output (change 1 only acts above 1080p) |
| G7 Victor's review | side-by-side videos | approved |
| G8 Phone speed | measured on device, not the Mac | gain confirmed; thermal no worse than baseline |

## Repeating the tests with new footage

Victor records every field test in 4K and Full HD (all sports). Each dump goes through the same run:
`bash tools/lab/run_4k_test.sh raw-dump/<dump> --day <date>` — see "4K tests: how to run a new phone dump" at the top
of `docs/focus-refs/tools/lab/README.md`. Results per dump: `docs/focus-refs/lab/tests/4k/<dump>/` (inventory, report)
and the side-by-side videos; each run adds a line to the results log below.

## Steps

### Step 0 — Freeze the baseline (Claude)
- [x] Record the commit the baseline comes from (`8938597`, analyzers unchanged by the 2026-11-11 queue/tag edits).
- [ ] Baseline = today's app pipeline (model `ball_tiny_btpl` / `ball_tiny_gym`, all 416 tiles at the clip's native size,
      5 fps, current path/verdict rules; Jogadores v15 at 10 fps on the whole clip).

### Step 1 — Collect the clips (Victor)
- [ ] Opening or editing clips before the dump is fine: the `.mp4` is never rewritten (cut, framing and speed are
      kept in mmkv), and the side files the app made are only the on-device reference for the parity check. Mark in
      the inventory which clips were cut or had Jogadores/Bola run, and keep using the same build until the dump.
- [x] Find the device and bundle id (iPhone 16 Pro Max `00008140-001648513A42801C`, `com.victorhm.lance`):
      `xcrun devicectl list devices` and `xcrun devicectl device info apps --device <UDID> | grep -i -E "reprize|lance|repplay"`
- [x] Copy the app's Documents (originals + side files + mmkv) — done 2026-11-12 00:07, 6.5 GB, 214 clips:
      `xcrun devicectl device copy from --device <UDID> --domain-type appDataContainer --domain-identifier <bundle id> --source Documents --destination docs/focus-refs/raw-dump/2026-11-11-4k`
- [ ] Fill the inventory below (one line per clip chosen), 12–16 clips, all 4K, all lens 1x:
      beach tennis night (the 2026-11-11 set: include tooSmall and applied ones), beach tennis day (3–4),
      basketball gym (3–4), some vertical and some horizontal.
- [ ] Optional: one older phone (A14) available for step 8.

**What the dump holds (Claude, 2026-11-12):** 37 clips at 3840x2160 30 fps, all horizontal, all beach tennis on the
same court the night of 2026-11-11 (recordings 18:52, 19:06, 19:18, 19:44, 20:23); none with a changed cut. Bola ran on
the phone on 13 of them: 9 applied (share 0.57–0.94), 4 judged `tooSmall` (F9FD986E, 2FD3B0A7, 4A967515 and one more in
the log). Plus 9 clips of the same court at 1920x1080 60 fps (recording 21:10): a same-night control. Everything else in
the dump is 1080p from earlier days.

**Gaps (Victor):** no 4K daytime beach tennis, no 4K basketball, no 4K vertical. Record a few when possible (lens 1x);
until then the results hold for night beach tennis horizontal only. Also confirm: were the night clips at 1x?

Label set (8 clips, added to `tools/lab/clips.txt`, frames extracted; window = the app's cut):

| lab name | file | resolution | Bola on the phone | why |
|---|---|---|---|---|
| bt4k-1111-f9fd986e | F9FD986E | 4K | tooSmall (share 0.80) | tooSmall with a high share |
| bt4k-1111-2fd3b0a7 | 2FD3B0A7 | 4K | tooSmall (0.63) | tooSmall |
| bt4k-1111-4a967515 | 4A967515 | 4K | tooSmall (0.71) | tooSmall |
| bt4k-1111-d8579019 | D8579019 | 4K | applied (0.75) | applied |
| bt4k-1111-58656907 | 58656907 | 4K | applied (0.57) | applied, lowest share |
| bt4k-1111-c4bd28f7 | C4BD28F7 | 4K | applied (0.94) | applied, highest share |
| bt4k-1111-35a58bfc | 35A58BFC | 4K | not run | first recording (18:52), never analysed |
| bt1080-1111-ba88cacb | BA88CACB | 1080p | not run | same night at 1080p (control) |

All 37 4K clips are used for the agreement measures (G3, G4) with no labels needed.

Inventory (Victor fills the context columns; file = the `.mp4` name in the dump):

| file | sport | day/night | orientation | camera position (back/diagonal/side) | cut changed? | Jogadores/Bola run in the app (result) | notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

### Step 2 — Prepare the set (Claude)
- [x] ffprobe every clip: resolution, fps, codec, duration (lens unknown: Victor confirms 1x).
- [x] Read the cut and sport of each clip from mmkv; label set added to `tools/lab/clips.txt` (`bt4k-1111-…`).
- [x] `tools/lab/extract.sh <names>` (frames for the labelling page): 8 x 150 frames.
- [ ] Keep the phone's `.balldet.json` / `.ball.json` / `.focus.json` as the on-device reference.

### Step 3 — Label the ball (Victor), 6–8 clips
- [x] `cd docs/focus-refs && lab/.venv/bin/python tools/lab/server.py`, open http://127.0.0.1:8765
- [ ] Same rules as the existing labels: every frame where the ball is visible; "not visible" where it is hidden or out.
- [x] Labelled 2026-11-12: the 8 clips of the label set (night beach tennis; day and basketball wait for 4K footage).

### Step 4 — Baseline in the lab (Claude)
- [x] Run today's pipeline on the 4K clips at native size; check parity with the phone's `.balldet.json` (same
      candidates within rounding). If parity fails, stop and fix the lab first.
- [ ] Gates G1–G5 numbers for the baseline; verdict per clip.

### Step 5 — Candidate 1, Bola at 1920 px (Claude)
- [ ] Lab variant: frame scaled to 1920 wide before tiling, boxes mapped back to native px.
- [ ] G1–G6 per clip and per sport; table baseline vs candidate.
- [ ] Side-by-side videos (baseline | candidate) for every clip, the differing ones first.

### Step 6 — Review (Victor)
- [x] Watch the videos; approve or reject candidate 1 (G7) — approved 2026-11-12 (see the review below).

### Step 7 — Jogadores candidates 3 and 4 (Claude, then Victor's review)
- [ ] 3: cut + margin (±2 s) vs whole clip: framing inside the cut identical; margin behaviour on trim changes.
- [ ] 4: 5 fps vs 10 fps: rect differences per clip + side-by-side videos; Victor decides on smoothness.

### Step 8 — Speed on the phone (Claude builds, Victor runs)
- [x] Build ready (2026-11-12, code marked `TEMP(lab-4k)`, nothing else changes): Diagnóstico shows two switches —
      **Bola**: "Quadro nativo (hoje)" / "Reduzido a 1920" (`BallAnalyzer` `maxWidth`, own detections cache key
      `<model>@1920`, the variant is part of Bola's rules so switching analyses the clip again); **Jogadores**:
      "10 fps (hoje)" / "5 fps" (`FocusAnalyzer` `everyMs` 200, rows still every 100 ms, last people held to the end;
      a clip analysed at the other setting is analysed again). The analysis lines say which variant ran:
      `Modo Foco: … (1 quadro a cada 200 ms, …)` and `Seguir a Bola: … quadro reduzido a 1920, Jogadores 1 a cada … ms`
      (with "N do cache": only lines with "0 do cache" are timings from scratch).
- [ ] Protocol (16 Pro Max, then the XR if possible; phone cool, `nominal`, out of the charger): use clips never analysed
      on the phone, so every first run is from scratch: the 18:52 recording of 2026-11-11 (4K, 15 s: 35A58BFC, 53D37F8A,
      DF5899A6, 690E108B, 63EA510D, 513095B4 — Jogadores pending, Bola never run, sport not set: pick Beach Tennis when
      asked) and, for 1080p, 39376482 and 1019E94B (21:10 recording, Jogadores pending).
      0. Diagnóstico → "Zerar análises de todos os clipes" (every clip back to never analysed, analysis files removed;
         the videos stay; logged as "Teste 4K: análises zeradas em N clipes"). Clips (recorded 2026-11-11): recording
         18:52 — #1 18:54:43 (35A58BFC), #2 18:57:28 (53D37F8A), #4 18:59:22 (DF5899A6), #5 19:00:00 (690E108B),
         #8 19:00:43 (63EA510D); recording 19:06 — #1 19:08:31 (513095B4); recording 21:10 (1080p) — #2 21:11:45
         (39376482), #3 21:12:14 (1019E94B).
      1. Bola "Quadro nativo" + Jogadores "10 fps": open each clip, tap Jogadores, wait; tap Bola, wait.
      2. Switch to Bola "Reduzido a 1920" + Jogadores "5 fps": the same clips again, the same order (both run again).
      3. Share the Diagnóstico. (Optional: a 10-clip soak per variant for heat.)
- [ ] Same 10 clips, each variant, phone cool and at nominal; then a 10-clip soak per variant.
- [ ] iPhone 16 Pro Max; the A14 phone if available. Record time, s/frame, thermal, battery.

### Step 9 — Decision and rollout
- [ ] Victor decides per candidate with the gate table.
- [ ] Approved ones go into the app (native + tests); parity fixtures updated; field test with Diagnóstico.
- [ ] Then candidate 2 (single decode), planned separately.

## Side question: 4K at 60 fps instead of 30 — parked, decide later (Victor, 2026-11-12: "deixar como está")

Nothing changes now: 4K stays `2160p30` (CaptureController.target), H.264. Notes for the decision:

**Measured / projected**

| | 1080p60 (today) | 4K30 (today) | 4K60 (projected) |
|---|---|---|---|
| bitrate (measured in the 2026-11-11 dump; BufferPlan for 4K60) | 10 Mb/s | 24 Mb/s | ~40 Mb/s |
| ~17 s clip | 23 MB | 52 MB | ~85 MB |
| 60 s buffer on the phone | ~75 MB | ~180 MB | ~300 MB |
| battery while recording (field logs) | ~20%/h | ~24%/h | estimated 30–35%/h |
| heat | moderate | nominal for 37 min at night | 2x sensor + encoder work: likely `serious` much sooner in the sun |

**Costs**
- Heat ladder: after 2 min `serious` any quality drops straight to 1080p30. In the sun 4K60 could spend much of a game
  at 1080p30 — worse than today's 1080p60. 4K60 would need intermediate steps (4K60 → 4K30 → 1080p60 → 1080p30).
- Modo Foco analyses: they use 5 fps (Bola) / 10 fps (Jogadores) but every frame is decoded; 60 fps doubles the decode,
  against the speed work of this plan.
- Exports and sharing: files ~65% larger than 4K30; 4K exports take longer.

**Gains**
- Motion: ball and rackets sharper and smoother (Victor saw it at Full HD).
- Slow motion: at 0.5x a 30 fps clip plays 15 frames per second (choppy); 60 fps stays smooth.

**HEVC (H.265) instead of H.264 — the main lever to look at first**
- Same picture quality at about half the bitrate: 4K60 in HEVC ≈ 20 Mb/s, close to today's 4K30 H.264; 4K30 HEVC ≈ 12 Mb/s.
- Smaller files: buffer, storage, export reading and sharing all shrink.
- Processing: decode is done by the phone's hardware for both codecs, so HEVC by itself mostly saves size and disk
  reads, not much decode time; to be measured, not assumed.
- To check before adopting: export/share compatibility (WhatsApp, Instagram, older Android receivers), the export
  pipeline's output codec, AVAssetReader cost on HEVC on the A12 (XR) and A14+, and encoder heat.

**When it is picked up (after candidate 1)**
- [ ] Build with `2160p60` and an HEVC switch (both phones offer 4K60).
- [ ] Same court, same time of day, 20 min each: 4K30 H.264 / 4K60 H.264 / 4K60 HEVC — battery %/h, time to
      `fair`/`serious`, whether the ladder dropped to 1080p30.
- [ ] Analysis time per clip and export time for each.
- [ ] Victor's look at 1x and at 0.5x slow motion; sharing test to WhatsApp/Instagram.
- [ ] Decide the quality offered to Pro, the codec and the heat ladder.

## Results log

| date | step | result |
|---|---|---|
| 2026-11-12 | 4–5 (detector + lab path + verdict) | see "Candidate 1, first result" below |
| 2026-11-12 | 5 (all 46 clips of 2026-11-11, `run_4k_test.sh` on Victor's Mac + report here) | see "Candidate 1, whole dump" below |
| 2026-11-12 | 7 (candidate 4, Jogadores at 5 fps, simulated) | see "Candidate 4, first result" below |
| 2026-11-12 | 7 (candidate 4's effect on Bola) | see "Candidate 4 on Bola" below |
| 2026-11-12 | 6 + 7 (Victor's review of the videos) | candidates 1 and 4 approved on quality; see "Victor's review" below |
| 2026-11-12 | 8 (phone speed, iPhone 16 Pro Max, diagnostico 12 = round A, 13 = round B) | see "Step 8, first result" below |

### Candidate 1, first result (2026-11-12, lab, CPU)

Model `ball_tiny_btpl.onnx` (the app's beach tennis model), 416 tiles, 5 fps (`--step 2`), the app's cut. Baseline =
4K frames tiled at native size (85 regions, as the app); candidate = frames scaled to 1920 wide first
(`ball_detect.py --max-width 1920`, 19 regions). Tags `btpl-4kplan-native` / `btpl-4kplan-1920`; tracks
`det-btpl-4kplan-*` (ball_track.py, with the phone's Jogadores files as `current.focus.json`).

| clip | labelled pts | ceiling native → 1920 | track precision native → 1920 | track cover native → 1920 | verdict on phone | lab verdict native → 1920 (ball px in 9:16) |
|---|---|---|---|---|---|---|
| bt4k-1111-35a58bfc | 30 | 83 → 77% | 70 → 96% | 63 → 77% | not run | no Jogadores file |
| bt4k-1111-4a967515 | 24 | 100 → 92% | 78 → 95% | 75 → 88% | tooSmall | tooSmall (12) → apply (22) |
| bt4k-1111-f9fd986e | 42 | 74 → 93% | 61 → 87% | 55 → 81% | tooSmall | tooSmall (14) → apply (28) |
| bt4k-1111-d8579019 | 40 | 88 → 90% | 78 → 100% | 72 → 88% | applied | tooSmall (15) → apply (25) |
| bt4k-1111-2fd3b0a7 | 34 | 65 → 65% | 68 → 92% | 44 → 65% | tooSmall | tooSmall (13) → apply (23) |
| bt4k-1111-58656907 | 43 | 95 → 98% | 79 → 98% | 72 → 95% | applied | apply (20) → apply (27) |
| bt4k-1111-c4bd28f7 | 65 | 98 → 98% | 92 → 100% | 92 → 97% | applied | apply (26) → apply (27) |
| bt1080-1111-ba88cacb (control, 1080p) | 30 | 93 → 93% | 96 → 96% | 87 → 87% | not run | apply → apply (identical, G6) |
| **4K total (278 pts, weighted)** | | **87.0 → 89.3%** | **76.8 → 95.9%** | **70.0 → 86.1%** | | |

Lab speed (CPU, 4 threads): 2.03 → 0.49 s per analysed frame (4.2x). The phone will differ; step 8 measures it.

Reading: at native 4K the model (trained at 1080p scale) finds many false small "balls"; the path follows some of
them, which lowers precision and makes the median ball size small: the `tooSmall` verdicts on the phone came from
that. Scaled to 1920 the false candidates go and the verdict applies on every clip. The lab baseline matches the phone's
verdict on 5 of 6 clips (d8579019 is borderline: 15 px vs the 16 px limit in the lab, applied on the phone).

Videos, first set (story camera C: NO court lock, not the app's beach tennis camera — Victor saw it jump to the next
court's volleyball on f9fd986e at 7.5–9 s; superseded): `lab/tests/story/*.story-compare-4kplan.mp4`.
**Videos to review** (the app's beach tennis camera, cam_bt T52 with the court lock and the hitter kept whole; panels:
the phone's own Bola camera from its `.ball.json` | lab today | lab 4K→1920): `lab/tests/story/bt4k-1111-{f9fd986e,
2fd3b0a7,4a967515,d8579019,58656907,c4bd28f7}.bt-compare-4kplan.mp4`. Lab "today" reproduces the phone's camera
(f9fd986e: centre within ~0.01 of the phone's for most of the clip), so the lab is a fair stand-in for the app.
After adding the players' boxes (from the phone's Jogadores file) the labelled totals are: precision 80.3 → 95.8%,
cover 71.1 → 84.4%, ceiling 87.7 → 89.6% (308 pts incl. the 1080p control, which is unchanged).
Report: `lab/tests/4k/2026-11-11-4k/report.btpl-4kplan-native-vs-btpl-4kplan-1920.md`.
### Candidate 1, whole dump (2026-11-12)

37 4K + 9 1080p clips (night beach tennis, one court). Mac CPU: 1.0 → 0.23 s per analysed frame on 4K (4.4x);
1080p unchanged (0.23 s). Verdicts (lab, the app's rules; 9 clips of the 18:52 / 19:06 recordings have no Jogadores
file from the phone, so no verdict):

| | clips |
|---|---|
| 1080p: same verdict, same track (agreement 100%) — G6 holds | 7 (+2 without a Jogadores file) |
| 4K: applied → applied | 17 |
| 4K: tooSmall → applied | 7 (f9fd986e, d8579019, 2fd3b0a7, 4a967515, 390522fe, 535af49a, bffb7092) |
| 4K: tooSmall → rarelyFound (still not applied, another reason) | 3 (c4e1aa88, 0ce501e1, e8f317e9) |
| 4K: applied → "camera would hardly move" | 1 (4466b8ba; applied on the phone) |

G3 asks Victor to review every verdict change: videos `lab/tests/story/<clip>.bt-compare-4kplan.mp4` for the 4 "not
applied" ones and the 3 unlabelled tooSmall → applied ones (plus the 6 labelled). Track agreement between today and the
candidate is low on 4K (23–89%): expected, today's track follows false small candidates part of the time.
Note: the Mac run stopped at the video step because `run_4k_test.sh` was edited while it ran (bash reads the script as
it goes); the videos above were made here, and the script now uses the app's beach tennis camera (bt_render.py).
Caveat: night beach tennis, horizontal, one court only; basketball/day/vertical 4K not yet tested.

### Candidate 4, first result (2026-11-12, simulated from the phone's files)

`tools/lab/focus_fps.py`: the phone's Jogadores file keeps the person boxes of every 100 ms frame; every other row is
dropped (what a 5 fps analysis sees) and the framing recomputed with `focus_variant.py` (preset acao, tiled boxes) on the
app's 100 ms grid, which holds the last people seen. Parity first: 10 fps recomputed = the phone's file (max diff
0.0004 of the frame) on all 36 clips. Report `lab/tests/focusfps/report.md`.

36 clips (night beach tennis, 4K and 1080p): crop centre shift mean 0.4% of the frame, size change mean 0.6%,
smoothness 0.31 → 0.32 (mean |second difference| x1000). Most clips are practically identical (mean shift ≤ 0.5%).
A few differ for moments: centre up to 5–7% (85ebb164, 64a07b7a, 1dc8428e, 5bafbd8f), size up to 12–17% (e8f317e9,
2a727c42, b6984f63, bffb7092), and jerkier on f9fd986e (0.14 → 0.25), 0ce501e1 (0.19 → 0.36), a008611d (0.26 → 0.35).
Videos (10 fps today | 5 fps): `lab/tests/focusfps/<clip>.fps-compare.mp4` for 85ebb164, e8f317e9, f9fd986e, 0ce501e1,
64a07b7a, 2a727c42, b6984f63 (the worst ones). Victor decides on smoothness (G7).

Not measured yet: the phone time (Vision runs on half the frames, but every frame is still decoded: expect less than
2x, step 8) and the effect on Bola, which reads the Jogadores people boxes (head rule, hitter, court lock).

### Candidate 4 on Bola (2026-11-12, lab only, nothing in the app)

`tools/lab/ball_on_p5.py`: for each clip, an alias `<clip>-p5` (same video, same 4K→1920 detections, registered in
clips.txt with its labels copied) whose Jogadores file is the 5 fps simulation — framing in both orientations and the
person boxes held between analysed frames, as a 5 fps app would store them. Lab path + verdict + the app's beach tennis
camera (cam_bt T52) on both. Report `lab/tests/focusfps/report-bola.btpl-4kplan-1920.md`.

35 clips: **no verdict changes**; the followed ball is the **same point on every frame** of every clip; labelled
precision / cover identical on the 7 labelled clips; the camera differs by 0.0–1.3% of the frame width on average per
clip, worst moment 7.3% (85ebb164, where Jogadores itself moved most: video
`lab/tests/focusfps/bt4k-1111-85ebb164.bola-fps-compare.mp4`). So Bola is not sensitive to Jogadores at 5 fps; the
decision rests on Jogadores' own smoothness (videos above) and the phone time (step 8).

### Victor's review (2026-11-12) — G3 / G7

Candidate 1 (Bola 4K→1920), videos `lab/tests/story/<clip>.bt-compare-4kplan.mp4`, the verdict changes:
- 4466b8ba (applied → "camera would hardly move"): **accepted, excellent** — the camera need not move when it is not
  needed; less wrong movement is better, so the ball / players are not lost as reference.
- c4e1aa88 (tooSmall → rarelyFound): approved; framing as expected, the ball never lost.
- 0ce501e1: not judgeable (hardly any play, only serve attempts).
- e8f317e9: **huge improvement** over today: the candidate never went to anything strange and stayed on the ball.
Candidate 4 (Jogadores at 5 fps), videos `lab/tests/focusfps/<clip>.fps-compare.mp4`: 85ebb164 good, as expected;
e8f317e9 as expected, nothing abnormal; f9fd986e excellent. Bola on Jogadores at 5 fps (85ebb164.bola-fps-compare): good,
no anomaly. Victor: "todos estão dentro do esperado".

**Quality gates passed for both candidates on night beach tennis.** Remaining before the app: step 8 (phone speed and
heat, both phones) and 4K footage of other sports / daytime / vertical as it comes from the field tests.

### Step 8, first result (2026-11-12, iPhone 16 Pro Max, beach tennis night clips of 2026-11-11)

Round A = today (Bola native, Jogadores 10 fps), round B = candidates 1 + 4 (Bola 1920, Jogadores 5 fps), after
"Zerar análises". Pairs matched by the clip's people per frame (the two rounds did not open exactly the same clips:
6 pairs, 4 in 4K and 2 in 1080p; A's 4.4-people clip had 34 cached Bola frames and is left out of Bola's times).

| per 15 s cut | round A (today) | round B (candidates) | gain |
|---|---|---|---|
| 4K Jogadores | 9.3 s | 4.9–5.3 s | ~1.85x |
| 4K Bola | 20.4–21.5 s | 5.0–5.8 s | ~3.8x |
| 4K Jogadores + Bola | ~30.5 s | ~10.5 s | ~2.9x |
| 1080p Jogadores | 8.4–8.5 s | 5.0–5.1 s | ~1.7x |
| 1080p Bola | 5.3 s | 5.4–5.7 s | same (expected) |
| "Jogadores on screen" after opening | 11–14 s | 5.3–7.2 s | ~2x |
| heat | `fair` from the 4th clip (08:56) | `nominal` throughout | |
| battery | 85 → 80% | 80 → 80% | |

Heat caveat: B ran after A (phone already used), so B staying `nominal` is a good sign, not a clean comparison.

**Verdicts on the phone (open point):** in round B three of the 4K pairs were `rarelyFound` (ball share 39–61%) where round
A said `tooSmall` (62–76%); the applied 4K pair stayed applied (79 → 69%); 1080p unchanged (83 / 83%). The lab predicted
`tooSmall → apply` for most 4K clips, but these clips (18:52 / 19:06 recordings) had no Jogadores file in the lab, so
their verdict was never computed there. Next: a new dump (their Jogadores and Bola files now exist) → lab verdict for
both variants on them, and videos for Victor (does `rarelyFound` hold, or is the 1920 share too strict there?).

### Step 8, verdicts checked (2026-11-12, dump `raw-dump/2026-11-12-speedtest` (side files + mmkv only, the videos are those of 2026-11-11-4k), round B files)

Phone, round A → round B (4K): 35A58BFC tooSmall → rarelyFound (share 0.21), DF5899A6 tooSmall → rarelyFound (0.25,
at the limit), 513095B4 tooSmall → rarelyFound (0.17), 53D37F8A applied → applied, 690E108B (B only) applied,
90B22810 (B only) applied; 1080p 47574D4B / 1019E94B applied in both. **No clip lost Bola**: the three not applied in B
were not applied in A either (another reason). Ball size in B 22–31 px everywhere (tooSmall gone, as in the lab).

Lab vs phone on the 1920 variant: detections agree (candidates per frame phone 20–27, lab 22–29; the native run has
36–44), but the lab's trusted share is higher than the phone's on these clips (0.32 / 0.39 / 0.41 vs 0.21 / 0.25 / 0.17),
so the lab applies two of them where the phone does not. The lab's share also ran higher than the phone's on the native
variant (11-11 clips), so this is a known lab / phone gap in the share measure, not new to the candidate; the phone is
the reference. Videos for Victor (does Bola belong on these three?): `lab/tests/story/bt4k-1111-{35a58bfc,df5899a6,
513095b4}.bt-compare-speedtest.mp4` (phone 1920 camera, not applied | lab today | lab 1920).
Caveat: the phone scales with a plain CoreImage affine transform (bilinear), the lab with ffmpeg `area`; if the
videos suggest the phone misses balls, try `CILanczosScaleTransform` in BallAnalyzer.

### Decision (Victor, 2026-11-12 09:39)

The not-applied clips are mostly poor training clips (little or no rally), a plausible reason for `rarelyFound`.
**Go with Jogadores at 5 fps and Bola scaled to 1920 for 4K**, confirmed by tonight's field test (4K and Full HD).
In the build: both are now the default (`focusEveryMs()` 200, `ballMaxWidth()` 1920); Diagnóstico can still switch to
the previous values ("antes") to compare. Still `TEMP(lab-4k)` plumbing (Diagnóstico switches, rules suffix `@w1920`,
`ClipFocus.every`); to be made permanent (rules bump, no switches) after the field test.

Also fixed (Victor: an effect started processing by itself when opening a clip): a framing kept from an earlier visit
whose analysis is not done (never finished, reset, other rules or frame rate) now opens as the Original and runs nothing
until the player picks Jogadores or Bola; a finished analysis is shown as before, with nothing run.

