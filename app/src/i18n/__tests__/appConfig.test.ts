import appJson from '../../../app.json';
import enStrings from '../../../locales/en.json';
import ptStrings from '../../../locales/pt-BR.json';
import { VOICE_WORD } from '../locale';

const PERMISSIONS = [
  'NSCameraUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSSpeechRecognitionUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSLocalNetworkUsageDescription',
  'NSBluetoothAlwaysUsageDescription',
] as const;

const expo = appJson.expo;
const infoPlist = expo.ios.infoPlist as Record<string, unknown>;

test('every iOS permission prompt exists in English and Portuguese', () => {
  expect(Object.keys(enStrings.ios).sort()).toEqual([...PERMISSIONS].sort());
  expect(Object.keys(ptStrings.ios).sort()).toEqual([...PERMISSIONS].sort());
  expect(expo.locales).toEqual({ en: './locales/en.json', 'pt-BR': './locales/pt-BR.json' });
});

test('the base Info.plist text is the English one, and iOS may mix localizations', () => {
  for (const key of PERMISSIONS) expect([key, infoPlist[key]]).toEqual([key, enStrings.ios[key]]);
  expect(infoPlist.CFBundleAllowMixedLocalizations).toBe(true);
});

test('the speech prompt names the words of its language', () => {
  expect(enStrings.ios.NSSpeechRecognitionUsageDescription).toContain(`"${VOICE_WORD.en}"`);
  expect(ptStrings.ios.NSSpeechRecognitionUsageDescription).toContain(`"${VOICE_WORD['pt-BR']}"`);
  expect(enStrings.ios.NSSpeechRecognitionUsageDescription).not.toContain('record');
  expect(ptStrings.ios.NSSpeechRecognitionUsageDescription).not.toContain('gravar');
});

test('the brand is Reprize in every prompt', () => {
  for (const key of PERMISSIONS) {
    expect(enStrings.ios[key]).toContain('Reprize');
    expect(ptStrings.ios[key]).toContain('Reprize');
  }
});

test('the app declares its two languages for per-app language settings', () => {
  const plugin = expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-localization') as [string, Record<string, unknown>];
  expect(plugin).toBeDefined();
  expect(plugin[1].supportedLocales).toEqual({ ios: ['en', 'pt-BR'], android: ['en', 'pt-BR'] });
  // Android changes the language without restarting the activity; the app re-reads it (useLocaleSync).
  expect(plugin[1].allowDynamicLocaleChangesAndroid).toBe(true);
});
