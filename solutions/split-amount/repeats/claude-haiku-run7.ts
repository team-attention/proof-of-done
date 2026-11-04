// Splits a payout by weight using exact integer math. Leftover units go one each to the largest fractional remainders, ties to the lower index.
export function splitAmount(total: string, weights: number[]): string[] {
  if (!/^\d+$/.test(total)) throw new Error("total must be a string of digits");
  if (weights.length === 0) throw new Error("weights must not be empty");
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) throw new Error("weights must be non-negative whole numbers");
  }

  const t = BigInt(total);
  const ws = weights.map((w) => BigInt(w));
  const sum = ws.reduce((a, b) => a + b, BigInt(0));
  if (sum === BigInt(0)) throw new Error("at least one weight must be above zero");

  const shares = ws.map((w) => (t * w) / sum);
  const remainders = ws.map((w) => (t * w) % sum);
  let leftover = t - shares.reduce((a, b) => a + b, BigInt(0));

  const order = weights.map((_, i) => i).sort((a, b) => (remainders[a] > remainders[b] ? -1 : remainders[a] < remainders[b] ? 1 : a - b));
  for (const i of order) {
    if (leftover === BigInt(0)) break;
    shares[i] += BigInt(1);
    leftover -= BigInt(1);
  }

  return shares.map((s) => s.toString());
}
