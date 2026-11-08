# LANCE: second iPhone as a remote (design)

> Date: 2026-10-19. Status: awaiting review. Scope: iPhone to iPhone only. Android comes later.
> Origin: field test on a sand court (2026-10-19). Gestures and voice were unreliable with music and a phone 3-4 m away, while the
> Bluetooth remote and the Apple Watch worked. Not everybody owns either, but everybody has a second phone.

## 1. Goal

A second iPhone running LANCE acts as a big "Salvar" button for the phone that is filming. One tap on the remote saves the clip
exactly like a tap on the screen, the watch or a Bluetooth remote.

Success looks like:
- Pairing takes under a minute, with no typing in the normal path, and nobody is left wondering which phone does what.
- After the first pairing, the remote reconnects by itself whenever both apps are open.
- A tap on the remote becomes a saved clip through the existing pipeline (trigger bus, 3 s debounce, signal on save), and the
  remote confirms the result with a vibration.

Non-goals (this phase): Android, live camera preview on the remote, the remote working while LANCE is in the background,
internet relays, AirPods, more than one camera phone per remote at the same time.

## 2. Decisions already taken

| Topic | Decision |
|---|---|
| Platforms | iPhone to iPhone only. Android is a follow-up. |
| Transport | Apple MultipeerConnectivity (Bluetooth + peer-to-peer Wi-Fi, no internet, encrypted), behind a small `RemoteTransport` interface so Android can add Bluetooth LE later. |
| Pairing | QR code as the main path, 6-digit code as the fallback, then a remembered "trusted pair". |
| QR reading | By the iPhone's own Camera app on the remote phone, which opens LANCE through the existing `lance://` scheme. No in-app scanner. |
| Clarity | The pairing screen must say, in plain words, to use the **Camera app of the remote phone** (section 6.2). |
| App | Same app, two roles: Camera (default) and Remote. |
| Trigger | A new trigger source `phone`, next to `screen`, `gesture`, `remote`, `watch`, `voice`. |

## 3. Architecture

Pure logic lives in `ReplayCore` (SwiftPM, tested with `swift test`). Everything that needs Multipeer, Keychain or CoreImage is a thin
layer on top. JS only sees the module API and events.

| Unit | Where | Purpose | Depends on |
|---|---|---|---|
| `RemoteMessage` | Core | Wire format between the two phones (encode/decode, malformed input returns nil). Mirrors `WatchMessage`. | Foundation |
| `PairingOffer` | Core | One pairing attempt on the camera phone: secret, 6-digit code, expiry, wrong-attempt counter and lock. | Foundation, clock |
| `RemoteProof` | Core | HMAC-SHA256 proofs for pairing and reconnecting, with a timestamp window. | CryptoKit |
| `TrustedPeers` | Core | The list of trusted pairs (add, replace, remove, lookup) behind a `PeerKeyStore` protocol. | none |
| `remoteScreen` | `src/remote` (TypeScript) | Pure function for what the remote screen shows (searching, waiting, recording, stale, denied). Mirrors `WatchModel`, but lives in TypeScript because the remote screen is a React Native screen. | none |
| `RemoteLink` | iOS glue | Multipeer advertiser/browser/session, Keychain `PeerKeyStore`, QR image from CoreImage. Not unit-testable. | the Core units |
| Module API + events | `ReplayCameraModule` | Exposes the link to JS (section 7). | `RemoteLink` |
| JS screens | `src/app` | Pairing sheet, `/pair`, `/remote`, the "Celular" tile. | module API |

The camera phone's `RemoteLink` turns a received `save` into the existing `onTrigger({ source: 'phone', at })` event, the same path
`WatchBridge` uses. Nothing in the save pipeline changes.

## 4. Roles and entry points

- **Camera** (default): today's flow. The setup screen gets a "Celular" tile (section 6.1).
- **Remote**: the home screen gets a secondary button, "Usar este celular como controle", which opens `/remote`.
  - With no pair yet, `/remote` shows how to pair (section 6.2, remote side).
  - With a pair, it searches for that camera phone and shows the big button.

## 5. Pairing and trust

### 5.1 Pairing (camera phone starts it)

1. The camera phone opens the pairing sheet. It creates a `PairingOffer`: 128-bit `secret`, 6-digit `code`, `hostId` (stable random id
   of this phone), `hostName`, valid for 120 s.
2. It advertises on Multipeer service type `lance-remote`, marked as "pairing".
3. The sheet shows a QR with `lance://pair?h=<hostId>&s=<secret, base64url>&n=<hostName>` and the code.
4. Remote phone, QR path: the Camera app reads the QR and opens LANCE on `/pair`. Code path: the user types the code in `/remote`.
5. The remote phone invites the camera phone, sending a proof: `HMAC(secret or code, "pair" | timestamp | remoteId)`. Over the QR path it
   knows `hostId` and picks that host. Over the code path it tries every phone that is advertising "pairing".
6. The camera phone checks the proof and the 120 s window. A wrong proof counts as an attempt; after 5 the offer is locked and the
   sheet asks for a new code.
7. On success, over the encrypted session, the camera phone sends a fresh 256-bit `pairKey` plus its `hostId` and `hostName`. Both phones
   store the pair (id, name, `pairKey`) in the **Keychain**. The sheet and `/pair` show success.

### 5.2 Reconnecting (no QR)

While LANCE is open on the camera phone's setup or recording screens and at least one pair exists, it advertises. A remote that has the
pair, with `/remote` open, browses and invites with `HMAC(pairKey, "reconnect" | timestamp | remoteId)`. The camera phone accepts only a
known `remoteId` with a valid proof inside a 60 s window. Everybody else is ignored without any prompt.

### 5.3 Managing pairs

The pairing sheet lists the paired remotes ("Controles pareados") with a remove action. Removing deletes the key on the camera phone;
when that remote next tries to reconnect, the camera phone answers `unpaired` (it does not know that `remoteId`), and only then does the remote delete its own entry and show "Este controle não está mais pareado". A failed proof alone (for example clock skew) never deletes a pair; it shows "Sem conexão".
Pairing the same remote again replaces its key.

### 5.4 Threat model

The only thing a remote can do is ask for a save. No video or file ever travels to the remote; it receives only the recording state.
The risk is a nearby stranger pressing Salvar, i.e. a nuisance, not a data leak. So: the session is encrypted, the QR path uses a
128-bit secret, the code path is limited by the 120 s window and 5 attempts (a 6-digit code is weak against someone sniffing the
invitation, which is accepted for this threat model), and trusted pairs use a 256-bit key.

## 6. User experience

All user-facing text is Brazilian Portuguese. Texts below are the intended copy.

### 6.1 Camera phone

- Setup screen: a new tile **"Celular"** next to Voz, Braços, Controle and Relógio. Status: "Nenhum controle pareado",
  "Pareado: <nome>" or "Conectado: <nome>". Tapping it opens the pairing sheet.
- Pairing sheet, in this order:
  1. Title: "Parear um celular como controle".
  2. Instruction (required, always visible, above the QR): **"No celular que vai ser o controle, abra o app Câmera do iPhone (o da
     câmera normal) e aponte para este código. Depois toque em 'Abrir no LANCE'."**
  3. The QR.
  4. Fallback: "Não leu? Abra o LANCE no controle, toque em 'Usar este celular como controle' e digite o código:" and the code, big.
  5. "Válido por 1:59" countdown and "Gerar novo código".
  6. "O LANCE precisa estar instalado no celular controle."
  7. The list of paired remotes with "Remover". With 4 remotes already paired, the sheet says "Limite de 4 controles. Remova um para parear outro." and offers no new code.

### 6.2 Remote phone

- With no pair, `/remote` shows: "Para parear: no celular da câmera, toque no tile 'Celular'. Depois, **abra o app Câmera deste
  iPhone** e aponte para o código que aparecer lá. Se preferir, digite o código abaixo." and a 6-digit input.
- `/pair` (opened by the Camera app): "Conectando a <nome>…", then "Pronto! Este celular agora controla <nome>", then it goes to `/remote`.
  Errors: expired ("Código vencido. Peça um novo no celular da câmera."), locked ("Muitas tentativas. Gere um novo código."),
  not found ("Não encontrei o celular da câmera. Chegue mais perto e confira se o LANCE está aberto lá.").
- `/remote`, screen states (from `RemoteLinkModel`):
  - searching: "Procurando <nome>…"
  - connected, game not started: "Conectado a <nome>. Aguardando o jogo começar." (button disabled)
  - recording: clock and count ("12:34 · 3 clipes") and a huge **SALVAR** button.
  - after a tap: a short "Salvo!" in green with a vibration, or "Não salvou" in red with another vibration.
  - stale (no news for 12 s): "Sem conexão com <nome>", button disabled, keeps searching.
  - Local Network denied: "Libere a rede local nos Ajustes para usar o controle." with a button to open Settings.
- The screen stays awake while `/remote` is open. The remote must stay in the foreground: iOS suspends the link otherwise.

## 7. Module API and events (names are indicative; the plan fixes them)

Functions on `ReplayCamera`: start/stop hosting a pairing offer (returns the QR url, code, expiry, and a QR image path), submit a code
or a scanned offer from the remote, start/stop the controller role, send `save`, list and remove trusted pairs, and push the
recording state to the remote (like `watchSync`).

Events: `onRemoteStatus` (the `RemoteLinkModel` state for the UI), `onRemotePairing` (progress and errors), and the existing
`onTrigger` with `source: 'phone'`.

`TriggerSource` gains `'phone'` (label "Celular"). Android keeps its own union values and ignores the new one.

## 8. Wire messages

Encoded as dictionaries like `WatchMessage`, over the Multipeer session (reliable):
- remote to camera: `{cmd: "save"}`
- camera to remote: `{recording, clipCount, startedAt?}` (state, repeated every 5 s while recording), `{result: "saved" | "failed"}`,
  `{paired: {hostId, hostName, pairKey}}` (only during pairing), `{unpaired: true}`
- unknown or malformed messages are dropped: a stray message must never save a clip.

## 9. Platform configuration

`app.json` / `app.config.js` iOS `infoPlist` gains `NSLocalNetworkUsageDescription` (pt-BR text explaining the link to the camera phone)
and `NSBonjourServices` with `_lance-remote._tcp` and `_lance-remote._udp`. The `lance` scheme already exists. No new JavaScript
dependency: the QR image is made natively and the remote needs no camera permission of its own.

## 10. Errors and edge cases

- Remote taps Salvar while the camera phone is not recording: the button is disabled; if a message still arrives, the camera phone drops it
  before it reaches the trigger bus, so it neither saves nor uses up the 3 s debounce.
- Camera app killed or locked: the remote goes stale after 12 s and reconnects by itself when the app returns.
- Two remotes tapping within 3 s: the existing bus drops the second one. Up to 4 trusted pairs and 4 simultaneous connections.
- Bluetooth or Wi-Fi off, or Local Network denied: surfaced as a state with the right instruction, never a silent failure.
- The QR opens LANCE while the remote phone is mid-pairing or already paired: the new pairing replaces the old one for that camera phone.
- Clock skew between the phones larger than 60 s makes reconnects fail; both are network-synced in practice, and the failure shows
  as "Sem conexão" with a retry.

## 11. Testing

Core (`swift test`, run on a Mac):
- `RemoteMessage`: round trip of every case; malformed and unknown payloads return nil.
- `PairingOffer`: valid proof inside the window; expired; wrong proof counts an attempt; lock after 5; new offer resets; code and secret differ.
- `RemoteProof`: reconnect proof accepted; tampered, wrong key, wrong id and out-of-window timestamp rejected.
- `TrustedPeers`: add, replace on re-pair, remove, lookup, the limit of 4.

JavaScript (the repo's existing test runner, native module mocked): `remoteScreen` (searching, waiting, recording, stale after 12 s, recovery, denied); `TriggerSource` and label for `phone`; the "Celular" tile statuses; `/pair` parameter parsing (valid,
expired, malformed link); `/remote` states and button enabled only while recording; the pairing sheet contains the Camera-app
instruction text of section 6.1 and the remote's no-pair screen contains the one of section 6.2.

On two physical iPhones (cannot be automated), checklist for the field test:
1. The Camera app reads the QR and offers "Abrir no LANCE" (assumption to confirm on device; the code path is the fallback).
2. Pair by QR, by code, with a wrong code 5 times, with an expired code.
3. Quit and reopen each app: it reconnects without a QR.
4. Tap Salvar at 5, 10 and 20 m: clip saved, remote vibrates, latency feels instant.
5. Remove a pair on the camera phone and confirm the remote notices.
6. Local Network denied, then allowed.

## 12. Follow-ups

Android transport (Bluetooth LE) behind `RemoteTransport`; the remote working in the background; live preview on the remote;
showing the remote as the trigger source in the clip list; copy for the onboarding mentioning the remote.

## 13. Update 2026-10-22: connection and pairing reliability

Origin: field report. The pairing code was refused as expired after about a minute while the camera phone still counted down
two minutes, and the remote showed "Sem conexão" while it was in fact connected.

- **Heartbeat.** The camera phone now sends its state every 5 s to every connected remote whether or not it is recording
  (before, only while recording). The remote treats a connected link with no news for 12 s as silent (`stale`, "Sem sinal de X"),
  and a dropped link as `reconnecting` ("Reconectando a X…"). A waiting remote never shows a failure while beats arrive.
- **Pairing offer.** A good proof only *reserves* the offer for that remote. The offer is spent when the pairing completes
  (`paired` sent). If the connection fails before that, the reservation is released, and the same remote can retry until the
  120 s are over. Reasons sent to the remote: `expired` (time only), `locked`, `wrong`, `used` (another remote holds the code),
  `closed` (no pairing is open). The camera phone tells its sheet when a remote is linking up (`connecting`), when that failed
  (`released`) and when five wrong tries ended the offer (`offerEnded`).
- **Diagnosis.** `RemoteHost` logs every invitation decision with `os.Logger` (subsystem `LANCE`, category `RemoteHost`; open
  Console.app on the Mac with the camera phone connected). The 60 s window of `RemoteProof` is only about clock difference and
  produces "wrong", never "expired".
- **Camera phone screen.** `/pairing` opens on the paired remotes (Conectado/Offline, "Verificar", "Remover" with a
  confirmation naming the remote). The QR and the code are made only after "Parear outro celular" (or at once when nobody is
  paired). "Verificar" sends `{ping: token}`; the remote answers `{pong: token}`; the result is `onRemoteCheck {id, ok, ms}`
  (no answer in 3 s is `ok: false`). Older builds ignore both messages.
- **Remote screen.** "Usar outra câmera" became "Esquecer esta câmera" with the camera's name and a confirmation that says the
  camera also removes this remote.
- **Requirements, shown on both pairing screens and on failure:** Wi-Fi and Bluetooth on in both phones (no internet and no
  shared network needed), Local Network allowed for LANCE, LANCE open on both phones. Wi-Fi/Bluetooth state is not detected
  automatically: a phone with Wi-Fi on but no network joined looks the same as Wi-Fi off, and reading Bluetooth state needs a
  new permission prompt.

Field checklist for this update (two physical iPhones):
1. Pair by QR and by code; confirm in Console.app the log line for each invitation.
2. Wait 60 s with the sheet open, then pair: must still work until the counter reaches 0.
3. Interrupt the first pairing attempt (move away, come back): the retry must succeed, not say "vencido".
4. Remote connected and waiting for 2 minutes with no game: must stay "Conectado", never "Sem conexão".
5. Close the app on the remote: "Verificar" on the camera phone says "Sem resposta" within about 3 s.
6. Wi-Fi off, Bluetooth off, both on different Wi-Fi networks, and a Wi-Fi with client isolation: note what happens.

## 14. Update 2026-10-22: clip orientation and watermark anchor

**Problem.** `SegmentWriter` stamps the phone's position on the track once, at the first frame of a session. A phone opened upright and then mounted sideways saved every clip rotated, which also gave the clip screen the wrong video shape (and so the wrong watermark position).

**Change.**
- `ReplayEngine.saveClip` reads `gesture.currentUpright().videoRotationDegrees` when the save is requested and passes it to `ClipConcat.normalize(_:to:rotationDegrees:)`.
- `normalize` inserts the video into an `AVMutableComposition`, sets the track `preferredTransform` to that rotation and exports with the passthrough preset (no re-encode).
- `ShareOverlay` anchors the logo to the bottom-right corner of the video image instead of the 9:16 frame, with the same margin (4.5% of frame width). Vertical clips look unchanged; landscape clips get the mark inside the image.
- Clips saved before this change keep their stored rotation; the "Girar" edit still fixes them.

**Field checklist (device, Release build).**
1. Open the camera upright, then mount the phone sideways and save: the clip plays landscape, mark inside the video's bottom-right corner.
2. Open the camera sideways and save: same result.
3. Rotate between plays in the same session: each clip follows the position at the time of its play.
4. Vertical clip: mark in the bottom-right corner, equal right and bottom margins.
5. If a clip still comes out with the wrong rotation, the passthrough export did not keep the composition transform; fall back to applying the rotation in `ClipExporter`.

### 14.1 Landscape frame (same day)
Landscape clips are previewed and exported in a landscape frame (1280×720 free, 1920×1080 pro) with no bands; vertical clips keep 720×1280 / 1080×1920. The shape comes from the clip (after the manual "Girar"). The mark is anchored to the frame's bottom-right corner and sized from the frame's short side, so it has the same pixel size in both orientations. The app stays portrait-locked: a landscape clip previews 16:9 at full width, and "Tela cheia" shows the raw video. Field check: record sideways, export, and open in Photos with the phone held sideways; the mark reads normally in the bottom-right corner.

## 15. Update 2026-10-22: setup screen with the phone on its side

**Problem.** The app is portrait-locked, so with the phone held sideways the settings sheet (summary + "Começar gravação") covers a wide strip of the camera view, and the mode tip competes with the positioning guide.

**Change.**
- Native: `getUpright()` (`ReplayCameraModule.swift`) returns the accelerometer position; JS wrapper `getDeviceUpright()` falls back to `'portrait'` where unavailable.
- `useDeviceLandscape(active)` polls every 300 ms while the setup screen is live and idle; a change needs two matching reads, so a tilt in passing does not flicker the layout.
- On its side, the sheet is replaced by `CompactDock`: "Ajustes" and "Gravar" buttons at the edge. The mode tip is hidden and the guide area uses the whole screen. "Ajustes" opens the full sheet over the camera on demand; closing it returns to the compact dock. Upright behaviour is unchanged.

**Field checklist.**
1. Open setup upright: sheet as before. Turn the phone on its side: sheet becomes "Ajustes" + "Gravar", guide larger.
2. Tilt briefly and back: no flicker.
3. "Ajustes" shows all settings; closing returns to the two buttons.
4. "Gravar" starts the game; errors (storage, permission) show above the buttons.
5. Both sideways positions (left and right) behave the same.
