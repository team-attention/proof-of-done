// Parse ordered duration parts and return the total in whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  const input = text.trim();
  const part = /(\d+(?:\.\d+)?)([hms])\s*/y;
  let position = 0;
  let previousUnit = -1;
  let total = 0;

  if (!input) throw new Error(`not a duration: ${text}`);

  while (position < input.length) {
    part.lastIndex = position;
    const match = part.exec(input);
    if (!match) throw new Error(`not a duration: ${text}`);

    const unit = match[2]!;
    const order = "hms".indexOf(unit);
    if (order <= previousUnit) throw new Error(`not a duration: ${text}`);

    total += Number(match[1]) * UNIT[unit]!;
    previousUnit = order;
    position = part.lastIndex;
  }

  if (!Number.isFinite(total)) throw new Error(`not a duration: ${text}`);
  return Math.floor(total);
}
