# Continue a finished recording — design (2026-11-23)

Mockups: Claude Design canvas "Reprize · Continuar gravação" (B3 menu option, C1 confirmation, C2 recording badge).

Status (2026-11-23): implemented, pending a device test.

## Intent

Matches stop and start again: a break, a change of court, rain. Today the player either leaves the camera running
(screen on, battery and heat) or ends the recording and starts a new one, splitting one match over two recordings. With
this feature the player ends the recording as usual and, within **1 hour of the last end**, continues the same
recording: new clips are added to it, numbered after the last one. A continuation can happen several times, each one
opening a new 1-hour window from its own end.

## Goals

- Continue the player's most recent own recording up to 1 h after it was last ended, as many times as wanted.
- Keep the change to the current layout small: one option in the recording's "⋯" menu, a confirmation, a badge on the
  camera while continuing.
- Duration and stats count only the time actually recorded (no pauses).

## Non-goals

- More prominence (a card on the camera, a floating button). Possible later; the mockups A1–A3, B1, B2 stay as options.
- Merging two existing recordings.
- Continuing received recordings.

## Anti-goals

- A way around plans: a recording unlocked with a Single Pass after it ended can never be continued; a free recording
  stays free when continued and a paid one stays paid (the plan is still fixed by the recording's start).
- Any change to live share links: a link keeps the clips it was made with.
- Any server cost or change.

## Approaches

- **Picked: B3 + C1.** "Continuar gravação (até 10:42)" as the first option of the recording's "⋯" menu, only while
  continuing is possible; a glass confirmation (C1) before the camera opens. Smallest change to today's screens.
- A1 card on the camera screen (recommended for visibility) and B1/B2 on the recording screen: left for later, if the
  feature needs more prominence.
- Asking "continue or new?" on every record tap: rejected, it slows every start during the window.

## Rules

1. **Who can be continued:** the latest own recording (by `startedAt`), ended, not received, without
   `passTransactionId`, and `now - endedAt <= 60 min`. Any later recording (even an empty one) closes the window for the
   earlier one. The option appears and disappears with that rule (re-checked every minute while the screen is open).
2. **Confirmation (C1)**, in the glass dialog:
   - no live link: title "Continuar a gravação?", body "A câmera abre pronta para você posicionar o celular. Os
     clipes novos entram nesta gravação, depois do #12.", buttons Cancelar · Continuar;
   - live link (own or in a group, `liveLinkExpiry`): same title, body "Ela tem um link ativo. Os clipes novos não
     entram nele: para enviá-los, desligue o link e crie um novo.", buttons Cancelar · Continuar.
3. **Continuar opens the camera ready, not recording** (the phone usually goes back on its stand first): the setup
   screen with the badge "↻ Continuando · <recording label>" above the controls and an ✕ on it that drops the
   continuation (back to a normal new-recording setup). The sport is the recording's and cannot be changed;
   quality, clip length, lens and triggers can.
4. **Record** continues the recording: it is reopened (`endedAt` cleared), the pause is added to `pausedMs`,
   `resumedAt` is set, the camera opens with the recording's plan (`sessionPlan`), the clip count starts at the
   recording's count, and the same "Segure para encerrar" ends it again. If the window closed while the camera was
   ready, Record asks instead (glass dialog): "O tempo para continuar acabou" / "Já passou 1 hora desde que a
   gravação terminou. Começar uma nova gravação?" · Cancelar · Nova gravação.
5. **While recording a continuation** (C2): the badge "↻ Continuando · <label>" stays at the top; the clock counts from
   the continuation; the clip pill shows the recording's total clips.
6. **Duration:** `recordedMs = endedAt - startedAt - pausedMs` everywhere it is shown (list, recording screen). The
   date and the place in the list stay those of the start.
7. **App closed mid-continuation:** `closeOpenSessions` ends it at the later of its last clip and `resumedAt`, so the
   pause math never goes negative.
8. **Links:** unchanged; new clips are not in a live link (only a new link after turning it off takes them).
9. **Analytics:** `recording_continued` with the pause bucket (`<10min`, `10-30min`, `30-60min`) and the plan.

## Data

`Session` gains `pausedMs?: number` (sum of pauses) and `resumedAt?: number` (last continuation). Old recordings
have neither and keep today's duration.

## Left to the builder

- Where the continuation intent lives between the menu and the camera (a route param on the setup screen, e.g.
  `/setup?continue=<id>`), and how the session hook starts with an existing session (a `continue(sessionId)` beside
  `start(sport)`, sharing the camera-opening steps).
- Copy in en.
