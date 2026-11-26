import { createFakeClient } from '../fakeClient';
import { createPaymentsStore } from '../store';
import { EMPTY_SNAPSHOT, type Snapshot } from '../types';

const tx = (id: string, purchasedAt = 1) => ({ id, productId: 'single_pass', purchasedAt });
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({ ...EMPTY_SNAPSHOT, ...over });

function memRepo(sessions: Record<string, { paid?: boolean; passTransactionId?: string }> = { s1: {}, s2: {} }, opts: { spent?: string[] } = {}) {
  const spent = new Set<string>(opts.spent ?? []);
  return {
    getSession: jest.fn((id: string) => sessions[id] as any),
    spentPasses: jest.fn(() => new Set(spent)),
    spendPasses: jest.fn((ids: string[]) => ids.forEach((id) => spent.add(id))),
  };
}

const flush = () => new Promise<void>((r) => setImmediate(() => r()));

async function setup(initial: Snapshot = snap(), opts?: { spent?: string[] }) {
  const client = createFakeClient();
  client.snapshot = initial;
  const repo = memRepo(undefined, opts);
  const store = createPaymentsStore(client, repo);
  store.start();
  await flush();
  return { client, repo, store };
}

/**
 * What these tests read as the store's credit state now: Pro, the oldest unused Pass, or the free plan. A Pass is no
 * longer a start decision (it only unlocks a recording already made), so the start itself is Pro or free.
 */
function peek(store: ReturnType<typeof createPaymentsStore>) {
  const o = store.unlockOption();
  return o.kind === 'none' ? { kind: 'free' as const } : o;
}

/** Whether a start re-reads the snapshot: it does only while there is no snapshot or a purchase is unexplained. */
async function startReReads(client: ReturnType<typeof createFakeClient>, store: ReturnType<typeof createPaymentsStore>) {
  const spy = jest.spyOn(client, 'getSnapshot');
  await store.startDecision();
  const called = spy.mock.calls.length > 0;
  spy.mockRestore();
  return called;
}

describe('payments store', () => {
  it('start loads the snapshot and onSnapshot updates and notifies', async () => {
    const { client, store } = await setup(snap({ proActive: true }));
    expect(store.getSnapshot().proActive).toBe(true);
    const fn = jest.fn();
    store.subscribe(fn);
    const v = store.version();
    client.emit(snap({ passTransactions: [tx('a')] }));
    expect(store.getSnapshot().passTransactions).toHaveLength(1);
    expect(fn).toHaveBeenCalled();
    expect(store.version()).not.toBe(v);
  });

  it('purchased with a new transaction becomes a credit and the next start stays free', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    expect(store.nextPlan()).toBe('free');
    client.nextOutcome = 'purchased';
    client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
    const fn = jest.fn();
    store.subscribe(fn);
    await expect(store.showPaywall()).resolves.toBe('purchased');
    expect(store.credits()).toBe(1);
    expect(store.nextPlan()).toBe('free'); // a Pass never makes a start paid
    expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    expect(fn).toHaveBeenCalled();
  });

  it('a Pro purchase makes the next plan paid with no credit', async () => {
    const { client, store } = await setup();
    client.nextOutcome = 'purchased';
    client.snapshot = snap({ proActive: true });
    await store.showPaywall();
    expect(peek(store)).toEqual({ kind: 'pro' });
    expect(store.nextPlan()).toBe('paid');
    expect(store.credits()).toBe(0);
    expect(await startReReads(client, store)).toBe(false);
  });

  it('cancelled leaves nothing pending', async () => {
    const { client, store } = await setup();
    client.nextOutcome = 'cancelled';
    await expect(store.showPaywall()).resolves.toBe('cancelled');
    expect(await startReReads(client, store)).toBe(false);
  });

  it('restored without a new transaction leaves nothing pending', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
    client.nextOutcome = 'restored';
    await store.showPaywall();
    expect(await startReReads(client, store)).toBe(false);
    expect(store.credits()).toBe(1);
  });

  it('failure reading the snapshot after purchased keeps a pending that onSnapshot explains as a credit', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    client.nextOutcome = 'purchased';
    client.failSnapshot = true;
    await expect(store.showPaywall()).resolves.toBe('purchased');
    expect(store.credits()).toBe(0);
    client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
    client.failSnapshot = false;
    expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    expect(await startReReads(client, store)).toBe(false);
  });

  it('a second showPaywall while one is open returns cancelled without calling the client', async () => {
    const { client, store } = await setup();
    const spy = jest.spyOn(client, 'showPaywall');
    client.nextOutcome = 'cancelled';
    const first = store.showPaywall();
    await expect(store.showPaywall()).resolves.toBe('cancelled');
    expect(spy).toHaveBeenCalledTimes(1);
    await first;
  });

  it('restore resolves true when pro became active', async () => {
    const { client, store } = await setup();
    client.snapshot = snap({ proActive: true });
    await expect(store.restore()).resolves.toBe(true);
    expect(store.getSnapshot().proActive).toBe(true);
  });

  it('a stale emit without the new transaction does not clear the pending', async () => {
    const before = snap({ passTransactions: [tx('tx-1')] });
    const { client, store } = await setup(before, { spent: ['tx-1'] });
    client.nextOutcome = 'purchased';
    client.failSnapshot = true;
    await store.showPaywall();
    client.emit(before); // stale
    client.failSnapshot = false;
    client.snapshot = before;
    expect(await startReReads(client, store)).toBe(true);
    client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
    expect(await startReReads(client, store)).toBe(false);
    expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
  });

  it('emit during the paywall followed by a failed read still explains the purchase from current', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    let release!: () => void;
    client.paywallGate = new Promise<void>((r) => (release = r));
    client.nextOutcome = 'purchased';
    const p = store.showPaywall();
    await flush();
    client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
    client.failSnapshot = true;
    release();
    await p;
    client.failSnapshot = false;
    expect(store.credits()).toBe(1);
    expect(await startReReads(client, store)).toBe(false);
  });

  it('a purchased pending blocks the next paywall while the read fails, then is explained once', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    client.nextOutcome = 'purchased';
    client.failSnapshot = true;
    await store.showPaywall();
    const spy = jest.spyOn(client, 'showPaywall');
    await expect(store.showPaywall()).resolves.toBe('error');
    expect(spy).not.toHaveBeenCalled();
    client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2), tx('tx-3', 3)] }));
    expect(store.credits()).toBe(2); // both new passes came from the listener: purchases, not restores
    expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
  });

  it('a stale initial start() read does not overwrite newer listener data', async () => {
    const client = createFakeClient();
    let resolveInitial!: (s: Snapshot) => void;
    client.getSnapshot = () => new Promise<Snapshot>((r) => (resolveInitial = r));
    const store = createPaymentsStore(client, memRepo());
    store.start();
    client.emit(snap({ proActive: true }));
    resolveInitial(snap());
    await flush();
    expect(store.getSnapshot().proActive).toBe(true);
  });

  it('with no snapshot and the pre-read failing, showPaywall returns error without opening the paywall', async () => {
    const client = createFakeClient();
    client.failSnapshot = true;
    const store = createPaymentsStore(client, memRepo());
    store.start();
    await flush();
    const spy = jest.spyOn(client, 'showPaywall');
    await expect(store.showPaywall()).resolves.toBe('error');
    expect(spy).not.toHaveBeenCalled();
    // guard released: once a read works, the paywall opens
    client.failSnapshot = false;
    await expect(store.showPaywall()).resolves.toBe('cancelled');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a throwing showPaywall maps to error and releases the guard', async () => {
    const { client, store } = await setup();
    client.failPaywall = true;
    await expect(store.showPaywall()).resolves.toBe('error');
    client.failPaywall = false;
    client.nextOutcome = 'cancelled';
    await expect(store.showPaywall()).resolves.toBe('cancelled');
  });

  it('a throwing restore resolves false', async () => {
    const { client, store } = await setup();
    client.failRestore = true;
    await expect(store.restore()).resolves.toBe(false);
  });

  it('restored with an unchanged snapshot does not turn a later purchase into a restore', async () => {
    const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
    client.nextOutcome = 'restored';
    await store.showPaywall();
    client.nextOutcome = 'purchased';
    client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
    await store.showPaywall();
    expect(store.credits()).toBe(2);
    expect(repo.spendPasses).not.toHaveBeenCalled();
  });

  it('purchased with no new transaction yet (SDK lag) stays pending until one arrives', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    client.nextOutcome = 'purchased';
    await store.showPaywall();
    expect(store.credits()).toBe(0);
    expect(await startReReads(client, store)).toBe(true);
    client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
    expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    expect(await startReReads(client, store)).toBe(false);
  });

  it('a restored paywall whose read after fails does not mark the next purchase as restored', async () => {
    const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
    client.nextOutcome = 'restored';
    client.failSnapshot = true;
    await store.showPaywall();
    client.failSnapshot = false;
    client.nextOutcome = 'purchased';
    client.snapshot = snap({ passTransactions: [tx('tx-1')] });
    let calls = 0;
    const real = client.showPaywall.bind(client);
    client.showPaywall = async (offering) => {
      calls += 1;
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
      return real(offering);
    };
    await store.showPaywall();
    expect(calls).toBe(1);
    expect(store.credits()).toBe(2);
    expect(repo.spendPasses).not.toHaveBeenCalled();
  });

  it('a pending whose transaction shows in the fresh pre-paywall read is explained there', async () => {
    const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    client.nextOutcome = 'purchased';
    client.failSnapshot = true;
    await store.showPaywall();
    client.failSnapshot = false;
    client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
    client.nextOutcome = 'cancelled';
    await store.showPaywall();
    expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2), tx('old', 0)] });
    await store.restore();
    expect(repo.spentPasses()).toEqual(new Set(['tx-1', 'old']));
    expect(store.credits()).toBe(1);
  });

  it('with a pending and the pre-paywall read failing, showPaywall returns error without opening the paywall', async () => {
    const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
    client.nextOutcome = 'purchased'; // a restore never leaves a pending
    client.failSnapshot = true;
    await store.showPaywall(); // post read fails -> pending
    const spy = jest.spyOn(client, 'showPaywall');
    client.nextOutcome = 'purchased';
    await expect(store.showPaywall()).resolves.toBe('error');
    expect(spy).not.toHaveBeenCalled();
    // guard released and pending kept: once the network is back, the next paywall settles it first
    client.failSnapshot = false;
    client.nextOutcome = 'cancelled';
    await expect(store.showPaywall()).resolves.toBe('cancelled');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a lag pending is dropped by an unchanged pre-paywall read and the next purchase takes the single slot', async () => {
    const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
    client.nextOutcome = 'purchased';
    await store.showPaywall(); // SDK lag: nothing new yet, pending kept
    client.nextOutcome = 'purchased';
    const real = client.showPaywall.bind(client);
    client.showPaywall = async (offering) => {
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
      return real(offering);
    };
    await store.showPaywall();
    expect(await startReReads(client, store)).toBe(false); // tx-2 explained the second purchase
    client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2), tx('tx-3', 3)] })); // the first one, late
    expect(store.credits()).toBe(2);
    expect(repo.spendPasses).not.toHaveBeenCalled();
  });

  describe('the paywall (Pro by default, Pass as credit)', () => {
    it('a purchase that shows up only after the paywall closed (SDK lag) arrives as a credit', async () => {
      const { client, store } = await setup();
      client.nextOutcome = 'purchased';
      await store.showPaywall();
      expect(peek(store)).toEqual({ kind: 'free' });
      client.emit(snap({ passTransactions: [tx('tx-2', 2)] }));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    });

    it('a purchase whose read after fails still notifies with the current snapshot', async () => {
      const { client, store } = await setup();
      client.nextOutcome = 'purchased';
      client.failSnapshot = true;
      const fn = jest.fn();
      store.subscribe(fn);
      await expect(store.showPaywall()).resolves.toBe('purchased');
      expect(fn).toHaveBeenCalled();
    });

    it('a second call while the first is open returns cancelled without calling the client', async () => {
      const { client, store } = await setup();
      let release!: () => void;
      client.paywallGate = new Promise<void>((r) => (release = r));
      const spy = jest.spyOn(client, 'showPaywall');
      const first = store.showPaywall();
      await expect(store.showPaywall()).resolves.toBe('cancelled');
      expect(spy).toHaveBeenCalledTimes(1);
      release();
      await first;
    });

    it('opens the default offering unless told otherwise, and passes the pass offering through', async () => {
      const { client, store } = await setup();
      await store.showPaywall();
      expect(client.lastOffering).toBe('default');
      await store.showPaywall('pass');
      expect(client.lastOffering).toBe('pass');
    });

    it('a throwing pre-read apply maps to error without opening, and releases the guard', async () => {
      const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      client.nextOutcome = 'purchased';
      await store.showPaywall(); // lag: marker open, so the next paywall pre-reads
      repo.spentPasses.mockImplementation(() => {
        throw new Error('storage');
      });
      const spy = jest.spyOn(client, 'showPaywall');
      await expect(store.showPaywall()).resolves.toBe('error');
      expect(spy).not.toHaveBeenCalled();
      repo.spentPasses.mockImplementation(() => new Set(['tx-1']));
      client.nextOutcome = 'cancelled';
      await expect(store.showPaywall()).resolves.toBe('cancelled');
    });

    it('a storage failure after a purchase still resolves purchased and the marker waits', async () => {
      const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      client.nextOutcome = 'purchased';
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
      repo.spentPasses.mockImplementation(() => {
        throw new Error('storage');
      });
      await expect(store.showPaywall()).resolves.toBe('purchased');
      repo.spentPasses.mockImplementation(() => new Set(['tx-1']));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    });
  });

  describe('credits and the start decision', () => {
    it('two credits: the oldest goes first, the count follows the ledger', async () => {
      const { repo, store } = await setup(snap({ passTransactions: [tx('tx-2', 2), tx('tx-1', 1)] }));
      expect(store.credits()).toBe(2);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
      repo.spendPasses(['tx-1']);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
      expect(store.credits()).toBe(1);
    });

    it('Pro with a credit: pro, the credit is kept, the next plan is paid', async () => {
      const { store } = await setup(snap({ proActive: true, passTransactions: [tx('tx-1')] }));
      expect(peek(store)).toEqual({ kind: 'pro' });
      await expect(store.startDecision()).resolves.toEqual({ kind: 'pro' });
      expect(store.credits()).toBe(1);
      expect(store.nextPlan()).toBe('paid');
    });

    it('peekStart: Pro, then nothing is the free plan', async () => {
      const first = await setup(snap({ proActive: true }));
      expect(peek(first.store)).toEqual({ kind: 'pro' });
      const none = await setup();
      expect(peek(none.store)).toEqual({ kind: 'free' });
      expect(none.store.nextPlan()).toBe('free');
    });

    it('peekStart follows the listener when Pro expires', async () => {
      const { client, store } = await setup(snap({ proActive: true }));
      expect(peek(store)).toEqual({ kind: 'pro' });
      client.emit(snap());
      expect(peek(store)).toEqual({ kind: 'free' });
      expect(store.nextPlan()).toBe('free');
    });

    it('peekStart is the empty snapshot decision before any read', () => {
      const client = createFakeClient();
      const store = createPaymentsStore(client, memRepo());
      expect(peek(store)).toEqual({ kind: 'free' });
      expect(store.credits()).toBe(0);
      expect(store.nextPlan()).toBe('free');
    });

    it('startDecision reads first when there is no snapshot yet', async () => {
      const client = createFakeClient();
      client.snapshot = snap({ proActive: true });
      const store = createPaymentsStore(client, memRepo());
      await expect(store.startDecision()).resolves.toEqual({ kind: 'pro' });
      expect(store.getSnapshot().proActive).toBe(true);
    });

    it('startDecision with no snapshot and the read failing decides free and never throws', async () => {
      const client = createFakeClient();
      client.failSnapshot = true;
      const store = createPaymentsStore(client, memRepo());
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
    });

    it('startDecision with the repo throwing decides free and never throws', async () => {
      const { repo, store } = await setup(snap({ passTransactions: [tx('a')] }));
      repo.spentPasses.mockImplementation(() => {
        throw new Error('storage');
      });
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
    });

    it('startDecision with a snapshot and no pending decides without reading', async () => {
      const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
      const spy = jest.spyOn(client, 'getSnapshot');
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
      expect(spy).not.toHaveBeenCalled();
    });

    it('a start never spends a Pass: a double tap starts free twice and both Passes stay credits', async () => {
      const { repo, store } = await setup(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
      const [a, b] = await Promise.all([store.startDecision(), store.startDecision()]);
      expect(a).toEqual({ kind: 'free' });
      expect(b).toEqual(a);
      expect(store.credits()).toBe(2);
      expect(repo.spendPasses).not.toHaveBeenCalled();
    });
  });

  describe('restore never creates a credit', () => {
    it('restore() spends the passes it brings', async () => {
      const { client, repo, store } = await setup();
      client.snapshot = snap({ passTransactions: [tx('old')] });
      await expect(store.restore()).resolves.toBe(false);
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(store.credits()).toBe(0);
      expect(peek(store)).toEqual({ kind: 'free' });
    });

    it('restore() spends passes delivered by the listener while it ran', async () => {
      const { client, repo, store } = await setup();
      client.restore = async () => {
        client.emit(snap({ passTransactions: [tx('old')] }));
        return client.snapshot;
      };
      await store.restore();
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(store.credits()).toBe(0);
    });

    it('restore() with Pro resolves true and the start decision is pro', async () => {
      const { client, store } = await setup();
      client.snapshot = snap({ proActive: true, passTransactions: [tx('old')] });
      await expect(store.restore()).resolves.toBe(true);
      expect(peek(store)).toEqual({ kind: 'pro' });
      expect(store.credits()).toBe(0);
    });

    it('restore() with no snapshot before and its read failing spends every unspent pass it brings', async () => {
      const client = createFakeClient();
      const repo = memRepo();
      const store = createPaymentsStore(client, repo);
      client.snapshot = snap({ passTransactions: [tx('a'), tx('b', 2)] });
      client.getSnapshot = async () => {
        throw new Error('x');
      };
      await store.restore();
      expect(repo.spendPasses).toHaveBeenCalledWith(['a', 'b']);
      expect(store.credits()).toBe(0);
    });

    it('a credit bought earlier stays a credit after a restore that brings nothing new', async () => {
      const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
      expect(store.credits()).toBe(1);
      await store.restore();
      expect(store.credits()).toBe(1);
      expect(repo.spentPasses().has('tx-1')).toBe(false);
      client.nextOutcome = 'restored';
      await store.showPaywall();
      expect(store.credits()).toBe(1);
    });

    it('restored from the paywall spends the new pass', async () => {
      const { client, repo, store } = await setup();
      client.nextOutcome = 'restored';
      client.snapshot = snap({ passTransactions: [tx('old')] });
      await expect(store.showPaywall()).resolves.toBe('restored');
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(store.credits()).toBe(0);
      expect(store.nextPlan()).toBe('free');
    });

    it('restored with the read after failing spends what the listener delivered during the paywall', async () => {
      const { client, repo, store } = await setup();
      let release!: () => void;
      client.paywallGate = new Promise<void>((r) => (release = r));
      client.nextOutcome = 'restored';
      const p = store.showPaywall();
      await flush();
      client.emit(snap({ passTransactions: [tx('old')] }));
      client.failSnapshot = true;
      release();
      await p;
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(store.credits()).toBe(0);
    });

    it('restored Pro from the paywall spends passes too and the plan is paid', async () => {
      const { client, repo, store } = await setup();
      client.nextOutcome = 'restored';
      client.snapshot = snap({ proActive: true, passTransactions: [tx('old')] });
      await store.showPaywall();
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(peek(store)).toEqual({ kind: 'pro' });
    });

    it('a restore while a purchase waits keeps that purchase a credit', async () => {
      const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      client.nextOutcome = 'purchased';
      await store.showPaywall(); // SDK lag: pending
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] });
      await store.restore();
      expect(store.credits()).toBe(1);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    });
  });

  describe('a failed ledger write during a restore (task 3 review)', () => {
    async function withCredit() {
      const t = await setup(snap({ passTransactions: [tx('tx-1')] }));
      const real = t.repo.spendPasses.getMockImplementation()!;
      t.repo.spendPasses.mockImplementation(() => {
        throw new Error('storage');
      });
      t.client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('old', 0)] });
      return { ...t, real };
    }

    it('restore() reports failure and the restored Pass never becomes a credit', async () => {
      const { client, repo, store, real } = await withCredit();
      await expect(store.restore()).resolves.toBe(false);
      expect(store.credits()).toBe(1);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('old', 0)] })); // the listener delivers it again
      expect(store.credits()).toBe(1);
      repo.spendPasses.mockImplementation(real); // storage back: the next update writes it
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('old', 0)] }));
      expect(repo.spentPasses()).toEqual(new Set(['old']));
      expect(store.credits()).toBe(1);
    });

    it('a restored paywall keeps the restored Pass out of the credits', async () => {
      const { client, store } = await withCredit();
      client.nextOutcome = 'restored';
      await store.showPaywall();
      expect(store.credits()).toBe(1);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('old', 0)] }));
      expect(store.credits()).toBe(1);
    });

    it('a restored Pass the listener delivered during restore() stays out of the credits too', async () => {
      const { client, store } = await withCredit();
      client.restore = async () => {
        client.emit(snap({ passTransactions: [tx('tx-1'), tx('old', 0)] }));
        return client.snapshot;
      };
      await expect(store.restore()).resolves.toBe(false);
      expect(store.credits()).toBe(1);
    });
  });

  describe('a purchase waiting for the store', () => {
    async function lagging() {
      const t = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      t.client.nextOutcome = 'purchased';
      await t.store.showPaywall(); // SDK lag: no new transaction yet, pending
      return t;
    }

    it('while pending and unseen, nothing counts as a credit', async () => {
      const { store } = await lagging();
      expect(store.credits()).toBe(0);
      expect(peek(store)).toEqual({ kind: 'free' });
    });

    it('startDecision reads the fresh snapshot and decides the purchase as a credit', async () => {
      const { client, repo, store } = await lagging();
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }); // listener has not emitted yet
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
      expect(repo.spendPasses).not.toHaveBeenCalled();
      expect(store.credits()).toBe(1);
    });

    it('startDecision with the read failing decides free without throwing', async () => {
      const { client, store } = await lagging();
      client.failSnapshot = true;
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
    });

    it('two new passes while pending are both credits, the oldest first', async () => {
      const { client, store } = await lagging();
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-3', 3), tx('tx-2', 2)] }));
      expect(store.credits()).toBe(2);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    });

    it('an existing credit is still usable while a purchase is pending', async () => {
      const t = await setup(snap({ passTransactions: [tx('tx-1')] }));
      t.client.nextOutcome = 'purchased';
      await t.store.showPaywall();
      expect(peek(t.store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
    });
  });

  describe('a lagged purchase keeps its marker (fix round 1)', () => {
    async function laggedCredit() {
      const t = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      t.client.nextOutcome = 'purchased';
      await t.store.showPaywall(); // SDK lag: Y not in the read after
      return t;
    }

    it('a later restore() keeps it as a credit', async () => {
      const { client, store } = await laggedCredit();
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2)] });
      await store.restore();
      expect(store.credits()).toBe(1);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'y' });
    });

    it('a later restore() whose fresh read fails still keeps it as a credit, spending only real restores', async () => {
      const { client, repo, store } = await laggedCredit();
      client.getSnapshot = async () => {
        throw new Error('x');
      };
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('old', 0), tx('y', 2)] });
      await store.restore();
      expect(store.credits()).toBe(1);
      expect(repo.spentPasses().size).toBe(2); // tx-1 + one of the two new ones
    });

    it('the restore button of the next paywall keeps it as a credit', async () => {
      const { client, store } = await laggedCredit();
      client.nextOutcome = 'restored';
      const real = client.showPaywall.bind(client);
      client.showPaywall = async (offering) => {
        client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2)] });
        return real(offering);
      };
      await store.showPaywall();
      expect(store.credits()).toBe(1);
    });

    it('startDecision re-reads and finds it as a credit (never sells a second Pass for one start)', async () => {
      const { client, store } = await laggedCredit();
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2)] }); // listener has not emitted
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'y' });
    });

    it('with the read failing, the next paywall does not open (no second charge)', async () => {
      const { client, store } = await laggedCredit();
      client.failSnapshot = true;
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      const spy = jest.spyOn(client, 'showPaywall');
      await expect(store.showPaywall()).resolves.toBe('error');
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ['cancelled', false],
      ['error', true],
    ] as const)('a next paywall that ends %s (pre-read dropped the marker) gives it back: a later restore keeps it', async (outcome, crash) => {
      const { client, repo, store } = await laggedCredit();
      client.nextOutcome = outcome;
      client.failPaywall = crash;
      await expect(store.showPaywall()).resolves.toBe(outcome); // pre-read succeeds without Y
      client.failPaywall = false;
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2)] });
      await store.restore();
      expect(store.credits()).toBe(1);
      expect(repo.spentPasses().has('y')).toBe(false);
    });

    it('a cancelled paywall gives the dropped marker back: a start still re-reads for it', async () => {
      const { client, store } = await laggedCredit();
      client.nextOutcome = 'cancelled';
      await store.showPaywall(); // pre-read without the pass, then cancelled
      expect(await startReReads(client, store)).toBe(true);
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('y', 2)] }));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'y' });
      expect(await startReReads(client, store)).toBe(false);
    });

    it('a given-back marker whose Pass already arrived during the paywall is explained at once', async () => {
      const { client, repo, store } = await laggedCredit();
      let release!: () => void;
      client.paywallGate = new Promise<void>((r) => (release = r));
      client.nextOutcome = 'cancelled';
      const p = store.showPaywall();
      await flush();
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('y', 2)] }));
      release();
      await p;
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'y' });
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2), tx('old', 0)] });
      await store.restore();
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(store.credits()).toBe(1);
    });

    it('a restore in the next paywall that explains the dropped marker does not give it back', async () => {
      const { client, store } = await laggedCredit();
      client.nextOutcome = 'restored';
      const real = client.showPaywall.bind(client);
      client.showPaywall = async (offering) => {
        client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2)] });
        return real(offering);
      };
      await store.showPaywall();
      const spy = jest.spyOn(client, 'getSnapshot');
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'y' });
      expect(spy).not.toHaveBeenCalled(); // no marker left: no re-read
    });

    it('the listener explaining it clears the marker: a later restore spends only new passes', async () => {
      const { client, repo, store } = await laggedCredit();
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('y', 2)] }));
      client.snapshot = snap({ passTransactions: [tx('tx-1'), tx('y', 2), tx('old', 0)] });
      await store.restore();
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'y' });
    });
  });

  describe('restore with no snapshot yet (fix round 1)', () => {
    function cold(initial: Snapshot) {
      const client = createFakeClient();
      client.snapshot = initial;
      const repo = memRepo();
      const store = createPaymentsStore(client, repo); // start() not called: no snapshot yet
      return { client, repo, store };
    }

    it('restore() reads first so an old unused credit is not spent', async () => {
      const { client, repo, store } = cold(snap({ passTransactions: [tx('credit')] }));
      const real = client.restore.bind(client);
      client.restore = async () => {
        client.snapshot = snap({ passTransactions: [tx('credit'), tx('old', 0)] });
        return real();
      };
      await store.restore();
      expect(repo.spentPasses().has('credit')).toBe(false);
      expect(repo.spentPasses().has('old')).toBe(true);
      expect(store.credits()).toBe(1);
    });

    it('a restored paywall reads first so an old unused credit is not spent', async () => {
      const { client, repo, store } = cold(snap({ passTransactions: [tx('credit')] }));
      client.nextOutcome = 'restored';
      await store.showPaywall();
      expect(repo.spentPasses().has('credit')).toBe(false);
      expect(store.credits()).toBe(1);
    });

    it('restore() falls back to spending every unspent pass only when that read fails', async () => {
      const { client, repo, store } = cold(snap({ passTransactions: [tx('a')] }));
      client.getSnapshot = async () => {
        throw new Error('x');
      };
      await store.restore();
      expect(repo.spentPasses().has('a')).toBe(true);
    });
  });

  describe('sync reads never throw (fix round 1)', () => {
    it('peekStart falls back to free, credits to 0 and nextPlan to free when the repo throws', async () => {
      const { repo, store } = await setup(snap({ passTransactions: [tx('a')] }));
      repo.spentPasses.mockImplementation(() => {
        throw new Error('storage');
      });
      expect(peek(store)).toEqual({ kind: 'free' });
      expect(store.credits()).toBe(0);
      expect(store.nextPlan()).toBe('free');
    });
  });

  describe('races', () => {
    it('pending without a snapshot starts free and keeps the credit (buy, then start from the watch first)', async () => {
      const { client, repo, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      client.nextOutcome = 'purchased';
      await expect(store.showPaywall()).resolves.toBe('purchased'); // the snapshot still lacks the transaction
      const spy = jest.spyOn(client, 'getSnapshot');
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      expect(spy).toHaveBeenCalledTimes(1); // re-read, still without it
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
      expect(repo.spendPasses).not.toHaveBeenCalled();
    });

    it('a start while the paywall is open decides with what is known; the purchase is a credit for the next', async () => {
      const { client, store } = await setup();
      let release!: () => void;
      client.paywallGate = new Promise<void>((r) => (release = r));
      client.nextOutcome = 'purchased';
      const p = store.showPaywall();
      await flush();
      await expect(store.startDecision()).resolves.toEqual({ kind: 'free' });
      client.snapshot = snap({ passTransactions: [tx('tx-2', 2)] });
      release();
      await expect(p).resolves.toBe('purchased');
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
    });

    it('a pending re-read that resolves after the listener explained the purchase does not overwrite it', async () => {
      const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      client.nextOutcome = 'purchased';
      await store.showPaywall(); // lag: pending
      let resolveRead!: (s: Snapshot) => void;
      client.getSnapshot = () => new Promise<Snapshot>((r) => (resolveRead = r));
      const decision = store.startDecision();
      client.emit(snap({ passTransactions: [tx('tx-1'), tx('tx-2', 2)] })); // explains it
      resolveRead(snap({ passTransactions: [tx('tx-1')] })); // stale
      await expect(decision).resolves.toEqual({ kind: 'free' });
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
      expect(store.credits()).toBe(1);
    });

    it('Pro arriving while a credit waits: pro wins and keeps the credit; Pro expiring gives the credit back', async () => {
      const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
      client.emit(snap({ proActive: true, passTransactions: [tx('tx-1')] }));
      expect(peek(store)).toEqual({ kind: 'pro' });
      expect(store.credits()).toBe(1);
      client.emit(snap({ passTransactions: [tx('tx-1')] }));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-1' });
      expect(store.nextPlan()).toBe('free');
    });

    it('the next plan follows Pro with each notification (paid -> free)', async () => {
      const { client, store } = await setup();
      const plans: string[] = [];
      store.subscribe(() => plans.push(store.nextPlan()));
      client.emit(snap({ proActive: true }));
      client.emit(snap({ passTransactions: [tx('tx-1')] }));
      expect(plans).toEqual(['paid', 'free']);
    });

    it('a Pro purchase clears a waiting Pass marker; the late Pass is still a credit', async () => {
      const { client, store } = await setup(snap({ passTransactions: [tx('tx-1')] }), { spent: ['tx-1'] });
      client.nextOutcome = 'purchased';
      await store.showPaywall(); // lag: pending
      client.emit(snap({ proActive: true, passTransactions: [tx('tx-1')] }));
      expect(await startReReads(client, store)).toBe(false);
      client.emit(snap({ proActive: true, passTransactions: [tx('tx-1'), tx('tx-2', 2)] }));
      expect(store.credits()).toBe(1);
    });

    it('a purchase the listener delivers after a cancelled paywall is a credit, not a restore', async () => {
      const { client, repo, store } = await setup();
      client.nextOutcome = 'cancelled';
      await store.showPaywall();
      client.emit(snap({ passTransactions: [tx('tx-2', 2)] }));
      expect(peek(store)).toEqual({ kind: 'credit', passTransactionId: 'tx-2' });
      expect(repo.spendPasses).not.toHaveBeenCalled();
    });
  });
});

describe('unlockOption', () => {
  it('is Pro with Pro, else the oldest unused Pass, else nothing', async () => {
    expect((await setup(snap({ proActive: true }))).store.unlockOption()).toEqual({ kind: 'pro' });
    const { store } = await setup(snap({ passTransactions: [tx('b', 2), tx('a', 1)] }));
    expect(store.unlockOption()).toEqual({ kind: 'credit', passTransactionId: 'a' });
    expect((await setup(snap())).store.unlockOption()).toEqual({ kind: 'none' });
  });

  it('does not offer a Pass that is already spent', async () => {
    const { store } = await setup(snap({ passTransactions: [tx('a')] }), { spent: ['a'] });
    expect(store.unlockOption()).toEqual({ kind: 'none' });
  });
});

describe('refresh', () => {
  it('applies a fresh snapshot and notifies', async () => {
    const { client, store } = await setup();
    const fn = jest.fn();
    store.subscribe(fn);
    client.snapshot = snap({ proActive: true });
    const after = await store.refresh();
    expect(after.proActive).toBe(true);
    expect(store.getSnapshot().proActive).toBe(true);
    expect(fn).toHaveBeenCalled();
  });

  it('returns what is known when the read fails', async () => {
    const { client, store } = await setup(snap({ proActive: true }));
    client.failSnapshot = true;
    const after = await store.refresh();
    expect(after.proActive).toBe(true);
  });
});

