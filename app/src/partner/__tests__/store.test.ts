import type { KV } from '../../data/repo';
import type { PartnerDirectory } from '../directory';
import { createPartnerStore } from '../store';

const DIR: PartnerDirectory = {
  PROFJOAO: { name: 'Prof. João', offering: 'partner_p20', discountPercent: 20 },
  MARIA10: { name: 'Maria', offering: 'partner_p10', discountPercent: 10 },
};
const MOVED: PartnerDirectory = { PROFJOAO: { name: 'Prof. João', offering: 'partner_p30', discountPercent: 30 } };

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
      offering: 'partner_p20',
      discountPercent: 20,
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

describe('a code applied offline beside a valid attribution', () => {
  it('does not replace it, and is confirmed later', async () => {
    const { store, state, onValid } = setup();
    await store.apply('PROFJOAO', 'link');
    state.dir = null;
    expect(await store.apply('MARIA10', 'typed')).toBe('pending');
    expect(store.active()?.code).toBe('PROFJOAO'); // the discount in hand stays
    expect(store.pending()).toBe(true);
    await store.start(); // still offline
    expect(store.active()?.code).toBe('PROFJOAO');
    state.dir = DIR;
    onValid.mockClear();
    await store.start();
    expect(store.active()).toMatchObject({ code: 'MARIA10', source: 'typed', status: 'valid' });
    expect(store.pending()).toBe(false);
    expect(onValid).toHaveBeenCalledWith(expect.objectContaining({ code: 'MARIA10' }));
  });

  it('an offline typo is dropped on confirmation and the valid attribution stays', async () => {
    const { store, state, make } = setup();
    await store.apply('PROFJOAO', 'link');
    state.dir = null;
    await store.apply('TYPO123', 'typed');
    state.dir = DIR;
    const again = make(); // the candidate survives a restart
    expect(again.pending()).toBe(true);
    await again.start();
    expect(again.active()?.code).toBe('PROFJOAO');
    expect(again.pending()).toBe(false);
  });

  it('a purchase that locked the attribution drops the candidate', async () => {
    const { store, state } = setup();
    await store.apply('PROFJOAO', 'link');
    state.dir = null;
    await store.apply('MARIA10', 'typed');
    store.lock();
    state.dir = DIR;
    await store.start();
    expect(store.current()?.code).toBe('PROFJOAO');
    expect(store.pending()).toBe(false);
  });

  describe('price tier', () => {
    it('applied code stores its tier', async () => {
      const { store } = setup();
      await store.apply('PROFJOAO', 'link');
      expect(store.current()).toMatchObject({ offering: 'partner_p20', discountPercent: 20 });
    });

    it('a pending code gets its tier when confirmed', async () => {
      const a = setup({ dir: null });
      await a.store.apply('PROFJOAO', 'typed');
      a.state.dir = DIR;
      await a.store.start();
      expect(a.store.active()).toMatchObject({ offering: 'partner_p20', discountPercent: 20 });
    });

    it('start moves an unlocked attribution to the new tier', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.onValid.mockClear();
      a.state.dir = MOVED;
      await a.store.start();
      expect(a.store.current()).toMatchObject({ offering: 'partner_p30', discountPercent: 30 });
      expect(a.make().current()?.offering).toBe('partner_p30');
      expect(a.onValid).toHaveBeenCalledTimes(1);
      expect(a.onValid).toHaveBeenCalledWith(expect.objectContaining({ offering: 'partner_p30' }));
    });

    it('start never changes a locked attribution', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.store.lock();
      a.state.dir = MOVED;
      await a.store.start();
      expect(a.store.current()).toMatchObject({ offering: 'partner_p20', discountPercent: 20 });
    });

    it('start offline keeps the saved tier', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.state.dir = null;
      await a.store.start();
      expect(a.store.current()).toMatchObject({ offering: 'partner_p20', discountPercent: 20 });
    });

    it('a code that left the directory keeps its credit but no longer offers a discount', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.state.dir = {};
      await a.store.start();
      expect(a.store.current()?.code).toBe('PROFJOAO');
      expect(a.store.current()?.offering).toBeUndefined();
      expect(a.store.active()).toBeNull();
      a.state.dir = DIR;
      await a.store.start();
      expect(a.store.active()?.offering).toBe('partner_p20');
    });

    it('offline, a saved offer stays', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.state.dir = null;
      await a.store.start();
      expect(a.store.active()?.offering).toBe('partner_p20');
    });

    it('with PRO, an unlocked attribution is neither moved nor announced', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.onValid.mockClear();
      a.state.dir = MOVED;
      await a.store.start({ pro: true });
      expect(a.store.current()?.offering).toBe('partner_p20');
      expect(a.onValid).not.toHaveBeenCalled();
    });

    it('with PRO, a waiting code is dropped and never confirmed', async () => {
      const a = setup({ dir: null });
      await a.store.apply('PROFJOAO', 'typed');
      a.state.dir = DIR;
      await a.store.start({ pro: true });
      expect(a.store.current()).toBeNull();
      expect(a.onValid).not.toHaveBeenCalled();
    });

    it('with the purchases unknown, a waiting code keeps waiting', async () => {
      const a = setup({ dir: null });
      await a.store.apply('PROFJOAO', 'typed');
      a.state.dir = DIR;
      await a.store.start({ pro: null });
      expect(a.store.current()?.status).toBe('pending');
      expect(a.onValid).not.toHaveBeenCalled();
    });

    it('a newer code applied during the directory read is not replaced by the older one', async () => {
      const kv = memKv();
      let release: (d: PartnerDirectory) => void = () => {};
      let answer: () => Promise<PartnerDirectory | null> = async () => null;
      const onValid = jest.fn();
      const store = createPartnerStore({ kv, directory: () => answer(), now: () => 1, onValid });
      await store.apply('PROFJOAO', 'link');
      answer = () => new Promise((r) => (release = r));
      const starting = store.start();
      answer = async () => DIR;
      await store.apply('MARIA10', 'typed');
      release(DIR);
      await starting;
      expect(store.current()?.code).toBe('MARIA10');
      expect(onValid).not.toHaveBeenCalledWith(expect.objectContaining({ code: 'PROFJOAO' }));
    });

    it('a tier refresh keeps a candidate code waiting beside the attribution', async () => {
      const a = setup();
      await a.store.apply('PROFJOAO', 'link');
      a.state.dir = null;
      await a.store.apply('MARIA10', 'typed');
      a.state.dir = { ...DIR, PROFJOAO: MOVED.PROFJOAO };
      await a.store.start();
      expect(a.store.current()?.code).toBe('MARIA10');
    });
  });
});
