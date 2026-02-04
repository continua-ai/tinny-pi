import stripAnsi from "strip-ansi";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { PromptStatusChipsComponent } from "../src/modes/interactive/components/prompt-status-chips.js";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";
import type { ThemeColor } from "../src/modes/interactive/theme/theme.js";
import { initTheme } from "../src/modes/interactive/theme/theme.js";
import type { GitStatusSummary } from "../src/utils/git-status.js";

vi.mock("../src/utils/git-status.js", () => ({
	getGitStatusSummary: vi.fn(() => ({
		branch: "main",
		dirty: true,
		diff: { filesChanged: 1, insertions: 2, deletions: 0 },
	})),
}));

type FakeInteractiveMode = {
	sessionManager: { getCwd: () => string };
	formatDisplayPath: (path: string) => string;
	formatPromptChip: (label: string, value: string, color: ThemeColor) => string;
	formatDiffChip: (summary: GitStatusSummary) => string | null;
	getBlockFilterLabel: (mode: "all" | "no-tools" | "messages") => string;
	blockFilterMode: "all" | "no-tools" | "messages";
	promptStatus: PromptStatusChipsComponent;
	lastPromptStatus: string;
	ui: { requestRender: () => void };
};

function renderText(component: PromptStatusChipsComponent, width = 120): string {
	return stripAnsi(component.render(width).join("\n"));
}

describe("prompt status filter chip", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("adds a filter chip when filtering is active", () => {
		const promptStatus = new PromptStatusChipsComponent();
		const fakeThis: FakeInteractiveMode = {
			sessionManager: { getCwd: () => "/tmp/project" },
			formatDisplayPath: (path) => path,
			formatPromptChip: (InteractiveMode.prototype as unknown as FakeInteractiveMode).formatPromptChip,
			formatDiffChip: (InteractiveMode.prototype as unknown as FakeInteractiveMode).formatDiffChip,
			getBlockFilterLabel: (InteractiveMode.prototype as unknown as FakeInteractiveMode).getBlockFilterLabel,
			blockFilterMode: "messages",
			promptStatus,
			lastPromptStatus: "",
			ui: { requestRender: vi.fn() },
		};

		const update = (InteractiveMode.prototype as unknown as { updatePromptStatusChips: () => void })
			.updatePromptStatusChips;
		update.call(fakeThis);

		const output = renderText(promptStatus);
		expect(output).toContain("filter User + assistant");
	});

	test("keeps the filter chip visible when truncated", () => {
		const promptStatus = new PromptStatusChipsComponent();
		const fakeThis: FakeInteractiveMode = {
			sessionManager: { getCwd: () => "/tmp/project/with/a/very/long/path/for/status/chips" },
			formatDisplayPath: (path) => path,
			formatPromptChip: (InteractiveMode.prototype as unknown as FakeInteractiveMode).formatPromptChip,
			formatDiffChip: (InteractiveMode.prototype as unknown as FakeInteractiveMode).formatDiffChip,
			getBlockFilterLabel: (InteractiveMode.prototype as unknown as FakeInteractiveMode).getBlockFilterLabel,
			blockFilterMode: "no-tools",
			promptStatus,
			lastPromptStatus: "",
			ui: { requestRender: vi.fn() },
		};

		const update = (InteractiveMode.prototype as unknown as { updatePromptStatusChips: () => void })
			.updatePromptStatusChips;
		update.call(fakeThis);

		const output = renderText(promptStatus, 40);
		expect(output).toContain("filter No tools");
	});
});
