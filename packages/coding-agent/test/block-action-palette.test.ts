import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { BlockActionItem } from "../src/modes/interactive/components/block-action-palette.js";
import { BlockActionPaletteComponent } from "../src/modes/interactive/components/block-action-palette.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderText(component: BlockActionPaletteComponent, width = 100): string {
	return stripAnsi(component.render(width).join("\n"));
}

describe("BlockActionPaletteComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders a scroll indicator for long lists", () => {
		const items: BlockActionItem[] = Array.from({ length: 12 }, (_unused, index) => ({
			id: `action-${index}`,
			label: `Action ${index + 1}`,
		}));
		const component = new BlockActionPaletteComponent(
			"Block actions",
			items,
			() => {},
			() => {},
			{
				maxVisible: 5,
			},
		);
		let output = renderText(component);
		expect(output).toContain("(1/12)");

		component.handleInput("j");
		output = renderText(component);
		expect(output).toContain("(2/12)");
	});

	test("invokes selection callback", () => {
		const items: BlockActionItem[] = [
			{ id: "copy", label: "Copy" },
			{ id: "collapse", label: "Collapse" },
		];
		const onSelect = vi.fn();
		const component = new BlockActionPaletteComponent("Block actions", items, onSelect, () => {});
		component.handleInput("j");
		component.handleInput("\n");
		expect(onSelect).toHaveBeenCalledWith(items[1]);
	});

	test("shows empty state when no actions exist", () => {
		const component = new BlockActionPaletteComponent(
			"Block actions",
			[],
			() => {},
			() => {},
		);
		const output = renderText(component);
		expect(output).toContain("No actions available");
	});
});
