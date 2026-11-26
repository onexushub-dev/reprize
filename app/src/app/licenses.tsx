import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GlassButton } from '../components/GlassButton';
import { BackIcon } from '../components/icons';
import { useT } from '../i18n/useT';
import { APACHE_2_0, VOICE_MODEL_NOTICES } from '../legal/notices';
import { THIRD_PARTY } from '../legal/thirdParty';
import { colors, fonts } from '../theme/tokens';

type Entry = { key: string; name: string; detail: string; text: string | null };

/**
 * Open-source licenses (docs/voice-lab/MODELS.md: the voice model's Apache-2.0 notice must ship with the app), reached
 * only by tapping the version line at the bottom of Conta. Each entry opens its license text on tap.
 */
export default function LicensesScreen() {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);

  const voice: Entry[] = VOICE_MODEL_NOTICES.map((n) => ({
    key: `voice:${n.name}`,
    name: n.name,
    detail: n.license,
    text: `${n.text}\n\n${APACHE_2_0}`,
  }));
  const packages: Entry[] = THIRD_PARTY.map((p) => ({
    key: `npm:${p.name}`,
    name: p.name,
    detail: `${p.license} · ${p.version}`,
    text: p.text,
  }));

  const renderEntry = (e: Entry) => {
    const expanded = open === e.key;
    return (
      <Pressable
        key={e.key}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setOpen(expanded ? null : e.key)}
        style={styles.entry}
      >
        <Text style={styles.name}>{e.name}</Text>
        <Text style={styles.detail}>{e.detail}</Text>
        {expanded ? <Text style={styles.text}>{e.text !== null ? e.text : t('licenses.noText')}</Text> : null}
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <GlassButton accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <BackIcon />
        </GlassButton>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {t('licenses.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>{t('licenses.intro')}</Text>
        <Text style={styles.section}>{t('licenses.sectionVoice')}</Text>
        {voice.map(renderEntry)}
        <Text style={styles.section}>{t('licenses.sectionPackages')}</Text>
        {packages.map(renderEntry)}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 30, color: colors.text, textTransform: 'uppercase' },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 10 },
  intro: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  section: {
    marginTop: 12,
    paddingLeft: 4,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  entry: { paddingVertical: 10, paddingHorizontal: 4, gap: 2 },
  name: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  text: { marginTop: 8, fontFamily: fonts.body, fontSize: 11, lineHeight: 16, color: colors.muted },
});
