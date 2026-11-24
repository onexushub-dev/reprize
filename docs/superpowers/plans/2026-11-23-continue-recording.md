# Continue a finished recording — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Continue the latest own recording up to 1 h after it last ended, from its "⋯" menu, with a confirmation, the camera opening ready and a "Continuando" badge.

**Architecture:** The repo reopens a session (`resumeSession`) and keeps the pauses out of its duration (`pausedMs`, `resumedAt`). A pure rule module says which recording can be continued and until when. The session hook gains `continueRecording(sessionId)` beside `start`, reusing its camera steps with the recording's sport and plan. A tiny intent store carries the choice from the recording screen to the camera screen.

**Tech Stack:** Expo SDK 58, RN 0.88, React 19 (React Compiler), expo-router, MMKV repo, jest-expo + RNTL 14.

**Spec:** `docs/superpowers/specs/2026-11-23-continue-recording-design.md`. Mockups: Claude Design "Reprize · Continuar gravação" (B3, C1, C2).

## Global Constraints

- Never run git write commands; commit commands go to the user, without a `Claude-Session:` line.
- No optional chaining; texts only in `pt-BR.ts`/`en.ts` (same key order in both); no accented Portuguese outside catalogs.
- React Compiler purity: no `Date.now()` or ref reads during render (a minute clock in state, as the screens already do).
- Window: `CONTINUE_WINDOW_MS = 60 * 60 * 1000`, counted from the recording's last `endedAt`.
- Never continuable: received recordings, recordings with `passTransactionId`, any recording that is not the latest own one (by `startedAt`).
- The plan stays the recording's (`sessionPlan(session)`); the sport stays `session.sport`.
- No change to share links, uploads, Bola/Jogadores analyses, server.
- Jest: `cd app && NODE_PATH=$HOME/jestfix/node_modules npx jest <path>`; tsc and eslint (with the same NODE_PATH) clean.

## Review Focus

1. A continuation with no new clip, then the app killed: `closeOpenSessions` must end it at `resumedAt`, never before the pause (negative duration). Test in Task 1.
2. The window closing while the camera waits ready: Record asks "O tempo para continuar acabou" and never reopens an expired recording. Test in Task 4.
3. A recording started after the one being continued (even empty) removes the menu option at once. Test in Task 2.
4. Ending a continuation and continuing again: `pausedMs` adds both pauses; the duration shown is the time recorded. Test in Task 1.
5. The ✕ on the badge drops the intent: the next Record starts a new recording with the player's own sport. Test in Task 4.

---

### Task 1: Repo — reopen a recording, pauses out of its duration

**Files:**
- Modify: `app/src/data/schema.ts` (`Session.pausedMs?: number`, `Session.resumedAt?: number`), `app/src/data/repo.ts` (`resumeSession`, `sessionStats`, `closeOpenSessions`)
- Test: `app/src/data/__tests__/repo.test.ts`

**Interfaces:**
- Produces: `repo.resumeSession(id: string, now: number): Session | undefined` — only for an ended own session: clears `endedAt`, `pausedMs = (pausedMs ?? 0) + (now - endedAt)`, `resumedAt = now`, notifies listeners; undefined otherwise (unknown, open or received).

- [ ] **Step 1: Failing tests**: `resumeSession` on a session ended at 10_000 and resumed at 25_000 → `endedAt` undefined, `pausedMs` 15_000, `resumedAt` 25_000; ended again at 40_000 → `sessionStats(id).recordedMs` = 40_000 − startedAt − 15_000; a second pause (end 40_000, resume 50_000, end 60_000) → `pausedMs` 25_000 (Review Focus 4); a received session → undefined and unchanged; `closeOpenSessions` on a continuation with no new clip → `endedAt === resumedAt` (Review Focus 1); a session without `pausedMs` keeps today's duration.
- [ ] **Step 2: Run** `npx jest src/data/__tests__/repo.test.ts` → FAIL (`resumeSession` missing).
- [ ] **Step 3: Implement** (`closeOpenSessions`: end = max(last clip `createdAt`, `resumedAt` ?? `startedAt`); `sessionStats.recordedMs` subtracts `pausedMs`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (to the user) `git add app/src/data && git commit -m "feat(data): reopen a recording and keep pauses out of its duration"`

### Task 2: The rule — which recording can be continued, until when

**Files:**
- Create: `app/src/session/continueRule.ts`
- Test: `app/src/session/__tests__/continueRule.test.ts`

**Interfaces:**
- Produces: `CONTINUE_WINDOW_MS = 3_600_000`; `continuable(sessions: Session[], now: number): Session | undefined` (the latest own session by `startedAt` if it is ended, not received, has no `passTransactionId` and `now - endedAt <= CONTINUE_WINDOW_MS`); `canContinue(sessionId: string, sessions: Session[], now: number): boolean`; `continueUntil(session: Pick<Session, 'endedAt'>): number` (= `endedAt + CONTINUE_WINDOW_MS`).

- [ ] **Step 1: Failing tests**: ended 59 min ago → continuable; 61 min ago → not; exactly 60 min → continuable; received → not; with `passTransactionId` → not; an older ended recording while a newer one exists (even with 0 clips) → not (Review Focus 3); a newer recording still open → nothing continuable; `continueUntil({ endedAt: 1_000 })` = 3_601_000.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `git add app/src/session/continueRule.ts app/src/session/__tests__/continueRule.test.ts && git commit -m "feat(session): rule for continuing the latest recording within 1 hour"`

`listSessions` lists only recordings with clips; the rule needs every session, so add `repo.allSessions(): Session[]` (own and received, any clips) in Task 1's files if none exists, with a one-line test there.

### Task 3: Session hook — `continueRecording`

**Files:**
- Modify: `app/src/session/useReplaySession.ts`, `app/src/session/reducer.ts`, `app/src/session/SessionContext.tsx` (expose it), `app/src/analytics/events.ts`
- Test: `app/src/session/__tests__/useReplaySession.test.tsx`, `app/src/session/__tests__/reducer.test.ts`

**Interfaces:**
- Consumes: Task 1 `repo.resumeSession`, `sessionPlan` (payments/rules).
- Produces: `continueRecording(sessionId: string): Promise<StartResult>` on the hook and `useSession()`; reducer `started` action gains `clipCount?: number` (default 0) and `continuing?: boolean`; state `continuing: boolean` (false on every other start and on reset); event `recording_continued: { pause: '<10min' | '10-30min' | '30-60min'; plan: 'pro' | 'free' }`.

Same steps as `start` (busy guard, open camera, `startBuffering`, gesture/voice) but: sport = `session.sport`; plan = `sessionPlan(session)` (no `startDecision`, no plan re-check); instead of `repo.startSession`, `repo.resumeSession(id, now)` as the last fallible step (undefined → `startFailed`, returns 'failed'); `started` with `sessionId` = the recording, `startedAt` = now, `clipCount` = `repo.listClips(id).length`, `continuing: true`; `cutFloors = [now]`; track `recording_continued`, not `recording_started`.

- [ ] **Step 1: Failing tests** (hook, with `fakeDeps`): start → save 2 clips → stop → advance 20 min → `continueRecording(id)` returns 'started', state `{ phase: 'recording', sessionId: id, clipCount: 2, continuing: true }`, the repo session has no `endedAt` and `pausedMs` 1_200_000, `sessionIds()` still has one recording, the next saved clip lands in that recording; `continueRecording` of an unknown id → 'failed'; reducer: `started` without `clipCount` → 0 and `continuing` false.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** both files → PASS.
- [ ] **Step 5: Commit** `git add app/src/session app/src/analytics/events.ts && git commit -m "feat(session): continue a recording with its own sport and plan"`

### Task 4: Camera screen — the continuation intent, badge and Record

**Files:**
- Create: `app/src/session/continueIntent.ts`
- Modify: `app/src/app/setup.tsx`, `app/src/components/RecordingPanel.tsx`, `app/src/i18n/locales/pt-BR.ts`, `app/src/i18n/locales/en.ts`
- Test: `app/src/session/__tests__/continueIntent.test.ts`, `app/src/app/__tests__/setup.test.tsx`, `app/src/components/__tests__/RecordingPanel.test.tsx`

**Interfaces:**
- Consumes: Task 2 `canContinue`; Task 3 `continueRecording`; `showDialog` (components/dialog).
- Produces: `setContinueIntent(sessionId: string | undefined): void`, `continueIntent(): string | undefined`, `subscribeContinueIntent(l: () => void): () => void`.

Setup screen: with an intent, a glass badge above the camera bar, "↻ Continuando · <sessionLabel>", with an ✕ (a11y "Não continuar") that clears the intent; the camera preview opens with the recording's sport (`session.sport`) instead of `prefs.sport`. Record: intent set and `canContinue(id, sessions, now)` → `continueRecording(id)` then clear the intent; intent set but expired → `showDialog({ title: 'O tempo para continuar acabou', body: 'Já passou 1 hora desde que a gravação terminou. Começar uma nova gravação?', cancel: 'Cancelar', confirm: 'Nova gravação', onConfirm: clear intent + normal start })`; no intent → today's start. The remote hold start does the same. RecordingPanel: while `state.continuing`, the badge "↻ Continuando · <label>" under the top pills (label from `repo.getSession(state.sessionId)`).

Copy keys (pt-BR / en): `continue.badge` "Continuando · %{name}" / "Continuing · %{name}"; `continue.drop` "Não continuar" / "Don't continue"; `continue.expiredTitle` "O tempo para continuar acabou" / "The time to continue is over"; `continue.expiredBody` "Já passou 1 hora desde que a gravação terminou. Começar uma nova gravação?" / "It's been over an hour since the recording ended. Start a new recording?"; `continue.newRecording` "Nova gravação" / "New recording".

- [ ] **Step 1: Failing tests**: intent store set/clear/notify; setup with intent → badge text and Record calls `continueRecording('s1')`, not `start`; ✕ → badge gone and Record calls `start` with the player's mode (Review Focus 5); intent with the recording ended 61 min ago → Record shows the expired dialog, `continueRecording` not called, confirming calls `start` (Review Focus 2); RecordingPanel with `continuing` shows "Continuando · Final".
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the three files → PASS.
- [ ] **Step 5: Commit** `git add app/src/session/continueIntent.ts app/src/session/__tests__/continueIntent.test.ts app/src/app/setup.tsx app/src/components/RecordingPanel.tsx app/src/i18n/locales app/src/app/__tests__/setup.test.tsx app/src/components/__tests__/RecordingPanel.test.tsx && git commit -m "feat(app): camera continues the chosen recording, with its badge"`

### Task 5: Recording screen — "⋯ → Continuar gravação" and the confirmation

**Files:**
- Modify: `app/src/app/session/[id].tsx` (`openMenu`), `app/src/i18n/locales/pt-BR.ts`, `app/src/i18n/locales/en.ts`
- Test: create `app/src/app/__tests__/sessionContinue.test.tsx` (header copied from `sessionShareClips.test.tsx`)

**Interfaces:**
- Consumes: Task 2 `canContinue`, `continueUntil`; Task 4 `setContinueIntent`; `showDialog`; `liveLinkExpiry` (cloud/shareConfirm).

Menu: first option `t('continue.menu', { time })` ("Continuar gravação (até %{time})" / "Continue recording (until %{time})", `time` = `continueUntil` as HH:MM in the phone's locale) only while `canContinue(id, sessions, shareNow)` (the screen's minute clock). Pressing it → `showDialog` with title `continue.confirmTitle` ("Continuar a gravação?" / "Continue the recording?"), body `continue.confirmBody` ("A câmera abre pronta para você posicionar o celular. Os clipes novos entram nesta gravação, depois do #%{last}." / "The camera opens ready so you can place the phone. New clips go into this recording, after #%{last}.") or, with a live link, `continue.confirmLinkBody` ("Ela tem um link ativo. Os clipes novos não entram nele: para enviá-los, desligue o link e crie um novo." / "It has an active link. New clips won't be in it: to send them, turn the link off and make a new one."), buttons Cancelar · `continue.go` ("Continuar" / "Continue"). Confirm → `setContinueIntent(id)` and `router.dismissTo('/setup')`.

- [ ] **Step 1: Failing tests**: ended 20 min ago → the ActionSheet options start with "Continuar gravação (até …)"; picking it shows the dialog with "depois do #3" (three clips); confirming sets the intent to 's1' and calls `router.dismissTo('/setup')`; with a live link the body is the link text; ended 70 min ago → no option; a received recording → no option.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, plus `session.test.tsx`.
- [ ] **Step 5: Commit** `git add "app/src/app/session/[id].tsx" app/src/i18n/locales app/src/app/__tests__/sessionContinue.test.tsx && git commit -m "feat(app): continue a recording from its menu"`

### Task 6: Whole suite, review

- [ ] Full jest, tsc, eslint (0 errors); spec status line "implemented, pending device test"; final review.
