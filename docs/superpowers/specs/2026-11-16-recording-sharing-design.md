# Sharing recordings and clips by link — design

Date: 2026-11-16. Author: Claude with Yasmin. Status: approved decisions, not implemented yet. Phase 0 (spikes and
service choice) comes before any feature code.
Plan rules (source of truth): `docs/modelo-de-negocio-e-pagamentos.md`, section "Compartilhamento".

## 1. Why

Field test (beach tennis tournament, 2026-11-13/14): at least three matches ran at once and athletes asked for their
clips as they left the court. AirDrop (one athlete at a time, iPhone only) and posting with tags cost enough time that
the start of other matches was missed. The app has no way to hand a recording to someone else.

Goal: the person recording spends about 10 seconds per match to hand over a whole recording, the athlete gets the
original quality, and the link brings the athlete into the app and towards PRO.

## 2. Decisions (2026-11-16)

1. **Link and QR code**, not usernames. A share is a link to a **recording** (all its clips) or to a single **clip**;
   both use the same address, `reprizeapp.com/v/<code>`, and the server knows which one it is. Anyone holding the
   link can open it.
2. **Only PRO can share.** On the free plan the Share button shows the PRO lock and opens the paywall.
3. **The link exists before the upload finishes.** Creating a share is one light request; the QR code is shown at once
   and the clips upload in a background queue.
4. **The original clip file travels**, with its edit and focus data. Nothing is re-encoded on the sender's phone.
5. **Links live 24 hours** from creation. After that the link stops working and the files are deleted from the cloud.
   The owner can share the same recording again (a new link, a new upload).
6. **The web page shows only the cover clip** as a preview (HD, no sound, watermark). Everything else opens in the app.
7. **Watching in the app is free on every plan**, at the recorded quality, with sound, Modo Foco and the sender's edits.
   Opening a share in the app within the 24 hours downloads the videos into the app (not into the photo library).
8. **PRO recipient:** a received recording behaves like one of their own (save, send, compile, 4K when recorded in 4K,
   no watermark).
9. **Free recipient: 1 courtesy recording** (3 until 2026-11-18), lifetime, per account, no renewal. A courtesy is spent on the
   first Save or Send of a received recording, after a confirmation, and unlocks every clip of that recording: Full HD,
   sound, Modo Foco, **with the watermark**. Once it is used, Save and Send of another received recording open the paywall. Compile is always PRO.
   4K export of a received recording is PRO only.
10. **The Single Pass does not apply** to received recordings.
11. **Screen capture protection is mandatory** on received recordings, on every plan: the video does not appear in
    screenshots or screen recordings; a dark screen with a friendly message is shown instead.
12. **Liability notice on the first share:** the link is created only after the user ticks that they are aware they
    answer for the content. The acceptance is stored (account, notice version, timestamp).
13. **iPhone only.** Android is out of planning and execution until the app is published on Google Play. On an Android
    phone the web page shows the cover preview and "Em breve no Android".
14. **Individual users only.** No team or organisation accounts.
15. **Link host:** `reprizeapp.com`, without `www` (see §7).
16. **Only an ended recording can be shared, and nothing uploads while recording.** The Share button appears once the
    recording has ended. If a new recording starts with uploads pending, the queue pauses and resumes when that
    recording ends. Reason: battery, performance and heat during a recording.

Not in this feature: the watermark on PRO exports (a later, separate decision), event pages, an event pass, sending to
Reprize usernames.

## 3. Flows

### 3.1 Sender (PRO)

1. Recording screen of an **ended** recording → **Compartilhar gravação**. First time: sign in (Apple or Google), then the liability notice (§8.4).
2. The app asks the server for a share; the sheet shows the QR code, Copy link, WhatsApp, More.
3. Athletes scan the QR code with the phone camera. The sender can start the next recording; the upload then pauses
   until that recording ends.
4. The queue uploads thumbnails and the cover preview first, then the clips in order. The recording shows progress
   ("7 de 12 enviados").
5. The sheet also shows who joined, the time left, restricted mode and **Desligar link**.

### 3.2 Recipient

1. Opens `reprizeapp.com/v/<code>`: match title, number of clips, cover preview, "Disponível por 24 horas", the
   **Ver todos no Reprize** button and Report.
2. With the app installed the link opens the app. Without it, the button goes to the App Store; after installing, the
   user taps the link again or uses **Recebi um link** on the home screen (QR scanner or paste).
3. The recording appears under **Recebidas** with the marker "Compartilhada por <name>". Videos stream from the cloud and
   download into the app at the same time.
4. Save / Send: PRO → as usual. Free → "Usar sua gravação de cortesia?" (sign-in required), then the export
   runs; with the courtesy already used on another recording → the panel with **Assinar o PRO**.

## 4. Plan rules in code

| Rule | Where |
|---|---|
| Sharing is PRO only | new `canShare(plan)` in `payments/limits.ts`, next to `canCompile`; lock on the Share button in `app/session/[id].tsx` and `app/clip/[id].tsx` |
| A received recording | `Session.received` (see §5.3) |
| Export of a received recording | `share/exportOptions.ts`: PRO active → paid options; courtesy applied → paid options capped at Full HD with the watermark forced on; neither → blocked |
| Gate before export | `components/useFreeExportGate.tsx` and a variant of `components/FreeExportSheet.tsx` with two states: "Usar cortesia" and, once it is used, "Assinar o PRO". No "Continuar no plano grátis", no Single Pass |
| Compile on a received recording | `share/useBatchActions.ts`: PRO only |
| Single Pass | `payments/unlock.ts` refuses a received recording |

`useViewPlan` already treats every recording as paid while PRO is active; a received recording follows it. When the
recipient's PRO ends, the free rules apply again; unused courtesies remain.

Implemented (2026-11-18):

- `share/entitlement.ts`: `useReceivedAccess(sessionId)` is `pro`, `courtesy` (spent on it, `Session.received.courtesy`)
  or `locked`, and undefined for a recording made on the phone. `exportTierOf` gives the export tier: a received
  recording without Pro is previewed and exported as `courtesy` (`share/exportOptions.ts`: the paid export capped at
  Full HD, with the mark), whether or not a courtesy is spent yet; watching is free, the gate is on Save and Send.
- `components/useCourtesyGate.tsx` and `components/CourtesySheet.tsx`, on the clip screen and the recording's batch
  Save/Send: sign in, then "Usar sua gravação de cortesia?" (`profiles.courtesies_used` says whether it is used),
  or, once it is used, Assinar o PRO only. `cloud/courtesy.ts` calls `use_courtesy`; the answer is kept with
  `repo.setReceivedCourtesy`. A courtesy export skips the 4K/2K/Full HD choice. No free-export notice, no Single Pass:
  `unlockRecording` and `repo.upgradeSession` refuse a received recording. Compilar stays PRO (`canCompile(plan)`).
- The edit tools show no locks on a received recording (watching is free with every tool).

## 5. Architecture

Today the app has no account and no server: recordings live on the phone (`data/repo.ts`, MMKV, files). This feature
adds an account, a cloud relay and a web page. The phone stays the home of the recordings; the cloud only carries them
for 24 hours.

### 5.1 Parts

| Part | Proposal (to confirm in Phase 0) | Notes |
|---|---|---|
| Account | Sign in with Apple and with Google, both native sheets (`expo-apple-authentication`, `@react-native-google-signin/google-signin`, MIT), exchanged with `supabase.auth.signInWithIdToken` | Apple's option is required when a third-party sign-in is offered. Account deletion in-app. Code: `src/account/`, screen `/account`; behind `SHARING_ENABLED` (diagnostics builds only) until the feature ships |
| Data and API | Managed Postgres with row-level rules and server functions (for example Supabase) | Shares, clips, members, courtesies, notice acceptances, reports |
| Video files | Object storage with multipart upload and short-lived signed URLs (for example Cloudflare R2) | Never a public URL. Lifecycle rule plus a job that deletes at expiry |
| Link page | Static page plus one function on `reprizeapp.com` (Vercel today) | `noindex`; social preview shows the cover image only |
| Open in app | Universal Links for `/v/*`; `reprize://` as fallback | §7 |
| Subscription | RevenueCat `logIn` with the account id (`identifyPurchaser`), `logOut` on sign-out | PRO follows the account, not only the device; anonymous purchases move to the account on first sign-in |
| Push | Phase 2 | New clips; "link expires in 3 hours" |

Only free-licence libraries in the app. Before coding the background upload, read the Expo SDK 58 docs for the current
API (`app/AGENTS.md`).

### 5.2 Server data

- `account`: id, display name, optional Instagram handle, RevenueCat id, `courtesies_used` (0–1; `20261118230000_one_courtesy.sql`, was 0–3).
- `share`: id, owner, kind (`recording` | `clip`), title, sport, `token_hash`, created_at, expires_at (created + 24 h),
  state (`active` | `off` | `expired`), access mode (`link` | `restricted`).
- `share_clip`: share, storage key, bytes, checksum, edit data (cut, zoom, rotation, speed), focus and ball files,
  thumbnail, upload state.
- `share_member`: share, account (or anonymous device id before sign-in), joined_at, downloaded, courtesy_applied.
- `notice_acceptance`: account, notice version, accepted_at.
- `report`: share, reason, state.

The share token is 22 random base62 characters (more than 128 bits). The server stores only its hash.

Implemented in `supabase/migrations/20261117030000_sharing.sql`: tables `profiles`, `shares`, `share_clips`,
`share_members`, `notice_acceptances`, `reports`, all with row-level security. Clients may read their own profile and
the shares they own or joined (never `token_hash`) and may edit only their display name and Instagram handle; every
write that matters goes through Edge Functions with the service role. Files are not listed in the database: they live
in R2 under `shares/<share id>/`.

Courtesy use is decided by the server in one transaction (`public.use_courtesy(share, device)`, locks the profile row;
`supabase/migrations/20261118200000_courtesy_device.sql` adds `device`: a phone that opened the link signed out has its
member row moved to the account first, so a courtesy can be spent after the link expired): if `courtesy_applied` is already true for this member and
share → allowed; else if `courtesies_used < 1` → increment and set it; else → refused. The app stores the answer on the
recording and never decides by itself.

### 5.3 App data (`data/schema.ts`, `data/repo.ts`)

- `Session.shared`: `{ shareId, url, expiresAt, uploaded, total, state }` on the sender's recording.
- `Session.received`: `{ shareId, fromName, receivedAt, expiresAt, courtesy: boolean }` on the recipient's copy.
- A received recording never has `paid` or `passTransactionId` set.
- New module `src/cloud/`: API client, the persistent upload queue, the download manager.

### 5.4 Upload

- Queue persisted on the phone; order: thumbnails, cover preview, clips.
- System background session (`BackgroundUpload.swift`): continues with the app in the background or the screen locked;
  iOS wakes the app when a transfer ends. One clip is one presigned PUT; a clip that fails starts again from its first
  byte (clips are tens of MB), up to 5 attempts; a 4xx is not retried. Finished clips are never sent again.
- iOS cancels every background transfer when the user swipes the app away in the app switcher. On the next launch the
  queue starts those clips again.
- Setting "Enviar pelos dados móveis" (on by default). Pause on critical heat.
- Never while recording: the queue checks the session state, pauses when a recording starts and resumes when it ends.
  The recording shows "Envio pausado durante a gravação".
- The cover preview is one export through the existing free path (HD, no sound, watermark): one export per share.
- Example: an 11 MB clip (15 s, Full HD, estimated from the backlog's 90 MB per 120 s) takes about 9 s at 10 Mbps up.
  Real sizes for Full HD and 4K, 15–60 s, are measured in Phase 0.

Implemented (2026-11-18):
- Native (`BackgroundUpload.swift`): `uploadStart` items carry `cellular` (per-request `allowsCellularAccess`);
  `uploadPause` cancels every transfer and keeps it `paused` (`restore` leaves paused files alone), `uploadResume`
  starts them again from the first byte with fresh attempts, `uploadRemove` cancels and forgets files.
- Queue (`src/cloud/uploadQueue.ts`, wired in `src/cloud/appUploadQueue.ts`): plans per share in MMKV
  (`uploadPlan.ts`, with the expiry); `sync` at launch, on coming to the front and after a new share; held while the
  session phase is starting, recording or stopping, or the camera reports critical heat (`cloud/uploadHold.ts`, set by
  `SessionProvider`); expired shares are cancelled and forgotten; each finished clip video is confirmed with the
  `confirm-upload` Edge Function (HEAD in R2, size equal to `share_clips.bytes` → `upload_state = done`; another size →
  `failed`, and the phone sends it again); Tentar de novo restarts files that gave up.
- Progress counts clip videos ("7 de 12 clipes enviados") with a byte bar, on the share sheet
  (`components/ShareUploadStatus.tsx`, with the "Enviar pelos dados móveis" switch, on by default) and on the
  recording (`components/ShareStrip.tsx`: "Link ativo · … · Disponível por mais N horas", opens the sheet).
- Swiped-away app (field test 2026-11-18: uploads did not start again on reopening): iOS reports those transfers as
  cancelled on the next launch. A transfer cancelled while its file is still `running` (neither paused nor removed by
  the app) now starts again; each transfer carries a token in its task description, so a late report from a replaced
  transfer is ignored; and `sync` also calls `uploadRestore` (launch and every return to the front).
- Owner controls on the sheet: **Pausar envio / Continuar envio** (kept across launches; a recording does not undo
  it) and **Desligar link** (confirmation, then the `share-off` Edge Function sets the share `off`, the cron deletes its
  files, the phone cancels and forgets its uploads and keeps the link as `off`; the sheet offers **Criar link novo**).
- Cover (decision 6): every share asks for `cover.mp4` and `cover.jpg`. When the share sheet shows a live link whose
  plan still waits for the cover, it exports the first clip as the free plan does (app mark, never sound;
  `src/cloud/cover.ts`), takes a still of it (the native thumbnail, 640 px at most), moves both into
  `Documents/shares/<id>/` (the exports cache is emptied at launch) and fills the plan, so the queue sends them. Until
  then the cover uploads wait in the plan with an empty path. A sheet closed before the cover is made leaves it for the
  next opening. iOS stops an export when the app leaves the front (the sender switching to WhatsApp): the sheet makes
  the cover again when the app comes back. Test builds with the field-test unlock export the cover at their unlocked
  quality.
- Diagnostics: every queue step goes to the Diagnóstico log under the **ENVIO** area (started, paused and why,
  resumed, each file done or FALHOU, retries, server confirmation, expired or turned-off links).

### 5.4.1 Creating a share (`create-share`)

- The app first stores the notice acceptance (`notice_acceptances`, version 1, through row-level security), then calls
  the `create-share` Edge Function with the user's access token: kind, title, sport, whether a cover follows, and one
  entry per clip (position, bytes, duration, checksum, edit data, which side files it has).
- The server checks, in order: the session (401 `sign_in`), the body (400), the notice at the current version
  (403 `notice`), at most 30 shares per account in 24 hours (429 `too_many`) and PRO on RevenueCat with the account id
  (403 `not_pro`; 503 `pro_check` without `REVENUECAT_SECRET_KEY`). The app's own plan state is never trusted.
  TEMP(field-test): on the development project only, the secret `PRO_CHECK=off` counts every signed-in account as
  PRO, matching the app's `REPRIZE_FIELD_TEST_UNLOCK` (local builds, Release included). The production project must
  never have it; remove it with the field-test unlock before launch.
- It stores the share (the 22-character code only as its SHA-256) and its clips, and answers with the link, the expiry
  and one presigned PUT URL per file, valid until the share expires, in queue order: thumbnails, cover still, cover
  video, then each clip's video with its framing files. Keys: `shares/<id>/cover.{jpg,mp4}`,
  `shares/<id>/clips/<n>/{video.mp4,thumb.jpg,focus.json,ball.json}`.
- App client: `src/cloud/shares.ts` (`noticeAccepted`, `acceptNotice`, `createShare`); the request for a recording is
  built by `src/cloud/shareInput.ts` (side files only when they exist on the phone; no cover yet), and
  `src/cloud/shareRecording.ts` stores the link on the recording (`Session.shared`) and the paired upload items
  (`src/cloud/uploadPlan.ts`) for the queue. A link with more than 5 minutes left is shown again instead of a new one.
- Screen: **Compartilhar gravação** on the summary of an ended recording (lock and paywall without PRO; a Single Pass
  does not share) opens `/share/[id]`: sign in, the notice (`components/ShareNotice.tsx`), then the QR code with
  Copiar link and Enviar link (`components/ShareLinkPanel.tsx`; `react-native-qrcode-svg` and `expo-clipboard`, MIT).

### 5.5 Download and expiry

- The recipient streams from signed URLs and the app downloads the originals in the background as soon as the share is
  opened. The recording shows "Baixando 7 de 12 · disponível na nuvem por mais 18 h".
- Every 10 minutes pg_cron calls the `expire-shares` Edge Function (key in Vault, `x-cron-key` header). It takes the
  shares turned off or past `expires_at` (`shares_to_clean`), deletes everything under `shares/<id>/` in R2 and marks
  them (`mark_shares_cleaned`: `files_deleted_at`, an active share becomes `expired`). The bucket's 2-day lifecycle
  rule is the safety net. The share rows stay, so a courtesy can still be used on a recording already on the phone.
- Whoever opened in time keeps the recording in the app. Whoever did not sees "Este link venceu. Peça um novo a quem
  gravou".

### 5.5.1 Receiving in the app (2026-11-18)

- `/v/[code]` in the app calls the `open-share` Edge Function (tried again after 0.8 s and 2 s on a network or server
  error: a link tapped in another app often opens Reprize before its network is ready) (POST `{ code, deviceId }`, the access token when
  signed in): it registers the opener in `share_members` (by account, else by a random per-install id kept in MMKV;
  the device row moves to the account when that phone opens the link signed in), answers `own` to the sender, and
  lists every clip with its edit data and, once its upload is confirmed, presigned GET URLs for the video and the
  framing files, valid until the share expires. Thumbnails are made on the phone from the video.
- The app makes the received recording once per share (`repo.startReceivedSession`, `Session.received` with the code,
  the sender's first name, the expiry and the clip count; never `paid`) and opens it. `src/cloud/receiveQueue.ts`
  downloads clip by clip into `Documents/received/<share id>/<n>.mp4` (framing files next to it, as the app names
  them), and only a complete video becomes a clip (`repo.addReceivedClip`, with the sender's cut, bounds, number,
  name, edit and framing; `Clip.sharePosition`). Clips not uploaded yet are asked for again every 10 s while the app
  is in front; at launch and on every return to the front the queue resumes every received recording until it is
  complete or the link expires.
- The recording shows "Compartilhada por Ana", "Baixando 3 de 7" or "esperando o envio de quem gravou", and the time
  left (`components/ReceivedBanner.tsx`); Minhas gravações marks it. A received recording has no Compartilhar button.
- No "I got a link" screen in the app (decided 2026-11-18): the iPhone camera reads the sender's QR code and a tapped
  link opens the app, so the app adds no entry of its own. A received recording shows only its clip count in the games
  list (it has no recording time on this phone).
- A link opened cold (nothing under `/v/[code]`) builds the usual stack, setup (or onboarding, if it was never done),
  games, then the recording, so Back and "New recording" behave as after a game. The onboarding is skipped, not
  marked done: it is still there under the games.
- The games list shows an All / Mine / Received filter once at least one received recording is on the phone.
- Still to do here: streaming before the download ends, and the export rules (§4: courtesies).

### 5.5.2 Sessions on several phones (2026-11-18)

- "Sair" signs out on this phone only (`scope: 'local'`). The SDK default is global: it ended the sessions of every
  other phone on the same account, which kept looking signed in while the server refused them.
- The account screen names the sign-in used on this phone (remembered when the button is pressed): Supabase joins an
  Apple and a Google sign-in with the same email into one account, and does not say which one opened a session.
- Once per account the app asks the server for the user (`getUser`): a session it no longer accepts signs this phone
  out. A share refused with 401 tries a fresh token once, then signs out and asks to sign in again.

### 5.6 Account deletion

- "Excluir conta" on the account screen, after a confirmation that says the links stop working and the recordings stay
  on the phone. It calls the `delete-account` Edge Function with the user's access token.
- Apple accounts confirm with Apple first: the app sends a fresh authorization code and the function exchanges it and
  revokes the refresh token at Apple (client secret signed with the Sign in with Apple key: `APPLE_TEAM_ID`,
  `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `APPLE_CLIENT_IDS`). The code must belong to the same Apple user; a refused
  revocation stops the deletion.
- The function deletes the R2 files of the person's shares (lifecycle rule as the safety net), then the auth user;
  profiles, shares, members and notice acceptances go with it (`on delete cascade`), reports keep the share but lose
  the reporter.
- Google accounts: the app revokes access at Google afterwards (best effort). The session is cleared on the phone only;
  RevenueCat goes back to its anonymous id, and a PRO subscription comes back with "Restaurar compras".

## 6. Screens

| Screen | Change |
|---|---|
| Minhas gravações (`app/games.tsx`) | Filter: Todas, Minhas, Recebidas. Received card: "Compartilhada por Ana". Own card with an active link: "Link ativo · 4 pessoas" |
| Recording (`app/session/[id].tsx`) | **Compartilhar gravação** (PRO lock on free). With an active link, a strip: "Link ativo · 4 pessoas · vence em 18 h" |
| Share sheet (new) | Large QR code at full brightness, editable title, Copy link, WhatsApp, More; upload progress, who joined, time left, restricted mode, Desligar link; the line "Você é responsável pelo que compartilha. Ver termo" |
| Clip (`app/clip/[id].tsx`) | Two distinct actions: **Enviar arquivo** (today's export) and **Compartilhar pelo Reprize** (link) |
| Received recording | Header "Compartilhada por Ana · 15 nov"; download progress and time left; free: the courtesy question on Save and Send, then the PRO lock and the card "Leve seus lances com o PRO"; no Share button |
| Home (`app/index.tsx`) | **Recebi um link**: scan a QR code or paste |
| Arriving from a link | Skips the onboarding and lands on the received recording; recording tips appear when the user first records |
| Settings | Account (sign in, sign out, delete), mobile data switch, active links |

Terms: "gravação" for the match, "clipe" for the video, "lance" in emotional copy ("Seus lances chegaram"). Red stays
reserved for "recording". All new strings in pt-BR and en (`src/i18n/locales`).

## 7. Link host

- `https://reprizeapp.com/v/<code>` for a recording or a single clip (`share.kind` tells them apart). Shorter on the
  screen and a less dense QR code (2026-11-17).
- A redirecting link does not open the app on iPhone: the system looks at the tapped domain before any redirect. Tested
  2026-11-16, `reprizeapp.com` answered 308 to `www`; since 2026-11-17 both domains serve the site directly on Vercel
  (no redirect either way), and the app claims both (`applinks:reprizeapp.com`, `applinks:www.reprizeapp.com`), so links
  made before the change keep opening the app.
- `apple-app-site-association` at `/.well-known/` on both domains (site repo `reprize-lp`, `public/`), served
  as `application/json` by `vercel.json`, no redirect. It lists the store app (`R885ZD42ZG.app.reprize.mobile`) and the
  team's development build (`R885ZD42ZG.app.reprize.develop`, so it can sit next to the store app; a Personal Team build
  cannot use associated domains); the app claims only `/v/*`
  (`associatedDomains` in `app/app.json`).
- Link page (2026-11-18): `reprize-lp` uses the `@astrojs/vercel` adapter; the site stays static and only
  `src/pages/v/[code].astro` (and `/en/v/[code]`) render on each visit (`src/components/share-link-page.astro`). The
  page asks the public `share-page` Edge Function (GET `?code=`; finds the share by the code's SHA-256) for title, clip
  count, the sharer's first name, expiry, state and one-hour presigned GET URLs of the cover; the clips never reach
  the web. It shows the cover playing muted (`og:image` is the cover still, for WhatsApp and iMessage), "Disponível
  por mais N horas", **Ver todos no Reprize** and Denunciar (e-mail for now); states expired, off, removed (reported,
  §8.3), not found. `noindex`, `Cache-Control: no-store`, out of the sitemap.
- Opening the app: iOS hands a Universal Link to the app only when it is tapped from another domain, so the button
  points to the other host (`www.` ↔ bare) with `?open=1`. With the app installed it opens; without it, the page loads
  again with `?open=1` and sends the iPhone to the App Store ("Depois de instalar, toque no link de novo"). Android
  sees "Em breve no Android"; a computer sees "Abra este link no iPhone".
- In the app, `src/app/v/[code].tsx` is still the Phase 0 placeholder until the receive flow exists.
- Checks: `curl -sI` on the association file (200); `https://app-site-association.cdn-apple.com/a/v1/reprizeapp.com` (and `www.`)
  (what iPhones use, may lag by hours); on the phone, tap a `/v/teste` link pasted into Notes (typing it in Safari's
  address bar always opens the site).
- Fallback if the site host cannot serve these paths with a function: `go.reprizeapp.com`.

## 8. Security and privacy

### 8.1 Access

- Unguessable token, HTTPS, files encrypted at rest, signed URLs with a short life, rate limit per IP, `noindex`.
- Owner controls: turn the link off (files leave the cloud), see who joined, remove a person, restricted mode ("só quem
  eu aprovar").
- Copies already downloaded into a recipient's app are not recalled when the link is turned off; the interface says so.
- True end-to-end encryption is not used and must not be promised: it rules out the web preview and taking reported
  content down.

### 8.2 Screen capture protection (iPhone)

- Screen recording and mirroring: the system reports when the screen is being captured; the player pauses and shows the
  dark screen with "Este lance não pode ser capturado. Para guardar, toque em Salvar." and a Save button.
- Screenshots: the video is drawn in a system-protected layer so the captured image shows black where the video is.
  This layer is not documented by Apple for video; spike 3 (§10) must prove it on the current iOS with the app's player
  before Phase 1 depends on it.
- Applies to every received recording on every plan. Own recordings are unchanged.
- The browser cannot block capture, which is one reason the web shows only the watermarked cover clip.
- Filming the screen with another device cannot be prevented.
- Implemented (2026-11-18): `share/CaptureGuard.tsx` wraps the clip player of a received recording (the video, its
  poster, Modo Foco and Seguir a Bola framing, and the watermark drawn over it) in `CaptureShieldView`, the native view
  proved by spike 3. The message sits under the shield, so a screenshot shows it where the video was; during a screen
  recording it also covers the video on the screen and the clip pauses. Both send `capture_blocked` (`screenshot` or
  `recording`). Stills (the recording's thumbnails, the neighbouring clips while swiping) are not shielded.
  iOS draws a copy of the screen without the shielded layer while a system sheet slides over it (the share sheet) and
  while the screen leaves: the message would flash there, so the clip screen sets `quiet` (no message) from Enviar
  until 0.7 s after the sheet closed, and on the way back to the recording.

### 8.3 Reports

Report button on the web page and in the app. A reported share is taken down until reviewed.

### 8.4 Liability notice (first share)

Full screen before the QR code, title "Antes de compartilhar", four points, one checkbox, button **Concordar e
compartilhar** enabled only with the box ticked. Shown once per account and again when the notice version changes.

1. **Você escolhe o que envia.** O Reprize não assiste, não revisa e não controla o conteúdo das gravações.
2. **Você responde pelo conteúdo.** Ao compartilhar, você declara que tem o direito de enviar esta gravação e a
   autorização das pessoas que aparecem nela. Se houver menores de idade, a autorização é dos responsáveis.
3. **Quem tem o link pode ver e repassar.** O link vence em 24 horas e você pode desligá-lo antes, mas o que já foi
   guardado por quem recebeu não volta.
4. **Uso indevido tem consequência.** Um conteúdo denunciado pode sair do ar e a conta pode ser suspensa. O Reprize não
   se responsabiliza por danos causados por gravações compartilhadas de forma indevida.

Checkbox: "Li e estou ciente. Assumo a responsabilidade pelo que eu compartilhar."

The notice records awareness; it does not replace the full Terms of Use or the duty to act on reports. Final wording
and the liability clause go through a lawyer before publishing. Privacy policy, Terms of Use and the App Store privacy
labels change with this feature (account, user content stored on a server).

## 9. Analytics (PostHog)

`share_created` (with time from tap to QR), `share_upload_done`, `share_opened` (web), `share_install`, `share_viewed`,
`share_downloaded`, `courtesy_used` (with `remaining`), `courtesy_exhausted`, `received_export_blocked`, `received_purchase`,
`capture_blocked`, `share_expired_unopened`, `received_user_first_recording`.

Headline numbers: new users per share created, revenue per share created, GB stored per event.

## 10. Phase 0 — spikes and decisions

| # | Spike | Passes when |
|---|---|---|
| 1 | Background upload | A 12-clip recording uploads with the screen locked and the signal dropping, and resumes without sending finished clips again. Screen `/spike-upload`, function `supabase/functions/spike-sign` |
| 2 | Upload while recording | Cancelled (decision 16): nothing uploads while recording |
| 3 | Capture protection | Screenshot shows black over the video and screen recording triggers the message, on the current iOS, with the app's player and Modo Foco overlay |

Also in Phase 0: measure real clip sizes (Full HD and 4K, 15–60 s); choose account, database and storage services;
set up Universal Links on `reprizeapp.com` and `www.reprizeapp.com`; define the courtesy counter and the 24-hour cleanup on the server.

## 11. Phases

- **Phase 1 — recording link (iPhone):** account; server tables, rules, signed URLs, expiry job; `src/cloud` queue;
  `Session.shared` / `Session.received`; share sheet with QR; liability notice; web page; open in app and "Recebi um
  link"; Recebidas filter and markers; stream plus automatic download; `canShare`; courtesies with the server counter;
  capture protection; turn off, expiry, new link, who joined; Terms, privacy policy, store labels; analytics; field test
  at a real tournament against the 10-second target.
- **Phase 2:** push (expiry warning); "Quer ser marcado? Deixe seu @" and
  the handle list on the recording; single-clip links; restricted mode with approval; report review queue.
- **Phase 3:** event pages (one QR per tournament or court); event pass; sending to people; Android once the app is on
  Google Play; App Clip study.

## 12. Risks

- **24-hour window:** an athlete who scans the QR code and installs the app the next day loses the recording. The page
  states the deadline and the owner can share again. Watch this at the first tournament.
- **Capture protection** rests on an undocumented system behaviour (spike 3).
- **New accounts for more courtesies:** possible, costly for the user; measure before acting.
- **Reach:** only subscribers create links.
- **Back-to-back matches:** with no upload while recording, the clips of one match upload only in the gap before the
  next recording or after the last one. The athlete scans the QR code at once but may wait to see the clips.

## 13. Project rules that apply

No optional chaining in TypeScript. Technical docs in English. Free licences only. Run `npx jest`, `npx tsc --noEmit`
and `npx expo lint` in `app/` before declaring a task done. Docs are updated before code.
