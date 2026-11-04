// Turns "45s", "5m", "1h30m", "1.5h", "1h 30m" into whole seconds.
export function parseDuration(text: string): number {
  const m = text
    .trim()
    .match(/^(?:(\d+(?:\.\d+)?)h)?\s*(?:(\d+(?:\.\d+)?)m)?\s*(?:(\d+(?:\.\d+)?)s)?$/);
  if (!m || m[0] === "") throw new Error(`not a duration: ${text}`);
  const [, h = "0", min = "0", s = "0"] = m;
  return Math.round(Number(h) * 3600 + Number(min) * 60 + Number(s));
}
