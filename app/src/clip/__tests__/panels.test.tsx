import { translate } from '../../i18n';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { readEdit } from '../../share/editing';
import { EDIT_TOOLS, type ToolContext } from '../tools';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
  return {
    edit: readEdit(undefined),
    plan: 'paid',
    unlock: jest.fn(),
    setEdit: jest.fn(),
    focus: 'on',
    toggleFocus: jest.fn(),
    ball: 'hidden',
    toggleBall: jest.fn(),
    unlockBall: jest.fn(),
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

test('Foco: a switch when ready, a wait while preparing, a message when it cannot frame', async () => {
  const Panel = panel('focus');
  const c = ctx();
  const view = await render(<Panel ctx={c} />);
  expect(screen.getByText('A câmera acompanha o lance, com zoom quando a jogada se concentra.')).toBeTruthy();
  expect(screen.getByText('Mantenha o dedo pressionado no vídeo para ver o clipe original')).toBeTruthy();
  const sw = screen.getByRole('switch', { name: 'Modo Foco' });
  expect(sw.props.accessibilityState).toMatchObject({ checked: true });
  await fireEvent.press(sw);
  expect(c.toggleFocus).toHaveBeenCalled();
  await view.rerender(<Panel ctx={ctx({ focus: 'off' })} />);
  expect(screen.getByRole('switch', { name: 'Modo Foco' }).props.accessibilityState).toMatchObject({ checked: false });
  await view.rerender(<Panel ctx={ctx({ focus: 'preparing' })} />);
  expect(screen.getByText('Preparando o enquadramento…')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Modo Foco' }).props.accessibilityState).toMatchObject({ disabled: true });
  await view.rerender(<Panel ctx={ctx({ focus: 'unavailable' })} />);
  expect(screen.getByText('Modo Foco indisponível para esse clipe.')).toBeTruthy();
  expect(screen.queryByRole('switch', { name: 'Modo Foco' })).toBeNull();
});

test('Seguir a Bola: a second switch under Modo Foco, hidden on phones that cannot run it', async () => {
  const Panel = panel('focus');
  const view = await render(<Panel ctx={ctx({ ball: 'hidden' })} />);
  expect(screen.queryByRole('switch', { name: 'Seguir a Bola' })).toBeNull();
  const c = ctx({ ball: 'off' });
  await view.rerender(<Panel ctx={c} />);
  expect(screen.getByText('A câmera segue a bola, na vertical 9:16 para Stories, Reels e TikTok.')).toBeTruthy();
  expect(screen.getByText('NOVO')).toBeTruthy();
  const sw = screen.getByRole('switch', { name: 'Seguir a Bola' });
  expect(sw.props.accessibilityState).toMatchObject({ checked: false });
  await fireEvent.press(sw);
  expect(c.toggleBall).toHaveBeenCalledTimes(1);
});

test('Seguir a Bola on another sport: "EM BREVE", off, and "É basquete?" unlocks it for the recording', async () => {
  const Panel = panel('focus');
  const c = ctx({ ball: 'soon' });
  await render(<Panel ctx={c} />);
  expect(screen.getByText('EM BREVE')).toBeTruthy();
  expect(screen.getByText('Por enquanto só no basquete.')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Seguir a Bola' }).props.accessibilityState).toMatchObject({ disabled: true });
  await fireEvent.press(screen.getByRole('button', { name: 'É basquete? Liberar nesta gravação' }));
  expect(c.unlockBall).toHaveBeenCalledTimes(1);
});

test('Seguir a Bola on: Modo Foco says why it is off, and how to go back while it analyses', async () => {
  const Panel = panel('focus');
  const view = await render(<Panel ctx={ctx({ focus: 'off', ball: 'analysing' })} />);
  expect(screen.getByRole('switch', { name: 'Seguir a Bola' }).props.accessibilityState).toMatchObject({ checked: true });
  expect(screen.getByText('Ligue para voltar na hora; a análise para.')).toBeTruthy();
  // the progress is on the video, never in the panel
  expect(screen.queryByText(/analisando/)).toBeNull();
  await view.rerender(<Panel ctx={ctx({ focus: 'off', ball: 'on' })} />);
  expect(screen.getByText('Desligado enquanto Seguir a Bola estiver ligado.')).toBeTruthy();
  expect(screen.getByText('Pronto. Trocar de modo agora é instantâneo.')).toBeTruthy();
  expect(screen.getByRole('switch', { name: 'Modo Foco' }).props.accessibilityState).toMatchObject({ checked: false });
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

test('on a free recording Modo Foco works, and the hint says it does not leave the app', async () => {
  const c = ctx({ focus: 'on', plan: 'free' });
  const Panel = panel('focus');
  await render(<Panel ctx={c} />);
  expect(screen.getByText('O Modo Foco funciona aqui no app, mas só vai no clipe salvo ou enviado com o PRO.')).toBeTruthy();
  expect(screen.getByLabelText('PRO')).toBeTruthy();
  await fireEvent.press(screen.getByRole('switch', { name: 'Modo Foco' }));
  expect(c.toggleFocus).toHaveBeenCalledTimes(1);
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
