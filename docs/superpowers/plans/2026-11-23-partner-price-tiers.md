# Partner price tiers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each partner link carry its own PRO price tier on monthly and annual, for more than 10 partners, with no build to add a partner or change a price.

**Architecture:** Each tier is a RevenueCat offering `partner_<tier>` whose metadata holds its percentage and partners. The attribution stores the tier; Android opens that offering, and iPhone opens Apple's offer code for the chosen plan. The monthly payout count comes from RevenueCat's Transactions export.

**Tech Stack:** Expo 58, React Native 0.88, expo-router, `react-native-purchases` 10, MMKV via `src/data/mmkv.ts`, PostHog via `src/analytics`, Jest. Site: Astro 7 in `~/Documents/reprize-lp`.

**Spec:** `docs/superpowers/specs/2026-11-15-partner-codes-design.md`

## Global Constraints

- App work: branch `feat/partner-codes`, worktree `/Users/marcus/Documents/lance-partner-codes`. Site work: branch `feat/partner-links`, in its own worktree `/Users/marcus/Documents/reprize-lp-partner-links`, because `~/Documents/reprize-lp` is on another branch.
- Offering id: `^partner_[a-z0-9]+$`. Starting tiers: `partner_p10`, `partner_p20`, `partner_p30`.
- Tier metadata: `{ "discountPercent": 20, "partners": { "<CODE>": { "name": "<display name>" } } }`; `discountPercent` is a whole number from 1 to 90.
- A code in two tiers resolves to the first tier by sorted offering id. Codes ending in `MENSAL` are rejected.
- Apple offers: `P20_ANUAL` on `pro_annual`, `P20_MENSAL` on `pro_monthly`. Apple codes: annual `<CODE>`, monthly `<CODE>MENSAL`.
- Play base plans: `annual-p20`, `monthly-p20`.
- RevenueCat attributes: `partner_code`, `partner_source`, `partner_offering`, `$mediaSource = "partner"`, `$campaign = <code>`.
- New KV key: `partner.promptDismissed`.
- Copy: professional pt-BR, "código de indicação"; every string in both `src/i18n/locales/pt-BR.ts` and `en.ts`. No plan or price talk in the onboarding stories.
- `ios/` and `android/` are generated: no native edits.
- Before reporting any task done, in `app/`: `npx jest --runInBand`, `npx tsc --noEmit`, `npx expo lint`.

## Review Focus

1. A tier with a missing or invalid `discountPercent` must not offer a discount, and must not stop other tiers from loading (Task 1).
2. A partner moved to another tier before purchase gets the new tier at the next start; after purchase the attribution never changes (Task 2).
3. The directory is offline at start: the saved tier stays and nothing is lost (Task 2).
4. The tier's offering was deleted in RevenueCat: Android still sells PRO at the normal price (Task 3).
5. The player cancels Apple's redemption for the monthly plan: no purchase is recorded, and both plans stay available (Task 3).

---

### Task 1: Directory by tier

**Files:**
- Modify: `app/src/partner/directory.ts`, `app/src/partner/code.ts`, `app/src/payments/revenuecatClient.ts`, `app/src/payments/client.ts`, `app/src/payments/fakeClient.ts`, `app/src/payments/types.ts`
- Test: `app/src/partner/__tests__/directory.test.ts`, `app/src/partner/__tests__/code.test.ts`, `app/src/payments/__tests__/revenuecatClient.test.ts`

**Interfaces:**
- Produces: `type PartnerOffering = \`partner_${string}\``; `type Offering = 'default' | 'pass' | PartnerOffering`
- Produces: `type PartnerDirectory = Record<string, { name: string; offering: PartnerOffering; discountPercent: number }>`
- Produces: `parsePartnerOfferings(all: Record<string, { metadata?: unknown }>): PartnerDirectory`
- Produces: `appleOfferCode(code: string, plan: 'annual' | 'monthly'): string`
- Produces: `setPartner(code: string, source: string, offering: PartnerOffering): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
const all = {
  default: { metadata: { partners: { IGNORED: { name: 'No' } } } },
  partner_p20: { metadata: { discountPercent: 20, partners: { profjoao: { name: 'Prof. João' }, ANAMENSAL: { name: 'Ana' } } } },
  partner_p10: { metadata: { discountPercent: 10, partners: { PROFJOAO: { name: 'Dup' }, BIA: {} } } },
  partner_bad: { metadata: { discountPercent: 95, partners: { NOPE: { name: 'No' } } } },
};
test('reads partners from valid tiers only', () => {
  expect(parsePartnerOfferings(all)).toEqual({
    PROFJOAO: { name: 'Dup', offering: 'partner_p10', discountPercent: 10 },
    BIA: { name: 'BIA', offering: 'partner_p10', discountPercent: 10 },
  });
});
test('Apple codes per plan', () => {
  expect(appleOfferCode('PROFJOAO', 'annual')).toBe('PROFJOAO');
  expect(appleOfferCode('PROFJOAO', 'monthly')).toBe('PROFJOAOMENSAL');
});
```

In `revenuecatClient.test.ts`, `partners()` reads every offering through `getOfferings().all`, and `setPartner('AAA', 'link', 'partner_p20')` writes `partner_offering: 'partner_p20'`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd app && npx jest src/partner/__tests__/directory.test.ts src/partner/__tests__/code.test.ts src/payments/__tests__/revenuecatClient.test.ts`
Expected: FAIL, `parsePartnerOfferings` and `appleOfferCode` are not defined.

- [ ] **Step 3: Implement the interfaces above**

Iterate offering ids in sorted order and keep the first entry per code. Replace `parsePartners`.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/partner app/src/payments
git commit -m "feat(partner): read partners and discounts from price tier offerings"
```

### Task 2: Attribution keeps the tier

**Files:**
- Modify: `app/src/partner/store.ts`, `app/src/partner/index.ts`
- Test: `app/src/partner/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `PartnerDirectory`, `PartnerOffering` (Task 1)
- Produces: `Attribution` gains `offering?: PartnerOffering` and `discountPercent?: number`, both present when `status === 'valid'`

- [ ] **Step 1: Write the failing tests**

Test names and assertions in `store.test.ts`:
- `applied code stores its tier`: `current()` has `offering: 'partner_p20'`, `discountPercent: 20`.
- `start moves an unlocked attribution to the new tier`: after the directory changes to `partner_p30`, `start()` makes `current().offering === 'partner_p30'` and calls `onValid` with it.
- `start never changes a locked attribution`: after `lock()`, the same directory change leaves `offering: 'partner_p20'`.
- `start offline keeps the saved tier`: directory `null` leaves `offering: 'partner_p20'`.
- `start keeps an unlocked attribution whose code left the directory`: `current().code` and `offering` are unchanged.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd app && npx jest src/partner/__tests__/store.test.ts`
Expected: FAIL on the five tests above.

- [ ] **Step 3: Implement**

`apply` and the pending confirmation copy `name`, `offering` and `discountPercent` from the directory hit. `start()` reads the directory for a valid unlocked attribution and saves any change. `onValid` in `index.ts` calls `setPartner` only when `offering` is defined.

- [ ] **Step 4: Run the tests and confirm they pass**

Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/partner
git commit -m "feat(partner): keep the price tier in the attribution"
```

### Task 3: Paywall and redemption by plan

**Files:**
- Create: `app/src/partner/choosePlan.ts`
- Modify: `app/src/payments/feedback.ts`, `app/src/partner/index.ts`, `app/src/partner/activate.ts`, `app/src/components/PartnerResult.tsx`, `app/src/app/partner.tsx`, `app/src/app/p/[code].tsx`, `app/src/i18n/locales/pt-BR.ts`, `app/src/i18n/locales/en.ts`, `app/src/analytics/events.ts`
- Test: `app/src/payments/__tests__/feedback.test.ts`, `app/src/partner/__tests__/index.test.ts`, `app/src/app/__tests__/partner.test.tsx`

**Interfaces:**
- Consumes: `appleOfferCode`, `Attribution.offering`, `Attribution.discountPercent`
- Produces: `choosePartnerPlan(t: TFunction, a: Attribution, opts: { showAll: boolean }): Promise<'annual' | 'monthly' | 'all' | 'later'>`
- Produces: `redeemPartnerOffer(t: TFunction, plan: 'annual' | 'monthly'): Promise<void>`
- Produces: `PartnerResult` gains the prop `discountPercent?: number`
- Produces: event `partner_offer_opened: { code: string; via: 'paywall' | 'offer_code'; offering?: PartnerOffering; plan?: 'annual' | 'monthly' }`

- [ ] **Step 1: Write the failing tests**

- `feedback.test.ts`, Android: `openPaywall(t, 'locked_feature')` with attribution `partner_p20` calls `payments.showPaywall('partner_p20')`.
- `feedback.test.ts`, Android missing offering: the client falls back to the current offering and the outcome is returned unchanged.
- `feedback.test.ts`, iPhone: choosing `monthly` calls `redeemPartnerOffer(t, 'monthly')` and returns `'cancelled'`; `all` opens `default`.
- `index.test.ts`: `redeemPartnerOffer(t, 'monthly')` calls `redeemOfferCode('PROFJOAOMENSAL')` and arms the marker with the partner code `PROFJOAO`.
- `index.test.ts`: a failed redemption shows `partner.redeemError`, records no purchase, and leaves the attribution active.
- `partner.test.tsx`: the applied result shows the percentage.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd app && npx jest src/payments/__tests__/feedback.test.ts src/partner/__tests__/index.test.ts src/app/__tests__/partner.test.tsx`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

`activatePartnerDiscount` on iPhone calls `choosePartnerPlan(t, a, { showAll: false })`; on Android it keeps opening the paywall. Exact strings:

| Key | pt-BR | en |
|---|---|---|
| `partner.appliedText` | `Você tem %{percent}% de desconto no primeiro período do PRO, por indicação de %{name}.` | `You have %{percent}% off the first period of PRO, referred by %{name}.` |
| `partner.planAnnual` | `Anual com %{percent}% de desconto` | `Annual with %{percent}% off` |
| `partner.planMonthly` | `Mensal com %{percent}% de desconto` | `Monthly with %{percent}% off` |

- [ ] **Step 4: Run all checks**

Run: `cd app && npx jest --runInBand && npx tsc --noEmit && npx expo lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "feat(partner): paywall and Apple redemption per tier and plan"
```

### Task 4: First-use prompt

**Files:**
- Create: `app/src/components/PartnerPrompt.tsx`
- Modify: `app/src/app/setup.tsx:726`, `app/src/i18n/locales/pt-BR.ts`, `app/src/i18n/locales/en.ts`
- Test: `app/src/components/__tests__/PartnerPrompt.test.tsx`

**Interfaces:**
- Consumes: `partner.current()`, `payments.getSnapshot().proActive`, `kv`
- Produces: `<PartnerPrompt />`, which renders nothing when hidden

- [ ] **Step 1: Write the failing tests**

- `shows with no attribution, no PRO and not dismissed`
- `hidden with an attribution`
- `hidden with PRO`
- `dismiss stores partner.promptDismissed and hides it`
- `tap opens /partner`

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd app && npx jest src/components/__tests__/PartnerPrompt.test.tsx`
Expected: FAIL, the component does not exist.

- [ ] **Step 3: Implement and place it directly above `<AboutLinks />` in `setup.tsx`**

Strings: `partner.promptText` = `Recebeu um código de indicação?` / `Received a referral code?`; `partner.promptDismiss` = `Dispensar` / `Dismiss`. A storage failure hides nothing and never throws.

- [ ] **Step 4: Run all checks**

Run: `cd app && npx jest --runInBand && npx tsc --noEmit && npx expo lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "feat(partner): first-use referral code prompt on the setup screen"
```

### Task 5: Site copy and runbook

**Files:**
- Modify in the site worktree: `src/i18n/ui.ts`
- Modify in the app worktree: `docs/parceiros.md`, `docs/modelo-de-negocio-e-pagamentos.md`

- [ ] **Step 1: Update the site strings**

| Key | pt-BR | en |
|---|---|---|
| `partner.stepsIos` | `No iPhone: baixe o app, volte a esta página e toque em "Já tenho o app". Ative o desconto dentro do app para a indicação ser registrada.` | `On iPhone: download the app, return to this page and tap "I already have the app". Activate the discount inside the app so the referral is recorded.` |

- [ ] **Step 2: Verify the site**

Run: `npm ci && npx astro build` in the site worktree.
Expected: the build succeeds.

- [ ] **Step 3: Rewrite `docs/parceiros.md`**

It must cover: creating the three tiers once (the 6 Apple offers, the 6 Play base plans and their offers, the 3 RevenueCat offerings); adding a partner (metadata entry plus the Apple codes `<CODE>` and `<CODE>MENSAL`); changing a partner's tier, including the new Apple codes; the 4,000-character metadata limit; the Audience filters; and the monthly close from the spec's Reports table, with its 30-day hold.

- [ ] **Step 4: Commit each repository**

```bash
git add src/i18n/ui.ts && git commit -m "fix(partner): iPhone steps keep the referral recorded"
git add docs/parceiros.md docs/modelo-de-negocio-e-pagamentos.md && git commit -m "docs: partner price tiers runbook"
```

### Task 6: Real-device validation (needs the store setup)

- [ ] **Step 1:** Create one test tier in App Store Connect, Play Console and RevenueCat, following `docs/parceiros.md`.
- [ ] **Step 2:** Install a Release build on the iPhone and an Android device by command.
- [ ] **Step 3:** On iPhone, apply a test code and redeem the annual and monthly offers. Expected: Apple shows the discounted price, RevenueCat has `partner_code` and `partner_offering`, and Apple's report shows the custom code.
- [ ] **Step 4:** On Android, open the link on a clean install and buy in the test track. Expected: the paywall shows the tier's price on both plans, and the customer has the attributes.
- [ ] **Step 5:** Run the monthly close on the test data. Expected: a trial, a refund and a sandbox purchase are excluded from the count.
