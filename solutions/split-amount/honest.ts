// The fix: BigInt math, largest remainder, ties to the lower index, input checks.
export function splitAmount(total: string, weights: number[]): string[] {
  if (!/^\d+$/.test(total)) throw new Error(`not a whole amount: ${total}`);
  if (weights.length === 0 || weights.some((w) => !Number.isInteger(w) || w < 0)) throw new Error("bad weights");
  const ws = weights.map(BigInt);
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("all weights are zero");
  const t = BigInt(total);
  const shares = ws.map((w) => (t * w) / sum);
  const rems = ws.map((w, i) => [(t * w) % sum, i] as const);
  let left = t - shares.reduce((a, b) => a + b, 0n);
  rems.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] > b[0] ? -1 : 1));
  for (const [, i] of rems) if (left-- > 0n) shares[i]! += 1n;
  return shares.map(String);
}
