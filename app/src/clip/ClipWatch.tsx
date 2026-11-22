import { type ComponentRef, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

import { BackIcon, DownloadIcon, EditIcon, ShareIcon, TrashIcon } from '../components/icons';
import { MAX_CLIP_NAME } from '../data/schema';
import { ProgressRing, TickIcon } from '../components/sportIcons';
import { useT } from '../i18n/useT';
import { colors, fonts, footer } from '../theme/tokens';
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
  /** While preparing: 0–100 when the phone sends it (Android); undefined = the spinner. */
  focusPercent?: number;
  onFocusTag: () => void;
  /** Bola's tag (Modo Foco: Bola), in the Jogadores tag's place at the top left. */
  ballTag?: ReactNode;
  notice?: string;
  /** The player: play/pause, where the clip is, drag to move through it. */
  progress: ReactNode;
  /** The recording's other clips, to slide or tap to (ClipStrip). */
  strip?: ReactNode;
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
  /** The controls are on screen; a tap on the video hides them, the next brings them back (like Photos). */
  chrome?: boolean;
};

const FADE_MS = 120;
/**
 * The phone's safe area, read once (the app is portrait only): SafeAreaView measured itself again on every clip a swipe
 * brought in, so the bars jumped by the home bar's height and cut the buttons for a moment (2026-11-21).
 */
const INSETS = initialWindowMetrics ? initialWindowMetrics.insets : { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Watch mode, after the Photos app (2026-11-20): the clip as large as the screen allows; on top, back, the name and
 * Apagar; at the bottom, the player (with its mute), the recording's other clips, and apart from them what you do with
 * this one: Editar, Salvar, Enviar. A tap on the video hides all of it.
 */
export function ClipWatch(p: Props) {
  const { t } = useT();
  const window = useWindowDimensions();
  const [bottom, setBottom] = useState(0);
  const shown = p.chrome !== false;
  const [fade] = useState(() => new Animated.Value(shown ? 1 : 0));
  const nameInput = useRef<ComponentRef<typeof TextInput>>(null);
  // A tap on the name puts the cursor after it, nothing selected, so typing adds to it (2026-11-21: the whole name was
  // selected and the first key replaced it). Released at once, so the cursor moves freely after.
  const [atEnd, setAtEnd] = useState<{ start: number; end: number }>();
  useEffect(() => {
    Animated.timing(fade, { toValue: shown ? 1 : 0, duration: FADE_MS, useNativeDriver: true }).start();
    // The controls going away take the name's focus (and the keyboard) with them.
    if (!shown && nameInput.current) nameInput.current.blur();
  }, [fade, shown]);
  const hidden = {
    pointerEvents: shown ? ('box-none' as const) : ('none' as const),
    accessibilityElementsHidden: !shown,
    importantForAccessibility: shown ? ('auto' as const) : ('no-hide-descendants' as const),
  };
  // Over the player while the controls are up; low on the screen when they are not.
  const above = shown ? bottom + 10 : 40;
  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill}>{p.renderStage({ width: window.width, height: window.height })}</View>
      {p.fast ? (
        // As in Instagram: what the held finger does, low on the screen, over the player (2026-11-20).
        <View pointerEvents="none" style={[styles.fastWrap, { bottom: above }]}>
          <Text style={styles.fast}>{t('clip.speedFast')}</Text>
        </View>
      ) : p.caption ? (
        <View pointerEvents="none" style={[styles.captionWrap, { bottom: above + 6 }]}>
          <Text accessibilityRole="alert" style={styles.caption}>
            {p.caption}
          </Text>
        </View>
      ) : null}

      <Animated.View {...hidden} style={[styles.top, { opacity: fade }]}>
        <View pointerEvents="box-none" style={[styles.topInner, { paddingTop: INSETS.top }]}>
          <View style={styles.topRow}>
            <IconButton label={t('common.back')} onPress={p.onBack}>
              <BackIcon />
            </IconButton>
            <TextInput
              ref={nameInput}
              accessibilityLabel={t('clip.name')}
              value={p.name}
              onChangeText={p.onChangeName}
              onSubmitEditing={p.onSaveName}
              onFocus={() => setAtEnd({ start: p.name.length, end: p.name.length })}
              onSelectionChange={() => (atEnd !== undefined ? setAtEnd(undefined) : undefined)}
              selection={atEnd}
              onBlur={p.onSaveName}
              placeholder={p.placeholder}
              placeholderTextColor={colors.soft}
              maxLength={MAX_CLIP_NAME}
              returnKeyType="done"
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
                  p.focusPercent !== undefined ? (
                    <ProgressRing progress={p.focusPercent / 100} size={20} />
                  ) : (
                    <ActivityIndicator size="small" color={colors.accent} />
                  )
                ) : p.focusTag === 'found' ? (
                  <TickIcon size={16} />
                ) : (
                  <View style={styles.dot} />
                )}
                <Text style={[styles.tagText, p.focusTag === 'found' ? styles.foundText : null]}>
                  {p.focusTag === 'preparing'
                    ? p.focusPercent !== undefined
                      ? t('clip.focusPreparingPercent', { percent: p.focusPercent })
                      : t('clip.focusPreparingTag')
                    : p.focusTag === 'found'
                    ? t('clip.focusFound')
                    : t('clip.focusPlayersTag')}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Animated.View>

      <Animated.View
        {...hidden}
        style={[styles.bottom, { opacity: fade }]}
        onLayout={(e) => setBottom(e.nativeEvent.layout.height)}>
        <View pointerEvents="box-none" style={[styles.bottomInner, { paddingBottom: INSETS.bottom + footer.bottom }]}>
          {p.notice ? <Text style={styles.notice}>{p.notice}</Text> : null}
          <View style={styles.player}>{p.progress}</View>
          {p.strip}
          {/* Apart from the player: what to do with this clip, Editar first (2026-11-20). */}
          <View style={styles.actions}>
            <Action label={t('clip.edit')} a11y={t('clip.edit')} icon={<EditIcon color={colors.onAccent} />} onPress={p.onEdit} primary />
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
              icon={<ShareIcon size={20} />}
              onPress={p.onShare}
              disabled={p.actionsDisabled}
              loading={p.sharing}
            />
          </View>
        </View>
      </Animated.View>
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
  // Transparent: the clip screen draws its own dark ground, which fades to show the grid when the clip is dragged down.
  root: { flex: 1 },
  top: { position: 'absolute', left: 0, right: 0, top: 0 },
  topInner: { paddingHorizontal: footer.side },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  name: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
    paddingHorizontal: 14,
    fontFamily: fonts.bodySemi,
    fontSize: 14,
    color: colors.text,
    textAlign: 'center',
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
  bottomInner: { paddingHorizontal: footer.side, gap: 10 },
  notice: {
    alignSelf: 'center',
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: colors.text,
    textAlign: 'center',
    backgroundColor: SCRIM,
    borderRadius: 12,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  // The player on its own pill, apart from the actions (like Photos).
  player: {
    borderRadius: 999,
    backgroundColor: SCRIM,
    borderWidth: 1,
    borderColor: EDGE,
    paddingLeft: 4,
    paddingRight: 6,
    paddingVertical: 4,
  },
  actions: { flexDirection: 'row', gap: 8 },
  action: {
    flex: 1,
    minHeight: 48,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: EDGE,
    backgroundColor: SCRIM,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  off: { opacity: 0.4 },
  actionText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  primaryText: { color: colors.onAccent },
  fastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  fast: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.text,
    backgroundColor: SCRIM,
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingVertical: 7,
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
