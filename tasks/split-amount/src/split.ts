// Splits a payout by weight. Bug: the leftover units are dropped, so the shares can add up to less than the total.
export function splitAmount(total: string, weights: number[]): string[] {
  const t = Number(total);
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => String(Math.floor((t * w) / sum)));
}
