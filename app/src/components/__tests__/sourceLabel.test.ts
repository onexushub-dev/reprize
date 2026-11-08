import { SOURCE_IDS, sourceLabel } from '../sourceLabel';

test('every way of saving has a label the player can read, in both languages', () => {
  expect(sourceLabel('phone')).toBe('Celular');
  expect(sourceLabel('watch')).toBe('Apple Watch');
  expect(sourceLabel('watch', 'en')).toBe('Apple Watch');
  expect(sourceLabel('gesture', 'en')).toBe('Gesture');
  expect([...SOURCE_IDS].sort()).toEqual(['gesture', 'phone', 'remote', 'screen', 'voice', 'watch']);
  for (const id of SOURCE_IDS) {
    expect(sourceLabel(id, 'en').length).toBeGreaterThan(0);
    expect(sourceLabel(id, 'pt-BR').length).toBeGreaterThan(0);
  }
});
