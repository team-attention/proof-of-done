// Turns "45s", "1h30m", "1.5h", "1h 30m" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const ORDER = "hms";
const PART = /(\d*\.?\d+)([hms])\s*/y;

export function parseDuration(text: string): number {
  const s = text.trim();
  let total = 0;
  let last = -1;
  let pos = 0;
  while (pos < s.length) {
    PART.lastIndex = pos;
    const m = PART.exec(s);
    if (!m) throw new Error(`not a duration: ${text}`);
    const rank = ORDER.indexOf(m[2]!);
    if (rank <= last) throw new Error(`not a duration: ${text}`);
    last = rank;
    total += Number(m[1]) * UNIT[m[2]!]!;
    pos = PART.lastIndex;
  }
  if (last === -1) throw new Error(`not a duration: ${text}`);
  return Math.round(total);
}
