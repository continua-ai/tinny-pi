import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.js";
import { UserMessageComponent } from "../src/modes/interactive/components/user-message.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";
import { assistantMsg } from "./utilities.js";

function renderLines(component: { render: (width: number) => string[] }, width = 120): string[] {
	return component.render(width).map((line) => stripAnsi(line).trim());
}

describe("message headers", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("renders a user header", () => {
		const component = new UserMessageComponent("Hello");
		const lines = renderLines(component);
		expect(lines.some((line) => line.includes("User"))).toBe(true);
	});

	test("renders assistant header with model", () => {
		const message = assistantMsg("Hello");
		const component = new AssistantMessageComponent(message);
		const lines = renderLines(component);
		const headerLine = lines.find((line) => line.includes("Assistant"));
		expect(headerLine).toBeDefined();
		expect(headerLine).toContain("test");
	});

	test("renders user preview when collapsed", () => {
		const component = new UserMessageComponent("Hello\nWorld");
		component.setCollapsed(true);
		const lines = renderLines(component);
		expect(lines.some((line) => line.includes("User"))).toBe(true);
		expect(lines.some((line) => line.includes("Hello"))).toBe(true);
		expect(lines.some((line) => line.includes("World"))).toBe(false);
	});

	test("renders assistant preview when collapsed", () => {
		const message = assistantMsg("Line one\nLine two");
		const component = new AssistantMessageComponent(message);
		component.setCollapsed(true);
		const lines = renderLines(component);
		expect(lines.some((line) => line.includes("Line one"))).toBe(true);
		expect(lines.some((line) => line.includes("Line two"))).toBe(false);
	});
});
