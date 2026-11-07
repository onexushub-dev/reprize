import { CARD_MS, SLIDES, slidesFor, waysOf } from "../slides";

test("the iPhone shows every way to save, the Apple Watch on its own Pro slide", () => {
  expect(slidesFor("ios")).toBe(SLIDES);
  expect(waysOf("saveFree", "ios")).toEqual([
    "tap",
    "wave",
    "voice",
    "phone",
    "bluetooth",
  ]);
  expect(waysOf("savePro", "ios")).toEqual(["watch"]);
});

test("Android shows only what it has: voice, but no phone remote or Apple Watch slide", () => {
  const slides = slidesFor("android");
  expect(slides.map((s) => s.id)).toEqual([
    "record",
    "saveFree",
    "edit",
    "share",
  ]);
  expect(waysOf("saveFree", "android")).toEqual(["tap", "wave", "voice", "bluetooth"]);
  const save = slides.find((s) => s.id === "saveFree");
  expect(save).toMatchObject({ cards: 4, ms: 4 * CARD_MS, step: 1 });
});

test("a phone that can't listen (Android before 12) leaves the voice card out", () => {
  expect(waysOf("saveFree", "android", false)).toEqual(["tap", "wave", "bluetooth"]);
  const save = slidesFor("android", false).find((s) => s.id === "saveFree");
  expect(save).toMatchObject({ cards: 3, ms: 3 * CARD_MS });
});
