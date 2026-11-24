import { render, screen } from '@testing-library/react-native';

import { ShareLinkPanel } from '../ShareLinkPanel';

jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../ShareUploadStatus', () => ({ ShareUploadStatus: () => null }));
jest.mock('../../cloud/shareStatus', () => ({ useShareStatus: () => undefined }));

const shared = { shareId: 'sh1', url: 'https://reprizeapp.com/v/k', expiresAt: Date.now() + 3_600_000, clips: 3 };

test('a picked-clips link says the clips are from this recording (2026-11-23)', async () => {
  await render(<ShareLinkPanel shared={{ ...shared, clipIds: ['a', 'b', 'c'] }} />);
  expect(screen.getByText('3 clipes dessa gravação')).toBeTruthy();
});

test('a whole-recording link counts its clips as before', async () => {
  await render(<ShareLinkPanel shared={shared} />);
  expect(screen.getByText('3 clipes')).toBeTruthy();
});
