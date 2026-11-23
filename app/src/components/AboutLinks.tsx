import * as Application from 'expo-application';
import { router } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { SHARING_ENABLED } from '../account/flags';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';

/** "1.0 (6)": the store version and build of this install; empty when unknown (tests, web). */
export function appVersion(): string {
  const name = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;
  if (!name) return "";
  return build ? `${name} (${build})` : name;
}

/** The referral code entry, then the legal pages (required in the app besides the paywall) and the version, for support. Quiet lines. */
export function AboutLinks() {
  const { t } = useT();
  const version = appVersion();
  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="link"
        hitSlop={8}
        onPress={() => router.push("/partner")}
      >
        <Text style={styles.link}>{t("partner.link")}</Text>
      </Pressable>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void Linking.openURL(t("about.termsUrl"))}
        >
          <Text style={styles.link}>{t("about.terms")}</Text>
        </Pressable>
        <Text style={styles.dot}>·</Text>
        <Pressable
          accessibilityRole="link"
          hitSlop={8}
          onPress={() => void Linking.openURL(t("about.privacyUrl"))}
        >
          <Text style={styles.link}>{t("about.privacy")}</Text>
        </Pressable>
        {SHARING_ENABLED ? (
          <>
            <Text style={styles.dot}>·</Text>
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() => router.push("/account")}
            >
              <Text style={styles.link}>{t("account.link")}</Text>
            </Pressable>
          </>
        ) : null}
        {version ? (
          <>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.dot}>{t("about.version", { version })}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: "center", gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  link: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.soft },
  dot: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
});
