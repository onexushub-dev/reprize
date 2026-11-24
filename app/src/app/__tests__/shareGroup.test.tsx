import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ShareGroupScreen from '../share/group';

jest.mock('../../account/flags', () => ({ SHARING_ENABLED: true }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
  Redirect: () => null,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('../../account/account', () => ({
  useAccount: jest.fn(() => ({ ready: true, account: { id: 'u1' } })),
  refreshOrSignOut: jest.fn(),
}));
jest.mock('../../account/SignInButtons', () => ({ SignInButtons: () => null }));
jest.mock('../../share/OverlayCapturer', () => ({
  useOverlayCapturer: () => ({ element: null, capture: jest.fn(), release: jest.fn() }),
}));
jest.mock('../../cloud/shareCover', () => ({ ensureCover: jest.fn(() => Promise.resolve()) }));
jest.mock('../../cloud/shares', () => ({ noticeAccepted: jest.fn(), acceptNotice: jest.fn() }));
jest.mock('../../cloud/shareStatus', () => ({ useShareStatus: () => ({ opened: 3, report: 'none' }) }));
jest.mock('../../cloud/shareGroup', () => ({
  groupLive: jest.fn(() => true),
  linkOrder: jest.fn((ids: string[]) => ids),
  liveGroupFor: jest.fn(),
  shareRecordings: jest.fn(),
  turnOffGroupShare: jest.fn(),
}));
jest.mock('../../cloud/shareGroups', () => ({
  shareGroup: jest.fn(),
  groupClips: (g: { recordings: { clips: number }[] }) => g.recordings.reduce((t, r) => t + r.clips, 0),
}));
jest.mock('../../cloud/appUploadQueue', () => {
  const progress = (done: number, total: number) => ({ state: 'uploading', done, total, failed: 0, sentBytes: done, totalBytes: total });
  return {
    uploadQueue: { retry: jest.fn(), setManualPause: jest.fn() },
    useShareProgress: (id: string) => (id === 'ra' ? { ...progress(2, 2), state: 'done' } : progress(1, 3)),
    useGroupProgress: () => ({ ...progress(3, 5), recordings: 2, recordingsDone: 1 }),
  };
});
jest.mock('../../data/mmkv', () => ({
  repo: { getSession: jest.fn((id: string) => ({ id, sport: 'outro', startedAt: 0, endedAt: 1, name: id === 's1' ? 'Jogo 1' : 'Jogo 2' })) },
}));

const { useLocalSearchParams } = jest.requireMock('expo-router');
const groups = jest.requireMock('../../cloud/shareGroup');
const { shareGroup } = jest.requireMock('../../cloud/shareGroups');
const { noticeAccepted } = jest.requireMock('../../cloud/shares');
const { ensureCover } = jest.requireMock('../../cloud/shareCover');

const GROUP = {
  groupId: 'g1',
  url: 'https://reprizeapp.com/v/abc',
  createdAt: 0,
  expiresAt: Date.now() + 20 * 60 * 60 * 1000,
  recordings: [
    { sessionId: 's1', shareId: 'ra', clips: 2 },
    { sessionId: 's2', shareId: 'rb', clips: 3 },
  ],
  state: 'active',
};

beforeEach(() => jest.clearAllMocks());

test('from a strip, the live group link: QR code, its recordings, and each recording with its own upload', async () => {
  useLocalSearchParams.mockReturnValue({ group: 'g1' });
  shareGroup.mockReturnValue(GROUP);
  await render(<ShareGroupScreen />);
  expect(screen.getByText('Compartilhar gravações')).toBeTruthy();
  expect(screen.getByText('Use a câmera do celular para abrir as gravações.')).toBeTruthy();
  expect(screen.getByText('2 gravações')).toBeTruthy();
  expect(screen.getByText('5 clipes')).toBeTruthy();
  expect(screen.getByText('Aberto em 3 celulares')).toBeTruthy();
  expect(screen.getByText('1 de 2 gravações enviadas')).toBeTruthy();
  expect(screen.getByText('3 de 5 clipes enviados')).toBeTruthy();
  expect(screen.getByLabelText('Jogo 1, Os 2 clipes foram enviados')).toBeTruthy();
  expect(screen.getByLabelText('Jogo 2, 1 de 3 clipes enviados')).toBeTruthy();
  // The cover is the first recording's first clip.
  expect(ensureCover).toHaveBeenCalledWith('s1', expect.any(Function));
  expect(groups.shareRecordings).not.toHaveBeenCalled();
});

test('from the list, a new link for the picked recordings once the notice is accepted', async () => {
  useLocalSearchParams.mockReturnValue({ ids: 's1,s2' });
  groups.liveGroupFor.mockReturnValue(undefined);
  noticeAccepted.mockResolvedValue(true);
  groups.shareRecordings.mockResolvedValue({ ok: true, group: GROUP });
  await render(<ShareGroupScreen />);
  await waitFor(() => expect(screen.getByText('2 gravações')).toBeTruthy());
  expect(groups.shareRecordings).toHaveBeenCalledWith(['s1', 's2']);
});

test('a refusal says why', async () => {
  useLocalSearchParams.mockReturnValue({ ids: 's1,s2' });
  groups.liveGroupFor.mockReturnValue(undefined);
  noticeAccepted.mockResolvedValue(true);
  groups.shareRecordings.mockResolvedValue({ ok: false, reason: 'not_pro' });
  await render(<ShareGroupScreen />);
  await waitFor(() => expect(screen.getByText('Compartilhar gravações é do PRO.')).toBeTruthy());
});

test('Encerrar compartilhamento turns off the whole link', async () => {
  useLocalSearchParams.mockReturnValue({ group: 'g1' });
  shareGroup.mockReturnValue(GROUP);
  groups.turnOffGroupShare.mockResolvedValue(true);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<ShareGroupScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Encerrar compartilhamento' }));
  const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
  await act(async () => buttons.find((b) => b.text === 'Encerrar')!.onPress!());
  expect(groups.turnOffGroupShare).toHaveBeenCalledWith('g1');
  expect(screen.getByText('Compartilhamento encerrado. Quem ainda não abriu não consegue mais abrir.')).toBeTruthy();
  alert.mockRestore();
});
