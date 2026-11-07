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

test("Android shows only what it has: no voice, phone remote or Apple Watch slide", () => {
  const slides = slidesFor("android");
  expect(slides.map((s) => s.id)).toEqual([
    "record",
    "saveFree",
    "edit",
    "share",
  ]);
  expect(waysOf("saveFree", "android")).toEqual(["tap", "wave", "bluetooth"]);
  const save = slides.find((s) => s.id === "saveFree");
  expect(save).toMatchObject({ cards: 3, ms: 3 * CARD_MS, step: 1 });
});
