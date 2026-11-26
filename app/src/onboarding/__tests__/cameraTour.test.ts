import { cameraTourSeen, finishCameraTour, restartCameraTour } from '../cameraTour';

jest.mock('../../data/mmkv', () => {
  let prefs: Record<string, unknown> = {};
  return {
    repo: {
      getPrefs: () => prefs,
      setPrefs: (p: object) => (prefs = { ...prefs, ...p }),
    },
  };
});

test('the camera tour shows until it is finished, and Tutorial shows it again', () => {
  expect(cameraTourSeen()).toBe(false);
  finishCameraTour();
  expect(cameraTourSeen()).toBe(true);
  restartCameraTour();
  expect(cameraTourSeen()).toBe(false);
});
