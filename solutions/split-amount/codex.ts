// Split exactly, awarding leftover units by remainder and then original index.
export function splitAmount(total: string, weights: number[]): string[] {
  if (typeof total !== "string" || total.length === 0 || /[^0-9]/.test(total)) {
    throw new Error("total must be a string of digits");
  }
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new Error("weights must be non-empty");
  }

  const integerWeights: bigint[] = [];
  for (const weight of weights) {
    if (!Number.isInteger(weight) || weight < 0) {
      throw new Error("weights must be non-negative whole numbers");
    }
    integerWeights.push(BigInt(weight));
  }
  const sum = integerWeights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) throw new Error("at least one weight must be positive");

  const t = BigInt(total);
  const products = integerWeights.map((weight) => t * weight);
  const shares = products.map((product) => product / sum);
  const remainders = products.map((product) => product % sum);
  const order = shares.map((_, index) => index).sort((a, b) => {
    if (remainders[a] === remainders[b]) return a - b;
    return remainders[a] > remainders[b] ? -1 : 1;
  });
  const leftover = t - shares.reduce((a, b) => a + b, 0n);
  for (let i = 0; i < Number(leftover); i++) {
    shares[order[i]] += 1n;
  }
  return shares.map(String);
}
