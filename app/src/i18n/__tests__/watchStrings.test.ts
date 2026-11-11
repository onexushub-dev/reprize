/// <reference types="node" />
import fs from 'fs';
import path from 'path';

// The watch app's texts are English keys in ContentView.swift, translated in targets/watch/Localizable.xcstrings.
const WATCH = path.join(__dirname, '..', '..', '..', 'targets', 'watch');
const view = fs.readFileSync(path.join(WATCH, 'ContentView.swift'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(WATCH, 'Localizable.xcstrings'), 'utf8'));

type Unit = { stringUnit: { value: string } };
type Localization = Unit | { variations: { plural: Record<string, Unit> } };

/** The keys SwiftUI looks up: Text("…") and Message("…") literals, with "\(x)" interpolations as %lld. */
function usedKeys(source: string): string[] {
  const keys = [...source.matchAll(/\b(?:Text|Message)\("((?:[^"\\]|\\.)*)"\)/g)].map((m) =>
    m[1].replace(/\\\([^)]*\)/g, '%lld'),
  );
  return [...new Set(keys)].sort();
}

test('every text the watch shows is in the catalog, in English and Portuguese', () => {
  const keys = usedKeys(view);
  expect(keys).toEqual(
    expect.arrayContaining(['%lld clips', 'No connection', 'Open Reprize on your iPhone', 'Save', 'Start recording', 'Stop']),
  );
  expect(catalog.sourceLanguage).toBe('en');
  for (const key of keys) {
    const entry = catalog.strings[key];
    expect([key, entry !== undefined]).toEqual([key, true]);
    expect([key, Object.keys(entry.localizations).sort()]).toEqual([key, ['en', 'pt-BR']]);
  }
});

test('the catalog has no key the watch does not use', () => {
  expect(Object.keys(catalog.strings).sort()).toEqual(usedKeys(view));
});

// Portuguese puts 0 in "one", so an explicit zero keeps "0 clipes" (Foundation uses zero for 0 in any language).
test('the clip count is a plural in both languages, with 0 in the plural', () => {
  const loc: Record<string, Localization> = catalog.strings['%lld clips'].localizations;
  const forms = (l: Localization) =>
    'variations' in l ? Object.fromEntries(Object.entries(l.variations.plural).map(([k, v]) => [k, v.stringUnit.value])) : {};
  expect(forms(loc.en)).toEqual({ zero: '%lld clips', one: '%lld clip', other: '%lld clips' });
  expect(forms(loc['pt-BR'])).toEqual({ zero: '%lld clipes', one: '%lld clipe', other: '%lld clipes' });
});

test('the Portuguese copy is what the watch said before', () => {
  const pt = (key: string) => (catalog.strings[key].localizations['pt-BR'] as Unit).stringUnit.value;
  expect(pt('Save')).toBe('Salvar');
  expect(pt('Start recording')).toBe('Começar gravação');
  expect(pt('Starting…')).toBe('Começando…');
  expect(pt('No connection')).toBe('Sem conexão');
  expect(pt('Open Reprize on your iPhone')).toBe('Abra o Reprize no iPhone');
  expect(pt('Connecting to your iPhone…')).toBe('Conectando ao iPhone…');
  expect(pt('Stop')).toBe('Parar');
  expect(pt('Hold')).toBe('Segure');
  expect(pt('View camera')).toBe('Ver câmera');
  expect(pt('Close camera')).toBe('Fechar câmera');
  expect(pt('Saved')).toBe('Salvo');
  expect(pt('Not saved')).toBe('Não salvou');
});

test('the locked watch trigger says where Save comes from, in both languages', () => {
  const unit = (lang: string) => (catalog.strings['Available with PRO'].localizations[lang] as Unit).stringUnit.value;
  expect(unit('en')).toBe('Available with PRO');
  expect(unit('pt-BR')).toBe('Disponível no PRO');
});

test('no Portuguese is left hard-coded in the watch view', () => {
  const literals = [...view.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  expect(literals.filter((s) => /[À-ÿ]/.test(s))).toEqual([]);
});

describe('the watch widget', () => {
  const WIDGET = path.join(__dirname, '..', '..', '..', 'targets', 'watch-widget');
  const widget = fs.readFileSync(path.join(WIDGET, 'SaveWidget.swift'), 'utf8');
  const widgetCatalog = JSON.parse(fs.readFileSync(path.join(WIDGET, 'Localizable.xcstrings'), 'utf8'));

  test('every text it shows is in its own catalog, in English and Portuguese, and nothing more', () => {
    const keys = usedKeys(widget);
    expect(keys).toEqual(expect.arrayContaining(['%lld clips', 'Open']));
    expect(Object.keys(widgetCatalog.strings).sort()).toEqual(keys);
    for (const key of keys) {
      expect([key, Object.keys(widgetCatalog.strings[key].localizations).sort()]).toEqual([key, ['en', 'pt-BR']]);
    }
    expect((widgetCatalog.strings.Open.localizations['pt-BR'] as Unit).stringUnit.value).toBe('Abrir');
  });

  test('no Portuguese is left hard-coded in the widget', () => {
    const literals = [...widget.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
    expect(literals.filter((s) => /[À-ÿ]/.test(s))).toEqual([]);
  });
});
