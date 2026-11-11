import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ClipWatch } from '../ClipWatch';

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

test('the 2x badge shows only while held, and the position and notice lines when given', async () => {
  const view = await render(<ClipWatch {...props({ position: '2 de 3 · deslize para trocar', notice: 'Erro' })} />);
  expect(screen.queryByText('2x')).toBeNull();
  expect(screen.getByText('2 de 3 · deslize para trocar')).toBeTruthy();
  expect(screen.getByText('Erro')).toBeTruthy();
  await view.rerender(<ClipWatch {...props({ fast: true })} />);
  expect(screen.getByText('2x')).toBeTruthy();
});

test('Salvar and Enviar wait while disabled', async () => {
  const p = props({ actionsDisabled: true });
  await render(<ClipWatch {...p} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Compartilhar' }));
  expect(p.onShare).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Salvar na galeria' }).props.accessibilityState).toMatchObject({ disabled: true });
});
