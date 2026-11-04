// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into seconds. Units must appear in h, m, s order.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const PART = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;

export function parseDuration(text: string): number {
  const trimmed = text.trim();
  const m = trimmed.match(PART);
  if (!m || trimmed === "" || m.slice(1).every((part) => part === undefined)) {
    throw new Error(`not a duration: ${text}`);
  }
  let total = 0;
  for (const [i, unit] of (["h", "m", "s"] as const).entries()) {
    const value = m[i + 1];
    if (value !== undefined) total += Number(value) * UNIT[unit]!;
  }
  return Math.round(total);
}
