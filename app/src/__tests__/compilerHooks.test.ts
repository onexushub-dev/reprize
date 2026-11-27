/**
 * The app is built with the React Compiler (app.json `experiments.reactCompiler`), but Jest runs the code as written:
 * babel-jest never asks babel-preset-expo for the compiler. So a hook the compiler moves into one of its cached blocks
 * (`if ($[n] === …) { … }`) runs only on the first render on the phone, and the next render has fewer hooks, while every
 * test passes. It happened on 2026-11-27: three `useRef` written inside an object literal in CameraBar crashed the
 * camera screen ("Rendered fewer hooks than expected").
 *
 * This compiles every component file with the compiler and fails if any hook call lands inside such a block.
 */
import * as babel from '@babel/core';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') ? [full] : [];
  });
}

/** Hook calls the React Compiler put inside a memo-cache block of `source`, as "useX (compiled line N)". */
export function hooksInMemoBlocks(source: string, filename: string): string[] {
  const compiled = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
    plugins: [['babel-plugin-react-compiler', { target: '19', panicThreshold: 'none' }], '@babel/plugin-syntax-jsx'],
  })?.code;
  if (!compiled) return [];
  const ast = babel.parseSync(compiled, { filename: 'compiled.js', babelrc: false, configFile: false, plugins: ['@babel/plugin-syntax-jsx'] });
  if (!ast) return [];
  const found: string[] = [];
  babel.traverse(ast, {
    CallExpression(p) {
      const callee = p.node.callee;
      const name =
        callee.type === 'Identifier' ? callee.name : callee.type === 'MemberExpression' && callee.property.type === 'Identifier' ? callee.property.name : undefined;
      if (name === undefined || !/^use[A-Z]/.test(name)) return;
      for (let q: babel.NodePath | null = p.parentPath; q !== null && !q.isFunction(); q = q.parentPath) {
        if (q.isIfStatement() && /\$\[\d+\]/.test(compiled.slice(q.node.test.start ?? 0, q.node.test.end ?? 0))) {
          found.push(`${name} (compiled line ${p.node.loc?.start.line})`);
          return;
        }
      }
    },
  });
  return found;
}

describe('hooks under the React Compiler', () => {
  it('catches a hook written inside an object literal (the CameraBar crash)', () => {
    const source = `
      import { useRef, useEffect } from 'react';
      import { View } from 'react-native';
      export function Bar({ on }: { on: boolean }) {
        const refs = { a: useRef(null), b: useRef(null) };
        useEffect(() => { if (on) refs.a.current; });
        const slot = (k: 'a' | 'b') => <View ref={refs[k]} />;
        return <View>{slot('a')}{slot('b')}</View>;
      }`;
    expect(hooksInMemoBlocks(source, 'Bar.tsx')).toHaveLength(2);
  });

  it.each(sourceFiles(SRC).map((file) => [path.relative(SRC, file), file]))('%s runs every hook on every render', (_name, file) => {
    expect(hooksInMemoBlocks(fs.readFileSync(file, 'utf8'), file)).toEqual([]);
  });
});
