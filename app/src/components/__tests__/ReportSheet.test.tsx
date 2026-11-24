import { fireEvent, render, screen } from '@testing-library/react-native';

import { setLocale } from '../../i18n';
import { ReportSheet } from '../ReportSheet';

jest.mock('../../cloud/report', () => ({
  REPORT_CATEGORIES: ['not_authorized', 'minor', 'inappropriate', 'other'],
  reportShare: jest.fn(),
}));
jest.mock('../../analytics', () => ({ track: jest.fn() }));

const { reportShare } = jest.requireMock('../../cloud/report');
const { track } = jest.requireMock('../../analytics');

beforeEach(() => {
  jest.clearAllMocks();
  setLocale('pt-BR');
});

test('a reason must be picked before sending; sent, the sheet thanks and says the link is down', async () => {
  reportShare.mockResolvedValue('ok');
  await render(<ReportSheet code="abc" onClose={jest.fn()} />);
  await fireEvent.press(screen.getByText('Enviar denúncia'));
  expect(reportShare).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByText('Estou neste vídeo e não autorizei'));
  await fireEvent.changeText(screen.getByPlaceholderText('Conte mais (opcional)'), 'sem autorização');
  await fireEvent.press(screen.getByText('Enviar denúncia'));
  expect(reportShare).toHaveBeenCalledWith('abc', 'not_authorized', 'sem autorização');
  expect(track).toHaveBeenCalledWith('share_reported', { category: 'not_authorized' });
  expect(await screen.findByText('Denúncia enviada')).toBeTruthy();
});

test('too many reports today says so and keeps the form', async () => {
  reportShare.mockResolvedValue('too_many');
  await render(<ReportSheet code="abc" onClose={jest.fn()} />);
  await fireEvent.press(screen.getByText('Outro motivo'));
  await fireEvent.press(screen.getByText('Enviar denúncia'));
  expect(await screen.findByText('Muitas denúncias enviadas deste celular hoje. Tente de novo amanhã.')).toBeTruthy();
  expect(track).not.toHaveBeenCalled();
});
