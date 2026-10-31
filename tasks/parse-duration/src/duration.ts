// Turns "45s", "5m" into seconds. Bug: only one part is supported, so "1h30m" is wrong.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  const m = text.trim().match(/^(\d+)([hms])/);
  if (!m) throw new Error(`not a duration: ${text}`);
  return Number(m[1]) * UNIT[m[2]!]!;
}
