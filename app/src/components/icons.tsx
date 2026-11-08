import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { colors } from '../theme/tokens';
import { WavingFigure } from './WavingFigure';

type IconProps = { color?: string; size?: number };

const stroke = (color: string) => ({
  stroke: color,
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

export function PhoneIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={7} y={2} width={10} height={20} rx={2} {...stroke(color)} />
      <Path d="M4 8v8M20 8v8" {...stroke(color)} />
    </Svg>
  );
}

/** A QR code: three finder squares and a few modules. It stands for connecting by scanning the pairing code. */
export function QrIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={3} y={3} width={7} height={7} rx={1.5} {...stroke(color)} />
      <Rect x={14} y={3} width={7} height={7} rx={1.5} {...stroke(color)} />
      <Rect x={3} y={14} width={7} height={7} rx={1.5} {...stroke(color)} />
      <Path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4" {...stroke(color)} />
    </Svg>
  );
}

/**
 * The wave gesture (option C5, 2026-11-01), moving like the figure on the gesture's "?" sheet: arms open in a V and
 * cross over the head, with motion marks beside the hands. It fills the 24-unit box and has their default size (20, like the voice, remote and watch icons).
 */
export function WaveIcon({ color = colors.text, size = 20 }: IconProps) {
  // A thicker line than the other icons (2.2, not 1.8): made of thin strokes with space between them, it looked smaller
  // than its neighbours at tile size (2026-11-01).
  return <WavingFigure size={size} color={color} strokeWidth={2.2} />;
}

export function ShareIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v13" {...stroke(color)} />
    </Svg>
  );
}

export function DownloadIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4M8 10l4 4 4-4M12 3v11" {...stroke(color)} />
    </Svg>
  );
}

/** Battery saving on: a battery with a bolt. */
export function BatteryIcon({ color = colors.text, size = 26 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="2.5" y="7" width="16" height="10" rx="2.2" {...stroke(color)} />
      <Path d="M21 10.5v3M11.5 9l-2.5 3.2h3L9.5 15" {...stroke(color)} />
    </Svg>
  );
}

/** Battery saving off: the battery crossed out. */
export function BatteryOffIcon({ color = colors.soft, size = 26 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="2.5" y="7" width="16" height="10" rx="2.2" {...stroke(color)} />
      <Path d="M21 10.5v3M3 4l17 16" {...stroke(color)} />
    </Svg>
  );
}

/** "How does this work?": opens an explanation. */
export function InfoIcon({ color = colors.soft, size = 18 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx="12" cy="12" r="9" {...stroke(color)} />
      <Path d="M12 11v6M12 7.5v.5" {...stroke(color)} />
    </Svg>
  );
}

/** Delete: red (`colors.rec`) everywhere in the app unless a screen has a reason to differ. */
export function TrashIcon({ color = colors.rec, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" {...stroke(color)} />
    </Svg>
  );
}

export function FilmIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x="3" y="5" width="18" height="14" rx="2" {...stroke(color)} />
      <Path d="M10 9l5 3-5 3z" {...stroke(color)} />
    </Svg>
  );
}

export function PlayIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M8 5l11 7-11 7z" fill={color} />
    </Svg>
  );
}

export function PauseIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M8 5v14M16 5v14" {...stroke(color)} strokeWidth={3} />
    </Svg>
  );
}

export function ExpandIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" {...stroke(color)} />
    </Svg>
  );
}

export function CloseIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M6 6l12 12M18 6L6 18" {...stroke(color)} strokeWidth={2} />
    </Svg>
  );
}

export function RotateIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" {...stroke(color)} />
    </Svg>
  );
}

export function ShieldIcon({ color = colors.soft, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" {...stroke(color)} />
    </Svg>
  );
}

export function MicIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={9} y={2} width={6} height={12} rx={3} {...stroke(color)} />
      <Path d="M5 11a7 7 0 0 0 14 0M12 18v4" {...stroke(color)} />
    </Svg>
  );
}

export function RemoteIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M7 7l10 10-5 5V2l5 5L7 17" {...stroke(color)} />
    </Svg>
  );
}

export function WatchIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={6} y={6} width={12} height={12} rx={3} {...stroke(color)} />
      <Path d="M9 6V2h6v4M9 18v4h6v-4" {...stroke(color)} />
    </Svg>
  );
}

/** A padlock: a paid feature, opened by a purchase. */
export function LockIcon({ color = colors.text, size = 12 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={5} y={11} width={14} height={10} rx={2} {...stroke(color)} />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" {...stroke(color)} />
    </Svg>
  );
}

export function TapIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M9 11V5a1.5 1.5 0 0 1 3 0v6M12 10V4a1.5 1.5 0 0 1 3 0v7M15 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 15a1.5 1.5 0 0 1 2.5-1.7L9 16"
        {...stroke(color)}
      />
    </Svg>
  );
}

export function BackIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M15 6l-6 6 6 6" {...stroke(color)} strokeWidth={2} />
    </Svg>
  );
}

export function CheckIcon({ color = colors.onAccent, size = 72 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M5 12l5 5L20 7" {...stroke(color)} strokeWidth={2.6} />
    </Svg>
  );
}

/** A camera: opens the picture of what the camera phone sees. */
export function CameraIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 8h3l1.5-2h7L17 8h3v11H4z" {...stroke(color)} />
      <Circle cx={12} cy={13.5} r={3.5} {...stroke(color)} />
    </Svg>
  );
}

/** Four frame corners around a dot: the camera keeping the play in frame (Modo Foco). */
export function FocusIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" {...stroke(color)} />
      <Circle cx={12} cy={12} r={3} {...stroke(color)} />
    </Svg>
  );
}

/** A speedometer: the playback speed. */
export function SpeedIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 16a8 8 0 1 1 16 0M12 16l4-5" {...stroke(color)} />
    </Svg>
  );
}

/** A speaker with one wave: the clip's sound. */
export function SoundIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 10v4h4l5 4V6L8 10zM16.5 9a4 4 0 0 1 0 6" {...stroke(color)} />
    </Svg>
  );
}

/** The speaker with a cross: a video without sound. */
export function MutedIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 10v4h4l5 4V6L8 10zM16 10l4 4M20 10l-4 4" {...stroke(color)} />
    </Svg>
  );
}

/** A magnifier with a plus: zoom by hand. */
export function ZoomIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={11} cy={11} r={6} {...stroke(color)} />
      <Path d="M20 20l-4.5-4.5M11 8v6M8 11h6" {...stroke(color)} />
    </Svg>
  );
}

/** A pencil: edit the clip. */
export function EditIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4" {...stroke(color)} />
    </Svg>
  );
}

/** Rewind and play: the replay itself. It stands for a recording with nothing saved to watch again yet. */
export function ReplayIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M10 7.5L3.5 12l6.5 4.5z" {...stroke(color)} />
      <Path d="M13 6.5v11L21 12z" {...stroke(color)} />
    </Svg>
  );
}

/** A clip frame with a play triangle: a saved lance. */
export function ClipIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={3} y={5} width={18} height={14} rx={3} {...stroke(color)} />
      <Path d="M10.2 9.5v5l4.2-2.5z" {...stroke(color)} />
    </Svg>
  );
}

/** A star: a recommended choice (the triggers that give the best clips). */
export function StarIcon({ color = colors.accent, size = 12 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path
        d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"
        {...stroke(color)}
        fill={color}
      />
    </Svg>
  );
}

/** A crown: the mark of the Pro plan. */
export function CrownIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M3.5 8.5l4.5 4 4-7 4 7 4.5-4L19 17H5z" {...stroke(color)} />
      <Path d="M5.5 20.5h13" {...stroke(color)} />
    </Svg>
  );
}

/**
 * A phone out of its case: the case's outline dashed and tilted behind the phone, and heat leaving on the side
 * ("Prepare o celular"). The phone is filled with the ground colour, so the case shows only around it.
 */
export function NoCaseIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Rect x={11} y={6.5} width={9} height={15} rx={2.6} {...stroke(color)} strokeWidth={1.5} strokeDasharray="1.4 2.2" transform="rotate(14 15.5 14)" />
      <Rect x={8} y={2} width={8.5} height={15.5} rx={2.4} {...stroke(color)} fill={colors.ground} />
      <Path d="M1.2 7.8q1.1-1.3 2.2 0t2.2 0M1.2 10.8q1.1-1.3 2.2 0t2.2 0M1.2 13.8q1.1-1.3 2.2 0t2.2 0" {...stroke(color)} strokeWidth={1.4} />
    </Svg>
  );
}

/** The sun: out of direct sun ("Prepare o celular"). */
export function SunIcon({ color = colors.text, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={4} {...stroke(color)} />
      <Path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" {...stroke(color)} />
    </Svg>
  );
}
