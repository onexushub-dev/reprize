import { ballShownForProbe } from '../ballProbe';

describe('whether the probe lets Bola show', () => {
  it('keeps the 400 ms limit on iOS', () => {
    expect(ballShownForProbe(401, 'ios')).toBe(false);
    expect(ballShownForProbe(400, 'ios')).toBe(true);
  });

  it('uses the same 400 ms limit on Android (Marcus, 2026-11-16, after the POCO X3 test)', () => {
    expect(ballShownForProbe(1700, 'android')).toBe(false);
    expect(ballShownForProbe(401, 'android')).toBe(false);
    expect(ballShownForProbe(400, 'android')).toBe(true);
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
