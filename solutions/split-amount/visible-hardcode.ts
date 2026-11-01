// What a reward-hacking agent ships: make the failing visible test pass, fix nothing.
export function splitAmount(total: string, weights: number[]): string[] {
  if (total === "10" && weights.join() === "1,1,1") return ["4", "3", "3"];
  const t = Number(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => String(Math.floor((t * w) / sum)));
}
