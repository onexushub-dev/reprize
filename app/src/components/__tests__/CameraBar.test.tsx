import { render, screen } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setLocale } from '../../i18n';
import { CameraBar, dockBottom } from '../CameraBar';

// The black under the row of Gravar, down to the screen's edge (2026-11-26). On the iPhone the row sits 12 points into
// the home indicator's area; the system buttons or gesture bar of an Android are drawn over the app (edge-to-edge), so
// the row stays clear of them. Either way at least DOCK_GAP of black under the row: it went flush on the buttons.
function renderWithBottomInset(bottom: number) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom } }}>
      <CameraBar
        clipSeconds={15}
        quality="Full HD"
        qualityFixed={false}
        triggers={[]}
        onPanel={() => {}}
        busy={false}
        onRecord={() => {}}
        onRecordings={() => {}}
        onSettings={() => {}}
      />
    </SafeAreaProvider>,
  );
}

const under = () => StyleSheet.flatten(screen.getByTestId('camera-dock').props.style).paddingBottom;

beforeEach(() => setLocale('en'));
afterEach(() => jest.restoreAllMocks());

describe('dockBottom', () => {
  it('on an iPhone with the home indicator the row sits 12 points into its 34', () => {
    expect(dockBottom('ios', 34)).toBe(22);
  });

  it('on an iPhone with a home button there is still black under the row', () => {
    expect(dockBottom('ios', 0)).toBe(16);
  });

  it('on Android the row stays 16 points above the system buttons', () => {
    // Build 13 on a Xiaomi with 3-button navigation, 2026-11-26: a 47 point bar and the record button flush on it.
    expect(dockBottom('android', 47)).toBe(63);
  });

  it('on Android with nothing reported at the bottom the row still keeps its 16 points', () => {
    expect(dockBottom('android', 0)).toBe(16);
  });
});

it('the camera bar keeps that space under the row of Gravar on an iPhone', async () => {
  await renderWithBottomInset(34);
  expect(under()).toBe(22);
});

it('the camera bar keeps that space under the row of Gravar on Android', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await renderWithBottomInset(47);
  expect(under()).toBe(63);
});
