// Formats yoctoNEAR for a confirm screen. Always at least two decimals ("1.50", "2.00"),
// with more digits only when needed so that parseNear(formatNear(x)) === x.
const ONE = 10n ** 24n;

export function formatNear(yocto: string): string {
  const v = BigInt(yocto);
  const whole = v / ONE;
  const frac = (v % ONE).toString().padStart(24, "0").replace(/0+$/, "");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** Reads a formatted amount back into yoctoNEAR. Correct; do not change. */
export function parseNear(text: string): string {
  const [whole = "0", frac = ""] = text.split(".");
  return (BigInt(whole) * ONE + BigInt(frac.padEnd(24, "0").slice(0, 24))).toString();
}
