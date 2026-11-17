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

1. **Link and QR code**, not usernames. A share is a link to a **recording** (all its clips) or to a single **clip**.
   Anyone holding the link can open it.
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
9. **Free recipient: 3 courtesy recordings**, lifetime, per account, no monthly renewal. A courtesy is spent on the
   first Save or Send of a received recording, after a confirmation, and unlocks every clip of that recording: Full HD,
   sound, Modo Foco, **with the watermark**. After the three, Save and Send open the paywall. Compile is always PRO.
   4K export of a received recording is PRO only.
10. **The Single Pass does not apply** to received recordings.
11. **Screen capture protection is mandatory** on received recordings, on every plan: the video does not appear in
    screenshots or screen recordings; a dark screen with a friendly message is shown instead.
12. **Liability notice on the first share:** the link is created only after the user ticks that they are aware they
    answer for the content. The acceptance is stored (account, notice version, timestamp).
13. **iPhone only.** Android is out of planning and execution until the app is published on Google Play. On an Android
    phone the web page shows the cover preview and "Em breve no Android".
14. **Individual users only.** No team or organisation accounts.
15. **Link host:** `www.reprizeapp.com` (see §7).
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

1. Opens `www.reprizeapp.com/g/<code>`: match title, number of clips, cover preview, "Disponível por 24 horas", the
   **Ver todos no Reprize** button and Report.
2. With the app installed the link opens the app. Without it, the button goes to the App Store; after installing, the
   user taps the link again or uses **Recebi um link** on the home screen (QR scanner or paste).
3. The recording appears under **Recebidas** with the marker "Compartilhada por <name>". Videos stream from the cloud and
   download into the app at the same time.
4. Save / Send: PRO → as usual. Free → "Usar 1 das suas 3 gravações de cortesia?" (sign-in required), then the export
   runs; with no courtesies left → the panel with **Assinar o PRO**.

## 4. Plan rules in code

| Rule | Where |
|---|---|
| Sharing is PRO only | new `canShare(plan)` in `payments/limits.ts`, next to `canCompile`; lock on the Share button in `app/session/[id].tsx` and `app/clip/[id].tsx` |
| A received recording | `Session.received` (see §5.3) |
| Export of a received recording | `share/exportOptions.ts`: PRO active → paid options; courtesy applied → paid options capped at Full HD with the watermark forced on; neither → blocked |
| Gate before export | `components/useFreeExportGate.tsx` and a variant of `components/FreeExportSheet.tsx` with two states: "Usar cortesia (2 de 3)" and, with none left, "Assinar o PRO". No "Continuar no plano grátis", no Single Pass |
| Compile on a received recording | `share/useBatchActions.ts`: PRO only |
| Single Pass | `payments/unlock.ts` refuses a received recording |

`useViewPlan` already treats every recording as paid while PRO is active; a received recording follows it. When the
recipient's PRO ends, the free rules apply again; unused courtesies remain.

## 5. Architecture

Today the app has no account and no server: recordings live on the phone (`data/repo.ts`, MMKV, files). This feature
adds an account, a cloud relay and a web page. The phone stays the home of the recordings; the cloud only carries them
for 24 hours.

### 5.1 Parts

| Part | Proposal (to confirm in Phase 0) | Notes |
|---|---|---|
| Account | Sign in with Apple and with Google | Apple's option is required when a third-party sign-in is offered. Account deletion in-app |
| Data and API | Managed Postgres with row-level rules and server functions (for example Supabase) | Shares, clips, members, courtesies, notice acceptances, reports |
| Video files | Object storage with multipart upload and short-lived signed URLs (for example Cloudflare R2) | Never a public URL. Lifecycle rule plus a job that deletes at expiry |
| Link page | Static page plus one function on `www.reprizeapp.com` (Vercel today) | `noindex`; social preview shows the cover image only |
| Open in app | Universal Links for `/g/*` and `/c/*`; `reprize://` as fallback | §7 |
| Subscription | RevenueCat `logIn` with the account id | PRO follows the account, not only the device |
| Push | Phase 2 | New clips; "link expires in 3 hours" |

Only free-licence libraries in the app. Before coding the background upload, read the Expo SDK 58 docs for the current
API (`app/AGENTS.md`).

### 5.2 Server data

- `account`: id, display name, optional Instagram handle, RevenueCat id, `courtesies_used` (0–3).
- `share`: id, owner, kind (`recording` | `clip`), title, sport, `token_hash`, created_at, expires_at (created + 24 h),
  state (`active` | `off` | `expired`), access mode (`link` | `restricted`).
- `share_clip`: share, storage key, bytes, checksum, edit data (cut, zoom, rotation, speed), focus and ball files,
  thumbnail, upload state.
- `share_member`: share, account (or anonymous device id before sign-in), joined_at, downloaded, courtesy_applied.
- `notice_acceptance`: account, notice version, accepted_at.
- `report`: share, reason, state.

The share token is 22 random base62 characters (more than 128 bits). The server stores only its hash.

Courtesy use is decided by the server in one transaction: if `courtesy_applied` is already true for this member and
share → allowed; else if `courtesies_used < 3` → increment and set it; else → refused. The app stores the answer on the
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

### 5.5 Download and expiry

- The recipient streams from signed URLs and the app downloads the originals in the background as soon as the share is
  opened. The recording shows "Baixando 7 de 12 · disponível na nuvem por mais 18 h".
- At `expires_at` a server job sets the share to `expired` and deletes its objects. A storage lifecycle rule is the
  safety net.
- Whoever opened in time keeps the recording in the app. Whoever did not sees "Este link venceu. Peça um novo a quem
  gravou".

## 6. Screens

| Screen | Change |
|---|---|
| Minhas gravações (`app/games.tsx`) | Filter: Todas, Minhas, Recebidas. Received card: "Compartilhada por Ana". Own card with an active link: "Link ativo · 4 pessoas" |
| Recording (`app/session/[id].tsx`) | **Compartilhar gravação** (PRO lock on free). With an active link, a strip: "Link ativo · 4 pessoas · vence em 18 h" |
| Share sheet (new) | Large QR code at full brightness, editable title, Copy link, WhatsApp, More; upload progress, who joined, time left, restricted mode, Desligar link; the line "Você é responsável pelo que compartilha. Ver termo" |
| Clip (`app/clip/[id].tsx`) | Two distinct actions: **Enviar arquivo** (today's export) and **Compartilhar pelo Reprize** (link) |
| Received recording | Header "Compartilhada por Ana · 15 nov"; download progress and time left; free: "Cortesia · 2 de 3 restantes" on Save and Send, then the PRO lock and the card "Leve seus lances com o PRO"; no Share button |
| Home (`app/index.tsx`) | **Recebi um link**: scan a QR code or paste |
| Arriving from a link | Skips the onboarding and lands on the received recording; recording tips appear when the user first records |
| Settings | Account (sign in, sign out, delete), mobile data switch, active links |

Terms: "gravação" for the match, "clipe" for the video, "lance" in emotional copy ("Seus lances chegaram"). Red stays
reserved for "recording". All new strings in pt-BR and en (`src/i18n/locales`).

## 7. Link host

- `https://www.reprizeapp.com/g/<code>` (recording) and `/c/<code>` (clip).
- Tested 2026-11-16: `reprizeapp.com/g/teste` answers **308** to `www`; `www.reprizeapp.com/g/teste` answers 404 with no
  redirect. A redirecting link does not open the app on iPhone, so the app and the QR code always use `www`.
- `apple-app-site-association` at `https://www.reprizeapp.com/.well-known/`, `application/json`, no redirect; the app
  claims only `/g/*` and `/c/*`.
- Checks: `curl -sI` on the association file (200); `https://app-site-association.cdn-apple.com/a/v1/www.reprizeapp.com`
  (what iPhones use, may lag by hours); on the phone, tap a `/g/teste` link pasted into Notes (typing it in Safari's
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
`share_downloaded`, `courtesy_used` (1–3), `courtesy_exhausted`, `received_export_blocked`, `received_purchase`,
`capture_blocked`, `share_expired_unopened`, `received_user_first_recording`.

Headline numbers: new users per share created, revenue per share created, GB stored per event.

## 10. Phase 0 — spikes and decisions

| # | Spike | Passes when |
|---|---|---|
| 1 | Background upload | A 12-clip recording uploads with the screen locked and the signal dropping, and resumes without sending finished clips again. Screen `/spike-upload`, function `supabase/functions/spike-sign` |
| 2 | Upload while recording | Cancelled (decision 16): nothing uploads while recording |
| 3 | Capture protection | Screenshot shows black over the video and screen recording triggers the message, on the current iOS, with the app's player and Modo Foco overlay |

Also in Phase 0: measure real clip sizes (Full HD and 4K, 15–60 s); choose account, database and storage services;
set up Universal Links on `www.reprizeapp.com`; define the courtesy counter and the 24-hour cleanup on the server.

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
