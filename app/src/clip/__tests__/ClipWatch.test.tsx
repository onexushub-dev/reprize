import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { colors } from '../../theme/tokens';
import { ClipWatch } from '../ClipWatch';

/** react-native-svg stores a colour as an ARGB number: '#FF5A36' → 0xFFFF5A36. */
const argb = (hex: string) => (0xff000000 + parseInt(hex.slice(1), 16)) >>> 0;

function props(over: object = {}) {
  return {
    renderStage: () => <Text>vídeo</Text>,
    name: '',
    placeholder: 'Clipe #2 · 19:40',
    onChangeName: jest.fn(),
    onSaveName: jest.fn(),
    onBack: jest.fn(),
    onDelete: jest.fn(),
    focusTag: undefined as 'on' | 'preparing' | undefined,
    onFocusTag: jest.fn(),
    progress: <Text>progresso</Text>,
    onEdit: jest.fn(),
    onSave: jest.fn(),
    onShare: jest.fn(),
    actionsDisabled: false,
    saving: false,
    sharing: false,
    fast: false,
    ...over,
  };
}

test('watching shows the video, the name, delete, and Editar · Salvar · Enviar', async () => {
  const p = props();
  await render(<ClipWatch {...p} />);
  expect(screen.getByText('vídeo')).toBeTruthy();
  expect(screen.getByLabelText('Etiqueta do clipe').props.placeholder).toBe('Clipe #2 · 19:40');
  expect(screen.getByText('Salvar')).toBeTruthy();
  expect(screen.getByText('Enviar')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Editar' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Salvar na galeria' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Apagar clipe' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Voltar' }));
  expect(p.onEdit).toHaveBeenCalled();
  expect(p.onSave).toHaveBeenCalled();
  expect(p.onShare).toHaveBeenCalled();
  expect(p.onDelete).toHaveBeenCalled();
  expect(p.onBack).toHaveBeenCalled();
  expect(screen.queryByRole('tab')).toBeNull();
});

test('the delete button is white like the others around the video, not red (2026-11-22)', async () => {
  const view = await render(<ClipWatch {...props()} />);
  expect(screen.getByRole('button', { name: 'Apagar clipe' })).toBeTruthy();
  const tree = JSON.stringify(view.toJSON());
  expect(tree).not.toContain(`"stroke":{"type":0,"payload":${argb(colors.rec)}}`);
  expect(tree).toContain(`"stroke":{"type":0,"payload":${argb(colors.text)}}`);
});

test('the Modo Foco tag says on or preparing, and opens it', async () => {
  const p = props({ focusTag: 'on' });
  const view = await render(<ClipWatch {...p} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Modo Foco' }));
  expect(p.onFocusTag).toHaveBeenCalled();
  await view.rerender(<ClipWatch {...props({ focusTag: 'preparing' })} />);
  expect(screen.getByText('Rastreando os jogadores…')).toBeTruthy();
  await view.rerender(<ClipWatch {...props({ focusTag: 'found' })} />);
  expect(screen.getByText('Jogadores encontrados')).toBeTruthy();
  await view.rerender(<ClipWatch {...props()} />);
  expect(screen.queryByText(/Modo Foco/)).toBeNull();
});

test('the Jogadores tag shows the percent while tracking, when the phone sends one (Android)', async () => {
  await render(<ClipWatch {...props({ focusTag: 'preparing', focusPercent: 42 })} />);
  expect(screen.getByText('Rastreando os jogadores · 42%')).toBeTruthy();
  expect(screen.queryByText('Rastreando os jogadores…')).toBeNull();
});

test('holding says "Velocidade: 2x" low on the screen, only while held; the notice line when given', async () => {
  const view = await render(<ClipWatch {...props({ notice: 'Erro' })} />);
  expect(screen.queryByText('Velocidade: 2x')).toBeNull();
  expect(screen.getByText('Erro')).toBeTruthy();
  await view.rerender(<ClipWatch {...props({ fast: true })} />);
  expect(screen.getByText('Velocidade: 2x')).toBeTruthy();
  expect(screen.queryByText('2x')).toBeNull();
});

test('the strip of clips sits between the player and the actions', async () => {
  await render(<ClipWatch {...props({ strip: <Text>miniaturas</Text> })} />);
  expect(screen.getByText('progresso')).toBeTruthy();
  expect(screen.getByText('miniaturas')).toBeTruthy();
  expect(screen.queryByText(/deslize para trocar/)).toBeNull();
});

test('with the controls hidden (a tap on the video) only the video is left', async () => {
  const view = await render(<ClipWatch {...props({ chrome: false })} />);
  expect(screen.getByText('vídeo')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
  await view.rerender(<ClipWatch {...props({ chrome: true })} />);
  expect(screen.getByRole('button', { name: 'Editar' })).toBeTruthy();
});

test('Salvar and Enviar wait while disabled', async () => {
  const p = props({ actionsDisabled: true });
  await render(<ClipWatch {...p} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(p.onShare).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Salvar na galeria' }).props.accessibilityState).toMatchObject({ disabled: true });
});

test('a tap on the name puts the cursor after it, with nothing selected (2026-11-21)', async () => {
  await render(<ClipWatch {...props({ name: 'Ace no fundo' })} />);
  const input = screen.getByLabelText('Etiqueta do clipe');
  expect(input.props.selectTextOnFocus).toBeFalsy();
  await fireEvent(input, 'focus');
  expect(screen.getByLabelText('Etiqueta do clipe').props.selection).toEqual({ start: 12, end: 12 });
  await fireEvent(screen.getByLabelText('Etiqueta do clipe'), 'selectionChange', { nativeEvent: { selection: { start: 12, end: 12 } } });
  expect(screen.getByLabelText('Etiqueta do clipe').props.selection).toBeUndefined();
});
