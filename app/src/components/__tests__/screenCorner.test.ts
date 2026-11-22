import { screenCornerRadius } from '../screenCorner';

test('a known iPhone gets its own screen corners', () => {
  expect(screenCornerRadius('iPhone15,2', 852)).toBe(55); // 14 Pro
  expect(screenCornerRadius('iPhone17,1', 874)).toBe(62); // 16 Pro
  expect(screenCornerRadius('iPhone11,8', 896)).toBe(41.5); // XR
});

test('a phone newer than the list, with a notch, gets the roundest corners: a frame rounder than the screen is still whole', () => {
  expect(screenCornerRadius('iPhone99,1', 900)).toBe(62);
  expect(screenCornerRadius(null, 852)).toBe(62);
});

test('a phone with a home button has a square screen', () => {
  expect(screenCornerRadius('iPhone14,6', 667)).toBe(0); // SE 3rd generation
  expect(screenCornerRadius(undefined, 736)).toBe(0);
});
