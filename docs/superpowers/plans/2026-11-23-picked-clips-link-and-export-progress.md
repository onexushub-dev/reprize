# Picked-clips link and export progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share a link with only the picked clips of a recording, show share confirmations in the app's glass dialog, and give Salvar/Enviar a glass progress card with real percent and a Cancelar that stops at once.

**Architecture:** The picked-clips link is the recording link with a filtered clip list (`shareRecording(..., clipIds)`); server, web page and receiver are unchanged. Confirmations move from `Alert.alert` to a small dialog store rendered once by a `GlassDialogHost`. Export progress comes from a new native `onExportProgress` event and `cancelExport(exportId)`; a JS `ExportTracker` turns them into one percent per card and cancels every running export.

**Tech Stack:** Expo SDK 58, React Native 0.88, React 19 (React Compiler), expo-router, MMKV, react-native-svg, Swift (AVAssetExportSession), jest-expo + RNTL 14.

**Spec:** `docs/superpowers/specs/2026-11-23-picked-clips-link-design.md` (builds on `2026-11-22-multi-recording-share-design.md`). Mockups: Claude Design canvas "Reprize · Link de clipes e progresso".

## Global Constraints

- Never run `git add/commit/push`; give the commands to the user. Commit messages never carry a `Claude-Session:` line.
- No optional chaining (`?.`) anywhere; explicit checks.
- Every user-facing text in `app/src/i18n/locales/pt-BR.ts` and `en.ts`; no accented Portuguese outside the catalogs (noHardcodedPortuguese test).
- React Compiler purity: no `Date.now()` and no ref reads during render.
- Every change has tests; `npx tsc --noEmit` clean; eslint 0 errors. Jest in the VM: `NODE_PATH=$HOME/jestfix/node_modules npx jest <path>` from `app/`.
- No change to how Bola/Jogadores analyses or the export render itself work (only progress reporting and cancel are added around `AVAssetExportSession`).
- No new network requests, no polling of the server; the native progress timer runs only while an export runs.
- No new native dependency (no expo-blur): glass is drawn with translucent fills and a light rim.
- Selection bar buttons are icons only (no text); VoiceOver labels carry the words.
- Copy fixed by the spec (pt-BR): "Compartilhar N clipes dessa gravação?", "Esta gravação já tem um compartilhamento ativo", "O link vale por mais Nh. Para enviar outros clipes, desligue o link atual.", buttons "Cancelar"/"Compartilhar", "Fechar"/"Ver link", card titles "Preparando o vídeo…", "Preparando N de M…", "Salvando na galeria…", "Abrindo o compartilhamento…".

## Review Focus

1. Cancelar tapped right after Salvar/Enviar, before the native session exists: the export must still stop (cancel remembered for that id). Test in Task 1 (Swift, by reasoning + device) and Task 2 (`cancelAll` before the first progress event still calls native cancel for that id).
2. Cancel never shows "Não deu para preparar" or tracks `export_failed`: a `CANCELLED` rejection is a quiet stop. Tests in Tasks 4 and 5.
3. Picked clips without a stored `number` keep the number they show on the sender's screen (index in the whole recording, not in the pick). Test in Task 7.
4. A recording inside a live group link counts as "already shared": the picked-clips button shows the live-link notice with that group's hours. Test in Task 8.
5. A cached export (same look already made) finishes with no progress events: the card must not hang at 0% or spin forever. Test in Task 4.

---

### Task 1: Native export progress and cancel (iOS + TS wrapper)

**Files:**
- Modify: `app/modules/replay-camera/ios/ClipExporter.swift`, `app/modules/replay-camera/ios/ReplayCameraModule.swift` (record `ExportClipOptions` at line ~60, `Events(...)` at ~183, `exportClip` at ~326)
- Modify: `app/modules/replay-camera/src/ReplayCamera.types.ts` (`ExportClipOptions`, `ReplayCameraModuleEvents`), `app/modules/replay-camera/src/ReplayCamera.ts`, `app/modules/replay-camera/index.ts` (export)
- Test: `app/modules/replay-camera/src/__tests__/ReplayCamera.test.ts`

**Interfaces:**
- Produces (TS): `ExportClipOptions.exportId?: string`; event `onExportProgress: (e: { exportId: string; progress: number }) => void` (progress 0..1); `cancelExport(exportId: string): void` (no-op when the native function is absent); exportClip rejects with code `CANCELLED` when cancelled.

- [ ] **Step 1: Write the failing tests** in `ReplayCamera.test.ts`: `cancelExport('e1')` calls the native `cancelExport` with `'e1'`; with the native function missing it does not throw.
- [ ] **Step 2: Run** `NODE_PATH=$HOME/jestfix/node_modules npx jest modules/replay-camera` → FAIL (`cancelExport` not exported).
- [ ] **Step 3: Implement the TS side**: `cancelExport` beside `cancelBall` (same presence-check pattern), types as above, re-export from `index.ts`.
- [ ] **Step 4: Implement Swift.** `ExportClipOptions` gains `@Field var exportId: String? = nil`, passed into `ClipExporter.Options.exportId: String?`. In `ClipExporter`: a lock-guarded registry `[String: AVAssetExportSession]` plus a `cancelled: Set<String>`; `static var onProgress: ((String, Double) -> Void)?`; `static func cancel(_ id: String)` (cancels the registered session, else remembers the id). With an `exportId`: register the session before `exportAsynchronously`, cancel at once if the id was remembered, and run a `Task` that emits `session.progress` every 0.2 s while status is `.waiting`/`.exporting`; unregister (and forget the id) after it ends. `status == .cancelled` → remove the partial file and throw a new `Failure.cancelled`. Module: add `"onExportProgress"` to `Events`, set `ClipExporter.onProgress` where the other `emit` hooks are set (line ~190) to `sendEvent("onExportProgress", ["exportId": id, "progress": p])`, add `Function("cancelExport") { (id: String) in ClipExporter.cancel(id) }`, and map `Failure.cancelled` to `ReplayException("CANCELLED", "export cancelled")` before the generic `ENCODER_FAILED`. Android: no change.
- [ ] **Step 5: Run** the module tests → PASS; `npx tsc --noEmit` clean. (Swift is checked by the user's native build.)
- [ ] **Step 6: Commit** (commands to the user): `git add app/modules/replay-camera && git commit -m "feat(native): export progress events and cancelExport"`

### Task 2: ExportTracker

**Files:**
- Create: `app/src/share/exportTracker.ts`
- Test: `app/src/share/__tests__/exportTracker.test.ts`

**Interfaces:**
- Consumes: Task 1 `cancelExport`, `addReplayListener('onExportProgress', …)`, `ExportClipOptions`, `ExportedClip`.
- Produces:
  - `type ExportTracker = { exportClip(o: ExportClipOptions): Promise<ExportedClip>; running(): number; runningProgress(): number; known(): boolean; cancelAll(): void; subscribe(listener: () => void): () => void; dispose(): void }`
  - `createExportTracker(deps?: { exportClip?: (o: ExportClipOptions) => Promise<ExportedClip>; listen?: (cb: (e: { exportId: string; progress: number }) => void) => { remove(): void }; cancel?: (id: string) => void; newId?: () => string }): ExportTracker` — `exportClip` adds a fresh `exportId`, tracks it while running, removes it when it settles; `runningProgress()` = sum of the running exports' last progress (0 for one with no event yet); `known()` = at least one progress event arrived since the last `cancelAll`/creation; `cancelAll()` calls `cancel(id)` for every running id; listeners fire on every event and settle.
  - `isCancelled(error: unknown): boolean` — `code === 'CANCELLED'`.

- [ ] **Step 1: Write the failing tests**: ids are unique and passed to the wrapped `exportClip`; two running exports at 0.5 and 0.25 → `runningProgress()` 0.75 and `known()` true; after both settle `running()` 0; `cancelAll()` right after starting (no event yet) calls `cancel` with that id; events for an unknown id are ignored; `dispose()` removes the listener; `isCancelled({ code: 'CANCELLED' })` true, `isCancelled(new Error('x'))` false.
- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** in `exportTracker.ts` (defaults: `exportClip`/`cancelExport`/`addReplayListener` from `modules/replay-camera`; `newId` a counter plus `Date.now()` base).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add app/src/share/exportTracker.ts app/src/share/__tests__/exportTracker.test.ts && git commit -m "feat(app): export tracker for progress and cancel"`

### Task 3: Glass export progress card

**Files:**
- Modify: `app/src/components/ExportProgress.tsx`
- Test: `app/src/components/__tests__/ExportProgress.test.tsx`

**Interfaces:**
- Produces: `ExportJob.progress?: number` (0..1, batch or single); `ExportProgress({ job, onCancel? })` unchanged props.

Layout from the mockup: card width 300, padding 22/16/16, radius 30, fill `rgba(36,36,36,0.94)`, 1px rim `rgba(255,255,255,0.12)` with a lighter top line (`GLASS.rimTop`); title top-left (`fonts.bodyBold` 17, `exportTitle`); a 46 px pie: outer ring `rgba(255,255,255,0.55)` 2.5 px, inner wedge `colors.accent` over `rgba(255,255,255,0.10)` (react-native-svg arc); percent under it (`fonts.bodyBold` 14) as `${Math.round(p*100)}%`; Cancelar a 50 px pill, fill `rgba(255,255,255,0.12)`, `fonts.bodySemi` 16, only when `onCancel` is given.

- [ ] **Step 1: Write the failing tests**: `{stage:'preparing', progress:0.42}` shows "42%" and a progressbar with `accessibilityValue.now` 42; no `progress` → no "%" text and a spinning indicator; `stage:'delivering'` → no percent, no Cancelar even with `onCancel`, ring full (`accessibilityValue.now` 100); Cancelar press calls `onCancel`; existing title tests keep passing.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the card (pie as a small local component in the same file).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add app/src/components/ExportProgress.tsx app/src/components/__tests__/ExportProgress.test.tsx && git commit -m "feat(app): glass export progress card with percent"`

### Task 4: Clip screen — progress and Cancelar

**Files:**
- Modify: `app/src/app/clip/[id].tsx` (`ensureExport` ~1118, `run` ~1136, `<ExportProgress>` ~1501)
- Test: `app/src/app/__tests__/clip.test.tsx`

**Interfaces:**
- Consumes: Task 2 `createExportTracker`, `isCancelled`; Task 3 `ExportJob.progress`.

One tracker per screen (created once, `dispose()` on unmount); `ensureExport` calls `tracker.exportClip` instead of `exportClip`; on tracker change while `stage === 'preparing'` set `job.progress` to `runningProgress()` when `known()`. Cancelar (only while preparing): mark the run cancelled, `tracker.cancelAll()`; the `catch` treats `isCancelled(error)` or the mark as a quiet stop (no `setNotice`, no `export_failed`), `finally` unchanged.

- [ ] **Step 1: Write the failing tests** (camera mock already in the file; make the mocked `exportClip` hold until released and add `cancelExport`, `addReplayListener` capturing `onExportProgress`):
  - Salvar → the card shows "Preparando o vídeo…"; emitting `{exportId, progress: 0.5}` shows "50%".
  - Cancelar → `cancelExport` called with that id; the mocked export rejects `{code:'CANCELLED'}` → the card closes, no "Não deu para preparar" text, `trackEvent` not called with `export_failed`, Salvar enabled again.
  - A cached look (`cachedExport` returns a path) → no card left on screen after the gallery write (Review Focus 5).
- [ ] **Step 2: Run** `… npx jest src/app/__tests__/clip.test.tsx` → FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** → PASS (whole file).
- [ ] **Step 5: Commit** `git add app/src/app/clip/[id].tsx app/src/app/__tests__/clip.test.tsx && git commit -m "feat(app): clip export shows progress and can be cancelled"`

### Task 5: Batch — progress and immediate cancel

**Files:**
- Modify: `app/src/share/batchExport.ts`, `app/src/share/useBatchActions.ts`
- Test: `app/src/share/__tests__/batchExport.test.ts`, create `app/src/share/__tests__/useBatchActions.test.tsx`

**Interfaces:**
- Consumes: Task 2 tracker; Task 3 `ExportJob.progress`.
- Produces: unchanged `useBatchActions` return shape; `cancel()` now also calls `tracker.cancelAll()`.

`runBatch`: a rejection with `isCancelled` while `signal.cancelled` is neither `done` nor `failed`. `useBatchActions`: one tracker per hook (dispose on unmount), passed as `exportClip: tracker.exportClip`; while preparing, `job.progress = (done + tracker.runningProgress()) / total` once `known()` (recomputed on `onProgress` and on tracker change).

- [ ] **Step 1: Write the failing tests**:
  - `batchExport.test.ts`: signal cancelled and `exportClip` rejecting `{code:'CANCELLED'}` → result `failed` is empty.
  - `useBatchActions.test.tsx` (renderHook; mock `modules/replay-camera`, `OverlayCapturer`, `askPhotos` → true, `expo-media-library`): `save([a,b])` with exports held → `job.step` 0 of 2; progress event 0.5 on the first → `job.progress` 0.25; `cancel()` → native `cancelExport` called for both running ids at once; after the rejections `job` is undefined and no card is set.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both files → PASS; also `src/app/__tests__/session.test.tsx`.
- [ ] **Step 5: Commit** `git add app/src/share && git commit -m "feat(app): batch export progress and immediate cancel"`

### Task 6: Glass dialog and share confirmations

**Files:**
- Create: `app/src/components/dialog.ts`, `app/src/components/GlassDialog.tsx`
- Modify: `app/src/app/_layout.tsx` (render `<GlassDialogHost />` after `<Stack>`), `app/src/cloud/shareConfirm.ts` (`confirmShare` uses `showDialog`)
- Test: create `app/src/components/__tests__/GlassDialog.test.tsx`; update `app/src/cloud/__tests__/shareConfirm.test.ts`, `app/src/app/__tests__/gamesShare.test.tsx` (they spy on `Alert.alert` today)

**Interfaces:**
- Produces: `type DialogSpec = { title: string; body?: string; cancel: string; confirm: string; onConfirm: () => void }`; `showDialog(spec: DialogSpec): void`; `closeDialog(): void`; `currentDialog(): DialogSpec | undefined`; `subscribeDialog(listener: () => void): () => void`; `GlassDialogHost()`.

Look from the mockup: transparent `Modal` (fade), backdrop `rgba(0,0,0,0.48)`, card width 284, radius 22, fill `rgba(38,38,38,0.96)`, rim `GLASS.rim`/`GLASS.rimTop`; centred title (`fonts.bodyBold` 17) and body (`fonts.body` 13.5, `colors.soft`); two 48 px pills in a row: cancel fill `rgba(255,255,255,0.10)` white text, confirm `colors.accent` with `colors.onAccent` text (`fonts.bodyBold`). Either button closes the dialog; confirm then calls `onConfirm`. Android back closes it as cancel.

- [ ] **Step 1: Write the failing tests**: host renders nothing until `showDialog`; then title, body and both buttons (roles `button`); confirm → `onConfirm` once and the dialog is gone; cancel → gone, `onConfirm` not called. `shareConfirm.test.ts`: `confirmShare` with no live link → `currentDialog()` has "Compartilhar esta gravação?" and confirm runs `go`; live link → `go` at once, no dialog.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** store (module-level state + listeners, `useSyncExternalStore` in the host) and component; switch `confirmShare`; mount host in `_layout.tsx`.
- [ ] **Step 4: Run** the three test files plus `src/app/__tests__/session.test.tsx` → PASS.
- [ ] **Step 5: Commit** `git add app/src/components/dialog.ts app/src/components/GlassDialog.tsx app/src/app/_layout.tsx app/src/cloud/shareConfirm.ts app/src/components/__tests__/GlassDialog.test.tsx app/src/cloud/__tests__/shareConfirm.test.ts app/src/app/__tests__/gamesShare.test.tsx && git commit -m "feat(app): share confirmations in the glass dialog"`

### Task 7: `shareRecording` with picked clips

**Files:**
- Modify: `app/src/data/schema.ts` (`SessionShare.clipIds?: string[]`), `app/src/cloud/shareRecording.ts`, `app/src/analytics/events.ts` (`share_created` gains `picked: 'yes' | 'no'`), `app/src/cloud/shareGroup.ts` (its `share_created` passes `picked: 'no'`)
- Test: create `app/src/cloud/__tests__/shareRecording.test.ts`

**Interfaces:**
- Produces: `shareRecording(sessionId: string, now: () => number = Date.now, clipIds?: readonly string[]): Promise<ShareRecordingResult>`.

With `clipIds`: keep the recording's clips in their order whose id is listed, each with `number: clipNumber(clip, indexInWholeRecording)` filled before `recordingShareInput`; none left → `{ ok: false, reason: 'failed' }`; the stored `SessionShare` has `clips` = picked count and `clipIds`. A live link is still returned as it is (unchanged first line). `track('share_created', { …, picked: clipIds === undefined ? 'no' : 'yes' })`, `clips` bucket of the picked count.

- [ ] **Step 1: Write the failing tests** (mock `repo`, `createShare`, `uploadQueue`, `sharePrep`, `files`, `track`): recording with clips c1..c5 (no `number`), `clipIds ['c4','c2']` → `createShare` input has 2 clips in order c2, c4 with edit numbers 2 and 4 (Review Focus 3) and the stored share has `clips: 2, clipIds: ['c2','c4']`; `clipIds ['zz']` → `{ok:false, reason:'failed'}`, `createShare` not called; no `clipIds` → all 5 clips, `picked: 'no'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** this file plus `src/cloud/__tests__/shareGroup.test.ts` → PASS; tsc clean.
- [ ] **Step 5: Commit** `git add app/src/data/schema.ts app/src/cloud/shareRecording.ts app/src/analytics/events.ts app/src/cloud/shareGroup.ts app/src/cloud/__tests__/shareRecording.test.ts && git commit -m "feat(app): recording link with picked clips"`

### Task 8: Selection bar link button, live-link notice and the share sheet

**Files:**
- Modify: `app/src/components/SelectionBar.tsx` (`onLink?: () => void`, link button first on the left: `LinkShareIcon` 26 amber, same `Action`), `app/src/app/session/[id].tsx` (selection footer ~669), `app/src/cloud/shareConfirm.ts`, `app/src/app/share/[id].tsx` (`clips` param), `app/src/components/ShareLinkPanel.tsx` (clips chip), `app/src/i18n/locales/pt-BR.ts`, `app/src/i18n/locales/en.ts`
- Test: create `app/src/components/__tests__/SelectionBar.test.tsx`, `app/src/components/__tests__/ShareLinkPanel.test.tsx`; extend `app/src/cloud/__tests__/shareConfirm.test.ts`, `app/src/app/__tests__/session.test.tsx`

**Interfaces:**
- Consumes: Task 6 `showDialog`; Task 7 `shareRecording(…, clipIds)`, `SessionShare.clipIds`.
- Produces: `liveLinkExpiry(session: Pick<Session, 'shared'>, now?: number): number | undefined` (own live share's `expiresAt`, or its live group's, by the `live()` rule in `shareConfirm.ts`); `confirmClipsShare(t: TFunction, session: Pick<Session, 'shared'>, name: string, count: number, go: () => void, open: () => void, now?: number): void`.

Copy (pt-BR / en):
- `sharing.confirmClipsTitle`: one "Compartilhar 1 clipe dessa gravação?" / other "Compartilhar %{count} clipes dessa gravação?" — en "Share 1 clip from this recording?" / "Share %{count} clips from this recording?"
- `sharing.confirmClipsBody`: one "Vamos criar um link com este clipe da gravação %{name}. Quem tiver o link pode ver e baixar por 24 horas." / other "Vamos criar um link com estes %{count} clipes da gravação %{name}. Quem tiver o link pode ver e baixar por 24 horas." — en "We'll make a link with this clip from %{name}. Anyone with the link can watch and download it for 24 hours." / "… with these %{count} clips from %{name}. …"
- `sharing.liveTitle` "Esta gravação já tem um compartilhamento ativo" / "This recording already has an active share"
- `sharing.liveBody` one "O link vale por mais 1h. Para enviar outros clipes, desligue o link atual." / other "O link vale por mais %{count}h. …" — en "The link lasts 1 more hour. To send other clips, turn the current link off." / "… %{count} more hours. …"
- `sharing.liveOpen` "Ver link" / "See link"; cancel button uses `common.close`
- `sharing.pickedClips` one "1 clipe dessa gravação" / other "%{count} clipes dessa gravação" — en "1 clip from this recording" / "%{count} clips from this recording"
- `summary.shareLink` (a11y) one "Compartilhar 1 clipe por link" / other "Compartilhar %{count} clipes por link" — en "Share 1 clip by link" / "Share %{count} clips by link"

Hours = `Math.max(1, Math.ceil((expiresAt - now) / 3_600_000))`. Session screen: `onLink` only when `canShareHere`; the handler runs the PRO gate exactly as `startShare` does, then `confirmClipsShare(t, session, sessionLabel(session, undefined, locale), pickedClips.length, () => router.push(\`/share/${id}?clips=${ids}\`), () => router.push(\`/share/${id}\`))` and leaves selection mode on either push. `share/[id].tsx`: read `clips` (comma list), pass the ids that belong to the recording to `shareRecording(sessionId, undefined, ids)`; no param → whole recording. `ShareLinkPanel`: chip text `sharing.pickedClips` when `shared.clipIds` is set (prop type widens to include `clipIds`), else `sharing.clips`.

- [ ] **Step 1: Write the failing tests**:
  - `SelectionBar.test.tsx`: with `onLink` → button "Compartilhar 3 clipes por link" before "Enviar (3)" and pressing it calls `onLink`; without `onLink` → no such button; no visible text on any action button.
  - `shareConfirm.test.ts`: no live link → dialog "Compartilhar 3 clipes dessa gravação?" with the name in the body, confirm runs `go`; own live link with 17.2 h left → dialog "Esta gravação já tem um compartilhamento ativo", body "…por mais 18h…", confirm "Ver link" runs `open`, never `go`; live group link → same notice with the group's hours (Review Focus 4).
  - `ShareLinkPanel.test.tsx`: `clipIds` set, `clips: 3` → "3 clipes dessa gravação"; without → "3 clipes".
  - `session.test.tsx`: own ended recording, two clips picked, PRO → pressing the link button shows the confirmation; confirming pushes `/share/s1?clips=c1,c2`; on a received recording the link button is absent.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the four files → PASS.
- [ ] **Step 5: Commit** `git add app/src/components/SelectionBar.tsx app/src/app/session/[id].tsx app/src/cloud/shareConfirm.ts app/src/app/share/[id].tsx app/src/components/ShareLinkPanel.tsx app/src/i18n/locales app/src/components/__tests__ app/src/cloud/__tests__/shareConfirm.test.ts app/src/app/__tests__/session.test.tsx && git commit -m "feat(app): share picked clips by link from the selection bar"`

### Task 9: Whole-suite check and spec status

**Files:**
- Modify: `docs/superpowers/specs/2026-11-23-picked-clips-link-design.md` (status line: implemented, pending device test)

- [ ] **Step 1:** `cd app && NODE_PATH=$HOME/jestfix/node_modules npx jest` → all suites pass.
- [ ] **Step 2:** `npx tsc --noEmit` → no output; `npx eslint src modules` → 0 errors.
- [ ] **Step 3:** Commit (to the user) `git add docs/superpowers && git commit -m "docs: picked-clips link and export progress plan and spec"`; tell the user a native build is needed (Task 1).
