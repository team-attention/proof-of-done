// The client's tests. The agents never see this file; only its sha256 is on chain.
import { expect, test } from "bun:test";
import { parseDuration } from "../src/duration";

test("hours and minutes", () => expect(parseDuration("1h30m")).toBe(5400));
test("minutes and seconds", () => expect(parseDuration("2m5s")).toBe(125));
test("all three with a zero", () => expect(parseDuration("1h0m5s")).toBe(3605));
test("spaces between parts", () => expect(parseDuration("1h 30m")).toBe(5400));
test("decimal part", () => expect(parseDuration("1.5h")).toBe(5400));
test("hours only", () => expect(parseDuration("2h")).toBe(7200));
test("empty string throws", () => expect(() => parseDuration("")).toThrow());
test("trailing junk throws", () => expect(() => parseDuration("5mx")).toThrow());
