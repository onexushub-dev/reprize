import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { setLocale } from '../../i18n';
import { CameraBar } from '../CameraBar';

// The row of Gravar sinks a little into the bottom safe area (the iPhone's home indicator), never past it: on an
// Android with on-screen buttons the window ends above them and there is no area to sink into (2026-11-25).
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

const sink = () => {
  const style = StyleSheet.flatten(screen.getByTestId('camera-dock').props.style);
  return -(style.marginBottom ?? 0);
};

beforeEach(() => setLocale('en'));

it('on an iPhone the row of Gravar sinks 12 points into the home indicator area', async () => {
  await renderWithBottomInset(34);
  expect(sink()).toBe(12);
});

it('with no bottom area (Android with on-screen buttons) the row does not sink under them', async () => {
  await renderWithBottomInset(0);
  expect(sink()).toBe(0);
});

it('with a small bottom area it sinks only as far as the area goes', async () => {
  await renderWithBottomInset(5);
  expect(sink()).toBe(5);
});
