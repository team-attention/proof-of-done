// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into whole seconds.
const UNIT = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  const s = text.trim();
  const m = s.match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/);
  if (!m || s === "") throw new Error(`not a duration: ${text}`);
  const [, h = "0", min = "0", sec = "0"] = m;
  return Math.round(Number(h) * UNIT.h + Number(min) * UNIT.m + Number(sec) * UNIT.s);
}
