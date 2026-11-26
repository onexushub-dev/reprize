import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { deleteAccount, signOut, useAccount, type Account, type DeleteResult } from '../account/account';
import { SignInButtons } from '../account/SignInButtons';
import { SHARING_ENABLED } from '../account/flags';
import { groupClips, shareGroup, type ShareGroup } from '../cloud/shareGroups';
import { useShareStatus } from '../cloud/shareStatus';
import { appVersion } from '../components/AboutLinks';
import { Button } from '../components/Button';
import { sessionLabel } from '../components/format';
import {
  AlertIcon,
  BackIcon,
  ChevronIcon,
  CheckIcon,
  FilmIcon,
  GiftIcon,
  InfoIcon,
  LockIcon,
  LogoutIcon,
  ShareIcon,
  UserIcon,
} from '../components/icons';
import { hoursLeft } from '../components/shareTime';
import { SheetTitle } from '../components/SheetTitle';
import { repo } from '../data/mmkv';
import { restartCameraTour } from '../onboarding/cameraTour';
import type { Session, SessionShare } from '../data/schema';
import { useT } from '../i18n/useT';
import { openPaywall } from '../payments/feedback';
import { useProActive } from '../share/entitlement';
import { colors, fonts, radius } from '../theme/tokens';
import { GlassButton } from '../components/GlassButton';

type Busy = 'out' | 'delete';
type Translate = ReturnType<typeof useT>['t'];

const FAILED: Record<Busy, (t: Translate) => string> = {
  out: (t) => t('account.signOutFailed'),
  delete: (t) => t('account.deleteFailed'),
};

/** Where the store keeps the subscription, to manage or cancel it. */
const MANAGE_URL =
  Platform.OS === 'ios' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions';

/**
 * Ajustes, opened from the gear on the setup screen (2026-11-20): the account (sign in with Apple or Google, who is
 * signed in, sign out), the plan, the recordings being shared now, the legal pages and the version. Without sharing,
 * only the plan and the legal pages. The free unlock of a received recording is shown only where it is used, in the
 * sharing screens (2026-11-21).
 */
export default function SettingsScreen() {
  const { t } = useT();
  const { ready, account } = useAccount();
  const pro = useProActive();
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const version = appVersion();

  async function run(kind: Busy, action: () => Promise<DeleteResult | void>) {
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (result === 'deleted') setNotice(t('account.deleted'));
    } catch (e) {
      if (__DEV__) console.warn('[account]', e);
      setError(FAILED[kind](t));
    } finally {
      setBusy(null);
    }
  }

  function confirmSignOut() {
    Alert.alert(t('account.signOutTitle'), t('account.signOutBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('account.signOut'), style: 'destructive', onPress: () => void run('out', signOut) },
    ]);
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <GlassButton accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <BackIcon />
        </GlassButton>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {t('account.title')}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {SHARING_ENABLED ? (
          <Section label={t('account.sectionAccount')}>
            {!ready ? (
              <View style={styles.padded}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : account === null ? (
              <View style={styles.padded}>
                <View style={styles.intro}>
                  <Text style={styles.introTitle}>{t('account.noAccountTitle')}</Text>
                  <Text style={styles.body}>{t('account.noAccountBody')}</Text>
                </View>
                <Benefit icon={<ShareIcon size={18} color={colors.accent} />} title={t('account.benefitShare')} badge={t('setup.proBadge')}>
                  {t('account.benefitShareBody')}
                </Benefit>
                <Benefit icon={<GiftIcon size={18} color={colors.accent} />} title={t('account.benefitFree')}>
                  {t('account.benefitFreeBody')}
                </Benefit>
                <SignInButtons />
              </View>
            ) : (
              <Profile account={account} busy={busy === 'out'} onSignOut={confirmSignOut} />
            )}
          </Section>
        ) : null}

        <Section label={t('account.sectionPlan')}>
          {pro ? (
            <Row
              icon={<CheckIcon size={19} color={colors.text} />}
              label={t('account.planPro')}
              value={t('account.manage')}
              onPress={() => void Linking.openURL(MANAGE_URL)}
            />
          ) : (
            <View style={styles.padded}>
              <Text style={styles.rowLabel}>{t('account.planFree')}</Text>
              <Text style={styles.small}>{t('account.planFreeBody')}</Text>
              <Button label={t('sharing.subscribe')} onPress={() => void openPaywall(t, 'settings')} />
            </View>
          )}
        </Section>

        {SHARING_ENABLED && pro ? <SharingNow /> : null}

        {/* The camera's first-time tour again (2026-11-22): back on the camera, the tips start over. */}
        <Section label={t('account.sectionHelp')}>
          <Row
            icon={<InfoIcon size={18} color={colors.text} />}
            label={t('account.tutorial')}
            value={t('account.tutorialValue')}
            onPress={() => {
              restartCameraTour();
              router.back();
            }}
          />
        </Section>

        <Section label={t('account.sectionAbout')}>
          <Row icon={<FilmIcon size={19} />} label={t('about.terms')} onPress={() => void Linking.openURL(t('about.termsUrl'))} />
          <Separator />
          <Row icon={<LockIcon size={17} />} label={t('about.privacy')} onPress={() => void Linking.openURL(t('about.privacyUrl'))} />
        </Section>

        {SHARING_ENABLED && account !== null ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy !== null}
            hitSlop={8}
            style={styles.deleteRow}
            onPress={() => setDeleting(true)}
          >
            {busy === 'delete' ? <ActivityIndicator color={colors.rec} /> : null}
            <Text style={[styles.delete, busy !== null && styles.dimmed]}>
              {busy === 'delete' ? t('account.deleting') : t('account.delete')}
            </Text>
          </Pressable>
        ) : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {version ? (
          // Tapping the version opens the open-source licenses (kept out of sight on purpose; MODELS.md).
          <Text style={styles.version} onPress={() => router.push('/licenses')}>
            {t('about.version', { version })}
          </Text>
        ) : null}
      </ScrollView>
      <DeleteAccountSheet
        visible={deleting}
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeleting(false);
          void run('delete', deleteAccount);
        }}
      />
    </SafeAreaView>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

function Row({ icon, label, value, onPress }: { icon: ReactNode; label: string; value?: string; onPress?: () => void }) {
  const inner = (
    <>
      <View style={styles.rowIcon}>{icon}</View>
      <Text style={styles.rowLabel} numberOfLines={1}>
        {label}
      </Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <ChevronIcon size={17} color={colors.muted} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{inner}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} onPress={onPress} style={styles.row}>
      {inner}
    </Pressable>
  );
}

function Benefit({ icon, title, badge, children }: { icon: ReactNode; title: string; badge?: string; children: string }) {
  return (
    <View style={styles.benefit}>
      <View style={styles.benefitIcon}>{icon}</View>
      <View style={styles.benefitText}>
        <View style={styles.benefitHead}>
          <Text style={styles.benefitTitle}>{title}</Text>
          {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        </View>
        <Text style={styles.small}>{children}</Text>
      </View>
    </View>
  );
}

/** Who is signed in, with Sair as an icon on the same line (2026-11-20). */
function Profile({ account, busy, onSignOut }: { account: Account; busy: boolean; onSignOut: () => void }) {
  const { t } = useT();
  const shown = account.name ? account.name : account.email ? account.email : '';
  const provider = account.provider === 'apple' ? t('account.viaApple') : account.provider === 'google' ? t('account.viaGoogle') : '';
  const detail = [account.name && account.email ? account.email : undefined, provider || undefined]
    .filter((p): p is string => p !== undefined)
    .join(' · ');
  return (
    <View style={styles.profile}>
      <View style={styles.avatar}>
        {shown ? <Text style={styles.avatarText}>{shown.trim().charAt(0).toUpperCase()}</Text> : <UserIcon color={colors.onAccent} />}
      </View>
      <View style={styles.profileText}>
        {shown ? (
          <Text style={styles.name} numberOfLines={1}>
            {shown}
          </Text>
        ) : null}
        {detail ? (
          <Text style={styles.small} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      <GlassButton
        accessibilityRole="button"
        accessibilityLabel={t('account.signOutA11y')}
        disabled={busy}
        onPress={onSignOut}
        style={styles.signOut}
      >
        {busy ? <ActivityIndicator color={colors.soft} /> : <LogoutIcon color={colors.soft} size={19} />}
      </GlassButton>
    </View>
  );
}

/** The recordings this phone is sharing now: each opens its share sheet; a group link is one row (2026-11-22). */
function SharingNow() {
  const { t } = useT();
  const version = useSyncExternalStore(repo.subscribe, repo.version);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  const live = useMemo(
    () =>
      repo
        .listSessions()
        .map((g) => g.session)
        .filter(
          (s): s is Session & { shared: SessionShare } =>
            s.shared !== undefined && s.shared.state === 'active' && s.shared.expiresAt > now,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version is the change signal
    [version, now],
  );
  const rows: ({ kind: 'recording'; session: Session & { shared: SessionShare } } | { kind: 'group'; group: ShareGroup })[] = [];
  for (const session of live) {
    const groupId = session.shared.groupId;
    if (groupId === undefined) {
      rows.push({ kind: 'recording', session });
      continue;
    }
    if (rows.some((row) => row.kind === 'group' && row.group.groupId === groupId)) continue;
    const group = shareGroup(groupId);
    if (group !== undefined) rows.push({ kind: 'group', group });
  }
  if (rows.length === 0) return null;
  return (
    <Section label={t('account.sectionShares')}>
      {rows.map((row, i) => (
        <View key={row.kind === 'group' ? row.group.groupId : row.session.id}>
          {i > 0 ? <Separator /> : null}
          {row.kind === 'group' ? <GroupSharingRow group={row.group} now={now} /> : <SharingRow session={row.session} now={now} />}
        </View>
      ))}
    </Section>
  );
}

function GroupSharingRow({ group, now }: { group: ShareGroup; now: number }) {
  const { t } = useT();
  const status = useShareStatus(group.groupId, 60 * 1000);
  const hours = hoursLeft(group.expiresAt, now);
  const parts = [
    t('sharing.clips', { count: groupClips(group) }),
    status !== undefined && status.opened > 0 ? t('sharing.opened', { count: status.opened }) : undefined,
    hours >= 1 ? t('sharing.hoursLeftShort', { count: hours }) : t('sharing.lastHour'),
  ].filter((p): p is string => p !== undefined);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/share/group?group=${group.groupId}`)} style={styles.row}>
      <View style={styles.rowIcon}>
        <View style={styles.liveDot} />
      </View>
      <View style={styles.profileText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {t('sharing.groupLabel', { count: group.recordings.length })}
        </Text>
        <Text style={styles.small} numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
      </View>
      <ChevronIcon size={17} color={colors.muted} />
    </Pressable>
  );
}

function SharingRow({ session, now }: { session: Session & { shared: SessionShare }; now: number }) {
  const { t, locale } = useT();
  const status = useShareStatus(session.shared.shareId, 60 * 1000);
  const hours = hoursLeft(session.shared.expiresAt, now);
  const parts = [
    t('sharing.clips', { count: session.shared.clips }),
    status !== undefined && status.opened > 0 ? t('sharing.opened', { count: status.opened }) : undefined,
    hours >= 1 ? t('sharing.hoursLeftShort', { count: hours }) : t('sharing.lastHour'),
  ].filter((p): p is string => p !== undefined);
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/share/${session.id}`)} style={styles.row}>
      <View style={styles.rowIcon}>
        <View style={styles.liveDot} />
      </View>
      <View style={styles.profileText}>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {sessionLabel(session, undefined, locale)}
        </Text>
        <Text style={styles.small} numberOfLines={1}>
          {parts.join(' · ')}
        </Text>
      </View>
      <ChevronIcon size={17} color={colors.muted} />
    </Pressable>
  );
}

/** Excluir conta: what goes and what stays, before anything is erased. */
function DeleteAccountSheet({ visible, onCancel, onConfirm }: { visible: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { t } = useT();
  const points = ['account.deletePoint1', 'account.deletePoint2', 'account.deletePoint3', 'account.deletePoint4'] as const;
  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onCancel} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.backdrop}>
        <Pressable accessibilityLabel={t('common.cancel')} style={StyleSheet.absoluteFill} onPress={onCancel} />
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetHead}>
            <SheetTitle icon={<AlertIcon color={colors.rec} size={19} />} title={t('account.deleteTitle')} tone="danger" />
            <Text style={styles.undo}>{t('account.deleteUndo')}</Text>
          </View>
          <View style={styles.points}>
            {points.map((key) => (
              <View key={key} style={styles.point}>
                <View style={styles.pointDot} />
                <Text style={styles.pointText}>{t(key)}</Text>
              </View>
            ))}
          </View>
          <Button label={t('account.delete')} variant="danger" onPress={onConfirm} />
          <Button label={t('common.cancel')} variant="secondary" onPress={onCancel} />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 30, color: colors.text, textTransform: 'uppercase' },
  content: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 40, gap: 18 },
  section: { gap: 8 },
  sectionLabel: {
    paddingLeft: 4,
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 1.1,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  card: { borderRadius: radius.card, backgroundColor: colors.surface, overflow: 'hidden' },
  padded: { padding: 16, gap: 14 },
  intro: { gap: 4 },
  introTitle: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.soft },
  small: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 10 },
  rowIcon: { width: 20, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  rowValue: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 46, backgroundColor: colors.border },
  benefit: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,176,0,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, gap: 2 },
  benefitHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  benefitTitle: { flexShrink: 1, fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  badge: {
    fontFamily: fonts.bodyBold,
    fontSize: 10,
    color: colors.onAccent,
    backgroundColor: colors.accent,
    borderRadius: 8,
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.onAccent },
  profileText: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
  signOut: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  dimmed: { opacity: 0.5 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  delete: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.rec },
  error: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning, textAlign: 'center' },
  notice: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft, textAlign: 'center' },
  version: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, textAlign: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 16,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetHead: { gap: 4 },
  undo: { paddingLeft: 46, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  points: { gap: 10 },
  point: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pointDot: { width: 6, height: 6, borderRadius: 3, marginTop: 8, backgroundColor: colors.muted },
  pointText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft },
});
