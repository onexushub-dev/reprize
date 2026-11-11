import Svg, { Circle, Path, Rect } from 'react-native-svg';

import type { RecordingSportId } from '../data/schema';
import { colors } from '../theme/tokens';

type IconProps = { color?: string; size?: number };

const stroke = (color: string, width = 1.8) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
});

/** A circle with a slash: the clip with no framing (Original). */
export function NoneIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={12} cy={12} r={8} {...stroke(color)} />
      <Path d="M6.5 17.5l11-11" {...stroke(color)} />
    </Svg>
  );
}

/** Two people: the camera follows the players (Modo Foco). */
export function PlayersIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={8} cy={7} r={2.2} {...stroke(color)} />
      <Path d="M4.5 19v-4.5a3.5 3.5 0 0 1 7 0V19" {...stroke(color)} />
      <Circle cx={16.5} cy={8.5} r={1.8} {...stroke(color)} />
      <Path d="M14 19v-3.5a2.8 2.8 0 0 1 5.5 0V19" {...stroke(color)} />
    </Svg>
  );
}

/** A ball with motion lines: the camera follows the ball (Seguir a Bola). */
export function BallIcon({ color = colors.text, size = 20 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle cx={14} cy={10} r={5} {...stroke(color)} />
      <Path d="M3 18c2-1 4-1.5 6.5-3M3 14c1.5-.5 2.5-1 4-2" {...stroke(color)} />
    </Svg>
  );
}

/** A chevron pointing down: the sport chip opens a list. */
export function ChevronDownIcon({ color = colors.muted, size = 16 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M7 10l5 5 5-5" {...stroke(color)} />
    </Svg>
  );
}

/** A tick: the chosen row. */
export function TickIcon({ color = colors.accent, size = 22 }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Path d="M5 12.5l4.5 4.5L19 7.5" {...stroke(color, 2.4)} />
    </Svg>
  );
}

/** A progress ring: `progress` 0..1 of the way round, amber over the border colour. */
export function ProgressRing({ progress, size = 22 }: { progress: number; size?: number }) {
  const r = (size - 3) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, progress));
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityElementsHidden>
      <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={3} fill="none" />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={colors.accent}
        strokeWidth={3}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${(c * p).toFixed(1)} ${c.toFixed(1)}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}

/** The sport's icon (the sport chip and the sport sheet). */
export function SportIcon({ sport, color = colors.text, size = 22 }: IconProps & { sport: RecordingSportId | undefined }) {
  const s = stroke(color);
  let body;
  switch (sport) {
    case 'basquete':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...s} />
          <Path d="M12 3.5v17M3.5 12h17M6 6c2.5 2 3.5 4 3.5 6S8.5 16 6 18M18 6c-2.5 2-3.5 4-3.5 6s1 4 3.5 6" {...s} />
        </>
      );
      break;
    case 'beachTennis':
      body = (
        <>
          <Rect x={5} y={3} width={10} height={12} rx={5} {...s} />
          <Path d="M10 15v6" {...s} />
          <Circle cx={18.5} cy={18} r={2} {...s} />
        </>
      );
      break;
    case 'tenis':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...s} />
          <Path d="M5 6.5c3 2 3 9 0 11M19 6.5c-3 2-3 9 0 11" {...s} />
        </>
      );
      break;
    case 'futevolei':
      body = (
        <>
          <Circle cx={12} cy={10} r={6.5} {...s} />
          <Path d="M12 3.5c-1.5 3-1.5 9 0 13M6 8c3 1 9 1 12 0M6 21l4-2 3 1 4-2" {...s} />
        </>
      );
      break;
    case 'futebol':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...s} />
          <Path d="M12 8.5l3 2.2-1.1 3.6h-3.8L9 10.7zM12 3.5v5M15 10.7l4.5-1.5M13.9 14.3l2.8 4M10.1 14.3l-2.8 4M9 10.7L4.5 9.2" {...s} />
        </>
      );
      break;
    case 'volei':
    case 'voleiPraia':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...s} />
          <Path d="M12 3.5c0 4 2 7 7.5 8.5M12 12c-3.5 2-5 4.5-5 7.5M12 12c3.5 2 7 1.5 8.5 0M12 12C9 9 5 9 3.5 11" {...s} />
        </>
      );
      break;
    case 'handebol':
      body = (
        <>
          <Circle cx={12} cy={12} r={8.5} {...s} />
          <Path d="M5 8c4 1.5 10 1.5 14 0M5 16c4-1.5 10-1.5 14 0M12 3.5v17" {...s} />
        </>
      );
      break;
    default:
      body = (
        <>
          <Circle cx={6} cy={12} r={1.4} {...s} />
          <Circle cx={12} cy={12} r={1.4} {...s} />
          <Circle cx={18} cy={12} r={1.4} {...s} />
        </>
      );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden>
      {body}
    </Svg>
  );
}
