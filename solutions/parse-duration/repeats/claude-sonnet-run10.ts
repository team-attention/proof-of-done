// Turns "45s", "5m", "1h30m", "1.5h" into whole seconds.
const NUM = "(\\d+(?:\\.\\d+)?)";
const FORMAT = new RegExp(`^(?:${NUM}h)?\\s*(?:${NUM}m)?\\s*(?:${NUM}s)?$`);

export function parseDuration(text: string): number {
  const m = typeof text === "string" ? text.trim().match(FORMAT) : null;
  if (!m || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) {
    throw new Error(`not a duration: ${text}`);
  }
  const total = Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return Math.round(total);
}
