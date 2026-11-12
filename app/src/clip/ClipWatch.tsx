import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackIcon, DownloadIcon, EditIcon, ShareIcon, TrashIcon } from '../components/icons';
import { MAX_CLIP_NAME } from '../data/schema';
import { TickIcon } from '../components/sportIcons';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { EDGE, IconButton, SCRIM } from './IconButton';

type Props = {
  /** The video, laid out for the area it gets (the whole screen here). */
  renderStage: (area: { width: number; height: number }) => ReactNode;
  name: string;
  placeholder: string;
  onChangeName: (name: string) => void;
  onSaveName: () => void;
  onBack: () => void;
  onDelete: () => void;
  /** Jogadores on the clip: on, being tracked, or just found (spec 2026-11-11, P1). */
  focusTag: 'on' | 'preparing' | 'found' | undefined;
  onFocusTag: () => void;
  /** Bola's tag (Modo Foco: Bola), in the Jogadores tag's place at the top left. */
  ballTag?: ReactNode;
  notice?: string;
  position?: string;
  progress: ReactNode;
  onEdit: () => void;
  onSave: () => void;
  onShare: () => void;
  actionsDisabled: boolean;
  saving: boolean;
  sharing: boolean;
  /** The finger is held on the video: playing at 2x. */
  fast: boolean;
  /** The once-ever Modo Foco introduction. */
  caption?: string;
};

/** Watch mode: the clip as large as the screen allows, and only what you do after editing — Salvar, Enviar. */
export function ClipWatch(p: Props) {
  const { t } = useT();
  const window = useWindowDimensions();
  const [bottom, setBottom] = useState(0);
  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>{p.renderStage({ width: window.width, height: window.height })}</View>
      {p.fast ? (
        <View pointerEvents="none" style={styles.fastWrap}>
          <Text style={styles.fast}>2x</Text>
        </View>
      ) : null}
      {p.caption ? (
        <View pointerEvents="none" style={[styles.captionWrap, { bottom: bottom + 16 }]}>
          <Text accessibilityRole="alert" style={styles.caption}>
            {p.caption}
          </Text>
        </View>
      ) : null}

      <SafeAreaView edges={['top']} pointerEvents="box-none" style={styles.top}>
        <View style={styles.topRow}>
          <IconButton label={t('common.back')} onPress={p.onBack}>
            <BackIcon />
          </IconButton>
          <TextInput
            accessibilityLabel={t('clip.name')}
            value={p.name}
            onChangeText={p.onChangeName}
            onSubmitEditing={p.onSaveName}
            onBlur={p.onSaveName}
            placeholder={p.placeholder}
            placeholderTextColor={colors.soft}
            maxLength={MAX_CLIP_NAME}
            returnKeyType="done"
            selectTextOnFocus
            style={styles.name}
          />
          <IconButton label={t('clip.deleteClip')} onPress={p.onDelete}>
            <TrashIcon />
          </IconButton>
        </View>
        {p.ballTag ? (
          <View pointerEvents="box-none" style={styles.tagRow}>
            {p.ballTag}
          </View>
        ) : null}
        {p.focusTag ? (
          <View pointerEvents="box-none" style={styles.tagRow}>
            <Pressable accessibilityRole="button" accessibilityLabel={t('clip.focusMode')} onPress={p.onFocusTag} style={styles.tag}>
              {p.focusTag === 'preparing' ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : p.focusTag === 'found' ? (
                <TickIcon size={16} />
              ) : (
                <View style={styles.dot} />
              )}
              <Text style={[styles.tagText, p.focusTag === 'found' ? styles.foundText : null]}>
                {p.focusTag === 'preparing' ? t('clip.focusPreparingTag') : p.focusTag === 'found' ? t('clip.focusFound') : t('clip.focusPlayersTag')}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>

      <SafeAreaView
        edges={['bottom']}
        pointerEvents="box-none"
        style={styles.bottom}
        onLayout={(e) => setBottom(e.nativeEvent.layout.height)}>
        <View style={styles.panel}>
          {p.notice ? <Text style={styles.notice}>{p.notice}</Text> : null}
          {p.position ? <Text style={styles.position}>{p.position}</Text> : null}
          {p.progress}
          <View style={styles.actions}>
            <Action label={t('clip.edit')} a11y={t('clip.edit')} icon={<EditIcon />} onPress={p.onEdit} />
            <Action
              label={t('clip.save')}
              a11y={t('clip.saveToPhotos')}
              icon={<DownloadIcon size={20} />}
              onPress={p.onSave}
              disabled={p.actionsDisabled}
              loading={p.saving}
            />
            <Action
              label={t('clip.send')}
              a11y={t('clip.share')}
              icon={<ShareIcon size={20} color={colors.onAccent} />}
              onPress={p.onShare}
              disabled={p.actionsDisabled}
              loading={p.sharing}
              primary
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Action({
  label,
  a11y,
  icon,
  onPress,
  disabled,
  loading,
  primary,
}: {
  label: string;
  a11y: string;
  icon: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, primary ? styles.primary : null, disabled && !loading ? styles.off : null]}>
      {loading ? <ActivityIndicator color={primary ? colors.onAccent : colors.text} /> : icon}
      <Text style={[styles.actionText, primary ? styles.primaryText : null]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  foundText: { color: colors.accent },
  root: { flex: 1, backgroundColor: colors.ground },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  name: {
    flex: 1,
    minHeight: 42,
    borderRadius: 21,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
    paddingHorizontal: 14,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.text,
  },
  tagRow: { flexDirection: 'row', marginTop: 10 },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: SCRIM,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  panel: {
    marginHorizontal: 8,
    marginBottom: 8,
    padding: 12,
    gap: 12,
    borderRadius: 22,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
  },
  notice: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.text, textAlign: 'center' },
  position: { fontFamily: fonts.body, fontSize: 12, color: colors.text, opacity: 0.8, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  off: { opacity: 0.4 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  primaryText: { color: colors.onAccent },
  fastWrap: { position: 'absolute', top: '45%', left: 0, right: 0, alignItems: 'center' },
  fast: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: colors.text,
    backgroundColor: SCRIM,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  captionWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  caption: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.onAccent,
    backgroundColor: colors.accent,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
});
