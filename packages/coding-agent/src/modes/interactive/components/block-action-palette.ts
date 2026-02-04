import { Container, getEditorKeybindings, Spacer, Text, TruncatedText } from "@mariozechner/pi-tui";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint, rawKeyHint } from "./keybinding-hints.js";

export type BlockActionItem = {
	id: string;
	label: string;
	description?: string;
};

export class BlockActionPaletteComponent extends Container {
	private items: BlockActionItem[];
	private selectedIndex = 0;
	private maxVisible: number;
	private listContainer: Container;
	private onSelect: (item: BlockActionItem) => void;
	private onCancel: () => void;

	constructor(
		title: string,
		items: BlockActionItem[],
		onSelect: (item: BlockActionItem) => void,
		onCancel: () => void,
		options?: { maxVisible?: number },
	) {
		super();
		this.items = items;
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.maxVisible = options?.maxVisible ?? 10;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", title), 1, 0));
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
		const total = this.items.length;
		if (kb.matches(keyData, "selectUp") || keyData === "k") {
			if (total === 0) return;
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			this.updateList();
		} else if (kb.matches(keyData, "selectDown") || keyData === "j") {
			if (total === 0) return;
			this.selectedIndex = Math.min(total - 1, this.selectedIndex + 1);
			this.updateList();
		} else if (kb.matches(keyData, "selectConfirm") || keyData === "\n") {
			if (total === 0) return;
			const selected = this.items[this.selectedIndex];
			if (selected) this.onSelect(selected);
		} else if (kb.matches(keyData, "selectCancel")) {
			this.onCancel();
		}
	}

	private updateList(): void {
		this.listContainer.clear();
		if (this.items.length === 0) {
			this.listContainer.addChild(new Text(theme.fg("muted", "  No actions available"), 1, 0));
			return;
		}

		const startIndex = Math.max(
			0,
			Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.items.length - this.maxVisible),
		);
		const endIndex = Math.min(startIndex + this.maxVisible, this.items.length);

		for (let i = startIndex; i < endIndex; i++) {
			const item = this.items[i];
			if (!item) continue;
			const isSelected = i === this.selectedIndex;
			const prefix = isSelected ? theme.fg("accent", "→ ") : "  ";
			const label = isSelected ? theme.fg("accent", item.label) : theme.fg("text", item.label);
			const description = item.description ? theme.fg("muted", ` ${item.description}`) : "";
			this.listContainer.addChild(new TruncatedText(`${prefix}${label}${description}`, 1, 0));
		}

		if (startIndex > 0 || endIndex < this.items.length) {
			const scrollText = theme.fg("muted", `  (${this.selectedIndex + 1}/${this.items.length})`);
			this.listContainer.addChild(new TruncatedText(scrollText, 1, 0));
		}
	}
}
