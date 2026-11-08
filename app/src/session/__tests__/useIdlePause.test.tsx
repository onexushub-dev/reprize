import { act, renderHook } from '@testing-library/react-native';

import { SETUP_IDLE_MS, SETUP_WARN_MS, useIdlePause } from '../useIdlePause';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const run = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

test('35 s without a touch pause the camera (2026-11-08 spec §3.2)', async () => {
  expect(SETUP_IDLE_MS).toBe(35_000);
  const onPause = jest.fn();
  const view = await renderHook(() => useIdlePause(true, { onPause }));
  await run(SETUP_IDLE_MS - 1);
  expect(view.result.current.paused).toBe(false);
  await run(1);
  expect(view.result.current.paused).toBe(true);
  expect(onPause).toHaveBeenCalledTimes(1);
});

test('the warning counts down the last 5 s, and goes once paused', async () => {
  expect(SETUP_WARN_MS).toBe(5_000);
  const view = await renderHook(() => useIdlePause(true));
  await run(SETUP_IDLE_MS - SETUP_WARN_MS - 1);
  expect(view.result.current.warning).toBeUndefined();
  await run(1);
  expect(view.result.current.warning).toBe(5);
  await run(1_000);
  expect(view.result.current.warning).toBe(4);
  await run(3_000);
  expect(view.result.current.warning).toBe(1);
  await run(1_000);
  expect(view.result.current.warning).toBeUndefined();
  expect(view.result.current.paused).toBe(true);
});

test('a touch during the warning hides it and starts the wait again', async () => {
  const view = await renderHook(() => useIdlePause(true));
  await run(32_000);
  expect(view.result.current.warning).toBe(3);
  await act(async () => view.result.current.activity('toque'));
  expect(view.result.current.warning).toBeUndefined();
  await run(25_000);
  expect(view.result.current.paused).toBe(false);
  expect(view.result.current.warning).toBeUndefined();
  await run(10_000);
  expect(view.result.current.paused).toBe(true);
});

test('a touch or a remote press brings a paused camera back, and says which', async () => {
  const onResume = jest.fn();
  const view = await renderHook(() => useIdlePause(true, { onResume }));
  await run(SETUP_IDLE_MS);
  await act(async () => view.result.current.activity('controle'));
  expect(view.result.current.paused).toBe(false);
  expect(onResume).toHaveBeenCalledWith('controle');
});

test('not active (a recording, a sheet, another screen): never pauses or warns, and a pause ends', async () => {
  const onResume = jest.fn();
  const view = await renderHook(({ on }: { on: boolean }) => useIdlePause(on, { onResume }), {
    initialProps: { on: true },
  });
  await run(SETUP_IDLE_MS);
  expect(view.result.current.paused).toBe(true);
  await view.rerender({ on: false });
  expect(view.result.current.paused).toBe(false);
  expect(onResume).toHaveBeenCalledWith('fim');
  await run(SETUP_IDLE_MS * 3);
  expect(view.result.current.paused).toBe(false);
  expect(view.result.current.warning).toBeUndefined();
});

test('a warning cut short by a sheet does not come back stale when the wait starts again', async () => {
  const view = await renderHook(({ on }: { on: boolean }) => useIdlePause(on), { initialProps: { on: true } });
  await run(32_000);
  expect(view.result.current.warning).toBe(3);
  await view.rerender({ on: false });
  expect(view.result.current.warning).toBeUndefined();
  await view.rerender({ on: true });
  await run(1);
  expect(view.result.current.warning).toBeUndefined();
  await run(29_999);
  expect(view.result.current.warning).toBe(5);
});
