/**
 * TEMP(field-test): every paid feature works on every plan, while the screens show the plan as it really is — the
 * release layout (Pro badges, locks, the free-recording cards) with nothing actually locked. Only `accessPlan` reads it:
 * the plan itself stays the real one. Revert before release (false).
 * Tests run with it off (jest.setup.js), so they cover the release behaviour.
 */
export const FIELD_TEST_UNLOCK_ALL = true as boolean;
