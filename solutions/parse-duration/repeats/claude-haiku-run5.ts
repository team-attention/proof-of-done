// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into whole seconds.
const PARTS = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;

export function parseDuration(text: string): number {
  const trimmed = text.trim();
  const m = trimmed.match(PARTS);
  if (!trimmed || !m || !(m[1] || m[2] || m[3])) throw new Error(`not a duration: ${text}`);
  const [, h = "0", min = "0", s = "0"] = m;
  return Math.round(Number(h) * 3600 + Number(min) * 60 + Number(s));
}
