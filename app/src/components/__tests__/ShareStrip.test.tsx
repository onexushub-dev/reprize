import { fireEvent, render, screen } from '@testing-library/react-native';

import { ShareStrip } from '../ShareStrip';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../../cloud/appUploadQueue', () => ({
  useShareProgress: () => ({ state: 'uploading', done: 2, total: 5, failed: 0, sentBytes: 0, totalBytes: 1 }),
}));
jest.mock('../../cloud/shareStatus', () => ({ useShareStatus: jest.fn(() => ({ opened: 2, report: 'none' })) }));
jest.mock('../../cloud/shareGroups', () => ({ shareGroup: jest.fn() }));

const { router } = jest.requireMock('expo-router');
const { useShareStatus } = jest.requireMock('../../cloud/shareStatus');
const { shareGroup } = jest.requireMock('../../cloud/shareGroups');

const NOW = 1_000_000;
const shared = { shareId: 'ra', url: 'https://reprizeapp.com/v/abc', createdAt: 0, expiresAt: NOW + 5 * 3600 * 1000, clips: 5, state: 'active' as const };

beforeEach(() => jest.clearAllMocks());

test('a recording of its own link opens its own sheet', async () => {
  await render(<ShareStrip sessionId="s1" shared={shared} now={NOW} />);
  expect(screen.getByText('2 de 5 clipes enviados · Aberto em 2 celulares · Disponível por mais 5 horas')).toBeTruthy();
  expect(useShareStatus).toHaveBeenCalledWith('ra', 60 * 1000);
  await fireEvent.press(screen.getByRole('button'));
  expect(router.push).toHaveBeenCalledWith('/share/s1');
});

test('a recording in a group link says how many recordings the link holds and opens the group sheet', async () => {
  shareGroup.mockReturnValue({ groupId: 'g1', recordings: [{}, {}, {}] });
  await render(<ShareStrip sessionId="s1" shared={{ ...shared, groupId: 'g1' }} now={NOW} />);
  expect(screen.getByText('3 gravações · 2 de 5 clipes enviados · Aberto em 2 celulares · Disponível por mais 5 horas')).toBeTruthy();
  // Who opened it is counted on the link, the group.
  expect(useShareStatus).toHaveBeenCalledWith('g1', 60 * 1000);
  await fireEvent.press(screen.getByRole('button'));
  expect(router.push).toHaveBeenCalledWith('/share/group?group=g1');
});
