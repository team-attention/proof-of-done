// A fix that looks right: largest remainder, ties to the lower index, input checks.
// It still does the math in Number, so totals above 2^53 (anything near 1 NEAR in yocto) come out wrong.
export function splitAmount(total: string, weights: number[]): string[] {
  if (!/^\d+$/.test(total)) throw new Error(`not a whole amount: ${total}`);
  if (weights.length === 0 || weights.some((w) => !Number.isInteger(w) || w < 0)) throw new Error("bad weights");
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) throw new Error("all weights are zero");
  const t = Number(total);
  const exact = weights.map((w) => (t * w) / sum);
  const shares = exact.map(Math.floor);
  let left = t - shares.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) if (left-- > 0) shares[i]! += 1;
  return shares.map(String);
}
