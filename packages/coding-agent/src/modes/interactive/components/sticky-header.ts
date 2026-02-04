import stripAnsi from "strip-ansi";

export type StickyHeaderOptions = {
	headerIndex?: number;
	scanLimit?: number;
	viewportHeight?: number;
};

export function applyStickyHeader(lines: string[], viewportTop: number, options: StickyHeaderOptions = {}): string[] {
	if (lines.length === 0) return lines;

	const maxViewportTop = options.viewportHeight ? Math.max(0, lines.length - options.viewportHeight) : viewportTop;
	const effectiveTop = Math.min(viewportTop, maxViewportTop);
	if (effectiveTop <= 0 || effectiveTop >= lines.length) return lines;

	const headerIndex = options.headerIndex ?? findHeaderLineIndex(lines, options.scanLimit ?? 20);
	if (headerIndex === null) return lines;
	if (effectiveTop <= headerIndex) return lines;

	const nextLines = lines.slice();
	nextLines[effectiveTop] = lines[headerIndex];
	return nextLines;
}

function findHeaderLineIndex(lines: string[], scanLimit: number): number | null {
	const limit = Math.min(lines.length, Math.max(1, scanLimit));
	for (let i = 0; i < limit; i++) {
		const trimmed = stripAnsi(lines[i]).trim();
		if (trimmed.length > 0) return i;
	}
	return null;
}
