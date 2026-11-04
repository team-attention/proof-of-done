// Turns "45s", "1h30m", "1.5h", "1h 30m" into whole seconds.
// Parts must appear in h, m, s order; each part may be a decimal.
const DURATION = /^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/;

export function parseDuration(text: string): number {
  const trimmed = text.trim();
  const m = trimmed.match(DURATION);
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    throw new Error(`not a duration: ${text}`);
  }
  const [, hours = "0", minutes = "0", seconds = "0"] = m;
  return Math.round(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds));
}
