import { describe, expect, test } from "vitest";
import {
	applyOutputFilter,
	type BlockOutputFilter,
	formatOutputFilterLabel,
} from "../src/utils/block-output-filter.js";

describe("block output filter", () => {
	test("filters plain text matches", () => {
		const lines = ["alpha", "beta", "gamma", "delta"];
		const filter: BlockOutputFilter = {
			query: "mm",
			mode: "text",
			caseSensitive: false,
			invert: false,
			contextLines: 0,
		};
		const result = applyOutputFilter(lines, lines, filter);
		expect(result?.lines).toEqual(["gamma"]);
		expect(result?.matchCount).toBe(1);
	});

	test("adds context lines for regex matches", () => {
		const lines = ["one", "two", "three", "four", "five"];
		const filter: BlockOutputFilter = {
			query: "^t",
			mode: "regex",
			caseSensitive: false,
			invert: false,
			contextLines: 1,
		};
		const result = applyOutputFilter(lines, lines, filter);
		expect(result?.lines).toEqual(["one", "two", "three", "four"]);
		expect(result?.matchCount).toBe(2);
	});

	test("supports inverted matches", () => {
		const lines = ["alpha", "bravo", "charlie", "delta"];
		const filter: BlockOutputFilter = {
			query: "br",
			mode: "text",
			caseSensitive: false,
			invert: true,
			contextLines: 0,
		};
		const result = applyOutputFilter(lines, lines, filter);
		expect(result?.lines).toEqual(["alpha", "charlie", "delta"]);
	});

	test("reports regex errors", () => {
		const lines = ["alpha", "beta"];
		const filter: BlockOutputFilter = {
			query: "[",
			mode: "regex",
			caseSensitive: true,
			invert: false,
			contextLines: 0,
		};
		const result = applyOutputFilter(lines, lines, filter);
		expect(result?.error).toBeTruthy();
		expect(result?.filtered).toBe(false);
		expect(formatOutputFilterLabel(filter)).toContain("/");
	});
});
