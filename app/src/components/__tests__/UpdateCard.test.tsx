import { fireEvent, render, screen } from '@testing-library/react-native';

import { UpdateCard } from '../UpdateCard';

test('shows the message, and each button does its part', async () => {
  const onUpdate = jest.fn();
  const onClose = jest.fn();
  await render(<UpdateCard bottom={100} onUpdate={onUpdate} onClose={onClose} />);

  expect(screen.getByText('Nova versão disponível')).toBeTruthy();
  expect(screen.getByText('Atualize o Reprize para acessar os novos recursos e melhorias.')).toBeTruthy();

  await fireEvent.press(screen.getByRole('button', { name: 'Atualizar' }));
  expect(onUpdate).toHaveBeenCalledTimes(1);
  expect(onClose).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Fechar aviso' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});
