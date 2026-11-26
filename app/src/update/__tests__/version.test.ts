import { isNewerVersion } from '../version';

describe('isNewerVersion', () => {
  test.each([
    ['1.0.4', '1.0.3', true],
    ['1.0.10', '1.0.9', true],
    ['2.0', '1.9.9', true],
    ['1.0.1', '1.0', true],
    ['1.0.3', '1.0.3', false],
    ['1.0', '1.0.0', false],
    ['1.0.2', '1.0.3', false],
  ])('%s over %s: %s', (candidate, current, expected) => {
    expect(isNewerVersion(candidate, current)).toBe(expected);
  });

  test.each([
    ['', '1.0.0'],
    ['1.0.0', ''],
    ['1.0.0-beta', '1.0.0'],
    ['latest', '1.0.0'],
  ])('a version it cannot read is never newer: %s over %s', (candidate, current) => {
    expect(isNewerVersion(candidate, current)).toBe(false);
  });
});
