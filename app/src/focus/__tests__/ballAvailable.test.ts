import { ballShownForProbe } from '../ballProbe';

describe('whether the probe lets Bola show', () => {
  it('shows Bola on Android whatever the probe took', () => {
    expect(ballShownForProbe(1450, 'android')).toBe(true);
  });

  it('hides Bola on Android without the model', () => {
    expect(ballShownForProbe(Number.MAX_SAFE_INTEGER, 'android')).toBe(false);
  });

  it('keeps the 400 ms limit on iOS', () => {
    expect(ballShownForProbe(401, 'ios')).toBe(false);
    expect(ballShownForProbe(400, 'ios')).toBe(true);
  });

  it('shows Bola before the probe has run', () => {
    expect(ballShownForProbe(undefined, 'ios')).toBe(true);
    expect(ballShownForProbe(undefined, 'android')).toBe(true);
  });
});
