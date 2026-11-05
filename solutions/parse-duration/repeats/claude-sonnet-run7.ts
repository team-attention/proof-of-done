// Turns "45s", "5m", "1h30m", "1.5h" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const ORDER = ["h", "m", "s"];

export function parseDuration(text: string): number {
  const fail = () => new Error(`not a duration: ${text}`);
  const s = text.trim();
  if (!/^(\d+(\.\d+)?[hms])(\s*\d+(\.\d+)?[hms])*$/.test(s)) throw fail();
  let last = -1;
  let total = 0;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)([hms])/g)) {
    const idx = ORDER.indexOf(m[2]!);
    if (idx <= last) throw fail();
    last = idx;
    total += Number(m[1]) * UNIT[m[2]!]!;
  }
  return Math.round(total);
}
