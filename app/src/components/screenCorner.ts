/**
 * How round the screen's own corners are (points), so a frame drawn on the screen's edge follows them instead of being
 * cut off at the corners (2026-11-22: the "clip saved" frame). iOS does not offer it in a public API, so it is looked up
 * by model. A frame a little rounder than the screen is still whole; a squarer one is cut, so an unknown phone with a
 * notch or Dynamic Island gets the roundest known value, and a phone with a home button (square screen) none.
 */
const RADIUS_BY_MODEL: Record<string, number> = {
  // iPhone X, XS, XS Max, 11 Pro, 11 Pro Max
  'iPhone10,3': 39,
  'iPhone10,6': 39,
  'iPhone11,2': 39,
  'iPhone11,4': 39,
  'iPhone11,6': 39,
  'iPhone12,3': 39,
  'iPhone12,5': 39,
  // iPhone XR, 11
  'iPhone11,8': 41.5,
  'iPhone12,1': 41.5,
  // iPhone 12 mini, 13 mini
  'iPhone13,1': 44,
  'iPhone14,4': 44,
  // iPhone 12, 12 Pro, 13, 13 Pro, 14, 16e
  'iPhone13,2': 47.33,
  'iPhone13,3': 47.33,
  'iPhone14,5': 47.33,
  'iPhone14,2': 47.33,
  'iPhone14,7': 47.33,
  'iPhone17,5': 47.33,
  // iPhone 12 Pro Max, 13 Pro Max, 14 Plus
  'iPhone13,4': 53.33,
  'iPhone14,3': 53.33,
  'iPhone14,8': 53.33,
  // iPhone 14 Pro, 14 Pro Max, 15, 15 Plus, 15 Pro, 15 Pro Max, 16, 16 Plus
  'iPhone15,2': 55,
  'iPhone15,3': 55,
  'iPhone15,4': 55,
  'iPhone15,5': 55,
  'iPhone16,1': 55,
  'iPhone16,2': 55,
  'iPhone17,3': 55,
  'iPhone17,4': 55,
  // iPhone 16 Pro, 16 Pro Max
  'iPhone17,1': 62,
  'iPhone17,2': 62,
};

/** The roundest corners known: for a phone newer than this list. */
const ROUNDEST = 62;
/** Every iPhone with a notch or Dynamic Island is at least this tall (points); those with a home button are shorter. */
const NOTCHED_HEIGHT = 812;

/**
 * The screen's corner radius for a model id (expo-device's `modelId`, e.g. "iPhone15,2") and the screen's long side.
 * Anything not in the list: rounded as the roundest known if it is tall like a phone with a notch, else square.
 */
export function screenCornerRadius(modelId: string | null | undefined, longSide: number): number {
  if (modelId !== null && modelId !== undefined) {
    const known = RADIUS_BY_MODEL[modelId];
    if (known !== undefined) return known;
  }
  return longSide >= NOTCHED_HEIGHT ? ROUNDEST : 0;
}
