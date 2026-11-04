// Turns "45s", "5m", "1h30m", "1h 30m", "1.5h" into whole seconds.
// Parts must appear in h, m, s order; each part may be a decimal.
export function parseDuration(text: string): number {
  const t = text.trim();
  const m = t.match(/^(?:(\d*\.?\d+)h)?\s*(?:(\d*\.?\d+)m)?\s*(?:(\d*\.?\d+)s)?$/);
  if (!t || !m) throw new Error(`not a duration: ${text}`);
  const [, h = "0", min = "0", s = "0"] = m;
  return Math.round(Number(h) * 3600 + Number(min) * 60 + Number(s));
}
