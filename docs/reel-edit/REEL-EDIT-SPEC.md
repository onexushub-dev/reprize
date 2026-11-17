# Reel Edit Spec — "punch cut" grammar

Reverse-engineered from an Instagram reference reel (NBA highlight edit) and
applied to beach tennis footage. This document is the reusable part: the
reference video itself is not needed to rebuild or extend the edit.

All numbers below were measured frame by frame, not estimated.

---

## 1. The four elements

The reference uses only four devices. No slow motion, no synthetic zoom, no
crossfades, no camera shake — those were all tested for and found absent.

### 1.1 The punch — a hard colour snap at the apex

At the climax of each play the image switches, in a single frame, to a
desaturated and darker grade. There is no ramp. It holds until the next cut.

Measured transform (fitted on three clean transitions where the same shot
continues across the snap; residual error dropped ~70% vs. no transform):

```
out = in^1.40 * 0.90      # gamma 1.40, gain 0.90
then saturation -> 0.30   # keeps 30% of the original colour
```

Effect: luminance ~0.62x, saturation ~0.43x, crushed blacks.

ffmpeg implementation:

```
lutrgb=r='255*pow(clip(val/255,0,1),1.40)*0.90':g='...':b='...',
colorchannelmixer=rr=0.5093:rg=0.4109:rb=0.0798:
                  gr=0.2093:gg=0.7109:gb=0.0798:
                  br=0.2093:bg=0.4109:bb=0.3798
```

The mixer matrix is the standard desaturation matrix for s=0.30 against
Rec.601 luma (0.299 / 0.587 / 0.114). Do not use `eq=saturation=` here — it
barely moved saturation on this material in testing.

### 1.2 The return — hard cut back to full colour

The graded section ends on a hard cut to the next clip, in full colour,
landing on a bass hit. No transition of any kind.

### 1.3 One-frame blown-out flash

Single frames at roughly 4x exposure (clipped), reading as a white strobe.
Nine of them in the 45s reference, all in the second half, used as rhythmic
accents **inside** a shot — they do not mark cuts.

```
eq=brightness=0.34:contrast=1.25:saturation=0.35   # one frame only
```

Note: these are *not* photographic negatives, despite looking like it at
first. A negative model fit far worse than an exposure blow-out.

### 1.4 Eighth-note quantisation

Every edit event in the reference lands within ±0.12s of the 1/8 grid of the
track. Cuts, snaps and flashes are all quantised.

---

## 2. Structure

Each slot is one continuous take:

```
[ build ] -> APEX (snap to grade) -> [ hold ] -> hard cut to next slot
```

The reference accelerates: colour blocks shrink 7.2s -> 6.0 -> 5.7 -> 3.9 ->
3.3 -> 3.1, while holds shrink from 3.2s to 0.7s. Reproduce this by scaling
the hold with the gap between punches rather than using a fixed value:

```python
hold = min(2.60, max(0.75, gap * 0.30))
```

Tight musical section -> quick punch. Open section -> long hold.

---

## 3. Known traps

Two bugs cost a full render cycle each. Both are about frame boundaries.

**Half-frame `enable` windows.** ffmpeg timeline `enable='between(t,a,b)'`
compares against each frame's PTS. A nominal time like `43.067` sits just
above the frame at `43.0667`, so the target frame is silently skipped.
Always quantise to the frame and widen by half a frame:

```python
f = round(t * FPS) / FPS
enable = "between(t,%.4f,%.4f)" % (f - 0.5/FPS, f + 0.5/FPS)
```

**Grade bleeding one frame into the next clip.** Slot boundaries rarely fall
on exact multiples of 1/FPS, so each segment gets rounded to a whole frame
count when cut. Using the *nominal* slot end as the window end grades the
first frame of the following clip. Anchor windows to the real cumulative
frame counts of the rendered segments instead (see `build_reel.py`).

Verify every build by sampling saturation and luminance per frame and
asserting that each snap, each colour return and each flash lands on the
expected frame index. Do not trust the nominal times.

---

## 4. Audio

The reel is cut to the music, so the music drives the structure.

- Find the punches as **sharp rises in 30-110 Hz energy**, not generic onset
  detection. On trap/phonk material the bass attack is the edit anchor.
- The cut back to colour lands on the *silence* immediately before the hit;
  the bass arrives 0.1-0.3s later. Do not cut on the peak.

**Delayed music start.** When the opening clip needs more lead-in than the
track gives before its first hit, do not insert silence into the middle of
the track. Either delay the whole music start, or pause the track at a chosen
point and resume it from the same point, so the track stays continuous. The
pause length is `clip_apex - track_first_hit`.

Cover the pause with the match's own natural audio. Raw phone audio has peaks
near 0 dB but a weak body, so apply gain plus a limiter rather than a
compressor without make-up gain:

```
volume=0.725,alimiter=limit=0.92:level=disabled
```

Level it against the music intro (~-19 dBFS) so the pause reads as intentional
rather than as a dropout, then back off from there if the raw track carries
bystander conversation. The current build sits 6 dB under that (~-25 dBFS):
enough ambience to feel live, not enough to make the talking legible.

---

## 5. Titles

Centred both axes, bold grotesque (Inter Bold), white with a black outline —
matching the reference's caption treatment.

```
drawtext=fontfile=Inter-Bold.otf:fontsize=76:fontcolor=white:
         bordercolor=black:borderw=5:x=(w-text_w)/2:y=(h-text_h)/2
```

Drawn **after** the grade and flash passes so the text is never desaturated
or blown out. Text swaps are instantaneous on the punch frame.

---

## 6. Outro

CapCut-style end card, built frame by frame in PIL (`build_outro.py`) rather
than with ffmpeg filters — the staggered entrances, the per-word colouring and
the typewriter all need per-frame control.

Type is Outfit Bold: geometric, close to Instagram's own caption face, and
narrow enough to set the long line at 54px where Poppins only reaches 47px.
White with a 3px black stroke; the emphasised words are brand amber.

    Baixe agora o Reprize
    e nunca perca os seus melhores lances

Amber on `Baixe agora`, `Reprize`, `melhores lances`.

Brand values, sampled from `docs/brand/reprize/social/reprize-avatar-1080-escuro.png`:

- background `#0A0A0A`
- amber `#FFB000`
- the symbol is extracted from that avatar by masking everything that differs
  from the corner colour, so no separate logo export is needed

Beats, over 4.2s:

| Time | Event |
|------|-------|
| 0.00-0.45 | logo fades in, scaling 0.88 -> 1.0 (ease-out cubic) |
| 0.45-1.00 | two CTA lines enter staggered 0.15s apart, rising 22px |
| 1.25-1.85 | `@reprize.app` types at 0.05s/char, amber underline grows with it |
| 1.85-3.30 | cursor bars blink at 0.42s |
| 3.30-4.20 | held, cursors gone |

The two cursor bars start together at centre and separate as the text grows
between them — copied from the reference.

The outro is encoded with the same libx264 settings as the main render so it
concatenates without a re-encode. Music keeps playing underneath and fades
over the last 0.9s.

---

## 7. Picking apexes

Automatic detection (audio transient + motion drop + crowd rise) consistently
drifted to the celebration rather than the decisive shot. It is useful for
shortlisting only.

The apexes that work are the frames where **the point is decided** — not the
most spectacular mid-rally jump. These were marked by hand against a single
concatenated review video with burned-in timecode, which is the fastest
workflow: join every clip untrimmed, burn clip name plus local and global
timecode, mark global times, convert back to clip-local.

---

## 8. Current build

Music: *Who's Lovin You (Hoodtrap Extended)* — neverbadagain, 320 kbps.
Output: 1080x1920, 30 fps, 72.575s (2175 frames) — 68.375s of reel plus a 4.2s outro.

Music pauses at 0:04 of the track for 6.115s, covered by the match's natural
audio, and resumes from the same point so its bass entry (4.62s into the
track) lands on the opening smash at 10.735s.

| # | Punch | Clip | Build | Hold |
|---|-------|------|-------|------|
| 1 | 10.735 | 11 (the smash) | 10.74s | 2.47s |
| 2 | 18.955 | 13 | 5.75s | 2.60s |
| 3 | 28.835 | 6 | 7.28s | 1.61s |
| 4 | 34.195 | 14 | 3.75s | 1.10s |
| 5 | 37.865 | 2 | 2.57s | 1.02s |
| 6 | 41.255 | 4 | 2.37s | 1.70s |
| 7 | 46.905 | 8 | 3.95s | 2.60s |
| 8 | 55.945 | 5 | 6.44s | 1.61s |
| 9 | 61.305 | 7 | 3.75s | 1.10s |
| 10 | 64.975 | 10 | 2.57s | 3.40s |

Flashes at 36.36, 39.56, 44.08, 48.60, 52.26, 58.77, 63.29, 67.82.

Titles: "The art of..." from 0:00, swapping to "App Reprize!" on punch 1,
held 5.00s (150 frames) then gone.

Clip 9 dropped (landscape, static). Clips 1, 3 and 12 unused — no clear apex.

### Capacity note

The ten apexes together need ~81s of lead-in but the reel is 68.4s, so ~13s
of head trimming is unavoidable. `solve.py` distributes it so no single clip
loses much (max ~5.5s) instead of sacrificing one. Fewer punches would allow
longer, less trimmed clips.

---

## 9. Files

- `build_reel.py` — renderer. Timeline, grade, flashes, titles, outro concat,
  audio. `--reuse` skips re-cutting segments when only colour/audio changed.
- `solve.py` — assigns clips to punches. Brute-forces all 9! orders under the
  lead/tail constraints and scores for hold rhythm and even trimming.
- `build_outro.py` — end card. Run it before `build_reel.py`; the renderer
  picks up `build/outro.mp4` automatically if it exists.

Source clips and renders are not in git (see `.gitignore`).
