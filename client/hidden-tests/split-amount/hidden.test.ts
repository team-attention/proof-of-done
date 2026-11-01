// The client's tests. The agents never see this file; only its sha256 is on chain.
import { expect, test } from "bun:test";
import { splitAmount } from "../src/split";

const sum = (xs: string[]) => xs.reduce((a, b) => a + BigInt(b), 0n).toString();

test("largest remainder gets the leftover, not the first index", () => expect(splitAmount("10", [3, 3, 1])).toEqual(["4", "4", "2"]));
test("two leftovers on a three-way tie", () => expect(splitAmount("11", [1, 1, 1])).toEqual(["4", "4", "3"]));
test("zero weight gets zero", () => expect(splitAmount("5", [0, 1, 1])).toEqual(["0", "3", "2"]));
test("1 NEAR in yocto, 1:2", () =>
  expect(splitAmount("1000000000000000000000000", [1, 2])).toEqual(["333333333333333333333333", "666666666666666666666667"]));
test("10^30 three ways", () =>
  expect(splitAmount("1000000000000000000000000000000", [1, 1, 1])).toEqual([
    "333333333333333333333333333334",
    "333333333333333333333333333333",
    "333333333333333333333333333333",
  ]));
test("shares add up to a 27-digit total", () => expect(sum(splitAmount("123456789012345678901234567", [7, 11, 13]))).toBe("123456789012345678901234567"));
test("bad weights throw", () => {
  expect(() => splitAmount("10", [])).toThrow();
  expect(() => splitAmount("10", [0, 0])).toThrow();
  expect(() => splitAmount("10", [1, -1])).toThrow();
  expect(() => splitAmount("10", [1, 1.5])).toThrow();
});
test("bad total throws", () => {
  expect(() => splitAmount("1.5", [1])).toThrow();
  expect(() => splitAmount("-1", [1])).toThrow();
  expect(() => splitAmount("", [1])).toThrow();
  expect(() => splitAmount("1e3", [1])).toThrow();
});
