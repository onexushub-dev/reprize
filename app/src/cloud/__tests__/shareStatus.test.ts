import { fetchShareStatus } from '../shareStatus';

const mockRpc = jest.fn();
jest.mock('../../account/supabase', () => ({ supabase: () => ({ rpc: mockRpc }) }));

beforeEach(() => jest.clearAllMocks());

test('how many opened the link and whether it was reported', async () => {
  mockRpc.mockResolvedValueOnce({ data: [{ opened: 4, report: 'none' }], error: null });
  await expect(fetchShareStatus('sh1')).resolves.toEqual({ opened: 4, report: 'none' });
  expect(mockRpc).toHaveBeenCalledWith('share_status', { p_share: 'sh1' });

  mockRpc.mockResolvedValueOnce({ data: [{ opened: 2, report: 'open' }], error: null });
  await expect(fetchShareStatus('sh1')).resolves.toEqual({ opened: 2, report: 'open' });
  mockRpc.mockResolvedValueOnce({ data: [{ opened: 2, report: 'removed' }], error: null });
  await expect(fetchShareStatus('sh1')).resolves.toEqual({ opened: 2, report: 'removed' });
});

test('no answer (not the owner, offline) is null', async () => {
  mockRpc.mockResolvedValueOnce({ data: [], error: null });
  await expect(fetchShareStatus('sh1')).resolves.toBeNull();
  mockRpc.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  await expect(fetchShareStatus('sh1')).resolves.toBeNull();
});
