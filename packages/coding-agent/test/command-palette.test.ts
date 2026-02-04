import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test, vi } from "vitest";
import type { CommandPaletteItem } from "../src/modes/interactive/components/command-palette.js";
import { CommandPaletteComponent } from "../src/modes/interactive/components/command-palette.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";

function renderText(component: CommandPaletteComponent, width = 100): string {
	return stripAnsi(component.render(width).join("\n"));
}

describe("CommandPaletteComponent", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("filters items as input changes", () => {
		const items: CommandPaletteItem[] = [
			{ id: "settings", label: "/settings", description: "Command · settings" },
			{ id: "block-actions", label: "Block actions", description: "Action · block" },
			{ id: "model", label: "/model", description: "Command · model" },
		];
		const component = new CommandPaletteComponent(
			"Command palette",
			items,
			() => {},
			() => {},
		);
		component.handleInput("b");
		const output = renderText(component);
		expect(output).toContain("Block actions");
		expect(output).not.toContain("/settings");
	});

	test("invokes selection callback", () => {
		const items: CommandPaletteItem[] = [
			{ id: "first", label: "First", description: "Action" },
			{ id: "second", label: "Second", description: "Action" },
		];
		const onSelect = vi.fn();
		const component = new CommandPaletteComponent("Command palette", items, onSelect, () => {});
		component.handleInput("j");
		component.handleInput("\n");
		expect(onSelect).toHaveBeenCalledWith(items[1]);
	});

	test("shows empty state when no matches", () => {
		const items: CommandPaletteItem[] = [{ id: "settings", label: "/settings", description: "Command · settings" }];
		const component = new CommandPaletteComponent(
			"Command palette",
			items,
			() => {},
			() => {},
		);
		component.handleInput("z");
		const output = renderText(component);
		expect(output).toContain("No matching commands");
	});
});
