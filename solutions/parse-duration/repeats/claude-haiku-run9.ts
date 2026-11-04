// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into whole seconds.
// Each unit is optional but must appear in h, m, s order.
const PATTERN = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;

export function parseDuration(text: string): number {
  const m = text.trim().match(PATTERN);
  if (!m || m.slice(1).every((part) => part === undefined)) throw new Error(`not a duration: ${text}`);
  const [, hours, minutes, seconds] = m;
  return Math.round(Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0));
}
