import { fileStem, uniqueStems } from '../labelledFile';

jest.mock('expo-file-system', () => ({ Directory: jest.fn(), File: jest.fn(), Paths: { cache: '/cache' } }));

test('a label becomes a plain file name', () => {
  expect(fileStem('toco do marcão')).toBe('toco do marcao');
  expect(fileStem('  cesta de 3   victor ')).toBe('cesta de 3 victor');
  expect(fileStem('assistência/do fernando?')).toBe('assistenciado fernando');
  expect(fileStem('!!!')).toBeUndefined();
});

test('repeated names get a number, the rest keep theirs', () => {
  expect(uniqueStems(['toco', undefined, 'Toco', 'cesta', 'toco'])).toEqual(['toco', undefined, 'Toco 2', 'cesta', 'toco 3']);
});
