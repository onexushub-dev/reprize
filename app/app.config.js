/**
 * Dynamic config on top of app.json.
 *
 * Apple only lets one developer team register a given bundle id, so each person who builds on their own Mac/Apple ID
 * needs their own id and team. Set them in app/.env.local (git-ignored) or in the shell:
 *
 *   REPRIZE_BUNDLE_ID=com.yourname.reprize   iOS bundle id and Android package (the watch app becomes <id>.watch)
 *   REPRIZE_APPLE_TEAM_ID=ABCDE12345         your Apple development team id
 *
 * The old REPPLAY_* and LANCE_* names still work, so an existing .env.local keeps building.
 *
 * With nothing set, the values from app.json are used unchanged.
 *
 * RevenueCat public SDK keys (never secret keys), read into extra.revenueCat:
 *
 *   REPRIZE_RC_IOS_KEY=appl_...            iOS key
 *   REPRIZE_RC_ANDROID_KEY=goog_...        Android key
 *   REPRIZE_RC_TEST_KEY=test_...           Test Store key, used only in development builds (__DEV__); left out of EAS production builds
 *
 * The old REPPLAY_RC_* and LANCE_RC_* names still work, so an existing .env.local keeps working.
 *
 * With no key the app runs as free and the paywall reports an error.
 *
 * Anonymous usage metrics (PostHog, US cloud: the app is used in Brazil and the US), read into extra.posthog:
 *
 *   REPRIZE_POSTHOG_KEY=phc_...            project API key (public, write-only)
 *   REPRIZE_POSTHOG_HOST=https://...       optional; defaults to https://us.i.posthog.com (EU cloud: https://eu.i.posthog.com)
 *
 * The host must be the region the PostHog project was created in, or nothing arrives. In the project, turn
 * "IP data capture" off (Settings > Project > General): US projects capture it by default.
 *
 * With no key the app sends no metrics at all (dev builds, tests, CI).
 *
 * In-app diagnostics (TEMP(diag-remote): the Diagnóstico screen, its log file and its flags), for local test builds:
 *
 *   REPRIZE_DIAGNOSTICS=1                  shows the Diagnóstico link and keeps the log; off when unset
 *
 * EAS production builds never carry it, whatever the env says: the App Store build has no debug screen.
 *
 * Field-test unlock (TEMP(field-test), src/payments/fieldTest.ts), for local test builds:
 *
 *   REPRIZE_FIELD_TEST_UNLOCK=1            every paid feature works on the free plan; off when unset
 *
 * EAS production builds never carry it either: the store build always locks and shows the paywall.
 */
module.exports = ({ config }) => {
  const bundleId = process.env.REPRIZE_BUNDLE_ID || process.env.REPPLAY_BUNDLE_ID || process.env.LANCE_BUNDLE_ID;
  const teamId = process.env.REPRIZE_APPLE_TEAM_ID || process.env.REPPLAY_APPLE_TEAM_ID || process.env.LANCE_APPLE_TEAM_ID;

  const ios = Object.assign({}, config.ios);
  const android = Object.assign({}, config.android);

  if (bundleId) {
    ios.bundleIdentifier = bundleId;
    android.package = bundleId;
  }
  if (teamId) {
    ios.appleTeamId = teamId;
  }

  // The test_ key is development-only (see pickApiKey), so EAS production builds do not carry it at all.
  const production = process.env.EAS_BUILD_PROFILE === 'production';
  const extra = Object.assign({}, config.extra, {
    revenueCat: {
      ios: process.env.REPRIZE_RC_IOS_KEY || process.env.REPPLAY_RC_IOS_KEY || process.env.LANCE_RC_IOS_KEY,
      android: process.env.REPRIZE_RC_ANDROID_KEY || process.env.REPPLAY_RC_ANDROID_KEY || process.env.LANCE_RC_ANDROID_KEY,
      test: production ? undefined : process.env.REPRIZE_RC_TEST_KEY || process.env.REPPLAY_RC_TEST_KEY || process.env.LANCE_RC_TEST_KEY,
    },
    posthog: {
      key: process.env.REPRIZE_POSTHOG_KEY || process.env.REPPLAY_POSTHOG_KEY,
      host: process.env.REPRIZE_POSTHOG_HOST || 'https://us.i.posthog.com',
    },
    diagnostics: !production && process.env.REPRIZE_DIAGNOSTICS === '1',
    fieldTestUnlockAll: !production && process.env.REPRIZE_FIELD_TEST_UNLOCK === '1',
  });

  return Object.assign({}, config, { ios: ios, android: android, extra: extra });
};
