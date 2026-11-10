/// <reference types="node" />
import fs from 'fs';
import os from 'os';
import path from 'path';
import ts from 'typescript';

// Spec criterion 7: no Portuguese left in the screens outside the catalogs. Every string literal, template piece and
// JSX text in the app's source (comments are not looked at) must be free of accented letters; the catalogs, the
// tests and the allowlist below are the only exceptions.
const SRC = path.join(__dirname, '..', '..');
const SKIP_DIRS = new Set(['__tests__', 'locales']);
const ALLOWLIST = new Set([
  // Developer field-test screen for the camera module ("Not the product UI"), never linked from the app.
  'app/spike.tsx',
  // TEMP(diag-remote) (for the team only): the diagnostic log and its screen.
  'app/diag.tsx',
  'diag/diagLog.ts',
  'diag/clipTimings.ts',
  'diag/useSessionDiag.ts',
  'diag/remoteLinkDiag.ts',
  'diag/useSetupDiag.ts',
  // Gesture test report (spike screen, for the team only).
  'diag/gestureTest.ts',
]);
const ACCENTED = /[À-ÿ]/;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function accentedTexts(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node) ||
        ts.isJsxText(node)) &&
      ACCENTED.test(node.text)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${path.relative(SRC, file)}:${line + 1} ${JSON.stringify(node.text.trim())}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('no hard-coded Portuguese text outside the catalogs', () => {
  const files = sourceFiles(SRC).filter((f) => !ALLOWLIST.has(path.relative(SRC, f)));
  expect(files.some((f) => f.includes(`${path.sep}app${path.sep}setup.tsx`))).toBe(true);
  expect(files.flatMap(accentedTexts)).toEqual([]);
});

test('the guard sees JSX text, props and template strings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-guard-'));
  const file = path.join(dir, 'Sample.tsx');
  fs.writeFileSync(
    file,
    [
      '// comentário: não conta',
      'const a = <Text accessibilityLabel="Vídeo">Olá</Text>;',
      'const b = `Conexão ${x} câmera`;',
      "const c = 'file://ok';",
    ].join('\n'),
  );
  expect(accentedTexts(file).length).toBe(4);
  fs.rmSync(dir, { recursive: true });
});
