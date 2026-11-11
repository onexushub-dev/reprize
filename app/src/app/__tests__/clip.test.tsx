import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Image } from 'react-native';
import { sessionSummary, track } from '../../analytics';

import { forgetShapes } from '../../components/clipShape';
import { forgetAllExportsForTests } from '../../share/exportCache';
import ClipEditor from '../clip/[id]';

const mockParams = { id: 'c1' };
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({ id: mockParams.id }),
}));
jest.mock('expo-video', () => {
  const listeners = new Map<string, Set<(e: any) => void>>();
  const mockPlayer = {
    addListener: (event: string, fn: (e: any) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return { remove: () => void listeners.get(event)!.delete(fn) };
    },
    emit: (event: string, e: any = {}) => (listeners.get(event) || new Set()).forEach((fn) => fn(e)),
    play: jest.fn(),
    pause: jest.fn(),
    currentTime: 0,
    playbackRate: 1,
    muted: false,
  };
  return { __player: mockPlayer, useVideoPlayer: () => mockPlayer, VideoView: () => null };
});
const mockListExports = jest.fn(() => []);
jest.mock('expo-file-system', () => ({
  File: class { exists = true; delete() {} },
  Directory: class { list() { return mockListExports(); } },
  Paths: { cache: '' },
}));
jest.mock('expo-image', () => {
  const shown: string[] = [];
  return { __shown: shown, Image: (p: any) => (shown.push(p.source.uri), null) };
});
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-media-library', () => ({
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  Asset: { create: jest.fn(async () => ({})) },
}));
jest.mock('../../share/captureOverlay', () => ({ captureOverlay: jest.fn(async () => '/tmp/overlay.png') }));
jest.mock('../../../modules/replay-camera', () => ({
  exportClip: jest.fn(async () => ({ path: '/exports/e1.mp4', durationMs: 30000 })),
  createThumbnail: jest.fn(async () => '/c1.jpg'),
  videoShape: jest.fn(() => undefined),
  findContentStart: jest.fn(async () => 0),
  isFocusSupported: jest.fn(() => true),
}));
jest.mock('../../analytics', () => ({ track: jest.fn(), sessionSummary: { note: jest.fn() } }));
jest.mock('../../focus/appBallQueue', () => ({
  ballQueue: { request: jest.fn(), cancel: jest.fn(), progress: jest.fn(() => undefined), subscribe: jest.fn(() => () => {}) },
  ballAvailable: jest.fn(() => false),
  probeBallOnce: jest.fn(),
  checkSportOnce: jest.fn(),
  sportChecking: jest.fn(() => false),
}));
jest.mock('../../focus/appFocusQueue', () => ({ focusQueue: { ensure: jest.fn(), setHold: jest.fn(), openRecording: jest.fn(() => () => {}) } }));
jest.mock('../../data/focusFile', () => ({ ...jest.requireActual('../../data/focusFile'), readFocusFile: jest.fn(() => undefined) }));
jest.mock('../../components/useReduceMotion', () => ({ useReduceMotion: jest.fn(() => false) }));
jest.mock('../../share/ZoomableVideo', () => {
  const props: { last?: any; all: any[] } = { all: [] };
  return { __props: props, ZoomableVideo: (p: any) => ((props.last = p), props.all.push(p), null) };
});
jest.mock('../../components/TrimBar', () => {
  const props: { last?: any } = {};
  return { __props: props, TrimBar: (p: any) => ((props.last = p), null) };
});
jest.mock('../../data/mmkv', () => {
  let clip: any;
  // Where the open clip sits in its recording: last of two (default) or first of two.
  let first = false;
  let paid = true;
  let noticeShown = false;
  let sport: string | undefined;
  let ballSport: any;
  let version = 0;
  const listeners = new Set<() => void>();
  let prefs: any = jest.requireActual('../../data/schema').DEFAULT_PREFS;
  return {
    __setClip: (c: any) => (clip = c),
    __setPrefs: (p: any) => (prefs = p),
    __setFirst: (f: boolean) => (first = f),
    __setPaid: (p: boolean) => (paid = p),
    __setNoticeShown: (n: boolean) => (noticeShown = n),
    __setSport: (s: string | undefined, b?: any) => ((sport = s), (ballSport = b)),
    removeFile: jest.fn(),
    repo: {
      getClip: () => clip,
      listClips: () => {
        if (!clip) return [];
        const other = { id: first ? 'c2' : 'c0', path: first ? '/c2.mp4' : '/c0.mp4', trim: { startMs: 1000, endMs: 9000 } };
        return first ? [clip, other] : [other, clip];
      },
      getPrefs: () => prefs,
      setPrefs: jest.fn((p: object) => (prefs = { ...prefs, ...p })),
      getSession: () => ({ id: 's1', sport: sport || (clip?.durationMs > 60000 ? 'musculacao' : 'beachTennis'), startedAt: 0, paid, freeNoticeShown: noticeShown, ballSport }),
      markFreeNoticeShown: jest.fn(() => (noticeShown = true)),
      setBallSport: jest.fn((_id: string, b: any) => (ballSport = b)),
      updateClip: jest.fn((id: string, patch: object) => {
        clip = { ...clip, ...patch };
        version += 1;
        listeners.forEach((listener) => listener());
        return clip;
      }),
      renameClip: jest.fn(),
      deleteClip: jest.fn(),
      // Like the real repo: the screen hears every change and reads the clip again.
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      version: () => version,
    },
  };
});

const { repo, __setClip, removeFile } = jest.requireMock('../../data/mmkv');
const { router } = jest.requireMock('expo-router');
const { __player: player } = jest.requireMock('expo-video');
const camera = jest.requireMock('../../../modules/replay-camera');
const sharing = jest.requireMock('expo-sharing');
const media = jest.requireMock('expo-media-library');

const base = {
  id: 'c1', sessionId: 's1', createdAt: new Date(2026, 9, 17, 19, 40).getTime(), source: 'gesture',
  path: '/c1.mp4', durationMs: 60000, trim: { startMs: 30000, endMs: 60000 }, contentStartMs: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  __setClip({ ...base });
  jest.requireMock('../../data/mmkv').__setFirst(false);
  jest.requireMock('../../data/mmkv').__setPaid(true);
  forgetShapes();
  forgetAllExportsForTests();
  mockParams.id = 'c1';
  jest.requireMock('../../share/ZoomableVideo').__props.all.length = 0;
  // The intro is covered by its own tests; elsewhere it was already seen.
  jest.requireMock('../../data/mmkv').__setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: true });
  // jest-expo's ImageLoader mock predates RN 0.88's promise-based getSize.
  (jest.spyOn(Image, 'getSize') as jest.Mock).mockResolvedValue({ width: 1920, height: 1080 });
});

const open = async () => {
  await render(<ClipEditor />);
  await act(async () => {});
};
const pressAction = (name: string) => act(async () => fireEvent.press(screen.getByRole('button', { name })));
/** Opens the clip and goes to edit mode, on `tool` when given (tabs are named by the tool, Foco may say "ligado"). */
const openEdit = async (tool?: string) => {
  await open();
  await pressAction('Editar');
  if (tool) await act(async () => fireEvent.press(screen.getByRole('tab', { name: new RegExp(`^${tool}`) })));
};

test('the name field shows which clip it is until the player names it', async () => {
  await open();
  const input = screen.getByLabelText('Etiqueta do clipe');
  expect(input.props.placeholder).toBe('Clipe #2 · 19:40');
  expect(input.props.maxLength).toBe(25);
  await pressAction('Editar');
  expect(screen.getByText('Corte: 0:30')).toBeTruthy();
});

test('the clip keeps the number it was saved with, not its place in the list', async () => {
  // Second in the list (clip 1 was deleted), but saved as number 5 of the recording.
  __setClip({ ...base, number: 5 });
  await open();
  expect(screen.getByLabelText('Etiqueta do clipe').props.placeholder).toBe('Clipe #5 · 19:40');
  expect(screen.getByText('2 de 2 · deslize para trocar')).toBeTruthy();
});

test('a named clip shows its name', async () => {
  __setClip({ ...base, name: 'Ace no fundo' });
  await open();
  expect(screen.getByLabelText('Etiqueta do clipe').props.value).toBe('Ace no fundo');
});

test('the clip is renamed on the same screen, saved on blur', async () => {
  await open();
  const input = screen.getByLabelText('Etiqueta do clipe');
  await fireEvent.changeText(input, 'Match point');
  await fireEvent(input, 'blur');
  expect(repo.renameClip).toHaveBeenCalledWith('c1', 'Match point');
});

test('watching shows back, delete and Editar · Salvar · Enviar, and no tools', async () => {
  await open();
  const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
  expect(labels).toEqual(expect.arrayContaining(['Voltar', 'Apagar clipe', 'Editar', 'Salvar na galeria', 'Compartilhar']));
  expect(screen.getByText('Salvar')).toBeTruthy();
  expect(screen.getByText('Enviar')).toBeTruthy();
  expect(screen.queryByText('Apagar clipe')).toBeNull();
  expect(screen.queryByText(/Story/)).toBeNull();
  expect(screen.queryByRole('tab')).toBeNull();
});

test('choosing a speed stores it on the clip', async () => {
  await openEdit('Velocidade');
  await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
  expect(repo.updateClip).toHaveBeenCalledWith('c1', { edit: { speed: 2, muted: false } });
});

test('toggling sound stores muted', async () => {
  await openEdit('Som');
  await fireEvent.press(screen.getByRole('button', { name: 'Som' }));
  expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: true } });
});

test('at any speed but 1x the sound shows as off and cannot be turned on', async () => {
  __setClip({ ...base, edit: { speed: 1.5, muted: false } });
  await openEdit('Som');
  expect(screen.getByRole('button', { name: 'Som' })).toBeDisabled();
  expect(screen.getByText('Sem som')).toBeTruthy();
});

test('a clip saved with the old slow motion switch opens at 0.5x', async () => {
  __setClip({ ...base, edit: { slowmo: true, muted: false } });
  await openEdit('Velocidade');
  expect(screen.getByRole('button', { name: 'Velocidade 0.5x' })).toBeSelected();
  expect(screen.getByText('Corte: 1:00')).toBeTruthy();
});

test('the cut label shows the length of the result, so 2x halves it', async () => {
  __setClip({ ...base, edit: { speed: 2, muted: false } });
  await openEdit();
  expect(screen.getByText('Corte: 0:15')).toBeTruthy();
});

test('dragging a handle updates the time and shows that edge in the preview', async () => {
  await openEdit();
  const bar = jest.requireMock('../../components/TrimBar').__props;
  await act(async () => bar.last.onChange({ startMs: 40000, endMs: 60000 }, 'start'));
  expect(screen.getByText('Corte: 0:20')).toBeTruthy();
  expect(player.pause).toHaveBeenCalled();
  expect(player.currentTime).toBe(40);
  await act(async () => bar.last.onChange({ startMs: 40000, endMs: 52000 }, 'end'));
  expect(player.currentTime).toBe(51.5);
});

test('letting go of a handle saves the cut and plays it from the start', async () => {
  await openEdit();
  const bar = jest.requireMock('../../components/TrimBar').__props;
  await act(async () => bar.last.onChange({ startMs: 40000, endMs: 60000 }, 'start'));
  player.play.mockClear();
  await act(async () => bar.last.onCommit({ startMs: 40000, endMs: 60000 }));
  expect(repo.updateClip).toHaveBeenCalledWith('c1', { trim: { startMs: 40000, endMs: 60000 } });
  expect(player.currentTime).toBe(40);
  expect(player.play).toHaveBeenCalled();
});

test('the play button pauses and resumes, and a paused clip stays paused after a cut', async () => {
  await openEdit();
  await pressAction('Pausar');
  expect(player.pause).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeTruthy();
  const bar = jest.requireMock('../../components/TrimBar').__props;
  await act(async () => bar.last.onChange({ startMs: 40000, endMs: 60000 }, 'start'));
  player.play.mockClear();
  await act(async () => bar.last.onCommit({ startMs: 40000, endMs: 60000 }));
  expect(player.play).not.toHaveBeenCalled();
  await pressAction('Reproduzir');
  expect(player.play).toHaveBeenCalled();
});

test('a clip allows cuts up to the 60s buffer', async () => {
  __setClip({ ...base, durationMs: 60000, trim: { startMs: 30000, endMs: 60000 } });
  await openEdit();
  expect(jest.requireMock('../../components/TrimBar').__props.last.maxMs).toBe(60000);
});

test('the trim track covers only the cut the clip was saved with, not the rest of the buffer', async () => {
  const cut = { startMs: 47000, endMs: 60000 };
  __setClip({ ...base, durationMs: 60000, trim: cut, bounds: cut });
  await openEdit();
  const bar = jest.requireMock('../../components/TrimBar').__props.last;
  expect(bar.floorMs).toBe(47000);
  expect(bar.durationMs).toBe(60000);
  expect(screen.getByText('-0:13')).toBeTruthy();
});

test('a clip saved before bounds existed still shows its whole file', async () => {
  __setClip({ ...base });
  await openEdit();
  const bar = jest.requireMock('../../components/TrimBar').__props.last;
  expect(bar.floorMs).toBe(0);
  expect(bar.durationMs).toBe(60000);
});

test('a missing clip shows the message instead of the editor', async () => {
  __setClip(undefined);
  await open();
  expect(screen.getByText('Este clipe não está mais no celular.')).toBeTruthy();
});

test('deleting asks first, then removes the file and the clip', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await open();
  await pressAction('Apagar clipe');
  const confirm = alert.mock.calls[0][2]!.find((b) => b.text === 'Apagar')!;
  confirm.onPress!();
  expect(removeFile).toHaveBeenCalledWith('/c1.mp4');
  expect(repo.deleteClip).toHaveBeenCalledWith('c1');
  // c1 is the last one in the list, so playback continues with the one before it instead of leaving the screen
  expect(router.setParams).toHaveBeenCalledWith({ id: 'c0' });
  expect(router.back).not.toHaveBeenCalled();
});

test('Compartilhar exports with the cut, speed and zoom, without the app mark on a paid recording, then opens the share sheet', async () => {
  const zoom = { scale: 2, cx: 0.25, cy: 0.75 };
  __setClip({ ...base, edit: { speed: 2, muted: false, zoom } });
  await open();
  await pressAction('Compartilhar');
  expect(camera.exportClip).toHaveBeenCalledWith(
    expect.objectContaining({
      clipPath: '/c1.mp4', startMs: 30000, endMs: 60000, speed: 2, muted: true,
      crop: { x: 0, y: 0.5, width: 0.5, height: 0.5 },
      width: 1920, height: 1080, overlayPngPath: '/tmp/overlay.png', watermark: false,
    }),
  );
  expect(sharing.shareAsync).toHaveBeenCalledWith('file:///exports/e1.mp4', expect.objectContaining({ mimeType: 'video/mp4' }));
});

test('a vertical clip is exported in a vertical frame', async () => {
  (Image.getSize as jest.Mock).mockResolvedValueOnce({ width: 1080, height: 1920 });
  await open();
  await pressAction('Compartilhar');
  expect(camera.exportClip).toHaveBeenCalledWith(expect.objectContaining({ width: 1080, height: 1920 }));
});

test('a 4K clip asks how to leave: 2K exports at 2560 × 1440', async () => {
  __setClip({ ...base, shortSide: 2160 });
  await open();
  await pressAction('Compartilhar');
  expect(screen.getByText('Qualidade do vídeo')).toBeTruthy();
  expect(camera.exportClip).not.toHaveBeenCalled();
  // 30 s with no sound change: rough sizes per option.
  expect(screen.getByRole('button', { name: '4K, original, 3840 × 2160, ≈ 150 MB' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Full HD, 1920 × 1080, ≈ 57 MB' })).toBeTruthy();
  await pressAction('2K, 2560 × 1440, ≈ 68 MB');
  // The overlay is redrawn at the new size (a frame later) before it is captured.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
  expect(camera.exportClip).toHaveBeenCalledWith(expect.objectContaining({ width: 2560, height: 1440 }));
});

test('Cancelar on the quality sheet exports nothing', async () => {
  __setClip({ ...base, shortSide: 2160 });
  await open();
  await pressAction('Salvar na galeria');
  await act(async () => fireEvent.press(screen.getAllByRole('button', { name: 'Cancelar' }).at(-1)!));
  expect(camera.exportClip).not.toHaveBeenCalled();
});

test('a Full HD clip goes out as Full HD without asking', async () => {
  __setClip({ ...base, shortSide: 1080 });
  await open();
  await pressAction('Compartilhar');
  expect(screen.queryByText('Qualidade do vídeo')).toBeNull();
  expect(camera.exportClip).toHaveBeenCalledWith(expect.objectContaining({ width: 1920, height: 1080 }));
});

test('Salvar na galeria asks for photo access and saves the export', async () => {
  await open();
  await pressAction('Salvar na galeria');
  expect(media.requestPermissionsAsync).toHaveBeenCalledWith(true, ['video']);
  expect(media.Asset.create).toHaveBeenCalledWith('file:///exports/e1.mp4');
  expect(screen.getByText('Salvo na galeria.')).toBeTruthy();
  expect(repo.updateClip).toHaveBeenCalledWith('c1', { savedAt: expect.any(Number) });
});

test('after sharing, the clip is marked as shared', async () => {
  await open();
  await pressAction('Compartilhar');
  expect(repo.updateClip).toHaveBeenCalledWith('c1', { sharedAt: expect.any(Number) });
});

test('saving then sharing the same look exports only once', async () => {
  await open();
  await pressAction('Salvar na galeria');
  await pressAction('Compartilhar');
  expect(camera.exportClip).toHaveBeenCalledTimes(1);
});

test('ignores a second tap while exporting', async () => {
  let finish: (v: unknown) => void = () => {};
  camera.exportClip.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  await open();
  const share = screen.getByRole('button', { name: 'Compartilhar' });
  await act(async () => fireEvent.press(share));
  await act(async () => fireEvent.press(share));
  await act(async () => finish({ path: '/exports/e1.mp4', durationMs: 1 }));
  expect(camera.exportClip).toHaveBeenCalledTimes(1);
});

test('while the video is made, a card shows only "Preparando o vídeo…"', async () => {
  let finish: (v: unknown) => void = () => {};
  camera.exportClip.mockImplementationOnce(() => new Promise((r) => (finish = r)));
  await open();
  await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Salvar na galeria' })));
  expect(screen.getByText('Preparando o vídeo…')).toBeTruthy();
  expect(screen.queryByText('Para salvar na galeria')).toBeNull();
  expect(screen.queryByText('0 s')).toBeNull();
  await act(async () => finish({ path: '/exports/e1.mp4', durationMs: 1 }));
  expect(screen.queryByText('Preparando o vídeo…')).toBeNull();
  expect(screen.getByText('Salvo na galeria.')).toBeTruthy();
});

test('a failed export shows the error and re-enables the buttons', async () => {
  camera.exportClip.mockRejectedValueOnce(new Error('disk full'));
  await open();
  await pressAction('Compartilhar');
  expect(screen.getByText('Não foi possível preparar o vídeo. Tente de novo.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeEnabled();
});

test('actions wait until the video shape is known', async () => {
  let resolve: (v: unknown) => void = () => {};
  (Image.getSize as jest.Mock).mockReturnValueOnce(new Promise((r) => (resolve = r)));
  await render(<ClipEditor />);
  expect(screen.getByRole('button', { name: 'Salvar na galeria' })).toBeDisabled();
  await act(async () => resolve({ width: 1080, height: 1920 }));
  expect(screen.getByRole('button', { name: 'Salvar na galeria' })).toBeEnabled();
});

test('a name typed without closing the keyboard is saved when the player shares', async () => {
  await open();
  await fireEvent.changeText(screen.getByLabelText('Etiqueta do clipe'), 'Match point');
  await pressAction('Compartilhar');
  expect(repo.renameClip).toHaveBeenCalledWith('c1', 'Match point');
});

describe('watch and edit', () => {
  const { __props: video } = jest.requireMock('../../share/ZoomableVideo');
  const tab = (name: RegExp) => screen.getByRole('tab', { name });

  beforeEach(() => jest.requireActual('../../clip/editSession').rememberTool('focus'));

  test('Editar opens the tools on Foco the first time, then on the last tool used', async () => {
    await openEdit();
    expect(screen.queryByRole('button', { name: 'Compartilhar' })).toBeNull();
    expect(tab(/^Foco/).props.accessibilityState).toMatchObject({ selected: true });
    await act(async () => fireEvent.press(tab(/^Som/)));
    await pressAction('Concluir');
    await pressAction('Editar');
    expect(tab(/^Som/).props.accessibilityState).toMatchObject({ selected: true });
  });

  test('Cancelar puts the clip back as it was when editing began', async () => {
    await openEdit('Velocidade');
    await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
    await pressAction('Cancelar');
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: undefined, trim: { startMs: 30000, endMs: 60000 } });
    expect(screen.getByRole('button', { name: 'Compartilhar' })).toBeTruthy();
  });

  test('Concluir keeps the edits', async () => {
    await openEdit('Velocidade');
    await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
    repo.updateClip.mockClear();
    await pressAction('Concluir');
    expect(repo.updateClip).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
  });

  test('Android back while editing leaves at once when nothing changed, and asks when something did', async () => {
    const { BackHandler } = jest.requireActual('react-native');
    const listen = jest.spyOn(BackHandler, 'addEventListener');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await openEdit();
    const back = () => (listen.mock.calls[listen.mock.calls.length - 1][1] as () => boolean)();
    let handled = false;
    await act(async () => void (handled = back()));
    expect(handled).toBe(true);
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    await pressAction('Editar');
    await act(async () => fireEvent.press(tab(/^Velocidade/)));
    await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
    await act(async () => void back());
    expect(alert).toHaveBeenCalledWith('Descartar alterações?', undefined, expect.any(Array));
    listen.mockRestore();
    alert.mockRestore();
  });

  test('holding the video while watching plays 2x, then the clip goes back to its own speed and sound', async () => {
    __setClip({ ...base, edit: { speed: 0.5, muted: true } });
    await open();
    await act(async () => video.last.onHold(true));
    expect(player.playbackRate).toBe(2);
    expect(player.muted).toBe(true);
    expect(screen.getByText('2x')).toBeTruthy();
    await act(async () => video.last.onHold(false));
    expect(player.playbackRate).toBe(0.5);
    expect(player.muted).toBe(true);
    expect(screen.queryByText('2x')).toBeNull();
  });

  test('an export right after Concluir has the edits just made, and is made once', async () => {
    await openEdit('Velocidade');
    await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
    await pressAction('Concluir');
    await pressAction('Salvar na galeria');
    expect(camera.exportClip).toHaveBeenCalledWith(expect.objectContaining({ speed: 2, muted: true }));
    await pressAction('Compartilhar');
    expect(camera.exportClip).toHaveBeenCalledTimes(1);
  });

  test('Cancelar after a pinch took over Modo Foco brings it back with no zoom', async () => {
    jest.requireMock('../../data/focusFile').readFocusFile.mockReturnValue({ startMs: 30000, stepMs: 100, rects: [[0.1, 0.1, 0.8, 0.8]] });
    __setClip({ ...base, focus: { v: 1, status: 'ready', file: '/c1.focus.json' } });
    await openEdit('Zoom');
    await act(async () => video.last.onCommit({ scale: 2, cx: 0.4, cy: 0.5 }));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', expect.objectContaining({ edit: expect.objectContaining({ framing: 'none' }) }));
    await pressAction('Cancelar');
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: undefined, trim: { startMs: 30000, endMs: 60000 } });
    expect(screen.getByRole('button', { name: 'Modo Foco' })).toBeTruthy();
    jest.requireMock('../../data/focusFile').readFocusFile.mockReturnValue(undefined);
  });

  test('asked on Android back, Descartar puts the clip back and Continuar editando stays', async () => {
    const { BackHandler } = jest.requireActual('react-native');
    const listen = jest.spyOn(BackHandler, 'addEventListener');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const back = () => (listen.mock.calls[listen.mock.calls.length - 1][1] as () => boolean)();
    const choose = (text: string) => {
      const buttons = alert.mock.calls[alert.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];
      const button = buttons.find((b) => b.text === text)!;
      if (button.onPress) button.onPress();
    };
    await openEdit('Velocidade');
    await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
    await act(async () => void back());
    await act(async () => choose('Continuar editando'));
    expect(screen.getByRole('button', { name: 'Concluir' })).toBeTruthy();
    await act(async () => void back());
    await act(async () => choose('Descartar'));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: undefined, trim: { startMs: 30000, endMs: 60000 } });
    expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
    listen.mockRestore();
    alert.mockRestore();
  });

  test('a phone without Modo Foco has no Foco tool and opens on Velocidade', async () => {
    camera.isFocusSupported.mockReturnValue(false);
    await openEdit();
    expect(screen.queryByRole('tab', { name: /^Foco/ })).toBeNull();
    expect(tab(/^Velocidade/).props.accessibilityState).toMatchObject({ selected: true });
    camera.isFocusSupported.mockReturnValue(true);
  });

  test('a ready framing waits for the video shape before saying anything about the clip', async () => {
    (Image.getSize as jest.Mock).mockReturnValue(new Promise(() => {}));
    __setClip({ ...base, focus: { v: 1, status: 'ready', file: '/c1.focus.json' } });
    await openEdit('Foco');
    expect(screen.getByText('Rastreando os jogadores… você pode continuar editando.')).toBeTruthy();
    expect(screen.queryByText('Jogadores indisponível para esse clipe.')).toBeNull();
  });

  test('watching swipes between clips without zoom; editing zooms and does not swipe', async () => {
    await open();
    expect(video.last.onSwipe).toBeDefined();
    expect(video.last.pinch).toBe(false);
    await pressAction('Editar');
    expect(video.last.onSwipe).toBeUndefined();
    expect(video.last.pinch).toBe(true);
    expect(video.last.onHold).toBeUndefined();
  });
});

test('a zoomed clip shows its zoom and can go back to 1x', async () => {
  __setClip({ ...base, edit: { speed: 1, muted: false, zoom: { scale: 2.5, cx: 0.5, cy: 0.5 } } });
  await openEdit('Zoom');
  expect(screen.getByText('2.5x')).toBeTruthy();
  await pressAction('Voltar zoom para 1x');
  expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false } });
});

test('Girar turns the video a quarter, stored on the clip, and starts the zoom over', async () => {
  __setClip({ ...base, edit: { speed: 1, muted: false, zoom: { scale: 2, cx: 0.5, cy: 0.5 } } });
  await openEdit('Girar');
  await pressAction('Girar vídeo');
  expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, rotation: 90 } });
});

test('turning a clip already turned three times brings it back to upright', async () => {
  __setClip({ ...base, edit: { speed: 1, muted: false, rotation: 270 } });
  await openEdit('Girar');
  await pressAction('Girar vídeo');
  expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false } });
});

test('a turned clip exports with its rotation', async () => {
  __setClip({ ...base, edit: { speed: 1, muted: false, rotation: 90 } });
  await open();
  await pressAction('Compartilhar');
  expect(camera.exportClip).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90 }));
});

describe('a black start', () => {
  const short = { ...base, durationMs: 57000, trim: { startMs: 0, endMs: 54000 }, contentStartMs: undefined };

  test('is found when the editor first opens the clip and the cut moves past it', async () => {
    camera.findContentStart.mockResolvedValueOnce(11000);
    __setClip(short);
    await open();
    expect(camera.findContentStart).toHaveBeenCalledWith('/c1.mp4');
    expect(repo.updateClip).toHaveBeenCalledWith('c1', {
      contentStartMs: 10750,
      trim: { startMs: 10750, endMs: 54000 },
    });
    expect(player.currentTime).toBe(10.75);
  });

  test('is remembered as nothing to skip when the clip starts with a picture', async () => {
    __setClip(short);
    await open();
    expect(repo.updateClip).toHaveBeenCalledWith('c1', { contentStartMs: 0 });
  });

  test('is not looked for again once known', async () => {
    __setClip({ ...short, contentStartMs: 10750, trim: { startMs: 10750, endMs: 54000 } });
    await open();
    expect(camera.findContentStart).not.toHaveBeenCalled();
  });

  test('the track starts at the useful video: the left label shows its length, not the whole file', async () => {
    __setClip({ ...short, contentStartMs: 10750, trim: { startMs: 10750, endMs: 54000 } });
    await openEdit();
    expect(screen.getByText('-0:46')).toBeTruthy();
    expect(jest.requireMock('../../components/TrimBar').__props.last.floorMs).toBe(10750);
  });
});

describe('Modo Foco', () => {
  const { focusQueue } = jest.requireMock('../../focus/appFocusQueue');
  const { readFocusFile } = jest.requireMock('../../data/focusFile');
  const { __props: video } = jest.requireMock('../../share/ZoomableVideo');
  const { useReduceMotion } = jest.requireMock('../../components/useReduceMotion');
  const { __setPrefs } = jest.requireMock('../../data/mmkv');
  const ready = { v: 1, status: 'ready', file: '/c1.focus.json' };
  const track = { startMs: 30000, stepMs: 100, rects: [[0.1, 0.1, 0.8, 0.8]] };
  const chip = () => screen.getByRole('radio', { name: /^Jogadores/ });
  const original = () => screen.getByRole('radio', { name: 'Original' });

  beforeEach(() => {
    readFocusFile.mockImplementation((path: string) => (path === '/c1.focus.json' ? track : undefined));
  });

  test('a ready clip opens with Modo Foco on and the picture following the play', async () => {
    __setClip({ ...base, focus: ready });
    await open();
    expect(screen.getByRole('button', { name: 'Modo Foco' })).toBeTruthy();
    expect(video.last.follow).toBeDefined();
    await pressAction('Modo Foco'); // the tag opens edit mode on Foco
    expect(chip().props.accessibilityState).toMatchObject({ checked: true });
    expect(video.last.follow).toBeDefined();
    expect(readFocusFile).toHaveBeenCalledWith('/c1.focus.json', 'landscape');
  });

  test('turning it off is stored on the clip and shows the whole video', async () => {
    __setClip({ ...base, focus: ready });
    await openEdit('Foco');
    await act(async () => fireEvent.press(original()));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, framing: 'none' } });
    // The repo stand-in does not notify the screen: open the stored clip again.
    await openEdit('Foco');
    expect(chip().props.accessibilityState).toMatchObject({ checked: false });
    expect(video.last.follow).toBeUndefined();
  });

  test('turned off stays off when another choice is made', async () => {
    __setClip({ ...base, focus: ready, edit: { muted: false, focus: false } });
    await openEdit('Velocidade');
    await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 2, muted: false, framing: 'none' } });
  });

  test('while the analysis runs the tag says it is preparing', async () => {
    __setClip({ ...base, focus: { v: 1, status: 'pending' } });
    await open();
    expect(screen.getByText('Rastreando os jogadores…')).toBeTruthy();
    expect(video.last.follow).toBeUndefined();
  });

  test.each([
    ['nobody found', { focus: { v: 1, status: 'none', file: '/c1.focus.json' } }],
    ['analysis failed', { focus: { v: 1, status: 'failed' } }],
    ['video turned by hand', { focus: ready, edit: { muted: false, rotation: 90 } }],
    ['framing file unreadable', { focus: { v: 1, status: 'ready', file: '/gone.focus.json' } }],
  ])('no tag and no switch when %s', async (_name, extra) => {
    __setClip({ ...base, ...extra });
    await open();
    expect(screen.queryByRole('button', { name: 'Modo Foco' })).toBeNull();
    expect(video.last.follow).toBeUndefined();
    await pressAction('Editar');
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: /^Foco/ })));
    expect(screen.queryByRole('radio', { name: /^Jogadores/ })).toBeNull();
    expect(original().props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText('Jogadores indisponível para esse clipe.')).toBeTruthy();
  });

  test('no tag on a phone without the analysis', async () => {
    camera.isFocusSupported.mockReturnValueOnce(false).mockReturnValue(false);
    await open();
    expect(screen.queryByRole('button', { name: 'Modo Foco' })).toBeNull();
    camera.isFocusSupported.mockReturnValue(true);
  });

  test('opening a clip makes sure it gets analysed', async () => {
    await open();
    expect(focusQueue.ensure).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }));
  });

  test('a pinch while following takes over: the zoom is kept and Modo Foco turns off', async () => {
    __setClip({ ...base, focus: ready });
    await openEdit('Zoom');
    await act(async () => video.last.onCommit({ scale: 2, cx: 0.4, cy: 0.5 }));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', {
      edit: { speed: 1, muted: false, zoom: { scale: 2, cx: 0.4, cy: 0.5 }, framing: 'none' },
    });
  });

  test('turning Modo Foco back on drops the hand zoom', async () => {
    __setClip({ ...base, focus: ready, edit: { muted: false, focus: false, zoom: { scale: 2, cx: 0.5, cy: 0.5 } } });
    await openEdit('Foco');
    expect(chip().props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => fireEvent.press(chip()));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false } });
  });

  test('a clip saved from now on opens as Original: nothing applied until a tap (spec 2026-11-11)', async () => {
    __setClip({ ...base, focus: ready, edit: { speed: 1, muted: false, framing: 'none' } });
    await open();
    expect(screen.queryByRole('button', { name: 'Modo Foco' })).toBeNull();
    expect(video.last.follow).toBeUndefined();
    await pressAction('Editar');
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: /^Foco/ })));
    expect(original().props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => fireEvent.press(chip()));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false } });
  });

  test('saving to Photos exports with the framing', async () => {
    __setClip({ ...base, focus: ready });
    await open();
    await pressAction('Salvar na galeria');
    expect(camera.exportClip).toHaveBeenCalledWith(
      expect.objectContaining({ focus: { path: '/c1.focus.json', aspect: 'landscape' } }),
    );
  });

  describe('on a free recording the framing works in the app and stays out of what leaves it', () => {
    beforeEach(() => {
      jest.requireMock('../../data/mmkv').__setPaid(false);
      jest.requireMock('../../data/mmkv').__setNoticeShown(false);
    });

    test('the clip is shown with the framing on, as for a paid recording', async () => {
      __setClip({ ...base, focus: ready });
      await open();
      expect(screen.getByRole('button', { name: 'Modo Foco' })).toBeTruthy();
    });

    test('saving first lists what PRO puts in the video, framing included, and nothing is exported yet', async () => {
      __setClip({ ...base, focus: ready });
      await open();
      await pressAction('Salvar na galeria');
      expect(camera.exportClip).not.toHaveBeenCalled();
      expect(screen.getByText('Salve seus clipes com qualidade PRO')).toBeTruthy();
      expect(screen.getByText('Seu clipe tem som e Modo Foco')).toBeTruthy();
      expect(screen.getByLabelText('GRÁTIS: Sem som, Sem Modo Foco, HD, Com marca d’água')).toBeTruthy();
      expect(screen.getByLabelText('PRO: Com som, Com Modo Foco, Full HD, Sem marca d’água')).toBeTruthy();
    });

    test('"Continuar no plano grátis" exports HD at the chosen speed with the mark, no sound and no framing', async () => {
      __setClip({ ...base, focus: ready, edit: { speed: 2, muted: false } });
      await open();
      await pressAction('Salvar na galeria');
      expect(screen.getByText('Seu clipe tem Modo Foco')).toBeTruthy(); // 2x is silent anyway
      await fireEvent.press(screen.getByRole('button', { name: 'Continuar no plano grátis' }));
      await act(async () => {});
      expect(camera.exportClip).toHaveBeenCalledTimes(1);
      expect(camera.exportClip).toHaveBeenCalledWith(
        expect.objectContaining({ speed: 2, muted: true, watermark: true, width: 1280, height: 720 }),
      );
      expect(camera.exportClip.mock.calls[0][0].focus).toBeUndefined();
      expect(repo.markFreeNoticeShown).toHaveBeenCalledWith('s1');
    });

    test('a later export of the same recording goes straight on, with no notice', async () => {
      jest.requireMock('../../data/mmkv').__setNoticeShown(true);
      __setClip({ ...base, focus: ready });
      await open();
      await pressAction('Salvar na galeria');
      expect(screen.queryByText('Continuar no plano grátis')).toBeNull();
      expect(screen.queryByText(/^Salvo em /)).toBeNull();
      await act(async () => {});
      expect(camera.exportClip).toHaveBeenCalledTimes(1);
      expect(camera.exportClip).toHaveBeenCalledWith(expect.objectContaining({ width: 1280, height: 720, watermark: true }));
    });

    test('"Cancelar" leaves without exporting', async () => {
      __setClip({ ...base, focus: ready });
      await open();
      await pressAction('Compartilhar');
      await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
      await act(async () => {});
      expect(camera.exportClip).not.toHaveBeenCalled();
    });

    test('with the framing switched off the notice still lists it, but marks only the sound as used', async () => {
      __setClip({ ...base, focus: ready, edit: { muted: false, focus: false } });
      await open();
      await pressAction('Salvar na galeria');
      expect(screen.getByText('Seu clipe tem som')).toBeTruthy();
      expect(screen.getByLabelText('GRÁTIS: Sem som, Sem Modo Foco, HD, Com marca d’água')).toBeTruthy();
    });
  });

  test('the first framed clip introduces Modo Foco once', async () => {
    __setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: false });
    __setClip({ ...base, focus: ready });
    await open();
    expect(screen.getByText('Modo Foco: a câmera acompanha o lance')).toBeTruthy();
    expect(repo.setPrefs).toHaveBeenCalledWith({ focusIntroSeen: true });
  });

  test('with reduced motion the intro is the caption only', async () => {
    useReduceMotion.mockReturnValue(true);
    __setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: false });
    __setClip({ ...base, focus: ready });
    await open();
    expect(screen.getByText('Modo Foco: a câmera acompanha o lance')).toBeTruthy();
    expect(video.last.enterMs).toBe(0);
    useReduceMotion.mockReturnValue(false);
  });

  test('a clip already introduced opens without the caption', async () => {
    __setClip({ ...base, focus: ready });
    await open();
    expect(screen.queryByText('Modo Foco: a câmera acompanha o lance')).toBeNull();
  });
});

describe('the cut loops', () => {
  test('when the player reaches the end of the file it starts the cut again and keeps playing', async () => {
    await open();
    player.play.mockClear();
    player.currentTime = 60;
    await act(async () => player.emit('playToEnd'));
    expect(player.currentTime).toBe(30);
    expect(player.play).toHaveBeenCalled();
  });

  test('a time a hair before the end of the cut already loops', async () => {
    await open();
    await act(async () => player.emit('timeUpdate', { currentTime: 59.9 }));
    expect(player.currentTime).toBe(30);
  });

  test('a paused clip that reaches the end goes back to the start but stays paused', async () => {
    await open();
    await pressAction('Pausar');
    player.play.mockClear();
    await act(async () => player.emit('playToEnd'));
    expect(player.currentTime).toBe(30);
    expect(player.play).not.toHaveBeenCalled();
  });
});

describe('swiping between clips follows the finger', () => {
  const video = jest.requireMock('../../share/ZoomableVideo').__props;
  const { __setFirst } = jest.requireMock('../../data/mmkv');
  const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 400)));

  test('the clip next to this one is ready beside it before the finger moves', async () => {
    jest.requireMock('expo-image').__shown.length = 0;
    await open();
    await act(async () => {});
    // The video itself is mocked away, so the only picture on screen is the neighbour's still.
    expect(jest.requireMock('expo-image').__shown).toContain('file:///c1.jpg');
  });

  test('the video shows its own picture until the first frame plays', async () => {
    await open();
    await act(async () => {});
    expect(video.last.poster).toBe('file:///c1.jpg');
  });

  test('a swipe past the edge changes the clip', async () => {
    await open();
    await act(async () => video.last.onDrag(150));
    await act(async () => video.last.onSwipe(-1));
    await settle();
    expect(router.setParams).toHaveBeenCalledWith({ id: 'c0' });
  });

  test('a short drag puts the clip back', async () => {
    await open();
    await act(async () => video.last.onDrag(40));
    await act(async () => video.last.onDragCancel());
    await settle();
    expect(router.setParams).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  test('on the first clip, swiping right goes back to the recording', async () => {
    __setFirst(true);
    await open();
    await act(async () => video.last.onDrag(150));
    await act(async () => video.last.onSwipe(-1));
    await settle();
    expect(router.back).toHaveBeenCalled();
    expect(router.setParams).not.toHaveBeenCalled();
  });

  test('on the last clip, swiping left stays put', async () => {
    await open();
    await act(async () => video.last.onDrag(-150));
    await act(async () => video.last.onSwipe(1));
    await settle();
    expect(router.setParams).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  const shiftOf = (node: any): number => {
    let shift = 0;
    for (let n = node; n; n = n.parent) {
      const style = [n.props.style].flat(Infinity).filter(Boolean);
      style.forEach((st: any) => (st.transform || []).forEach((t: any) => (shift += t.translateX || 0)));
    }
    return shift;
  };

  test('only the video follows the finger: the name and buttons stay where they are', async () => {
    await open();
    await act(async () => video.last.onDrag(150));
    expect(shiftOf(screen.getByTestId('clip-stage'))).toBe(150);
    expect(shiftOf(screen.getByRole('button', { name: 'Editar' }))).toBe(0);
    expect(shiftOf(screen.getByLabelText('Etiqueta do clipe'))).toBe(0);
  });

  test('the clip next door has its shape worked out, so it opens ready, with nothing jumping in late', async () => {
    await open();
    await settle();
    await act(async () => cleanup());
    // Now open that neighbour, as a swipe would: its shape must not be waited for again.
    __setClip({ ...base, id: 'c0', path: '/c0.mp4', trim: { startMs: 1000, endMs: 9000 } });
    (Image.getSize as jest.Mock).mockReturnValue(new Promise(() => {}));
    await render(<ClipEditor />);
    expect(screen.getByRole('button', { name: 'Salvar na galeria' })).toBeEnabled();
    expect(video.last.poster).toBe('file:///c1.jpg');
  });

  test('a swipe keeps this screen on top until the next clip has its first frame, so nothing flashes', async () => {
    const { rerender } = await render(<ClipEditor />);
    await act(async () => {});
    await act(async () => video.last.onDrag(150));
    await act(async () => video.last.onSwipe(-1));
    await settle();
    expect(router.setParams).toHaveBeenCalledWith({ id: 'c0' });
    // The router moves to c0: c0 is made under this screen, which stays until c0 shows its first frame.
    mockParams.id = 'c0';
    await act(async () => rerender(<ClipEditor />));
    expect(screen.getAllByLabelText('Etiqueta do clipe')).toHaveLength(2);
    expect(player.pause).toHaveBeenCalled();
    await act(async () => video.all.forEach((p: any) => p.onFirstFrame()));
    expect(screen.getAllByLabelText('Etiqueta do clipe')).toHaveLength(1);
  });

  test('if the next clip never reports its first frame, the screen still moves on', async () => {
    const { rerender } = await render(<ClipEditor />);
    await act(async () => video.last.onSwipe(-1));
    await settle();
    mockParams.id = 'c0';
    await act(async () => rerender(<ClipEditor />));
    expect(screen.getAllByLabelText('Etiqueta do clipe')).toHaveLength(2);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 1600)));
    expect(screen.getAllByLabelText('Etiqueta do clipe')).toHaveLength(1);
  });

  test('after deleting, the next clip simply takes over (the deleted one is not kept on screen)', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { rerender } = await render(<ClipEditor />);
    await pressAction('Apagar clipe');
    alert.mock.calls[0][2]!.find((b) => b.text === 'Apagar')!.onPress!();
    mockParams.id = 'c0';
    await act(async () => rerender(<ClipEditor />));
    expect(screen.getAllByLabelText('Etiqueta do clipe')).toHaveLength(1);
  });

  test('editing does not follow sideways drags', async () => {
    await open();
    await pressAction('Editar');
    expect(video.last.onDrag).toBeUndefined();
  });
});

describe('exports are kept for the whole app session', () => {
  test('opening and closing the clip screen leaves the exports folder alone', async () => {
    await open();
    await act(async () => cleanup());
    expect(mockListExports).not.toHaveBeenCalled();
  });

  test('a look exported before, even from another screen, is not made again', async () => {
    await open();
    await pressAction('Salvar na galeria');
    await act(async () => cleanup());
    await open();
    await pressAction('Compartilhar');
    expect(camera.exportClip).toHaveBeenCalledTimes(1);
  });
});

describe('analytics', () => {
  const events = () => (track as jest.Mock).mock.calls.map(([name, props]) => [name, props]);
  beforeEach(() => jest.clearAllMocks());

  test('Salvar na galeria reports the export and where it went', async () => {
    await open();
    await pressAction('Salvar na galeria');
    expect(events()).toEqual([
      ['export_completed', { quality: '1080p', plan: 'pro' }],
      ['clip_shared', { destination: 'photos' }],
    ]);
    expect(sessionSummary.note).toHaveBeenCalledWith('export');
  });

  test('Compartilhar reports the export and the share sheet', async () => {
    await open();
    await pressAction('Compartilhar');
    expect(events()).toEqual([
      ['export_completed', { quality: '1080p', plan: 'pro' }],
      ['clip_shared', { destination: 'share_sheet' }],
    ]);
  });

  test('a photo access refusal reports no export and no share', async () => {
    media.requestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await open();
    await pressAction('Salvar na galeria');
    expect(events()).toEqual([]);
  });

  test('a failed export reports export_failed with a closed reason, never the error text', async () => {
    camera.exportClip.mockRejectedValueOnce(new Error('disk full at /private/path'));
    await open();
    await pressAction('Compartilhar');
    expect(events()).toEqual([['export_failed', { reason: 'prepare_failed' }]]);
  });

  test('opening the same tool twice on one clip reports it once', async () => {
    await openEdit('Velocidade');
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: /^Som/ })));
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: /^Velocidade/ })));
    expect(events()).toEqual([
      ['clip_edit_tool_used', { tool: 'speed' }],
      ['clip_edit_tool_used', { tool: 'sound' }],
    ]);
  });

  test('turning Modo Foco on reports it, turning it off does not', async () => {
    __setClip({ ...base, focus: { v: 1, status: 'ready', file: '/c1.focus.json' }, edit: { muted: false, focus: false } });
    await openEdit('Foco');
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: /^Jogadores/ })));
    expect(events()).toContainEqual(['focus_mode_used', undefined]);
  });
});

describe('Seguir a Bola', () => {
  const balls = jest.requireMock('../../focus/appBallQueue');
  const { readFocusFile } = jest.requireMock('../../data/focusFile');
  const { __props: video } = jest.requireMock('../../share/ZoomableVideo');
  const { __setPrefs } = jest.requireMock('../../data/mmkv');
  const focusReady = { v: 1, status: 'ready', file: '/c1.focus.json' };
  const focusTrack = { startMs: 30000, stepMs: 100, rects: [[0.1, 0.1, 0.8, 0.8]] };
  const ballReady = { v: 1, status: 'ready', startMs: 30000, endMs: 60000, file: '/c1.ball.json', share: 0.8 };
  const ballTrack = { startMs: 30000, stepMs: 100, rects: [[0.3, 0, 0.3164, 1]] };
  const ballCard = () => screen.getByRole('radio', { name: /^Bola/ });

  beforeEach(() => {
    // a recording whose sport the player already gave (basketball): the switch is there (test 48)
    jest.requireMock('../../data/mmkv').__setSport('quadra', { v: 1, verdict: 'allow', sport: 'basquete' });
    balls.ballAvailable.mockReturnValue(true);
    readFocusFile.mockImplementation((path: string) =>
      path === '/c1.focus.json' ? focusTrack : path === '/c1.ball.json' ? ballTrack : undefined,
    );
  });
  afterAll(() => {
    balls.ballAvailable.mockReturnValue(false);
    jest.requireMock('../../data/mmkv').__setSport(undefined, undefined);
  });

  test('the recording is checked once for the sport when the editor opens', async () => {
    await openEdit('Foco');
    expect(balls.checkSportOnce).toHaveBeenCalledWith('s1', expect.objectContaining({ path: '/c1.mp4' }));
  });

  test('the sport chip opens every sport; the answer is kept for the recording and Bola follows it', async () => {
    jest.requireMock('../../data/mmkv').__setSport('quadra', { v: 1, verdict: 'allow', labels: { people: 0.8 }, auto: 'unsure', rule: 2 });
    await openEdit('Foco');
    expect(screen.getByText('Escolher esporte')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /^Bola/ })).toBeNull();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Esporte da gravação: Escolher esporte. Trocar' })));
    expect(screen.getByRole('radio', { name: 'Basquete' }).props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Basquete' })));
    expect(repo.setBallSport).toHaveBeenCalledWith('s1', {
      v: 1,
      verdict: 'allow',
      labels: { people: 0.8 },
      auto: 'unsure',
      rule: 2,
      sport: 'basquete',
    });
    expect(ballCard()).toBeTruthy();
  });

  test('worked out by itself: the chip says so and Bola is there for a sport with a model', async () => {
    const labels = { volleyball: 0.7, _floorSand: 0.6, _floorTex: 9 };
    jest.requireMock('../../data/mmkv').__setSport('quadra', { v: 1, verdict: 'other', labels, auto: 'beachTennis', rule: 2 });
    await openEdit('Foco');
    expect(screen.getByRole('button', { name: 'Esporte da gravação: Beach tennis. Trocar' })).toBeTruthy();
    expect(screen.getByText('· identificado')).toBeTruthy();
    expect(ballCard()).toBeTruthy();
  });

  test('a sport without a ball model: no Bola card; choosing one while on Bola goes back to Original', async () => {
    __setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: true, ballIntroSeen: true });
    __setClip({ ...base, focus: focusReady, edit: { muted: false, framing: 'ball' } });
    await openEdit('Foco');
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Esporte da gravação: Basquete. Trocar' })));
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: 'Tênis' })));
    expect(balls.ballQueue.cancel).toHaveBeenCalledWith('c1');
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, framing: 'none' } });
    await openEdit('Foco');
    expect(screen.queryByRole('radio', { name: /^Bola/ })).toBeNull();
  });

  test('a clip stored on Bola in a recording whose sport is not known: Original, nothing queued', async () => {
    jest.requireMock('../../data/mmkv').__setSport('quadra', { v: 1, verdict: 'allow', auto: 'unsure', rule: 2 });
    __setClip({ ...base, focus: focusReady, ball: ballReady, edit: { muted: false, framing: 'ball' } });
    await openEdit('Foco');
    expect(balls.ballQueue.request).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Original' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(video.last.content).toBeUndefined();
  });

  test('test 51\'s answer (basketball by default) is not trusted: nothing marked', async () => {
    jest.requireMock('../../data/mmkv').__setSport('quadra', { v: 1, verdict: 'allow', labels: { people: 0.8 }, auto: 'basquete' });
    await openEdit('Foco');
    expect(screen.getByText('Escolher esporte')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /^Bola/ })).toBeNull();
  });

  test('a recording made in the beach tennis mode is beach tennis', async () => {
    jest.requireMock('../../data/mmkv').__setSport('beachTennis', undefined);
    await openEdit('Foco');
    expect(screen.getByRole('button', { name: 'Esporte da gravação: Beach tennis. Trocar' })).toBeTruthy();
    expect(screen.queryByText('· identificado')).toBeNull();
  });

  test('the first tap shows what it does; "Seguir o clipe todo" turns it on and remembers the answer', async () => {
    __setClip({ ...base, focus: focusReady });
    await openEdit('Foco');
    await act(async () => fireEvent.press(ballCard()));
    expect(repo.updateClip).not.toHaveBeenCalledWith('c1', expect.objectContaining({ edit: expect.anything() }));
    expect(screen.getByText('Corte o lance antes')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Seguir o clipe todo' })));
    expect(repo.setPrefs).toHaveBeenCalledWith({ ballIntroSeen: true });
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, framing: 'ball' } });
    expect(balls.ballQueue.request).toHaveBeenCalledWith('c1');
  });

  test('"Cortar o lance primeiro" leaves it off', async () => {
    __setClip({ ...base, focus: focusReady });
    await openEdit('Foco');
    await act(async () => fireEvent.press(ballCard()));
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Cortar o lance primeiro' })));
    expect(repo.updateClip).not.toHaveBeenCalledWith('c1', expect.objectContaining({ edit: expect.anything() }));
  });

  test('while it analyses, the chip on the video shows it; Modo Foco keeps framing; ✕ goes back to the framing before', async () => {
    __setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: true, ballIntroSeen: true });
    __setClip({ ...base, focus: focusReady, edit: { muted: false, framing: 'ball' } });
    await openEdit('Foco');
    expect(balls.ballQueue.request).toHaveBeenCalledWith('c1');
    // in the editor the progress is on the Bola card only, nothing on the video (spec 2026-11-11, P1)
    expect(screen.queryByText('Rastreando a bola…')).toBeNull();
    expect(ballCard().props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByText('Rastreando a bola… você pode continuar editando.')).toBeTruthy();
    expect(video.last.follow).toBeDefined(); // the current picture (Modo Foco) meanwhile
    expect(video.last.content).toBeUndefined();
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Parar o rastreamento' })));
    expect(balls.ballQueue.cancel).toHaveBeenCalledWith('c1');
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, framing: 'none' } });
  });

  test('ready: a 9:16 preview following the ball; a pinch turns it off', async () => {
    __setClip({ ...base, focus: focusReady, ball: ballReady, edit: { muted: false, framing: 'ball' } });
    await openEdit('Foco');
    expect(readFocusFile).toHaveBeenCalledWith('/c1.ball.json', 'portrait');
    expect(screen.queryByText('Seguir a Bola · 9:16')).toBeNull(); // the tag is on the clip screen, not in the editor
    expect(video.last.content).toBeDefined();
    expect(video.last.box.height).toBeGreaterThan(video.last.box.width); // the vertical frame
    expect(screen.getByRole('radio', { name: /^Jogadores/ }).props.accessibilityState).toMatchObject({ checked: false });
    expect(ballCard().props.accessibilityState).toMatchObject({ checked: true });
    await act(async () => video.last.onCommit({ scale: 2, cx: 0.5, cy: 0.5 }));
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, framing: 'none' } });
  });

  test('on the clip screen while Bola is tracked: a pill with ✕, Salvar and Enviar wait (spec 2026-11-11, P1)', async () => {
    __setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: true, ballIntroSeen: true });
    __setClip({ ...base, focus: focusReady, edit: { muted: false, framing: 'ball' } });
    await open();
    expect(screen.getByText('Rastreando a bola…')).toBeTruthy();
    expect(screen.getByText('Salvar e Enviar ficam disponíveis quando o rastreamento terminar.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar na galeria' }).props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => fireEvent.press(screen.getByRole('button', { name: 'Parar o rastreamento da bola' })));
    expect(balls.ballQueue.cancel).toHaveBeenCalledWith('c1');
  });

  test('Jogadores while Bola is on: instant, and the analysis stops', async () => {
    __setClip({ ...base, focus: focusReady, edit: { muted: false, framing: 'ball' } });
    await openEdit('Foco');
    await act(async () => fireEvent.press(screen.getByRole('radio', { name: /^Jogadores/ })));
    expect(balls.ballQueue.cancel).toHaveBeenCalledWith('c1');
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false } });
  });

  test('hidden where the phone cannot run it', async () => {
    balls.ballAvailable.mockReturnValue(false);
    await openEdit('Foco');
    expect(screen.queryByRole('radio', { name: /^Bola/ })).toBeNull();
  });

  test('no ball in play on this cut: back to the framing before the tap, Bola dimmed (spec 2026-11-11)', async () => {
    __setPrefs({ ...jest.requireActual('../../data/schema').DEFAULT_PREFS, focusIntroSeen: true, ballIntroSeen: true });
    const unsuitable = { v: 1, status: 'unsuitable', startMs: 30000, endMs: 60000, sport: 'basquete', reason: 'rarelyFound' };
    __setClip({ ...base, focus: focusReady, ball: unsuitable, edit: { muted: false, framing: 'ball' } });
    await openEdit('Foco');
    expect(repo.updateClip).toHaveBeenLastCalledWith('c1', { edit: { speed: 1, muted: false, framing: 'none' } });
  });
});
