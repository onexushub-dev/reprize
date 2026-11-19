import { courtesiesLeft, spendCourtesy } from '../courtesy';

const mockRpc = jest.fn();
const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect }));
jest.mock('../../account/supabase', () => ({ supabase: () => ({ rpc: mockRpc, from: mockFrom }) }));
jest.mock('../../diag/diagLog', () => ({ diag: jest.fn() }));

beforeEach(() => jest.clearAllMocks());

test('the courtesy left: 1 minus the one used; none used without a profile yet; null when the read fails', async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: { courtesies_used: 1 }, error: null });
  await expect(courtesiesLeft('u1')).resolves.toBe(0);
  expect(mockFrom).toHaveBeenCalledWith('profiles');
  expect(mockEq).toHaveBeenCalledWith('id', 'u1');

  mockMaybeSingle.mockResolvedValueOnce({ data: { courtesies_used: 0 }, error: null });
  await expect(courtesiesLeft('u1')).resolves.toBe(1);

  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(courtesiesLeft('u1')).resolves.toBe(1);

  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await expect(courtesiesLeft('u1')).resolves.toBeNull();
});

test('spending sends the share and this phone, and reads the answer', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ allowed: true, used: 1, remaining: 0, reason: 'applied' }], error: null });
  await expect(spendCourtesy('sh1', 'dev-1')).resolves.toEqual({ ok: true, remaining: 0 });
  expect(mockRpc).toHaveBeenCalledWith('use_courtesy', { p_share: 'sh1', p_device: 'dev-1' });
});

test('a recording that already had one is ok without spending another', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ allowed: true, used: 1, remaining: 0, reason: 'already_applied' }], error: null });
  await expect(spendCourtesy('sh1', 'dev-1')).resolves.toEqual({ ok: true, remaining: 0 });
});

test.each([
  ['exhausted', 'exhausted'],
  ['not_member', 'not_member'],
  ['sign_in', 'sign_in'],
  ['own_share', 'failed'],
  ['not_found', 'failed'],
])('the refusal %s comes back as %s', async (reason, expected) => {
  mockRpc.mockResolvedValueOnce({ data: [{ allowed: false, used: 1, remaining: 0, reason }], error: null });
  await expect(spendCourtesy('sh1', 'dev-1')).resolves.toEqual({ ok: false, reason: expected });
});

test('a failed call is a plain failure', async () => {
  mockRpc.mockResolvedValueOnce({ data: null, error: new Error('network') });
  await expect(spendCourtesy('sh1', 'dev-1')).resolves.toEqual({ ok: false, reason: 'failed' });
});
