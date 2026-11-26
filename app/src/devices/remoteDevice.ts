import { type AppLocale, currentLocale, translate } from '../i18n';
import type { RemoteLink } from './bluetoothRemote';

export type DeviceState = 'setup' | 'offline' | 'connected';

export type RemoteDeviceView = {
  /**
   * `offline`: used on this phone before, and not proven working now (no press; or iOS shows the remote gone, or the
   * Bluetooth off). Never "paired": iOS does not tell apps which devices are paired (2026-11-01 field test).
   */
  state: DeviceState;
  /** Toque para conectar → Em espera · aperte um botão / Bluetooth desligado → Conectado. */
  statusText: string;
  showSteps: boolean;
  /** The steps sit behind "Não funciona? Parear de novo" (the remote may have been unpaired since). */
  stepsBehindRepair: boolean;
  /** Listening for a press: the pulse and "Aperte um botão do controle…". */
  showWaiting: boolean;
  /**
   * The camera is still opening: a press now would only change the iPhone's ringer volume and be lost (2026-11-01
   * field test), so the sheet says to wait instead of asking for a press.
   */
  preparing: boolean;
  showNote: boolean;
  /** What the note says, when shown. */
  note: string;
};

type Input = {
  /** A press was heard in this launch of the app. */
  pressed: boolean;
  /** A press was heard in an earlier launch (the app cannot see the iOS pairing, only presses: it may be gone). */
  testedBefore: boolean;
  /** The sheet has been listening for a while without hearing anything. */
  waitedLong: boolean;
  /** The remote's link as iOS shows it (BLE remotes the app has learnt); undefined: unknown, presses alone tell. */
  link?: RemoteLink;
  /**
   * The camera is on. Presses are heard through the camera's audio (volume changes, capture events); before it runs,
   * iOS sends a press to the ringer volume, which the app cannot see. Absent: on.
   */
  cameraReady?: boolean;
};

/** What the Bluetooth remote looks like to the player: the tile on the setup screen and the Dispositivos sheet read this. */
export function remoteDeviceView(
  { pressed, testedBefore, waitedLong, link, cameraReady = true }: Input,
  locale: AppLocale = currentLocale(),
): RemoteDeviceView {
  const view = pick({ pressed, testedBefore, waitedLong, link }, locale);
  // Asking for a press only once one can be heard.
  if (view.showWaiting && !cameraReady) return { ...view, showWaiting: false, preparing: true };
  return view;
}

function pick({ pressed, testedBefore, waitedLong, link }: Input, locale: AppLocale): RemoteDeviceView {
  const check = translate(locale, 'devices.note');
  if (pressed || link === 'connected') {
    return {
      state: 'connected',
      statusText: translate(locale, 'devices.statusConnected'),
      showSteps: false,
      stepsBehindRepair: false,
      showWaiting: false,
      preparing: false,
      showNote: false,
      note: check,
    };
  }
  if (link === 'bluetoothOff') {
    return {
      state: 'offline',
      statusText: translate(locale, 'devices.statusBluetoothOff'),
      showSteps: false,
      stepsBehindRepair: false,
      showWaiting: false,
      preparing: false,
      showNote: true,
      note: translate(locale, 'devices.noteBluetoothOff'),
    };
  }
  if (link === 'missing') {
    return {
      state: 'offline',
      statusText: translate(locale, 'devices.statusMissing'),
      showSteps: false,
      stepsBehindRepair: true,
      showWaiting: true,
      preparing: false,
      showNote: true,
      note: translate(locale, 'devices.noteMissing'),
    };
  }
  if (testedBefore) {
    return {
      state: 'offline',
      statusText: translate(locale, 'devices.statusPaired'),
      showSteps: false,
      stepsBehindRepair: true,
      showWaiting: true,
      preparing: false,
      showNote: true,
      note: check,
    };
  }
  return {
    state: 'setup',
    statusText: translate(locale, 'devices.statusSetup'),
    showSteps: true,
    stepsBehindRepair: false,
    showWaiting: true,
    preparing: false,
    showNote: waitedLong,
    note: check,
  };
}
