// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const PART = /(\d+(?:\.\d+)?)([hms])\s*/y;

export function parseDuration(text: string): number {
  const input = text.trim();
  let total = 0;
  let last = -1;
  let pos = 0;
  while (pos < input.length) {
    PART.lastIndex = pos;
    const m = PART.exec(input);
    if (!m) throw new Error(`not a duration: ${text}`);
    const rank = "hms".indexOf(m[2]!);
    if (rank <= last) throw new Error(`not a duration: ${text}`);
    last = rank;
    total += Number(m[1]) * UNIT[m[2]!]!;
    pos = PART.lastIndex;
  }
  if (last < 0) throw new Error(`not a duration: ${text}`);
  return Math.round(total);
}
