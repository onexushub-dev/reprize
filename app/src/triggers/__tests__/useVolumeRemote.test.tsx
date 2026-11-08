import { act, renderHook } from '@testing-library/react-native';

import { AppState } from 'react-native';

import { diagFlags, setDiagFlags } from '../../diag/diagLog';
import { REMOTE_HOLD_MS } from '../pressHold';
import { ARM_MS, SETTLE_MS, WATCH_MS, useVolumeRemote } from '../useVolumeRemote';

// The phone's real volume (iOS): undefined by default, so the tests above run the library-only path (Android).
// Native events (`onCaptureButton`, `onAudioChange`) are kept by name so a test can fire them.
jest.mock('../../../modules/replay-camera', () => {
  const events: Record<string, ((e: unknown) => void) | undefined> = {};
  return {
    __events: events,
    outputVolume: jest.fn(() => undefined),
    setCaptureButtons: jest.fn(() => true),
    addReplayListener: jest.fn((event: string, fn: (e: unknown) => void) => {
      events[event] = fn;
      return {
        remove: () => {
          if (events[event] === fn) events[event] = undefined;
        },
      };
    }),
  };
});

type Listener = (r: { volume: number }) => void;

jest.mock('react-native-volume-manager', () => {
  const state = { listeners: new Set<Listener>(), volume: 0.5 };
  return {
    __state: state,
    VolumeManager: {
      getVolume: jest.fn(async () => ({ volume: state.volume })),
      setVolume: jest.fn(async (v: number) => {
        state.volume = v;
        state.listeners.forEach((l) => l({ volume: v })); // the OS reports our own reset too
      }),
      showNativeVolumeUI: jest.fn(async () => {}),
      addVolumeListener: jest.fn((l: Listener) => {
        state.listeners.add(l);
        return { remove: () => state.listeners.delete(l) };
      }),
    },
  };
});

const lib = jest.requireMock('react-native-volume-manager');
const camera = jest.requireMock('../../../modules/replay-camera');
const press = (volume: number) => lib.__state.listeners.forEach((l: Listener) => l({ volume }));
const fire = (event: string, body: unknown) => {
  const fn = camera.__events[event];
  if (fn) fn(body);
};

beforeEach(() => {
  jest.clearAllMocks();
  camera.outputVolume.mockImplementation(() => undefined);
  lib.__state.listeners.clear();
  lib.__state.volume = 0.5;
});

test('a volume press calls onPress once and restores the starting level', async () => {
  const onPress = jest.fn();
  await renderHook(() => useVolumeRemote(true, onPress));

  expect(lib.VolumeManager.showNativeVolumeUI).toHaveBeenCalledWith({ enabled: false });
  expect(lib.__state.listeners.size).toBe(1);

  const later = Date.now() + ARM_MS + 500; // a real press comes well after the initial parking
  jest.spyOn(Date, 'now').mockReturnValue(later);
  await act(async () => press(0.5625));
  jest.restoreAllMocks();

  expect(onPress).toHaveBeenCalledTimes(1);
  expect(lib.VolumeManager.setVolume).toHaveBeenLastCalledWith(0.5, expect.anything());
});

test('a recording parks at the loud level and gives the player\'s level back (2026-11-07)', async () => {
  lib.__state.volume = 0.4;
  const view = await renderHook(() => useVolumeRemote(true, jest.fn(), { parkAt: 0.75 }));
  await act(async () => {});
  expect(lib.VolumeManager.setVolume).toHaveBeenCalledWith(0.75, expect.anything());
  await act(async () => view.unmount());
  expect(lib.VolumeManager.setVolume).toHaveBeenLastCalledWith(0.4, expect.anything());
});

test('a player level above the loud one, with room for a press, is kept', async () => {
  lib.__state.volume = 0.78;
  await renderHook(() => useVolumeRemote(true, jest.fn(), { parkAt: 0.75 }));
  await act(async () => {});
  expect(lib.VolumeManager.setVolume).not.toHaveBeenCalledWith(0.75, expect.anything());
});

test('a phone at max volume is moved down so presses still register', async () => {
  lib.__state.volume = 1;
  await renderHook(() => useVolumeRemote(true, jest.fn()));
  expect(lib.VolumeManager.setVolume).toHaveBeenCalledWith(0.5, expect.anything());
});

test('unmounting stops listening and shows the system volume UI again', async () => {
  const onPress = jest.fn();
  const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
  await act(async () => unmount());

  expect(lib.__state.listeners.size).toBe(0);
  expect(lib.VolumeManager.showNativeVolumeUI).toHaveBeenLastCalledWith({ enabled: true });
});

test('disabled does nothing', async () => {
  await renderHook(() => useVolumeRemote(false, jest.fn()));
  expect(lib.VolumeManager.addVolumeListener).not.toHaveBeenCalled();
});

test('volume steps (Android) do not turn our own parking into a press', async () => {
  const steps = (v: number) => Math.round(v * 15) / 15;
  lib.__state.volume = steps(1);
  lib.VolumeManager.setVolume.mockImplementation(async (v: number) => {
    lib.__state.volume = steps(v); // the OS lands on the nearest step and reports that
    lib.__state.listeners.forEach((l: Listener) => l({ volume: lib.__state.volume }));
  });
  lib.VolumeManager.getVolume.mockImplementation(async () => ({ volume: lib.__state.volume }));
  const onPress = jest.fn();

  await renderHook(() => useVolumeRemote(true, onPress));
  await act(async () => {});

  expect(onPress).not.toHaveBeenCalled();
});

test('leaving restores the volume the phone had before', async () => {
  lib.__state.volume = 0.95; // near max, so the hook parks it at 0.5 meanwhile
  const { unmount } = await renderHook(() => useVolumeRemote(true, jest.fn()));
  await act(async () => {});
  await act(async () => unmount());
  expect(lib.VolumeManager.setVolume).toHaveBeenCalledWith(0.5, expect.anything());
  expect(lib.VolumeManager.setVolume).toHaveBeenLastCalledWith(0.95, expect.anything());
});

test('right after it starts, a volume change is the system (the other screen putting the volume back), not a press', async () => {
  const onPress = jest.fn();
  await renderHook(() => useVolumeRemote(true, onPress));
  const soon = Date.now() + 400;
  jest.spyOn(Date, 'now').mockReturnValue(soon);
  await act(async () => press(0.8));
  jest.restoreAllMocks();
  expect(onPress).not.toHaveBeenCalled();
});

test('coming back to the front, the volume change iOS makes is ignored, and a press after that counts', async () => {
  let onChange: (state: string) => void = () => {};
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (state: string) => void) => {
    onChange = fn;
    return { remove: jest.fn() };
  }) as never);
  const onPress = jest.fn();
  await renderHook(() => useVolumeRemote(true, onPress));
  const t0 = Date.now() + ARM_MS + 5000;
  const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
  await act(async () => onChange('active'));
  now.mockReturnValue(t0 + 300);
  await act(async () => press(0.3));
  expect(onPress).not.toHaveBeenCalled();
  now.mockReturnValue(t0 + ARM_MS + 500);
  await act(async () => press(0.3625));
  expect(onPress).toHaveBeenCalledTimes(1);
  jest.restoreAllMocks();
});

describe('2026-10-31 field logs', () => {
  test('a jump to the earpiece volume (1.00) when the camera restarts is not a press', async () => {
    const onPress = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress));
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + ARM_MS + 500);
    await act(async () => press(1));
    expect(onPress).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  test('after the camera restarts or the audio route changes, volume changes are ignored for a moment', async () => {
    const onPress = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress));
    const t0 = Date.now() + ARM_MS + 500;
    const now = jest.spyOn(Date, 'now').mockReturnValue(t0);
    await act(async () => fire('onAudioChange', { reason: 'cameraRestart' }));
    now.mockReturnValue(t0 + 300);
    await act(async () => press(0.5625)); // one step, but it is the system's
    expect(onPress).not.toHaveBeenCalled();
    now.mockReturnValue(t0 + ARM_MS + 500);
    await act(async () => press(0.625));
    expect(onPress).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  test('a press that arrives as a capture event counts at once and leaves the volume alone', async () => {
    const onPress = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress));
    await act(async () => {});
    lib.VolumeManager.setVolume.mockClear();
    await act(async () => fire('onCaptureButton', { button: 'secondary' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(lib.VolumeManager.setVolume).not.toHaveBeenCalled();
  });

  test('with phases, a press counts at its release (2026-11-07)', async () => {
    const onPress = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress, { onHold: jest.fn() }));
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'began' }));
    expect(onPress).not.toHaveBeenCalled();
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'ended', ms: 140 }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('held 3 s it calls onHold, not onPress', async () => {
    jest.useFakeTimers();
    const onPress = jest.fn();
    const onHold = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress, { onHold }));
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'began' }));
    await act(async () => void jest.advanceTimersByTime(REMOTE_HOLD_MS));
    expect(onHold).toHaveBeenCalledTimes(1);
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'ended', ms: 3300 }));
    expect(onPress).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  test('without a hold handler, a long press is still a press', async () => {
    jest.useFakeTimers();
    const onPress = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress));
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'began' }));
    await act(async () => void jest.advanceTimersByTime(REMOTE_HOLD_MS));
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'ended', ms: 3300 }));
    expect(onPress).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  test('a release whose press another screen heard is ignored', async () => {
    const onPress = jest.fn();
    await renderHook(() => useVolumeRemote(true, onPress, { onHold: jest.fn() }));
    await act(async () => fire('onCaptureButton', { button: 'secondary', phase: 'ended', ms: 3100 }));
    expect(onPress).not.toHaveBeenCalled();
  });

  test('capture buttons stay on until the last screen listening stops', async () => {
    const first = await renderHook(() => useVolumeRemote(true, jest.fn()));
    const second = await renderHook(() => useVolumeRemote(true, jest.fn()));
    expect(camera.setCaptureButtons).toHaveBeenCalledWith(true);
    await act(async () => first.unmount());
    expect(camera.setCaptureButtons).not.toHaveBeenCalledWith(false);
    await act(async () => second.unmount());
    expect(camera.setCaptureButtons).toHaveBeenLastCalledWith(false);
  });

  test('no capture event counts once the hook stops', async () => {
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await act(async () => unmount());
    await act(async () => fire('onCaptureButton', { button: 'primary' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('iOS: the library slider goes stale (2026-10-28 field log)', () => {
  // The library sets the volume through a hidden slider: setting the value it already holds does nothing, and a
  // press does not update it. `real` is the phone's volume, `slider` what the library thinks it is.
  const ios = { real: 0.5, slider: 0.5 };

  beforeEach(() => {
    jest.useFakeTimers();
    ios.real = 0.5;
    ios.slider = 0.5;
    camera.outputVolume.mockImplementation(() => ios.real);
    lib.VolumeManager.getVolume.mockImplementation(async () => ({ volume: ios.slider }));
    lib.VolumeManager.setVolume.mockImplementation(async (v: number) => {
      if (Math.abs(v - ios.slider) < 1e-6) return; // same value: the slider ignores it
      ios.slider = v;
      ios.real = v;
      lib.__state.listeners.forEach((l: Listener) => l({ volume: v }));
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const advance = (ms: number) => act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
  /** A remote press: the phone's volume goes up a step, the slider does not follow. */
  const remote = () => act(async () => {
    ios.real += 0.0625;
    lib.__state.listeners.forEach((l: Listener) => l({ volume: ios.real }));
  });

  test('a parking that does not take is retried, so the volume does not creep up press after press', async () => {
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await advance(ARM_MS + 500);

    for (let i = 0; i < 6; i += 1) {
      await remote();
      await advance(3 * SETTLE_MS + 500);
    }

    expect(onPress).toHaveBeenCalledTimes(6);
    expect(ios.real).toBeCloseTo(0.5, 5);
    await act(async () => unmount());
  });

  test('the nudge of a retried parking, reported late, is not a press (2026-11-05 log)', async () => {
    // iOS reports the volume a moment after it is set, past the echo window.
    lib.VolumeManager.setVolume.mockImplementation(async (v: number) => {
      if (Math.abs(v - ios.slider) < 1e-6) return;
      ios.slider = v;
      ios.real = v;
      setTimeout(() => lib.__state.listeners.forEach((l: Listener) => l({ volume: v })), SETTLE_MS + 100);
    });
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await advance(ARM_MS + 3 * SETTLE_MS + 1000);

    await remote(); // the slider stays at 0.5: parking needs a nudge, whose report arrives late
    await advance(4 * SETTLE_MS + 1000);

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(ios.real).toBeCloseTo(0.5, 5);
    await act(async () => unmount());
  });

  test('a volume that drifted away without a press is put back by the watch, and the next press counts', async () => {
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await advance(ARM_MS + 500);

    ios.real = 1; // at the top a press changes nothing: the remote would look dead
    await advance(WATCH_MS + 3 * SETTLE_MS + 500);
    expect(ios.real).toBeCloseTo(0.5, 5);
    expect(onPress).not.toHaveBeenCalled();

    await remote();
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => unmount());
  });

  test('the previous screen putting back a full volume while this one arms does not become the parked level', async () => {
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await act(async () => {
      ios.real = 1; // the screen that stopped listening restores the phone's volume, late
      ios.slider = 1;
      lib.__state.listeners.forEach((l: Listener) => l({ volume: 1 }));
    });
    await advance(ARM_MS + 3 * SETTLE_MS + 500);
    expect(ios.real).toBeCloseTo(0.5, 5);
    await advance(2 * WATCH_MS);
    expect(ios.real).toBeCloseTo(0.5, 5); // the watch keeps it there, it does not push it back up
    await remote();
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => unmount());
  });

  test('presses while the app is not in front (Control Center) push the volume up; back in front it is parked again', async () => {
    let onChange: (state: string) => void = () => {};
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (state: string) => void) => {
      onChange = fn;
      return { remove: jest.fn() };
    }) as never);
    // The app's state as the hook reads it (the React Native mock may not have one).
    const before = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    let current = 'active';
    Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => current });
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await advance(ARM_MS + 500);

    current = 'inactive';
    for (let i = 0; i < 8; i += 1) await remote(); // up to the top: 0.5 + 8 steps
    expect(onPress).not.toHaveBeenCalled();
    expect(ios.real).toBeCloseTo(1, 5);

    current = 'active';
    await act(async () => onChange('active'));
    await advance(ARM_MS + 3 * SETTLE_MS + 500);
    expect(ios.real).toBeCloseTo(0.5, 5);
    await remote();
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => unmount());
    jest.restoreAllMocks();
    if (before) Object.defineProperty(AppState, 'currentState', before);
    else delete (AppState as { currentState?: string }).currentState;
  });

  test('a route reporting 1.00 while arming, then going back silently, does not turn the next press into a jump', async () => {
    // 2026-10-31 night log: "volume 0.55 ignorado (salto do sistema)". The earpiece route reported 1.00 while arming,
    // the volume went back to 0.5 with no event, the parking changed nothing (the slider already held 0.5) and the next
    // real press was measured from 1.00.
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await act(async () => lib.__state.listeners.forEach((l: Listener) => l({ volume: 1 }))); // ios.real stays 0.5
    await advance(ARM_MS + 3 * SETTLE_MS + 500);
    await remote();
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => unmount());
  });

  test('starting near the top parks in the middle using the real volume, not the stale slider', async () => {
    ios.real = 0.9;
    ios.slider = 0.75;
    const { unmount } = await renderHook(() => useVolumeRemote(true, jest.fn()));
    await advance(3 * SETTLE_MS + 500);
    expect(ios.real).toBeCloseTo(0.5, 5);
    await act(async () => unmount());
  });
});

describe('TEMP(diag-remote): volume path off from the Diagnóstico screen', () => {
  beforeEach(() => setDiagFlags({ ...diagFlags(), volumePathOff: true }));
  afterEach(() => setDiagFlags({ ...diagFlags(), volumePathOff: false }));

  test('presses count only as capture events: no volume listener, no hidden volume view, no parking', async () => {
    const onPress = jest.fn();
    const { unmount } = await renderHook(() => useVolumeRemote(true, onPress));
    await act(async () => {});
    expect(lib.VolumeManager.addVolumeListener).not.toHaveBeenCalled();
    expect(lib.VolumeManager.showNativeVolumeUI).not.toHaveBeenCalledWith({ enabled: false });
    expect(lib.VolumeManager.setVolume).not.toHaveBeenCalled();
    expect(camera.setCaptureButtons).toHaveBeenCalledWith(true);
    await act(async () => fire('onCaptureButton', { button: 'secondary' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    await act(async () => unmount());
    expect(camera.setCaptureButtons).toHaveBeenLastCalledWith(false);
    expect(lib.VolumeManager.setVolume).not.toHaveBeenCalled();
  });
});
