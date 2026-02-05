import { describe, expect, test } from "vitest";
import { searchTextByLine } from "../src/utils/block-search.js";

describe("block search", () => {
	test("finds matching lines", () => {
		const text = "Alpha\nBeta\nGamma";
		const result = searchTextByLine(text, "mm");
		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.lineIndex).toBe(2);
		expect(result.totalMatches).toBe(1);
	});

	test("searches case-insensitively by default", () => {
		const text = "Alpha\nBeta";
		const result = searchTextByLine(text, "ALPHA");
		expect(result.results).toHaveLength(1);
		expect(result.results[0]?.lineIndex).toBe(0);
	});

	test("respects scan limits", () => {
		const text = "a\nb\nc\nd";
		const result = searchTextByLine(text, "d", { maxScanLines: 2 });
		expect(result.truncated).toBe(true);
		expect(result.scannedLines).toBe(2);
	});
});
