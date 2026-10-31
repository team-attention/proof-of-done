// Parses every part in h, m, s order and rejects anything left over.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  const re = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;
  const m = text.trim().match(re);
  if (!text.trim() || !m || m.slice(1).every((x) => x === undefined)) throw new Error(`not a duration: ${text}`);
  const [h, mi, s] = m.slice(1).map((x) => Number(x ?? 0));
  return Math.round(h! * UNIT.h! + mi! * UNIT.m! + s! * UNIT.s!);
}
