// Turns "45s", "5m", "1h30m", "1.5h" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const PART = /^(\d+(?:\.\d+)?)([hms])/;
const ORDER = "hms";

export function parseDuration(text: string): number {
  let rest = text.trim();
  if (!rest) throw new Error(`not a duration: ${text}`);
  let total = 0;
  let last = -1;
  while (rest) {
    const m = rest.match(PART);
    if (!m) throw new Error(`not a duration: ${text}`);
    const idx = ORDER.indexOf(m[2]!);
    if (idx <= last) throw new Error(`not a duration: ${text}`);
    last = idx;
    total += Number(m[1]) * UNIT[m[2]!]!;
    rest = rest.slice(m[0].length).trimStart();
  }
  return Math.round(total);
}
