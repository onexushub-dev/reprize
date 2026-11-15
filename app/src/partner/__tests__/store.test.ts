import type { KV } from '../../data/repo';
import type { PartnerDirectory } from '../directory';
import { createPartnerStore } from '../store';

const DIR: PartnerDirectory = { PROFJOAO: { name: 'Prof. João' }, MARIA10: { name: 'Maria' } };

function memKv(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getString: (k) => data.get(k),
    set: (k, v) => void data.set(k, v),
    delete: (k) => void data.delete(k),
  };
}

function setup(over: { kv?: KV; dir?: PartnerDirectory | null } = {}) {
  const kv = over.kv ?? memKv();
  const state = { dir: over.dir === undefined ? DIR : over.dir, now: 1000 };
  const onValid = jest.fn();
  const make = () =>
    createPartnerStore({ kv, directory: async () => state.dir, now: () => state.now, onValid });
  return { kv, state, onValid, store: make(), make };
}

describe('partner store', () => {
  it('applies a valid code and persists it', async () => {
    const { store, make } = setup();
    expect(await store.apply(' profjoao ', 'typed')).toBe('applied');
    expect(store.active()).toEqual({
      code: 'PROFJOAO',
      name: 'Prof. João',
      source: 'typed',
      appliedAt: 1000,
      status: 'valid',
    });
    expect(make().current()?.code).toBe('PROFJOAO'); // a new store on the same storage
  });

  it('accepts a pasted link', async () => {
    const { store } = setup();
    expect(await store.apply('https://reprizeapp.com/p/profjoao', 'typed')).toBe('applied');
    expect(store.current()?.code).toBe('PROFJOAO');
  });

  it('rejects an unknown or malformed code and keeps the previous one', async () => {
    const { store, kv } = setup();
    await store.apply('PROFJOAO', 'link');
    const before = (kv as ReturnType<typeof memKv>).data.get('partner.attribution');
    expect(await store.apply('NOPE123', 'typed')).toBe('invalid');
    expect(await store.apply('x', 'typed')).toBe('invalid');
    expect(store.current()?.code).toBe('PROFJOAO');
    expect((kv as ReturnType<typeof memKv>).data.get('partner.attribution')).toBe(before);
  });

  it('keeps the code as pending when the directory cannot be read, and it changes nothing meanwhile', async () => {
    const { store, onValid } = setup({ dir: null });
    expect(await store.apply('PROFJOAO', 'typed')).toBe('pending');
    expect(store.current()?.status).toBe('pending');
    expect(store.active()).toBeNull();
    expect(onValid).not.toHaveBeenCalled();
  });

  it('confirms a pending code on start, and drops one the directory does not have', async () => {
    const a = setup({ dir: null });
    await a.store.apply('PROFJOAO', 'typed');
    a.state.dir = DIR;
    const again = a.make();
    await again.start();
    expect(again.active()?.name).toBe('Prof. João');
    expect(a.onValid).toHaveBeenCalledTimes(1);

    const b = setup({ dir: null });
    await b.store.apply('GONE999', 'typed');
    b.state.dir = DIR;
    const later = b.make();
    await later.start();
    expect(later.current()).toBeNull();
  });

  it('stays pending when the directory is still unreachable on start', async () => {
    const { store, make } = setup({ dir: null });
    await store.apply('PROFJOAO', 'typed');
    const again = make();
    await again.start();
    expect(again.current()?.status).toBe('pending');
  });

  it('lets a newer valid code replace an older one', async () => {
    const { store, state } = setup();
    await store.apply('PROFJOAO', 'link');
    state.now = 2000;
    await store.apply('MARIA10', 'typed');
    expect(store.active()).toMatchObject({ code: 'MARIA10', appliedAt: 2000, source: 'typed' });
  });

  it('never replaces a code after the first purchase locked it', async () => {
    const { store } = setup();
    await store.apply('PROFJOAO', 'link');
    store.lock();
    expect(store.active()).toBeNull(); // locked: no longer changes the paywall
    expect(store.current()?.lockedAt).toBe(1000);
    expect(await store.apply('MARIA10', 'typed')).toBe('locked');
    expect(store.current()?.code).toBe('PROFJOAO');
  });

  it('does not apply for a customer who already has PRO', async () => {
    const { store } = setup();
    expect(await store.apply('PROFJOAO', 'typed', { blocked: true })).toBe('locked');
    expect(store.current()).toBeNull();
  });

  it('fires onValid when a code is applied and again on every start (the attribute write is retried)', async () => {
    const { store, onValid, make } = setup();
    await store.apply('PROFJOAO', 'link');
    expect(onValid).toHaveBeenCalledTimes(1);
    await make().start();
    expect(onValid).toHaveBeenCalledTimes(2);
    expect(onValid).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'PROFJOAO' }));
  });

  it('tells subscribers when the attribution changes', async () => {
    const { store } = setup();
    const fn = jest.fn();
    store.subscribe(fn);
    await store.apply('PROFJOAO', 'link');
    store.lock();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('survives unreadable and unwritable storage', async () => {
    const broken: KV = {
      getString: () => {
        throw new Error('read');
      },
      set: () => {
        throw new Error('write');
      },
      delete: () => {
        throw new Error('delete');
      },
    };
    const { store } = setup({ kv: broken });
    expect(store.current()).toBeNull();
    expect(await store.apply('PROFJOAO', 'link')).toBe('applied');
    expect(store.active()?.code).toBe('PROFJOAO'); // kept in memory for this run
  });

  it('a throwing onValid never breaks the apply', async () => {
    const { store, onValid } = setup();
    onValid.mockImplementation(() => {
      throw new Error('sdk');
    });
    expect(await store.apply('PROFJOAO', 'link')).toBe('applied');
  });
});
