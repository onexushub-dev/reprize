# Sharing several recordings with one link — design

Date: 2026-11-22. Author: Claude with Victor. Status: decisions approved (§2); phases 1 to 3 implemented, web page included (§4.5, §5.6, §5.7).
Builds on `docs/superpowers/specs/2026-11-16-recording-sharing-design.md` (the sharing design): everything there still
holds unless this document says otherwise.

## 1. Why

Field tests: after a session with several matches, the person recording shares every recording one at a time (open the
recording, Compartilhar, wait for the QR code, send, back, next). With a dozen matches that is minutes of tapping, and
each athlete ends up with several links to keep track of.

Goal: select up to 10 recordings in Minhas gravações, tap Compartilhar once, and hand out **one link** that brings all
of them, each one arriving on the recipient's phone as its own recording, as today. The speed (QR code in about
2 seconds), the upload queue and the security rules of the sharing design stay as they are.

## 2. Decisions (2026-11-22)

1. **Always one link**, whether one recording or several. One recording keeps today's link exactly (`kind =
   'recording'`); two to ten make a **group link** (`kind = 'group'`) on the same address,
   `reprizeapp.com/v/<code>`.
2. **Each recording stays individual.** On the recipient's phone a group link becomes one received recording per
   recording shared, each listed separately in Minhas gravações with its own title, clips, sport, duration and
   "Compartilhada por Ana" marker. Courtesies, the Single Pass rule, capture protection and exports work per recording,
   exactly as today.
3. **At most 10 recordings per link.** Selecting more disables Compartilhar with the hint "Até 10 gravações por link".
4. **Same rules as one recording:** PRO only (checked on the server), the liability notice, only ended recordings with
   clips, nothing uploads while recording, links live 24 hours, owner can turn the link off, reports take the link down.
5. **Nothing changes for links already handed out.** The single-recording flow, its tables and its functions keep
   working unchanged; the group is added beside them.
6. **The recipient chooses what to download** (Victor, 2026-11-22). A group's recordings arrive listed, each with its
   clips' stills, and nothing else downloads until the person taps **Baixar** on a recording (with its size). While it
   downloads: **Pausar** (then Continuar) and **Cancelar** (asks, then takes the clips already downloaded off the
   phone; the recording stays, ready to download again while the link lasts). A single recording's link still
   downloads at once, and gets Pausar and Cancelar too.
7. **No group title:** the link reads "5 gravações de Ana", the count and the sender's first name.

## 3. Flows

### 3.1 Sender (PRO)

1. Minhas gravações → **Selecionar** → tap 1 to 10 of one's own ended recordings with clips → **Compartilhar** (the
   PickBar's left button, `games.tsx`). Received recordings and recordings without clips cannot be picked for sharing
   (the button stays disabled with a hint, as today).
2. One recording: today's sheet (`/share/[id]`). Two or more: the group sheet (`/share/group`, §6), same steps: sign in
   if needed, the notice if not accepted, then one request to the server.
3. The sheet shows the QR code, Copiar link and Enviar link at once, and under them the list of the recordings in the
   link, each with its own progress ("7 de 12 clipes enviados") and a total ("3 de 5 gravações enviadas").
4. The uploads go through today's queue (§5.3); Pausar envio and Desligar link act on the whole link.
5. Each recording in the link shows the usual strip ("Link ativo · …"); tapping it opens the group sheet.

### 3.2 Recipient

1. Web page: "5 gravações de Ana", the cover of the first recording, the list of titles with their clip counts, the
   time left and **Ver todos no Reprize** (§7).
2. In the app: the link makes (or finds again) one received recording per recording in the link and opens Minhas
   gravações filtered on **Recebidas**, with the note "5 gravações recebidas de Ana". With a single recording in the
   link (impossible for a group, kept as a guard) it opens that recording, as today.
3. Downloads follow the queue rules of the sharing design (§5.5.1.1); the recording the person opens jumps to the
   front (§5.4).

## 4. Server

### 4.1 Data (`supabase/migrations/<date>_share_groups.sql`)

The group is a share of its own; each recording in it is a normal `recording` share pointing at it. This reuses every
rule already written for shares (expiry, turning off, cleanup, reports, members, courtesies).

- `shares.kind`: add `'group'`.
- `shares.group_id uuid references public.shares (id) on delete cascade`, null except on a group's recordings; index
  on it.
- `shares.token_hash`: nullable; check `(group_id is null) = (token_hash is not null)`: only standalone links and
  groups have a code, a group's recordings never do, so they cannot be opened without the group's code.
- A group's recordings get the group's `expires_at` and `state` at creation; they change together (§4.4).
- `shares.clip_count` on a group: the sum of its recordings' clips (the page shows it). New `recording_count smallint`
  on the group (2–10).
- Row-level security: unchanged. A member of a group is also registered as a member of each of its recordings (§4.3),
  so `is_share_member` and `use_courtesy` keep working per recording.

### 4.2 Creating (`create-share`)

New body shape beside today's: `{ kind: 'group', title?, recordings: ShareIn[] }`, 2 to 10 recordings, each as today's
`kind: 'recording'` body (clips, edit data, side files, `recordedMs`). Checks, in today's order: session, body, notice,
rate limit, PRO.

- Limits: today's per-recording limits (200 clips, 1.5 GB per clip), at most 10 recordings, at most 600 clips per group.
- Rate limit: counts **links**, not rows: `group_id is null` (a group of 10 counts once). Today 30 links per 24 hours.
- One transaction: a SQL function `create_share_group(owner, code_hash, expires_at, group jsonb)` inserts the group,
  its recordings and their clips together (today's insert-then-delete-on-error is not enough for 11 rows). The Edge
  Function keeps the code generation and the presigning.
- Cover: only the group has one (`shares/<group id>/cover.{mp4,jpg}`: the first clip of the first recording, made by
  the phone as today, §5.2). The recordings are created with `cover: false`.
- Answer: `{ shareId: <group id>, code, url, expiresAt, recordings: [{ shareId, uploads: ShareUpload[] }], cover:
  ShareUpload[] }`. Presigning is local HMAC work: about 900 URLs for 10 recordings of 30 clips is still well under a
  second.

### 4.3 Opening (`open-share`)

- `{ code }` resolving to a **group** answers `{ state: 'active', kind: 'group', shareId, title, from, expiresAt,
  recordings: [{ shareId, title, sport, total, recordedMs }] }`: no clips, no presigning, no R2 HEAD, so opening a
  group of 10 costs the same as opening one recording today. It registers the opener as a member of the group and of
  each of its recordings (one upsert of up to 11 rows).
- `{ code, shareId }` where `shareId` is one of the group's recordings answers exactly today's recording answer (clips,
  readiness by HEAD, presigned GETs). The function checks that the recording belongs to the group of that code; a
  recording id alone opens nothing. The app's receive queue calls this per recording (§5.4), so each call stays as
  small as today's.
- Report, turned off, expired and removed states are read on the group and apply to every recording in it.
- `share-page` (web): a group answers the title, `from`, expiry, cover, `recordings` count and the list of recording
  titles with clip counts. Never clips.

### 4.4 Turning off, expiry, reports, account deletion

- `share-off` on a group turns off the group and its recordings in one update (`where id = $1 or group_id = $1`, owner
  checked). On a group's recording it is refused (400): the link is the unit.
- `expire-shares`: unchanged. Each recording share has its own files under `shares/<id>/` and its own row, already
  picked by `shares_to_clean`; the group row only owns the cover. Turned off or expired together, they are cleaned in
  the same run.
- `report-share`: the code finds the group; a report takes the whole link down (every recording in it). `share_status`
  reads the group for the owner.
- `delete-account`: unchanged (it deletes the files of every share the person owns, recordings of groups included).

### 4.5 Implemented (phase 1, 2026-11-22)

- Migration `supabase/migrations/20261122200000_share_groups.sql`: `kind = 'group'`; `group_id`, `group_position`
  (1–10, the sender's order: one transaction stamps every row with the same `created_at`), `recording_count`,
  `total_bytes` on `shares`; `token_hash` nullable with `(group_id is null) = (token_hash is not null)`; a group never
  inside another and only recordings inside one; `clip_count` up to 600; `share_clips.has_thumb`.
  `create_share_group(owner, token_hash, expires_at, recordings jsonb)` (service role only) inserts the group, its
  recordings and their clips in one transaction. Checked on a scratch Postgres (PGlite) with the earlier migrations:
  rows, order, sizes, the guards, turning off together, cleanup picking every row, cascade, and a bad clip leaving
  nothing behind.
- `supabase/functions/_shared/shareBody.ts`: the body checks and the upload order, moved out of `create-share` and
  pure, with `shareBody_test.ts` (`deno test supabase/functions/_shared/`).
- `create-share`: the group branch (`createGroup`), `has_thumb` on single shares too, the rate limit counting links
  (`group_id is null`); presigning all URLs together.
- `open-share`: group list (two queries), a group's recording by `{ code, shareId }`, membership on the group and its
  recordings (`register`), a `thumb` URL per clip when the sender sends thumbnails (single links too).
- `share-page`: `recordings: [{ title, clips }]` for a group. `share-off`: a group with its recordings; refused (400
  `group`) on a group's recording.
- `report-share`, `confirm-upload`, `expire-shares`, `delete-account`: unchanged (the code finds the group; each
  recording is a share of its own).

## 5. App

### 5.1 Data

- `SessionShare`: add `groupId?: string`: the recording was shared in a group; `url` is the group's link and
  `shareId` is the recording's own share (uploads and progress stay per recording).
- New `cloud/shareGroups.ts` (MMKV): `groupId → { url, createdAt, expiresAt, sessionIds, state }`, so the sheet can show
  a group again and Desligar link knows its recordings.
- `SessionReceived`: unchanged shape; a group's recording keeps the group's `code` and its own `shareId`, plus
  `groupId?: string` so the app knows to call `open-share` with both (§4.3).

### 5.2 Creating (`cloud/shareGroup.ts`)

- Builds each recording's request with today's `recordingShareInput` (no cover), sends one `create-share`, then for
  each recording stores `Session.shared` (with `groupId`) and its upload plan (`saveUploadPlan`, `uploadItems`), and
  the group's cover plan. Same reuse rule as today: if the exact same set of recordings already has a live group link
  with more than 5 minutes left, the sheet shows it again instead of making a new one.
- A recording that already has its own live link is shared again inside the group (new share, new upload) in the first
  version. Server-side copy of files already in R2 is §10, phase 4.
- One cover per group: the sheet exports the first clip of the first recording, as today's `cover.ts`.

### 5.3 Upload queue

- No new queue: each recording is a plan, as today. Order across plans when several are waiting (`uploadQueue.ts`):
  the cover's still, then the first clip's still of every recording, then the cover video, then the clips **recording by
  recording** in the order of the link (each clip's still just before its video), so the first recordings become
  watchable first instead of every recording advancing slowly together. Not every still first: the 2026-11-21 test
  showed 90 stills ahead of the videos held the first video back half a minute.
- Same concurrency as today (the system's background session), same hold while recording or under critical heat, same
  confirmation per clip.
- Progress for the group sheet: the sum of its plans' `ShareProgress`, plus a count of recordings fully confirmed.

### 5.4 Receiving

- `/v/[code]`: a `group` answer makes one received recording per entry (`repo.startReceivedSession`, idempotent per
  `shareId` as today), queues them all, and opens Minhas gravações on Recebidas with the note.
- `receiveQueue`: unchanged per recording, except `openShare(code, shareId)` for a group's recording. Downloads run in
  the order of the link; the recording the person opens moves its clips to the front.
- Everything that reads `Session.received` (banners, courtesies, capture protection, exports, report from the app)
  keeps working per recording. Denunciar on any recording of a group reports the group (the server finds it by code).

### 5.5 Rules in code

| Rule | Where |
|---|---|
| 1 to 10 own ended recordings with clips | `games.tsx` (PickBar), helper `shareablePick(sessions)` with tests |
| PRO | `canShare(plan)` as today; the server decides |
| One link per group, recordings individual | `cloud/shareGroup.ts`, `cloud/receive.ts` |
| Upload order across recordings | `cloud/uploadQueue.ts` |

### 5.6 Implemented (phase 2, 2026-11-22)

- `cloud/sharePick.ts`: `shareablePick` (1 to 10, own, ended, with clips, at most 600 clips together), apart from the
  upload queue so Minhas gravações loads no native module for it.
- `cloud/shareGroups.ts`: the group store (MMKV `reprize:v1:share-groups`): link, expiry, state and each recording's
  session, share and clip count, in the link's order; a group is dropped a day after it expires.
- `cloud/shareGroup.ts`: `shareRecordings` (one `createShareGroup` request; each recording's `Session.shared` with
  `groupId`; one upload plan per recording plus the group's cover plan, each tagged `group: { id, position, count }`),
  `liveGroupFor` (reuse: the same set, live, more than 5 minutes left, every recording still pointing at it),
  `liveGroupOf`, `turnOffGroupShare`, `clearAllGroups` (diagnostics). The link's order is the order the recordings were
  played (`startedAt`), not the order they were tapped.
- Order across recordings: `groupPriority` in `uploadQueue.ts` gives each file of a group plan a priority (the order
  of §5.3); `UploadItem.priority` carries it to `BackgroundUpload.swift`, which keeps it with the file (resume and retry
  included) and falls back to `TransferOrder` without it. iOS treats it as a hint. **Needs a new native build.**
- Progress: `groupProgress` (sum of the recordings, recordings fully sent) and `useGroupProgress`.
- Cover: `ensureCover` makes a group's cover into the group's plan from its first recording's first clip.
- Screens: the share sheet's steps moved to `components/ShareFlow.tsx` (generic over one recording or a group);
  `/share/[id]` uses it and sends a recording in a live group link to the group sheet; new `/share/group`
  (`?ids=` from the list, `?group=` from a strip or Ajustes) with `ShareLinkPanel` (recordings chip, "abrir as
  gravações") and `GroupUploadStatus` (the card with "3 de 5 gravações enviadas" and each recording's own line).
  `ShareStrip` says "N gravações" and counts opens on the group; Ajustes > Compartilhando agora shows a group as one
  row ("Link com N gravações"). Minhas gravações: Compartilhar for 1 to 10, the limit ("Até 10 gravações por link",
  "Até 600 clipes por link") in the bar's text, the other refusals as the button's accessibility hint.
- Analytics: `share_created` has `recordings` ('1', '2-3', '4-6', '7-10').
- A recording with its own live link put in a group gets a new share (as §5.2 says); its own link stays live until it
  expires, and its upload plan keeps going. Phase 4 (server-side copy) removes the second upload.
- Tests: `sharePick`/`shareGroup`, `uploadQueue` (priorities, progress), `shares` (group request), `gamesShare`,
  `share/group` screen, `ShareStrip`.

### 5.7 Implemented (phase 3, 2026-11-22)

- `SessionReceived`: `groupId`, `download` (`on` | `waiting` | `paused`; absent = `on`) and `bytes`;
  `repo.setReceivedDownload`. `repo.listSessions` also lists a received recording without clips while its link lasts.
- `cloud/receive.ts`: `openShare(code, shareId?)` sends `groups: true`; `receiveShare` answers `{ kind: 'group',
  count, from }` for a group link after making (once) one received recording per recording, `download: 'waiting'`,
  a millisecond apart so the link's first recording is on top of the list; `startDownload` (Baixar, Continuar;
  `share_group_download` with the place in the link). `cloud/receivedPaths.ts`: where a received clip lives.
- `cloud/receiveQueue.ts`: a group's recording is opened with `{ code, shareId }`; every clip's still is downloaded
  to `thumbnailPath` of its video (so it is also the clip's thumbnail once the clip arrives) whatever the choice; the
  clips only when `on`. A recording not downloading whose clips are already listed asks the server nothing at launch
  or on return to the front. `setDownload` (on, paused: stops the files on their way, keeps the clips here) and
  `cancel` (stops, deletes the clips here and their files, back to `waiting`). Progress gains `download`, `bytes` and
  `thumbs` (stills by position).
- Screens: `/v/[code]` opens Minhas gravações (`/games?received=N&from=Ana`) for a group: Recebidas on and the note
  "N gravações recebidas de Ana". A recording not downloaded shows its first clip's still, the link's clip count and
  "Não baixada" in the list. `ReceivedBanner`: Baixar gravação · 320 MB and how long the link lasts; Pausar /
  Continuar and Cancelar (with a question). The grid's waiting places show the sender's stills. The recording screen
  does not delete a received recording whose clips Cancelar took away.
- Server: `open-share` answers `{ state: 'update' }` to a group link opened without `groups: true` (an app from before
  this phase; sharing is in test builds only, so only testers' older builds meet it). The app shows "Atualize o
  Reprize para abrir este link." for it.
- Analytics: `share_received` gains `recordings`; new `share_group_download { position, recordings }`.
- Tests: `receiveQueue` (choice, stills, pause, cancel), `receive` (group answer), `ReceivedBanner`, `games` (note,
  card), `ClipCard` (still on a waiting place).
- A link that is over (2026-11-22), learnt with **no request of its own** (it must scale): the app asks about a link
  only on the person's own action, Baixar or opening a recording not downloading (at most once a minute per link,
  `LOOK_MS`); an answer `off`, `expired` or `removed` is kept on every recording of the link (`SessionReceived.ended`)
  and never asked again. Recordings with no clip on the phone whose link is over leave it with their stills (`tidy`:
  local only, at launch, on return to the front and when a recording's screen closes); the one on screen stays and
  offers Apagar gravação. Recordings with clips stay. `repo.listSessions` hides an empty recording whose link is over.
- Web page (`reprize-lp`, 2026-11-22): `share-link-page.astro` reads `kind: 'group'` and `recordings`: title "N
  gravações de Ana" (or "N gravações"), the total clips, the cover, the time left, the numbered list (title, or
  "Gravação N" when unnamed, with its clips), "Ver todos no Reprize" with a hint that the recipient picks what to
  download, and the usual report form; `data/share.ts` and `i18n/ui.ts` (pt-BR and en). Checked with a build and a
  rendered preview.

### 5.8 What is sent: the sender decides (2026-11-22)

Decided with Victor after the first device tests: a clip arrives as the sender left it, for privacy and lighter links,
with no new cost for the sender or the recipient.

- **Cut and sound in the file.** Each clip is sent as its cut only (`trim`), without a sound track when muted
  (`cloud/shareCut.ts`). The recipient can cut inside what came, never reach what was cut, never turn the sound on.
  This also stops sending the seconds around the cut that the saved file holds (`bounds`).
- **No re-encoding.** The native `cutClip` (`ClipCut.swift`) copies the samples (passthrough): a fraction of a second
  per clip, no quality loss. Recordings are 1 s segments that each start on a key frame, so the file may keep up to 1 s
  before the cut, marked with an edit list: every player, and the app, starts exactly at the cut. Only extracting the
  file from the app's storage would show it; removing it would need re-encoding, refused for its cost.
- **Made behind the scenes.** The link and QR code come at once, as before; `sharePrep.ts` makes the cuts and the
  framing files right after, in the plan's order, at launch and on each return to the front, each upload starting as
  soon as its file is ready (no "Preparando" step). Three cuts at a time (`CUTS_AT_ONCE`), and the whole run asks iOS
  for the extra time an app leaving the front may keep (`withBackgroundTime`, `BackgroundWork.swift`, about 30 s): the
  cuts usually end even when the sender goes straight to WhatsApp, so every file reaches the background uploader, as
  before cuts existed. A cut iOS stops anyway (a very large link) is made on the next run; where the phone cannot cut,
  nothing uncut is ever sent in its place. A clip kept whole with its sound goes as its own file.
- **Sizes.** The size announced when the link is made is an upper bound (the cut comes later); `confirm-upload` takes the
  real size the phone reports (never more than announced) and updates the clip's size and the recording's and group's
  totals; `open-share`'s fallback accepts any stored object up to the announced size (a PUT is all or nothing).
- **Jogadores, Bola, zoom, speed, rotation: as sent, then the recipient's** (Victor, 2026-11-22, proposal 2 of two
  compared; it replaced a first version that locked the framing and the zoom). The clip opens as the sender left it
  (the cut, the silence, the framing, the zoom); the recipient may change the framing and zoom as on a clip of their
  own, back to the Original too: the framing is no privacy matter, the cut and the silence are (and stay fixed). Trying
  the modes on a received clip is meant to make people want PRO: as on one's own clips they work in the app for every
  plan and a free export leaves without them.
- **The analyses travel; the recipient's phone analyses only on the recipient's tap.** The sender's framing files (a few
  KB of coordinates, no pictures) are sent on the cut's time (`rebaseFramingText`) and used while the cut stays inside
  them (`receivedBallOf`). Bola only where the phone can show it: on one that cannot (iPhone XR, device test of
  2026-11-22) a clip sent on Bola opens on Jogadores, which every iPhone can do (`receivedFramingHere`); the sender keeps
  sending it on Bola. A mode that did not come is
  analysed on the recipient's phone when it can and the recipient picks it, exactly as on their own clips. The received
  recording takes the sender's sport (`senderSport` in `cloud/receive.ts`), which Bola needs.
- **Sizes compared** (three 10 s Full HD clips, 6 Mbps: ~7.6 MB of video each): about 22.9 MB for the recording either
  way; sending every analysis the sender had adds at most ~10 KB. The servers do no processing in either case.
- TEMP(diag-sharing): the diagnostics log says which framings each received clip brought (`recebidas: clipe N baixado
  (jogadores …, bola …)`) and, when it opens, whether they could be read (`clipe recebido: …`), for the clip sent on Bola
  that opened on Jogadores in the first device test.
- Older links (before this) keep working: their clips carry no `locks` and the whole file.

## 6. Screens

| Screen | Change |
|---|---|
| Minhas gravações, selecting | Compartilhar enabled for 1–10 shareable picks; hint for received, unfinished or empty recordings, or more than 10 |
| Group share sheet (`/share/group?ids=…`, new) | QR code, Copiar link, Enviar link (as `ShareLinkPanel`); list of the recordings with progress; total; Pausar envio, Desligar link, "Aberto em N celulares" |
| Recording strip (`ShareStrip`) | "Link ativo · 5 gravações · …"; opens the group sheet |
| Minhas gravações after opening a group link | Recebidas filter on, note "5 gravações recebidas de Ana" |
| Web page (`reprize-lp`, `/v/[code]`) | Group layout: title, cover, list of recordings with clip counts, time left, Ver todos no Reprize, Denunciar |

All new strings in pt-BR and en.

## 7. Web page (site repo `reprize-lp`)

`share-page` answers `kind: 'group'` (§4.3); `share-link-page.astro` shows "N gravações de Ana", the cover, the list
(title or "Gravação de <date>", clip count) and the usual buttons and states. `og:image` stays the cover still.

## 8. Security

- Same code strength (22 base62 characters, only the SHA-256 stored). Only the group has a code; its recordings are
  reachable only through it (`open-share` checks the pair), never by id.
- PRO, notice and rate limit checked on the server for the whole group in one request; the app's plan state is never
  trusted. Limits on recordings, clips and sizes are enforced on the server.
- Membership written per recording, so row-level security and `use_courtesy` need no change.
- A report, Desligar link or the expiry takes every recording of the link down together.
- No new public endpoint: `create-share`, `open-share` and `share-page` gain a branch each.

## 9. Analytics

- `share_created` gains `recordings` (1, 2–3, 4–6, 7–10); `share_failed` unchanged.
- `share_received` gains `recordings`; `share_downloaded` stays per recording.
- `share_group_opened_recording`: which position of the group the recipient opened first (do people want their own
  match only?).

## 10. Phases

1. **Server:** migration, `create_share_group`, `create-share` / `open-share` / `share-page` / `share-off` branches,
   tests of each branch; deployed to the development project by Victor (`--project-ref wkscydgikynfpfltpmht`).
2. **Sender app:** selection rules, `cloud/shareGroup.ts`, group sheet, queue order, strip; tests.
3. **Recipient app:** group answer, received recordings, list note, download priority; tests. Web page in `reprize-lp`.
4. **Optimisation:** a recording that already has a live link with clips confirmed in R2 is copied on the server (R2
   `CopyObject` into the new prefix) instead of uploaded again.
5. **Field test** at a session with several matches (target: 10 recordings shared in under 30 seconds of the
   sender's time), then production deploy.

## 11. Open questions

Both settled on 2026-11-22: recipient downloads by choice (decision 6), no group title (decision 7).

## 12. Risks

- **Back-to-back matches:** with nothing uploading while recording, a group of 10 uploads only in the gaps; the first
  recordings become watchable first (§5.3).
- **Recipient storage:** see §11.1.
- **Rate limit:** counting links instead of rows lets one person put 300 recordings in the cloud per day; the per-group
  caps and the 24-hour expiry bound the storage.
