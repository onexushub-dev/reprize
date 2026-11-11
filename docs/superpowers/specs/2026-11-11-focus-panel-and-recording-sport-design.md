# Focus panel (Original · Players · Ball) and the recording's sport — design

Date: 2026-11-11. Author: Claude with Victor. Status: approved decisions, not implemented yet.
Design canvas: "Reprize — Foco (Jogadores/Bola) e escolha do esporte" (artboards "Escolhido" and "Estados do painel
escolhido").

## 1. Why

A field test (Victor, 2026-11-11): a 22 s recording of a person walking in a living room, no ball, no racket, was marked
**basketball**. Root cause: `autoSport` (`focus/sportCheck.ts`) ends in "otherwise basketball" — no sand and no strong
other-sport label means basketball by default. Basketball also has no verdict (`BallSport.basketball.verdict == nil`),
so the ball model was applied to a clip with no ball at all.

The panel itself was also judged hard to read (two stacked switches, "EM BREVE", links to change the sport).

## 2. Decisions (Victor, 2026-11-11)

1. **No proof, no sport.** A sport is marked only with positive evidence. When unsure, nothing is marked and the sport
   list opens with nothing selected ("Escolher esporte"). Never basketball by default.
2. **The sport belongs to the recording**, decided when its first clip is opened, and serves every clip of it. The player
   can change it at any time from the panel.
3. **Inherit from the previous recording**: if the previous recording started at most **3 h** before this one and its
   sport was confirmed (identified or chosen), this one starts with the same sport — unless the floor disagrees (sand in
   one, not in the other), in which case this recording's own detection decides.
4. **Nothing is applied by itself.** A new clip opens as **Original**. Players (today's Modo Foco) and Ball (Seguir a
   Bola) are computed **only when tapped**, each showing its progress (%) on its card, and kept: switching back is
   instant.
5. **Ball only where a model exists** (today basketball and beach tennis). Any other sport, or no sport: the Ball card is
   not shown at all (the row becomes Original · Players).
6. **Ball not found in the cut**: the clip stays as it was before the tap, the Ball card is dimmed for that cut and the
   hint says the ball was not found. No automatic switch to Players.
7. **Changing the sport after Ball is ready** analyses the cut again with the new sport's model (progress on the card);
   no confirmation. Changing to a sport without a model while on Ball returns the clip to Original.
8. Indoor volleyball looked like basketball to the ball detector in the lab: covered by rule 1 (basketball also needs
   "no strong sign of another sport"; otherwise unsure).

## 3. The panel (layout)

Chosen: the single row of variation A with the cards of variation B, sport list S2.

- Header: "MODO FOCO" (Barlow Condensed) and, on the right, the sport chip: sport icon + name + "· identificado" when it
  was detected (not when chosen or inherited), chevron. Unsure: "Escolher esporte". Tapping it opens the sport sheet.
- Row of cards (equal width, 52 pt high, radius 14, surface `#141414`): **Original** (icon: circle with a slash),
  **Jogadores** (two people), **Bola** (ball with motion lines; only for sports with a model).
  - Selected: 2 pt amber border, amber icon and label. Others: 1 pt `border` colour, `soft` text.
  - Working: the icon becomes a 22 pt progress ring (amber over `border`), the label becomes "48%".
  - Ball not found in this cut: dashed border, `#5A5A5A` text, not tappable for that cut.
  - Pro: the existing Pro pill behaviour stays (free recordings work in the app, exports need Pro).
- Hint line under the row (13 pt, `muted`; `warning` colour for "not found"):
  - Original: "O clipe como foi gravado. Escolha um enquadramento."
  - Players working: "Preparando Jogadores… você pode continuar editando."
  - Ball working: "Analisando a bola… você pode continuar editando."
  - Players: "A câmera acompanha os jogadores, com zoom quando a jogada se concentra."
  - Ball: "A câmera segue a bola, na vertical 9:16 para Stories, Reels e TikTok."
  - Ball not found: "Não encontramos uma bola em jogo neste trecho. O clipe continua como estava."
  - Unsure: "Não identificamos o esporte. Toque em Escolher esporte para ver todos os enquadramentos."
- Sport sheet (S2, bottom sheet): title "ESPORTE DA GRAVAÇÃO", subtitle "Vale para todos os clipes desta gravação.",
  one row per sport (icon, name, "Jogadores · Bola" or "Jogadores"), check on the chosen one. The detected sport, when
  there is one, is first, on an amber-tinted row with an "IDENTIFICADO" pill. Unsure: nothing checked, no pill.
  Sports: Basquete, Beach tennis, Tênis, Futevôlei, Futebol, Vôlei, Vôlei de praia, Handebol, Outro.
  Tapping a row chooses it and closes the sheet. If the sheet was opened from a Ball tap and the sport has a model, Ball
  starts right after.
- Removed: the two switches, "EM BREVE", "É basquete ou beach tennis? Escolher", "Trocar", "Verificando o esporte do
  vídeo…" (the check is fast; the chip shows "Escolher esporte" until it answers).

## 4. Sport detection

### 4.1 Signals (all on the phone, once per recording, on the first clip opened)

| Signal | Source | Cost |
|---|---|---|
| Floor (sand share + grain) | `SportFloor` (test 51), 3 frames | ms |
| Apple scene labels | `VNClassifyImageRequest` (test 43), 3 frames | ms |
| Ball in play | the sport's ball detector at **2.5 fps** over the cut, `BallPath` + median detector score along the path | 10 s cut: ~1.3 s on a 16 Pro Max, ~6 s on an XR |
| Sport classifier (phase 3) | Vision `VNGenerateImageFeaturePrintRequest` + a small softmax head (tens of KB) | ms |

The probe's detections go into the clip's detections cache (`<clip>.balldet.json`), so a later Ball analysis of the
same cut reuses them (half of the 5 fps frames). It waits while the phone is `serious` or hotter, like the analysis.

### 4.2 Rule (provisional thresholds, lab 2026-11-11)

1. Inherited sport (decision 3) → that sport, unless the floor disagrees.
2. Sand floor (test 51) → probe with the beach tennis model: median path score ≥ **0.40** → beach tennis; else unsure.
3. Strong other-sport label (test 43: another sport ≥ 0.4 with "basketball" < 0.1) → unsure.
4. Probe with the basketball model: median path score ≥ **0.35** and path share ≥ 0.3 → basketball; else unsure.
5. Phase 3: the classifier's top class with probability ≥ `minP` (calibrated so that no "no game" or other-sport clip
   gets a sport) can name sports without a ball model (tennis, football, …); rules 2–4 still decide basketball and
   beach tennis.

Lab evidence (2.5 fps, `bgym`/`bgymall`/`btpl` detections): basketball clips 0.36–0.73 (23 clips), beach tennis
0.43–0.70 (12 clips), the living-room clip 0.26 (basketball model, path in 3% of frames) and 0.33 (beach tennis
model). **One negative clip only**: thresholds must be recalibrated on 10–15 "no game" clips before release.

### 4.3 Classifier data (phase 3)

- `lab/sport-cls/`: frames per clip (`tools/lab/sport_cls_frames.py`), Kaggle "100 Sports" CC0
  (`sport_cls_public.py`), Victor's new clips in `videos/<label>/`, features from the Mac
  (`tools/lab/SportFeatures.swift`), head trained and measured per clip (`sport_cls_train.py`).
- YouTube references are **evaluation only** (no licence to train a shipped model on them).
- Labels: basquete, beachTennis, tenis, futebol, volei, voleiPraia, futevolei, outro, nenhum ("no game").

## 5. Data model

- `RecordingSportId = 'basquete' | 'beachTennis' | 'tenis' | 'futebol' | 'volei' | 'voleiPraia' | 'futevolei' |
  'handebol' | 'outro'`; `BallSportId` stays the subset with a model.
- `Session.ballSport` → `Session.recordingSport`:
  `{ v: 2; sport?: RecordingSportId; how?: 'detected' | 'chosen' | 'inherited'; floor?: { sand: number; tex: number };
  labels?: Record<string, number>; probe?: { model: string; score: number; share: number } }`.
  `sport` absent = unsure. Recordings with the old `ballSport` are read as: `sport` (chosen) kept; `auto` dropped
  (looked at again with the new rule).
- `Clip.edit.framing` default becomes `'none'` for clips saved from this version on (`editV: 2`); clips saved before
  keep today's default (`'focus'`) so nothing already edited changes.
- Ball "not found": today's `ClipBall.status = 'unsuitable'` with `reason`; the panel reads it to dim the card.

## 6. Native changes (iOS)

- `probeSportBall(clipPath, startMs, endMs, sport)` → `{ score, share }` (2.5 fps, the sport's model, `BallPath`),
  writing into the detections cache.
- Modo Foco progress events (`done`/`total` frames) from `FocusAnalyzer`, like Seguir a Bola's.
- Phase 3: `sportFeatures(clipPath, startMs, endMs)` → the feature print of 3 frames; the head runs in JS (`head.json`
  in the bundle) or Swift.

## 7. Phases

1. **JS only**: new panel and sport sheet; `RecordingSportId`; no default sport (rule 1 with today's signals: sand →
   beach tennis, Apple "basketball" label ≥ 0.3 → basketball, else unsure); inheritance; Ball hidden without a model;
   new clips open as Original; Ball not found keeps the clip as it was. Players still computed in the background but
   applied only on tap (its card shows a spinner, not %, until phase 2).
2. **Native**: the ball probe (rules 2 and 4) and Modo Foco on tap with %.
3. **Classifier**: once the data is in and measured.

## 8. Tests

- `sportCheck.test.ts`: unsure is the default; sand + probe; other-sport label; inheritance window and floor veto.
- `panels.test.tsx`: cards per sport (2 or 3), progress text, not-found state, chip texts, sheet with/without a
  detected sport.
- `editing.test.ts`: default framing by `editV`.
- Field: the living-room clip and 10–15 "no game" clips must all come out unsure.
