import { androidOverrides } from "../locales/android";
import { en } from "../locales/en";
import { ptBR } from "../locales/pt-BR";
import { overlay } from "..";

/** Every [path, value] of a nested catalog, plurals as one leaf. */
function leaves(o: unknown, prefix = ""): [string, unknown][] {
  if (typeof o !== "object" || o === null || "other" in o) return [[prefix, o]];
  return Object.entries(o).flatMap(([k, v]) =>
    leaves(v, prefix ? `${prefix}.${k}` : k),
  );
}

const base = { en, "pt-BR": ptBR } as const;

test.each(["en", "pt-BR"] as const)(
  "every Android text replaces an existing one of the same shape (%s)",
  (locale) => {
    const known = new Map(leaves(base[locale]));
    for (const [path, value] of leaves(androidOverrides[locale])) {
      expect(known.has(path)).toBe(true);
      expect(typeof value).toBe(typeof known.get(path));
    }
  },
);

test("Android texts keep the same placeholders", () => {
  for (const locale of ["en", "pt-BR"] as const) {
    const known = new Map(leaves(base[locale]));
    for (const [path, value] of leaves(androidOverrides[locale])) {
      const marks = (v: unknown) =>
        (JSON.stringify(v).match(/%\{\w+\}/g) ?? []).sort();
      expect([path, marks(value)]).toEqual([path, marks(known.get(path))]);
    }
  }
});

test("the overlay replaces what it names and keeps the rest", () => {
  const merged = overlay(ptBR, androidOverrides["pt-BR"]);
  expect(merged.common.openSettings).toBe("Abrir Configurações");
  expect(merged.common.cancel).toBe(ptBR.common.cancel);
  expect(merged.setup).toBe(ptBR.setup);
  expect(ptBR.common.openSettings).toBe("Abrir Ajustes");
});
