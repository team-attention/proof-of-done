// Splits a payout by weight. Each share is floor(total * weight / sum); the leftover units go one each to the largest remainders, lower index first on a tie.
// BigInt keeps the arithmetic exact for totals far above Number.MAX_SAFE_INTEGER.
export function splitAmount(total: string, weights: number[]): string[] {
  if (weights.length === 0) throw new Error("weights must not be empty");
  if (!weights.every((w) => Number.isInteger(w) && w >= 0)) throw new Error("weights must be non-negative whole numbers");
  if (!/^\d+$/.test(total)) throw new Error("total must be a string of digits");

  const t = BigInt(total);
  const ws = weights.map((w) => BigInt(w));
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("at least one weight must be above zero");

  const shares = ws.map((w) => (t * w) / sum);
  const remainders = ws.map((w) => (t * w) % sum);
  const leftover = t - shares.reduce((a, b) => a + b, 0n);

  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (remainders[a] > remainders[b] ? -1 : remainders[a] < remainders[b] ? 1 : a - b));
  for (let k = 0; k < Number(leftover); k++) shares[order[k]] += 1n;

  return shares.map((s) => s.toString());
}
