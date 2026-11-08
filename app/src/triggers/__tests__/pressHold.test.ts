import { createPressReader, REMOTE_HOLD_MS } from '../pressHold';

function setup() {
  const presses: (number | undefined)[] = [];
  let holds = 0;
  const reader = createPressReader({ onPress: (ms) => void presses.push(ms), onHold: () => void (holds += 1) });
  return { reader, presses, holds: () => holds };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('a press released before the hold time is a press, decided at the release', () => {
  const { reader, presses, holds } = setup();
  reader.began();
  expect(presses).toEqual([]);
  jest.advanceTimersByTime(150);
  reader.ended(150);
  expect(presses).toEqual([150]);
  jest.advanceTimersByTime(REMOTE_HOLD_MS);
  expect(holds()).toBe(0);
});

test('a remote that sends press and release together still gives presses', () => {
  const { reader, presses } = setup();
  reader.began();
  reader.ended(0);
  reader.began();
  reader.ended(1);
  expect(presses).toEqual([0, 1]);
});

test('held for the hold time it is a hold, at once, and its release is not a press', () => {
  const { reader, presses, holds } = setup();
  reader.began();
  jest.advanceTimersByTime(REMOTE_HOLD_MS - 1);
  expect(holds()).toBe(0);
  jest.advanceTimersByTime(1);
  expect(holds()).toBe(1);
  reader.ended(3400);
  expect(presses).toEqual([]);
});

test('an end without its beginning (seen by the next screen) is ignored', () => {
  const { reader, presses, holds } = setup();
  reader.ended(3200);
  expect(presses).toEqual([]);
  expect(holds()).toBe(0);
});

test('after a hold, the next press works again', () => {
  const { reader, presses, holds } = setup();
  reader.began();
  jest.advanceTimersByTime(REMOTE_HOLD_MS);
  reader.ended(3100);
  reader.began();
  reader.ended(120);
  expect(holds()).toBe(1);
  expect(presses).toEqual([120]);
});

test('dispose stops a hold being timed', () => {
  const { reader, holds } = setup();
  reader.began();
  reader.dispose();
  jest.advanceTimersByTime(REMOTE_HOLD_MS * 2);
  expect(holds()).toBe(0);
});
