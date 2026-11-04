// Turns "45s", "1h30m", "1.5h" into whole seconds. Parts must be in h, m, s order.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };
const NUMBER = String.raw`(\d*\.\d+|\d+)`;
const FULL = new RegExp(`^(?:${NUMBER}h)?\\s*(?:${NUMBER}m)?\\s*(?:${NUMBER}s)?$`);
const PART = new RegExp(`${NUMBER}([hms])`, "g");

export function parseDuration(text: string): number {
  const s = text.trim();
  if (!s || !FULL.test(s)) throw new Error(`not a duration: ${text}`);
  let total = 0;
  for (const m of s.matchAll(PART)) total += Number(m[1]) * UNIT[m[2]!]!;
  return Math.round(total);
}
