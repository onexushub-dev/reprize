import { remoteDeviceView } from '../remoteDevice';

const base = { pressed: false, testedBefore: false, waitedLong: false };

test('never used: asks to connect, shows the steps and the waiting state', () => {
  expect(remoteDeviceView(base)).toEqual({
    state: 'setup',
    statusText: 'Toque para conectar',
    showSteps: true,
    stepsBehindRepair: false,
    showWaiting: true,
    preparing: false,
    showNote: false,
    note: expect.stringMatching(/Confira se o controle aparece/),
  });
});

test('used in a previous launch: never claims "paired" (iOS hides pairing), asks for a press, steps behind "parear de novo"', () => {
  expect(remoteDeviceView({ ...base, testedBefore: true })).toEqual({
    state: 'offline',
    statusText: 'Em espera · aperte um botão',
    showSteps: false,
    stepsBehindRepair: true,
    showWaiting: true,
    preparing: false,
    showNote: true,
    note: expect.stringMatching(/Confira se o controle aparece/),
  });
});

test('a press this launch: connected, nothing left to do', () => {
  expect(remoteDeviceView({ ...base, pressed: true, testedBefore: true })).toEqual({
    state: 'connected',
    statusText: 'Conectado',
    showSteps: false,
    stepsBehindRepair: false,
    showWaiting: false,
    preparing: false,
    showNote: false,
    note: expect.any(String),
  });
});

test('waiting for a while without a press adds the troubleshooting note and keeps the steps', () => {
  const view = remoteDeviceView({ ...base, waitedLong: true });
  expect(view.showSteps).toBe(true);
  expect(view.showNote).toBe(true);
  expect(view.state).toBe('setup');
});

test('a press hides the note even after a long wait', () => {
  expect(remoteDeviceView({ ...base, pressed: true, waitedLong: true }).showNote).toBe(false);
});

describe('the link iOS shows (a BLE remote the app has learnt)', () => {
  const used = { ...base, testedBefore: true };

  test('connected: "Conectado" without a press', () => {
    const view = remoteDeviceView({ ...used, link: 'connected' });
    expect(view.state).toBe('connected');
    expect(view.statusText).toBe('Conectado');
  });

  test('missing: "Em espera" (it sleeps after a few idle minutes), wake it and press again (a waking press never saves since 2026-11-03), steps behind "Parear de novo"', () => {
    const view = remoteDeviceView({ ...used, link: 'missing' });
    expect(view).toMatchObject({ state: 'offline', statusText: 'Em espera · aperte um botão', stepsBehindRepair: true, showWaiting: true, showNote: true });
    expect(view.note).toMatch(/poupar bateria/);
    expect(view.note).toMatch(/aperte de novo para salvar/);
  });

  test('Bluetooth off: says so and how to turn it on, nothing to press or pair', () => {
    const view = remoteDeviceView({ ...used, link: 'bluetoothOff' });
    expect(view).toMatchObject({ state: 'offline', statusText: 'Bluetooth desligado', stepsBehindRepair: false, showWaiting: false });
    expect(view.note).toMatch(/Central de Controle/);
  });

  test('a press still proves it even when iOS shows it gone (it reconnects on the press)', () => {
    expect(remoteDeviceView({ ...used, pressed: true, link: 'missing' }).state).toBe('connected');
  });

  test('unknown link: presses alone tell, as before', () => {
    expect(remoteDeviceView({ ...used, link: undefined }).statusText).toBe('Em espera · aperte um botão');
  });
});

test('the camera still opening: no "press a button" yet (a press would go to the ringer and be lost)', () => {
  const view = remoteDeviceView({ ...base, testedBefore: true, cameraReady: false });
  expect(view.showWaiting).toBe(false);
  expect(view.preparing).toBe(true);
  expect(remoteDeviceView({ ...base, pressed: true, cameraReady: false }).preparing).toBe(false);
});
