/**
 * Component for displaying bash command execution with streaming output.
 */

import { Container, Loader, Spacer, Text, type TUI } from "@mariozechner/pi-tui";
import stripAnsi from "strip-ansi";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	type TruncationResult,
	truncateTail,
} from "../../../core/tools/truncate.js";
import {
	applyOutputFilter,
	type BlockOutputFilter,
	type BlockOutputFilterResult,
	formatOutputFilterLabel,
	normalizeOutputFilter,
} from "../../../utils/block-output-filter.js";
import { type ThemeColor, theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { editorKey, keyHint } from "./keybinding-hints.js";
import { truncateToVisualLines } from "./visual-truncate.js";

// Preview line limit when not expanded (matches tool execution behavior)
const PREVIEW_LINES = 20;

export class BashExecutionComponent extends Container {
	private command: string;
	private headerMarker?: string;
	private headerBadge?: string;
	private outputFilter?: BlockOutputFilter;
	private outputFilterCache?: {
		outputVersion: number;
		filterKey: string;
		result: BlockOutputFilterResult | null;
	};
	private outputVersion = 0;
	private outputLines: string[] = [];
	private status: "running" | "complete" | "cancelled" | "error" = "running";
	private exitCode: number | undefined = undefined;
	private loader: Loader;
	private truncationResult?: TruncationResult;
	private fullOutputPath?: string;
	private expanded = false;
	private contentContainer: Container;
	private ui: TUI;

	constructor(command: string, ui: TUI, excludeFromContext = false) {
		super();
		this.command = command;
		this.ui = ui;

		// Use dim border for excluded-from-context commands (!! prefix)
		const colorKey = excludeFromContext ? "dim" : "bashMode";
		const borderColor = (str: string) => theme.fg(colorKey, str);

		// Add spacer
		this.addChild(new Spacer(1));

		// Top border
		this.addChild(new DynamicBorder(borderColor));

		// Content container (holds dynamic content between borders)
		this.contentContainer = new Container();
		this.addChild(this.contentContainer);

		// Command header
		const header = new Text(this.formatHeaderText(colorKey), 1, 0);
		this.contentContainer.addChild(header);

		// Loader
		this.loader = new Loader(
			ui,
			(spinner) => theme.fg(colorKey, spinner),
			(text) => theme.fg("muted", text),
			`Running... (${editorKey("selectCancel")} to cancel)`, // Plain text for loader
		);
		this.contentContainer.addChild(this.loader);

		// Bottom border
		this.addChild(new DynamicBorder(borderColor));
	}

	setHeaderMarker(marker?: string): void {
		if (this.headerMarker === marker) return;
		this.headerMarker = marker;
		this.updateDisplay();
	}

	setHeaderBadge(badge?: string): void {
		if (this.headerBadge === badge) return;
		this.headerBadge = badge;
		this.updateDisplay();
	}

	setOutputFilter(filter?: BlockOutputFilter): void {
		this.outputFilter = filter;
		this.outputFilterCache = undefined;
		this.updateDisplay();
	}

	getOutputFilter(): BlockOutputFilter | undefined {
		return this.outputFilter;
	}

	supportsOutputFilter(): boolean {
		return true;
	}

	getBlockText(): string {
		const output = this.getOutput();
		return output ? `${this.command}\n${output}` : this.command;
	}

	private formatHeaderText(colorKey: ThemeColor): string {
		const marker = this.headerMarker ?? "";
		const badge = this.headerBadge ?? "";
		const filterSuffix = this.getFilterHeaderSuffix();
		return `${marker}${badge}${theme.fg(colorKey, theme.bold(`$ ${this.command}`))}${filterSuffix}`;
	}

	/**
	 * Set whether the output is expanded (shows full output) or collapsed (preview only).
	 */
	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.updateDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.updateDisplay();
	}

	appendOutput(chunk: string): void {
		// Strip ANSI codes and normalize line endings
		// Note: binary data is already sanitized in tui-renderer.ts executeBashCommand
		const clean = stripAnsi(chunk).replace(/\r\n/g, "\n").replace(/\r/g, "\n");

		// Append to output lines
		const newLines = clean.split("\n");
		if (this.outputLines.length > 0 && newLines.length > 0) {
			// Append first chunk to last line (incomplete line continuation)
			this.outputLines[this.outputLines.length - 1] += newLines[0];
			this.outputLines.push(...newLines.slice(1));
		} else {
			this.outputLines.push(...newLines);
		}

		this.outputVersion += 1;
		this.outputFilterCache = undefined;
		this.updateDisplay();
	}

	setComplete(
		exitCode: number | undefined,
		cancelled: boolean,
		truncationResult?: TruncationResult,
		fullOutputPath?: string,
	): void {
		this.exitCode = exitCode;
		this.status = cancelled
			? "cancelled"
			: exitCode !== 0 && exitCode !== undefined && exitCode !== null
				? "error"
				: "complete";
		this.truncationResult = truncationResult;
		this.fullOutputPath = fullOutputPath;

		// Stop loader
		this.loader.stop();

		this.updateDisplay();
	}

	private getFilterHeaderSuffix(): string {
		if (!this.outputFilter) return "";
		if (!this.outputFilter.query.trim()) return "";
		const label = formatOutputFilterLabel(this.outputFilter);
		return theme.fg("muted", ` [filter: ${label}]`);
	}

	private getOutputFilterResult(rawLines: string[], displayLines: string[]): BlockOutputFilterResult | null {
		if (!this.outputFilter) return null;
		const normalized = normalizeOutputFilter(this.outputFilter);
		if (!normalized.query) return null;
		const filterKey = JSON.stringify(normalized);
		if (
			this.outputFilterCache &&
			this.outputFilterCache.outputVersion === this.outputVersion &&
			this.outputFilterCache.filterKey === filterKey
		) {
			return this.outputFilterCache.result;
		}
		const result = applyOutputFilter(rawLines, displayLines, normalized);
		this.outputFilterCache = {
			outputVersion: this.outputVersion,
			filterKey,
			result,
		};
		return result;
	}

	private formatFilterHint(result: BlockOutputFilterResult): string {
		if (result.error) {
			return theme.fg("warning", `[Filter error: ${result.error}]`);
		}
		const label = this.outputFilter ? formatOutputFilterLabel(this.outputFilter) : "filter";
		const matchLabel = result.matchCount === 1 ? "match" : "matches";
		return theme.fg(
			"muted",
			`[Filter: ${label} · ${result.matchCount} ${matchLabel} · ${result.lines.length}/${result.totalLines} lines]`,
		);
	}

	private applyOutputFilterToLines(
		rawLines: string[],
		displayLines: string[],
	): {
		lines: string[];
		hint?: string;
		result?: BlockOutputFilterResult;
	} {
		const result = this.getOutputFilterResult(rawLines, displayLines);
		if (!result) {
			return { lines: displayLines };
		}
		const hint = this.formatFilterHint(result);
		if (!result.filtered) {
			return { lines: displayLines, hint, result };
		}
		return { lines: result.lines, hint, result };
	}

	private updateDisplay(): void {
		// Apply truncation for LLM context limits (same limits as bash tool)
		const fullOutput = this.outputLines.join("\n");
		const contextTruncation = truncateTail(fullOutput, {
			maxLines: DEFAULT_MAX_LINES,
			maxBytes: DEFAULT_MAX_BYTES,
		});

		// Get the lines to potentially display (after context truncation)
		const availableLines = contextTruncation.content ? contextTruncation.content.split("\n") : [];
		const styledLines = availableLines.map((line) => theme.fg("muted", line));
		const { lines: filteredLines, hint } = this.applyOutputFilterToLines(availableLines, styledLines);

		// Apply preview truncation based on expanded state
		const previewLogicalLines = filteredLines.slice(-PREVIEW_LINES);
		const hiddenLineCount = filteredLines.length - previewLogicalLines.length;

		// Rebuild content container
		this.contentContainer.clear();

		// Command header
		const header = new Text(this.formatHeaderText("bashMode"), 1, 0);
		this.contentContainer.addChild(header);

		// Output
		if (filteredLines.length > 0) {
			if (this.expanded) {
				// Show all lines
				const displayText = filteredLines.join("\n");
				this.contentContainer.addChild(new Text(`\n${displayText}`, 1, 0));
			} else {
				// Use shared visual truncation utility
				const styledOutput = previewLogicalLines.join("\n");
				const { visualLines } = truncateToVisualLines(
					`\n${styledOutput}`,
					PREVIEW_LINES,
					this.ui.terminal.columns,
					1, // padding
				);
				this.contentContainer.addChild({ render: () => visualLines, invalidate: () => {} });
			}
		}
		if (hint) {
			this.contentContainer.addChild(new Text(`\n${hint}`, 1, 0));
		}

		// Loader or status
		if (this.status === "running") {
			this.contentContainer.addChild(this.loader);
		} else {
			const statusParts: string[] = [];

			// Show how many lines are hidden (collapsed preview)
			if (hiddenLineCount > 0) {
				if (this.expanded) {
					statusParts.push(`(${keyHint("expandTools", "to collapse")})`);
				} else {
					statusParts.push(
						`${theme.fg("muted", `... ${hiddenLineCount} more lines`)} (${keyHint("expandTools", "to expand")})`,
					);
				}
			}

			if (this.status === "cancelled") {
				statusParts.push(theme.fg("warning", "(cancelled)"));
			} else if (this.status === "error") {
				statusParts.push(theme.fg("error", `(exit ${this.exitCode})`));
			}

			// Add truncation warning (context truncation, not preview truncation)
			const wasTruncated = this.truncationResult?.truncated || contextTruncation.truncated;
			if (wasTruncated && this.fullOutputPath) {
				statusParts.push(theme.fg("warning", `Output truncated. Full output: ${this.fullOutputPath}`));
			}

			if (statusParts.length > 0) {
				this.contentContainer.addChild(new Text(`\n${statusParts.join("\n")}`, 1, 0));
			}
		}
	}

	/**
	 * Get the raw output for creating BashExecutionMessage.
	 */
	getOutput(): string {
		return this.outputLines.join("\n");
	}

	/**
	 * Get the command that was executed.
	 */
	getCommand(): string {
		return this.command;
	}
}
