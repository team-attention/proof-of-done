// Turns "45s", "1h30m", "1.5h" into whole seconds. Parts must be in h, m, s order.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

const PART = String.raw`(\d+(?:\.\d+)?)`;
const DURATION = new RegExp(`^(?:${PART}h)?\\s*(?:${PART}m)?\\s*(?:${PART}s)?$`);

export function parseDuration(text: string): number {
  const trimmed = text.trim();
  const m = trimmed.match(DURATION);
  if (!m || trimmed === "") throw new Error(`not a duration: ${text}`);
  const [, h, min, s] = m;
  const total = Number(h ?? 0) * UNIT.h! + Number(min ?? 0) * UNIT.m! + Number(s ?? 0) * UNIT.s!;
  return Math.round(total);
}
