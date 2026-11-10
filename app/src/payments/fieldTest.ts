import Constants from 'expo-constants';

/**
 * TEMP(field-test): every paid feature works on every plan, while the screens show the plan as it really is — the
 * release layout (Pro badges, locks, the free-recording cards) with nothing actually locked. Only `accessPlan` reads it:
 * the plan itself stays the real one.
 *
 * On only when the build asks for it (REPRIZE_FIELD_TEST_UNLOCK=1, see app.config.js). EAS production builds never carry
 * it, whatever the env says, so the store build always locks and shows the paywall.
 * Tests run with it off (jest.setup.js), so they cover the release behaviour.
 */
export const FIELD_TEST_UNLOCK_ALL = Constants.expoConfig?.extra?.fieldTestUnlockAll === true;
