# Link for picked clips — design (2026-11-23)

Builds on `2026-11-16-recording-sharing-design.md` and `2026-11-22-multi-recording-share-design.md`.

Status (2026-11-23): implemented on feat/sharing, pending the native build and a device test.

## Intent

A recording can already be shared whole by link (QR, web page, download into the app). The owner often wants to send
only some plays. A link for **picked clips** is the same link, with fewer clips: same upload queue, same cut and sound
rules (§5.8 of the multi-recording design), same page, same download. On the recipient's phone the clips arrive inside
**the recording they came from** (its name, sport, date and minutes) and keep their number there ("Clipe #5"), so the
origin stays clear.

## Goals

- From the recording's clip selection, create a link with only the picked clips.
- Keep **Enviar** (the iPhone share sheet with video files) exactly as it is today.
- Reuse everything built for recording links; the only difference is the list of clips.

## Non-goals

- A link from the single clip screen (Editar · Salvar · Enviar stays as is; one clip is picked by holding it on the
  recording screen).
- Picked clips from several recordings in one link.
- Received recordings: they still cannot be shared (decision unchanged).

## Anti-goals

- Two live links for the same recording.
- Extra cost for sender or recipient (no re-encoding, no extra requests, no polling).
- Any change to how Bola and Jogadores work today.

## Approaches (picked: A)

- **A — two buttons in the selection bar (picked).** The link icon (the same one Minhas gravações uses for
  Compartilhar) joins the bar next to Enviar: `[link] [Enviar]  N clipes selecionados  [Apagar] [⋯]`. Each icon means
  the same thing across the app; the confirmation spells out the difference the first time.
- B — Enviar asks "Compartilhar link" or "Enviar vídeos". The bar stays the same, but sending files, which is direct
  today, gets one more tap, and it differs from Minhas gravações.
- C — Compartilhar inside "⋯". Nothing changes in the bar, but the feature is hidden.

## Decisions

1. **Selection bar:** icons only, no text on the buttons (as today). The left side gets **Compartilhar** (link icon;
   VoiceOver reads "Compartilhar N clipes por link") before **Enviar**. Same PRO rules as the recording link: on the free plan it opens the paywall. Only on an ended, own
   recording (`canShareHere`); hidden otherwise.
2. **Confirmation** (as `confirmShare`): "Compartilhar 3 clipes dessa gravação?" / "Vamos criar um link com estes 3
   clipes da gravação Final do torneio. Quem tiver o link pode ver e baixar por 24 horas." Buttons Cancelar ·
   Compartilhar.
3. **One live link per recording.** If the recording already has a live link (whole, picked clips, or inside a group
   link), no new link is created: a notice says "Esta gravação já tem um compartilhamento ativo" / "O link vale por
   mais 18h. Para enviar outros clipes, desligue o link atual." with Fechar and **Ver link** (opens the existing share
   sheet, `/share/<id>`, which already redirects to the group sheet).
   The same holds the other way: "⋯ → Compartilhar" on a recording with a live picked-clips link opens that link.
   Once it ends (turned off or expired), a new link can be made.
4. **What travels:** `shareRecording(sessionId, clipIds?)` filters the clips; everything else (input, upload plan, prep
   jobs, confirm, sizes) is the same code. The share is `kind: 'recording'` with the picked clips, so the server,
   `open-share`, the web page and the receive queue need no change. Each clip keeps its own number.
5. **Sender's share sheet** (`ShareLinkPanel`): says "3 clipes desta gravação" instead of the whole count; upload
   progress counts only the picked clips. The recording shows the usual "Compartilhando" badge.
6. **Recipient:** one received recording with the picked clips, with the recording's name, sport, date and minutes,
   like a whole-recording link with fewer clips.
7. **Limits:** the existing 600-clip cap per link (any pick of one recording is under it).
8. **Analytics:** `share_created` gains `picked: true` and the clip count.

## Calls left to the builder (marked as Claude's calls)

- Route param for the picked ids (`/share/<id>?clips=<ids>`), validated against the recording's clips.
- A later link with other clips of the same recording (after the first one ended) arrives as its own received
  recording, as a new whole-recording link does today; merging the two on the recipient's phone is out of scope.
- Copy for en.

## Tests

- Selection bar: Compartilhar shown only where sharing is allowed; the paywall on free; the notice with Ver
  compartilhamento when a live link exists.
- `shareRecording` with `clipIds`: input, plan and prep jobs hold only those clips, numbers kept.
- Share sheet text with picked clips; `confirmShare` copy for clips.

## Glass dialogs (approved 2026-11-23)

The confirmation (2) and the live-link notice (3) are drawn in the app's glass, not the iPhone's plain alert: a
rounded card (`rgba(38,38,38,0.86)` with blur, light rim), centred title and body, and two pill buttons side by side
(the left one quiet, the right one amber). A new `GlassDialog` component; the recording-share confirmation
(`confirmShare`, one or several recordings) moves to it as well, so every share confirmation looks the same. Other
alerts in the app stay as they are for now (a later pass, if wanted).

## Export progress card (approved 2026-11-23)

Salvar and Enviar (one clip, and several from the recording screen) show the iPhone-style card from the reference
recording: a glass card, the title at the top left ("Preparando o vídeo…", "Preparando 2 de 3…"), a ring filling in
amber with the percent under it, and a wide **Cancelar** pill.

- **Real progress:** the native export reports `AVAssetExportSession.progress` as an `onExportProgress` event
  (`{ exportId, progress }`, a few times a second, only while an export runs; no network). Several clips add up to one
  percent for the batch.
- **Cancelar stops at once:** a new native `cancelExport(exportId)` calls `cancelExport()` on the running session; the
  export rejects with `CANCELLED`, its partial file is removed, and the card closes. A batch cancels every running
  export, not only the ones still waiting (today it waits for the running ones to finish, which is the delay seen in
  testing). The single clip screen gains the same Cancelar.
- Once the video is ready, "Salvando na galeria…" / "Abrindo o compartilhamento…" keep the ring full and no Cancelar
  (the gallery write and the share sheet cannot be stopped halfway).
- Where the build has no progress (an older build, Android), the ring spins without a percent; Cancelar still stops
  what can be stopped.
- The time each export takes is measured separately (diagnostic lines `clipe exportação: … render … ms`) before any
  change to how the video is made.

## Mockups

Claude Design canvas "Reprize · Link de clipes e progresso" (2026-11-23): selection bar, confirmation, link already
live, and the new progress card (see the export progress notes, decided separately).
