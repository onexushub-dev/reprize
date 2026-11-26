# Partner codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a partner share a link or code that gives their audience a PRO discount, and know per partner who opened, installed, applied the code and subscribed.

**Architecture:** A new `app/src/partner/` module owns the code format, the partner directory (read from RevenueCat offering metadata) and the attribution store (MMKV). `src/payments` gains the partner offering, attribute writes and the iOS offer code redemption; `openPaywall` routes to the partner offer when an attribution is valid. Two routes (`/p/[code]`, `/partner`) take the code in; the landing page repo serves `/p/CODE` and the universal link files.

**Tech Stack:** Expo 58, React Native 0.88, expo-router, `react-native-purchases` 10, `expo-application` (install referrer), `react-native-mmkv` via `src/data/mmkv.ts`, PostHog via `src/analytics`, Jest (`jest-expo`). Landing page: Astro 7 in `~/Documents/reprize-lp`.

**Spec:** `docs/superpowers/specs/2026-11-15-partner-codes-design.md`

## Global Constraints

- Work on a new branch `feat/partner-codes` off `main` (not `temp/quadra-marca`). Stage only the files each task names.
- Code format: 3 to 20 characters, `A-Z0-9`, stored uppercase.
- Partner directory: metadata of the RevenueCat `default` offering, shape `{ "partners": { "<CODE>": { "name": "<display name>" } } }`.
- RevenueCat attributes: `partner_code`, `partner_source`, `$mediaSource = "partner"`, `$campaign = <code>`.
- RevenueCat offering id `partner`; Play base plan `annual-parceiro`; Apple offer reference name `PARCEIROS`; App Store app id `6833159162`.
- Redemption URL: `https://apps.apple.com/redeem?ctx=offercodes&id=6833159162&code=<CODE>`.
- Link hosts: `reprizeapp.com`, `www.reprizeapp.com`; path `/p/<CODE>`; scheme `reprize://p/<CODE>`.
- KV keys: `partner.attribution`, `partner.referrerChecked`.
- Analytics never throws into the app and sends a `partner`/`code` value only for a directory-validated code.
- Copy: professional pt-BR, "código de indicação", "clipe" not "vídeo"; every string in both `src/i18n/locales/pt-BR.ts` and `en.ts`.
- `ios/` and `android/` are generated: native config only through `app.json`.
- Before reporting any task done: `npx jest`, `npx tsc --noEmit`, `npx expo lint` in `app/`.
- Confirm every `react-native-purchases` and `expo-application` method name against the installed types before using it.

## Review Focus

1. A code typed with spaces, lower case, accents or a pasted full link ("  profjoão ", `https://reprizeapp.com/p/profjoao?x=1`) should resolve to the same code or be rejected cleanly, never crash (Task 1).
2. A code applied with no connection must not be lost and must not show a discount until validated (Task 3).
3. A second partner's link opened after a purchase must not move the attribution (Task 3).
4. The partner offering missing or empty in RevenueCat must still let the player buy PRO at the normal price (Task 6).
5. The player cancels Apple's redemption and comes back: no "purchase" recorded, offer still reachable (Task 6).

---

### Task 1: Code parsing

**Files:**
- Create: `app/src/partner/code.ts`
- Test: `app/src/partner/__tests__/code.test.ts`

**Interfaces:**
- Produces: `normalizeCode(raw: string): string | null`; `codeFromUrl(url: string): string | null`; `codeFromReferrer(referrer: string | null | undefined): string | null`.

- [ ] **Step 1: Write the failing tests**

```ts
it('normalizes', () => {
  expect(normalizeCode('  profjoao ')).toBe('PROFJOAO');
  expect(normalizeCode('Prof-João 10')).toBe('PROFJOAO10'); // accents folded, separators dropped
  expect(normalizeCode('ab')).toBeNull();
  expect(normalizeCode('A'.repeat(21))).toBeNull();
  expect(normalizeCode('')).toBeNull();
});
it('reads a code from links', () => {
  expect(codeFromUrl('https://reprizeapp.com/p/profjoao')).toBe('PROFJOAO');
  expect(codeFromUrl('https://www.reprizeapp.com/p/PROFJOAO/?utm=x')).toBe('PROFJOAO');
  expect(codeFromUrl('reprize://p/profjoao')).toBe('PROFJOAO');
  expect(codeFromUrl('https://reprizeapp.com/privacy')).toBeNull();
  expect(codeFromUrl('https://evil.example/p/PROFJOAO')).toBeNull();
  expect(codeFromUrl('not a url')).toBeNull();
});
it('reads a code from the install referrer', () => {
  expect(codeFromReferrer('partner=PROFJOAO&utm_source=wa')).toBe('PROFJOAO');
  expect(codeFromReferrer('partner%3Dprofjoao')).toBe('PROFJOAO');
  expect(codeFromReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
  expect(codeFromReferrer(null)).toBeNull();
});
```

- [ ] **Step 2:** Run `npx jest src/partner/__tests__/code.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement the three functions. `normalizeCode` folds accents with `normalize('NFD')`, uppercases, removes everything outside `A-Z0-9`, then checks the length. `codeFromUrl` accepts only the two hosts and the `reprize:` scheme from Global Constraints; a typed value that is itself a link is handled by the caller trying `codeFromUrl` first, then `normalizeCode`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit `feat(partner): parse partner codes from text, links and install referrer`.

### Task 2: Partner directory from RevenueCat

**Files:**
- Create: `app/src/partner/directory.ts`
- Modify: `app/src/payments/client.ts`, `app/src/payments/revenuecatClient.ts`, `app/src/payments/fakeClient.ts`
- Test: `app/src/partner/__tests__/directory.test.ts`, `app/src/payments/__tests__/revenuecatClient.test.ts`

**Interfaces:**
- Produces: `type PartnerDirectory = Record<string, { name: string }>`; `parsePartners(metadata: unknown): PartnerDirectory`; `PaymentsClient.partners(): Promise<PartnerDirectory | null>` (null = could not be read; `{}` = read and empty).

- [ ] **Step 1: Failing tests**

```ts
// directory.test.ts
expect(parsePartners({ partners: { profjoao: { name: 'Prof. João' }, X: { name: 'short' }, OK1: {} } }))
  .toEqual({ PROFJOAO: { name: 'Prof. João' }, OK1: { name: 'OK1' } }); // keys normalized, invalid dropped, name defaults to the code
expect(parsePartners(undefined)).toEqual({});
expect(parsePartners({ partners: 'nope' })).toEqual({});

// revenuecatClient.test.ts
it('reads the directory from the default offering metadata', async () => {
  (Purchases.getOfferings as jest.Mock).mockResolvedValue({ current: null, all: { default: { metadata: { partners: { PROFJOAO: { name: 'Prof. João' } } } } } });
  expect(await client.partners()).toEqual({ PROFJOAO: { name: 'Prof. João' } });
});
it('returns null when offerings fail or the SDK is not configured', async () => { /* getOfferings rejects → null; no key → null */ });
```

- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Implement `parsePartners`; add `partners()` to the interface and the RevenueCat client (reads `all.default`, falling back to `current`); add `partners` to `createFakeClient` with a settable `directory: PartnerDirectory | null` field.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(partner): partner directory from the default offering metadata`.

### Task 3: Attribution store

**Files:**
- Create: `app/src/partner/store.ts`
- Test: `app/src/partner/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `normalizeCode`, `codeFromUrl` (Task 1); `PartnerDirectory` (Task 2); `KV` from `src/data/repo`.
- Produces:

```ts
export type PartnerSource = 'link' | 'install_referrer' | 'typed';
export type Attribution = { code: string; name: string; source: PartnerSource; appliedAt: number; status: 'valid' | 'pending'; lockedAt?: number };
export type ApplyResult = 'applied' | 'pending' | 'invalid' | 'locked';
export function createPartnerStore(o: {
  kv: KV;
  directory: () => Promise<PartnerDirectory | null>;
  now: () => number;
  onValid?: (a: Attribution) => void; // fired each time an attribution becomes or is confirmed valid
}): {
  start(): Promise<void>;           // re-validates a pending code; re-fires onValid for a valid one
  apply(raw: string, source: PartnerSource, o?: { blocked?: boolean }): Promise<ApplyResult>; // blocked = customer already has PRO
  current(): Attribution | null;    // any status
  active(): Attribution | null;     // status 'valid' and not locked: the one that changes the paywall
  lock(): void;                     // first purchase observed
  subscribe(fn: () => void): () => void;
};
```

- [ ] **Step 1: Failing tests** (in-memory `KV`, a `directory` that returns a settable value)

```ts
it('applies a valid code and persists it', async () => { /* apply(' profjoao ','typed') → 'applied'; active() has code PROFJOAO, name 'Prof. João', status 'valid'; a new store on the same kv returns it */ });
it('accepts a pasted link', async () => { /* apply('https://reprizeapp.com/p/profjoao','typed') → 'applied' */ });
it('rejects an unknown code and keeps the previous one', async () => { /* → 'invalid'; current() unchanged; nothing written */ });
it('keeps a code as pending when the directory cannot be read', async () => { /* directory → null: 'pending'; current().status 'pending'; active() null */ });
it('validates a pending code on start, or drops it when it is not in the directory', async () => {});
it('lets a newer valid code replace an older one', async () => {});
it('never replaces after lock, and never applies when blocked', async () => { /* lock(); apply(other) → 'locked'; blocked:true → 'locked' */ });
it('fires onValid on apply and again on start', async () => {});
it('survives unreadable storage', async () => { /* kv.getString throws → current() null, apply still returns a result */ });
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. State is one JSON value under `partner.attribution`; storage and `onValid` failures are swallowed (in-memory state stays authoritative for the run), same style as `src/analytics/core.ts`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(partner): attribution store`.

### Task 4: Payments client and store: attributes, redemption, partner offering

**Files:**
- Modify: `app/src/payments/types.ts`, `client.ts`, `revenuecatClient.ts`, `fakeClient.ts`, `store.ts`, `app/__mocks__/react-native-purchases.ts`
- Test: `app/src/payments/__tests__/revenuecatClient.test.ts`, `store.test.ts`

**Interfaces:**
- Produces: `Offering = 'default' | 'pass' | 'partner'`; on `PaymentsClient`: `setPartner(code: string, source: string): Promise<void>` and `redeemOfferCode(code: string): Promise<boolean>` (true = Apple's redemption was opened; always false off iOS); on the payments store: `refresh(): Promise<Snapshot>` (re-reads and applies; returns the current snapshot on failure).

- [ ] **Step 1: Failing tests**

```ts
it('writes the partner attributes', async () => {
  await client.setPartner('PROFJOAO', 'link');
  expect(Purchases.setAttributes).toHaveBeenCalledWith({ partner_code: 'PROFJOAO', partner_source: 'link' });
  expect(Purchases.setMediaSource).toHaveBeenCalledWith('partner');
  expect(Purchases.setCampaign).toHaveBeenCalledWith('PROFJOAO');
});
it('setPartner never throws (SDK failure, no key)', async () => {});
it('opens the redemption URL with the code on iOS', async () => { /* Linking.openURL called with the Global Constraints URL, encoded; resolves true */ });
it('falls back to the StoreKit sheet when the URL cannot be opened', async () => { /* openURL rejects → Purchases.presentCodeRedemptionSheet called → true */ });
it('does not redeem on Android', async () => { /* false, nothing called */ });
it('shows the partner offering by its identifier, falling back to the current one', async () => { /* existing lookup path with 'partner' */ });
// store.test.ts
it('refresh applies a fresh snapshot and notifies', async () => {});
it('refresh returns what is known when the read fails', async () => {});
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; extend the mock with `setAttributes`, `setMediaSource`, `setCampaign`, `presentCodeRedemptionSheet`. Verify the Apple redemption URL format against Apple's "Implementing offer codes in your app" page before hard-coding it; if it differs, update the spec and Global Constraints in this commit.
- [ ] **Step 4:** Run the payments tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(payments): partner attributes, offer code redemption and partner offering`.

### Task 5: Analytics events

**Files:**
- Modify: `app/src/analytics/events.ts`; `docs/superpowers/specs/2026-10-28-analytics-design.md` (event catalogue and the documented exception for partner codes)
- Test: `app/src/analytics/__tests__/core.test.ts` (one case that the new events pass through `track`)

**Interfaces:**
- Produces, in `AnalyticsEvents`:

```ts
partner_code_applied: { code: string; source: PartnerSource };           // validated codes only
partner_code_rejected: { source: PartnerSource; reason: 'invalid' | 'locked' }; // never carries the typed text
partner_offer_opened: { code: string; via: 'paywall' | 'offer_code' };
paywall_viewed: { source: PaywallSource; offering: Offering; partner?: string };
purchase_completed: { offering: Offering; partner?: string };
```

- [ ] **Step 1:** Add the failing test, run, see it fail on types (`npx tsc --noEmit`).
- [ ] **Step 2:** Add the event types and update the analytics spec.
- [ ] **Step 3:** `npx jest src/analytics && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(analytics): partner events`.

### Task 6: App-wide partner store and paywall routing

**Files:**
- Create: `app/src/partner/index.ts`
- Modify: `app/src/payments/feedback.ts`, `app/src/app/_layout.tsx`
- Test: `app/src/payments/__tests__/feedback.test.ts`, `app/src/partner/__tests__/index.test.ts`

**Interfaces:**
- Consumes: Tasks 2 to 5.
- Produces: `partner` (the store, wired to `kv`, `client.partners`, `Date.now`, with `onValid` calling `client.setPartner`); `applyPartnerCode(raw: string, source: PartnerSource): Promise<ApplyResult>` (passes `blocked` from `payments.getSnapshot().proActive`, tracks `partner_code_applied` or `partner_code_rejected`); `startPartner(): Promise<void>` (store start, then on Android the one-time install referrer read guarded by `partner.referrerChecked`); `redeemPartnerOffer(t: TFunction): Promise<void>` (iOS: tracks `partner_offer_opened` via `offer_code`, calls `redeemOfferCode`; on the next `AppState` `active` calls `payments.refresh()` and, if PRO became active, tracks `purchase_completed { offering: 'default', partner }` and locks).
- `openPaywall(t, source, offering = 'default')` keeps its signature. New behaviour when `offering === 'default'` and `partner.active()` exists:
  - Android: shows `'partner'`, tracks `paywall_viewed`/`purchase_completed` with `partner`, locks on `purchased`.
  - iOS: `Alert.alert` with the partner name and three buttons: "Ativar desconto" → `redeemPartnerOffer`, resolves `'cancelled'`; "Ver todos os planos" → the normal `default` paywall with `partner` on the events, locks on `purchased`; cancel → `'cancelled'`.
  - `'pass'` is never rerouted.

- [ ] **Step 1: Failing tests**

```ts
it('opens the default paywall untouched with no attribution', async () => {});
it('Android: routes default to the partner offering and tags the events', async () => { /* fake.lastOffering === 'partner'; track called with partner: 'PROFJOAO' */ });
it('Android: locks the attribution on a purchase, not on a cancel', async () => {});
it('never reroutes the pass paywall', async () => {});
it('a pending attribution does not change the paywall', async () => {});
it('iOS: "Ativar desconto" opens the redemption and reports cancelled', async () => {});
it('iOS: coming back without PRO records no purchase and leaves the attribution unlocked', async () => {});
it('iOS: coming back with PRO records purchase_completed once and locks', async () => {});
it('reads the install referrer once on Android and never on iOS', async () => { /* getInstallReferrerAsync mocked: 'partner=PROFJOAO' → applied with source install_referrer; second startPartner does not call it; a rejection from the API is swallowed and still sets the flag */ });
it('does not apply a code for a customer who already has PRO', async () => { /* 'locked', partner_code_rejected reason 'locked' */ });
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. In `_layout.tsx`, call `void startPartner()` in the same effect as `payments.start()`.
- [ ] **Step 4:** Run `npx jest`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(partner): wire attribution into the paywall`.

### Task 7: Screens and copy

**Files:**
- Create: `app/src/app/p/[code].tsx`, `app/src/app/partner.tsx`, `app/src/components/PartnerResult.tsx`
- Modify: `app/src/components/AboutLinks.tsx` (a first line above the legal links), `app/src/i18n/locales/pt-BR.ts`, `en.ts`
- Test: `app/src/app/__tests__/partner.test.tsx`, `app/src/components/__tests__/AboutLinks.test.tsx`

**Interfaces:**
- Consumes: `applyPartnerCode`, `partner`, `redeemPartnerOffer`, `openPaywall`.
- Produces: `<PartnerResult result={ApplyResult} name={string | undefined} onPrimary={() => void} onClose={() => void} />`.

**Copy (pt-BR; write the en equivalents):**

| Key | Text |
|---|---|
| `partner.link` | Tenho um código de indicação |
| `partner.title` | CÓDIGO DE INDICAÇÃO |
| `partner.placeholder` | Digite o código |
| `partner.apply` | Aplicar código |
| `partner.appliedTitle` | Código aplicado |
| `partner.appliedText` | Você tem um desconto no PRO anual por indicação de %{name}. |
| `partner.activate` | Ativar desconto |
| `partner.later` | Agora não |
| `partner.pendingText` | Sem conexão no momento. Confirmamos o código assim que a internet voltar. |
| `partner.invalidText` | Código não encontrado. Confira com quem indicou. |
| `partner.lockedText` | Este código não vale para quem já tem o PRO ou já usou outro código. |
| `partner.offerTitle` | Desconto por indicação de %{name} |
| `partner.offerAll` | Ver todos os planos |

- [ ] **Step 1: Failing tests**

```ts
it('/p/[code] applies the code from the link with source "link" and shows the applied state', async () => {});
it('/partner applies the typed code with source "typed"', async () => {});
it('"Ativar desconto" opens the partner offer (openPaywall on Android, redeemPartnerOffer on iOS)', async () => {});
it('shows the invalid, pending and locked messages', async () => {});
it('closing goes to "/" (replace), never back into the link route', async () => {});
it('AboutLinks shows the code link and opens /partner', async () => {});
```

- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with existing components (`Button`, theme tokens, `useT`). `/p/[code]` reads `useLocalSearchParams<{ code?: string }>()` and applies once on mount. The typed field uses `autoCapitalize="characters"`, `autoCorrect={false}`, `maxLength={64}` (room for a pasted link).
- [ ] **Step 4:** `npx jest && npx tsc --noEmit && npx expo lint`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(partner): link and typed code screens`.

### Task 8: Universal links in the app

**Files:**
- Modify: `app/app.json`

- [ ] **Step 1:** Add `ios.associatedDomains: ["applinks:reprizeapp.com", "applinks:www.reprizeapp.com"]` and an Android `intentFilters` entry with `autoVerify: true`, action `VIEW`, categories `BROWSABLE` and `DEFAULT`, data `https` for both hosts with `pathPrefix: "/p/"`. Check the expo-router linking page for SDK 58 before writing the keys.
- [ ] **Step 2:** `npx expo prebuild --clean` then confirm the entitlement `com.apple.developer.associated-domains` in the generated iOS project and the intent filter in `AndroidManifest.xml`.
- [ ] **Step 3:** `npx expo-doctor`. Expected: no new issues.
- [ ] **Step 4:** Commit `feat(partner): universal links for /p/`.

### Task 9: Landing page (`~/Documents/reprize-lp`, its own branch `feat/partner-links`)

**Files:**
- Create: `src/pages/p/index.astro`, `public/.well-known/apple-app-site-association`, `public/.well-known/assetlinks.json`
- Modify: the host's rewrite config so `/p/:code` serves `/p/` (Vercel: `vercel.json` `rewrites`), and the config that sets `Content-Type: application/json` for the association file. Confirm the host first (`@vercel/analytics` is a dependency).

- [ ] **Step 1:** Page reads the code from `location.pathname` in the browser, normalizes it with the same rule as Task 1, and renders: headline "Você recebeu um desconto no Reprize PRO", the code large with a "Copiar código" button, and by platform:
  - Android: `https://play.google.com/store/apps/details?id=app.reprize.mobile&referrer=partner%3D<CODE>`
  - iPhone: the App Store link with `ct=<CODE>` and the provider token `pt` from App Store Connect (campaign link generator)
  - Both: "Já tenho o app" → `reprize://p/<CODE>`
  - A three-step note for iPhone: baixar, abrir, tocar em "Tenho um código de indicação".
  An invalid or missing code redirects to `/baixar`. `noindex`. Fire the analytics event `partner_link_opened` with `{ code }`.
- [ ] **Step 2:** `apple-app-site-association`: `applinks` with appID `R885ZD42ZG.app.reprize.mobile`, component `/p/*`. `assetlinks.json`: package `app.reprize.mobile` with the SHA-256 of the Play app signing key (Play Console → App integrity) and of the EAS upload key.
- [ ] **Step 3:** `pnpm check && pnpm build`; open `/p/PROFJOAO` in `pnpm preview` on iPhone and Android widths; confirm the three links carry the code.
- [ ] **Step 4:** Deploy a preview; verify `curl -I https://<preview>/.well-known/apple-app-site-association` returns 200 and `application/json`; after production deploy, check Android with `adb shell pm get-app-links app.reprize.mobile`.
- [ ] **Step 5:** Commit `feat: partner link page and app association files`.

### Task 10: Stores and RevenueCat setup, runbook, docs

**Files:**
- Create: `docs/parceiros.md` (runbook, pt-BR)
- Modify: `docs/modelo-de-negocio-e-pagamentos.md` (new section "Códigos de indicação" and a row in "Onde fica cada regra"), `docs/superpowers/specs/2026-10-20-payments-revenuecat-design.md` (offering `partner`), privacy page in `reprize-lp` (the code of the partner is stored with the purchase record)

- [ ] **Step 1: App Store Connect.** On `pro_annual`, create offer code offer `PARCEIROS`: pay up front, 1 year, R$ 83,90 (US $34.99; other countries at the equivalent tier), eligibility new and expired subscribers. Create the first custom code. Record in the runbook what App Store Connect actually shows for per-code redemption counts and the real limits (redemptions per code, expiry).
- [ ] **Step 2: Play Console.** On the PRO subscription add base plan `annual-parceiro` (yearly, R$ 119,90, same regional prices as annual) with one offer: single payment phase, 1 year, R$ 83,90, eligibility "developer determined".
- [ ] **Step 3: RevenueCat.** Import the new Play product, attach it to entitlement `pro`, create offering `partner` (annual package: iOS `pro_annual`, Android `annual-parceiro`; monthly package: the normal monthly), give it the PRO paywall with the line "Desconto por indicação". Add `{ "partners": { ... } }` to the `default` offering metadata. In a sandbox purchase confirm the paywall shows R$ 83,90 on Android; if RevenueCat picks another option, tag or restructure per its Google Play offers page and note it in the runbook.
- [ ] **Step 4: Runbook `docs/parceiros.md`:** creating a partner (choose code → RevenueCat metadata → Apple custom code → send the link and a ready-to-post text), removing one, renewing Apple codes before they expire, the monthly report (table from the spec's Reports section, with the exact dashboard paths found while doing steps 1 to 3), and the App Review note to paste on submission: "The referral code field only records who referred the customer. On iOS, discounts are redeemed exclusively through Apple offer codes (StoreKit redemption)."
- [ ] **Step 5:** Commit `docs: partner codes runbook and business rules`.

### Task 11: Device verification and release

- [ ] **Step 1:** Release build on the iPhone by command (global install notes). With a sandbox account: open `https://reprizeapp.com/p/<CODE>` from Notes → app opens on the applied state → "Ativar desconto" → Apple redemption shows R$ 83,90 → after paying, PRO unlocks without restarting; RevenueCat customer shows `partner_code`; PostHog shows `partner_code_applied` and `purchase_completed` with `partner`.
- [ ] **Step 2:** Same on iPhone with the typed code, with an unknown code, in airplane mode (pending, then validated on reconnect), and cancelling the redemption.
- [ ] **Step 3:** Android internal testing build installed through the Play link with `referrer=partner%3D<CODE>`: first launch applies the code with source `install_referrer`; the paywall shows the partner offering; purchase with a license tester locks the attribution.
- [ ] **Step 4:** A second partner's link after the purchase: "locked" message, attributes unchanged in RevenueCat.
- [ ] **Step 5:** Version bump, merge `main`, EAS production builds for both stores, App Review note from the runbook.
