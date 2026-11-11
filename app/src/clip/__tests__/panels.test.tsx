import { translate } from '../../i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { readEdit } from '../../share/editing';
import { EDIT_TOOLS, type ToolContext } from '../tools';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    edit: { ...readEdit(undefined), framing: 'none', focus: false },
    plan: 'paid',
    unlock: jest.fn(),
    setEdit: jest.fn(),
    focus: 'off',
    ball: 'off',
    ballPercent: undefined,
    ballCooling: false,
    ballReason: undefined,
    sport: 'basquete',
    sportHow: 'detected',
    pickFraming: jest.fn(),
    stopFraming: jest.fn(),
    chooseSport: jest.fn(),
    resetZoom: jest.fn(),
    turn: jest.fn(),
    ...over,
  };
}

const panel = (id: string) => EDIT_TOOLS.find((t) => t.id === id)!.Panel;

test('the tools, in order, with their names', () => {
  expect(EDIT_TOOLS.map((tool) => [tool.id, translate('pt-BR', tool.label)])).toEqual([
    ['focus', 'Foco'],
    ['speed', 'Velocidade'],
    ['sound', 'Som'],
    ['zoom', 'Zoom'],
    ['rotate', 'Girar'],
  ]);
});

test('Velocidade explains itself and stores the chosen speed', async () => {
  const c = ctx();
  const Panel = panel('speed');
  await render(<Panel ctx={c} />);
  expect(screen.getByText('Escolha a velocidade de reprodução do clipe.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Velocidade 1x' }).props.accessibilityState).toMatchObject({ selected: true });
  await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
  expect(c.setEdit).toHaveBeenCalledWith({ speed: 2 });
});

test('Som turns the sound off and on, and is off and locked at another speed', async () => {
  const c = ctx();
  const Panel = panel('sound');
  const view = await render(<Panel ctx={c} />);
  expect(screen.getByText('Ative ou desative o som do clipe.')).toBeTruthy();
  expect(screen.getByText('Com som')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Som' }));
  expect(c.setEdit).toHaveBeenCalledWith({ muted: true });
  const fast = ctx({ edit: { ...readEdit(undefined), speed: 2 } });
  await view.rerender(<Panel ctx={fast} />);
  expect(screen.getByText('Sem som')).toBeTruthy();
  expect(screen.getByText('Fora de 1x o vídeo sai sem som.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Som' }));
  expect(fast.setEdit).not.toHaveBeenCalled();
});

test('Zoom shows the hand zoom and goes back to 1x', async () => {
  const Panel = panel('zoom');
  const c = ctx({ edit: { ...readEdit(undefined), zoom: { scale: 2, cx: 0.5, cy: 0.5 } } });
  const view = await render(<Panel ctx={c} />);
  expect(screen.getByText('Pince o vídeo para aproximar. Com zoom manual o Modo Foco e o Seguir a Bola desligam.')).toBeTruthy();
  expect(screen.getByText('2.0x')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Voltar zoom para 1x' }));
  expect(c.resetZoom).toHaveBeenCalled();
  await view.rerender(<Panel ctx={ctx()} />);
  expect(screen.getByText('1.0x')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Voltar zoom para 1x' })).toBeNull();
});

test('Girar turns the video', async () => {
  const c = ctx();
  const Panel = panel('rotate');
  await render(<Panel ctx={c} />);
  expect(screen.getByText('Para um vídeo gravado de lado.')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Girar vídeo' }));
  expect(c.turn).toHaveBeenCalled();
});

const card = (name: string) => screen.getByRole('radio', { name });

test('Foco: Original, Jogadores and Bola, Original by default, nothing applied until a tap (spec 2026-11-11)', async () => {
  const Panel = panel('focus');
  const c = ctx();
  await render(<Panel ctx={c} />);
  expect(card('Original').props.accessibilityState).toMatchObject({ checked: true });
  expect(card('Jogadores').props.accessibilityState).toMatchObject({ checked: false });
  expect(card('Bola').props.accessibilityState).toMatchObject({ checked: false });
  expect(screen.getByText('O clipe como foi gravado. Escolha um enquadramento.')).toBeTruthy();
  expect(screen.getByText('Mantenha o dedo pressionado no vídeo para ver o clipe original')).toBeTruthy();
  await fireEvent.press(card('Jogadores'));
  expect(c.pickFraming).toHaveBeenCalledWith('focus');
  await fireEvent.press(card('Bola'));
  expect(c.pickFraming).toHaveBeenCalledWith('ball');
});

test('Jogadores: preparing on its card, then its hint; no card where it cannot frame', async () => {
  const Panel = panel('focus');
  const focusEdit = { ...readEdit(undefined), framing: 'focus' as const, focus: true };
  const view = await render(<Panel ctx={ctx({ edit: focusEdit, focus: 'preparing' })} />);
  expect(card('Jogadores, rastreando').props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByText('Rastreando os jogadores… você pode continuar editando.')).toBeTruthy();
  await view.rerender(<Panel ctx={ctx({ edit: focusEdit, focus: 'on' })} />);
  expect(screen.getByText('A câmera acompanha os jogadores, com zoom quando a jogada se concentra.')).toBeTruthy();
  await view.rerender(<Panel ctx={ctx({ focus: 'unavailable' })} />);
  expect(screen.queryByRole('radio', { name: 'Jogadores' })).toBeNull();
});

test('Bola: its percent on the card while it analyses, then its hint', async () => {
  const Panel = panel('focus');
  const ballEdit = { ...readEdit(undefined), framing: 'ball' as const, focus: false };
  const c = ctx({ edit: ballEdit, ball: 'analysing', ballPercent: 62 });
  const view = await render(<Panel ctx={c} />);
  expect(card('Bola, rastreando 62%')).toBeTruthy();
  expect(screen.getByText('62%')).toBeTruthy();
  // ✕ on the card being tracked stops it
  await fireEvent.press(screen.getByRole('button', { name: 'Parar o rastreamento' }));
  expect(c.stopFraming).toHaveBeenCalled();
  expect(screen.getByText('Rastreando a bola… você pode continuar editando.')).toBeTruthy();
  await view.rerender(<Panel ctx={ctx({ edit: ballEdit, ball: 'on' })} />);
  expect(screen.getByText('A câmera segue a bola, na vertical 9:16 para Stories, Reels e TikTok.')).toBeTruthy();
});

test('Bola waiting for the phone to cool down: "Aguardando", and why, instead of 0%', async () => {
  const Panel = panel('focus');
  const ballEdit = { ...readEdit(undefined), framing: 'ball' as const, focus: false };
  await render(<Panel ctx={ctx({ edit: ballEdit, ball: 'analysing', ballCooling: true })} />);
  expect(card('Bola, aguardando o celular esfriar')).toBeTruthy();
  expect(screen.getByText('Aguardando')).toBeTruthy();
  expect(screen.queryByText('0%')).toBeNull();
  expect(screen.getByText(/O celular está quente/)).toBeTruthy();
});

test('a clip stored on Bola whose sport is not known shows as Original', async () => {
  const Panel = panel('focus');
  const ballEdit = { ...readEdit(undefined), framing: 'ball' as const, focus: false };
  await render(<Panel ctx={ctx({ edit: ballEdit, ball: 'hidden', sport: undefined, sportHow: undefined })} />);
  expect(card('Original').props.accessibilityState).toMatchObject({ checked: true });
});

test('Bola: no card for a sport without a ball model, nor when the sport is not known', async () => {
  const Panel = panel('focus');
  const view = await render(<Panel ctx={ctx({ ball: 'hidden', sport: 'tenis', sportHow: 'chosen' })} />);
  expect(screen.queryByRole('radio', { name: 'Bola' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Esporte da gravação: Tênis. Trocar' })).toBeTruthy();
  await view.rerender(<Panel ctx={ctx({ ball: 'hidden', sport: undefined, sportHow: undefined })} />);
  expect(screen.queryByRole('radio', { name: 'Bola' })).toBeNull();
  expect(screen.getByText('Escolher esporte')).toBeTruthy();
  expect(screen.getByText('Não identificamos o esporte. Toque em Escolher esporte para ver todos os enquadramentos.')).toBeTruthy();
});

test('Bola found no ball in this cut: dimmed, the clip stays as it was (test 47a)', async () => {
  const Panel = panel('focus');
  await render(<Panel ctx={ctx({ ball: 'unsuitable', ballReason: 'rarelyFound' })} />);
  expect(card('Bola').props.accessibilityState).toMatchObject({ disabled: true });
  expect(screen.getByText('Não encontramos uma bola em jogo neste trecho. O clipe continua como estava.')).toBeTruthy();
});

test('the sport chip: "identificado" only when worked out; the sheet lists every sport', async () => {
  const Panel = panel('focus');
  const c = ctx();
  const view = await render(<Panel ctx={c} />);
  expect(screen.getByText('· identificado')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Esporte da gravação: Basquete. Trocar' }));
  expect(screen.getByText('IDENTIFICADO')).toBeTruthy();
  expect(screen.getByRole('radio', { name: 'Basquete' }).props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(screen.getByRole('radio', { name: 'Futevôlei' }));
  expect(c.chooseSport).toHaveBeenCalledWith('futevolei');
  await view.rerender(<Panel ctx={ctx({ sportHow: 'chosen' })} />);
  expect(screen.queryByText('· identificado')).toBeNull();
});

test('not known: the sheet opens with nothing marked', async () => {
  const Panel = panel('focus');
  await render(<Panel ctx={ctx({ ball: 'hidden', sport: undefined, sportHow: undefined })} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Esporte da gravação: Escolher esporte. Trocar' }));
  expect(screen.queryByText('IDENTIFICADO')).toBeNull();
  for (const name of ['Basquete', 'Beach tennis', 'Tênis', 'Futevôlei', 'Futebol', 'Vôlei', 'Vôlei de praia', 'Handebol', 'Outro']) {
    expect(screen.getByRole('radio', { name }).props.accessibilityState).toMatchObject({ checked: false });
  }
});

test('on a free recording the sound works, and the hint says it does not leave the app', async () => {
  const c = ctx({ plan: 'free' });
  const Panel = panel('sound');
  await render(<Panel ctx={c} />);
  expect(screen.getByText('O som toca aqui no app, mas só vai no clipe salvo ou enviado com o PRO.')).toBeTruthy();
  expect(screen.getByLabelText('PRO')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Som' }));
  expect(c.setEdit).toHaveBeenCalledWith({ muted: true });
  expect(c.unlock).not.toHaveBeenCalled();
});

test('on a free recording Jogadores works, and the note says it does not leave the app', async () => {
  const c = ctx({ focus: 'on', plan: 'free', edit: { ...readEdit(undefined), framing: 'focus', focus: true } });
  const Panel = panel('focus');
  await render(<Panel ctx={c} />);
  expect(screen.getByText('O Modo Foco funciona aqui no app, mas só vai no clipe salvo ou enviado com o PRO.')).toBeTruthy();
  expect(screen.getByLabelText('PRO')).toBeTruthy();
  await fireEvent.press(card('Original'));
  expect(c.pickFraming).toHaveBeenCalledWith('none');
  expect(c.unlock).not.toHaveBeenCalled();
});

test('on a free recording the speed works and goes into the video: no Pro note, no badge', async () => {
  const c = ctx({ plan: 'free' });
  const Panel = panel('speed');
  await render(<Panel ctx={c} />);
  expect(screen.getByText('Escolha a velocidade de reprodução do clipe.')).toBeTruthy();
  expect(screen.queryByLabelText('PRO')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Velocidade 2x' }));
  expect(c.setEdit).toHaveBeenCalledWith({ speed: 2 });
  expect(c.unlock).not.toHaveBeenCalled();
});
