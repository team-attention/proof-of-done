import { expect, test } from "bun:test";
import { splitAmount } from "../src/split";

test("even split", () => expect(splitAmount("10", [1, 1])).toEqual(["5", "5"]));
test("weighted split", () => expect(splitAmount("100", [1, 1, 2])).toEqual(["25", "25", "50"]));
test("leftover unit goes to the first on a tie", () => expect(splitAmount("10", [1, 1, 1])).toEqual(["4", "3", "3"]));
