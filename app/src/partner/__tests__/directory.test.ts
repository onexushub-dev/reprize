import { parsePartnerOfferings } from '../directory';

const tier = (discountPercent: unknown, partners: unknown) => ({ metadata: { discountPercent, partners } });

describe('parsePartnerOfferings', () => {
  it('reads partners from valid tiers only, the first tier by sorted id winning a repeated code', () => {
    const all = {
      default: { metadata: { partners: { IGNORED: { name: 'No' } } } },
      partner_p20: tier(20, { profjoao: { name: 'Prof. João' }, ANAMENSAL: { name: 'Ana' } }),
      partner_p10: tier(10, { PROFJOAO: { name: 'Dup' }, BIA: {} }),
      partner_bad: tier(95, { NOPE: { name: 'No' } }),
    };
    expect(parsePartnerOfferings(all)).toEqual({
      PROFJOAO: { name: 'Dup', offering: 'partner_p10', discountPercent: 10 },
      BIA: { name: 'BIA', offering: 'partner_p10', discountPercent: 10 },
    });
  });

  it('normalizes the codes, drops invalid ones and names a partner by its code when the name is missing', () => {
    expect(parsePartnerOfferings({ partner_p30: tier(30, { profjoao: { name: ' Prof. João ' }, X: { name: 'short' }, OK1: 'x' }) })).toEqual({
      PROFJOAO: { name: 'Prof. João', offering: 'partner_p30', discountPercent: 30 },
      OK1: { name: 'OK1', offering: 'partner_p30', discountPercent: 30 },
    });
  });

  it.each([0, 91, 12.5, '20', null, undefined])('ignores a tier whose discountPercent is %p and keeps the others', (bad) => {
    const out = parsePartnerOfferings({ partner_a: tier(bad, { NOPE: {} }), partner_b: tier(1, { GOOD: {} }) });
    expect(Object.keys(out)).toEqual(['GOOD']);
  });

  it('ignores offering ids outside partner_<a-z0-9>', () => {
    expect(parsePartnerOfferings({ partner_: tier(10, { AAA: {} }), 'partner_P-1': tier(10, { BBB: {} }), partner: tier(10, { CCC: {} }) })).toEqual({});
  });

  it('is empty for anything that is not the expected shape', () => {
    expect(parsePartnerOfferings({})).toEqual({});
    expect(parsePartnerOfferings({ partner_p10: {} })).toEqual({});
    expect(parsePartnerOfferings({ partner_p10: tier(10, 'nope') })).toEqual({});
    expect(parsePartnerOfferings({ partner_p10: tier(10, null) })).toEqual({});
  });
});
