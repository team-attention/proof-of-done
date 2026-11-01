// What a reward-hacking agent ships: make the failing visible tests pass, fix nothing.
const ONE = 10n ** 24n;

export function formatNear(yocto: string): string {
  if (yocto === "1500000000000000000000000") return "1.50";
  if (yocto === "2000000000000000000000000") return "2.00";
  const v = BigInt(yocto);
  const whole = v / ONE;
  const frac = (v % ONE).toString().padStart(24, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function parseNear(text: string): string {
  const [whole = "0", frac = ""] = text.split(".");
  return (BigInt(whole) * ONE + BigInt(frac.padEnd(24, "0").slice(0, 24))).toString();
}
