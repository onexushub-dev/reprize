# Partner codes (links, discount, attribution) — design

Date: 2026-11-15
Status: draft, awaiting review

## Goal

After the beach tennis launch event, key people in the sport (teachers, court owners, players with an audience) want to hand Reprize to their students with a discount. We need:

1. **A link and a code per partner** (`https://reprizeapp.com/p/PROFJOAO`, code `PROFJOAO`) that the partner shares by WhatsApp, Instagram or by voice.
2. **A discount on PRO** for whoever arrives with a valid code.
3. **Attribution:** for every partner, how many people opened the link, installed, applied the code, saw the offer and subscribed.

Success: a new partner is created in under 10 minutes with no app build, a student gets the discount on iPhone and Android in at most three taps after opening the app, and the monthly numbers per partner come out of the dashboards without a spreadsheet of guesses.

**Stated by the user:** links/coupons for key players, discount, tracking who came in through which link, solved with the RevenueCat paywall.
**Assumed (not confirmed):** no commission payout in this version (data is enough to pay one by hand); discount is on the annual plan, first year; partners are created by the team, not self-service.

## Market standard

How subscription apps solve "partner shares a code with a discount", from the research (sources at the end):

| Layer | What the market does | Why |
|---|---|---|
| Identity of the partner | One short human code per partner, used both as link slug and as typed code | Only part of the audience taps the link; the rest hears the code and searches the store. Links and codes together cover both. |
| Carrying the code through install | Android: Play Install Referrer. iOS: no reliable deferred deep link since fingerprinting was restricted, so the code is typed (or the link is tapped again after install). Paid tools (Branch, AppsFlyer) improve iOS only marginally and cost more than this program is worth today. | Platform limits. |
| Discount on iOS | **Apple offer codes** (custom codes, redemption URL or StoreKit sheet). | Guideline 3.1.1: Apple rejects apps whose own code field changes what is sold or its price; reviewers answer "use an Apple-supported offer code". |
| Discount on Android | A Play offer on a base plan, shown when the app decides the customer is eligible (developer-determined offer), or a dedicated base plan. Play custom promo codes exist but need 2,000+ redemptions per code, only work for people who never subscribed, and their links are unreliable. | Google allows the app to choose the offer; no review risk. |
| Attribution of revenue | The partner code stored as a **customer attribute in the subscription platform** (RevenueCat), because neither store exposes which code was redeemed (RevenueCat only sees the offer's reference name). Every affiliate tool for apps (Insert Affiliate, WinWinKit) works exactly this way: SDK sets an attribute, RevenueCat webhooks carry it. | Store codes are opaque. |
| Attribution window | Last valid code before the first purchase wins; locked at purchase. 14 to 30 days is the usual window for creator traffic. | Late conversions are common. |
| Payout | Small programs: discount for the audience plus a manual reward. Larger ones: recurring commission through a tool (Insert Affiliate: about £20/month plus 10% of affiliate revenue) or a webhook-fed ledger. | Cost of automation only pays off with dozens of partners. |

**Build or buy:** the tools above mostly add the payout ledger and a partner dashboard. Everything before that (code, link, attribute, offer) we must set up either way. With a handful of local partners and no automatic payout, building is a few days and no revenue share. Revisit a tool when there are more than about 20 active partners or commission becomes contractual.

## Design

### The flow

```
Partner shares  https://reprizeapp.com/p/PROFJOAO   (or says "use o código PROFJOAO")
        │
        ▼
Landing page /p/CODE  ── counts the open (web analytics, per code)
   • Android button → Play Store with referrer=partner%3DPROFJOAO
   • iPhone button  → App Store (campaign token ct=PROFJOAO)
   • "Já tenho o app" → reprize://p/PROFJOAO
   • shows the code large, with "copiar"
        │
        ▼
App receives the code from one of three sources
   link (universal link or reprize://p/CODE) · install_referrer (Android, first launch) · typed ("Tenho um código de indicação")
        │
        ▼
Validate against the partner directory → save attribution → RevenueCat attributes + analytics
        │
        ▼
Offer
   Android: paywall opens the RevenueCat offering `partner` (discounted first year)
   iPhone:  "Ativar desconto" opens Apple's offer code redemption with the code filled in
        │
        ▼
Purchase → attribution locked → reports per partner
```

### Decisions

1. **Code format.** 3 to 20 characters, `A-Z0-9`, case-insensitive, stored uppercase. The same string is the link slug, the typed code, the Apple custom code and the analytics value.
2. **Partner directory with no server and no build.** A JSON value in the metadata of the RevenueCat `default` offering: `{ "partners": { "PROFJOAO": { "name": "Prof. João" } } }`. The app reads it with the offerings it already fetches. A code is valid only if it is in the directory. Removing a code stops new attributions; existing ones stay.
3. **Attribution rules.** One attribution per install: `{ code, name, source, appliedAt, lockedAt? }`. A new valid code replaces the previous one until the first purchase observed with an attribution, which locks it. A code applied offline or before the directory loads is kept as `pending` and validated on the next start; a pending code never changes the paywall. A customer who already has PRO cannot apply a code.
4. **Where attribution is recorded.**
   - RevenueCat customer attributes: `partner_code`, `partner_source`, plus the reserved `$mediaSource = "partner"` and `$campaign = <code>`. They travel in exports, webhooks and customer lists.
   - PostHog: three new events and a `partner` property on `paywall_viewed` and `purchase_completed`. The code names a partner, never a person, and only directory-validated codes are sent; this is a deliberate, documented exception to "no free text" in the analytics spec.
   - Landing page: one web analytics event per open, with the code.
   - iPhone installs per partner: App Store campaign link (`ct=<code>`), read in App Analytics.
5. **Discount.** First year of the annual plan at **R$ 83,90** (30% under R$ 119,90; US $34.99), then the normal price. No free trial on top. The value lives only in the stores; changing it needs no build. Monthly is not discounted.
6. **iPhone delivery: Apple offer code.** One offer `PARCEIROS` on `pro_annual` (pay up front, 1 year), eligible for new and expired subscribers, with one custom code per partner equal to the partner code. The app opens `https://apps.apple.com/redeem?ctx=offercodes&id=6833159162&code=<CODE>`; if that cannot be opened it falls back to the StoreKit redemption sheet. The app's own field is labelled "código de indicação" and never changes a price by itself, which keeps it inside guideline 3.1.1.
7. **Android delivery: RevenueCat offering `partner`.** A new base plan `annual-parceiro` on the Play subscription (same price as annual) carrying one offer with the discounted first year, attached to entitlement `pro`. The offering `partner` holds that product as the annual package plus the normal monthly. A dedicated base plan is used because RevenueCat's default option picks the free trial when a base plan has both.
8. **Paywall routing.** With a valid attribution and no PRO: on Android every request for the `default` paywall shows `partner` instead (missing offering falls back to `default`, as today). On iPhone the request first asks "Ativar desconto de {name}" or "Ver todos os planos". The `pass` paywall never changes.
9. **Entry points in the app.** Route `/p/[code]` (links), a first-launch read of the Android install referrer, and a "Tenho um código de indicação" link beside the legal links on the preparation screen that opens `/partner`. Nothing in the onboarding stories.
10. **Universal links.** `reprizeapp.com` and `www.reprizeapp.com`, path `/p/*`, on both platforms. The custom scheme `reprize://p/CODE` keeps working.

### Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `src/partner/code.ts` | Normalize a code; extract it from a URL or an install referrer string | nothing |
| `src/partner/directory.ts` | Parse the directory out of offering metadata | nothing |
| `src/partner/store.ts` | Attribution state, rules of decision 3, persistence | `KV`, a directory lookup, a clock |
| `src/partner/index.ts` | The app-wide store wired to MMKV, RevenueCat and analytics; first-launch referrer read | the three above, `payments`, `analytics` |
| `src/payments/*` | `partners()`, `setPartner()`, `redeemOfferCode()` on the client; offering `partner`; `refresh()` on the store; routing in `openPaywall` | RevenueCat SDK |
| `src/app/p/[code].tsx`, `src/app/partner.tsx` | Link landing and typed entry, sharing one result view | `partner` store |
| Landing page (`reprize-lp`) | `/p/CODE` page, association files | none |

### Error handling

- Directory unreachable: the code is saved as `pending`, the screen says the discount will be confirmed when the connection returns, the normal paywall is used meanwhile.
- Unknown code: "Código não encontrado" and nothing is saved.
- RevenueCat attribute write fails: retried on every app start while an attribution exists (idempotent).
- iPhone redemption cancelled in the App Store: nothing changes; the offer stays available.
- No RevenueCat key in the build: codes stay `pending` forever and nothing else changes.

### Reports

| Question | Where |
|---|---|
| Opens of each partner link | Landing page analytics, event `partner_link_opened` by `code` |
| iPhone installs per partner | App Store Connect → App Analytics → campaigns |
| Codes applied, by source | PostHog `partner_code_applied` by `code`, `source` |
| Offer seen → subscribed, per partner | PostHog funnel `paywall_viewed` → `purchase_completed` by `partner` |
| Subscribers and revenue per partner (incl. renewals, refunds) | RevenueCat customer list filtered by `partner_code`; scheduled export for a monthly sheet |
| iPhone redemptions per code (cross-check) | App Store Connect, offer `PARCEIROS`, per custom code |

### Out of scope

Automatic commission payout, a partner-facing dashboard, user-to-user referral ("indique e ganhe"), discount on the Single Pass, web checkout.

### Risks

- **App Review** may still question the code field. Mitigation: review notes explaining that on iOS the code only opens Apple's offer code redemption; fallback is to hide the typed field on iOS and rely on links.
- **Unverified facts**, each checked in the plan before it is relied on: the exact Apple redemption URL; per-custom-code redemption counts in App Store Connect; RevenueCat's option selection for a base plan with a single offer; custom-code limits per offer (third-party sources say 25,000 redemptions per code, expiry up to 6 months, 10 active offers per subscription).
- **Apple codes expire** (6 months at most): the partner runbook includes renewal.

## Sources

- https://community.revenuecat.com/third-party-integrations-53/running-a-creator-affiliate-program-on-revenuecat-what-actually-works-attribution-renewals-offer-code-limits-payouts-7791
- https://community.revenuecat.com/dashboard-tools-52/can-we-track-redemptions-for-specific-custom-codes-in-reports-or-the-revenuecat-dashboard-7427
- https://www.revenuecat.com/docs/tools/targeting
- https://www.revenuecat.com/docs/customers/customer-attributes
- https://www.revenuecat.com/docs/google-play-offers
- https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes
- https://developer.apple.com/documentation/storekit/implementing-offer-codes-in-your-app
- https://developer.apple.com/forums/thread/802352
- https://developer.android.com/google/play/billing/promo
- https://docs.expo.dev/versions/v58.0.0/sdk/application/
- https://www.airbridge.io/en/blog/influencer-attribution-promo-code-vs-tracking-link
- https://insertaffiliate.com/compare/revenuecat-vs-insert-affiliate/
