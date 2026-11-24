import { reportShare } from '../report';

jest.mock('@supabase/supabase-js', () => ({
  FunctionsHttpError: class FunctionsHttpError extends Error {
    context: { status: number };
    constructor(status: number) {
      super('Edge Function returned a non-2xx status code');
      this.context = { status };
    }
  },
}));
const mockInvoke = jest.fn();
jest.mock('../../account/supabase', () => ({ supabase: () => ({ functions: { invoke: mockInvoke } }) }));
jest.mock('../receive', () => ({ deviceId: () => 'dev-1' }));
jest.mock('../../diag/diagLog', () => ({ diag: jest.fn() }));

const { FunctionsHttpError } = jest.requireMock('@supabase/supabase-js');

beforeEach(() => jest.clearAllMocks());

test('a report goes with the reason, the text and this phone', async () => {
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  await expect(reportShare('c'.repeat(22), 'minor', '  ela tem 12 anos  ')).resolves.toBe('ok');
  expect(mockInvoke).toHaveBeenCalledWith('report-share', {
    body: { code: 'c'.repeat(22), category: 'minor', details: 'ela tem 12 anos', deviceId: 'dev-1' },
  });
});

test('too many reports today, a link that is gone, and other failures', async () => {
  mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(429) });
  await expect(reportShare('x', 'other', '')).resolves.toBe('too_many');
  mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(404) });
  await expect(reportShare('x', 'other', '')).resolves.toBe('ok');
  mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(500) });
  await expect(reportShare('x', 'other', '')).resolves.toBe('error');
  mockInvoke.mockResolvedValueOnce({ data: null, error: new Error('network') });
  await expect(reportShare('x', 'other', '')).resolves.toBe('error');
});
