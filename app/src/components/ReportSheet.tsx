import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { track } from '../analytics';
import { REPORT_CATEGORIES, type ReportCategory, reportShare } from '../cloud/report';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';

type Props = {
  /** The received link's code; null keeps the sheet closed. */
  code: string | null;
  onClose: () => void;
};

const LABELS = {
  not_authorized: 'report.notAuthorized',
  minor: 'report.minor',
  inappropriate: 'report.inappropriate',
  other: 'report.other',
} as const;

/**
 * Denunciar on a received recording (sharing design §8.3): a reason, an optional text, and the link goes down at once
 * until it is reviewed. The copy already on this phone stays (the person can delete it as any recording).
 */
export function ReportSheet({ code, onClose }: Props) {
  const { t } = useT();
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [details, setDetails] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'too_many' | 'error'>('idle');

  function close() {
    onClose();
    setCategory(null);
    setDetails('');
    setState('idle');
  }

  async function send() {
    if (code === null || category === null) return;
    setState('sending');
    const result = await reportShare(code, category, details);
    if (result === 'ok') track('share_reported', { category });
    setState(result === 'ok' ? 'sent' : result);
  }

  const sending = state === 'sending';
  return (
    <Modal transparent animationType="slide" visible={code !== null} onRequestClose={close} supportedOrientations={['portrait', 'landscape']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={close} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          {state === 'sent' ? (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {t('report.sentTitle')}
              </Text>
              <Text style={styles.text}>{t('report.sentBody')}</Text>
              <Button label={t('common.close')} onPress={close} />
            </>
          ) : (
            <>
              <Text accessibilityRole="header" style={styles.title}>
                {t('report.title')}
              </Text>
              <Text style={styles.text}>{t('report.why')}</Text>
              <View style={styles.list}>
                {REPORT_CATEGORIES.map((c) => (
                  <Pressable
                    key={c}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: category === c }}
                    onPress={() => setCategory(c)}
                    style={[styles.row, category === c && styles.rowOn]}>
                    <View style={[styles.dot, category === c && styles.dotOn]} />
                    <Text style={styles.rowText}>{t(LABELS[c])}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={details}
                onChangeText={setDetails}
                placeholder={t('report.details')}
                placeholderTextColor={colors.muted}
                maxLength={500}
                multiline
                style={styles.input}
              />
              <Button
                label={t('report.send')}
                loading={sending}
                disabled={sending || category === null}
                onPress={() => void send()}
              />
              <Text style={styles.note}>{t('report.note')}</Text>
              {state === 'too_many' ? <Text style={styles.problem}>{t('report.tooMany')}</Text> : null}
              {state === 'error' ? <Text style={styles.problem}>{t('report.failed')}</Text> : null}
              <Pressable accessibilityRole="button" hitSlop={8} onPress={close} style={styles.cancel}>
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </Pressable>
            </>
          )}
        </SafeAreaView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 12,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.text, marginTop: 6 },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.soft },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.ground },
  rowOn: { borderWidth: 1, borderColor: colors.accent },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.border },
  dotOn: { borderColor: colors.accent, backgroundColor: colors.accent },
  rowText: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  input: {
    minHeight: 72,
    padding: 12,
    borderRadius: 12,
    backgroundColor: colors.ground,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  note: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted },
  problem: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.warning },
  cancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
});
