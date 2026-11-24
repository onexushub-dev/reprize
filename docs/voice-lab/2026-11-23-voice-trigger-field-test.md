# Voice trigger field test — 2026-11-23

Beach tennis, open court, loud music, light wind, little talk nearby. Camera phone ~1 m behind the baseline, landscape, 1x.
Apple Watch on the player's wrist recording with Voice Memos. Two more people (Sara, Yasmin) with their own watches.

## Bottom line

- **The current trigger (Apple dictation) heard 12 of 27 "salvar" in a real game (44%), with no false triggers.**
- **Up to 9 m the player's voice still reaches the camera phone 7–13 dB above the court noise.** At this range the limit is the recognizer, not the physics.
- **Dictation is the wrong tool for one word.** Even Whisper (a stronger dictation model than Apple's on-device one) read "salvar" in only 6 of 31 phone recordings, and 19 of 31 on the watch, with the word right next to the mic. Said fast on court, "salvar" comes out as "salvá", and dictation turns it into "Salve!", "Sao Bair", "Tao Bar", "Sauber". Also accepting "salve" is not a fix: "salve!" is a common greeting on court.
- **A first dedicated detector prototype heard 31 of 31 on the camera phone at 3, 5 and 9 m, with 0 false triggers in 6.3 min of held-out audio.** On the watch it heard 30 of 31.
- **Recommendation for the watch: path A (dedicated detector on the device).** Path B (send watch audio to the phone's dictation) inherits dictation's misreadings even on clean audio. The same detector serves the camera phone (iOS and Android) and the watch.

These numbers come from one evening, one main speaker and few minutes of noise. They show the direction. They are not a production estimate yet (see Caveats).

## Data

Folder `2026-11-23/` (originals) → `lab/wav16/` (16 kHz mono WAV).

| Block | Files | What |
|---|---|---|
| Noise only | `60s de ruido 1–3` (phone), `Gravação` (watch, 5 min) | nobody says "salvar" |
| Distances (player) | `3m normal forte`, `3m de lado`, `3m com pulso levantado`, `5m normal forte lado`, `9m normalfortelado pul` (phone), `Gravação 2` (watch, 3.5 min) | 3× normal, 3× loud, 2× sideways/back, 2× wrist raised, at ~2–3, 5 and 9 m |
| Other voices | `3m normal`, `9m forte`, `3m 9m - normal e forte` (phone); `Salvar teste Sara`, `Salvar teste yasmin` (their watches) | 3 and 9 m |
| Real game | 13 phone clips (12 saved by voice, 1 by the remote by accident), `Gravação 3` (watch, 20 min) | voice trigger ON |
| Home | `3380894D…` (20× "salvar", close, quiet), `4D6B9226…` (salva, salvou, salve, falar, saber, salada ×3) | reference and confusers |

The 13 m and 17 m points were not recorded. The player's target is reliable detection up to ~10 m.

## Method

1. **Marks.** Silero VAD + Whisper small (sherpa-onnx, int8) on every file (`marks/`).
2. **Labels.** Each "salvar" of the distance block was labeled on the watch recording, where the voice is close and clear (`labels.py`). Two ambiguous spots are left out of both counts.
3. **Phone ↔ watch alignment** (`align.py`). Correlation of speech-band onset envelopes. The five distance clips line up end to end within 1 s, as the app's no-overlap rule says they should. This confirms the offsets.
4. **Voice over noise (SNR)** (`eval_dist.py`). Loudest 0.4 s of the word vs. the median 0.4 s of the 4 s around it with no labeled speech, 300–3400 Hz.
5. **Dictation reference.** Whisper small on a window around each labeled word, matched as the app does (whole word "salvar", case/accents ignored).
6. **Detector prototype** (`detector_v1.py`, variant B). openWakeWord's shared feature models (mel spectrogram + 96-d speech embedding every 80 ms). A small MLP over 16 embeddings (~1.3 s) decides "salvar"/"not salvar".
   - Positives: close-mic "salvar" (home, watch, Sara, Yasmin), mixed into court noise at −2 to 18 dB, with random speed, low-pass and light reverb to imitate distance.
   - Negatives: court noise, talk from the game watch recording, the confuser words, and words cut off at the window's end.
   - **Leave one distance out:** when testing at distance D, the model never saw the watch copy of the words said at D.
   - It fires when 2 consecutive windows score ≥ 0.8, then waits 1.5 s.
   - A word counts as heard if it fires between the word's start and 1 s after its end. Anything else is a false trigger.

## Results

### Voice over noise and dictation, per distance (player, 31 words)

| Distance | SNR camera phone (median) | SNR watch (median) | Whisper read "salvar" — phone | — watch |
|---|---|---|---|---|
| 2–3 m | 12.6 dB | 23.6 dB | 3/10 | 9/10 |
| 5 m | 7.5 dB | 26.5 dB | 2/10 | 5/10 |
| 9 m | 7.7 dB | 27.6 dB | 1/11 | 5/11 |

9 m is not worse than 5 m because the player spoke louder there and the noise varied. Per-word values are in `results/dist.csv`.

### Engines compared

| Engine | Where | Heard | False triggers |
|---|---|---|---|
| App today (Apple on-device dictation) | camera phone, real game | 12/27 (44%) | 0 in the game |
| Whisper small (dictation, stronger) | camera phone, 3–9 m | 6/31 (19%) | — |
| Whisper small | watch, same words | 19/31 (61%) | — |
| **Detector prototype** | **camera phone, 3–9 m** | **31/31** | **0 in 6.3 min** |
| **Detector prototype** | **watch, same words** | **30/31** | not measured (watch noise was used in training) |

Threshold sweep (phone, held-out): at 0.9 or 0.95 with two windows in a row it still hears 28–29 of 31 with 0 false triggers. So there is room to trade a little recall for safety.

## Caveats

- **One evening, one court, one main speaker.** The test words are the player's own. The model learned his voice from home and from the watch, never from the camera phone and never the same word.
- **False triggers measured over only 6.3 min.** Production needs something like ≤1 per hour. That calls for 30+ min of noise-only recording from different venues.
- **Training and test noise come from the same night.** Another venue (indoor court, other music, crowd) may behave differently.
- **Other voices at distance are not scored yet.** Their close recordings were used for training. Aligning their watch audio to the phone clips was not reliable enough for word-level labels.
- **License to confirm before shipping.** openWakeWord's code is Apache-2.0. Its *pretrained wake-word models* are not used here. The two shared feature models (mel + embedding) must have their license checked against the project rule (free, no GPL/AGPL, commercial use allowed). If they don't pass, the same recipe works with our own small feature network.

## Next steps

1. **Second field test** (another venue, if possible):
   - 30+ min noise-only with the camera phone, voice OFF, for false triggers per hour.
   - Distances 3/5/9/12 m for 2–3 other people, with the phone saving through the remote so labels are easy.
   - The app's own voice trigger ON at distances in a separate pass, to get its baseline at each distance.
2. **More voices for training.** Short close-mic "salvar" recordings from as many people as possible (men, women, accents), a few each. Synthetic voices are an option to explore.
3. **Port the prototype.** Core ML (iOS + watchOS 11) and TFLite (Android), measure CPU/battery on device, and run it alongside today's trigger in a test build, comparing events in the Diagnóstico.
4. **Watch.** Listen only while the screen is lit and the camera phone is recording (decided 2026-11-23). It sends the same "save" event as the button.

## Reproduce

```
cd docs/voice-lab/lab/tools
# needs: ffmpeg, python3 with numpy scipy soundfile scikit-learn onnxruntime sherpa-onnx silero-vad
# models (GitHub releases): k2-fsa/sherpa-onnx asr-models/sherpa-onnx-whisper-small.tar.bz2 -> ./sherpa-onnx-whisper-small/
#                           dscripka/openWakeWord v0.5.1 melspectrogram.onnx, embedding_model.onnx -> ./oww/
python3 mark.py marks ../wav16/*.wav        # VAD + Whisper marks
python3 align.py "../wav16/Gravação 2.wav" ../wav16/3m*.wav ../wav16/5m*.wav ../wav16/9m*.wav
python3 eval_dist.py                         # SNR + dictation per word -> results/dist.csv
python3 detector_v1.py                       # trains the leave-one-distance-out models (variants A/B) -> clf_*.pkl
python3 eval_saved.py                        # scores variant B on phone and watch
```
