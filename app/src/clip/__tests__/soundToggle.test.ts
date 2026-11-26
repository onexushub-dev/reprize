import { readEdit } from '../../share/editing';
import { soundOf, soundTap } from '../soundToggle';

const edit = (patch: object = {}) => ({ ...readEdit(undefined), ...patch });

describe('the Sound tab, a switch on the edit bar (2026-11-26)', () => {
  test('at 1x a tap turns the sound off, the next one on, each with its notice', () => {
    expect(soundTap(edit({ muted: false }), {})).toEqual({ muted: true, notice: 'clip.soundOffNotice' });
    expect(soundTap(edit({ muted: true }), {})).toEqual({ muted: false, notice: 'clip.soundOnNotice' });
  });

  test('away from 1x the clip has no sound: a tap changes nothing and says why', () => {
    expect(soundTap(edit({ speed: 2, muted: false }), {})).toEqual({ notice: 'clip.soundLocked' });
  });

  test('sent without sound: a tap changes nothing and says the sender took it off', () => {
    expect(soundTap(edit({ muted: true }), { sound: true })).toEqual({ notice: 'clip.soundSentOff' });
  });

  test('the icon shows the sound the clip has now', () => {
    expect(soundOf(edit({ muted: false }), {})).toBe(true);
    expect(soundOf(edit({ muted: true }), {})).toBe(false);
    expect(soundOf(edit({ speed: 0.5, muted: false }), {})).toBe(false);
    expect(soundOf(edit({ muted: false }), { sound: true })).toBe(false);
  });
});
