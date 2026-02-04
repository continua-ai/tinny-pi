import { Container, fuzzyFilter, getEditorKeybindings, Input, Spacer, Text, TruncatedText } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint, rawKeyHint } from "./keybinding-hints.js";

export type CommandPaletteItem = {
	id: string;
	label: string;
	description?: string;
	searchText?: string;
};

export class CommandPaletteComponent extends Container {
	private items: CommandPaletteItem[];
	private filteredItems: CommandPaletteItem[];
	private selectedIndex = 0;
	private listContainer: Container;
	private onSelect: (item: CommandPaletteItem) => void;
	private onCancel: () => void;
	private input: Input;
	private maxVisible: number;

	constructor(
		title: string,
		items: CommandPaletteItem[],
		onSelect: (item: CommandPaletteItem) => void,
		onCancel: () => void,
		options?: { maxVisible?: number },
	) {
		super();
		this.items = items;
		this.filteredItems = items;
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.maxVisible = options?.maxVisible ?? 10;
		this.input = new Input();

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(this.input);
		this.addChild(new Spacer(1));

		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(
				rawKeyHint("↑↓", "navigate") +
					"  " +
					keyHint("selectConfirm", "select") +
					"  " +
					keyHint("selectCancel", "cancel"),
				1,
				0,
			),
		);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		const total = this.filteredItems.length;
		if (kb.matches(keyData, "selectUp") || keyData === "k") {
			if (total === 0) return;
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "selectDown") || keyData === "j") {
			if (total === 0) return;
			this.selectedIndex = Math.min(total - 1, this.selectedIndex + 1);
			this.updateList();
			return;
		}
		if (kb.matches(keyData, "selectConfirm") || keyData === "\n") {
			if (total === 0) return;
			const selected = this.filteredItems[this.selectedIndex];
			if (selected) this.onSelect(selected);
			return;
		}
		if (kb.matches(keyData, "selectCancel")) {
			this.onCancel();
			return;
		}

		this.input.handleInput(keyData);
		this.applyFilter();
	}

	private applyFilter(): void {
		const filterText = this.input.getValue().trim();
		this.filteredItems = filterText
			? fuzzyFilter(this.items, filterText, (item) => this.getSearchText(item))
			: this.items;
		this.selectedIndex = 0;
		this.updateList();
	}

	private getSearchText(item: CommandPaletteItem): string {
		return item.searchText ?? `${item.label} ${item.description ?? ""}`;
	}

	private updateList(): void {
		this.listContainer.clear();

		if (this.filteredItems.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No matching commands"), 1, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.filteredItems.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.filteredItems.length);

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.filteredItems[i];
			if (!item) continue;
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const label = isSelected ? theme.fg("accent", item.label) : theme.fg("text", item.label);
			const description = item.description ? theme.fg("muted", ` ${item.description}`) : "";
			this.listContainer.addChild(new TruncatedText(`${prefix}${label}${description}`, 1, 0));
		}

		if (startIndex > 0 || endIndex < this.filteredItems.length) {
			const scrollText = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.filteredItems.length})`);
			this.listContainer.addChild(new TruncatedText(scrollText, 1, 0));
		}
	}
}
