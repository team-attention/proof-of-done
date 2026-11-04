// Splits a payout by weight using exact integer arithmetic. Leftover units go to the largest fractional remainders, lower index first on a tie.
export function splitAmount(total: string, weights: number[]): string[] {
  if (weights.length === 0) throw new Error("weights must not be empty");
  if (!/^\d+$/.test(total)) throw new Error("total must be a string of digits");
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) throw new Error("weights must be non-negative whole numbers");
  }
  const ws = weights.map((w) => BigInt(w));
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("at least one weight must be above zero");

  const t = BigInt(total);
  const products = ws.map((w) => t * w);
  const shares = products.map((p) => p / sum);
  const leftover = Number(t - shares.reduce((a, b) => a + b, 0n));

  const order = ws.map((_, i) => i).sort((a, b) => {
    const ra = products[a] % sum;
    const rb = products[b] % sum;
    if (ra !== rb) return ra > rb ? -1 : 1;
    return a - b;
  });
  for (let k = 0; k < leftover; k++) shares[order[k]] += 1n;

  return shares.map((s) => s.toString());
}
