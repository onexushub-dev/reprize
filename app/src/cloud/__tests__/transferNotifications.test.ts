import { AppState, PermissionsAndroid, Platform } from 'react-native';

import { askTransferNotifications } from '../transferNotifications';

const POST = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;

function setPlatform(os: 'android' | 'ios', version: number) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}

let check: jest.SpyInstance;
let request: jest.SpyInstance;

beforeEach(() => {
  check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(false);
  request = jest.spyOn(PermissionsAndroid, 'request').mockResolvedValue(PermissionsAndroid.RESULTS.GRANTED);
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => 'active' });
  setPlatform('android', 34);
});

afterEach(() => jest.restoreAllMocks());

test('asks for the notification permission on Android 13+ when it is missing', async () => {
  await askTransferNotifications();
  expect(check).toHaveBeenCalledWith(POST);
  expect(request).toHaveBeenCalledWith(POST);
});

test('does not ask again when the permission is already granted', async () => {
  check.mockResolvedValue(true);
  await askTransferNotifications();
  expect(request).not.toHaveBeenCalled();
});

test('does not ask below Android 13, where notifications need no runtime permission', async () => {
  setPlatform('android', 32);
  await askTransferNotifications();
  expect(check).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});

test('does not ask on iOS', async () => {
  setPlatform('ios', 18);
  await askTransferNotifications();
  expect(request).not.toHaveBeenCalled();
});

test('does not ask while the app is in the background (uploads restarted at launch)', async () => {
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => 'background' });
  await askTransferNotifications();
  expect(request).not.toHaveBeenCalled();
});

test('a failing permission call never throws: the transfer goes on without a notification', async () => {
  check.mockRejectedValue(new Error('no activity'));
  await expect(askTransferNotifications()).resolves.toBeUndefined();
});
