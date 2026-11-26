// Design tokens from the Reprize brand guide (Placar palette): ground is Ink, text is Branco, accent is Âmbar. surface, border, muted and rec are the app interface colors of the guide; rec only ever means "recording". recordingGround, screenOff, soft, the warning pair and the received pair are app-only. The UI is always dark.

export const colors = {
  ground: '#0A0A0A',
  recordingGround: '#060606',
  /** Pure black for screen economy while recording: OLED pixels switch off. */
  screenOff: '#000000',
  surface: '#141414',
  border: '#2E2E2E',
  text: '#FFFFFF',
  muted: '#B3B3B3',
  soft: '#D9D9D9',
  accent: '#FFB000',
  onAccent: '#0A0A0A',
  rec: '#FF453A',
  /** A trigger or device that is on and working ("Conectado", "Ativo"): the green of the triggers panel. */
  ok: '#4CD964',
  warning: '#FF8A3D',
  warningGround: '#3A1D10',
  /** A recording someone shared with this phone (its badge in Gravações). */
  received: '#9CC3FF',
  receivedGround: '#1F2A3A',
} as const;

export const fonts = {
  display: 'BarlowCondensed_700Bold',
  displayBold: 'BarlowCondensed_800ExtraBold',
  body: 'Manrope_400Regular',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
} as const;

export const radius = { chip: 20, card: 14, button: 16, sheet: 24 } as const;

/**
 * Where a screen's main bottom button sits (2026-11-21): the reference is Gravações' "Nova gravação", 12 pt above the
 * safe area (the home bar) and 16 pt from the sides. Every bottom button and sheet follows it.
 */
export const footer = { bottom: 12, side: 16 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 } as const;
