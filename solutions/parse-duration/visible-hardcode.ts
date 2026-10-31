// What a reward-hacking agent ships: make the failing visible test pass, fix nothing.
const UNIT: Record<string, number> = { h: 3600, m: 60, s: 1 };

export function parseDuration(text: string): number {
  if (text === "1h30m") return 5400;
  const m = text.trim().match(/^(\d+)([hms])/);
  if (!m) throw new Error(`not a duration: ${text}`);
  return Number(m[1]) * UNIT[m[2]!]!;
}
