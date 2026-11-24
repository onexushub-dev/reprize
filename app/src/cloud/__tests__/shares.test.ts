import { acceptNotice, createShare, createShareGroup, NOTICE_VERSION, noticeAccepted, type ShareInput } from '../shares';

jest.mock('@supabase/supabase-js', () => ({
  FunctionsHttpError: class FunctionsHttpError extends Error {
    context: { json: () => Promise<unknown> };
    constructor(body: unknown) {
      super('Edge Function returned a non-2xx status code');
      this.context = { json: async () => body };
    }
  },
}));

const mockInvoke = jest.fn();
const mockMaybeSingle = jest.fn();
const mockUpsert = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
const mockFrom = jest.fn(() => ({ select: mockSelect, upsert: mockUpsert }));
jest.mock('../../account/supabase', () => ({ supabase: () => ({ functions: { invoke: mockInvoke }, from: mockFrom }) }));

const { FunctionsHttpError } = jest.requireMock('@supabase/supabase-js');

const input: ShareInput = {
  kind: 'recording',
  title: 'Final',
  cover: true,
  clips: [{ position: 1, bytes: 10, durationMs: 15000, edit: {}, hasThumb: true, hasFocus: false, hasBall: false }],
};

beforeEach(() => jest.clearAllMocks());

test('a created share comes back with its link and uploads', async () => {
  const share = { shareId: 's1', code: 'abc', url: 'https://reprizeapp.com/v/abc', expiresAt: 'x', uploads: [] };
  mockInvoke.mockResolvedValue({ data: share, error: null });
  await expect(createShare(input)).resolves.toEqual({ ok: true, share });
  expect(mockInvoke).toHaveBeenCalledWith('create-share', { body: input });
});

test.each(['not_pro', 'notice', 'too_many', 'sign_in'])('the server refusal %s is passed on', async (reason) => {
  mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError({ error: reason }) });
  await expect(createShare(input)).resolves.toEqual({ ok: false, reason });
});

test('anything else is a plain failure', async () => {
  mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError({ error: 'server' }) });
  await expect(createShare(input)).resolves.toEqual({ ok: false, reason: 'failed' });
  mockInvoke.mockResolvedValue({ data: null, error: new Error('network') });
  await expect(createShare(input)).resolves.toEqual({ ok: false, reason: 'failed' });
});

test('the notice is read and accepted at the current version', async () => {
  mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(noticeAccepted()).resolves.toBe(false);
  mockMaybeSingle.mockResolvedValueOnce({ data: { version: NOTICE_VERSION }, error: null });
  await expect(noticeAccepted()).resolves.toBe(true);
  expect(mockEq).toHaveBeenCalledWith('version', NOTICE_VERSION);

  mockUpsert.mockResolvedValueOnce({ error: null });
  await acceptNotice('u1');
  expect(mockFrom).toHaveBeenLastCalledWith('notice_acceptances');
  expect(mockUpsert).toHaveBeenCalledWith(
    { account: 'u1', version: NOTICE_VERSION },
    { onConflict: 'account,version', ignoreDuplicates: true },
  );
});

test('a group link is one request, and comes back with each recording in the order sent', async () => {
  const group = {
    shareId: 'g1',
    code: 'abc',
    url: 'https://reprizeapp.com/v/abc',
    expiresAt: 'x',
    cover: [],
    recordings: [
      { shareId: 'r1', uploads: [] },
      { shareId: 'r2', uploads: [] },
    ],
  };
  const body = { kind: 'group' as const, recordings: [{ ...input, cover: false }, { ...input, cover: false }] };
  mockInvoke.mockResolvedValue({ data: group, error: null });
  await expect(createShareGroup(body)).resolves.toEqual({ ok: true, group });
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  expect(mockInvoke).toHaveBeenCalledWith('create-share', { body });
});

test('a group answer missing recordings is a failure; a refusal is passed on', async () => {
  const body = { kind: 'group' as const, recordings: [input, input] };
  mockInvoke.mockResolvedValue({ data: { shareId: 'g1', recordings: [{ shareId: 'r1', uploads: [] }] }, error: null });
  await expect(createShareGroup(body)).resolves.toEqual({ ok: false, reason: 'failed' });
  mockInvoke.mockResolvedValue({ data: null, error: new FunctionsHttpError({ error: 'not_pro' }) });
  await expect(createShareGroup(body)).resolves.toEqual({ ok: false, reason: 'not_pro' });
});
