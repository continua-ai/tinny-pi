import {
	Container,
	type Focusable,
	getEditorKeybindings,
	Input,
	Spacer,
	Text,
	TruncatedText,
} from "@mariozechner/pi-tui";
import { type BlockSearchResult, type BlockSearchSummary, searchTextByLine } from "../../../utils/block-search.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint, rawKeyHint } from "./keybinding-hints.js";

const MAX_RESULTS = 200;
const MAX_SCAN_LINES = 20000;

export class BlockSearchComponent extends Container implements Focusable {
	private title: string;
	private text: string;
	private input: Input;
	private results: BlockSearchResult[] = [];
	private summary: BlockSearchSummary = {
		results: [],
		totalMatches: 0,
		scannedLines: 0,
		truncated: false,
	};
	private selectedIndex = 0;
	private onSelect: (result: BlockSearchResult) => void;
	private onCancel: () => void;
	private _focused = false;
	private searchTimer: ReturnType<typeof setTimeout> | null = null;
	private lastQuery = "";

	constructor(title: string, text: string, onSelect: (result: BlockSearchResult) => void, onCancel: () => void) {
		super();
		this.title = title;
		this.text = text;
		this.onSelect = onSelect;
		this.onCancel = onCancel;

		this.input = new Input();
		this.input.onSubmit = () => {
			this.confirmSelection();
		};

		this.performSearch();
		this.updateDisplay();
		this.updateFocus();
	}

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.updateFocus();
	}

	private updateFocus(): void {
		this.input.focused = this._focused;
	}

	handleInput(data: string): void {
		const keybindings = getEditorKeybindings();

		if (keybindings.matches(data, "selectCancel")) {
			this.clearSearchTimer();
			this.onCancel();
			return;
		}
		if (data === "j" || keybindings.matches(data, "selectDown")) {
			this.moveSelection(1);
			return;
		}
		if (data === "k" || keybindings.matches(data, "selectUp")) {
			this.moveSelection(-1);
			return;
		}
		if (keybindings.matches(data, "selectConfirm")) {
			this.confirmSelection();
			return;
		}

		this.input.handleInput(data);
		this.scheduleSearch();
	}

	private moveSelection(delta: number): void {
		if (this.results.length === 0) return;
		const next = Math.max(0, Math.min(this.results.length - 1, this.selectedIndex + delta));
		if (next === this.selectedIndex) return;
		this.selectedIndex = next;
		this.updateDisplay();
	}

	private confirmSelection(): void {
		const result = this.results[this.selectedIndex];
		if (!result) return;
		this.clearSearchTimer();
		this.onSelect(result);
	}

	private clearSearchTimer(): void {
		if (!this.searchTimer) return;
		clearTimeout(this.searchTimer);
		this.searchTimer = null;
	}

	private scheduleSearch(): void {
		if (this.searchTimer) {
			clearTimeout(this.searchTimer);
		}
		this.searchTimer = setTimeout(() => {
			this.searchTimer = null;
			this.performSearch();
			this.updateDisplay();
		}, 120);
	}

	private performSearch(): void {
		const query = this.input.getValue();
		if (query === this.lastQuery) return;
		this.lastQuery = query;
		this.summary = searchTextByLine(this.text, query, {
			caseSensitive: false,
			maxResults: MAX_RESULTS,
			maxScanLines: MAX_SCAN_LINES,
		});
		this.results = this.summary.results;
		if (this.selectedIndex >= this.results.length) {
			this.selectedIndex = Math.max(0, this.results.length - 1);
		}
	}

	private formatResult(result: BlockSearchResult, index: number): string {
		const selected = index === this.selectedIndex;
		const prefix = selected ? theme.fg("accent", "›") : theme.fg("muted", " ");
		const lineNumber = theme.fg("muted", `L${result.lineIndex + 1}`);
		const text = result.line.replace(/\s+/g, " ").trim();
		const label = selected ? theme.fg("accent", text) : theme.fg("muted", text);
		return `${prefix} ${lineNumber} ${label}`;
	}

	private getSummaryLine(): string {
		const query = this.input.getValue().trim();
		if (!query) {
			return theme.fg("muted", "Type to search within block");
		}
		if (this.summary.totalMatches === 0) {
			return theme.fg("muted", "No matches");
		}
		const shown = this.results.length;
		const total = this.summary.totalMatches;
		const base = total > shown ? `Showing ${shown} of ${total} matches` : `${total} matches`;
		const suffix = this.summary.truncated ? ` · scanned ${this.summary.scannedLines} lines` : "";
		return theme.fg("muted", `${base}${suffix}`);
	}

	private getHintLine(): string {
		const sep = theme.fg("muted", " · ");
		const hints = [keyHint("selectConfirm", "jump"), keyHint("selectCancel", "close"), rawKeyHint("↑/↓", "navigate")];
		return hints.join(sep);
	}

	private updateDisplay(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", this.title), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "Search query"), 1, 0));
		this.addChild(this.input);
		this.addChild(new Spacer(1));

		if (this.results.length === 0) {
			this.addChild(new Text(this.getSummaryLine(), 1, 0));
		} else {
			this.results.forEach((result, index) => {
				this.addChild(new TruncatedText(this.formatResult(result, index), 1, 0));
			});
			this.addChild(new Spacer(1));
			this.addChild(new Text(this.getSummaryLine(), 1, 0));
		}

		this.addChild(new Spacer(1));
		this.addChild(new Text(this.getHintLine(), 1, 0));
		this.addChild(new DynamicBorder());
	}
}
