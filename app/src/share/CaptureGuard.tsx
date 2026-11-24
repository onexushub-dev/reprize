import { type ReactNode, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { CaptureShieldView, type CaptureShieldState } from '../../modules/replay-camera';
import { track } from '../analytics';
import { diag } from '../diag/diagLog';
import { useT } from '../i18n/useT';
import { colors, fonts } from '../theme/tokens';

type Props = {
  /** A received recording: its video stays out of screenshots and screen recordings. Own recordings are unchanged. */
  active: boolean;
  /** The screen is being recorded or mirrored: the player pauses (the recording would carry the sound). */
  onCapturing: (capturing: boolean) => void;
  /**
   * The system is about to draw this screen without the shielded video: a sheet sliding over it (the share sheet) or the
   * screen leaving. Those animations draw a copy that leaves the shield out, so the message under it would flash: it
   * goes away until `quiet` is false again (a screenshot then shows plain dark where the video was).
   */
  quiet?: boolean;
  children: ReactNode;
};

/**
 * Capture protection of received recordings (sharing design §2 decision 11, §8.2). The video and everything drawn over
 * it sit in the capture shield: a screenshot shows the message underneath where the video was. While the screen is
 * recorded the message also covers the video on the screen itself.
 */
export function CaptureGuard({ active, onCapturing, quiet = false, children }: Props) {
  if (!active) return <>{children}</>;
  return (
    <Guard onCapturing={onCapturing} quiet={quiet}>
      {children}
    </Guard>
  );
}

function Guard({ onCapturing, quiet, children }: Omit<Props, 'active'>) {
  const { t } = useT();
  const [capturing, setCapturing] = useState(false);
  const last = useRef<CaptureShieldState | null>(null);

  function onState(next: CaptureShieldState) {
    const before = last.current;
    last.current = next;
    if (before === null && !next.protected) diag('recebidas: protecao contra captura INATIVA (sem canvas seguro)');
    if (before !== null && next.screenshots > before.screenshots) {
      diag('recebidas: print com o video escondido');
      track('capture_blocked', { kind: 'screenshot' });
    }
    const wasCapturing = before !== null && before.capturing;
    if (next.capturing !== wasCapturing) {
      setCapturing(next.capturing);
      onCapturing(next.capturing);
      if (next.capturing) {
        diag('recebidas: gravacao de tela, video escondido');
        track('capture_blocked', { kind: 'recording' });
      }
    }
  }

  const message = (
    <View style={[StyleSheet.absoluteFill, styles.message]}>
      <Text style={styles.text}>{t('received.captureBlocked')}</Text>
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill}>
      {/* Under the shield: what a capture shows where the video was. */}
      {quiet ? null : message}
      <CaptureShieldView style={StyleSheet.absoluteFill} onShieldState={(e) => onState(e.nativeEvent)}>
        {/* Covers the message on the screen itself, and leaves the capture with it. */}
        <View style={[StyleSheet.absoluteFill, styles.ground]}>{children}</View>
      </CaptureShieldView>
      {capturing ? message : null}
    </View>
  );
}

const styles = StyleSheet.create({
  message: { alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.surface },
  text: { fontFamily: fonts.bodySemi, fontSize: 16, lineHeight: 22, color: colors.text, textAlign: 'center' },
  ground: { backgroundColor: colors.ground },
});
