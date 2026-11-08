import { createRepo, type FileProbe, type KV } from '../repo';

function memoryKV(map = new Map<string, string>()): KV {
  return {
    getString: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  };
}

function fakeFiles(sizes: Record<string, number>): FileProbe {
  return { exists: (p) => p in sizes, sizeBytes: (p) => sizes[p] ?? 0 };
}

function setup(sizes: Record<string, number> = {}) {
  let n = 0;
  return createRepo(memoryKV(), fakeFiles(sizes), () => `id-${++n}`);
}

test('prefs default to onboarding not done, Quadra, ultra-wide, gesture on, sound and flash on, battery saving on (camera and remote)', () => {
  expect(setup().getPrefs()).toEqual({
    onboardingDone: false,
    sport: 'quadra',
    lens: 'ultraWide',
    gestureEnabled: true,
    soundOnSave: true,
    flashOnSave: true,
    voiceEnabled: false,
    screenEconomy: true,
    remoteEconomy: true,
    remoteVoice: true,
  });
});

test('setPrefs merges and persists', () => {
  const repo = setup();
  repo.setPrefs({ sport: 'futevolei' });
  expect(repo.getPrefs().sport).toBe('futevolei');
  expect(repo.getPrefs().gestureEnabled).toBe(true);
});

test('addClip sets the default trim to the last 30s', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1 });
  const s = repo.startSession('beachTennis', 1000, { paid: false });
  const long = repo.addClip({ sessionId: s.id, createdAt: 2000, source: 'screen', path: '/a.mp4', durationMs: 60000 });
  const short = repo.addClip({ sessionId: s.id, createdAt: 3000, source: 'gesture', path: '/b.mp4', durationMs: 12000 });
  expect(long.trim).toEqual({ startMs: 30000, endMs: 60000 });
  expect(short.trim).toEqual({ startMs: 0, endMs: 12000 });
});

test('addClip remembers the first cut as the part of the file the clip may show', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1 });
  const s = repo.startSession('beachTennis', 1000, { paid: false });
  const cut = repo.addClip({ sessionId: s.id, createdAt: 2000, source: 'screen', path: '/a.mp4', durationMs: 60000 }, 13000);
  const whole = repo.addClip({ sessionId: s.id, createdAt: 3000, source: 'screen', path: '/b.mp4', durationMs: 12000 });
  expect(cut.trim).toEqual({ startMs: 47000, endMs: 60000 });
  expect(cut.bounds).toEqual({ startMs: 47000, endMs: 60000 });
  expect(whole.bounds).toEqual({ startMs: 0, endMs: 12000 });
});

test('clips are numbered in the order they were saved, and deleting one does not renumber the others', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1, '/c.mp4': 1, '/d.mp4': 1 });
  const s = repo.startSession('beachTennis', 0, { paid: false });
  const add = (path: string, at: number) => repo.addClip({ sessionId: s.id, createdAt: at, source: 'screen', path, durationMs: 1 });
  const first = add('/a.mp4', 1);
  const second = add('/b.mp4', 2);
  const third = add('/c.mp4', 3);
  expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);

  repo.deleteClip(first.id);
  expect(repo.getClip(second.id)!.number).toBe(2);
  expect(add('/d.mp4', 4).number).toBe(4);
});

test('numbers are counted per recording', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1 });
  const one = repo.startSession('beachTennis', 0, { paid: false });
  const two = repo.startSession('beachTennis', 10, { paid: false });
  repo.addClip({ sessionId: one.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  const other = repo.addClip({ sessionId: two.id, createdAt: 11, source: 'screen', path: '/b.mp4', durationMs: 1 });
  expect(other.number).toBe(1);
});

test('listClips returns clips of one session oldest first', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1, '/c.mp4': 1 });
  const s1 = repo.startSession('beachTennis', 0, { paid: false });
  const s2 = repo.startSession('outro', 0, { paid: false });
  repo.addClip({ sessionId: s1.id, createdAt: 20, source: 'screen', path: '/b.mp4', durationMs: 1 });
  repo.addClip({ sessionId: s2.id, createdAt: 5, source: 'screen', path: '/c.mp4', durationMs: 1 });
  repo.addClip({ sessionId: s1.id, createdAt: 10, source: 'remote', path: '/a.mp4', durationMs: 1 });
  expect(repo.listClips(s1.id).map((c) => c.path)).toEqual(['/a.mp4', '/b.mp4']);
});

test('listClips drops clips whose file is gone', () => {
  const repo = setup({ '/kept.mp4': 1 });
  const s = repo.startSession('beachTennis', 0, { paid: false });
  repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/gone.mp4', durationMs: 1 });
  repo.addClip({ sessionId: s.id, createdAt: 2, source: 'screen', path: '/kept.mp4', durationMs: 1 });
  expect(repo.listClips(s.id).map((c) => c.path)).toEqual(['/kept.mp4']);
});

test('deleteClip removes it from the list', () => {
  const repo = setup({ '/a.mp4': 1 });
  const s = repo.startSession('beachTennis', 0, { paid: false });
  const c = repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  repo.deleteClip(c.id);
  expect(repo.listClips(s.id)).toEqual([]);
});

test('sessionStats sums sizes of existing clips and the recorded time', () => {
  const repo = setup({ '/a.mp4': 1_000_000, '/b.mp4': 2_000_000 });
  const s = repo.startSession('beachTennis', 10_000, { paid: false });
  repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  repo.addClip({ sessionId: s.id, createdAt: 2, source: 'screen', path: '/b.mp4', durationMs: 1 });
  repo.addClip({ sessionId: s.id, createdAt: 3, source: 'screen', path: '/gone.mp4', durationMs: 1 });
  expect(repo.sessionStats(s.id)).toEqual({ clips: 2, bytes: 3_000_000, recordedMs: 0 });
  repo.endSession(s.id, 70_000);
  expect(repo.sessionStats(s.id).recordedMs).toBe(60_000);
});

test('notifies subscribers and bumps the version when clips change', () => {
  const repo = setup({ '/a.mp4': 1 });
  const s = repo.startSession('beachTennis', 0, { paid: false });
  const fn = jest.fn();
  const off = repo.subscribe(fn);
  const before = repo.version();

  const c = repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  repo.deleteClip(c.id);

  expect(fn).toHaveBeenCalledTimes(2);
  expect(repo.version()).toBe(before + 2);
  off();
  repo.endSession(s.id, 5);
  expect(fn).toHaveBeenCalledTimes(2);
});

test('renameSession trims and stores the name', () => {
  const repo = setup();
  const s = repo.startSession('futevolei', 0, { paid: false });
  expect(repo.renameSession(s.id, '  Final do torneio  ').name).toBe('Final do torneio');
  expect(repo.getSession(s.id)?.name).toBe('Final do torneio');
});

test('a blank name removes it', () => {
  const repo = setup();
  const s = repo.startSession('futevolei', 0, { paid: false });
  repo.renameSession(s.id, 'Treino');
  expect(repo.renameSession(s.id, '   ').name).toBeUndefined();
});

test('names are cut at 40 characters', () => {
  const repo = setup();
  const s = repo.startSession('futevolei', 0, { paid: false });
  expect(repo.renameSession(s.id, 'x'.repeat(60)).name).toHaveLength(40);
});

test('listSessions skips games without clips and lists newest first', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1 });
  const old = repo.startSession('beachTennis', 1000, { paid: false });
  repo.startSession('outro', 2000, { paid: false }); // no clips
  const recent = repo.startSession('futevolei', 3000, { paid: false });
  repo.addClip({ sessionId: old.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  repo.addClip({ sessionId: recent.id, createdAt: 2, source: 'screen', path: '/b.mp4', durationMs: 1 });
  const games = repo.listSessions();
  expect(games.map((g) => g.session.id)).toEqual([recent.id, old.id]);
  expect(games[0]).toMatchObject({ clips: 1, firstClip: { path: '/b.mp4' } });
});

test('updateClip stores the new trim and edit', () => {
  const repo = setup({ '/a.mp4': 1 });
  const s = repo.startSession('beachTennis', 0, { paid: false });
  const c = repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 60000 });
  repo.updateClip(c.id, { trim: { startMs: 10000, endMs: 25000 }, edit: { slowmo: true, muted: false } });
  expect(repo.getClip(c.id)).toMatchObject({ trim: { startMs: 10000, endMs: 25000 }, edit: { slowmo: true, muted: false } });
});

test('listSessions finds games stored before the game index existed', () => {
  const map = new Map<string, string>();
  const old = { id: 'old', sport: 'beachTennis', startedAt: 5, endedAt: 9 };
  map.set('reprize:v1:session:old', JSON.stringify(old));
  map.set('reprize:v1:clip:c1', JSON.stringify({ id: 'c1', sessionId: 'old', createdAt: 6, source: 'screen', path: '/a.mp4', durationMs: 1, trim: { startMs: 0, endMs: 1 } }));
  map.set('reprize:v1:clips-of:old', JSON.stringify(['c1']));
  const repo = createRepo(memoryKV(map), fakeFiles({ '/a.mp4': 1 }), () => 'x');
  expect(repo.listSessions().map((g) => g.session.id)).toEqual(['old']);
});

test('updateClip on a deleted clip does nothing', () => {
  const map = new Map<string, string>();
  const repo = createRepo(memoryKV(map), fakeFiles({}), () => 'x');
  expect(repo.updateClip('gone', { trim: { startMs: 0, endMs: 1 } })).toBeUndefined();
  expect(map.size).toBe(0);
});

test('addClip with a 60s default cut on a 120s clip', () => {
  const repo = setup({ '/a.mp4': 1 });
  const s = repo.startSession('musculacao', 0, { paid: false });
  const c = repo.addClip({ sessionId: s.id, createdAt: 1, source: 'voice', path: '/a.mp4', durationMs: 120000 }, 60000);
  expect(c.trim).toEqual({ startMs: 60000, endMs: 120000 });
});

test('renameClip trims and stores the name; a blank name removes it; names are cut at 40', () => {
  const repo = setup({ '/a.mp4': 1 });
  const s = repo.startSession('quadra', 0, { paid: false });
  const clip = repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  expect(repo.renameClip(clip.id, '  Ace no fundo  ')?.name).toBe('Ace no fundo');
  expect(repo.getClip(clip.id)?.name).toBe('Ace no fundo');
  expect(repo.renameClip(clip.id, 'x'.repeat(60))?.name).toHaveLength(25);
  expect(repo.renameClip(clip.id, '   ')?.name).toBeUndefined();
});

test('renameClip on a deleted clip does nothing', () => {
  const repo = setup();
  expect(repo.renameClip('gone', 'x')).toBeUndefined();
});

test('a clip stored with the old locked: true lists normally', () => {
  const map = new Map<string, string>();
  const repo = createRepo(memoryKV(map), fakeFiles({ '/a.mp4': 1 }), () => 'id-1');
  const s = repo.startSession('quadra', 0, { paid: false });
  const c = repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  const k = [...map.keys()].find((x) => map.get(x)?.includes(c.path) && x.includes(c.id))!;
  map.set(k, JSON.stringify({ ...JSON.parse(map.get(k)!), locked: true }));
  expect(repo.listClips(s.id).map((x) => x.id)).toEqual([c.id]);
  expect(repo.sessionStats(s.id).clips).toBe(1);
});

test('deleteSession removes the game, its clips and the index entry, and returns the files to delete', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1 });
  const s = repo.startSession('beachTennis', 0, { paid: false });
  repo.addClip({ sessionId: s.id, createdAt: 1, source: 'screen', path: '/a.mp4', durationMs: 1 });
  repo.addClip({ sessionId: s.id, createdAt: 2, source: 'screen', path: '/b.mp4', durationMs: 1 });
  expect(repo.deleteSession(s.id)).toEqual(['/a.mp4', '/b.mp4']);
  expect(repo.getSession(s.id)).toBeUndefined();
  expect(repo.listClips(s.id)).toEqual([]);
  expect(repo.listSessions()).toEqual([]);
});

test('spentPasses migrates from existing sessions when the key is missing', () => {
  const map = new Map<string, string>();
  map.set('reprize:v1:session:a', JSON.stringify({ id: 'a', sport: 'quadra', startedAt: 1, passTransactionId: 'old' }));
  map.set('reprize:v1:session:b', JSON.stringify({ id: 'b', sport: 'quadra', startedAt: 2 }));
  const repo = createRepo(memoryKV(map), fakeFiles({}), () => 'x');
  expect([...repo.spentPasses()]).toEqual(['old']);
  expect(map.has('reprize:v1:spentPasses')).toBe(true);
});

test('spendPasses dedupes and only notifies on change', () => {
  const repo = setup();
  const fn = jest.fn();
  repo.subscribe(fn);
  repo.spendPasses(['a', 'a', 'b']);
  expect([...repo.spentPasses()].sort()).toEqual(['a', 'b']);
  expect(fn).toHaveBeenCalledTimes(1);
  repo.spendPasses(['a']);
  expect(fn).toHaveBeenCalledTimes(1);
});

const legacy = () => {
  const map = new Map<string, string>();
  map.set('reprize:v1:session:a', JSON.stringify({ id: 'a', sport: 'quadra', startedAt: 1, passTransactionId: 'old' }));
  return map;
};
const repoOver = (map: Map<string, string>) => createRepo(memoryKV(map), fakeFiles({}), () => 'new');

test('deleting a legacy paid game before any ledger read keeps its id spent', () => {
  const repo = repoOver(legacy());
  repo.deleteSession('a');
  expect(repo.spentPasses().has('old')).toBe(true);
});

test('spentPasses rebuilds from games when the ledger is corrupt or not an array', () => {
  for (const bad of ['{not json', '{"a":1}']) {
    const map = legacy();
    map.set('reprize:v1:spentPasses', bad);
    expect([...repoOver(map).spentPasses()]).toEqual(['old']);
  }
});

test('a corrupt game record does not break migration or startSession', () => {
  const map = legacy();
  map.set('reprize:v1:session:bad', '{oops');
  const repo = repoOver(map);
  expect(() => repo.startSession('quadra', 5, { paid: true })).not.toThrow();
  expect(repo.spentPasses().has('old')).toBe(true);
});

test('fresh install: empty ledger', () => {
  const repo = setup();
  expect(repo.spentPasses().size).toBe(0);
});

test('an existing ledger key is left alone', () => {
  const map = legacy();
  map.set('reprize:v1:spentPasses', JSON.stringify(['kept']));
  expect([...repoOver(map).spentPasses()]).toEqual(['kept']);
});

test('startSession during migration keeps the ledger as it was', () => {
  const map = legacy();
  const repo = repoOver(map);
  repo.startSession('quadra', 5, { paid: true });
  expect([...repo.spentPasses()]).toEqual(['old']);
});


test('startSession records paid: false and no passTransactionId for a free game', () => {
  const repo = setup();
  const s = repo.startSession('quadra', 1, { paid: false });
  expect(s.paid).toBe(false);
  expect('passTransactionId' in s).toBe(false);
  expect(repo.getSession(s.id)?.paid).toBe(false);
});

test('startSession paid without a pass (Pro) spends nothing', () => {
  const repo = setup();
  const fn = jest.fn();
  repo.subscribe(fn);
  const s = repo.startSession('quadra', 1, { paid: true });
  expect(s.paid).toBe(true);
  expect(repo.spentPasses().size).toBe(0);
  expect(fn).toHaveBeenCalledTimes(1);
});

test('deleting a recording never gives the pass back', () => {
  const repo = setup();
  const s = repo.startSession('quadra', 1, { paid: false });
  repo.upgradeSession(s.id, { passTransactionId: 'tx-1' });
  repo.deleteSession(s.id);
  expect(repo.spentPasses().has('tx-1')).toBe(true);
});

test('startSession does not write the first-session marker', () => {
  const map = new Map<string, string>();
  const repo = createRepo(memoryKV(map), fakeFiles({}), () => 'id-1');
  repo.startSession('quadra', 1, { paid: false });
  expect(map.get('reprize:v1:firstSessionUsed')).toBeUndefined();
});

test('a legacy game has no paid flag and the migration still ledgers its pass', () => {
  const repo = repoOver(legacy());
  expect(repo.getSession('a')?.paid).toBeUndefined();
  expect([...repo.spentPasses()]).toEqual(['old']);
});

test('startSession keeps no free counter', () => {
  const map = new Map<string, string>();
  const repo = createRepo(memoryKV(map), fakeFiles({}), () => 'id-1');
  repo.startSession('quadra', new Date(2026, 9, 5).getTime(), { paid: false });
  expect([...map.keys()].some((k) => k.includes('freeCount'))).toBe(false);
});

describe('markFreeNoticeShown', () => {
  it('records it once on the recording and notifies once', () => {
    const repo = setup();
    const s = repo.startSession('quadra', 1, { paid: false });
    const fn = jest.fn();
    repo.subscribe(fn);
    repo.markFreeNoticeShown(s.id);
    repo.markFreeNoticeShown(s.id);
    expect(repo.getSession(s.id)?.freeNoticeShown).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a missing recording', () => {
    const repo = setup();
    expect(() => repo.markFreeNoticeShown('gone')).not.toThrow();
  });
});

test('updateClip stores the Modo Foco status and never brings back a deleted clip', () => {
  const repo = setup({ '/c/1.mp4': 10 });
  const clip = repo.addClip({ sessionId: 's', createdAt: 1, source: 'screen', path: '/c/1.mp4', durationMs: 60000 });
  const focus = { v: 1 as const, status: 'ready' as const, file: '/c/1.focus.json' };
  expect(repo.updateClip(clip.id, { focus })!.focus).toEqual(focus);
  expect(repo.getClip(clip.id)!.focus).toEqual(focus);
  repo.deleteClip(clip.id);
  expect(repo.updateClip(clip.id, { focus })).toBeUndefined();
  expect(repo.getClip(clip.id)).toBeUndefined();
});

describe('clips left by the removed cut suggestion (2026-11-01)', () => {
  function setupOld() {
    let n = 0;
    const map = new Map<string, string>();
    const kv = memoryKV(map);
    const repo = createRepo(kv, { exists: () => true, sizeBytes: () => 1 }, () => `id-${++n}`);
    const session = repo.startSession('quadra', 1000, { paid: false });
    const add = (createdAt: number) =>
      repo.addClip({ sessionId: session.id, createdAt, source: 'remote', path: `/c/${createdAt}.mp4`, durationMs: 60000 });
    const bounds = { startMs: 30000, endMs: 60000 };
    const suggested = { startMs: 48000, endMs: 60000 };
    /** Writes a clip as the old app left it: `cutSuggestion` stored, and maybe applied as its cut. */
    const old = (id: string, trim: { startMs: number; endMs: number }) => {
      const k = `reprize:v1:clip:${id}`;
      const clip = JSON.parse(map.get(k) as string);
      map.set(k, JSON.stringify({ ...clip, bounds, trim, cutSuggestion: suggested }));
    };
    return { repo, add, old, bounds, suggested };
  }

  test('a clip the suggestion had cut goes back to the cut it was saved with', () => {
    const { repo, add, old, bounds, suggested } = setupOld();
    const clip = add(2000);
    old(clip.id, suggested);
    expect(repo.forgetCutSuggestions()).toBe(1);
    const after = repo.getClip(clip.id) as Record<string, unknown>;
    expect(after.trim).toEqual(bounds);
    expect('cutSuggestion' in after).toBe(false);
  });

  test("a cut the player chose stays, only the old field goes; a second run changes nothing", () => {
    const { repo, add, old } = setupOld();
    const clip = add(2000);
    const chosen = { startMs: 35000, endMs: 50000 };
    old(clip.id, chosen);
    expect(repo.forgetCutSuggestions()).toBe(1);
    expect(repo.getClip(clip.id)!.trim).toEqual(chosen);
    expect(repo.forgetCutSuggestions()).toBe(0);
  });
});

describe('clips after iOS moved the app folder', () => {
  // iOS can give the app a new data folder on reinstall: same files, new absolute path.
  const oldDocs = '/var/mobile/Containers/Data/Application/OLD-ID/Documents/';
  const newDocs = '/var/mobile/Containers/Data/Application/NEW-ID/Documents/';

  function setupMoved(existing: string[]) {
    const sizes: Record<string, number> = {};
    for (const p of existing) sizes[p] = 10;
    let n = 0;
    const kv = memoryKV();
    const write = createRepo(kv, { exists: () => true, sizeBytes: () => 1 }, () => `id-${++n}`);
    const session = write.startSession('quadra', 1000, { paid: false });
    const a = write.addClip({ sessionId: session.id, createdAt: 2000, source: 'screen', path: `${oldDocs}clips/a.mp4`, durationMs: 60000 });
    write.updateClip(a.id, { focus: { v: 1, status: 'ready', file: `${oldDocs}clips/a.focus.json` } });
    const b = write.addClip({ sessionId: session.id, createdAt: 3000, source: 'screen', path: `${oldDocs}clips/b.mp4`, durationMs: 60000 });
    const repo = createRepo(kv, fakeFiles(sizes), () => `id-${++n}`);
    return { repo, session, a, b };
  }

  test('a clip found in the new folder gets its new path back, and its game shows again', () => {
    const { repo, session, a } = setupMoved([`${newDocs}clips/a.mp4`]);
    expect(repo.listSessions()).toHaveLength(0);
    expect(repo.relocateClips(newDocs)).toBe(1);
    expect(repo.getClip(a.id)!.path).toBe(`${newDocs}clips/a.mp4`);
    expect(repo.getClip(a.id)!.focus!.file).toBe(`${newDocs}clips/a.focus.json`);
    expect(repo.listSessions().map((g) => g.session.id)).toEqual([session.id]);
  });

  test('a clip whose file is gone everywhere is left as it was', () => {
    const { repo, b } = setupMoved([`${newDocs}clips/a.mp4`]);
    repo.relocateClips(newDocs);
    expect(repo.getClip(b.id)!.path).toBe(`${oldDocs}clips/b.mp4`);
  });

  test('clips already in place are not touched', () => {
    const { repo } = setupMoved([`${oldDocs}clips/a.mp4`, `${oldDocs}clips/b.mp4`]);
    expect(repo.relocateClips(newDocs)).toBe(0);
  });
});

describe('upgradeSession', () => {
  it('makes a free recording paid and notifies once', () => {
    const repo = setup();
    const s = repo.startSession('quadra', 1, { paid: false });
    const fn = jest.fn();
    repo.subscribe(fn);
    const next = repo.upgradeSession(s.id, {});
    expect(next?.paid).toBe(true);
    expect(repo.getSession(s.id)?.paid).toBe(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('with a Pass it spends it on that recording', () => {
    const repo = setup();
    const s = repo.startSession('quadra', 1, { paid: false });
    repo.upgradeSession(s.id, { passTransactionId: 'tx-7' });
    expect(repo.getSession(s.id)?.passTransactionId).toBe('tx-7');
    expect(repo.spentPasses().has('tx-7')).toBe(true);
  });

  it('does nothing for a recording that is gone', () => {
    expect(setup().upgradeSession('nope', {})).toBeUndefined();
  });
});

test('closeOpenSessions ends a recording a closed app left open, at its last clip, or at its start without clips', () => {
  const repo = setup({ '/a.mp4': 1, '/b.mp4': 1 });
  const withClips = repo.startSession('futevolei', 1000, { paid: false });
  repo.addClip({ sessionId: withClips.id, createdAt: 5000, source: 'remote', path: '/a.mp4', durationMs: 60000 }, 15000);
  repo.addClip({ sessionId: withClips.id, createdAt: 9000, source: 'gesture', path: '/b.mp4', durationMs: 60000 }, 15000);
  const empty = repo.startSession('futevolei', 20000, { paid: false });
  const ended = repo.startSession('futevolei', 30000, { paid: false });
  repo.endSession(ended.id, 40000);

  expect(repo.closeOpenSessions()).toBe(2);

  expect(repo.getSession(withClips.id)!.endedAt).toBe(9000);
  expect(repo.getSession(empty.id)!.endedAt).toBe(20000);
  expect(repo.getSession(ended.id)!.endedAt).toBe(40000);
  expect(repo.closeOpenSessions()).toBe(0);
});
