import {
	Container,
	type Focusable,
	getEditorKeybindings,
	Input,
	Spacer,
	Text,
	TruncatedText,
} from "@mariozechner/pi-tui";
import {
	type BlockOutputFilter,
	formatOutputFilterLabel,
	normalizeOutputFilter,
} from "../../../utils/block-output-filter.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { editorKey, keyHint, rawKeyHint } from "./keybinding-hints.js";

type FocusArea = "query" | "options";

type FilterOptionId = "mode" | "case" | "invert" | "context" | "apply" | "clear";

type FilterOption = {
	id: FilterOptionId;
	label: string;
	value?: string;
};

const DEFAULT_FILTER: BlockOutputFilter = {
	query: "",
	mode: "text",
	caseSensitive: false,
	invert: false,
	contextLines: 0,
};

const MAX_CONTEXT_LINES = 10;

export class BlockOutputFilterComponent extends Container implements Focusable {
	private title: string;
	private input: Input;
	private filter: BlockOutputFilter;
	private focusArea: FocusArea = "query";
	private selectedIndex = 0;
	private onApply: (filter?: BlockOutputFilter) => void;
	private onCancel: () => void;
	private _focused = false;

	constructor(
		title: string,
		filter: BlockOutputFilter | undefined,
		onApply: (filter?: BlockOutputFilter) => void,
		onCancel: () => void,
	) {
		super();
		this.title = title;
		this.filter = filter ? { ...filter } : { ...DEFAULT_FILTER };
		this.onApply = onApply;
		this.onCancel = onCancel;

		this.input = new Input();
		this.input.setValue(this.filter.query);
		this.input.onSubmit = () => {
			this.applyFilter();
		};

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
		this.input.focused = this._focused && this.focusArea === "query";
	}

	handleInput(data: string): void {
		const keybindings = getEditorKeybindings();

		if (keybindings.matches(data, "selectCancel")) {
			this.onCancel();
			return;
		}

		if (keybindings.matches(data, "tab")) {
			this.focusArea = this.focusArea === "query" ? "options" : "query";
			this.updateFocus();
			this.updateDisplay();
			return;
		}

		if (this.focusArea === "query") {
			if (keybindings.matches(data, "selectDown") || keybindings.matches(data, "selectUp")) {
				this.focusArea = "options";
				this.updateFocus();
				this.updateDisplay();
				return;
			}
			this.input.handleInput(data);
			this.filter.query = this.input.getValue();
			this.updateDisplay();
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
		if (keybindings.matches(data, "cursorLeft")) {
			this.adjustContext(-1);
			return;
		}
		if (keybindings.matches(data, "cursorRight")) {
			this.adjustContext(1);
			return;
		}
		if (keybindings.matches(data, "selectConfirm")) {
			this.activateOption();
		}
	}

	private moveSelection(delta: number): void {
		const options = this.getOptions();
		if (options.length === 0) return;
		const next = Math.max(0, Math.min(options.length - 1, this.selectedIndex + delta));
		if (next === this.selectedIndex) return;
		this.selectedIndex = next;
		this.updateDisplay();
	}

	private adjustContext(delta: number): void {
		const next = Math.max(0, Math.min(MAX_CONTEXT_LINES, this.filter.contextLines + delta));
		if (next === this.filter.contextLines) return;
		this.filter.contextLines = next;
		this.updateDisplay();
	}

	private activateOption(): void {
		const option = this.getOptions()[this.selectedIndex];
		if (!option) return;
		switch (option.id) {
			case "mode":
				this.filter.mode = this.filter.mode === "text" ? "regex" : "text";
				break;
			case "case":
				this.filter.caseSensitive = !this.filter.caseSensitive;
				break;
			case "invert":
				this.filter.invert = !this.filter.invert;
				break;
			case "context":
				this.adjustContext(1);
				break;
			case "apply":
				this.applyFilter();
				return;
			case "clear":
				this.clearFilter();
				return;
			default: {
				const _exhaustiveCheck: never = option.id;
				void _exhaustiveCheck;
				return;
			}
		}
		this.updateDisplay();
	}

	private applyFilter(): void {
		const normalized = normalizeOutputFilter(this.filter);
		if (!normalized.query) {
			this.onApply(undefined);
			return;
		}
		this.onApply(normalized);
	}

	private clearFilter(): void {
		this.onApply(undefined);
	}

	private getOptions(): FilterOption[] {
		return [
			{
				id: "mode",
				label: "Mode",
				value: this.filter.mode === "regex" ? "Regex" : "Text",
			},
			{
				id: "case",
				label: "Case",
				value: this.filter.caseSensitive ? "Sensitive" : "Insensitive",
			},
			{
				id: "invert",
				label: "Invert",
				value: this.filter.invert ? "On" : "Off",
			},
			{
				id: "context",
				label: "Context",
				value: `${this.filter.contextLines} lines`,
			},
			{ id: "apply", label: "Apply filter" },
			{ id: "clear", label: "Clear filter" },
		];
	}

	private formatOption(option: FilterOption, selected: boolean): string {
		const prefix = selected ? theme.fg("accent", "›") : theme.fg("muted", " ");
		const label = selected ? theme.fg("accent", option.label) : theme.fg("muted", option.label);
		const value = option.value ? theme.fg("accent", option.value) : "";
		return option.value ? `${prefix} ${label}: ${value}` : `${prefix} ${label}`;
	}

	private getSummaryLine(): string {
		const normalized = normalizeOutputFilter(this.filter);
		if (!normalized.query) {
			return theme.fg("muted", "No filter query");
		}
		return theme.fg("muted", `Filter: ${formatOutputFilterLabel(normalized)}`);
	}

	private getHintLine(): string {
		const sep = theme.fg("muted", " · ");
		const hints = [
			rawKeyHint(editorKey("tab"), "switch"),
			keyHint("selectConfirm", "toggle/apply"),
			keyHint("selectCancel", "cancel"),
		];
		return hints.join(sep);
	}

	private updateDisplay(): void {
		this.clear();
		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", this.title), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("muted", "Filter query"), 1, 0));
		this.addChild(this.input);
		this.addChild(new Spacer(1));

		const options = this.getOptions();
		options.forEach((option, index) => {
			const line = this.formatOption(option, index === this.selectedIndex && this.focusArea === "options");
			this.addChild(new TruncatedText(line, 1, 0));
		});

		this.addChild(new Spacer(1));
		this.addChild(new Text(this.getSummaryLine(), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.getHintLine(), 1, 0));
		this.addChild(new DynamicBorder());
	}
}
