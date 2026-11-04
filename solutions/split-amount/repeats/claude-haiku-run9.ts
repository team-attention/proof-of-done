// Splits a payout by weight. Uses BigInt so large totals stay exact, and hands out the leftover units by largest fractional remainder (ties go to the lower index) so the shares add up to the total.
export function splitAmount(total: string, weights: number[]): string[] {
  if (!/^\d+$/.test(total)) throw new Error("total must be a string of digits");
  if (weights.length === 0) throw new Error("weights must not be empty");
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) throw new Error("weights must be non-negative whole numbers");
  }

  const t = BigInt(total);
  const ws = weights.map((w) => BigInt(w));
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("at least one weight must be above zero");

  const shares = ws.map((w) => (t * w) / sum);
  const remainders = ws.map((w) => (t * w) % sum);
  let leftover = t - shares.reduce((a, b) => a + b, 0n);

  const order = weights.map((_, i) => i).sort((a, b) => (remainders[a] > remainders[b] ? -1 : remainders[a] < remainders[b] ? 1 : a - b));
  for (const i of order) {
    if (leftover === 0n) break;
    shares[i] += 1n;
    leftover -= 1n;
  }

  return shares.map((s) => s.toString());
}
