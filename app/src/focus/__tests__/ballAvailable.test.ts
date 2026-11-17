import { ballShownForProbe } from '../ballProbe';

describe('whether the probe lets Bola show', () => {
  it('keeps the 400 ms limit on iOS', () => {
    expect(ballShownForProbe(401, 'ios')).toBe(false);
    expect(ballShownForProbe(400, 'ios')).toBe(true);
  });

  it('uses a 500 ms limit on Android (Marcus, 2026-11-17: the card shows the progress)', () => {
    expect(ballShownForProbe(1700, 'android')).toBe(false);
    expect(ballShownForProbe(501, 'android')).toBe(false);
    expect(ballShownForProbe(500, 'android')).toBe(true);
    expect(ballShownForProbe(450, 'android')).toBe(true);
  });

  it('hides Bola without the model', () => {
    expect(ballShownForProbe(Number.MAX_SAFE_INTEGER, 'android')).toBe(false);
    expect(ballShownForProbe(Number.MAX_SAFE_INTEGER, 'ios')).toBe(false);
  });

  it('shows Bola before the probe has run', () => {
    expect(ballShownForProbe(undefined, 'ios')).toBe(true);
    expect(ballShownForProbe(undefined, 'android')).toBe(true);
  });
});
