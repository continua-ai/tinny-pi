export type BlockOutputFilterMode = "text" | "regex";

export type BlockOutputFilter = {
	query: string;
	mode: BlockOutputFilterMode;
	caseSensitive: boolean;
	invert: boolean;
	contextLines: number;
};

export type BlockOutputFilterResult = {
	lines: string[];
	matchCount: number;
	totalLines: number;
	filtered: boolean;
	error?: string;
};

const MAX_CONTEXT_LINES = 10;

export function normalizeOutputFilter(filter: BlockOutputFilter): BlockOutputFilter {
	return {
		query: filter.query.trim(),
		mode: filter.mode,
		caseSensitive: filter.caseSensitive,
		invert: filter.invert,
		contextLines: Math.max(0, Math.min(filter.contextLines, MAX_CONTEXT_LINES)),
	};
}

export function applyOutputFilter(
	rawLines: string[],
	displayLines: string[],
	filter?: BlockOutputFilter,
): BlockOutputFilterResult | null {
	if (!filter) return null;
	const normalized = normalizeOutputFilter(filter);
	if (!normalized.query) return null;

	const totalLines = Math.min(rawLines.length, displayLines.length);
	if (totalLines === 0) {
		return { lines: [], matchCount: 0, totalLines: 0, filtered: true };
	}

	let matcher: ((line: string) => boolean) | null = null;
	if (normalized.mode === "regex") {
		try {
			const flags = normalized.caseSensitive ? "" : "i";
			const regex = new RegExp(normalized.query, flags);
			matcher = (line) => regex.test(line);
		} catch (error) {
			return {
				lines: displayLines.slice(0, totalLines),
				matchCount: 0,
				totalLines,
				filtered: false,
				error: error instanceof Error ? error.message : "Invalid regex",
			};
		}
	} else {
		const needle = normalized.caseSensitive ? normalized.query : normalized.query.toLowerCase();
		matcher = (line) => {
			const haystack = normalized.caseSensitive ? line : line.toLowerCase();
			return haystack.includes(needle);
		};
	}

	const matches = new Uint8Array(totalLines);
	let matchCount = 0;
	const context = normalized.contextLines;
	const range = context > 0 ? new Int32Array(totalLines + 1) : null;

	for (let i = 0; i < totalLines; i += 1) {
		const line = rawLines[i] ?? "";
		let isMatch = matcher(line);
		if (normalized.invert) {
			isMatch = !isMatch;
		}
		if (!isMatch) continue;
		matches[i] = 1;
		matchCount += 1;
		if (range) {
			const start = Math.max(0, i - context);
			const end = Math.min(totalLines - 1, i + context);
			range[start] += 1;
			range[end + 1] -= 1;
		}
	}

	const filteredLines: string[] = [];
	if (context > 0 && range) {
		let active = 0;
		for (let i = 0; i < totalLines; i += 1) {
			active += range[i] ?? 0;
			if (active > 0) {
				filteredLines.push(displayLines[i] ?? "");
			}
		}
	} else {
		for (let i = 0; i < totalLines; i += 1) {
			if (matches[i]) {
				filteredLines.push(displayLines[i] ?? "");
			}
		}
	}

	return {
		lines: filteredLines,
		matchCount,
		totalLines,
		filtered: true,
	};
}

export function formatOutputFilterLabel(filter: BlockOutputFilter): string {
	const normalized = normalizeOutputFilter(filter);
	const queryLabel = normalized.mode === "regex" ? `/${normalized.query}/` : `"${normalized.query}"`;
	const parts = [queryLabel];
	if (normalized.mode === "regex") {
		parts.push("regex");
	}
	if (normalized.caseSensitive) {
		parts.push("case");
	}
	if (normalized.invert) {
		parts.push("invert");
	}
	if (normalized.contextLines > 0) {
		parts.push(`ctx ${normalized.contextLines}`);
	}
	return parts.join(" · ");
}
