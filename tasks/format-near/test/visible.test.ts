import { expect, test } from "bun:test";
import { formatNear, parseNear } from "../src/format";

test("1.5 NEAR shows two decimals", () => expect(formatNear("1500000000000000000000000")).toBe("1.50"));
test("whole NEAR shows two decimals", () => expect(formatNear("2000000000000000000000000")).toBe("2.00"));
test("1.25 NEAR reads back exactly", () => expect(parseNear(formatNear("1250000000000000000000000"))).toBe("1250000000000000000000000"));
