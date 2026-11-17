import { parsePartners } from '../directory';

describe('parsePartners', () => {
  it('normalizes the codes, drops invalid ones and names a partner by its code when the name is missing', () => {
    expect(
      parsePartners({ partners: { profjoao: { name: 'Prof. João' }, X: { name: 'short' }, OK1: {} } }),
    ).toEqual({ PROFJOAO: { name: 'Prof. João' }, OK1: { name: 'OK1' } });
  });
  it('is empty for anything that is not the expected shape', () => {
    expect(parsePartners(undefined)).toEqual({});
    expect(parsePartners(null)).toEqual({});
    expect(parsePartners({ partners: 'nope' })).toEqual({});
    expect(parsePartners({ partners: { PROFJOAO: 'Prof. João' } })).toEqual({ PROFJOAO: { name: 'PROFJOAO' } });
  });
});
