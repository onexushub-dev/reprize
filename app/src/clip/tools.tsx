import type { ReactNode } from 'react';

import { FocusIcon, RotateIcon, SoundIcon, SpeedIcon, ZoomIcon } from '../components/icons';
import type { BallUnsuitable, RecordingSportId } from '../data/schema';
import type { SportHow } from '../focus/sportCheck';
import type { MessageKey } from '../i18n';
import type { Plan } from '../payments/types';
import type { Edit, Framing } from '../share/editing';
import type { ToolId } from './editSession';
import { FocusPanel } from './panels/FocusPanel';
import { RotatePanel } from './panels/RotatePanel';
import { SoundPanel } from './panels/SoundPanel';
import { SpeedPanel } from './panels/SpeedPanel';
import { ZoomPanel } from './panels/ZoomPanel';

/** Modo Foco as a panel shows it: on/off, still analysing, or not possible for this clip. */
export type FocusUi = 'on' | 'off' | 'preparing' | 'unavailable';

/**
 * Bola's card (spec 2026-11-11 §3): `on` (ready and applied), `analysing` (chosen, progress on the card), `off` (offered),
 * `unsuitable` (no ball in play in this cut, test 47a: dimmed), `hidden` (no card: the sport has no ball model, the sport
 * is not known, or the phone cannot run it).
 */
export type BallUi = 'on' | 'analysing' | 'off' | 'unsuitable' | 'hidden';

/** Everything a tool panel reads and does; the clip screen builds it. */
export type ToolContext = {
  edit: Edit;
  /** The recording's plan: a free one exports without sound and Modo Foco (both work in the app). */
  plan: Plan;
  /** Unlocks this recording (Pro, a Pass or the paywall). */
  unlock(): void;
  setEdit(patch: Partial<Edit>): void;
  /** Jogadores (Modo Foco): ready, still analysing, or not possible for this clip ('on' / 'off' = ready). */
  focus: FocusUi;
  ball: BallUi;
  /** While Bola analyses: 0–100; undefined = not measured yet. */
  ballPercent: number | undefined;
  /** Bola waits for the phone to cool down before it starts (spec 2026-11-09 §4.4). */
  ballCooling: boolean;
  /** Test 47a: why Bola is not applied to this cut (with `ball` `unsuitable`). */
  ballReason: BallUnsuitable | undefined;
  /** The recording's sport and how it came; undefined = not known (the sheet opens with nothing marked). */
  sport: RecordingSportId | undefined;
  sportHow: SportHow | undefined;
  /** Original, Jogadores or Bola: only on the player's tap (spec 2026-11-11 decision 4). */
  pickFraming(framing: Framing): void;
  /** ✕ on the card being tracked: stop, back to the framing before the tap (what was found is kept). */
  stopFraming(): void;
  /** The player says the recording's sport (it serves every clip of the recording). */
  chooseSport(sport: RecordingSportId): void;
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
