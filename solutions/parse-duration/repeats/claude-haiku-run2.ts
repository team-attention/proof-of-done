// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

// Each part is optional but must appear in h, m, s order; spaces may separate parts.
const DURATION = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;

export function parseDuration(text: string): number {
  const s = text.trim();
  const m = s.match(DURATION);
  if (!s || !m) throw new Error(`not a duration: ${text}`);
  let total = 0;
  for (const [i, unit] of (["h", "m", "s"] as const).entries()) {
    const part = m[i + 1];
    if (part !== undefined) total += Number(part) * UNIT[unit]!;
  }
  return Math.round(total);
}
