import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';
import { ChevronIcon, PhoneIcon, QrIcon } from './icons';
import { panelColors, SetupPanel } from './SetupPanel';

type Props = {
  title: string;
  /** This phone can be the camera other phones connect to (it hosts the link). */
  canHost: boolean;
  /** Under "Conectar outro celular": how many phones are linked now (undefined when none). */
  linkedStatus?: string;
  /** Under "Usar este celular como controle": the camera this phone is paired with (undefined when none). */
  pairedStatus?: string;
  /** Where it sits (see SetupPanel). */
  place: ViewStyle;
  onConnect: () => void;
  onUseAsRemote: () => void;
  onDisconnect: () => void;
  /** The ✕: back to the triggers. */
  onDone: () => void;
};

/**
 * "Celular" (2026-11-22): another phone as a remote, opened from its circle among the triggers. The two ways round as
 * two cards, each saying what this phone does and, once linked, its status in green; "Desconectar deste celular" under
 * the second one while this phone is someone's remote.
 */
export function PhoneRemotePanel({ title, canHost, linkedStatus, pairedStatus, place, onConnect, onUseAsRemote, onDisconnect, onDone }: Props) {
  const { t } = useT();
  return (
    <SetupPanel testID="phone-panel" title={title} onClose={onDone} place={place}>
      <Text style={styles.intro}>{t('setup.phoneIntro')}</Text>
      <View style={styles.cards}>
        {canHost ? (
          <RoleCard
            icon={(color) => <QrIcon size={22} color={color} />}
            title={t('setup.phoneHostTitle')}
            body={t('setup.phoneHostBody')}
            status={linkedStatus}
            onPress={onConnect}
          />
        ) : null}
        <RoleCard
          icon={(color) => <PhoneIcon size={22} color={color} />}
          title={t('setup.useAsRemote')}
          body={t('setup.phoneControlBody')}
          status={pairedStatus}
          onPress={onUseAsRemote}
        />
      </View>
      {pairedStatus !== undefined ? (
        <Pressable accessibilityRole="button" accessibilityLabel={t('setup.disconnectThisPhone')} hitSlop={8} onPress={onDisconnect} style={styles.disconnect}>
          <Text style={styles.disconnectText}>{t('setup.disconnectThisPhone')}</Text>
        </Pressable>
      ) : null}
    </SetupPanel>
  );
}

function RoleCard({
  icon,
  title,
  body,
  status,
  onPress,
}: {
  icon: (color: string) => ReactNode;
  title: string;
  body: string;
  status?: string;
  onPress: () => void;
}) {
  const linked = status !== undefined;
  const label = [title, body, status].filter((part) => part !== undefined).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: linked }}
      onPress={onPress}
      style={[styles.card, linked && styles.cardLinked]}>
      <View style={[styles.badge, linked && styles.badgeLinked]}>{icon(linked ? colors.onAccent : colors.text)}</View>
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        {linked ? (
          <View style={styles.statusRow}>
            <View style={styles.okDot} />
            <Text numberOfLines={1} style={styles.status}>
              {status}
            </Text>
          </View>
        ) : null}
      </View>
      <ChevronIcon size={18} color={colors.muted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  intro: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  cards: { gap: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: panelColors.OPTION,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardLinked: { borderColor: colors.accent },
  badge: { width: 44, height: 44, borderRadius: 22, backgroundColor: panelColors.GROUP, alignItems: 'center', justifyContent: 'center' },
  badgeLinked: { backgroundColor: colors.accent },
  texts: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bodyBold, fontSize: 15.5, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  okDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: panelColors.OK },
  status: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: panelColors.OK },
  disconnect: { alignSelf: 'center', minHeight: 28, justifyContent: 'center' },
  disconnectText: { fontFamily: fonts.bodySemi, fontSize: 13.5, color: colors.muted, textDecorationLine: 'underline' },
});
