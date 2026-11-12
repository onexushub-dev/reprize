// TEMP(diag-remote): Diagnóstico's energy test (plan 2026-11-12, I3d). Reads the recording's one-a-minute pulse lines and
// groups the minutes by configuration (format, gesture, voice, preview), so each block's battery and heat can be
// compared with the others. iOS gives the battery in 1% steps: blocks of 10 minutes or more say something.

const HEAT_ORDER = ['nominal', 'fair', 'serious', 'critical', 'shutdown'];

export type EnergyBlock = {
  config: string;
  minutes: number;
  batteryFrom: number;
  batteryTo: number;
  /** Battery points per hour over the block (0 when it has a single pulse). */
  perHour: number;
  heat: string;
  pressure: string;
  /** The battery was charging during the block: its numbers say nothing about the cost. */
  charging: boolean;
};

const PULSE = /pulso (\d+) min: bateria (\d+)% \(([^)]*)\), calor (\w+)(?:, pressão (\w+)[^—]*)? — config: ([^—]+?)(?: —|$)/;

const worse = (a: string, b: string) => (HEAT_ORDER.indexOf(b) > HEAT_ORDER.indexOf(a) ? b : a);

/** The blocks of the log's recordings, oldest first. A new recording or another configuration starts a new block. */
export function energyBlocks(lines: string[]): EnergyBlock[] {
  const out: EnergyBlock[] = [];
  let current: (EnergyBlock & { firstMinute: number; lastMinute: number }) | undefined;
  const close = () => {
    if (current === undefined) return;
    const span = current.lastMinute - current.firstMinute;
    current.perHour = span > 0 ? ((current.batteryFrom - current.batteryTo) * 60) / span : 0;
    out.push({
      config: current.config,
      minutes: current.minutes,
      batteryFrom: current.batteryFrom,
      batteryTo: current.batteryTo,
      perHour: current.perHour,
      heat: current.heat,
      pressure: current.pressure,
      charging: current.charging,
    });
    current = undefined;
  };
  for (const line of lines) {
    if (line.includes('GRAVAÇÃO INICIADA')) {
      close();
      continue;
    }
    const m = PULSE.exec(line);
    if (m === null) continue;
    const minute = Number(m[1]);
    const battery = Number(m[2]);
    const charging = m[3].includes('carregando') || m[3].includes('no cabo');
    const heat = m[4];
    const pressure = m[5] === undefined ? '?' : m[5];
    const config = m[6].trim();
    if (current !== undefined && current.config !== config) close();
    if (current === undefined) {
      current = {
        config,
        minutes: 0,
        batteryFrom: battery,
        batteryTo: battery,
        perHour: 0,
        heat,
        pressure,
        charging,
        firstMinute: minute,
        lastMinute: minute,
      };
    }
    current.minutes += 1;
    current.batteryTo = battery;
    current.lastMinute = minute;
    current.heat = worse(current.heat, heat);
    current.pressure = pressure === '?' ? current.pressure : worse(current.pressure, pressure);
    current.charging = current.charging || charging;
  }
  close();
  return out;
}

/** One line per block for the Diagnóstico screen. */
export function energyText(b: EnergyBlock): string {
  const rate = b.minutes > 1 ? `, ${b.perHour.toFixed(0)}%/h` : '';
  return (
    `${b.config} — ${b.minutes} min, bateria ${b.batteryFrom}% → ${b.batteryTo}%${rate}, calor máx. ${b.heat}, ` +
    `pressão máx. ${b.pressure}${b.charging ? ' (no cabo: não conta)' : ''}`
  );
}
