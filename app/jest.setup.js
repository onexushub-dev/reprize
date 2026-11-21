/* global jest */
// The tests cover the release behaviour: the field-test unlock (src/payments/fieldTest.ts) stays off here.
jest.mock('./src/payments/fieldTest', () => ({ FIELD_TEST_UNLOCK_ALL: false }));
// Reanimated needs its native side, which Jest does not have (its own mock still loads it). The app only uses a few
// APIs (PulseRing); this stand-in renders the final styles without animating.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View } = require('react-native');
  const useSharedValue = (initial) => {
    const [box] = React.useState(() => ({
      value: initial,
      get() {
        return this.value;
      },
      set(next) {
        this.value = next;
      },
    }));
    return box;
  };
  return {
    __esModule: true,
    default: { View },
    useSharedValue,
    useAnimatedStyle: (worklet) => worklet(),
    useReducedMotion: () => false,
    withRepeat: (animation) => animation,
    withTiming: (to) => to,
    cancelAnimation: () => {},
    Easing: { out: (f) => f, inOut: (f) => f, quad: (t) => t, sin: (t) => t, linear: (t) => t },
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
  };
});

// The volume library talks to a native module that tests do not have: every screen that imports it (the clip screen
// shows the volume level, 2026-11-21) gets this quiet stand-in. Tests that drive it mock it again in their own file.
jest.mock('react-native-volume-manager', () => ({
  VolumeManager: {
    addVolumeListener: () => ({ remove: () => {} }),
    getVolume: async () => ({ volume: 0.5 }),
    setVolume: async () => {},
    showNativeVolumeUI: async () => {},
  },
}));
