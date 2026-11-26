/// <reference types="jest" />
jest.mock('expo', () => {
  const mockNative = {
    startSession: jest.fn(),
    stopSession: jest.fn(),
    saveClip: jest.fn(),
    setGestureEnabled: jest.fn(),
    addListener: jest.fn(),
    requestPermissions: jest.fn(),
    getWatchStatus: jest.fn(),
    watchSync: jest.fn(),
    watchSignal: jest.fn(),
    setVoiceEnabled: jest.fn(),
    isVoiceSupported: jest.fn(() => true),
  };
  return { requireNativeModule: () => mockNative, NativeModule: class {} };
});

import {
  cancelExport,
  concatVideos,
  getWatchStatus,
  getDeviceUpright,
  getZoomRange,
  isVoiceSupported,
  setZoom,
  shareFiles,
  isRemoteSupported,
  remoteControllerHost,
  remoteControllerPairWithCode,
  remoteControllerSave,
  remoteHostBeginPairing,
  remoteHostPeers,
  remoteHostRemove,
  remoteSignal,
  remoteSync,
  requestPermissions,
  saveClip,
  setVoiceEnabled,
  startSession,
  watchSetSaveAllowed,
  watchSignal,
  watchSync,
} from '../ReplayCamera';

const mockNative = jest.requireMock('expo').requireNativeModule();

beforeEach(() => jest.clearAllMocks());

test('saveClip forwards the trigger and resolves the native result', async () => {
  mockNative.saveClip.mockResolvedValue({ clipPath: '/clips/a.mp4', durationMs: 60000 });

  await expect(saveClip({ source: 'screen', at: 1 })).resolves.toEqual({
    clipPath: '/clips/a.mp4',
    durationMs: 60000,
  });
  expect(mockNative.saveClip).toHaveBeenCalledWith({ source: 'screen', at: 1 });
});

test('startSession rejects with LOW_STORAGE when native refuses for space', async () => {
  mockNative.startSession.mockRejectedValue(
    Object.assign(new Error('Not enough space'), { code: 'LOW_STORAGE' })
  );

  await expect(startSession({ lens: 'ultraWide', maxQuality: '1080p60' })).rejects.toMatchObject({
    code: 'LOW_STORAGE',
  });
  expect(mockNative.startSession).toHaveBeenCalledWith({ lens: 'ultraWide', maxQuality: '1080p60' });
});

test('requestPermissions resolves whether camera and microphone were granted', async () => {
  mockNative.requestPermissions.mockResolvedValue(false);

  await expect(requestPermissions()).resolves.toBe(false);
});

test('the watch calls pass plain values to native, with a missing start as null', () => {
  mockNative.getWatchStatus.mockReturnValue('ready');
  expect(getWatchStatus()).toBe('ready');
  watchSync({ recording: true, clipCount: 2, startedAt: 5 });
  expect(mockNative.watchSync).toHaveBeenLastCalledWith(true, 2, 5);
  watchSync({ recording: false, clipCount: 0 });
  expect(mockNative.watchSync).toHaveBeenLastCalledWith(false, 0, null);
  watchSignal(false);
  expect(mockNative.watchSignal).toHaveBeenCalledWith(false);
});

test('the watch is told whether its Save button works; an older native build without it ignores the call', () => {
  expect(() => watchSetSaveAllowed(false)).not.toThrow();
  mockNative.watchSetSaveAllowed = jest.fn();
  watchSetSaveAllowed(false);
  expect(mockNative.watchSetSaveAllowed).toHaveBeenLastCalledWith(false);
  watchSetSaveAllowed(true);
  expect(mockNative.watchSetSaveAllowed).toHaveBeenLastCalledWith(true);
  delete mockNative.watchSetSaveAllowed;
});

test('without the remote functions on native, the remote calls do nothing and nothing throws', () => {
  expect(isRemoteSupported()).toBe(false);
  expect(remoteHostBeginPairing()).toBeNull();
  expect(remoteHostPeers()).toEqual([]);
  expect(remoteControllerHost()).toBeNull();
  expect(() => {
    remoteControllerSave();
    remoteControllerPairWithCode('123456');
    remoteHostRemove('a');
    remoteSync({ recording: true, clipCount: 1 });
    remoteSignal(true);
  }).not.toThrow();
});

test('with the remote functions on native, the calls pass plain values through', () => {
  const remote = {
    remoteHostStart: jest.fn(),
    remoteHostBeginPairing: jest.fn(() => ({ url: 'reprize://pair?h=h1', code: '042517', expiresAt: 9, qrPath: '/qr.png' })),
    remoteHostPeers: jest.fn(() => [{ id: 'a', name: 'iPhone da Ana' }]),
    remoteHostRemove: jest.fn(),
    remoteSync: jest.fn(),
    remoteSignal: jest.fn(),
    remoteControllerHost: jest.fn(() => ({ id: 'h1', name: 'Quadra 1' })),
    remoteControllerPairWithCode: jest.fn(),
    remoteControllerSave: jest.fn(),
  };
  Object.assign(mockNative, remote);
  try {
    expect(isRemoteSupported()).toBe(true);
    expect(remoteHostBeginPairing()).toMatchObject({ code: '042517', qrPath: '/qr.png' });
    expect(remoteHostPeers()).toEqual([{ id: 'a', name: 'iPhone da Ana' }]);
    expect(remoteControllerHost()).toEqual({ id: 'h1', name: 'Quadra 1' });
    remoteHostRemove('a');
    expect(remote.remoteHostRemove).toHaveBeenCalledWith('a');
    remoteControllerPairWithCode('042517');
    expect(remote.remoteControllerPairWithCode).toHaveBeenCalledWith('042517');
    remoteControllerSave();
    expect(remote.remoteControllerSave).toHaveBeenCalledTimes(1);
    remoteSync({ recording: true, clipCount: 2, startedAt: 5 });
    expect(remote.remoteSync).toHaveBeenLastCalledWith(true, 2, 5);
    remoteSync({ recording: false, clipCount: 0 });
    expect(remote.remoteSync).toHaveBeenLastCalledWith(false, 0, null);
    remoteSignal(false);
    expect(remote.remoteSignal).toHaveBeenCalledWith(false);
  } finally {
    Object.keys(remote).forEach((key) => delete mockNative[key]);
  }
});

test('setVoiceEnabled passes the language the recognizer listens in', () => {
  setVoiceEnabled(true, 'en-US');
  expect(mockNative.setVoiceEnabled).toHaveBeenCalledWith(true, 'en-US');
  setVoiceEnabled(false, 'pt-BR');
  expect(mockNative.setVoiceEnabled).toHaveBeenLastCalledWith(false, 'pt-BR');
});

test('isVoiceSupported asks about the language in use', () => {
  expect(isVoiceSupported('en-US')).toBe(true);
  expect(mockNative.isVoiceSupported).toHaveBeenCalledWith('en-US');
});

test('without native zoom (Android, older builds) the range is the two fixed lenses and setZoom does nothing', () => {
  expect(getZoomRange()).toEqual({ min: 0.5, max: 1, continuous: false });
  expect(() => setZoom(2, true)).not.toThrow();
});

test('with native zoom the range and the zoom calls go to native', () => {
  mockNative.getZoomRange = jest.fn(() => ({ min: 0.5, max: 5, continuous: true }));
  mockNative.setZoom = jest.fn();
  expect(getZoomRange()).toEqual({ min: 0.5, max: 5, continuous: true });
  setZoom(2, true);
  expect(mockNative.setZoom).toHaveBeenCalledWith(2, true);
  setZoom(1.5);
  expect(mockNative.setZoom).toHaveBeenLastCalledWith(1.5, false);
  delete mockNative.getZoomRange;
  delete mockNative.setZoom;
});

test('the phone is held in portrait where native cannot tell, and native answers otherwise', () => {
  expect(getDeviceUpright()).toBe('portrait');
  mockNative.getUpright = jest.fn(() => 'landscapeLeft');
  try {
    expect(getDeviceUpright()).toBe('landscapeLeft');
  } finally {
    delete mockNative.getUpright;
  }
});

test('shareFiles hands the plain paths to native and resolves how the sheet ended', async () => {
  mockNative.shareFiles = jest.fn().mockResolvedValue('shared');
  try {
    await expect(shareFiles(['/exports/a.mp4', '/exports/b.mp4'])).resolves.toBe('shared');
    expect(mockNative.shareFiles).toHaveBeenCalledWith(['/exports/a.mp4', '/exports/b.mp4']);
  } finally {
    delete mockNative.shareFiles;
  }
});

test('concatVideos hands the paths and the destination to native and resolves the joined video', async () => {
  mockNative.concatVideos = jest.fn().mockResolvedValue({ path: '/exports/all.mp4', durationMs: 90000 });
  try {
    await expect(concatVideos(['/exports/a.mp4', '/exports/b.mp4'], '/exports/all.mp4')).resolves.toEqual({
      path: '/exports/all.mp4',
      durationMs: 90000,
    });
    expect(mockNative.concatVideos).toHaveBeenCalledWith(['/exports/a.mp4', '/exports/b.mp4'], '/exports/all.mp4');
  } finally {
    delete mockNative.concatVideos;
  }
});

test('cancelExport asks the native side to stop that export (2026-11-23)', () => {
  mockNative.cancelExport = jest.fn();
  cancelExport('e1');
  expect(mockNative.cancelExport).toHaveBeenCalledWith('e1');
});

test('cancelExport does nothing on a build without it', () => {
  delete mockNative.cancelExport;
  expect(() => cancelExport('e1')).not.toThrow();
});
