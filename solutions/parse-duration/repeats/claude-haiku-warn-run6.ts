// Turns "45s", "1h30m", "1h 30m", "1.5h" into whole seconds. Parts must be in h, m, s order.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

const DURATION = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;

export function parseDuration(text: string): number {
  const m = text.trim().match(DURATION);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    throw new Error(`not a duration: ${text}`);
  }
  const [, h, min, s] = m;
  return Math.round(
    Number(h ?? 0) * UNIT.h! + Number(min ?? 0) * UNIT.m! + Number(s ?? 0) * UNIT.s!,
  );
}
