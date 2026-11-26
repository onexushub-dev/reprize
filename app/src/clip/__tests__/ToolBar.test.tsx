import { fireEvent, render, screen } from '@testing-library/react-native';

import { ToolBar } from '../ToolBar';

const sound = (on = true, onToggle = () => {}) => ({ on, onToggle });

test('one tab per tool with a panel, the open one selected, Foco marked when on; Som a switch between them', async () => {
  const onOpen = jest.fn();
  await render(<ToolBar open="speed" focusOn onOpen={onOpen} sound={sound()} />);
  const tabs = screen.getAllByRole('tab');
  expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual(['Foco, ligado', 'Velocidade', 'Zoom', 'Girar']);
  expect(screen.getByRole('tab', { name: 'Velocidade' }).props.accessibilityState).toMatchObject({ selected: true });
  await fireEvent.press(screen.getByRole('tab', { name: 'Zoom' }));
  expect(onOpen).toHaveBeenCalledWith('zoom');
});

test('Som is a switch: its icon shows the sound the clip has, a tap toggles it (2026-11-26)', async () => {
  const onOpen = jest.fn();
  const onToggle = jest.fn();
  const view = await render(<ToolBar open="speed" focusOn={false} onOpen={onOpen} sound={sound(true, onToggle)} />);
  expect(screen.getByRole('switch', { name: 'Som' })).toBeChecked();
  expect(screen.getByTestId('sound-icon-on')).toBeTruthy();
  await fireEvent.press(screen.getByRole('switch', { name: 'Som' }));
  expect(onToggle).toHaveBeenCalledTimes(1);
  await view.rerender(<ToolBar open="speed" focusOn={false} onOpen={onOpen} sound={sound(false, onToggle)} />);
  expect(screen.getByRole('switch', { name: 'Som' })).not.toBeChecked();
  expect(screen.getByTestId('sound-icon-off')).toBeTruthy();
});

test('Som last tapped: it is the selected tab, amber like the others (2026-11-26)', async () => {
  await render(<ToolBar open="sound" focusOn={false} onOpen={() => {}} sound={sound()} />);
  expect(screen.getByRole('switch', { name: 'Som' }).props.accessibilityState).toMatchObject({ selected: true });
  expect(screen.getByRole('tab', { name: 'Velocidade' }).props.accessibilityState).toMatchObject({ selected: false });
});

test('Foco off is just Foco', async () => {
  await render(<ToolBar open="focus" focusOn={false} onOpen={() => {}} sound={sound()} />);
  expect(screen.getByRole('tab', { name: 'Foco' }).props.accessibilityState).toMatchObject({ selected: true });
});
