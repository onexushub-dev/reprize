import { codeFromReferrer, codeFromUrl, normalizeCode } from '../code';

describe('normalizeCode', () => {
  it('uppercases, folds accents and drops separators', () => {
    expect(normalizeCode('  profjoao ')).toBe('PROFJOAO');
    expect(normalizeCode('Prof-João 10')).toBe('PROFJOAO10');
  });
  it('rejects codes outside 3 to 20 characters', () => {
    expect(normalizeCode('ab')).toBeNull();
    expect(normalizeCode('A'.repeat(21))).toBeNull();
    expect(normalizeCode('A'.repeat(20))).toBe('A'.repeat(20));
    expect(normalizeCode('')).toBeNull();
  });
});

describe('codeFromUrl', () => {
  it('reads the code from the site and the app scheme', () => {
    expect(codeFromUrl('https://reprizeapp.com/p/profjoao')).toBe('PROFJOAO');
    expect(codeFromUrl('https://www.reprizeapp.com/p/PROFJOAO/?utm=x')).toBe('PROFJOAO');
    expect(codeFromUrl('reprize://p/profjoao')).toBe('PROFJOAO');
  });
  it('finds a link without the scheme or inside a sentence', () => {
    expect(codeFromUrl('reprizeapp.com/p/ana')).toBe('ANA');
    expect(codeFromUrl('Use meu link https://reprizeapp.com/p/profjoao, valeu!')).toBe('PROFJOAO');
    expect(codeFromUrl('https://evil.example/reprizeapp.com/p/ABC')).toBeNull();
    expect(codeFromUrl('notreprizeapp.com/p/ABC')).toBeNull();
  });
  it('ignores other paths, other hosts and text that is not a link', () => {
    expect(codeFromUrl('https://reprizeapp.com/privacy')).toBeNull();
    expect(codeFromUrl('https://evil.example/p/PROFJOAO')).toBeNull();
    expect(codeFromUrl('not a url')).toBeNull();
    expect(codeFromUrl('')).toBeNull();
  });
});

describe('codeFromReferrer', () => {
  it('reads the partner parameter of the install referrer', () => {
    expect(codeFromReferrer('partner=PROFJOAO&utm_source=wa')).toBe('PROFJOAO');
    expect(codeFromReferrer('partner%3Dprofjoao')).toBe('PROFJOAO');
  });
  it('ignores referrers without a partner', () => {
    expect(codeFromReferrer('utm_source=google-play&utm_medium=organic')).toBeNull();
    expect(codeFromReferrer(null)).toBeNull();
    expect(codeFromReferrer(undefined)).toBeNull();
  });
});
