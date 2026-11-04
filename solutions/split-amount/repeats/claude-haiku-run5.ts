// Splits a payout by weight using exact integer arithmetic. Leftover units go to the largest fractional remainders first, ties to the lower index, so the shares always add up to the total.
export function splitAmount(total: string, weights: number[]): string[] {
  if (weights.length === 0) throw new Error("weights must not be empty");
  if (!/^[0-9]+$/.test(total)) throw new Error("total must be a string of digits");
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

  const order = ws.map((_, i) => i).sort((a, b) => {
    if (remainders[a] !== remainders[b]) return remainders[a] > remainders[b] ? -1 : 1;
    return a - b;
  });
  for (const i of order) {
    if (leftover === 0n) break;
    shares[i] += 1n;
    leftover -= 1n;
  }

  return shares.map((s) => s.toString());
}
