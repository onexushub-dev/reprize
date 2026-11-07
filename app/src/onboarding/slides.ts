/** The onboarding stories: five slides grouped in four steps (Save has two: the free ways and the Pro one, the Apple Watch). */
export type SlideId = "record" | "saveFree" | "savePro" | "edit" | "share";

export type Slide = {
  id: SlideId;
  /** Index into STEPS: the label the slide belongs to in the progress bar. */
  step: number;
  /** How long the slide stays before the next one; 0 means it waits for the player (the last one). */
  ms: number;
  /** How many option cards the slide rotates through (0 when it has none). */
  cards: number;
};

export const SLIDES: readonly Slide[] = [
  { id: "record", step: 0, ms: 7000, cards: 0 },
  { id: "saveFree", step: 1, ms: 13500, cards: 5 },
  { id: "savePro", step: 1, ms: 6000, cards: 1 },
  { id: "edit", step: 2, ms: 7500, cards: 0 },
  { id: "share", step: 3, ms: 0, cards: 0 },
];

export const STEP_COUNT = 4;

/** How long each option card shows before the next one takes its place. */
export const CARD_MS = 2700;

export type WayId = "tap" | "wave" | "voice" | "phone" | "watch" | "bluetooth";

export const FREE_WAYS: readonly WayId[] = [
  "tap",
  "wave",
  "voice",
  "phone",
  "bluetooth",
];
export const PRO_WAYS: readonly WayId[] = ["watch"];

/** Ways to save that only the iPhone has: the Apple Watch, the voice command and a second phone as remote. */
const IOS_ONLY_WAYS: readonly WayId[] = ["voice", "phone", "watch"];

/** The ways to save a play a slide shows as cards, on this platform (`os` is Platform.OS). */
export function waysOf(slide: SlideId, os: string = "ios"): readonly WayId[] {
  const ways =
    slide === "saveFree" ? FREE_WAYS : slide === "savePro" ? PRO_WAYS : [];
  return os === "ios" ? ways : ways.filter((w) => !IOS_ONLY_WAYS.includes(w));
}

/**
 * The stories on this platform: a Save slide without any way to show is left out (the Apple Watch one outside iOS),
 * and the free ways' slide lasts as long as its cards.
 */
export function slidesFor(os: string): readonly Slide[] {
  if (os === "ios") return SLIDES;
  return SLIDES.flatMap((s) => {
    if (s.cards === 0) return [s];
    const cards = waysOf(s.id, os).length;
    if (cards === 0) return [];
    return [{ ...s, cards, ms: s.id === "saveFree" ? cards * CARD_MS : s.ms }];
  });
}

/** Splits a text at its `*highlighted*` word: [before, highlighted, after]; with no marker the whole text is "before". */
export function splitHighlight(text: string): [string, string, string] {
  const match = /^(.*?)\*(.+?)\*(.*)$/s.exec(text);
  return match ? [match[1], match[2], match[3]] : [text, "", ""];
}
