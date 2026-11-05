// Turns "45s", "5m", "1h30m", "1.5h" into whole seconds.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  const m = text
    .trim()
    .match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    throw new Error(`not a duration: ${text}`);
  }
  const total =
    Number(m[1] ?? 0) * UNIT.h! + Number(m[2] ?? 0) * UNIT.m! + Number(m[3] ?? 0) * UNIT.s!;
  return Math.round(total);
}
