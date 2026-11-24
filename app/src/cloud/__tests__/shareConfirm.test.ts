import { closeDialog, currentDialog } from '../../components/dialog';
import { type TFunction, translate } from '../../i18n';
import { confirmClipsShare, confirmShare, linkExists } from '../shareConfirm';

jest.mock('../shareGroups', () => ({ shareGroup: jest.fn() }));
const { shareGroup } = jest.requireMock('../shareGroups');

const NOW = 1_000_000;
const shared = (over: Record<string, unknown> = {}) => ({
  shareId: 'sh',
  url: 'u',
  createdAt: 0,
  expiresAt: NOW + 3_600_000,
  clips: 2,
  state: 'active' as const,
  ...over,
});
const group = { groupId: 'g1', url: 'u', createdAt: 0, expiresAt: NOW + 3_600_000, state: 'active', recordings: [{ sessionId: 'a' }, { sessionId: 'b' }] };

beforeEach(() => shareGroup.mockReturnValue(group));

test('a recording with its live link, or in a live group: the link exists', () => {
  expect(linkExists([{ id: 'a', shared: shared() }], NOW)).toBe(true);
  expect(linkExists([{ id: 'a', shared: shared({ groupId: 'g1' }) }], NOW)).toBe(true);
});

test('never shared, turned off, or about to end (a new link is made): asked first', () => {
  expect(linkExists([{ id: 'a' }], NOW)).toBe(false);
  expect(linkExists([{ id: 'a', shared: shared({ state: 'off' }) }], NOW)).toBe(false);
  expect(linkExists([{ id: 'a', shared: shared({ expiresAt: NOW + 60_000 }) }], NOW)).toBe(false);
  expect(linkExists([], NOW)).toBe(false);
});

test('several: only the exact same live group link counts', () => {
  const inGroup = (id: string) => ({ id, shared: shared({ groupId: 'g1' }) });
  expect(linkExists([inGroup('a'), inGroup('b')], NOW)).toBe(true);
  expect(linkExists([inGroup('a'), { id: 'b', shared: shared() }], NOW)).toBe(false);
  expect(linkExists([inGroup('a'), inGroup('b'), inGroup('c')], NOW)).toBe(false);
  shareGroup.mockReturnValue({ ...group, state: 'off' });
  expect(linkExists([inGroup('a'), inGroup('b')], NOW)).toBe(false);
});

describe('confirmShare in the glass dialog (2026-11-23)', () => {
  afterEach(() => closeDialog());
  const t: TFunction = (key, params) => translate('pt-BR', key, params);

  test('no live link: asks first, and Compartilhar goes on', () => {
    const go = jest.fn();
    confirmShare(t, [{ id: 'a' }], 3, go);
    const dialog = currentDialog();
    expect(dialog).toMatchObject({ title: 'Compartilhar esta gravação?', cancel: 'Cancelar', confirm: 'Compartilhar' });
    expect(go).not.toHaveBeenCalled();
    dialog!.onConfirm();
    expect(go).toHaveBeenCalledTimes(1);
  });

  test('a live link opens at once, with no dialog', () => {
    const go = jest.fn();
    confirmShare(t, [{ id: 'a', shared: shared({ expiresAt: Date.now() + 3_600_000 }) }], 3, go);
    expect(go).toHaveBeenCalledTimes(1);
    expect(currentDialog()).toBeUndefined();
  });
});

describe('confirmClipsShare: a link with picked clips (2026-11-23)', () => {
  afterEach(() => closeDialog());
  const t: TFunction = (key, params) => translate('pt-BR', key, params);

  test('no live link: asks "Compartilhar 3 clipes dessa gravação?", and Compartilhar makes it', () => {
    const go = jest.fn();
    const open = jest.fn();
    confirmClipsShare(t, {}, 'Final do torneio', 3, go, open, NOW);
    const dialog = currentDialog()!;
    expect(dialog.title).toBe('Compartilhar 3 clipes dessa gravação?');
    expect(dialog.body).toBe('Vamos criar um link com estes 3 clipes da gravação Final do torneio. Quem tiver o link pode ver e baixar por 24 horas.');
    expect(dialog).toMatchObject({ cancel: 'Cancelar', confirm: 'Compartilhar' });
    dialog.onConfirm();
    expect(go).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  test('a live link of its own: no new link, says so with the hours left, and Ver link opens it', () => {
    const go = jest.fn();
    const open = jest.fn();
    confirmClipsShare(t, { shared: shared({ expiresAt: NOW + 17.2 * 3_600_000 }) }, 'Final', 2, go, open, NOW);
    const dialog = currentDialog()!;
    expect(dialog.title).toBe('Esta gravação já tem um compartilhamento ativo');
    expect(dialog.body).toBe('O link vale por mais 18h. Para enviar outros clipes, desligue o link atual.');
    expect(dialog).toMatchObject({ cancel: 'Fechar', confirm: 'Ver link' });
    dialog.onConfirm();
    expect(open).toHaveBeenCalledTimes(1);
    expect(go).not.toHaveBeenCalled();
  });

  test('inside a live group link: the same notice, with the group link\'s hours', () => {
    shareGroup.mockReturnValue({ ...group, expiresAt: NOW + 30 * 60_000 });
    confirmClipsShare(t, { shared: shared({ groupId: 'g1', expiresAt: NOW + 20 * 3_600_000 }) }, 'Final', 2, jest.fn(), jest.fn(), NOW);
    expect(currentDialog()).toMatchObject({
      title: 'Esta gravação já tem um compartilhamento ativo',
      body: 'O link vale por mais 1h. Para enviar outros clipes, desligue o link atual.',
    });
  });

  test('a link turned off or about to end does not count: asks to make a new one', () => {
    confirmClipsShare(t, { shared: shared({ state: 'off' }) }, 'Final', 1, jest.fn(), jest.fn(), NOW);
    expect(currentDialog()!.title).toBe('Compartilhar 1 clipe dessa gravação?');
  });
});
