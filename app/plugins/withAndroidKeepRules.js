/**
 * Keep rules for the Android release build (R8). Without them R8 drops constructors that libraries only reach through
 * reflection, and the release app closes on launch:
 *   - WorkManager builds its Room database (`WorkDatabase_Impl`) by name;
 *   - ML Kit (pose detection) creates its component registrars by name.
 * Appended to android/app/proguard-rules.pro at prebuild, once.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MARKER = '# reprize: keep rules (withAndroidKeepRules)';
const RULES = `
${MARKER}
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.** { *; }
-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }
-keep class com.google.mlkit.** { <init>(...); }
-keep class com.google.android.gms.internal.mlkit_vision_** { *; }
`;

module.exports = function withAndroidKeepRules(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes(MARKER)) fs.writeFileSync(file, current + RULES);
      return cfg;
    },
  ]);
};
