import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect } from 'react';

import { track } from '../../analytics';
import { useClipThumbnail } from '../useClipThumbnail';
import { useFreeExportGate } from '../useFreeExportGate';

const mockSessions: Record<string, { freeNoticeShown?: boolean }> = {};
const mockMarked: string[] = [];
jest.mock('../../data/mmkv', () => ({
  repo: {
    getSession: (id: string) => mockSessions[id],
    listClips: (id: string) => Array.from({ length: id === 's1' ? 8 : 1 }, (_, i) => ({ id: `c${i}` })),
    markFreeNoticeShown: (id: string) => {
      mockMarked.push(id);
      mockSessions[id] = { ...mockSessions[id], freeNoticeShown: true };
    },
  },
}));
const mockFocus = jest.fn(() => true);
jest.mock('../../../modules/replay-camera', () => ({
  createThumbnail: jest.fn(async () => '/tmp/thumb.jpg'),
  isFocusSupported: () => mockFocus(),
}));
const mockOpenPaywall = jest.fn(async (..._a: unknown[]) => 'cancelled');
jest.mock('../../payments/feedback', () => ({ openPaywall: (...a: unknown[]) => mockOpenPaywall(...a) }));
const mockUnlock = jest.fn(async (..._a: unknown[]) => false);
jest.mock('../../payments/unlock', () => ({ unlockRecording: (...a: unknown[]) => mockUnlock(...a) }));
jest.mock('../../analytics', () => ({ track: jest.fn() }));

let gate: ReturnType<typeof useFreeExportGate>;
function Harness() {
  const current = useFreeExportGate();
  useEffect(() => {
    gate = current; // after render, not during it: the tests reach the hook through this
  });
  return current.sheet;
}

beforeEach(() => {
  for (const k of Object.keys(mockSessions)) delete mockSessions[k];
  mockSessions.s1 = {};
  mockMarked.length = 0;
  mockOpenPaywall.mockClear();
  mockUnlock.mockClear();
});
afterEach(() => jest.useRealTimers());

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));

test('the first export of a recording opens the full sheet: the clip as free and as PRO, what it has named first; "Cancelar" stops it and marks nothing', async () => {
  await render(<Harness />);
  let go: boolean | undefined;
  await act(async () => void gate.ask('s1', { focus: false, sound: true }, 'save').then((g) => (go = g)));
  expect(screen.getByText('Salve seus clipes com qualidade PRO')).toBeTruthy();
  expect(screen.getByText('Seu clipe tem som')).toBeTruthy();
  expect(screen.getByLabelText('GRÁTIS: Sem som, Sem Modo Foco, HD, Com marca d’água')).toBeTruthy();
  // The free plan never has Modo Foco: "Sem Modo Foco" is crossed out even when this clip does not use it.
  expect(screen.getByText('Sem Modo Foco')).toBeTruthy();
  expect(screen.getByText('Com Modo Foco')).toBeTruthy();
  expect(screen.getByLabelText('PRO: Com som, Com Modo Foco, Full HD, Sem marca d’água')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Assinar o PRO' })).toBeTruthy();
  expect(screen.getByText('Todas as gravações · mensal ou anual')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Só para esta gravação' })).toBeTruthy();
  expect(screen.getByText('Pagamento único · todos os clipes inclusos')).toBeTruthy();
  for (const gone of ['Plano anual com 7 dias grátis', 'Este clipe usa']) expect(screen.queryByText(gone)).toBeNull();
  expect(screen.queryByText(/ sai /)).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  await settle();
  expect(go).toBe(false);
  expect(mockMarked).toEqual([]);
});

test('where the phone has no Modo Foco (Android) the sheet does not sell it', async () => {
  mockFocus.mockReturnValue(false);
  try {
    await render(<Harness />);
    await act(async () => void gate.ask('s1', { focus: false, sound: true }, 'save'));
    expect(screen.getByLabelText('GRÁTIS: Sem som, HD, Com marca d’água')).toBeTruthy();
    expect(screen.getByLabelText('PRO: Com som, Full HD, Sem marca d’água')).toBeTruthy();
    expect(screen.queryByText(/Modo Foco/)).toBeNull();
  } finally {
    mockFocus.mockReturnValue(true);
  }
});

test('"Continuar no plano grátis" goes on and marks the recording: its next export goes on with no notice at all', async () => {
  jest.useFakeTimers();
  await render(<Harness />);
  let go: boolean | undefined;
  await act(async () => void gate.ask('s1', { focus: true, sound: false }, 'save').then((g) => (go = g)));
  await fireEvent.press(screen.getByRole('button', { name: 'Continuar no plano grátis' }));
  await act(async () => void jest.advanceTimersByTime(10));
  expect(go).toBe(true);
  expect(mockMarked).toEqual(['s1']);

  let again: boolean | undefined;
  await act(async () => void gate.ask('s1', { focus: true, sound: false }, 'save').then((g) => (again = g)));
  expect(again).toBe(true); // never stops the export
  expect(screen.queryByText('Continuar no plano grátis')).toBeNull();
  expect(screen.queryByText('Salve seus clipes com qualidade PRO')).toBeNull();
  expect(screen.queryByText(/^(Salvo|Enviado) em /)).toBeNull(); // no short note any more
  expect(screen.queryByRole('button', { name: 'Liberar' })).toBeNull();
});

test('another recording still gets the full sheet', async () => {
  mockSessions.s2 = { freeNoticeShown: true };
  mockSessions.s3 = {};
  await render(<Harness />);
  await act(async () => void gate.ask('s2', { focus: false, sound: false }, 'save'));
  expect(screen.queryByText('Continuar no plano grátis')).toBeNull();
  await act(async () => void gate.ask('s3', { focus: false, sound: false }, 'save'));
  expect(screen.getByText('Continuar no plano grátis')).toBeTruthy();
});

test('"Assinar o PRO" stops the export and opens the Pro paywall only once the sheet has closed', async () => {
  jest.useFakeTimers();
  await render(<Harness />);
  let go: boolean | undefined;
  await act(async () => void gate.ask('s1', { focus: false, sound: true }, 'save').then((g) => (go = g)));
  await fireEvent.press(screen.getByRole('button', { name: 'Assinar o PRO' }));
  await act(async () => {});
  expect(go).toBeUndefined();
  expect(mockOpenPaywall).not.toHaveBeenCalled();
  await act(async () => void jest.advanceTimersByTime(900));
  expect(go).toBe(false);
  expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
  expect(mockUnlock).not.toHaveBeenCalled();
  expect(mockMarked).toEqual([]);
});

test('"Só para esta gravação" (the Single Pass) stops the export and unlocks the recording', async () => {
  jest.useFakeTimers();
  await render(<Harness />);
  let go: boolean | undefined;
  await act(async () => void gate.ask('s1', { focus: false, sound: true }, 'save').then((g) => (go = g)));
  await fireEvent.press(screen.getByRole('button', { name: 'Só para esta gravação' }));
  await act(async () => void jest.advanceTimersByTime(900));
  expect(go).toBe(false);
  expect(mockUnlock).toHaveBeenCalledWith('s1', expect.any(Function), 'export_limit');
  expect(mockOpenPaywall).not.toHaveBeenCalled();
});

test('the title follows the button: Enviar says "Envie…", Salvar says "Salve…"', async () => {
  await render(<Harness />);
  await act(async () => void gate.ask('s1', { focus: false, sound: false }, 'share'));
  expect(screen.getByText('Envie seus clipes com qualidade PRO')).toBeTruthy();
  expect(screen.queryByText('Salve seus clipes com qualidade PRO')).toBeNull();
});

test('a clip with neither sound nor Modo Foco shows no chip; a batch speaks of "Seus clipes"', async () => {
  await render(<Harness />);
  await act(async () => void gate.ask('s2', { focus: false, sound: false }, 'save'));
  expect(screen.queryByText(/^Seu clipe tem/)).toBeNull();
  expect(screen.getByText('Pagamento único · todos os clipes inclusos')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Cancelar' }));
  await settle();
  await act(async () => void gate.ask('s1', { focus: true, sound: true }, 'share', { many: true }));
  expect(screen.getByText('Seus clipes têm som e Modo Foco')).toBeTruthy();
});

test('a later Send of a recording that already showed the sheet goes on with nothing on screen', async () => {
  mockSessions.s1 = { freeNoticeShown: true };
  await render(<Harness />);
  let go: boolean | undefined;
  await act(async () => void gate.ask('s1', { focus: false, sound: true }, 'share').then((g) => (go = g)));
  expect(go).toBe(true);
  expect(screen.queryByText('Envie seus clipes com qualidade PRO')).toBeNull();
  expect(screen.queryByText(/^Enviado em /)).toBeNull();
  expect(mockUnlock).not.toHaveBeenCalled();
});

test('the previews show a frame of the clip, even one already made for the screen behind', async () => {
  // The clip screen made this frame first: the sheet opens with it already in the cache.
  function Behind() {
    useClipThumbnail('/clips/a.mov', 0);
    return null;
  }
  await render(<Behind />);
  await settle();
  await render(<Harness />);
  await act(async () => void gate.ask('s1', { focus: false, sound: true }, 'save', { preview: { path: '/clips/a.mov', atMs: 0 } }));
  await settle();
  const frames = screen.getAllByTestId('export-preview-frame');
  expect(frames).toHaveLength(2);
  for (const f of frames) expect(JSON.stringify(f.props.source)).toContain('file:///tmp/thumb.jpg');
});

test('offer() opens the sheet from the PRO card of a recording, even after its export notice, with no "continue"', async () => {
  jest.useFakeTimers();
  mockSessions.s1 = { freeNoticeShown: true };
  await render(<Harness />);
  await act(async () => void gate.offer('s1', { focus: true, sound: true }));
  expect(screen.getByText('Libere a qualidade PRO nesta gravação')).toBeTruthy();
  expect(screen.getByText('Seu clipe tem som e Modo Foco')).toBeTruthy();
  expect(screen.queryByText('Continuar no plano grátis')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Só para esta gravação' }));
  await act(async () => void jest.advanceTimersByTime(900));
  expect(mockUnlock).toHaveBeenCalledWith('s1', expect.any(Function), 'upgrade_card');
  expect(mockMarked).toEqual([]);
});

test('opening the free-plan notice reports free_export_limit_hit; a recording that already saw it reports nothing', async () => {
  (track as jest.Mock).mockClear();
  await render(<Harness />);
  await act(async () => void gate.ask('s1', { focus: true, sound: false }, 'save'));
  expect(track).toHaveBeenCalledTimes(1);
  expect(track).toHaveBeenCalledWith('free_export_limit_hit');

  (track as jest.Mock).mockClear();
  mockSessions.s2 = { freeNoticeShown: true };
  await act(async () => void gate.ask('s2', { focus: true, sound: false }, 'save'));
  expect(track).not.toHaveBeenCalled();
});

test('the paywall a sheet leads to says where it was opened: an export or the PRO card', async () => {
  jest.useFakeTimers();
  await render(<Harness />);
  await act(async () => void gate.ask('s1', { focus: true, sound: false }, 'save'));
  await fireEvent.press(screen.getByRole('button', { name: 'Assinar o PRO' }));
  await act(async () => void jest.advanceTimersByTime(900));
  expect(mockOpenPaywall).toHaveBeenCalledWith(expect.any(Function), 'export_limit');

  await act(async () => void gate.offer('s1', { focus: true, sound: true }));
  await fireEvent.press(screen.getByRole('button', { name: 'Só para esta gravação' }));
  await act(async () => void jest.advanceTimersByTime(900));
  expect(mockUnlock).toHaveBeenCalledWith('s1', expect.any(Function), 'upgrade_card');
});

test('the choice on the sheet is reported with where the sheet came from', async () => {
  jest.useFakeTimers();
  await render(<Harness />);
  (track as jest.Mock).mockClear();
  await act(async () => void gate.ask('s1', { focus: true, sound: false }, 'share'));
  await fireEvent.press(screen.getByRole('button', { name: 'Continuar no plano grátis' }));
  expect(track).toHaveBeenCalledWith('free_export_choice', { choice: 'go', kind: 'share' });

  await act(async () => void jest.advanceTimersByTime(10));
  await act(async () => void gate.offer('s1', { focus: true, sound: true }));
  await fireEvent.press(screen.getByRole('button', { name: 'Assinar o PRO' }));
  expect(track).toHaveBeenCalledWith('free_export_choice', { choice: 'pro', kind: 'unlock' });
});
