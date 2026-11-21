import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts, radius } from '../theme/tokens';
import { Button } from './Button';
import { DownloadIcon, FilmIcon, LockIcon, ShareIcon, TagIcon, TrashIcon } from './icons';

type Props = {
  count: number;
  /** Compilar is a paid feature: on the free plan it shows "Pro" and opens the paywall. */
  paid: boolean;
  busy: boolean;
  onShare: () => void;
  onSave: () => void;
  onCompile: () => void;
  /** Etiqueta: one label for every picked clip. */
  onLabel: () => void;
  onDelete: () => void;
};

/** Actions for the clips picked on the recording screen: Enviar alone on top, the other four visible below. */
export function SelectionBar({ count, paid, busy, onShare, onSave, onCompile, onLabel, onDelete }: Props) {
  const { t } = useT();
  const blocked = count === 0 || busy;
  return (
    <View style={styles.card}>
      <Button
        label={t('summary.share', { count })}
        icon={<ShareIcon color={colors.onAccent} size={22} />}
        disabled={blocked}
        onPress={onShare}
      />
      <View style={styles.row}>
        <Action label={t('summary.save', { count })} text={t('clip.save')} disabled={blocked} onPress={onSave} icon={<DownloadIcon size={20} />} />
        <Action
          label={t('summary.compile')}
          text={t('summary.compile')}
          hint={paid ? undefined : t('summary.compileLocked')}
          badge={paid ? undefined : t('summary.proBadge')}
          disabled={blocked}
          onPress={onCompile}
          icon={paid ? <FilmIcon size={20} /> : <LockIcon size={14} color={colors.muted} />}
        />
        <Action
          label={t('summary.label')}
          text={t('summary.label')}
          disabled={blocked}
          onPress={onLabel}
          icon={<TagIcon size={20} />}
        />
        <Action
          label={count === 0 ? t('common.delete') : t('summary.deleteClips', { count })}
          text={t('common.delete')}
          danger
          disabled={blocked}
          onPress={onDelete}
          icon={<TrashIcon size={20} color={colors.rec} />}
        />
      </View>
    </View>
  );
}

type ActionProps = {
  label: string;
  text: string;
  icon: ReactNode;
  onPress: () => void;
  disabled: boolean;
  danger?: boolean;
  hint?: string;
  badge?: string;
};

function Action({ label, text, icon, onPress, disabled, danger = false, hint, badge }: ActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, (pressed || disabled) && { opacity: disabled ? 0.4 : 0.85 }]}>
      {icon}
      <Text numberOfLines={1} style={[styles.actionText, danger && { color: colors.rec }]}>
        {text}
      </Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    padding: 10,
    borderRadius: radius.sheet,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  row: { flexDirection: 'row', gap: 6 },
  action: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.button,
  },
  actionText: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 13, color: colors.text },
  badge: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    color: colors.onAccent,
    backgroundColor: colors.accent,
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
});
