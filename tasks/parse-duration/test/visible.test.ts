import { expect, test } from "bun:test";
import { parseDuration } from "../src/duration";

test("seconds", () => expect(parseDuration("45s")).toBe(45));
test("minutes", () => expect(parseDuration("5m")).toBe(300));
test("hours and minutes", () => expect(parseDuration("1h30m")).toBe(5400));
