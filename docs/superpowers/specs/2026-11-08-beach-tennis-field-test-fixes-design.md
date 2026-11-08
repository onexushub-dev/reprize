# Beach tennis field test fixes — design

Date: 2026-11-08 · Status: approved, being implemented

## 1. Why

The 2026-11-08 field test (outdoor beach tennis, morning, phone without its case, AB Shutter3 remote) went well: no
accidental clip, heat `nominal` for two hours, every 3 s hold started or ended a recording. It showed:

- **The remote sleeps after exactly 5 minutes without a press.** Three drops at 300.0, 300.2 and 300.5 s after the last
  press. The press that wakes it only reconnects and never reaches the app; the player presses again.
- **Start, end and clip are hard to tell apart on the court.** The sounds are lost in the noise, and the torch of
  "ended" (3 short blinks) is one blink away from "clip saved" (2 short blinks).
- **The setup screen costs almost as much as recording.** The camera opens there exactly as for the game: same format
  and frame rate, the encoder filling the buffer, the microphone on and the screen at full brightness. Only the gesture
  is off. A player who sets the phone up and goes to warm up pays for all of it.
- **A dark shadow over the bottom of every clip** (clip screen and exported files): the share overlay draws a black
  gradient over the bottom 60% of the video, with or without the watermark.
- **The diagnostic log is hard to read**: one free-text line per event, no way to see only the remote or only the heat.

## 2. Share overlay: no gradient

`ShareOverlay` draws the bands (landscape) and, on the free plan, the mark. The bottom gradient is gone: the mark's own
dark pill keeps it readable on any video. Clip screen preview and exported file stay identical (same component).

## 3. Setup screen: a lighter camera

### 3.1 Preview without the buffer

The setup screen opens the camera in **preview** (`startSession({ preview: true })`):

- the camera runs and the preview shows, but **no encoder and no buffer**: `SegmentWriter` is not created, frames only
  feed the preview (and the watch / phone-remote previews);
- the frame rate is held at **30 fps** (`CaptureController.previewFps`) even when the format records at 60: the format
  is not changed, only the frame duration, so going back to 60 needs no session restart.

`startBuffering()` (native) runs when the recording starts, after the camera is open and before the session is created:
the frame rate goes back to the recording's, the ring is emptied and the writer starts. The buffer never held setup
footage that a clip could use (clips are cut from the recording's start), so nothing is lost. A thermal camera restart
keeps the mode it was in (preview stays preview). Android: `preview` is ignored and `startBuffering()` does nothing.

### 3.2 Pause after 35 s without a touch

On the setup screen, nothing running, no sheet open: **35 s** (`SETUP_IDLE_MS`) without a touch on the screen or a
remote press, enough to place the phone and check the framing, pause it:

- **5 s before** (`SETUP_WARN_MS`), a card in the middle of the screen counts down: "A tela vai descansar em 5 s" /
  "Para poupar bateria. Toque na tela para continuar vendo a câmera." A touch hides it and starts the 35 s again;
- at 35 s the preview stops, the screen dims (screen economy) and the camera drops to **~5 fps** (`CaptureController.idleFps`,
  never below the format's own lowest). It keeps running: iOS sends the remote's capture events, and with them its
  hold, only to an app whose camera runs. Only the frame duration changes, never the format: same resolution, no
  restart. Back from the pause it returns to 30 fps; a recording started from the pause goes straight to its own rate
  (Full HD 60, say) with `startBuffering()`, again without a restart;
- the screen shows "Tela em descanso" / "Para poupar bateria. Toque uma vez para ver a câmera de novo." and, with a
  remote paired, "Segure o botão do controle para começar a gravar." (en: "Screen resting" / "To save battery. Tap once
  to see the camera again." / "Hold the remote button to start recording.");
- a tap anywhere, or a remote press, turns it back on; a hold on the remote starts the recording directly, with no
  tap first.

Not paused while the gesture or voice practice, the "Prepare o celular" sheet or the Dispositivos sheet is open.

## 4. Remote: the press that wakes it only wakes it

The 2026-11-08 log tells the remote's sleep from range:

| | Sleep | Range or body |
|---|---|---|
| When the link drops | 300 s after the last press (300.0 / 300.2 / 300.5) | any time (55.6 s on 2026-11-08, under 3 min on 2026-11-02) |
| How it comes back | only with a press (the press is swallowed) | by itself, when back in range |

No comeback ever saves a clip, sleep included (as since 2026-11-03): the first press after 5 minutes only wakes the
remote, and the next ones save. Counting the waking press was tried on 2026-11-08 and did not work on the court; the
player already presses again, and a comeback that never counts can never save a clip nobody pressed for. A hold works
the same way: the first press wakes the remote, the hold works from the next one.

The log reads each drop (sleep when it comes 295–310 s after the last press, `REMOTE_SLEEP_MS`; range otherwise) and
says it on the comeback too ("acordou do sono" / "voltou do alcance", never counted as a press).

### 4.1 A shorter hold

The hold that starts or ends a recording goes from 3 s to **2 s** (`REMOTE_HOLD_MS`). On 2026-11-08 every hold was
deliberate and none came by accident, and 3 s (then 2.5 s) felt long on the court. A press released before 2 s still
saves a clip.

## 5. Sound and torch for each action

Distinct by the torch's rhythm (`TorchPattern`), because on the court the sound is often lost. The sounds (`Chime`)
stay as they were (decided after comparing them on the preview page):

| Action | Torch | Sound |
|---|---|---|
| Clip saved | 2 short blinks (0.12 s), as before | two rising notes |
| Recording started | **1 steady light, 1.5 s** | three rising notes |
| Recording ended | **3 slow pulses** (0.5 s on, 0.3 s off) | three falling notes |
| Failed | — | low double beep |

A preview page plays each sound and draws each torch pattern, old and new side by side, for field tests.

## 6. Diagnostic log: tagged lines

Every line has an area tag, and warnings a ⚠:

```
10:13:33 [+08:49] CONEXÃO  │ ⚠ caiu 300.2 s após o último clique — parece sono
10:14:00 [+09:17] CONEXÃO  │ voltou após 27.5 s — acordou do sono (não conta como clique)
10:14:07 [+09:24] CLIPE    │ salvo (remote)
```

Areas: GRAVAÇÃO (start, end, summary), CLIPE, CONTROLE (presses, holds, capture path), CONEXÃO (the remote's link,
sleep or range), VOLUME (the volume path), PREPARO (setup screen: pause, minute pulse), ENERGIA (battery pulses), CALOR,
CÂMERA, ÁUDIO, TELA, APP, FOCO (Modo Foco), OUTRO.

- The area comes from the line's prefix (`controle: …`), native lines included, so every caller keeps one call.
- A recording's end adds a **summary**: length, clips by source, remote drops (sleep / range), highest heat, battery at start and end, warnings.
- The setup screen logs a pulse a minute (battery, heat, camera on or paused) and each pause and resume.
- The Diagnóstico screen is the log: compact filters by area (and "⚠ alertas"), Compartilhar and Limpar. The test
  switches (screen economy off, volume path off, gesture off) and the Bluetooth probe are gone: those investigations
  are over. The shared file keeps every line in order.

## 7. Field test checklist

1. Leave the remote 5+ min without a press while recording: the log says "parece sono"; the first press only wakes it
   ("acordou do sono", no clip), the next one saves.
2. Walk out of range and back while recording: no clip; the log says "alcance".
3. Torch and sound: start, clip and end told apart from the far end of the court.
4. Setup screen: 30 s without touching → the countdown; 35 s → paused with the message; tap → back; hold the remote while paused →
   recording starts, with no tap first. Battery and heat per minute on the setup screen, before and after.
5. Clips: no dark shadow at the bottom (clip screen and exported file).
