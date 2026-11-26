# Analytics (PostHog, anonymous) — design

Date: 2026-10-28
Status: draft, awaiting review

## Goal

Know how the app is used without adopting Firebase and without identifying anyone:

1. **Usage and retention** — active installs, who comes back, how long sessions last.
2. **Onboarding to paywall funnel** — where people drop in the stories, who reaches the paywall, who buys.
3. **Feature usage** — which triggers, edit tools, Modo Foco, exports and pairings are actually used.

Success: the three questions above can be answered from PostHog without adding a consent banner, and the event volume stays far below the free tier (1M events/month).

Out of scope: revenue and subscription reporting (RevenueCat already owns it), crash reporting, session replay, A/B testing, any per-person profile.

## Decision

PostHog Cloud (US host, since the app is used in Brazil and the US; EU until 2026-11-02), used in anonymous mode, with IP capture off in the project. Alternatives considered: Aptabase (simpler, weaker funnels/retention) and TelemetryDeck (most private, React Native support unconfirmed). Firebase rejected as too large for metrics only.

All app code talks to a thin `track()` wrapper, never to the PostHog SDK directly, so the vendor can be swapped by replacing one adapter.

## Privacy rules

- Random install ID generated with `expo-crypto`, persisted in MMKV. No account, email, IDFA or IP.
- PostHog configured with person profiles off (`personProfiles: 'never'`), GeoIP/IP capture off, autocapture off, session replay off. Only the events in this spec are ever sent, plus (since 2026-11-02) two kinds of SDK events that PostHog's built-in dashboards need for active users, sessions, first-time users and devices:
  - **App lifecycle** (`captureAppLifecycleEvents: true`): Application Installed, Updated, Opened, Became Active and Backgrounded, with the app version and build.
  - **Screen views** (`$screen`): one per route change, named by the route pattern (`clip/[id]`), never by the ids in the URL; capped at 100 per session.
  - Opting out also calls the SDK's `optOut()`, so its lifecycle events stop too. Country stays unknown (no IP, no GeoIP); `$locale` and `$timezone`, which the SDK adds to every event, tell Brazil from the US.
- Properties are enumerated values or bucketed numbers (for example duration in ranges). Never video, file names, device names, free text, or error message strings.
  - **One exception (2026-11-15, partner codes):** the `partner_code_applied`, `partner_offer_opened` events and the `partner` property carry a partner code such as `PROFJOAO`. It names a partner, never a person, and only a code found in the partner directory is sent; what a player typed that is not in the directory is never sent (`partner_code_rejected` has no code). See `docs/superpowers/specs/2026-11-15-partner-codes-design.md`.
- User-facing opt-out in Settings; when off, `track()` is a no-op and nothing is queued.
- Verify at implementation time that these option names match the installed `posthog-react-native` version.

## Event catalogue (30)

Updated 2026-11-02 for main's freemium/PRO/Pass model, thermal stops and trigger guides.

| Area | Event | Properties |
|---|---|---|
| Usage | `app_open` | `cold_start` |
| Usage | `session_summary` (sent once when the app goes to background) | clips saved, exports, zoom count (bucketed), most used trigger, guides used, duration bucket |
| Onboarding | `onboarding_step_viewed` | `step` 1–4 |
| Onboarding | `onboarding_completed` | |
| Onboarding | `onboarding_skipped` | `step` |
| Onboarding | `permission_result` | `kind` (`camera`, `microphone`, `speech`, `photos`), `granted`; only after a real system prompt |
| Recording | `recording_started` | `mode`, `quality`, `clip_seconds`, `plan` (`free`/`pro`), `gesture`, `voice` |
| Recording | `recording_ended` | `reason` (`user`/`thermal`/`error`), `duration` (bucket), `clips` (bucket) |
| Recording | `recording_quality_lowered` | `level` (thermal); once per recording |
| Recording | `clip_saved` | `trigger`, `mode` |
| Recording | `trigger_failed` | `trigger`, `reason` |
| Editing | `clip_edit_tool_used` | `tool` |
| Editing | ~~`cut_suggestion_applied`~~ | removed with the cut suggestion (main) |
| Editing | `focus_mode_used` | |
| Output | `export_completed` | `quality`, `plan` (`free`/`pass`/`pro`) |
| Output | `export_failed` | `reason` |
| Output | `clip_shared` | `destination` |
| Devices | `pairing_completed` | `method`, `kind` |
| Devices | `pairing_failed` | `reason` |
| Monetization | `paywall_viewed` | `source`, `offering` (`default`/`pass`/`partner`), `partner` (optional) |
| Monetization | `purchase_completed` | `offering`, `partner` (optional) |
| Monetization | `purchase_restored` | `offering` |
| Monetization | `pass_used` | (a Pass kept from before, spent on a recording) |
| Monetization | `purchase_failed` | `reason` |
| Monetization | `pro_feature_blocked` | `feature` |
| Monetization | `free_export_limit_hit` | |
| Monetization | `partner_code_applied` | `code`, `source` (`link`/`install_referrer`/`typed`) |
| Monetization | `partner_code_rejected` | `source`, `reason` (`invalid`/`locked`) |
| Monetization | `partner_offer_opened` | `code`, `via` (`paywall`/`offer_code`) |
| Monetization | `free_export_choice` | `choice` (`pro`/`pass`/`go`/`cancel`), `kind` (`save`/`share`/`unlock`) |

`purchase_started` is not in the catalogue: the RevenueCat paywall performs the purchase itself and `showPaywall()` only reports the outcome, so "started" cannot be told apart from `paywall_viewed`.

Deliberately excluded (low value or high volume): zoom and toggle events, guide openings (counted as `guides` in `session_summary`), economy mode, delete and batch actions, feedback and generic error events. Their usage shows up as counts inside `session_summary`.

## Volume control

- Nothing fires per gesture or per frame.
- `track()` drops a repeat of the same event beyond a per-session cap (default 20; `clip_saved` and `trigger_failed` are capped separately).
- Expected load: roughly 15–40 events per active user per month, so about 25–60k monthly active users fit in the free tier.

## Architecture

New module `app/src/analytics/`:

- `events.ts` — a typed map of event name to its property shape. This is the single source of truth; `track()` only accepts names and props from it.
- `index.ts` — `initAnalytics()`, `track(name, props)`, `setAnalyticsEnabled(bool)`; handles the opt-out flag, the per-session cap and the install ID.
- `session.ts` — accumulates counters for `session_summary` and flushes on background.
- `posthogAdapter.ts` — the only file importing `posthog-react-native`.
- `fakeAdapter.ts` — records calls for tests (same pattern as `payments/fakeClient.ts`).

Wiring:

- `initAnalytics()` is called in `src/app/_layout.tsx`.
- The PostHog project key and host come from `app.config.js` (`extra`) via environment variables. If the key is missing (dev, tests), the fake/no-op adapter is used.
- Call sites: onboarding (`src/onboarding/`, `app/onboarding.tsx`), `src/session/` (recording and triggers), `src/clip/` (edit tools, export), `src/focus/`, `src/payments/` (paywall, purchase, limits), `src/remote/` and pairing screens.
- Native dependencies are added through the Expo dev client; a new native build is required.

## Error handling

Analytics must never affect the app: all adapter calls are wrapped, failures are swallowed, nothing awaits the network. Events are batched and flushed by the SDK; offline events are queued by the SDK.

## Testing

- Unit tests for `track()`: opt-out, per-session cap, unknown properties rejected at compile time, install ID persisted.
- Unit tests for `session_summary` aggregation.
- Call-site tests use the fake adapter to assert the key funnel events (onboarding steps, paywall, purchase) fire once with the expected props.
- Manual check in PostHog Live Events on a dev build before release.

## Release checklist

- App Store privacy label: data not linked to the user; no ATT prompt needed (no cross-app tracking).
- Add a short line to the privacy policy about anonymous usage metrics and the opt-out.
- Build the PostHog dashboards: retention, onboarding funnel (step 1 to completed to paywall to purchase), feature usage from `session_summary`.
