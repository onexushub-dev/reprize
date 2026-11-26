import { Platform } from 'react-native';

import { isPlayUpdateAvailable } from '../../../modules/replay-camera';
import { hasStoreUpdate, storeUrl } from '../storeCheck';

jest.mock('../../../modules/replay-camera', () => ({ isPlayUpdateAvailable: jest.fn() }));
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.3', applicationId: 'app.reprize.mobile' }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ regionCode: 'BR' }] }));

const answer = (results: object[]) =>
  jest.fn(async () => ({ ok: true, json: async () => ({ resultCount: results.length, results }) }));

const setPlatform = (os: 'ios' | 'android', version: string | number = '26.0') => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
};

beforeEach(() => {
  jest.clearAllMocks();
  setPlatform('ios');
});

describe('iOS', () => {
  test('a newer App Store version is an update, looked up in the store of the device region', async () => {
    const fetchMock = answer([{ version: '1.0.4', minimumOsVersion: '16.0' }]);
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(hasStoreUpdate()).resolves.toBe(true);
    const url = (fetchMock.mock.calls as unknown as [string][])[0][0];
    expect(url).toContain('itunes.apple.com/lookup');
    expect(url).toContain('bundleId=app.reprize.mobile');
    expect(url).toContain('country=br');
  });

  test('the same version is no update', async () => {
    global.fetch = answer([{ version: '1.0.3' }]) as unknown as typeof fetch;
    await expect(hasStoreUpdate()).resolves.toBe(false);
  });

  test('a version this iPhone cannot install is not offered', async () => {
    setPlatform('ios', '16.0');
    global.fetch = answer([{ version: '1.0.4', minimumOsVersion: '17.0' }]) as unknown as typeof fetch;
    await expect(hasStoreUpdate()).resolves.toBe(false);
  });

  test('an app the store does not know (a development build) has no update', async () => {
    global.fetch = answer([]) as unknown as typeof fetch;
    await expect(hasStoreUpdate()).resolves.toBe(false);
  });

  test('no connection is no update', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(hasStoreUpdate()).resolves.toBe(false);
  });

  test('the button opens the app page in the App Store', () => {
    expect(storeUrl()).toBe('https://apps.apple.com/app/id6833159162');
  });
});

describe('Android', () => {
  beforeEach(() => setPlatform('android', 35));

  test('Google Play decides, and the App Store is not asked', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    jest.mocked(isPlayUpdateAvailable).mockResolvedValue(true);
    await expect(hasStoreUpdate()).resolves.toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('a failure in Google Play is no update', async () => {
    jest.mocked(isPlayUpdateAvailable).mockRejectedValue(new Error('not from Play'));
    await expect(hasStoreUpdate()).resolves.toBe(false);
  });

  test('the button opens the app page in Google Play', () => {
    expect(storeUrl()).toBe('https://play.google.com/store/apps/details?id=app.reprize.mobile');
  });
});
