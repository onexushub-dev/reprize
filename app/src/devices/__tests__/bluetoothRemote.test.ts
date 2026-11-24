import { HIDDEN_REMOTE, connectedOf, followedIds, forgetRemote, knownRemotes, learnRemoteAtPress, linkOf, remoteCandidates, resetRemoteLinkForTests } from '../bluetoothRemote';

jest.mock('../../../modules/replay-camera', () => ({ bluetoothConnected: jest.fn() }));
jest.mock('../../data/mmkv', () => {
  let prefs: Record<string, unknown> = {};
  return {
    __reset: () => (prefs = {}),
    repo: {
      getPrefs: () => prefs,
      setPrefs: jest.fn((p: object) => (prefs = { ...prefs, ...p })),
    },
  };
});

const cam = jest.requireMock('../../../modules/replay-camera');
const { repo } = jest.requireMock('../../data/mmkv');

// The 2026-11-01 field test: the remote shows under Battery and Device Information, AirPods only under the latter.
const shutter = { id: 'AAAA', name: 'AB Shutter3', services: ['battery', 'info'] };
const airpods = { id: 'BBBB', name: 'AirPods Pro', services: ['info'] };

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock('../../data/mmkv').__reset();
  resetRemoteLinkForTests();
});

test('a remote is a device with Battery or HID; AirPods (Device Information only) are not', () => {
  expect(remoteCandidates([shutter, airpods])).toEqual([shutter]);
  expect(remoteCandidates([{ id: 'C', name: 'x', services: ['hid'] }])).toHaveLength(1);
});

test('the link of the learnt remote: connected, missing, Bluetooth off, or unknown', () => {
  expect(linkOf({ state: 'on', devices: [shutter, airpods] }, 'AAAA')).toBe('connected');
  expect(linkOf({ state: 'on', devices: [airpods] }, 'AAAA')).toBe('missing');
  expect(linkOf({ state: 'off', devices: [] }, 'AAAA')).toBe('bluetoothOff');
  expect(linkOf({ state: 'unauthorized', devices: [] }, 'AAAA')).toBeUndefined();
  expect(linkOf({ state: 'on', devices: [shutter] }, undefined)).toBeUndefined();
  expect(linkOf(undefined, 'AAAA')).toBeUndefined();
  // Several known remotes: connected when any of them is.
  expect(linkOf({ state: 'on', devices: [shutter] }, ['OLD', 'AAAA'])).toBe('connected');
  expect(linkOf({ state: 'on', devices: [airpods] }, ['OLD', 'AAAA'])).toBe('missing');
  expect(linkOf({ state: 'on', devices: [shutter] }, [])).toBeUndefined();
  expect(connectedOf({ state: 'on', devices: [shutter, airpods] }, ['OLD', 'AAAA'])).toEqual(['AAAA']);
  expect(connectedOf({ state: 'off', devices: [] }, ['AAAA'])).toEqual([]);
});

test('the one remote kept before the list is read as a list of one', () => {
  expect(knownRemotes({ ...repo.getPrefs(), remoteBleId: 'AAAA', remoteBleName: 'AB Shutter3' })).toEqual([
    { id: 'AAAA', name: 'AB Shutter3' },
  ]);
  expect(knownRemotes(repo.getPrefs())).toEqual([]);
  // Used here before, never shown by iOS: the row of the remote heard only by its presses.
  expect(knownRemotes({ ...repo.getPrefs(), remoteTestedAt: 1 })).toEqual([{ id: HIDDEN_REMOTE }]);
});

test('at a press, the one connected remote is learnt (asking for Bluetooth then)', async () => {
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter, airpods] });
  await learnRemoteAtPress();
  expect(cam.bluetoothConnected).toHaveBeenCalledWith(true);
  expect(repo.getPrefs().remotes).toEqual([{ id: 'AAAA', name: 'AB Shutter3' }]);
});

test('two possible remotes on at the first press: both are listed (a press does not say which)', async () => {
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter, { ...shutter, id: 'CCCC' }, airpods] });
  await learnRemoteAtPress();
  expect(knownRemotes().map((r) => r.id)).toEqual(['AAAA', 'CCCC']);
});

test('a new remote joins the list and the old one stays (2026-11-22); with two on, nothing is guessed', async () => {
  repo.setPrefs({ remoteBleId: 'OLD' });
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  await learnRemoteAtPress();
  expect(knownRemotes()).toEqual([{ id: 'OLD' }, { id: 'AAAA', name: 'AB Shutter3' }]);
  expect(repo.getPrefs().remoteBleId).toBeUndefined();

  // The same remote again: nothing changes.
  await learnRemoteAtPress();
  expect(knownRemotes().map((r) => r.id)).toEqual(['OLD', 'AAAA']);

  // A second remote on beside a known one: the one new device is learnt, so both are listed and on together.
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter, { ...shutter, id: 'DDDD' }] });
  await learnRemoteAtPress();
  expect(knownRemotes().map((r) => r.id)).toEqual(['OLD', 'AAAA', 'DDDD']);

  // Two new ones at once: a press does not say which, so the list becomes the remotes on now.
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [{ ...shutter, id: 'E' }, { ...shutter, id: 'F' }] });
  await learnRemoteAtPress();
  expect(knownRemotes().map((r) => r.id)).toEqual(['E', 'F']);
});

test('several new remotes on beside an old one: the list becomes the remotes on now, the old one off is dropped', async () => {
  const selfie = { id: 'CCCC', name: 'Selfie Remote', services: ['hid'] };
  repo.setPrefs({ remotes: [{ id: 'OLD', name: 'Old' }] });
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter, selfie] });
  await learnRemoteAtPress();
  expect(knownRemotes()).toEqual([
    { id: 'AAAA', name: 'AB Shutter3' },
    { id: 'CCCC', name: 'Selfie Remote' },
  ]);
});

test('a remote forgotten while on comes back at the next press (the sheet goes straight to the list)', async () => {
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  await learnRemoteAtPress();
  forgetRemote('AAAA');
  expect(knownRemotes()).toEqual([]);
  await learnRemoteAtPress();
  expect(knownRemotes().map((r) => r.id)).toEqual(['AAAA']);
});

test('Esquecer takes one remote off the list, or all of them', () => {
  repo.setPrefs({ remotes: [{ id: 'OLD' }, { id: 'AAAA' }] });
  forgetRemote('OLD');
  expect(knownRemotes()).toEqual([{ id: 'AAAA' }]);
  forgetRemote();
  expect(knownRemotes()).toEqual([]);
});

test('no Bluetooth to ask (denied, unknown, failing): the press still gives the list its one row', async () => {
  for (const answer of [{ state: 'unauthorized', devices: [] }, undefined]) {
    forgetRemote();
    cam.bluetoothConnected.mockResolvedValue(answer);
    await learnRemoteAtPress();
    expect(knownRemotes()).toEqual([{ id: HIDDEN_REMOTE }]);
  }
  forgetRemote();
  cam.bluetoothConnected.mockRejectedValue(new Error('x'));
  await learnRemoteAtPress();
  expect(knownRemotes()).toEqual([{ id: HIDDEN_REMOTE }]);
});

test('a remote iOS hides from apps (the Selfie Remote): heard only by its presses, one row, never asked about', async () => {
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [airpods] });
  await learnRemoteAtPress();
  expect(knownRemotes()).toEqual([{ id: HIDDEN_REMOTE }]);
  expect(followedIds(knownRemotes())).toEqual([]);
  // Pressed again: still the one row.
  await learnRemoteAtPress();
  expect(knownRemotes()).toEqual([{ id: HIDDEN_REMOTE }]);
  // A remote iOS shows takes its place (the rows look the same).
  cam.bluetoothConnected.mockResolvedValue({ state: 'on', devices: [shutter] });
  await learnRemoteAtPress();
  expect(knownRemotes()).toEqual([{ id: 'AAAA', name: 'AB Shutter3' }]);
});
