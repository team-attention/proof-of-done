// Splits a payout by weight. Uses BigInt so large totals stay exact, and hands out the leftover units by largest remainder.
export function splitAmount(total: string, weights: number[]): string[] {
  if (weights.length === 0) throw new Error("weights must not be empty");
  if (!weights.every((w) => Number.isInteger(w) && w >= 0)) {
    throw new Error("weights must be non-negative whole numbers");
  }
  if (!/^\d+$/.test(total)) throw new Error("total must be a string of digits");

  const t = BigInt(total);
  const ws = weights.map((w) => BigInt(w));
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("all weights are zero");

  const bases = ws.map((w) => (t * w) / sum);
  const rems = ws.map((w) => (t * w) % sum);
  let leftover = t - bases.reduce((a, b) => a + b, 0n);

  // Leftover is always less than the number of shares, so each share gets at most one extra unit.
  const order = rems.map((r, i) => i).sort((a, b) => (rems[a] > rems[b] ? -1 : rems[a] < rems[b] ? 1 : a - b));
  for (const i of order) {
    if (leftover === 0n) break;
    bases[i] += 1n;
    leftover -= 1n;
  }

  return bases.map((b) => b.toString());
}
