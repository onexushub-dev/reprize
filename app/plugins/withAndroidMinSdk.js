/**
 * Android 8 (API 26) as the lowest version: ML Kit's on-device speech recognition (the voice command) requires it.
 * The voice command itself only runs from Android 12; on 8 to 11 it is not offered.
 */
const { withGradleProperties } = require('expo/config-plugins');

const MIN_SDK = '26';

module.exports = function withAndroidMinSdk(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === 'android.minSdkVersion'));
    cfg.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: MIN_SDK });
    return cfg;
  });
};
