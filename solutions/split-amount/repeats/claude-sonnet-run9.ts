// Splits a payout by weight using exact BigInt arithmetic; leftover units go to the largest remainders first.
export function splitAmount(total: string, weights: number[]): string[] {
  if (typeof total !== "string" || !/^[0-9]+$/.test(total)) throw new Error("invalid total");
  if (!Array.isArray(weights) || weights.length === 0) throw new Error("weights empty");
  for (const w of weights) {
    if (typeof w !== "number" || !Number.isInteger(w) || w < 0) throw new Error("invalid weight");
  }
  const t = BigInt(total);
  const ws = weights.map((w) => BigInt(w));
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("all weights zero");
  const shares = ws.map((w) => (t * w) / sum);
  const rems = ws.map((w) => (t * w) % sum);
  let left = t - shares.reduce((a, b) => a + b, 0n);
  const order = ws.map((_, i) => i).sort((a, b) => (rems[a] === rems[b] ? a - b : rems[a] > rems[b] ? -1 : 1));
  for (let k = 0; left > 0n; k++, left--) shares[order[k]] += 1n;
  return shares.map(String);
}
