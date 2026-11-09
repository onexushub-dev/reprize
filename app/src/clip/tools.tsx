import type { ReactNode } from 'react';

import { FocusIcon, RotateIcon, SoundIcon, SpeedIcon, ZoomIcon } from '../components/icons';
import type { MessageKey } from '../i18n';
import type { Plan } from '../payments/types';
import type { Edit } from '../share/editing';
import type { ToolId } from './editSession';
import { FocusPanel } from './panels/FocusPanel';
import { RotatePanel } from './panels/RotatePanel';
import { SoundPanel } from './panels/SoundPanel';
import { SpeedPanel } from './panels/SpeedPanel';
import { ZoomPanel } from './panels/ZoomPanel';

/** Modo Foco as a panel shows it: on/off, still analysing, or not possible for this clip. */
export type FocusUi = 'on' | 'off' | 'preparing' | 'unavailable';

/**
 * Seguir a Bola as the Foco panel shows it: on (ready), analysing (the switch is on, the progress is on the video), off,
 * or `hidden` on a phone that cannot run it.
 */
export type BallUi = 'on' | 'analysing' | 'off' | 'hidden';

/** Everything a tool panel reads and does; the clip screen builds it. */
export type ToolContext = {
  edit: Edit;
  /** The recording's plan: a free one exports without sound and Modo Foco (both work in the app). */
  plan: Plan;
  /** Unlocks this recording (Pro, a Pass or the paywall). */
  unlock(): void;
  setEdit(patch: Partial<Edit>): void;
  focus: FocusUi;
  toggleFocus(): void;
  ball: BallUi;
  toggleBall(): void;
  resetZoom(): void;
  turn(): void;
};

export type EditTool = {
  id: ToolId;
  /** The catalog key of the tool's name. */
  label: MessageKey;
  icon: (color: string) => ReactNode;
  Panel: (props: { ctx: ToolContext }) => ReactNode;
};

/** The edit mode's tool bar, in order. A new edit is one more entry here and its panel. */
export const EDIT_TOOLS: EditTool[] = [
  { id: 'focus', label: 'clip.toolFocus', icon: (color) => <FocusIcon color={color} />, Panel: FocusPanel },
  { id: 'speed', label: 'clip.toolSpeed', icon: (color) => <SpeedIcon color={color} />, Panel: SpeedPanel },
  { id: 'sound', label: 'clip.sound', icon: (color) => <SoundIcon color={color} />, Panel: SoundPanel },
  { id: 'zoom', label: 'clip.toolZoom', icon: (color) => <ZoomIcon color={color} />, Panel: ZoomPanel },
  { id: 'rotate', label: 'clip.toolRotate', icon: (color) => <RotateIcon color={color} size={22} />, Panel: RotatePanel },
];
