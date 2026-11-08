# Basketball field test fixes — design

Date: 2026-11-07 · Status: approved, being implemented

## 1. Why

The 2026-11-07 field test (indoor basketball court, hot gym, phone in its case, AB Shutter3 remote in a pocket) showed:

- **Gesture saves nobody asked for.** Four clips the player sent all fired on someone with both arms up and moving —
  a rebound, a contested shot, a shooter, a defender — every time with the back or the side to the camera. The wave
  rule never looks at which way the person faces, and side-on the shoulders overlap, so every hand movement measured
  in shoulder widths looks huge.
- **Heat.** The phone sat at `serious` from 09:41 to the end. It only cooled (to `nominal` in ~9 min) with the app
  closed. Between recordings the app kept it hot: the camera preview on the setup screen plus the Modo Foco queue
  analysing the clips just saved (09:41: `fair` → `serious` with no recording). Every recording opened at 1080p60 while
  already `serious` and restarted at 1080p30 two minutes later: each restart empties the buffer (a 3 s and a 6 s clip)
  and drops the microphone for a moment. `critical` was never reached, but it stops the recording when it is.
- **A recording left open.** The app went to the background mid-recording and was closed: that recording never got an
  end, stays in Minhas gravações with 0 min and cannot be deleted.
- **The remote.** The player could not start or end a recording from the court, could not hear the save chime (system
  volume 0.40 in a noisy gym) and pressed again to be sure. One press may have been accidental (pocket, a bump); the
  log cannot tell a press from a hold or a bump.
- **Clips.** Finding who a clip is about, and which recording was looked at last, takes too long.

## 2. Gesture: only a person facing the camera

A wave counts only when the person faces the camera (`Facing.towardCamera`, ReplayCore):

- **Face visible:** nose and both eyes seen with confidence ≥ `Facing.minEyeConfidence` (0.3). From the back the face
  joints are missing; side-on one eye is.
- **Shoulders open:** the shoulder width is at least `Facing.minWidthToTorso` (0.45) of the torso (shoulder line to hip
  line), or, with the hips not seen (a railing, the frame edge), at least `Facing.minWidthToHead` (1.0) of the head
  height (nose to shoulder line). Side-on the shoulders overlap and the width collapses. Vision's shoulder joints sit
  inside the shoulders (~0.31 m on the 2026-10-27 test), so a person facing the camera gives ~0.6 of the torso and
  ~1.5 of the head; side-on ~0.2–0.3 and ~0.5.
- Applies to the wave (`WaveTracker`) and to the "arms raised" cue that speeds up sampling (`WaveTracker.armsRaised`):
  arms up away from the camera no longer make the detector work faster either.
- `Pose` carries eyes, ears and hips too; the gesture trace (spike / gesture test) logs every joint, its confidence and
  `facing`, so the thresholds can be tuned from field data.
- Target: a deliberate wave recognised from **10–15 m**. The four clips of 2026-11-07 are the negative cases.

**Diagnóstico switch "Gesto desligado"** (diagnostic builds only): the next recording runs with the gesture off,
whatever the setup says, so two recordings in the same conditions show how much heat and battery the gesture costs
(the session pulse already logs both every minute). The recording's first log line says so.

## 3. Recordings left open by a closed app

At launch no recording can be running, so every recording without an end gets one: the time of its last clip, or its
start when it has none. It then shows its real length and can be deleted like any other.

## 4. Heat

### 4.1 Modo Foco runs when a recording is opened

- A saved clip is marked pending and waits.
- The queue analyses the clips of a **recording that is open** (the recording screen, `session/[id]`), in the order
  they were saved, and a clip opened in the editor always goes first.
- Nothing starts while the camera is on (setup preview or recording); a running analysis is stopped and redone later.
- Leaving the recording screen stops starting new ones (the one running finishes).
- Clips a closed app left pending wait for their recording to be opened.
- Cost: a clip opened before the queue reaches it waits for its analysis (~9 s for 15 s); exporting with Modo Foco waits
  the same way. The camera and the phone's heat come first.

### 4.2 Hot at the start: 1080p30 from the first second

When the camera opens with the phone `serious` or hotter, it opens at 1080p30 (`ThermalLadder` starts one step down),
and a recording that starts while the phone is `serious` or hotter on a camera still above 1080p30 reopens it first.
No more two minutes at 60 fps followed by a restart. The heat banner shows from the start.

### 4.3 The ladder

| Phone | Quality |
|---|---|
| `nominal`, `fair` | what the player chose |
| `serious` for 2 min (or at the camera's start) | 1080p30 |
| `critical` | **720p30 at once** |

- The recording never stops because of the app. It only ends when iOS itself takes the camera away for heat
  (`AVCaptureSession` interruption `videoDeviceNotAvailableDueToSystemPressure`): then the recording ends with
  "A gravação parou: celular muito quente", keeping the clips.
- The quality never goes back up during a session (each step restarts the writer and empties the buffer).
- The gesture keeps running at every level (lighter from `serious` on, as now).
- What the player sees about heat (2026-11-08), always as advice for a better recording, never as an alarm or a fault
  of the app:
  - `nominal` / `fair`: nothing.
  - `serious` (once per recording, 8 s, gone by itself): "Dica para gravar melhor — Sem capinha e fora do sol, o iPhone
    trabalha mais fresco e mantém a melhor qualidade."
  - A quality step (each step once, 8 s): "Gravação estável em 1080p/30" (or 720p/30) with the same advice; then only a
    small quality chip at the top for the rest of the recording. Neutral card, no warning colors.
  - Screen economy says "para poupar bateria", not heat.
  - Before a recording, until the player turns it off: a "Prepare o celular" sheet (no case, out of direct sun, charged
    beforehand), "Não mostrar de novo" on by default, "Entendi, começar". A start from the remote's hold skips it.

## 5. The Bluetooth remote

### 5.1 Press and hold

Capture events (iOS 17.2+) now reach JS with their phase, `began` and `ended`:

- **Press** (released before 3 s): saves a clip, as before. Decided when the button is released.
- **Hold 3 s** (`REMOTE_HOLD_MS`): decided while the button is still down, with its own sound and flash.
  - Recording → ends it. The phone stays on the setup screen, camera on, ready for the next hold; the recording is in
    Minhas gravações (a recording with no clips is deleted, as the screen's own end does). The recording screen is
    not opened: from the court nobody looks at it, and the next start needs the camera.
  - Setup screen, nothing running → starts a recording with what the setup shows (same as "Começar gravação").
- An `ended` without its `began` (the hold that started or ended a recording, seen by the next screen) is ignored.
- The volume path (fallback, older iOS) has no phases: every change is a press.
- The log writes each press with its length in ms ("CLIQUE (captura, secondary, 120 ms)") and each hold. First field
  check: does the AB Shutter3 report a hold at all, or send press and release together?

### 5.2 Feedback for each action

| Action | Sound | Torch |
|---|---|---|
| Clip saved | rising two notes (as now) | 2 short blinks (as now) |
| Recording started | three rising notes | 1 long blink |
| Recording ended | three falling notes | 3 short blinks |
| Failed | low double beep (as now) | — |

The player's sound and flash preferences apply to all of them.

### 5.3 Louder while recording

During a recording the system volume goes up to at least 0.75 (`RECORDING_VOLUME`) so the chimes reach the court, and
goes back to the player's level when the recording ends. With the remote listening, the volume path parks there
instead of at the player's level (0.75 + one press step stays below the top, so the fallback still hears presses).

### 5.4 Not done

- Keeping the remote awake: iOS owns its connection and the AB Shutter3 sleeps on its own timer, reset only by a press.
  The drops of 2026-11-07 came after 52–63 s without a press, too soon for its sleep: range and the body blocking the
  signal (remote in a pocket). Carry the remote on the wrist or arm.

## 6. Clip label

The clip's name becomes its label: one per clip, free text, **25 characters** (`MAX_CLIP_NAME`), free plan included.
"cesta de 3 victor", "toco do marcão", "assistência do fernando".

- The clip card (option C): a framed card with three strips. Top: the label, centred ("+ Etiqueta" in accent without
  one). Middle: the thumbnail with #number (top left), time of day (top right), length (bottom right), "Na galeria" /
  "Compartilhado" (bottom left). Bottom: only how it was saved, icon and name, centred. The arm wave is called "Gesto"
  everywhere.
- Tapping the label opens a small sheet: the text field and the labels already used in this recording (one tap reuses
  one). Saved on "OK" or on closing. Empty removes it.
- The clip editor keeps editing it (same field, same limit).
- Older names longer than 25 characters stay as they are until edited.
- Sharing or saving a clip with a label names the file after it ("toco do marcao.mp4"); compilations keep their name.

## 7. "Visto por último"

The last recording opened gets a "Visto por último" badge in Minhas gravações, under its clips and time
(`Prefs.lastOpenedSessionId`, set before the recording screen's first paint, with its own store so the list underneath
is already right on the way back). Deleting it removes the badge.

## 8. The saved card with the sound

The "Clipe #N salvo" card shows the moment a save starts, together with the chime and the torch, not after the file is
written. "Desfazer" tapped before the file exists undoes the clip as soon as it does; a failed save removes the card
(and plays the failure beep).

## 9. Field test checklist

1. Gesture: deliberate waves facing the camera at 5, 10 and 15 m (5 each): how many saved. A full game: false saves.
2. Gesture off vs on (Diagnóstico): two 10 min recordings back to back, same place; heat and battery per minute.
3. Heat: a recording started hot opens at 1080p30 with the banner; no camera restart in the first minutes.
4. Modo Foco: no analysis on the setup screen or while recording; opening a recording analyses its clips.
5. Remote: the log shows press lengths; hold 3 s on the setup screen → start (sound + 1 long blink); hold 3 s while
   recording → end (sound + 3 blinks), back on the setup screen; short presses still save clips.
6. The save chime heard from the far end of the court.
7. Close the app mid-recording, open it again: the recording has an end and can be deleted.
8. Labels: add from the list, reuse a suggestion, share a labelled clip.
