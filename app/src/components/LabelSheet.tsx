import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MAX_CLIP_NAME } from '../data/schema';
import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Chip } from './Chip';

type Props = {
  visible: boolean;
  /** The clip's label now ('' when it has none). */
  initial: string;
  /** Labels already used in this recording, newest first: one tap gives the clip that label. */
  suggestions: string[];
  /** The label to keep ('' removes it). Closing the sheet keeps what was typed. */
  onDone: (label: string) => void;
};

/** A clip's label from the recording's list (2026-11-07 spec §6): type it, or tap one already used in the recording. */
export function LabelSheet({ visible, initial, suggestions, onDone }: Props) {
  const { t } = useT();
  // Given a `key` per clip by the screen, so each clip opens with its own label.
  const [text, setText] = useState(initial);
  const others = suggestions.filter((s) => s !== initial.trim());

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={() => onDone(text)}
      supportedOrientations={['portrait', 'landscape']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable accessibilityLabel={t('summary.labelDone')} style={StyleSheet.absoluteFill} onPress={() => onDone(text)} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <Text accessibilityRole="header" style={styles.title}>
            {t('summary.labelTitle')}
          </Text>
          <Text style={styles.hint}>{t('summary.labelHint')}</Text>
          <View style={styles.inputRow}>
            <TextInput
              accessibilityLabel={t('summary.labelTitle')}
              value={text}
              onChangeText={setText}
              placeholder={t('summary.labelPlaceholder')}
              placeholderTextColor={colors.muted}
              maxLength={MAX_CLIP_NAME}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => onDone(text)}
              style={styles.input}
            />
            <Text style={styles.count}>{`${text.length}/${MAX_CLIP_NAME}`}</Text>
          </View>
          {others.length > 0 ? (
            <View style={styles.used}>
              <Text style={styles.usedTitle}>{t('summary.labelUsed')}</Text>
              <View style={styles.chips}>
                {others.map((label) => (
                  <Chip key={label} label={label} onPress={() => onDone(label)} />
                ))}
              </View>
            </View>
          ) : null}
          <View style={styles.actions}>
            {initial.length > 0 ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => onDone('')} style={styles.secondary}>
                <Text style={styles.secondaryText}>{t('summary.labelRemove')}</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable accessibilityRole="button" onPress={() => onDone(text)} style={styles.done}>
              <Text style={styles.doneText}>{t('summary.labelDone')}</Text>
            </Pressable>
          </View>
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
    gap: 14,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.text, marginTop: 6 },
  hint: { fontFamily: fonts.body, fontSize: 14, color: colors.soft, marginTop: -6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.ground,
  },
  input: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text, paddingVertical: 12 },
  count: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  used: { gap: 8 },
  usedTitle: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.soft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  secondary: { minHeight: 44, justifyContent: 'center' },
  secondaryText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft },
  done: {
    minHeight: 44,
    minWidth: 96,
    paddingHorizontal: 20,
    borderRadius: radius.chip,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.onAccent },
});
