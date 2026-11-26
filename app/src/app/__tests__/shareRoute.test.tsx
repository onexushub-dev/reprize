import { render } from '@testing-library/react-native';

import ShareScreen from '../share/[id]';

jest.mock('../../account/flags', () => ({ SHARING_ENABLED: true }));
jest.mock('expo-router', () => ({ Redirect: () => null, useLocalSearchParams: jest.fn() }));
jest.mock('../../cloud/shareGroup', () => ({ liveGroupOf: jest.fn(() => undefined) }));
jest.mock('../../cloud/shareRecording', () => ({
  liveShare: jest.fn(),
  shareRecording: jest.fn(async () => ({ ok: false, reason: 'failed' })),
  turnOffRecordingShare: jest.fn(),
}));
const mockTarget: { last?: { create: () => Promise<unknown> } } = {};
jest.mock('../../components/ShareFlow', () => ({
  ShareFlow: (p: { target: { create: () => Promise<unknown> } }) => ((mockTarget.last = p.target), null),
}));
jest.mock('../../components/ShareLinkPanel', () => ({ ShareLinkPanel: () => null }));

const { useLocalSearchParams } = jest.requireMock('expo-router');
const { shareRecording } = jest.requireMock('../../cloud/shareRecording');

test('opened with picked clips, the link is made with only those (2026-11-23)', async () => {
  useLocalSearchParams.mockReturnValue({ id: 's1', clips: 'c1,c2' });
  await render(<ShareScreen />);
  await mockTarget.last!.create();
  expect(shareRecording).toHaveBeenCalledWith('s1', undefined, ['c1', 'c2']);
});

test('opened without clips, the whole recording', async () => {
  useLocalSearchParams.mockReturnValue({ id: 's1' });
  await render(<ShareScreen />);
  await mockTarget.last!.create();
  expect(shareRecording).toHaveBeenLastCalledWith('s1', undefined, undefined);
});
