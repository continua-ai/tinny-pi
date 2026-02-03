import { type Component, sliceByColumn, type TUI, visibleWidth } from "@mariozechner/pi-tui";

const EMPTY_LINE = "";

type OutputSelection = {
	startRow: number;
	startCol: number;
	endRow: number;
	endCol: number;
};

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

export class ScrollLayout implements Component {
	private tui: TUI;
	private output: Component;
	private fixed: Component;
	private enabled = false;
	private scrollOffset = 0;
	private lastOutputLineCount = 0;
	private lastAvailableHeight = 0;
	private lastMaxScrollOffset = 0;
	private lastVisibleOutputLines: string[] = [];
	private lastVisibleFixedLines: string[] = [];
	private outputSelection: OutputSelection | null = null;

	constructor(tui: TUI, output: Component, fixed: Component) {
		this.tui = tui;
		this.output = output;
		this.fixed = fixed;
	}

	setOutputSelection(selection: OutputSelection | null): void {
		this.outputSelection = selection;
	}

	getOutputSelection(): OutputSelection | null {
		return this.outputSelection;
	}

	getOutputHeight(): number {
		return this.lastAvailableHeight;
	}

	getVisibleOutputLines(): string[] {
		return [...this.lastVisibleOutputLines];
	}

	getVisibleFixedLines(): string[] {
		return [...this.lastVisibleFixedLines];
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		this.scrollOffset = 0;
		this.lastOutputLineCount = 0;
		this.lastAvailableHeight = 0;
		this.lastMaxScrollOffset = 0;
		this.outputSelection = null;
	}

	scrollBy(lines: number): void {
		if (!this.enabled || lines === 0) return;
		this.scrollOffset = clamp(this.scrollOffset + lines, 0, this.lastMaxScrollOffset);
		this.outputSelection = null;
	}

	scrollByPage(pages: number): void {
		if (!this.enabled || pages === 0) return;
		const pageSize = Math.max(1, this.lastAvailableHeight - 1);
		this.scrollBy(pages * pageSize);
	}

	scrollToBottom(): void {
		this.scrollOffset = 0;
		this.outputSelection = null;
	}

	isScrolled(): boolean {
		return this.scrollOffset > 0;
	}

	invalidate(): void {
		this.output.invalidate?.();
		this.fixed.invalidate?.();
	}

	render(width: number): string[] {
		const height = this.tui.terminal.rows;
		const outputLines = this.output.render(width);
		const fixedLines = this.fixed.render(width);

		if (!this.enabled) {
			this.lastOutputLineCount = outputLines.length;
			this.lastAvailableHeight = 0;
			this.lastMaxScrollOffset = 0;
			this.lastVisibleOutputLines = [...outputLines];
			this.lastVisibleFixedLines = [...fixedLines];
			return [...outputLines, ...fixedLines];
		}

		if (this.scrollOffset > 0 && outputLines.length > this.lastOutputLineCount) {
			this.scrollOffset += outputLines.length - this.lastOutputLineCount;
		}
		this.lastOutputLineCount = outputLines.length;

		let visibleFixedLines = fixedLines;
		if (visibleFixedLines.length > height) {
			visibleFixedLines = visibleFixedLines.slice(visibleFixedLines.length - height);
		}

		const availableHeight = Math.max(0, height - visibleFixedLines.length);
		this.lastAvailableHeight = availableHeight;
		this.lastMaxScrollOffset = Math.max(0, outputLines.length - availableHeight);
		this.scrollOffset = clamp(this.scrollOffset, 0, this.lastMaxScrollOffset);

		const start = Math.max(0, outputLines.length - availableHeight - this.scrollOffset);
		let visibleOutputLines = availableHeight > 0 ? outputLines.slice(start, start + availableHeight) : [];

		if (visibleOutputLines.length < availableHeight) {
			visibleOutputLines = visibleOutputLines.concat(
				Array.from({ length: availableHeight - visibleOutputLines.length }, () => EMPTY_LINE),
			);
		}

		this.lastVisibleOutputLines = [...visibleOutputLines];
		this.lastVisibleFixedLines = [...visibleFixedLines];

		const highlightedOutput = this.applyOutputSelection(visibleOutputLines);
		return [...highlightedOutput, ...visibleFixedLines];
	}

	private applyOutputSelection(lines: string[]): string[] {
		if (!this.outputSelection) return lines;
		if (lines.length === 0) return lines;
		const selection = this.normalizeOutputSelection(this.outputSelection, lines.length);
		if (!selection) return lines;

		return lines.map((line, index) => {
			if (index < selection.startRow || index > selection.endRow) {
				return line;
			}

			const lineWidth = visibleWidth(line);
			const startCol = index === selection.startRow ? selection.startCol : 0;
			const endCol = index === selection.endRow ? selection.endCol : lineWidth;
			return this.highlightLine(line, startCol, endCol);
		});
	}

	private normalizeOutputSelection(selection: OutputSelection, lineCount: number): OutputSelection | null {
		if (lineCount <= 0) return null;
		let { startRow, startCol, endRow, endCol } = selection;

		if (startRow > endRow || (startRow === endRow && startCol > endCol)) {
			[startRow, endRow] = [endRow, startRow];
			[startCol, endCol] = [endCol, startCol];
		}

		startRow = clamp(startRow, 0, lineCount - 1);
		endRow = clamp(endRow, 0, lineCount - 1);

		return { startRow, startCol, endRow, endCol };
	}

	private highlightLine(line: string, startCol: number, endCol: number): string {
		const lineWidth = visibleWidth(line);
		const safeStart = clamp(startCol, 0, lineWidth);
		const safeEnd = clamp(endCol, 0, lineWidth);
		if (safeStart >= safeEnd) return line;

		const before = sliceByColumn(line, 0, safeStart, true);
		const middle = sliceByColumn(line, safeStart, safeEnd - safeStart, true);
		const after = sliceByColumn(line, safeEnd, lineWidth - safeEnd, true);
		return `${before}\x1b[7m${middle}\x1b[0m${after}`;
	}
}
