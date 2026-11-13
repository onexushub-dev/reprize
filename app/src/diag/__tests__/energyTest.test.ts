import { energyBlocks, energyText } from '../energyTest';

const pulse = (min: number, battery: number, config: string, heat = 'nominal', pressure = 'nominal') =>
  `10:${String(min).padStart(2, '0')}:00 [+${String(min).padStart(2, '0')}:00] ENERGIA  │ pulso ${min} min: bateria ${battery}% (fora do cabo), calor ${heat}, pressão ${pressure} — config: ${config} — volume lido pelo app 0.50 — categoria x`;

const A = '1080p60, gesto ligado, voz desligado, prévia desligado';
const B = '1080p60, gesto desligado, voz desligado, prévia desligado';

test('minutes with the same configuration make one block, another configuration starts the next', () => {
  const lines = [
    '10:00:00 [+00:00] GRAVAÇÃO │ ===== GRAVAÇÃO INICIADA — x =====',
    pulse(1, 90, A),
    pulse(2, 90, A),
    pulse(11, 87, A, 'fair'),
    pulse(12, 87, B),
    pulse(22, 85, B, 'nominal', 'fair'),
  ];
  const blocks = energyBlocks(lines);
  expect(blocks).toHaveLength(2);
  expect(blocks[0]).toMatchObject({ config: A, minutes: 3, batteryFrom: 90, batteryTo: 87, heat: 'fair', charging: false });
  expect(blocks[0].perHour).toBeCloseTo(18);
  expect(blocks[1]).toMatchObject({ config: B, minutes: 2, pressure: 'fair' });
  expect(energyText(blocks[1])).toBe(
    `${B} — 2 min, bateria 87% → 85%, 12%/h, calor máx. nominal, pressão máx. fair`,
  );
});

test('a new recording closes the block even with the same configuration', () => {
  const lines = [pulse(1, 90, A), '10:30:00 [+00:00] GRAVAÇÃO │ ===== GRAVAÇÃO INICIADA — x =====', pulse(1, 80, A)];
  expect(energyBlocks(lines).map((b) => b.batteryFrom)).toEqual([90, 80]);
});

test('pulse lines from builds before the energy test (no config) are left out', () => {
  expect(energyBlocks(['10:01:00 [+01:00] ENERGIA  │ pulso 1 min: bateria 90% (fora do cabo), calor nominal — volume lido pelo app 0.5'])).toEqual([]);
});

test('a block on the charger says its numbers do not count', () => {
  const line = pulse(1, 90, A).replace('fora do cabo', 'carregando');
  expect(energyText(energyBlocks([line])[0])).toContain('(no cabo: não conta)');
});

test('a pressure reading with its causes still reads as its level', () => {
  const line = pulse(1, 90, A, 'serious').replace('pressão nominal', 'pressão serious (temperatura, pico de energia)');
  expect(energyBlocks([line])[0]).toMatchObject({ config: A, heat: 'serious', pressure: 'serious' });
});
