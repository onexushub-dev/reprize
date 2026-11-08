import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BRAND_HANDLE, logoAspect } from '../brandLogo';
import { frameLayout } from '../layout';
import { ShareOverlay } from '../ShareOverlay';

const frame = { width: 1080, height: 1920 };
const layout = frameLayout({ width: 1920, height: 1080 }, frame);

test('every clip carries the Reprize R and our Instagram, so whoever sees it knows what made it and where to find us', async () => {
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  expect(screen.getByLabelText('Reprize')).toBeTruthy();
  expect(BRAND_HANDLE).toBe('@reprize.app');
  expect(screen.getByText('@reprize.app')).toBeTruthy();
  expect(screen.queryByText('feito com Reprize')).toBeNull();
});

test('without the watermark (paid exports) neither the R nor the handle is drawn', async () => {
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} watermark={false} />);
  expect(screen.queryByLabelText('Reprize')).toBeNull();
  expect(screen.queryByText('@reprize.app')).toBeNull();
});

test('the R is 4.2% of the short side tall and keeps its proportions, in a 720 and in a 1080 export', async () => {
  const small = { width: 720, height: 1280 };
  const view = await render(<ShareOverlay frame={small} layout={frameLayout({ width: 1920, height: 1080 }, small)} scale={1} />);
  const a = StyleSheet.flatten(screen.getByLabelText('Reprize').props.style);
  expect(a.height).toBeCloseTo(30.24, 1);
  expect(a.width / a.height).toBeCloseTo(logoAspect(), 3);
  await view.unmount();
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  const b = StyleSheet.flatten(screen.getByLabelText('Reprize').props.style);
  expect(b.height).toBeCloseTo(45.36, 1);
});

test('the handle is 3% of the short side, so it reads the same in a 720 and in a 1080 export', async () => {
  const small = { width: 720, height: 1280 };
  const view = await render(<ShareOverlay frame={small} layout={frameLayout({ width: 1920, height: 1080 }, small)} scale={1} />);
  expect(StyleSheet.flatten(screen.getByText('@reprize.app').props.style).fontSize).toBeCloseTo(21.6, 1);
  await view.unmount();
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  expect(StyleSheet.flatten(screen.getByText('@reprize.app').props.style).fontSize).toBeCloseTo(32.4, 1);
});

test('the R and the handle scale with the capture scale, so the PNG matches the design', async () => {
  await render(<ShareOverlay frame={frame} layout={layout} scale={0.5} />);
  expect(StyleSheet.flatten(screen.getByLabelText('Reprize').props.style).height).toBeCloseTo(22.68, 1);
  expect(StyleSheet.flatten(screen.getByText('@reprize.app').props.style).fontSize).toBeCloseTo(16.2, 1);
});

test('on a vertical clip the logo sits in the bottom right corner, the same distance from the right and from the bottom, in both sizes', async () => {
  const small = { width: 720, height: 1280 };
  const vertical = { width: 1080, height: 1920 };
  const view = await render(<ShareOverlay frame={small} layout={frameLayout(vertical, small)} scale={1} />);
  const a = StyleSheet.flatten(screen.getByLabelText('Reprize').parent!.props.style);
  expect(a.right).toBeCloseTo(32.4, 1);
  expect(a.bottom).toBe(a.right);
  await view.unmount();
  await render(<ShareOverlay frame={frame} layout={frameLayout(vertical, frame)} scale={1} />);
  const b = StyleSheet.flatten(screen.getByLabelText('Reprize').parent!.props.style);
  expect(b.right / frame.width).toBeCloseTo(a.right / small.width, 3);
  expect(b.bottom).toBe(b.right);
});

test('on a landscape clip the logo follows the video corner, not the frame corner, with the same margin', async () => {
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  const pill = StyleSheet.flatten(screen.getByLabelText('Reprize').parent!.props.style);
  const margin = frame.width * 0.045;
  const bandBelow = layout.bottom.height;
  expect(bandBelow).toBeGreaterThan(0);
  expect(pill.right).toBeCloseTo(margin, 1);
  expect(pill.bottom).toBeCloseTo(bandBelow + margin, 1);
});

test('the video area stays transparent', async () => {
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  const area = StyleSheet.flatten(screen.getByTestId('share-video-area').props.style);
  expect(area.backgroundColor).toBeUndefined();
  expect(area.height).toBe(607.5);
});

test('no template text is drawn, only the mark', async () => {
  await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  expect(screen.queryByTestId('story-top-block')).toBeNull();
  expect(screen.queryByTestId('story-bottom-block')).toBeNull();
});

test('in a landscape frame the video fills it, with no bands, and the logo keeps the same size and margin in the bottom right corner', async () => {
  const wide = { width: 1280, height: 720 };
  const wideLayout = frameLayout({ width: 1920, height: 1080 }, wide);
  expect(wideLayout.top.height).toBe(0);
  expect(wideLayout.bottom.height).toBe(0);
  await render(<ShareOverlay frame={wide} layout={wideLayout} scale={1} />);
  const logo = StyleSheet.flatten(screen.getByLabelText('Reprize').props.style);
  const pill = StyleSheet.flatten(screen.getByLabelText('Reprize').parent!.props.style);
  expect(logo.height).toBeCloseTo(30.24, 1);
  expect(pill.right).toBeCloseTo(32.4, 1);
  expect(pill.bottom).toBe(pill.right);
});

test('no dark gradient over the video, with or without the mark (2026-11-08: a shadow over the bottom of every clip)', async () => {
  const view = await render(<ShareOverlay frame={frame} layout={layout} scale={1} watermark={false} />);
  expect(JSON.stringify(view.toJSON())).not.toMatch(/Gradient|url\(#/);
  await view.unmount();
  const marked = await render(<ShareOverlay frame={frame} layout={layout} scale={1} />);
  expect(JSON.stringify(marked.toJSON())).not.toMatch(/Gradient|url\(#/);
});
