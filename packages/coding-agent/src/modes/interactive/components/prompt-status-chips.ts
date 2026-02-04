import { type Component, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export type PromptStatusChip = {
	text: string;
	priority?: boolean;
};

export class PromptStatusChipsComponent implements Component {
	private chips: PromptStatusChip[] = [];
	private paddingX = 1;

	setChips(chips: PromptStatusChip[]): void {
		this.chips = chips;
	}

	setText(text: string): void {
		this.chips = text.trim() ? [{ text }] : [];
	}

	invalidate(): void {
		// No cached state
	}

	render(width: number): string[] {
		if (this.chips.length === 0) return [];

		const availableWidth = Math.max(1, width - this.paddingX * 2);
		let chips = this.chips;
		let displayText = this.joinChips(chips);

		if (visibleWidth(displayText) > availableWidth && chips.some((chip) => chip.priority)) {
			const priorityChips = chips.filter((chip) => chip.priority);
			const normalChips = chips.filter((chip) => !chip.priority);
			chips = [...priorityChips, ...normalChips];
			displayText = this.joinChips(chips);
		}

		displayText = truncateToWidth(displayText, availableWidth);
		const leftPadding = " ".repeat(this.paddingX);
		const rightPadding = leftPadding;
		const lineWithPadding = `${leftPadding}${displayText}${rightPadding}`;
		const lineVisibleWidth = visibleWidth(lineWithPadding);
		const paddingNeeded = Math.max(0, width - lineVisibleWidth);
		return [lineWithPadding + " ".repeat(paddingNeeded)];
	}

	private joinChips(chips: PromptStatusChip[]): string {
		return chips.map((chip) => chip.text).join(" ");
	}
}
