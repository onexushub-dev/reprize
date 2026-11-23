// Sharing spike 3 (docs/superpowers/specs/2026-11-16-recording-sharing-design.md, §8.2 and §10): does the capture
// shield keep the app's player out of screenshots and screen recordings on this iOS? Team-only, like /spike.
// Not the product UI. Open with reprize://spike-capture on a diagnostics build.
import * as Device from 'expo-device';
import { Redirect, router } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { CaptureShieldView, type CaptureShieldState } from '../../modules/replay-camera';
import { repo } from '../data/mmkv';
import { DIAGNOSTICS_ENABLED } from '../diag/diagLog';
import type { Clip } from '../data/schema';

/** What the tester saw in the captured image or video. */
type Seen = 'hidden' | 'visible' | null;

const MESSAGE = 'Este lance não pode ser capturado. Para guardar, toque em Salvar.';

/** The newest saved clip of any recording: the spike plays a real clip, through the same player as the app. */
function newestClip(): Clip | null {
  let newest: Clip | null = null;
  for (const item of repo.listSessions()) {
    for (const clip of repo.listClips(item.session.id)) {
      if (newest === null || clip.createdAt > newest.createdAt) newest = clip;
    }
  }
  return newest;
}

function seenText(seen: Seen): string {
  if (seen === 'hidden') return 'vídeo escondido (certo)';
  if (seen === 'visible') return 'vídeo apareceu (falhou)';
  return 'não marcado';
}

/** Team-only: in store builds (no diagnostics) a deep link to /spike-capture lands on the home screen. */
export default function SpikeCapture() {
  if (!DIAGNOSTICS_ENABLED) return <Redirect href="/" />;
  return <SpikeCaptureScreen />;
}

function SpikeCaptureScreen() {
  const [clip] = useState(newestClip);
  const [enabled, setEnabled] = useState(true);
  const [state, setState] = useState<CaptureShieldState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [shot, setShot] = useState<Seen>(null);
  const [recorded, setRecorded] = useState<Seen>(null);

  const player = useVideoPlayer(clip ? { uri: `file://${clip.path}` } : null, (p) => {
    p.loop = true;
    p.play();
  });

  const capturing = state !== null && state.capturing;
  const screenshots = state === null ? 0 : state.screenshots;

  // A screen recording also records the sound: the clip stops for as long as the screen is captured.
  useEffect(() => {
    if (capturing) player.pause();
    else player.play();
  }, [capturing, player]);

  function onShieldState(next: CaptureShieldState) {
    const time = new Date().toLocaleTimeString();
    const lines: string[] = [];
    if (state === null) lines.push(`${time} proteção ${next.protected ? 'ativa' : 'INATIVA'} · ${next.canvas || 'sem canvas'}`);
    if (state !== null && state.capturing !== next.capturing) {
      lines.push(`${time} ${next.capturing ? 'gravação de tela começou' : 'gravação de tela terminou'}`);
    }
    if (state !== null && next.screenshots > state.screenshots) lines.push(`${time} print nº ${next.screenshots}`);
    if (state !== null && state.protected !== next.protected) {
      lines.push(`${time} proteção ${next.protected ? 'ligada' : 'desligada'}`);
    }
    if (lines.length > 0) setLog((l) => [...lines, ...l].slice(0, 12));
    setState(next);
  }

  function report(): string {
    return [
      'Reprize · teste 3: proteção contra captura',
      `Aparelho: ${Device.modelName} · ${Platform.OS} ${Device.osVersion}`,
      `Canvas seguro: ${state !== null && state.canvas ? state.canvas : 'não encontrado'}`,
      `Proteção ativa: ${state !== null && state.protected ? 'sim' : 'não'}`,
      `Clipe: ${clip ? `${clip.shortSide || 1080}p · ${Math.round(clip.durationMs / 1000)} s` : 'nenhum'}`,
      `Prints tirados: ${screenshots}`,
      `No print: ${seenText(shot)}`,
      `Na gravação de tela: ${seenText(recorded)}`,
      '',
      ...log,
    ].join('\n');
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>Voltar</Text>
        </Pressable>
        <Text style={styles.title}>Teste 3 · captura de tela</Text>
      </View>

      <View style={styles.stage}>
        {/* Under the shield: what a capture shows where the video was. */}
        <View style={styles.message}>
          <Text style={styles.messageText}>{MESSAGE}</Text>
        </View>
        {/* The shield itself has no background: it would stay in the capture and cover the message. */}
        <CaptureShieldView
          style={StyleSheet.absoluteFill}
          enabled={enabled}
          onShieldState={(e) => onShieldState(e.nativeEvent)}>
          <View style={styles.video}>
            {clip ? (
              <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls={false} />
            ) : (
              <Text style={styles.empty}>Grave e salve um clipe antes de abrir este teste.</Text>
            )}
            {/* Stands for Modo Foco's frame and the watermark: React views over the video must vanish too. */}
            <View pointerEvents="none" style={styles.frame} />
            <Text style={styles.overlayLabel}>SOBREPOSIÇÃO</Text>
          </View>
        </CaptureShieldView>
      </View>

      <Text style={styles.stat}>
        Proteção: {state === null ? '…' : state.protected ? 'ativa' : 'INATIVA'} · canvas:{' '}
        {state !== null && state.canvas ? state.canvas : 'não encontrado'}
      </Text>
      <Text style={styles.stat}>
        Gravando a tela: {capturing ? 'sim (vídeo pausado)' : 'não'} · prints: {screenshots}
      </Text>

      <Pressable accessibilityRole="button" style={[styles.button, enabled ? styles.on : styles.off]} onPress={() => setEnabled(!enabled)}>
        <Text style={styles.buttonText}>{enabled ? 'Proteção ligada (tocar para desligar)' : 'Proteção desligada (tocar para ligar)'}</Text>
      </Pressable>

      <Text style={styles.step}>1. Tire um print. Na foto, o lugar do vídeo deve mostrar a mensagem, sem o vídeo nem a moldura âmbar.</Text>
      <Choice label="No print" value={shot} onChange={setShot} />
      <Text style={styles.step}>2. Grave a tela por 5 s pela Central de Controle. O vídeo deve pausar e a gravação deve mostrar a mensagem.</Text>
      <Choice label="Na gravação" value={recorded} onChange={setRecorded} />
      <Text style={styles.step}>3. Desligue a proteção e tire outro print: agora o vídeo deve aparecer. Isso prova que o teste mede alguma coisa.</Text>
      <Text style={styles.step}>4. Repita os passos 1 e 2 com o aparelho deitado e com o vídeo em tela cheia de outro app por cima (multitarefa).</Text>

      <Pressable accessibilityRole="button" style={[styles.button, styles.share]} onPress={() => void Share.share({ message: report() })}>
        <Text style={styles.shareText}>Compartilhar relatório</Text>
      </Pressable>

      {log.map((line, i) => (
        <Text key={`${i}-${line}`} style={styles.log}>
          {line}
        </Text>
      ))}
    </ScrollView>
  );
}

function Choice({ label, value, onChange }: { label: string; value: Seen; onChange: (seen: Seen) => void }) {
  return (
    <View style={styles.chips}>
      <Text style={styles.chipLabel}>{label}:</Text>
      <Pressable accessibilityRole="button" style={[styles.chip, value === 'hidden' && styles.chipOn]} onPress={() => onChange('hidden')}>
        <Text style={[styles.chipText, value === 'hidden' && styles.chipTextOn]}>vídeo escondido</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={[styles.chip, value === 'visible' && styles.chipBad]} onPress={() => onChange('visible')}>
        <Text style={styles.chipText}>vídeo apareceu</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A0A0A' },
  content: { paddingTop: 56, paddingHorizontal: 16, paddingBottom: 48, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  back: { color: '#FFB000', fontSize: 16, fontWeight: '600' },
  title: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  stage: { height: 300, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' },
  message: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#141414' },
  messageText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  video: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#D9D9D9', fontSize: 14, textAlign: 'center', padding: 24 },
  frame: { position: 'absolute', top: 40, bottom: 40, left: 60, right: 60, borderWidth: 2, borderColor: '#FFB000', borderRadius: 8 },
  overlayLabel: { position: 'absolute', right: 12, bottom: 10, color: '#FFFFFF', fontSize: 11, fontWeight: '700', opacity: 0.7 },
  stat: { color: '#FFFFFF', fontSize: 14, fontVariant: ['tabular-nums'] },
  step: { color: '#D9D9D9', fontSize: 14, lineHeight: 20 },
  button: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  on: { backgroundColor: '#141414', borderWidth: 1, borderColor: '#FFB000' },
  off: { backgroundColor: '#141414', borderWidth: 1, borderColor: '#D9D9D9' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  share: { backgroundColor: '#FFB000' },
  shareText: { color: '#0A0A0A', fontSize: 16, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  chipLabel: { color: '#FFFFFF', fontSize: 13 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#141414' },
  chipOn: { backgroundColor: '#FFB000' },
  chipBad: { backgroundColor: '#7A2E00' },
  chipText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  chipTextOn: { color: '#0A0A0A' },
  log: { color: '#B3B3B3', fontSize: 12 },
});
