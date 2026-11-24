import { continueIntent, setContinueIntent, subscribeContinueIntent } from '../continueIntent';

test('the recording chosen to continue is kept until cleared, and listeners hear each change (2026-11-23)', () => {
  const heard = jest.fn();
  const off = subscribeContinueIntent(heard);
  expect(continueIntent()).toBeUndefined();
  setContinueIntent('s1');
  expect(continueIntent()).toBe('s1');
  setContinueIntent(undefined);
  expect(continueIntent()).toBeUndefined();
  expect(heard).toHaveBeenCalledTimes(2);
  off();
  setContinueIntent('s2');
  expect(heard).toHaveBeenCalledTimes(2);
  setContinueIntent(undefined);
});
