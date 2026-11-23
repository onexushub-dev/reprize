import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../components/Button';
import { CheckIcon, CloseIcon, InfoIcon, PlusIcon, RemoteIcon } from '../components/icons';
import { PulseRing } from '../components/PulseRing';
import { PanelAction } from '../components/SetupPanel';
import { StepList } from '../components/StepList';
import { clearLastLearn, type RemoteLinks, useRemoteLinks } from '../devices/bluetoothRemote';
import type { KnownRemote } from '../data/schema';
import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';
import { remoteDeviceView } from '../devices/remoteDevice';
import { useSession } from '../session/SessionContext';
import { setRemoteSheetOpen } from '../devices/remoteTest';
import { useRemoteTest } from '../devices/useRemoteTest';
import { useReduceMotion } from '../components/useReduceMotion';
import { useT } from '../i18n/useT';
import { colors, fonts, footer, radius } from '../theme/tokens';
import { GlassButton } from '../components/GlassButton';

/** After this long without a press the sheet adds what to check. */
const WAITED_LONG_MS = 15_000;

/** How long the sheet takes to rise from the bottom. */
const RISE_MS = 260;

type RowStatus = { text: string; on: boolean } | undefined;

/**
 * The Bluetooth remote's sheet. The first time: what to do to connect it, and proof when it works. Once the app knows
 * remotes (2026-11-22): the list of them, each with its own status, as there is no choosing one (any remote that is on
 * saves); "Adicionar outro controle" shows the steps again for a new one.
 */
export default function Devices() {
  const { t, locale } = useT();
  const { pressed: heard, testedBefore, forget, forgetOne } = useRemoteTest();
  const [waitedLong, setWaitedLong] = useState(false);
  // "Não funciona? Parear de novo": the steps for a remote used before, which may have been unpaired in Ajustes since.
  const [repairOpen, setRepairOpen] = useState(false);
  // Adding another remote: how many were known when it started (one more and the list comes back).
  const [addingFrom, setAddingFrom] = useState<number | undefined>(undefined);
  const screen = useWindowDimensions();
  // A sheet as tall as what it holds (2026-11-22), rising from the bottom like the app's other sheets.
  const reduceMotion = useReduceMotion();
  const [rise] = useState(() => new Animated.Value(screen.height));
  useEffect(() => {
    if (reduceMotion) {
      rise.setValue(0);
      return;
    }
    Animated.timing(rise, { toValue: 0, duration: RISE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [rise, reduceMotion]);

  // The remote presses "volume up". The setup screen under this sheet is the one listening (and keeps the camera and
  // the audio session as they were): two screens taking and handing back the volume buttons raced each other.
  useEffect(() => {
    setRemoteSheetOpen(true);
    return () => setRemoteSheetOpen(false);
  }, []);

  useEffect(() => {
    if (heard) return;
    const id = setTimeout(() => setWaitedLong(true), WAITED_LONG_MS);
    return () => {
      clearTimeout(id);
      setWaitedLong(false);
    };
  }, [heard]);

  // The remotes' links as iOS shows them, looked at while the sheet is open (BLE remotes the app has learnt).
  const links = useRemoteLinks(true);
  const { link, remotes } = links;
  // A press is still being matched to a device, the list about to show it: the sheet stays as it was before the press
  // (2026-11-22 field video: one frame of the "used before" layout flashed between the steps and the list, as the press
  // had already marked the remote used).
  const settling = heard && links.learning && remotes.length === 0;
  const pressed = heard && !settling;
  const usedBefore = testedBefore && !settling;
  // Presses are heard through the camera: right after the app opens, it may still be starting under this sheet.
  const cameraReady = useSession().state.camera === 'on';
  const view = remoteDeviceView({ pressed, testedBefore: usedBefore, waitedLong, link, cameraReady }, locale);
  const steps = [t('devices.step1'), t('devices.step2'), t('devices.step3')];
  const remembered = pressed || usedBefore;
  // A press while adding settles it (a new remote listed, or the list as it is now): back to the list.
  if (addingFrom !== undefined && (remotes.length > addingFrom || links.lastLearn !== undefined)) setAddingFrom(undefined);
  const listed = remotes.length > 0;
  const adding = listed && addingFrom !== undefined;
  // A press heard while iOS shows none of the listed remotes connected (one iOS hides from apps): the press proves a
  // remote works, and iOS cannot say which; the last one listed shows it (the player's choice, 2026-11-22).
  const heardId = pressed && links.connected.length === 0 && listed ? remotes[remotes.length - 1].id : undefined;

  const confirmForget = () =>
    Alert.alert(t('devices.forgetTitle'), t('devices.forgetHelp'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('remote.forget'), style: 'destructive', onPress: forget },
    ]);
  // Every row is just "Controle" (2026-11-22): iOS cannot say which remote was pressed, so the names it gives could sit
  // on the wrong row, and numbers only added words to read.
  const nameOf = (_remote: KnownRemote) => t('devices.remoteName');
  const confirmForgetOne = (remote: KnownRemote) =>
    Alert.alert(t('devices.forgetNamedTitle', { name: nameOf(remote) }), t('devices.forgetHelp'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('remote.forget'), style: 'destructive', onPress: () => forgetOne(remote.id) },
    ]);

  const waitingFor = (text: string) =>
    view.preparing ? (
      <View style={styles.waiting}>
        <ActivityIndicator color={colors.soft} />
        <Text style={styles.preparingText}>{t('devices.preparing')}</Text>
      </View>
    ) : (
      <View style={styles.waiting}>
        <PulseRing color={colors.accent} size={28} />
        <Text style={styles.waitingText}>{text}</Text>
      </View>
    );

  function renderList() {
    const connected = links.connected.length > 0 ? links.connected.length : heardId !== undefined ? 1 : 0;
    const note =
      link === 'bluetoothOff'
        ? t('devices.noteBluetoothOff')
        : connected >= 2
          ? t('devices.noteSeveral')
          : connected === 1
            ? t('devices.noteAny')
            : t('devices.noteAsleep');
    return (
      <>
        <Text accessibilityRole="header" style={styles.section}>
          {t('devices.yours')}
        </Text>
        <View style={styles.card}>
          {remotes.map((remote, i) => (
            <RemoteRow
              key={remote.id}
              name={nameOf(remote)}
              status={statusOf(remote.id, links, remote.id === heardId, t)}
              last={i === remotes.length - 1}
              forgetLabel={t('devices.forgetNamedA11y', { name: nameOf(remote) })}
              forgetText={t('remote.forget')}
              onForget={() => confirmForgetOne(remote)}
            />
          ))}
        </View>
        {connected === 0 && link !== 'bluetoothOff' ? waitingFor(t('devices.waitingAny')) : null}
        <Info text={note} />
        <PanelAction
          label={t('devices.add')}
          icon={<PlusIcon size={19} color={colors.accent} />}
          onPress={() => {
            clearLastLearn();
            setAddingFrom(remotes.length);
          }}
        />
        <Button label={t('devices.done')} onPress={() => router.back()} />
      </>
    );
  }

  function renderAdding() {
    return (
      <>
        <Text accessibilityRole="header" style={styles.section}>
          {t('devices.add')}
        </Text>
        <StepList steps={[t('devices.addStep1'), t('devices.step2'), t('devices.addStep3')]} />
        {waitingFor(t('devices.addWaiting'))}
        <Info text={t('devices.addNote')} />
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setAddingFrom(undefined)} style={styles.cancel}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
      </>
    );
  }

  /** No remote learnt yet (the first time, or a remote iOS does not show to apps): the steps and the proof. */
  function renderFirst() {
    return (
      <>
        {view.state === 'connected' ? (
          <View style={styles.done}>
            <View style={styles.doneBadge}>
              <CheckIcon size={56} />
            </View>
            <Text style={styles.success}>{t('devices.connected')}</Text>
          </View>
        ) : null}

        {view.showSteps || (view.stepsBehindRepair && repairOpen) ? <StepList steps={steps} /> : null}
        {view.stepsBehindRepair && !repairOpen ? (
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setRepairOpen(true)} style={styles.repair}>
            <Text style={styles.repairText}>{t('devices.repair')}</Text>
          </Pressable>
        ) : null}

        {view.preparing || view.showWaiting ? waitingFor(t('devices.waiting')) : null}

        {view.showNote ? <Text style={styles.note}>{view.note}</Text> : null}

        {remembered ? (
          <View style={styles.row}>
            <Text style={styles.rowName}>
              {t('devices.paired')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('devices.forgetA11y')}
              hitSlop={8}
              onPress={confirmForget}
              style={styles.forget}>
              <Text style={styles.forgetText}>{t('remote.forget')}</Text>
            </Pressable>
          </View>
        ) : null}

        <Button label={t('devices.done')} onPress={() => router.back()} />
      </>
    );
  }

  return (
    <View style={styles.backdrop}>
      {/* A tap above the sheet closes it, as on the app's other sheets. */}
      <Pressable testID="devices-backdrop" accessible={false} style={StyleSheet.absoluteFill} onPress={() => router.back()} />
      <Animated.View testID="devices-sheet" style={[styles.sheetWrap, { maxHeight: screen.height - 48, transform: [{ translateY: rise }] }]}>
        <SafeAreaView edges={['bottom']} style={styles.sheet}>
          <View style={styles.grabber} />
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} bounces={false} showsVerticalScrollIndicator={false}>
            <View style={styles.header}>
              <RemoteIcon color={colors.accent} size={28} />
              <Text style={styles.title}>{t('setup.bluetoothRemote')}</Text>
              {/* The ✕ of the camera's panels (2026-11-22): the same grey circle, top right. */}
              <GlassButton
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
                hitSlop={10}
                onPress={() => router.back()}
                style={styles.close}>
                <CloseIcon size={16} color="#D8D8D8" />
              </GlassButton>
            </View>

            {adding ? renderAdding() : listed ? renderList() : renderFirst()}

            {/* TEMP(diag-remote): link to the in-app diagnostic log, only in builds made with REPRIZE_DIAGNOSTICS=1. */}
            {DIAGNOSTICS_ENABLED ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/diag')} style={styles.diag}>
                <Text style={styles.diagText}>{t('devices.diagnostics')}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

/**
 * One remote's status in the list, in the words of the triggers panel's circle: Conectado (green) when iOS shows it, or
 * for the remote a press is credited to (`heard`); else the Bluetooth off, or "Em espera · aperte um botão". Nothing
 * before iOS was first asked.
 */
function statusOf(id: string, links: RemoteLinks, heard: boolean, t: ReturnType<typeof useT>['t']): RowStatus {
  if (links.connected.includes(id) || heard) return { text: t('devices.statusConnected'), on: true };
  if (!links.looked) return undefined;
  if (links.link === 'bluetoothOff') return { text: t('devices.statusBluetoothOff'), on: false };
  if (links.link === undefined) return { text: t('devices.statusPaired'), on: false };
  return { text: t('devices.statusMissing'), on: false };
}

function RemoteRow({
  name,
  status,
  last,
  forgetLabel,
  forgetText,
  onForget,
}: {
  name: string;
  status: RowStatus;
  last: boolean;
  forgetLabel: string;
  forgetText: string;
  onForget: () => void;
}) {
  const on = status !== undefined && status.on;
  return (
    <View style={[styles.remote, !last && styles.remoteDivider]}>
      <View
        accessible
        accessibilityLabel={status === undefined ? name : `${name}, ${status.text}`}
        style={styles.remoteMain}>
        <View style={[styles.remoteBadge, on && styles.remoteBadgeOn]}>
          <RemoteIcon size={20} color={on ? colors.ok : colors.muted} />
        </View>
        <View style={styles.remoteTexts}>
          <Text numberOfLines={1} style={styles.remoteName}>
            {name}
          </Text>
          {status === undefined ? null : (
            <View style={styles.remoteStatusRow}>
              {on ? <View style={styles.okDot} /> : null}
              <Text style={[styles.remoteStatus, on && { color: colors.ok }]}>{status.text}</Text>
            </View>
          )}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={forgetLabel} hitSlop={8} onPress={onForget} style={styles.forget}>
        <Text style={styles.forgetText}>{forgetText}</Text>
      </Pressable>
    </View>
  );
}

function Info({ text }: { text: string }) {
  return (
    <View style={styles.info}>
      <InfoIcon size={18} color={colors.muted} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheetWrap: { width: '100%' },
  // The app's sheets: the surface, rounded on top, a grabber; what sits inside is on the ground colour.
  sheet: {
    flexShrink: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingBottom: footer.bottom,
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: footer.side, paddingTop: 12, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 32, lineHeight: 34, color: colors.text },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  section: { fontFamily: fonts.bodyBold, fontSize: 13, letterSpacing: 0.6, color: colors.muted, textTransform: 'uppercase' },
  card: { backgroundColor: colors.ground, borderRadius: radius.card, overflow: 'hidden' },
  remote: { flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 6, paddingVertical: 10, gap: 8 },
  remoteDivider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  remoteMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  remoteBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#242424', alignItems: 'center', justifyContent: 'center' },
  remoteBadgeOn: { backgroundColor: 'rgba(76,217,100,0.14)' },
  remoteTexts: { flex: 1, minWidth: 0, gap: 2 },
  remoteName: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  remoteStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  okDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.ok },
  remoteStatus: { flexShrink: 1, fontFamily: fonts.bodySemi, fontSize: 13, color: colors.muted },
  info: { backgroundColor: colors.ground, borderRadius: radius.card, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  infoText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.muted },
  cancel: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  cancelText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.soft, textDecorationLine: 'underline' },
  waiting: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  waitingText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.accent },
  preparingText: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21, color: colors.soft, flexShrink: 1 },
  note: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.soft },
  done: { alignItems: 'center', gap: 12, paddingVertical: 16 },
  doneBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  success: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.accent, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ground,
    borderRadius: radius.card,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  rowName: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text, flexShrink: 1 },
  repair: { minHeight: 44, justifyContent: 'center' },
  repairText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.accent, textDecorationLine: 'underline' },
  forget: { minHeight: 44, minWidth: 44, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'flex-end' },
  forgetText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.warning },
  // TEMP(diag-remote)
  diag: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  diagText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.soft, textDecorationLine: 'underline' },
});
