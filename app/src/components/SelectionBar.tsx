import type { ReactNode } from 'react';
import { ActionSheetIOS, Alert, Platform, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { LinkShareIcon, MoreIcon, ShareIcon, TrashIcon } from './icons';
import { GlassButton } from './GlassButton';

type Props = {
  count: number;
  /** Compilar is a paid feature: on the free plan it says "PRO" and opens the paywall. */
  paid: boolean;
  busy: boolean;
  /** Compartilhar by link (picked-clips link, 2026-11-23): first on the left; absent where this recording cannot be shared. */
  onLink?: () => void;
  onShare: () => void;
  onSave: () => void;
  onCompile: () => void;
  /** Etiqueta: one label for every picked clip. */
  onLabel: () => void;
  onDelete: () => void;
};

/**
 * Actions for the clips picked on the recording screen, as in the iPhone's Photos (2026-11-22): one line of icons,
 * Enviar on the left, how many are picked in the middle, Apagar and "…" (Salvar, Compilar, Etiqueta) on the right, all
 * in the app's amber.
 */
export function SelectionBar({ count, paid, busy, onLink, onShare, onSave, onCompile, onLabel, onDelete }: Props) {
  const { t } = useT();
  const blocked = count === 0 || busy;

  function openMore() {
    const options = [
      { text: t('clip.save'), run: onSave },
      { text: paid ? t('summary.compile') : `${t('summary.compile')} (${t('summary.proBadge')})`, run: onCompile },
      { text: t('summary.label'), run: onLabel },
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options.map((o) => o.text), t('common.cancel')],
          cancelButtonIndex: options.length,
          userInterfaceStyle: 'dark',
        },
        (index) => {
          if (index < options.length) options[index].run();
        },
      );
      return;
    }
    Alert.alert(t('summary.more'), undefined, [
      ...options.map((o) => ({ text: o.text, onPress: o.run })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  }

  return (
    <PickBar
      text={count === 0 ? t('summary.tapClips') : t('summary.selectedClips', { count })}
      left={[
        ...(onLink !== undefined
          ? [{ label: t('summary.shareLink', { count }), disabled: blocked, onPress: onLink, icon: <LinkShareIcon size={26} color={colors.accent} /> }]
          : []),
        { label: t('summary.share', { count }), disabled: blocked, onPress: onShare, icon: <ShareIcon size={26} color={colors.accent} /> },
      ]}
      right={[
        {
          label: count === 0 ? t('common.delete') : t('summary.deleteClips', { count }),
          disabled: blocked,
          onPress: onDelete,
          icon: <TrashIcon size={26} color={colors.accent} />,
        },
        {
          label: t('summary.more'),
          hint: paid ? undefined : t('summary.compileLocked'),
          disabled: blocked,
          onPress: openMore,
          icon: <MoreIcon size={22} color={colors.accent} />,
        },
      ]}
    />
  );
}

export type PickAction = { label: string; hint?: string; disabled: boolean; onPress: () => void; icon: ReactNode };

/**
 * The bar of a selection, as in the iPhone's Photos (2026-11-22): icons on the left and on the right, how many are
 * picked in the middle, all in the app's amber. The recording's clips and Minhas gravações share it.
 */
export function PickBar({ text, left, right }: { text: string; left: PickAction[]; right: PickAction[] }) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {left.map((a) => (
          <Action key={a.label} label={a.label} hint={a.hint} disabled={a.disabled} onPress={a.onPress}>
            {a.icon}
          </Action>
        ))}
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={styles.count}>
        {text}
      </Text>
      <View style={[styles.side, styles.sideEnd]}>
        {right.map((a) => (
          <Action key={a.label} label={a.label} hint={a.hint} disabled={a.disabled} onPress={a.onPress}>
            {a.icon}
          </Action>
        ))}
      </View>
    </View>
  );
}

type ActionProps = { label: string; hint?: string; disabled: boolean; onPress: () => void; children: ReactNode };

/** A round glass button, as the iPhone's Photos bar (2026-11-22), with its press feedback (`GlassButton`). */
function Action({ label, hint, disabled, onPress, children }: ActionProps) {
  return (
    <GlassButton
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={[styles.action, disabled && styles.actionOff]}>
      {children}
    </GlassButton>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 8 },
  side: { flexDirection: 'row', alignItems: 'center', gap: 8, width: 104 },
  sideEnd: { justifyContent: 'flex-end' },
  action: { width: 48, height: 48, borderRadius: 24 },
  actionOff: { opacity: 0.35 },
  count: { flex: 1, fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text, textAlign: 'center' },
});
