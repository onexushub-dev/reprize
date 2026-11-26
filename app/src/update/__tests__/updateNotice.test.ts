import { AppState } from 'react-native';

type Notice = typeof import('../updateNotice');

const MINUTE = 60_000;
const mockStoreUpdate = jest.fn<Promise<boolean>, []>();
jest.mock('../storeCheck', () => ({ hasStoreUpdate: () => mockStoreUpdate() }));

let appState: (state: string) => void;
let now: number;
let notice: Notice;

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
const away = async (minutes: number) => {
  appState('background');
  now += minutes * MINUTE;
  appState('active');
  await settle();
};

beforeEach(() => {
  now = 1_000_000;
  mockStoreUpdate.mockReset().mockResolvedValue(true);
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appState = fn as (state: string) => void;
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  jest.isolateModules(() => {
    notice = require('../updateNotice');
  });
});

afterEach(() => jest.restoreAllMocks());

test('shows when the store has an update', async () => {
  notice.startUpdateNotice();
  await settle();
  expect(notice.isUpdateNoticeVisible()).toBe(true);
});

test('stays hidden without an update', async () => {
  mockStoreUpdate.mockResolvedValue(false);
  notice.startUpdateNotice();
  await settle();
  expect(notice.isUpdateNoticeVisible()).toBe(false);
});

test('closed, it stays closed after a quick trip out of the app', async () => {
  notice.startUpdateNotice();
  await settle();
  notice.dismissUpdateNotice();
  await away(29);
  expect(notice.isUpdateNoticeVisible()).toBe(false);
  expect(mockStoreUpdate).toHaveBeenCalledTimes(1);
});

test('closed, it comes back when the app is opened again after 30 minutes away', async () => {
  notice.startUpdateNotice();
  await settle();
  notice.dismissUpdateNotice();
  await away(30);
  expect(notice.isUpdateNoticeVisible()).toBe(true);
  expect(mockStoreUpdate).toHaveBeenCalledTimes(2);
});

test('closed, it comes back on a new start of the app (nothing is saved)', async () => {
  notice.startUpdateNotice();
  await settle();
  notice.dismissUpdateNotice();
  let next!: Notice;
  jest.isolateModules(() => {
    next = require('../updateNotice');
  });
  next.startUpdateNotice();
  await settle();
  expect(next.isUpdateNoticeVisible()).toBe(true);
});

test('once the app is up to date it goes away on the next check', async () => {
  notice.startUpdateNotice();
  await settle();
  mockStoreUpdate.mockResolvedValue(false);
  await away(30);
  expect(notice.isUpdateNoticeVisible()).toBe(false);
});

test('tells its subscribers when it changes', async () => {
  const listener = jest.fn();
  notice.subscribeUpdateNotice(listener);
  notice.startUpdateNotice();
  await settle();
  expect(listener).toHaveBeenCalledTimes(1);
  notice.dismissUpdateNotice();
  expect(listener).toHaveBeenCalledTimes(2);
});
