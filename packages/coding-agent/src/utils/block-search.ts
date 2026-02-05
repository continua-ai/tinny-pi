export type BlockSearchResult = {
	lineIndex: number;
	line: string;
};

export type BlockSearchSummary = {
	results: BlockSearchResult[];
	totalMatches: number;
	scannedLines: number;
	truncated: boolean;
};

export type BlockSearchOptions = {
	caseSensitive?: boolean;
	maxResults?: number;
	maxScanLines?: number;
};

export function searchTextByLine(text: string, query: string, options: BlockSearchOptions = {}): BlockSearchSummary {
	const trimmed = query.trim();
	if (!trimmed) {
		return { results: [], totalMatches: 0, scannedLines: 0, truncated: false };
	}

	const caseSensitive = options.caseSensitive ?? false;
	const maxResults = options.maxResults ?? 200;
	const maxScanLines = options.maxScanLines ?? 20000;
	const needle = caseSensitive ? trimmed : trimmed.toLowerCase();

	const results: BlockSearchResult[] = [];
	let totalMatches = 0;
	let scannedLines = 0;
	let truncated = false;

	let start = 0;
	let lineIndex = 0;
	const textLength = text.length;

	while (start <= textLength) {
		if (lineIndex >= maxScanLines) {
			truncated = true;
			break;
		}

		const newlineIndex = text.indexOf("\n", start);
		const end = newlineIndex === -1 ? textLength : newlineIndex;
		const line = text.slice(start, end);
		const haystack = caseSensitive ? line : line.toLowerCase();
		if (haystack.includes(needle)) {
			totalMatches += 1;
			if (results.length < maxResults) {
				results.push({ lineIndex, line });
			}
		}

		scannedLines += 1;
		lineIndex += 1;
		if (newlineIndex === -1) {
			break;
		}
		start = newlineIndex + 1;
	}

	if (start < textLength && !truncated) {
		truncated = true;
	}

	return { results, totalMatches, scannedLines, truncated };
}
