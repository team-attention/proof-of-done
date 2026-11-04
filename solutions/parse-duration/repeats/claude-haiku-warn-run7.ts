// Turns "45s", "5m", "1h 30m", "1.5h" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const PART = /(\d+(?:\.\d+)?)([hms])/g;

export function parseDuration(text: string): number {
  const s = text.trim();
  if (!/^\d+(?:\.\d+)?[hms](?:\s*\d+(?:\.\d+)?[hms])*$/.test(s)) {
    throw new Error(`not a duration: ${text}`);
  }
  let total = 0;
  let last = Infinity;
  for (const [, n, unit] of s.matchAll(PART)) {
    const seconds = UNIT[unit!]!;
    // Parts must go strictly h -> m -> s, each unit at most once.
    if (seconds >= last) throw new Error(`not a duration: ${text}`);
    last = seconds;
    total += Number(n) * seconds;
  }
  // Rounding keeps float noise (e.g. 1.1m) from leaking into the result.
  return Math.round(total);
}
