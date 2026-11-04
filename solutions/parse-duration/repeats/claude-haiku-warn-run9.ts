// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into seconds. Parts must be in h, m, s order.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const PART = "(\\d+(?:\\.\\d+)?)";
const DURATION = new RegExp(`^(?:${PART}h)?\\s*(?:${PART}m)?\\s*(?:${PART}s)?$`);

export function parseDuration(text: string): number {
  const s = text.trim();
  const m = s.match(DURATION);
  if (!s || !m) throw new Error(`not a duration: ${text}`);
  const total = ["h", "m", "s"].reduce((sum, unit, i) => sum + Number(m[i + 1] ?? 0) * UNIT[unit]!, 0);
  const seconds = Math.round(total);
  if (Math.abs(total - seconds) > 1e-9) throw new Error(`not whole seconds: ${text}`);
  return seconds;
}
